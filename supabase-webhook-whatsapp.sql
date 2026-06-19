-- =====================================================================
--  Damião Academy · Notificação WhatsApp a cada lead novo
--  Rode no Supabase Studio › SQL Editor, DEPOIS de já ter feito o deploy
--  da Edge Function `notificar-lead` (veja LEIA-ME-setup.md, seção 6).
--  É idempotente: pode rodar de novo sem quebrar.
--
--  Troque os dois valores abaixo antes de rodar:
--    <PROJECT_REF>      -> o ref do seu projeto Supabase (está na SUPABASE_URL)
--    <WEBHOOK_SECRET>    -> a mesma string usada em `supabase secrets set WEBHOOK_SECRET=...`
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.notificar_lead_whatsapp()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/notificar-lead',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Webhook-Secret', '<WEBHOOK_SECRET>'
    ),
    body := jsonb_build_object('type', 'INSERT', 'table', 'leads', 'record', to_jsonb(NEW))
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_lead_created_notificar_whatsapp ON leads;
CREATE TRIGGER on_lead_created_notificar_whatsapp
  AFTER INSERT ON leads
  FOR EACH ROW EXECUTE FUNCTION public.notificar_lead_whatsapp();

-- =====================================================================
--  PRONTO. Teste enviando o formulário público (index.html) e confira
--  o WhatsApp. Se não chegar, veja Edge Functions → notificar-lead → Logs.
-- =====================================================================
