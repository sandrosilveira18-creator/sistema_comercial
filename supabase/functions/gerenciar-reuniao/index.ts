// Edge Function chamada pelo painel para mudar o status de uma reunião já
// agendada: marcar como realizada, não compareceu (no_show) ou cancelada.
// "no_show" e "cancelada" sempre jogam o lead pra recuperação (com motivos
// diferentes); "cancelada" também remove o evento no Google Agenda.
// "realizada" não move o lead aqui — o painel pergunta na hora se fechou
// venda (ativo) ou não (recuperação, com seletor de motivo).
// Mantém a verificação de JWT padrão (só usuário logado no painel pode chamar).
// Não existe ação de exclusão real — SDR não deleta nada, isso é sempre UPDATE.

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
  const { data: integ } = await sbAdmin
    .from("integracoes_executivo")
    .select("*")
    .eq("usuario_id", executivoId)
    .single();
  if (!integ?.google_refresh_token) return null;

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
  if (!resp.ok) return null;

  const expiraEm = new Date(Date.now() + (tok.expires_in ?? 3600) * 1000).toISOString();
  await sbAdmin
    .from("integracoes_executivo")
    .update({ google_access_token: tok.access_token, google_token_expira: expiraEm, atualizado_em: new Date().toISOString() })
    .eq("usuario_id", executivoId);

  return tok.access_token as string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ erro: "Method not allowed" }, 405);

  let body: { reuniao_id?: number; acao?: string };
  try {
    body = await req.json();
  } catch {
    return json({ erro: "Payload inválido" }, 400);
  }

  const { reuniao_id, acao } = body;
  if (!reuniao_id || !["realizada", "no_show", "cancelada"].includes(acao ?? "")) {
    return json({ erro: "Campos inválidos" }, 400);
  }

  const { data: reuniao, error: erroReuniao } = await sbAdmin
    .from("reunioes")
    .select("*")
    .eq("id", reuniao_id)
    .single();
  if (erroReuniao || !reuniao) return json({ erro: "Reunião não encontrada" }, 404);

  if (acao === "cancelada" && reuniao.google_event_id) {
    try {
      const accessToken = await obterAccessTokenValido(reuniao.executivo_id);
      if (accessToken) {
        await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/primary/events/${reuniao.google_event_id}`,
          { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } },
        );
      }
    } catch (e) {
      console.warn("Falha ao remover evento no Google Agenda (segue cancelando no painel):", e);
    }
  }

  const { error: erroUpdate } = await sbAdmin.from("reunioes").update({ status: acao }).eq("id", reuniao_id);
  if (erroUpdate) return json({ erro: "Falha ao atualizar reunião" }, 500);

  if (acao === "no_show" || acao === "cancelada") {
    const motivo = acao === "no_show" ? "no_show" : "cancelou";
    const observacao =
      acao === "no_show"
        ? "Cliente não compareceu à reunião agendada — movido para recuperação."
        : "Reunião cancelada — movido para recuperação.";
    await sbAdmin
      .from("leads")
      .update({ status: "recuperacao", motivo_recuperacao: motivo, recuperacao_em: new Date().toISOString() })
      .eq("id", reuniao.lead_id);
    await sbAdmin.from("atividades").insert({ lead_id: reuniao.lead_id, tipo: "nota", observacao });
  }

  // "realizada" não decide nada aqui — o painel pergunta na hora se fechou
  // venda (vira "ativo") ou não (abre o seletor de motivo de recuperação).
  return json({ ok: true });
});
