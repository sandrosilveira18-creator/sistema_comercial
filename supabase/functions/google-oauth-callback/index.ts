// Edge Function chamada pelo redirect do Google após o executivo autorizar o
// acesso à própria Google Agenda (fluxo OAuth "Conectar Google" do painel).
// Deploy com --no-verify-jwt: quem chama é o navegador vindo do Google, sem o
// JWT do Supabase — a validação de quem é o usuário vem do parâmetro `state`.
//
// Variáveis de ambiente necessárias (configurar com `supabase secrets set`):
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI
//   PAINEL_URL          -> ex.: https://damiao.agr.br/comercial/
// Mais as variáveis padrão do projeto: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID") ?? "";
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "";
const GOOGLE_REDIRECT_URI = Deno.env.get("GOOGLE_REDIRECT_URI") ?? "";
const PAINEL_URL = Deno.env.get("PAINEL_URL") ?? "https://damiao.agr.br/comercial/";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const sbAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function redirectComErro(motivo: string) {
  const url = `${PAINEL_URL}?google=erro&motivo=${encodeURIComponent(motivo)}`;
  return new Response(null, { status: 302, headers: { Location: url } });
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const usuarioId = url.searchParams.get("state");
  const erroGoogle = url.searchParams.get("error");

  if (erroGoogle) return redirectComErro(erroGoogle);
  if (!code || !usuarioId) return redirectComErro("parametros_invalidos");

  try {
    const resp = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: GOOGLE_REDIRECT_URI,
        grant_type: "authorization_code",
      }),
    });
    const tokens = await resp.json();
    if (!resp.ok || !tokens.refresh_token) {
      console.error("Falha ao trocar code por token:", tokens);
      return redirectComErro("token_invalido");
    }

    const expiraEm = new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000).toISOString();

    const { error: erroIntegracao } = await sbAdmin.from("integracoes_executivo").upsert({
      usuario_id: usuarioId,
      google_refresh_token: tokens.refresh_token,
      google_access_token: tokens.access_token,
      google_token_expira: expiraEm,
      atualizado_em: new Date().toISOString(),
    });
    if (erroIntegracao) {
      console.error("Erro ao salvar integração:", erroIntegracao);
      return redirectComErro("falha_ao_salvar");
    }

    const { error: erroPerfil } = await sbAdmin
      .from("perfis")
      .update({ google_conectado: true })
      .eq("id", usuarioId);
    if (erroPerfil) console.error("Erro ao marcar google_conectado:", erroPerfil);

    return new Response(null, { status: 302, headers: { Location: `${PAINEL_URL}?google=ok` } });
  } catch (e) {
    console.error("Erro no callback do Google OAuth:", e);
    return redirectComErro("erro_inesperado");
  }
});
