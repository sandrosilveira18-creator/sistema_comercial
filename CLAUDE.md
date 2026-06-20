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
| `comercial/index.html` | **Fonte única do painel interno.** Servido em `damiao.agr.br/comercial` (arquivo físico, sem depender de redirect). Login (Supabase Auth) + abas **Kanban**, **Dashboard** (Chart.js), **Ligações**, **Recuperação** e **Agenda**. Usa `supabase-js`. Tem auto-refresh de 30s. Referencia `logo.jpg` relativo → existe `comercial/logo.jpg`. |
| `painel-comercial.html` | **Não é mais o painel** — virou um redirect (`meta refresh` + `location.replace`) para `/comercial/`, por compatibilidade com links antigos. **Não editar como se fosse o painel**; o painel é `comercial/index.html`. |
| `supabase-setup.sql` | Schema (`leads`, `perfis`, `atividades`, `reunioes`, `integracoes_executivo`), índices, RLS, GRANTs e trigger de perfil automático. Idempotente. |
| `logo.jpg` | Logo. **Deve ficar na mesma pasta** dos HTML (referenciado por `<img src="logo.jpg">`). |
| `_redirects` | Netlify: `/comercial` e `/painel` → `painel-comercial.html` (status 200). |
| `LEIA-ME-setup.md` | Guia de instalação para o cliente (SQL, criar usuário, testar, notificação WhatsApp, agenda + Google Meet). |
| `supabase/functions/notificar-lead/index.ts` | Edge Function chamada por um gatilho de banco (INSERT em `leads`). Envia notificação de texto via WhatsApp (API gratuita do **CallMeBot**) para o dono do negócio a cada lead novo. Segredos (`CALLMEBOT_PHONE`, `CALLMEBOT_APIKEY`, `WEBHOOK_SECRET`) ficam só no Supabase (`supabase secrets set`), nunca no código. |
| `supabase-webhook-whatsapp.sql` | Cria a extensão `pg_net` e o gatilho `AFTER INSERT ON leads` que chama a Edge Function `notificar-lead` via `net.http_post`. Precisa editar `<PROJECT_REF>` e `<WEBHOOK_SECRET>` antes de rodar. Roda no SQL Editor, depois do deploy da função. |
| `supabase/functions/google-oauth-callback/index.ts` | Edge Function (`--no-verify-jwt`) que recebe o redirect do Google após o executivo autorizar o "Conectar Google Agenda", troca o `code` por tokens e grava em `integracoes_executivo` + `perfis.google_conectado`. |
| `supabase/functions/criar-reuniao-meet/index.ts` | Edge Function (JWT normal) chamada pelo painel quando o SDR marca uma reunião: cria o evento com Google Meet na agenda do executivo, grava em `reunioes`/`atividades` e avisa o executivo por WhatsApp (CallMeBot). |
| `supabase/functions/gerenciar-reuniao/index.ts` | Edge Function (JWT normal) que muda o status de uma reunião (`realizada`/`no_show`/`cancelada`); `no_show` move o lead pra `recuperacao`; `cancelada` também remove o evento no Google Agenda. |

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

## Credenciais Google (Agenda/Meet)

- `comercial/index.html` tem `GOOGLE_CLIENT_ID` fixo no `<script>` (não é
  secreto, pode ficar no código) e `GOOGLE_REDIRECT_URI` é **calculado**
  a partir da `SUPABASE_URL` (não precisa configurar à mão).
- `GOOGLE_CLIENT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_REDIRECT_URI` e
  `PAINEL_URL` são **secrets do Supabase** (`supabase secrets set ...`),
  usados pelas 3 Edge Functions de agenda/Meet — nunca no código do painel
  (exceto o `CLIENT_ID`, que não é sensível).
- A credencial OAuth no Google Cloud Console fica em modo **"Teste"**: cada
  executivo precisa ter o e-mail dele adicionado manualmente em **Público-alvo
  → Usuários de teste**, senão recebe `Erro 403: access_denied` ao clicar em
  "Conectar Google Agenda". Voltar pra "Em produção" tira esse bloqueio mas
  passa a mostrar o aviso "app não verificado" pro usuário.
