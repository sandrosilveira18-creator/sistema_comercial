-- =====================================================================
--  Damião Academy · CRM Comercial — Setup do banco (Supabase)
--  Rode TUDO de uma vez no Supabase Studio › SQL Editor › New query.
--  É idempotente: pode rodar mais de uma vez sem quebrar.
-- =====================================================================

-- ───────────────────────────────────────────────
-- 0. Tabela leads (caso ainda não exista)
--    Se ela já existe, este bloco é ignorado e os
--    ALTERs abaixo apenas completam as colunas.
-- ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS leads (
  id                  BIGSERIAL PRIMARY KEY,
  nome                TEXT NOT NULL,
  whatsapp            TEXT,
  empresa             TEXT,
  faturamento         TEXT,
  programa_aceleracao TEXT,
  desafio             TEXT,
  score               INT DEFAULT 50,
  status              TEXT DEFAULT 'novo',
  criado_em           TIMESTAMPTZ DEFAULT NOW()
);

-- ───────────────────────────────────────────────
-- 1. Colunas extras de "fechamento" na tabela leads
-- ───────────────────────────────────────────────
ALTER TABLE leads ADD COLUMN IF NOT EXISTS fechado_por      UUID REFERENCES auth.users(id);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS fechado_por_nome TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS fechado_em       TIMESTAMPTZ;

-- origem do lead (Instagram, Indicação, Anúncio, Produtos Damião, ou texto livre quando "Outro") — captada no formulário público
ALTER TABLE leads ADD COLUMN IF NOT EXISTS origem TEXT;
-- nota: "desafio" agora pode conter múltiplos valores separados por ", " (ex.: "Falta de venda, Falta de tempo")

-- se o lead já é parceiro Damião (Sim/Não) — captado no formulário público
ALTER TABLE leads ADD COLUMN IF NOT EXISTS parceiro_damiao TEXT;

-- motivo/tempo de quando o lead entra em "Em recuperação" (definido pelo SDR)
ALTER TABLE leads ADD COLUMN IF NOT EXISTS motivo_recuperacao TEXT
  CHECK (motivo_recuperacao IN ('nao_atendeu','no_show','retorno','sem_resposta','sem_interesse','outro'));
ALTER TABLE leads ADD COLUMN IF NOT EXISTS recuperacao_em TIMESTAMPTZ;

-- ───────────────────────────────────────────────
-- 2. Perfis de usuário (nome + papel)
-- ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS perfis (
  id        UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nome      TEXT NOT NULL,
  papel     TEXT NOT NULL CHECK (papel IN ('sdr','executivo','admin')),
  criado_em TIMESTAMPTZ DEFAULT NOW()
);

-- WhatsApp do usuário (usado pra notificar o executivo de reuniões marcadas) e
-- flag não-sensível indicando se o executivo já conectou a conta Google (Agenda/Meet)
ALTER TABLE perfis ADD COLUMN IF NOT EXISTS whatsapp TEXT;
ALTER TABLE perfis ADD COLUMN IF NOT EXISTS google_conectado BOOLEAN DEFAULT false;

-- ───────────────────────────────────────────────
-- 3. Atividades (ligações + mudanças de etapa + notas)
-- ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS atividades (
  id             BIGSERIAL PRIMARY KEY,
  lead_id        BIGINT REFERENCES leads(id) ON DELETE CASCADE,
  usuario_id     UUID REFERENCES auth.users(id),
  usuario_nome   TEXT,
  tipo           TEXT NOT NULL CHECK (tipo IN ('ligacao','mudanca_etapa','nota','reuniao')),
  resultado      TEXT,
  observacao     TEXT,
  etapa_anterior TEXT,
  etapa_nova     TEXT,
  criado_em      TIMESTAMPTZ DEFAULT NOW()
);

-- índices úteis
CREATE INDEX IF NOT EXISTS idx_atividades_lead ON atividades(lead_id);
CREATE INDEX IF NOT EXISTS idx_leads_status    ON leads(status);

