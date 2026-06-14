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

-- ───────────────────────────────────────────────
-- 2. Perfis de usuário (nome + papel)
-- ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS perfis (
  id        UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nome      TEXT NOT NULL,
  papel     TEXT NOT NULL CHECK (papel IN ('sdr','executivo','admin')),
  criado_em TIMESTAMPTZ DEFAULT NOW()
);

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

-- =====================================================================
--  4. RLS (Row Level Security)
-- =====================================================================

-- ── LEADS ────────────────────────────────────────
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon pode inserir leads"        ON leads;
DROP POLICY IF EXISTS "autenticados podem tudo em leads" ON leads;

-- formulário público (index.html) insere sem login:
CREATE POLICY "anon pode inserir leads"
  ON leads FOR INSERT TO anon WITH CHECK (true);

-- painel comercial (logado) lê/edita/remove tudo:
CREATE POLICY "autenticados podem tudo em leads"
  ON leads FOR ALL TO authenticated USING (true) WITH CHECK (true);

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