- **CallMeBot tem dois mecanismos diferentes nesse projeto, não confundir:**
  - Notificação de **lead novo** → secrets globais `CALLMEBOT_PHONE`/`CALLMEBOT_APIKEY` (um número só, o do dono do negócio), usados por `notificar-lead`.
  - Notificação de **reunião agendada** → `integracoes_executivo.callmebot_apikey` + `perfis.whatsapp`, um par por executivo (cada um ativa o próprio CallMeBot e cadastra na aba Agenda → Minha conta).

## Banco de dados

- Tabelas: `leads`, `perfis` (id = auth.users.id, `papel` ∈ sdr/executivo/admin),
  `atividades`, `reunioes` (agenda do executivo), `integracoes_executivo`
  (apikey do CallMeBot + tokens Google de cada executivo — nunca exposta a
  outros usuários).
- Para uma tabela funcionar pro app é preciso **GRANT** (privilégio de tabela) **e** **policy RLS**:
  - `anon`: apenas `INSERT`/`SELECT` em `leads`.
  - `authenticated`: leitura geral em `leads`/`atividades`/`reunioes`/`perfis`; `integracoes_executivo` só a própria linha.
  - **DELETE em `leads` é restrito a `executivo`/`admin`** (função `public.meu_papel()`) — SDR não deleta nada, só cria/move/atualiza. Não existe DELETE em `reunioes`; cancelamento é `UPDATE status='cancelada'`.
  - `INSERT` com `BIGSERIAL` exige `GRANT USAGE, SELECT ON ... SEQUENCES`.
- Erro `42501 permission denied for table` = falta GRANT (não é RLS). Erro
  `new row violates row-level security policy` = falta policy.
- **GRANT de tabela e GRANT de sequência são independentes, e cada *role*
  (`anon`/`authenticated`/`service_role`) precisa do seu próprio GRANT** —
  dar `GRANT ALL ON tabela TO service_role` não cobre a sequência do
  `BIGSERIAL`, e dar pra `authenticated` não cobre `service_role`. As Edge
  Functions de agenda/Meet usam `service_role` pra gravar em `leads`,
  `atividades`, `perfis`, `reunioes` e `integracoes_executivo` — todas essas
  têm GRANT explícito pra `service_role` no `supabase-setup.sql` (incluindo
  as sequências `leads_id_seq`, `atividades_id_seq`, `reunioes_id_seq`). Se
  criar uma tabela nova com `BIGSERIAL` que alguma Edge Function vá escrever,
  não esquecer o GRANT da sequência pro `service_role` também.

## Edge Functions

- `criar-reuniao-meet` e `gerenciar-reuniao` são chamadas **direto do navegador**
  (`sb.functions.invoke(...)` no painel) — por isso precisam responder o
  preflight `OPTIONS` e mandar `Access-Control-Allow-Origin`/`Allow-Headers`/
  `Allow-Methods` em **toda** resposta (ver `corsHeaders` no topo de cada
  arquivo). Esquecer isso dá `Failed to send a request to the Edge Function`
  no painel, sem nenhum log do lado do Supabase (o navegador bloqueia antes).
- `google-oauth-callback` (redirect de navegação, não fetch) e `notificar-lead`
  (chamada server-to-server pelo gatilho `pg_net`) **não** precisam de CORS.
- Quando uma Edge Function responde status não-2xx, o `supabase-js` só dá
  `"Edge Function returned a non-2xx status code"` em `error.message` — o
  motivo real fica no corpo JSON da resposta. O painel usa o helper
  `mensagemErroFuncao(error)` (lê `error.context.json().erro`) pra mostrar a
  causa certa no toast; reaproveitar esse helper em qualquer novo
  `sb.functions.invoke(...)` em vez de usar `error.message` direto.
- Depois de editar qualquer `.ts` em `supabase/functions/`, o deploy é manual:
  `supabase functions deploy <nome>` (não sobe com `git push`, ver seção Deploy).

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

`origem` (Instagram, Indicação de alguém, Anúncio, Produtos Damião, ou texto
livre quando "Outro" é escolhido) é só informativo — não entra no cálculo do
score. `parceiro_damiao` (Sim/Não — "Você já é parceiro Damião?") também é só
informativo.

