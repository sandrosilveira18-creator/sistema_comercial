# Damião Academy · CRM Comercial — Guia de instalação

Sistema em 2 telas + banco Supabase:

- **`index.html`** — formulário público que capta leads.
- **`painel-comercial.html`** — painel interno (Kanban, Dashboard, Ligações) com login.
- **`supabase-setup.sql`** — script do banco.
- **`logo.jpg`** — logo usado pelo painel (mantenha na mesma pasta dos HTML).

---

## 1. Rodar o SQL

1. Abra o **Supabase Studio** → projeto → **SQL Editor** → **New query**.
2. Cole **todo** o conteúdo de `supabase-setup.sql` e clique em **Run**.
3. Isso cria/ajusta as tabelas `leads`, `perfis`, `atividades`, ativa o RLS e cria
   um gatilho que gera um perfil automático para cada novo usuário.

> O script é idempotente — pode rodar de novo sem quebrar nada.

---

## 2. Criar o primeiro usuário (login do painel)

O painel usa **Supabase Auth (e-mail + senha)**. Crie o usuário assim:

### Opção A — pelo Studio (mais simples)
1. **Authentication** → **Users** → **Add user** → **Create new user**.
2. Informe **e-mail** e **senha** e marque **Auto Confirm User** (importante: sem isso o login falha por e-mail não confirmado).
3. Clique em **Create user**.

O gatilho do SQL já cria um registro em `perfis` com papel `sdr` e nome a partir do e-mail.

### Definir o papel correto (sdr / executivo / admin)
Vá em **Table Editor → perfis** e edite a linha do usuário:
- ajuste **`nome`** (ex.: `Sandro Silveira`);
- ajuste **`papel`** para `admin`, `executivo` ou `sdr`.

Ou via SQL:

```sql
update perfis
set nome = 'Sandro Silveira', papel = 'admin'
where id = (select id from auth.users where email = 'voce@damiao.agr.br');
```

> Dica: ao criar o usuário pelo Studio você pode preencher **User Metadata**
> com `{"nome":"Sandro Silveira","papel":"admin"}` que o gatilho já usa esses valores.

---

## 3. Testar o fluxo ponta a ponta

1. Abra **`index.html`** no navegador, preencha e envie o formulário.
   - O lead é gravado em `leads` com `status = "novo"` e `score` calculado.
2. Abra **`painel-comercial.html`**, faça login.
3. O lead aparece na coluna **Novo lead** do Kanban. ✔

### Como o score é calculado
Base **50 pts**, e então:

| Fator | Pontos |
|---|---|
| Faturamento "Acima de R$ 80 mil" | +25 |
| Faturamento "R$ 30 mil a R$ 80 mil" | +15 |
| Faturamento "R$ 10 mil a R$ 30 mil" | +8 |
| Desafio "Falta de venda" | +15 |
| Desafio "Falta de lucro" | +12 |
| Desafio "Falta de pessoas qualificadas" | +10 |
| Desafio "Falta de pessoas" | +8 |
| Desafio "Falta de tempo" | +5 |
| Já fez mentoria (programa = "Sim") | −5 |

Limitado entre 10 e 100. No formulário público, **"Maiores desafios" é multi-seleção**:
os pontos de cada desafio marcado são somados (ex.: marcar "Falta de venda" e
"Falta de tempo" soma +15 e +5). O campo "De onde você nos conheceu" (origem) é
só informativo e não entra no score.

---

## 4. Funcionalidades do painel

- **Login/Logout** com sessão persistente; nome e papel do usuário no header.
- **Kanban** — 5 etapas, busca, criar / editar / remover lead (com confirmação),
  mover entre etapas com registro automático de atividade.
- Ao mover para **Cliente ativo**, grava `fechado_por`, `fechado_por_nome`,
  `fechado_em` e o card passa a mostrar **"Fechado por: [Nome]"**.
- **Dashboard** — KPIs, gráfico de linha (vendas/mês, 6 meses), gráfico de
  barras (fechamentos por executivo) e tabela Top 5 leads por score.
- **Ligações** — registro de ligação por SDR (resultado), performance por SDR e
  linha do tempo (histórico) por lead.

---

## 5. Credenciais

As chaves ficam no topo do `<script>` de cada arquivo, no mesmo padrão:

