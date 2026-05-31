-- ============================================================
-- Multi-tenant — Fases 2 e 3 (backfill + constraints)
-- Rodar no Supabase SQL Editor APÓS o deploy que adiciona as
-- colunas tenant_id (Fase 1, synchronize adiciona automaticamente).
--
-- Tenant atual (único): Wendel da Cabelô
-- whatsapp_config.id = 2c562828-0fe9-43c8-bad0-77a931968afc
-- ============================================================

-- ---------- FASE 2: BACKFILL ----------
-- Associa todos os dados existentes ao tenant atual.

UPDATE leads        SET tenant_id = '2c562828-0fe9-43c8-bad0-77a931968afc' WHERE tenant_id IS NULL;
UPDATE campaigns     SET tenant_id = '2c562828-0fe9-43c8-bad0-77a931968afc' WHERE tenant_id IS NULL;
UPDATE media_files   SET tenant_id = '2c562828-0fe9-43c8-bad0-77a931968afc' WHERE tenant_id IS NULL;
UPDATE deleted_leads SET tenant_id = '2c562828-0fe9-43c8-bad0-77a931968afc' WHERE tenant_id IS NULL;
UPDATE appointments  SET tenant_id = '2c562828-0fe9-43c8-bad0-77a931968afc' WHERE tenant_id IS NULL;

-- Verificação: nenhuma linha deve sobrar com tenant_id NULL
-- SELECT 'leads' tbl, count(*) FROM leads WHERE tenant_id IS NULL
-- UNION ALL SELECT 'campaigns', count(*) FROM campaigns WHERE tenant_id IS NULL
-- UNION ALL SELECT 'media_files', count(*) FROM media_files WHERE tenant_id IS NULL
-- UNION ALL SELECT 'deleted_leads', count(*) FROM deleted_leads WHERE tenant_id IS NULL;

-- ---------- FASE 3: CONSTRAINTS ----------
-- ⚠️ Rodar SOMENTE após confirmar que o backfill acima não deixou NULLs.

-- 1) leads.phone: de unique global → unique composto (tenant_id, phone)
--    Descobre o nome da constraint atual antes de dropar:
--    SELECT conname FROM pg_constraint WHERE conrelid = 'leads'::regclass AND contype = 'u';
ALTER TABLE leads DROP CONSTRAINT IF EXISTS "UQ_leads_phone";  -- ajuste o nome conforme o SELECT acima
ALTER TABLE leads DROP CONSTRAINT IF EXISTS "leads_phone_key";
CREATE UNIQUE INDEX IF NOT EXISTS "UQ_leads_tenant_phone" ON leads (tenant_id, phone);

-- 2) media_files.name: de unique global → unique composto (tenant_id, name)
ALTER TABLE media_files DROP CONSTRAINT IF EXISTS "UQ_media_files_name";
ALTER TABLE media_files DROP CONSTRAINT IF EXISTS "media_files_name_key";
CREATE UNIQUE INDEX IF NOT EXISTS "UQ_media_files_tenant_name" ON media_files (tenant_id, name);

-- 3) NOT NULL (depois que tudo está preenchido e as constraints novas existem)
ALTER TABLE leads        ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE campaigns     ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE media_files   ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE deleted_leads ALTER COLUMN tenant_id SET NOT NULL;
-- appointments pode ficar nullable (agendamentos avulsos sem tenant), mas indexamos:

-- Índices auxiliares para performance das queries por tenant
CREATE INDEX IF NOT EXISTS "IDX_leads_tenant"        ON leads (tenant_id);
CREATE INDEX IF NOT EXISTS "IDX_campaigns_tenant"     ON campaigns (tenant_id);
CREATE INDEX IF NOT EXISTS "IDX_media_files_tenant"   ON media_files (tenant_id);
CREATE INDEX IF NOT EXISTS "IDX_deleted_leads_tenant" ON deleted_leads (tenant_id);
CREATE INDEX IF NOT EXISTS "IDX_appointments_tenant"  ON appointments (tenant_id);