-- ───────────────────────────────────────────────
-- 3b. Reuniões (agenda do executivo/closer)
-- ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reunioes (
  id                BIGSERIAL PRIMARY KEY,
  lead_id           BIGINT REFERENCES leads(id) ON DELETE CASCADE,
  executivo_id      UUID REFERENCES auth.users(id),
  executivo_nome    TEXT,
  agendado_por      UUID REFERENCES auth.users(id),
  agendado_por_nome TEXT,
  inicio            TIMESTAMPTZ NOT NULL,
  fim               TIMESTAMPTZ NOT NULL,
  status            TEXT NOT NULL DEFAULT 'agendada'
                      CHECK (status IN ('agendada','realizada','no_show','cancelada')),
  meet_link         TEXT,
  google_event_id   TEXT,
  criado_em         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reunioes_executivo ON reunioes(executivo_id);
CREATE INDEX IF NOT EXISTS idx_reunioes_inicio    ON reunioes(inicio);
CREATE INDEX IF NOT EXISTS idx_reunioes_lead       ON reunioes(lead_id);

-- ───────────────────────────────────────────────
-- 3c. Integrações do executivo (CallMeBot + tokens Google)
--     Nunca exposta a outros usuários — só a própria linha (RLS) e as
--     Edge Functions (service_role, que ignora RLS).
-- ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS integracoes_executivo (
  usuario_id           UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  callmebot_apikey     TEXT,
  google_refresh_token TEXT,
  google_access_token  TEXT,
  google_token_expira  TIMESTAMPTZ,
  atualizado_em        TIMESTAMPTZ DEFAULT NOW()
);

-- ───────────────────────────────────────────────
-- 3d. Pagamentos (link de pagamento PagBank ao fechar a venda)
-- ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pagamentos (
  id                  BIGSERIAL PRIMARY KEY,
  lead_id             BIGINT REFERENCES leads(id) ON DELETE CASCADE,
  criado_por          UUID REFERENCES auth.users(id),
  criado_por_nome     TEXT,
  valor_centavos      INT NOT NULL,
  descricao           TEXT,
  pagbank_checkout_id TEXT,
  link_pagamento      TEXT,
  status              TEXT NOT NULL DEFAULT 'pendente'
                        CHECK (status IN ('pendente','pago','expirado','cancelado')),
  pago_em             TIMESTAMPTZ,
  criado_em           TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pagamentos_lead       ON pagamentos(lead_id);
CREATE INDEX IF NOT EXISTS idx_pagamentos_checkout   ON pagamentos(pagbank_checkout_id);

-- =====================================================================
--  4. RLS (Row Level Security)
-- =====================================================================

-- função auxiliar: papel do usuário logado (usada nas policies de DELETE,
-- já que SDR não tem permissão de remover nada, só criar/mover/atualizar)
CREATE OR REPLACE FUNCTION public.meu_papel()
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT papel FROM perfis WHERE id = auth.uid();
$$;

-- ── LEADS ────────────────────────────────────────
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon pode inserir leads"          ON leads;
DROP POLICY IF EXISTS "autenticados podem tudo em leads" ON leads;
DROP POLICY IF EXISTS "autenticados leem/criam/editam leads" ON leads;
DROP POLICY IF EXISTS "executivo/admin removem leads"    ON leads;

-- formulário público (index.html) insere sem login:
CREATE POLICY "anon pode inserir leads"
  ON leads FOR INSERT TO anon WITH CHECK (true);

-- painel comercial (logado): qualquer papel lê/cria/edita —
-- mover etapas, registrar score etc. é tarefa do dia a dia do SDR.
CREATE POLICY "autenticados leem/criam/editam leads"
  ON leads FOR SELECT TO authenticated USING (true);
CREATE POLICY "autenticados inserem leads"
  ON leads FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "autenticados atualizam leads"
  ON leads FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- remover lead é restrito: SDR não deleta nada, só executivo/admin.
CREATE POLICY "executivo/admin removem leads"
  ON leads FOR DELETE TO authenticated USING (public.meu_papel() IN ('executivo','admin'));

-- ── PERFIS ───────────────────────────────────────
ALTER TABLE perfis ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "usuarios gerenciam proprio perfil" ON perfis;
DROP POLICY IF EXISTS "autenticados leem perfis"          ON perfis;

-- cada usuário cria/edita o próprio perfil:
CREATE POLICY "usuarios gerenciam proprio perfil"
  ON perfis FOR ALL TO authenticated
  USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- qualquer logado pode LER perfis (para exibir nomes no painel):
CREATE POLICY "autenticados leem perfis"
  ON perfis FOR SELECT TO authenticated USING (true);

-- ── ATIVIDADES ───────────────────────────────────
ALTER TABLE atividades ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "autenticados podem tudo em atividades" ON atividades;

CREATE POLICY "autenticados podem tudo em atividades"
  ON atividades FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── REUNIÕES ─────────────────────────────────────
ALTER TABLE reunioes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "autenticados leem reunioes"   ON reunioes;
DROP POLICY IF EXISTS "autenticados criam reunioes"  ON reunioes;
DROP POLICY IF EXISTS "autenticados atualizam reunioes" ON reunioes;

-- sem policy de DELETE de propósito: cancelamento é UPDATE status='cancelada'
-- (SDR não deleta nada, nem reunião).
CREATE POLICY "autenticados leem reunioes"
  ON reunioes FOR SELECT TO authenticated USING (true);
CREATE POLICY "autenticados criam reunioes"
  ON reunioes FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "autenticados atualizam reunioes"
  ON reunioes FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- ── INTEGRAÇÕES DO EXECUTIVO ─────────────────────
ALTER TABLE integracoes_executivo ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "usuario gerencia propria integracao" ON integracoes_executivo;

-- cada usuário só vê/edita a própria linha (apikey do CallMeBot, tokens Google).
-- Edge Functions usam a service_role key e ignoram RLS, então conseguem ler
-- a integração de qualquer executivo normalmente.
CREATE POLICY "usuario gerencia propria integracao"
  ON integracoes_executivo FOR ALL TO authenticated
  USING (auth.uid() = usuario_id) WITH CHECK (auth.uid() = usuario_id);

-- ── PAGAMENTOS ───────────────────────────────────
ALTER TABLE pagamentos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "autenticados leem pagamentos"      ON pagamentos;
DROP POLICY IF EXISTS "autenticados criam pagamentos"     ON pagamentos;
DROP POLICY IF EXISTS "autenticados atualizam pagamentos" ON pagamentos;

-- sem policy de DELETE de propósito: pagamento nunca é removido, só fica
-- como histórico (pendente/pago/expirado/cancelado).
CREATE POLICY "autenticados leem pagamentos"
  ON pagamentos FOR SELECT TO authenticated USING (true);
CREATE POLICY "autenticados criam pagamentos"
  ON pagamentos FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "autenticados atualizam pagamentos"
  ON pagamentos FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- ── GRANTs das tabelas novas ──────────────────────
-- RLS sozinho não basta: sem GRANT, qualquer acesso (até o do service_role
-- nas Edge Functions) dá "42501 permission denied for table".
GRANT SELECT, INSERT, UPDATE ON reunioes TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE reunioes_id_seq TO authenticated;
GRANT ALL ON reunioes TO service_role;
GRANT USAGE, SELECT ON SEQUENCE reunioes_id_seq TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON integracoes_executivo TO authenticated;
GRANT ALL ON integracoes_executivo TO service_role;

GRANT SELECT, INSERT, UPDATE ON pagamentos TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE pagamentos_id_seq TO authenticated;
GRANT ALL ON pagamentos TO service_role;
GRANT USAGE, SELECT ON SEQUENCE pagamentos_id_seq TO service_role;

-- as Edge Functions (google-oauth-callback, criar-reuniao-meet, gerenciar-reuniao)
-- usam a service_role key pra ler/gravar leads, atividades e perfis também —
-- sem isso, dá o mesmo "42501 permission denied" só que mais difícil de notar
-- (o erro é só logado, não interrompe o fluxo principal da função).
GRANT ALL ON perfis TO service_role;
GRANT ALL ON leads TO service_role;
GRANT ALL ON atividades TO service_role;
GRANT USAGE, SELECT ON SEQUENCE leads_id_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE atividades_id_seq TO service_role;

-- =====================================================================
--  5. (Opcional) Trigger para criar perfil automático ao criar usuário
--     Cria um perfil com papel 'sdr' e nome a partir do e-mail.
--     Ajuste o papel depois pela tabela perfis.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.perfis (id, nome, papel)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'nome', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'papel', 'sdr')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =====================================================================
--  PRONTO. Próximo passo: criar o primeiro usuário (ver instruções).
-- =====================================================================
