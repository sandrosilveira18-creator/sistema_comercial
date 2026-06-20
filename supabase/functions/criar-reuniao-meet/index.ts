// Edge Function chamada pelo painel (sb.functions.invoke) quando o SDR fecha uma
// reunião com o executivo/closer. Cria o evento com Google Meet na agenda do
// executivo (usando o token OAuth que ele conectou em "Conectar Google"),
// grava a reunião + atividade no banco e avisa o executivo por WhatsApp.
//
// Mantém a verificação de JWT padrão (só usuário logado no painel pode chamar).
// Variáveis de ambiente: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID") ?? "";
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "";

const sbAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// CORS: a função é chamada direto do navegador (sb.functions.invoke), então
// precisa responder o preflight OPTIONS e mandar esses headers em toda resposta.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(corpo: unknown, status = 200) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

async function obterAccessTokenValido(executivoId: string) {
  const { data: integ, error } = await sbAdmin
    .from("integracoes_executivo")
    .select("*")
    .eq("usuario_id", executivoId)
    .single();
  if (error || !integ?.google_refresh_token) {
    throw new Error("Esse executivo ainda não conectou o Google Agenda.");
  }

  const expirado = !integ.google_token_expira || new Date(integ.google_token_expira) <= new Date();
  if (!expirado) return integ.google_access_token as string;

  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: integ.google_refresh_token,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      grant_type: "refresh_token",
    }),
  });
  const tok = await resp.json();
  if (!resp.ok) throw new Error("Falha ao renovar token do Google: " + JSON.stringify(tok));

  const expiraEm = new Date(Date.now() + (tok.expires_in ?? 3600) * 1000).toISOString();
  await sbAdmin
    .from("integracoes_executivo")
    .update({ google_access_token: tok.access_token, google_token_expira: expiraEm, atualizado_em: new Date().toISOString() })
    .eq("usuario_id", executivoId);

  return tok.access_token as string;
}

async function notificarExecutivoWhatsApp(executivoId: string, texto: string) {
  try {
    const [{ data: integ }, { data: perfilExec }] = await Promise.all([
      sbAdmin.from("integracoes_executivo").select("callmebot_apikey").eq("usuario_id", executivoId).single(),
      sbAdmin.from("perfis").select("whatsapp").eq("id", executivoId).single(),
    ]);
    if (!integ?.callmebot_apikey || !perfilExec?.whatsapp) return;
    const fone = perfilExec.whatsapp.replace(/\D/g, "");
    const urlMsg = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(fone)}&text=${encodeURIComponent(texto)}&apikey=${encodeURIComponent(integ.callmebot_apikey)}`;
    await fetch(urlMsg);
  } catch (e) {
    console.warn("Falha ao notificar executivo por WhatsApp (não bloqueia a reunião):", e);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ erro: "Method not allowed" }, 405);

  let body: {
    lead_id?: number;
    executivo_id?: string;
    executivo_nome?: string;
    inicio?: string;
    agendado_por?: string;
    agendado_por_nome?: string;
  };
  try {
    body = await req.json();
  } catch {
    return json({ erro: "Payload inválido" }, 400);
  }

  const { lead_id, executivo_id, executivo_nome, inicio, agendado_por, agendado_por_nome } = body;
  if (!lead_id || !executivo_id || !inicio || !agendado_por) {
    return json({ erro: "Campos obrigatórios faltando" }, 400);
  }

  const dataInicio = new Date(inicio);
  const dataFim = new Date(dataInicio.getTime() + 60 * 60 * 1000); // reunião dura 1h

  try {
    const { data: lead, error: erroLead } = await sbAdmin.from("leads").select("*").eq("id", lead_id).single();
    if (erroLead || !lead) return json({ erro: "Lead não encontrado" }, 404);

    const accessToken = await obterAccessTokenValido(executivo_id);

    const evento = {
      summary: `Reunião comercial — ${lead.nome}${lead.empresa ? " (" + lead.empresa + ")" : ""}`,
      description: `Reunião agendada por ${agendado_por_nome ?? "SDR"} via painel Damião Academy.`,
      start: { dateTime: dataInicio.toISOString(), timeZone: "America/Sao_Paulo" },
      end: { dateTime: dataFim.toISOString(), timeZone: "America/Sao_Paulo" },
      conferenceData: {
        createRequest: {
          requestId: `reuniao-${lead_id}-${Date.now()}`,
          conferenceSolutionKey: { type: "hangoutsMeet" },
        },
      },
    };

    const respCal = await fetch(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(evento),
      },
    );
    const eventoCriado = await respCal.json();
    if (!respCal.ok) {
      console.error("Erro ao criar evento no Google Calendar:", eventoCriado);
      return json({ erro: "Falha ao criar evento no Google Agenda" }, 502);
    }

    const meetLink: string = eventoCriado.hangoutLink ?? "";
    const googleEventId: string = eventoCriado.id ?? "";

    const { data: reuniao, error: erroReuniao } = await sbAdmin
      .from("reunioes")
      .insert({
        lead_id,
        executivo_id,
        executivo_nome,
        agendado_por,
        agendado_por_nome,
        inicio: dataInicio.toISOString(),
        fim: dataFim.toISOString(),
        status: "agendada",
        meet_link: meetLink,
        google_event_id: googleEventId,
      })
      .select()
      .single();
    if (erroReuniao) {
      console.error("Erro ao gravar reunião:", erroReuniao);
      return json({ erro: "Reunião criada no Google, mas falhou ao salvar no painel" }, 500);
    }

    const dataFormatada = dataInicio.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
    await sbAdmin.from("atividades").insert({
      lead_id,
      usuario_id: agendado_por,
      usuario_nome: agendado_por_nome,
      tipo: "reuniao",
      resultado: "Reunião agendada",
      observacao: `Com ${executivo_nome ?? "executivo"} em ${dataFormatada} — Meet: ${meetLink}`,
    });

    // agendar reunião sempre avança o funil pra negociação, vindo de onde vier
    // (primeiro contato, recuperação etc.) — só não rebaixa um lead já fechado.
    if (lead.status !== "ativo" && lead.status !== "negociacao") {
      await sbAdmin.from("leads").update({ status: "negociacao" }).eq("id", lead_id);
    }

    await notificarExecutivoWhatsApp(
      executivo_id,
      [
        "📅 Nova reunião agendada — Damião Academy",
        `Lead: ${lead.nome}${lead.empresa ? " (" + lead.empresa + ")" : ""}`,
        `Quando: ${dataFormatada}`,
        `Agendado por: ${agendado_por_nome ?? "—"}`,
        `Meet: ${meetLink}`,
      ].join("\n"),
    );

    return json({ meet_link: meetLink, reuniao_id: reuniao.id });
  } catch (e) {
    console.error("Erro ao criar reunião:", e);
    return json({ erro: e instanceof Error ? e.message : "Erro inesperado" }, 500);
  }
});
