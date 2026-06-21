// Edge Function chamada pelo PagBank (webhook de notificação de pagamento).
// Deploy com --no-verify-jwt: quem chama é o PagBank, sem o JWT do Supabase —
// a autenticidade é validada pela assinatura no header x-authenticity-token
// (SHA-256 de "{PAGBANK_TOKEN}-{corpo bruto}"), conforme a documentação do
// PagBank (não existe endpoint de confirmação separado, a validação é local).
//
// Variáveis de ambiente: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PAGBANK_TOKEN

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const PAGBANK_TOKEN = Deno.env.get("PAGBANK_TOKEN") ?? "";

const sbAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function sha256Hex(texto: string) {
  const dados = new TextEncoder().encode(texto);
  const hash = await crypto.subtle.digest("SHA-256", dados);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
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
    console.warn("Falha ao notificar executivo por WhatsApp (não bloqueia o webhook):", e);
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const corpoBruto = await req.text();

  if (PAGBANK_TOKEN) {
    const assinaturaRecebida = req.headers.get("x-authenticity-token") ?? "";
    const assinaturaEsperada = await sha256Hex(`${PAGBANK_TOKEN}-${corpoBruto}`);
    if (assinaturaRecebida !== assinaturaEsperada) {
      console.warn("Assinatura do webhook PagBank não confere — descartando notificação.");
      return new Response("Unauthorized", { status: 401 });
    }
  }

  let payload: { id?: string; reference_id?: string; charges?: { status?: string }[] };
  try {
    payload = JSON.parse(corpoBruto);
  } catch {
    return new Response("Payload inválido", { status: 400 });
  }

  const pago = (payload.charges ?? []).some((c) => c.status === "PAID");
  if (!pago) return new Response("OK", { status: 200 }); // outros status (ex.: DECLINED) não fazem nada por enquanto

  try {
    const checkoutId = payload.id ?? payload.reference_id ?? "";
    const { data: pagamento, error } = await sbAdmin
      .from("pagamentos")
      .select("*")
      .eq("pagbank_checkout_id", checkoutId)
      .single();
    if (error || !pagamento) {
      console.warn("Pagamento não encontrado pra checkout:", checkoutId);
      return new Response("OK", { status: 200 });
    }
    if (pagamento.status === "pago") return new Response("OK", { status: 200 }); // idempotente

    await sbAdmin
      .from("pagamentos")
      .update({ status: "pago", pago_em: new Date().toISOString() })
      .eq("id", pagamento.id);

    const valorFormatado = (pagamento.valor_centavos / 100).toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
    });
    await sbAdmin.from("atividades").insert({
      lead_id: pagamento.lead_id,
      tipo: "nota",
      observacao: `Pagamento confirmado: ${valorFormatado}`,
    });

    if (pagamento.criado_por) {
      await notificarExecutivoWhatsApp(
        pagamento.criado_por,
        `💰 Pagamento confirmado — Damião Academy\nValor: ${valorFormatado}\n${pagamento.descricao ?? ""}`,
      );
    }

    return new Response("OK", { status: 200 });
  } catch (e) {
    console.error("Erro ao processar webhook do PagBank:", e);
    return new Response("Erro interno", { status: 500 });
  }
});
