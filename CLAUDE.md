# CLAUDE.md

Orientações para o Claude Code ao trabalhar neste repositório.

## Visão geral

CRM comercial **"Damião Academy"** — capta leads por um formulário público e os
gerencia num painel interno (Kanban). Voltado para lanchonetes/hamburguerias.

- **Idioma**: tudo em português brasileiro (UI, comentários, mensagens).
- **Stack**: HTML/CSS/JS **puro**, sem framework, **tudo em arquivo único** por tela.
- **Backend**: Supabase (Auth + REST/PostgREST + Postgres com RLS).
- **Bibliotecas via CDN**: `@supabase/supabase-js@2` e `chart.js@4` (só no painel).
- **Fontes**: Fraunces + Mulish (Google Fonts).
- **Design**: fundo claro com orbes suaves animados, glassmorphism, paleta
  âmbar/caramelo. Mobile-friendly.

## Arquivos

| Arquivo | Papel |
|---|---|
| `index.html` | Formulário público multi-step. Calcula `score` e insere o lead via `fetch` REST como role `anon`. |
| `comercial/index.html` | **Fonte única do painel interno.** Servido em `damiao.agr.br/comercial` (arquivo físico, sem depender de redirect). Login (Supabase Auth) + abas **Kanban**, **Dashboard** (Chart.js), **Ligações**. Usa `supabase-js`. Tem auto-refresh de 30s. Referencia `logo.jpg` relativo → existe `comercial/logo.jpg`. |
| `painel-comercial.html` | **Não é mais o painel** — virou um redirect (`meta refresh` + `location.replace`) para `/comercial/`, por compatibilidade com links antigos. **Não editar como se fosse o painel**; o painel é `comercial/index.html`. |
| `supabase-setup.sql` | Schema (`leads`, `perfis`, `atividades`), índices, RLS, GRANTs e trigger de perfil automático. Idempotente. |
| `logo.jpg` | Logo. **Deve ficar na mesma pasta** dos HTML (referenciado por `<img src="logo.jpg">`). |
| `_redirects` | Netlify: `/comercial` e `/painel` → `painel-comercial.html` (status 200). |
| `LEIA-ME-setup.md` | Guia de instalação para o cliente (SQL, criar usuário, testar, notificação WhatsApp). |
| `supabase/functions/notificar-lead/index.ts` | Edge Function chamada por um gatilho de banco (INSERT em `leads`). Envia notificação de texto via WhatsApp (API gratuita do **CallMeBot**) para o dono do negócio a cada lead novo. Segredos (`CALLMEBOT_PHONE`, `CALLMEBOT_APIKEY`, `WEBHOOK_SECRET`) ficam só no Supabase (`supabase secrets set`), nunca no código. |
| `supabase-webhook-whatsapp.sql` | Cria a extensão `pg_net` e o gatilho `AFTER INSERT ON leads` que chama a Edge Function `notificar-lead` via `net.http_post`. Precisa editar `<PROJECT_REF>` e `<WEBHOOK_SECRET>` antes de rodar. Roda no SQL Editor, depois do deploy da função. |

## Credenciais Supabase

No topo do `<script>` de `index.html` e `comercial/index.html`, **sempre neste padrão**:

```js
const SUPABASE_URL = "https://<ref>.supabase.co";          // a URL
const SUPABASE_KEY = "sb_publishable_...";                  // a publishable key
```

⚠️ **Nunca inverter URL e KEY** (já foi um bug). ⚠️ Usar **apenas a chave
pública** (`anon` legada ou, no projeto atual, a **publishable key**) — nunca a
`service_role`/`secret` em arquivo que vai pro navegador. Quem protege os dados
é o RLS + GRANTs.

> Esse projeto já migrou para o **novo sistema de chaves da Supabase**
> (`sb_publishable_...` / `sb_secret_...`) porque as **chaves legadas (JWT
> `anon`/`service_role`) foram desativadas** no painel do projeto — se elas
> forem reativadas um dia, a JWT antiga volta a funcionar, mas o padrão atual
> é a publishable key. Para ver as chaves do projeto: `supabase projects
> api-keys --project-ref <ref>`.

## Banco de dados

- Tabelas: `leads`, `perfis` (id = auth.users.id, `papel` ∈ sdr/executivo/admin), `atividades`.
- Para uma tabela funcionar pro app é preciso **GRANT** (privilégio de tabela) **e** **policy RLS**:
  - `anon`: apenas `INSERT`/`SELECT` em `leads`.
  - `authenticated`: tudo em `leads`, `atividades`, `perfis` (perfis: edita só o próprio, lê todos).
  - `INSERT` com `BIGSERIAL` exige `GRANT USAGE, SELECT ON ... SEQUENCES`.
- Erro `42501 permission denied for table` = falta GRANT (não é RLS). Erro
  `new row violates row-level security policy` = falta policy.

## Cálculo de score (mantém index.html e painel em sincronia)

Base **50**; faturamento "Acima de R$ 80 mil" +25, "R$ 30 mil a R$ 80 mil" +15,
"R$ 10 mil a R$ 30 mil" +8; já fez mentoria −5. Limitado a [10, 100].

`desafio` é **multi-seleção** no formulário público (vários valores separados por
`", "` num único campo TEXT, ex.: `"Falta de venda, Falta de tempo"`). O score
soma os pontos de **cada** desafio marcado: venda +15, lucro +12, pessoas
qualificadas +10, pessoas +8, tempo +5. No painel (`comercial/index.html`), a
criação/edição manual de lead ainda usa um `<select>` de desafio único, e a
função `calcularScore` de lá compara `d.desafio` com um valor só (não soma
múltiplos) — está OK porque esse formulário manual nunca produz mais de um
desafio. Se algum dia o `<select>` virar multi-escolha, essa função precisa
ser ajustada para somar como o `index.html` faz.

`origem` (Instagram, Indicação, Google, Facebook/Anúncio, Outro) é só
informativo — não entra no cálculo do score.

## Deploy

- Hospedado no **Netlify**; domínio **damiao.agr.br** (form na raiz, painel em `/comercial`).
- Deploy por **drag-and-drop da pasta inteira** no site correto (o que tem o domínio).
- Após editar HTML, lembrar que o deploy precisa ser refeito; testar em aba anônima (cache).

## Convenções / gotchas

- Status das colunas do Kanban: `novo`, `contato`, `negociacao`, `ativo`, `recuperacao`.
- Ao mover para `ativo`, gravar `fechado_por`, `fechado_por_nome`, `fechado_em`.
- O painel **não tem realtime**: só busca dados no load; há botão ↻ para recarregar.
- Criar usuário no Supabase Studio exige marcar **Auto Confirm User**.
- Ao validar JS dos HTML, extrair os `<script>` e checar com `new Function(...)`.