```js
const SUPABASE_URL = "https://SEU-PROJETO.supabase.co";
const SUPABASE_KEY = "SUA_ANON_KEY";
```

> Use sempre a **anon key** (pública). Nunca coloque a `service_role` em arquivos
> que vão para o navegador. O RLS é o que protege os dados.

---

## 6. Notificação por WhatsApp a cada novo lead

Sempre que um lead novo cai (via `index.html`), além de aparecer no painel,
você recebe uma mensagem de texto no seu WhatsApp com o resumo do lead
(nome, contato, empresa, origem, faturamento, desafios e score). Isso é feito
com um **Database Webhook do Supabase** chamando uma **Edge Function**
(`supabase/functions/notificar-lead`), que usa a API gratuita do
**[CallMeBot](https://www.callmebot.com/blog/free-api-whatsapp-messages/)**
para te enviar a mensagem.

### 6.1 Pegar sua apikey do CallMeBot
1. Adicione o contato `+34 694 242 562` no seu WhatsApp (esse número muda de
   tempos em tempos — confirme em [callmebot.com/blog/free-api-whatsapp-messages](https://www.callmebot.com/blog/free-api-whatsapp-messages/) se não funcionar).
2. Envie a esse contato a mensagem exata: `I allow callmebot to send me messages`
3. Aguarde até 2 minutos a resposta automática `API Activated for your phone
   number. Your APIKEY is ...` — ela traz a sua **apikey**.

> **Não chegou a apikey?**
> - Espere os 2 minutos completos; se não vier, espere 24h e tente de novo
>   (o CallMeBot limita tentativas por número).
> - Se você já tinha ativado antes e só perdeu a apikey, envie a frase
>   `Recover APIKey` para o mesmo contato — ele reenvia a chave.
> - Confirme que o WhatsApp do seu celular está ativo/online e que você
>   mandou a mensagem para o número certo (eles trocam o número às vezes).

### 6.2 Instalar a Supabase CLI e logar
```bash
npm install -g supabase
supabase login
supabase link --project-ref SEU-PROJECT-REF
```

### 6.3 Configurar os segredos da função
```bash
supabase secrets set CALLMEBOT_PHONE=55DDXXXXXXXXX
supabase secrets set CALLMEBOT_APIKEY=SUA_APIKEY_DO_CALLMEBOT
supabase secrets set WEBHOOK_SECRET=uma-string-aleatoria-bem-grande
```
- `CALLMEBOT_PHONE` é **o seu número** (quem vai *receber* o alerta), com DDI, só dígitos.
- `WEBHOOK_SECRET` é uma senha inventada por você só para o Supabase "provar" que é
  ele quem está chamando a função (evita que qualquer pessoa na internet dispare
  mensagens pela sua conta do CallMeBot).

### 6.4 Publicar a função
```bash
supabase functions deploy notificar-lead --no-verify-jwt
```
Anote a **URL** que aparece no final do deploy (algo como
`https://SEU-PROJECT-REF.supabase.co/functions/v1/notificar-lead`).

### 6.5 Ligar o gatilho que chama a função
Abra `supabase-webhook-whatsapp.sql`, troque `<PROJECT_REF>` (está na sua
`SUPABASE_URL`) e `<WEBHOOK_SECRET>` (o mesmo valor do passo 6.3), e rode o
arquivo todo no **SQL Editor** do Studio — igual você já fez com
`supabase-setup.sql`. Isso cria um gatilho que dispara a função a cada
`INSERT` em `leads`.

> Alternativa sem SQL: dá pra fazer o mesmo clicando em **Database → Webhooks
> → Create a new webhook** no Studio (table `leads`, evento `Insert`, tipo
> `HTTP Request`, URL do passo 6.4, header `X-Webhook-Secret`). O SQL acima
> faz a mesma coisa, só que de forma versionada e reaplicável.

### 6.6 Testar
Preencha e envie o formulário público (`index.html`). Em poucos segundos a
mensagem deve chegar no seu WhatsApp. Se não chegar, confira os logs da função
em **Edge Functions → notificar-lead → Logs** no Studio.

> CallMeBot é gratuito e pensado para auto-notificação (mandar mensagem **pra
> você mesmo**) — não serve para enviar mensagens a clientes. Se no futuro
> quiser notificar a equipe inteira ou falar com os leads pelo WhatsApp, vale
> migrar para um serviço como Z-API ou a API oficial da Meta.
