// Edge Function chamada pelo Database Webhook do Supabase (INSERT em "leads").
// Envia uma notificação de texto via WhatsApp (CallMeBot) para o número do dono do negócio.
// Variáveis de ambiente necessárias (configurar com `supabase secrets set`):
//   CALLMEBOT_PHONE   -> número do CallMeBot, com DDI (ex.: 5511999999999)
//   CALLMEBOT_APIKEY  -> apikey recebida do CallMeBot
//   WEBHOOK_SECRET    -> string aleatória, deve bater com o header X-Webhook-Secret configurado no webhook

const CALLMEBOT_PHONE = Deno.env.get("CALLMEBOT_PHONE");
const CALLMEBOT_APIKEY = Deno.env.get("CALLMEBOT_APIKEY");
const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET");

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  if (WEBHOOK_SECRET && req.headers.get("x-webhook-secret") !== WEBHOOK_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  if (!CALLMEBOT_PHONE || !CALLMEBOT_APIKEY) {
    console.error("CALLMEBOT_PHONE ou CALLMEBOT_APIKEY não configurados.");
    return new Response("Missing CallMeBot config", { status: 500 });
  }

  let payload: { record?: Record<string, unknown> };
  try {
    payload = await req.json();
  } catch {
    return new Response("Payload inválido", { status: 400 });
  }

  const lead = payload.record;
  if (!lead) {
    return new Response("Sem registro no payload", { status: 400 });
  }

  const texto = [
    "🔔 Novo lead — Damião Academy",
    `Nome: ${lead.nome ?? "—"}`,
    `WhatsApp: ${lead.whatsapp ?? "—"}`,
    `Negócio: ${lead.empresa ?? "—"}`,
    `Como conheceu: ${lead.origem ?? "—"}`,
    `Faturamento: ${lead.faturamento ?? "—"}`,
    `Já fez mentoria: ${lead.programa_aceleracao ?? "—"}`,
    `Desafios: ${lead.desafio ?? "—"}`,
    `Score: ${lead.score ?? "—"}`,
  ].join("\n");

  const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(CALLMEBOT_PHONE)}&text=${encodeURIComponent(texto)}&apikey=${encodeURIComponent(CALLMEBOT_APIKEY)}`;

  try {
    const resp = await fetch(url);
    const corpo = await resp.text();
    if (!resp.ok) {
      console.error("CallMeBot respondeu erro:", resp.status, corpo);
      return new Response("Falha ao enviar WhatsApp", { status: 502 });
    }
    return new Response("OK", { status: 200 });
  } catch (e) {
    console.error("Erro ao chamar CallMeBot:", e);
    return new Response("Erro ao enviar WhatsApp", { status: 500 });
  }
});
