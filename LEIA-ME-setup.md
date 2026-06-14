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

Limitado entre 10 e 100.

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