## Deploy

- Hospedado no **Netlify**; domínio **damiao.agr.br** (form na raiz, painel em `/comercial`).
- Deploy contínuo via **Git**: o site Netlify (`luxury-sable-9cce32`) está
  conectado ao repositório do GitHub — basta `git push` na `main` que ele
  publica sozinho. Drag-and-drop manual da pasta é só um fallback (evite
  combinar os dois métodos no mesmo site, já consumiu créditos em dobro antes).
- Netlify usa um pool de **créditos/mês** (plano atual: pago, antes era o
  gratuito de 300/mês). Se aparecer aviso de "implantações desativadas",
  checar **Billing → Usage** antes de mexer no código.
- Após o deploy, testar em aba anônima (cache).
- Edge Functions (`supabase/functions/*`) **não** sobem com o `git push` — precisam
  de `supabase functions deploy <nome>` rodado manualmente sempre que o
  `.ts` da função mudar.

## Aba Ligações (painel) — dois contextos

A aba tem um toggle **Primeiro contato / Recuperação** (`ligContexto`,
botões `.contexto-btn[data-contexto]` — classe própria, não reaproveitar
`.aba`, que tem listener global de troca de tela e quebra se outro elemento
usar essa classe). Cada contexto filtra a lista de leads e as opções de
resultado (`RESULTADOS_POR_CONTEXTO`):

- **Primeiro contato**: só leads `novo`/`contato`. Opções: Não atendeu,
  Número errado, Converteu em reunião.
- **Recuperação**: só leads `recuperacao`. Opções: Não atendeu, Converteu em
  reunião, Não compareceu à reunião, Pediu para retornar depois, Parou de
  responder, Sem interesse.

`RESULTADO_PARA_MOTIVO` mapeia o resultado escolhido pro `motivo_recuperacao`
(quando aplicável) e move o lead pra `recuperacao` automaticamente. "Converteu
em reunião" abre o modal de agendamento em vez de só registrar a ligação; ao
confirmar, a Edge Function `criar-reuniao-meet` move o lead pra `negociacao`
vindo de **qualquer** etapa (exceto se já for `ativo`/`negociacao`).

## Convenções / gotchas

- Status das colunas do Kanban: `novo`, `contato`, `negociacao`, `ativo`, `recuperacao`.
- Ao mover para `ativo`, gravar `fechado_por`, `fechado_por_nome`, `fechado_em`.
- Ao mover para `recuperacao`, gravar `motivo_recuperacao` (um de
  `nao_atendeu`/`no_show`/`retorno`/`sem_resposta`/`sem_interesse`/`outro`,
  ver `MOTIVOS_RECUPERACAO` no painel) e `recuperacao_em`. O motivo é sempre
  escolhido pelo SDR — pelo resultado da ligação (mapeamento automático) ou
  por um seletor manual ao mover o card no Kanban/drawer.
- Agenda do executivo é **horário fixo** pra todo mundo: dias úteis, 9h–18h,
  slots de 1h (constante `HORARIOS_AGENDA` no `<script>` do painel). Reunião
  sempre dura 1h.
- **CSS do `comercial/index.html`**: a regra `body>*:not(.orbes){position:relative}`
  existe pra dar `z-index` aos elementos de topo, mas tem especificidade maior
  que uma classe sozinha (`.drawer{position:fixed}` etc.) e **sobrescreve**
  `position:fixed` se o elemento for filho direto de `<body>`. Por isso o
  seletor já exclui `:not(.drawer):not(.overlay):not(.toast):not(.modal-bg)`.
  Qualquer elemento novo com `position:fixed` direto em `<body>` (overlay,
  toast, modal, drawer) precisa entrar nessa lista de exclusão, senão ele
  renderiza dentro do fluxo normal da página (aparece "lá embaixo" em vez de
  sobreposto na tela).
- O painel **não tem realtime**: só busca dados no load; há botão ↻ para recarregar.
- Criar usuário no Supabase Studio exige marcar **Auto Confirm User**.
- Ao validar JS dos HTML, extrair os `<script>` e checar com `new Function(...)`.
