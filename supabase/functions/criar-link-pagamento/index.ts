// Edge Function chamada pelo painel (sb.functions.invoke) quando o executivo
// gera um link de pagamento pra um lead "ativo". Cria um Checkout no PagBank
// (Pix + boleto + cartão no mesmo link) e grava em "pagamentos"/"atividades".
//
// Mantém a verificação de JWT padrão (só usuário logado no painel pode chamar).
// Variáveis de ambiente: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//   PAGBANK_TOKEN, PAGBANK_API_URL (ex.: https://sandbox.api.pagseguro.com
//   em teste, https://api.pagseguro.com em produção), PAINEL_URL

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const PAGBANK_TOKEN = Deno.env.get("PAGBANK_TOKEN") ?? "";
const PAGBANK_API_URL = Deno.env.get("PAGBANK_API_URL") ?? "https://sandbox.api.pagseguro.com";
const PAINEL_URL = Deno.env.get("PAINEL_URL") ?? "https://damiao.agr.br/comercial/";

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ erro: "Method not allowed" }, 405);

  let body: {
    lead_id?: number;
    valor_centavos?: number;
    descricao?: string;
    criado_por?: string;
    criado_por_nome?: string;
  };
  try {
    body = await req.json();
  } catch {
    return json({ erro: "Payload inválido" }, 400);
  }

  const { lead_id, valor_centavos, descricao, criado_por, criado_por_nome } = body;
  if (!lead_id || !valor_centavos || valor_centavos <= 0 || !criado_por) {
    return json({ erro: "Campos obrigatórios faltando (lead_id, valor_centavos, criado_por)" }, 400);
  }
  if (!PAGBANK_TOKEN) {
    return json({ erro: "PAGBANK_TOKEN não configurado no Supabase" }, 500);
  }

  try {
    const { data: lead, error: erroLead } = await sbAdmin.from("leads").select("*").eq("id", lead_id).single();
    if (erroLead || !lead) return json({ erro: "Lead não encontrado" }, 404);

    const referenceId = `lead-${lead_id}-${Date.now()}`;
    const checkout = {
      reference_id: referenceId,
      customer_modifiable: true,
      items: [
        {
          name: descricao?.trim() || `Venda — ${lead.nome}`,
          quantity: 1,
          unit_amount: valor_centavos,
        },
      ],
      payment_methods: [{ type: "PIX" }, { type: "BOLETO" }, { type: "CREDIT_CARD" }],
      notification_urls: [`${SUPABASE_URL}/functions/v1/pagbank-webhook`],
      redirect_url: PAINEL_URL,
    };

    const respPag = await fetch(`${PAGBANK_API_URL}/checkouts`, {
      method: "POST",
      headers: { Authorization: `Bearer ${PAGBANK_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(checkout),
    });
    const checkoutCriado = await respPag.json();
    if (!respPag.ok) {
      console.error("Erro ao criar checkout no PagBank:", checkoutCriado);
      return json({ erro: "Falha ao criar o link de pagamento no PagBank" }, 502);
    }

    const linkPagamento: string =
      (checkoutCriado.links ?? []).find((l: { rel?: string }) => l.rel === "PAY")?.href ?? "";

    const { data: pagamento, error: erroPagamento } = await sbAdmin
      .from("pagamentos")
      .insert({
        lead_id,
        criado_por,
        criado_por_nome,
        valor_centavos,
        descricao: descricao?.trim() || null,
        pagbank_checkout_id: checkoutCriado.id ?? referenceId,
        link_pagamento: linkPagamento,
        status: "pendente",
      })
      .select()
      .single();
    if (erroPagamento) {
      console.error("Erro ao gravar pagamento:", erroPagamento);
      return json({ erro: "Link criado no PagBank, mas falhou ao salvar no painel" }, 500);
    }

    const valorFormatado = (valor_centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    await sbAdmin.from("atividades").insert({
      lead_id,
      usuario_id: criado_por,
      usuario_nome: criado_por_nome,
      tipo: "nota",
      observacao: `Link de pagamento gerado: ${valorFormatado} — ${linkPagamento}`,
    });

    return json({ link_pagamento: linkPagamento, pagamento_id: pagamento.id });
  } catch (e) {
    console.error("Erro ao criar link de pagamento:", e);
    return json({ erro: e instanceof Error ? e.message : "Erro inesperado" }, 500);
  }
});
