-- Migration 029: Zoho CRM Opportunities Integration
--
-- SECOND REWRITE. Confirmed via direct queries against your live database
-- (not schema guesswork) that raw_zoho_crm_deals ALREADY EXISTS, complete
-- with the right columns, a unique constraint on zoho_deal_id, and
-- opportunities.raw_deal_id already FK'd to it -- all from an earlier
-- migration (likely alongside opportunities itself in migration 003).
-- opportunities.zoho_deal_id is also already unique.
--
-- This means almost everything my first two drafts tried to create
-- already exists. Confirmed via information_schema that NO promotion
-- function or trigger exists yet, and NO trigger fires on
-- raw_zoho_crm_deals -- that part is a genuine, real gap. This migration
-- now only adds what's actually missing:
--   1. sales_owner_mappings (new table, doesn't exist anywhere yet)
--   2. The raw -> validated upsert function (targeting the REAL column
--      names on raw_zoho_crm_deals: account_id_zoho, owner_name only --
--      no owner_id/owner_email columns exist on that table)
--   3. The trigger that fires it automatically
--   4. The unmapped-accounts view for a future CRM tab on MappingPage.tsx
--
-- Do NOT run this if you already ran an earlier version of this file that
-- attempted to CREATE TABLE raw_zoho_crm_opportunities -- check first:
--   select table_name from information_schema.tables where table_name = 'raw_zoho_crm_opportunities';
-- If that returns a row, drop it (it would be an unused duplicate):
--   DROP TABLE IF EXISTS raw_zoho_crm_opportunities;
-- Based on what you've confirmed so far, this table was never actually
-- created, so this is very likely a no-op check, not a required cleanup.

-- ============================================================
-- 1. Sales-owner reconciliation -- opportunities.sales_owner is free
--    text, same shape as customer_source_mappings. Doesn't exist yet
--    anywhere in the schema.
-- ============================================================
CREATE TABLE IF NOT EXISTS sales_owner_mappings (
    id                  BIGSERIAL PRIMARY KEY,
    employee_id         UUID,      -- FK to employees; confirm actual PK type before adding constraint
    source_system       TEXT NOT NULL DEFAULT 'zoho_crm',
    source_owner_id     TEXT NOT NULL,
    source_owner_name   TEXT,
    source_owner_email  TEXT,
    confidence          INT DEFAULT 100,
    created_at          TIMESTAMPTZ DEFAULT now(),
    UNIQUE(source_system, source_owner_id)
);

-- ============================================================
-- 2. Raw -> validated upsert
--    Column names here match raw_zoho_crm_deals EXACTLY as confirmed via
--    information_schema.columns: account_id_zoho (not zoho_account_id),
--    owner_name only (no owner_id/owner_email on this table).
--    weighted_value is a generated column on opportunities -- never
--    written directly, Postgres computes it automatically.
-- ============================================================
CREATE OR REPLACE FUNCTION upsert_opportunity_from_crm(p_raw_id UUID)
RETURNS void AS $$
DECLARE
    r raw_zoho_crm_deals%ROWTYPE;
    v_customer_id UUID;
    v_mapping_status TEXT;
BEGIN
    SELECT * INTO r FROM raw_zoho_crm_deals WHERE id = p_raw_id;
    IF NOT FOUND THEN
        RETURN;
    END IF;

    SELECT customer_id INTO v_customer_id
    FROM customer_source_mappings
    WHERE source_system = 'zoho_crm' AND source_id = r.account_id_zoho
    LIMIT 1;

    v_mapping_status := CASE WHEN v_customer_id IS NOT NULL THEN 'mapped' ELSE 'unmapped' END;
    -- No existing rows/frontend code reference mapping_status today (confirmed),
    -- so 'mapped'/'unmapped' is a safe convention to establish now.

    INSERT INTO opportunities (
        zoho_deal_id, raw_deal_id, customer_id, deal_value, probability,
        expected_close_date, stage, sales_owner, mapping_status, updated_at
    )
    VALUES (
        r.zoho_deal_id, r.id, v_customer_id, r.amount, r.probability,
        r.closing_date, r.stage, r.owner_name, v_mapping_status, now()
    )
    ON CONFLICT (zoho_deal_id) DO UPDATE SET
        raw_deal_id           = EXCLUDED.raw_deal_id,
        customer_id           = COALESCE(EXCLUDED.customer_id, opportunities.customer_id),
        deal_value            = EXCLUDED.deal_value,
        probability           = EXCLUDED.probability,
        expected_close_date   = EXCLUDED.expected_close_date,
        stage                 = EXCLUDED.stage,
        -- sales_owner intentionally NOT overwritten on conflict -- if a sales
        -- head has manually corrected the owner in-app, a resync shouldn't
        -- clobber it. Only the first insert sets it from Zoho.
        mapping_status        = EXCLUDED.mapping_status,
        updated_at            = now();
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 3. Trigger -- fires the upsert automatically whenever
--    zoho_crm_opportunities.py inserts/updates a row in raw_zoho_crm_deals.
--    Confirmed via information_schema.triggers that no trigger currently
--    exists on this table -- this is a genuinely new addition, not a
--    duplicate of anything already there.
-- ============================================================
CREATE OR REPLACE FUNCTION trg_upsert_opportunity_from_crm()
RETURNS trigger AS $$
BEGIN
    PERFORM upsert_opportunity_from_crm(NEW.id);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_raw_zoho_crm_deals_upsert ON raw_zoho_crm_deals;
CREATE TRIGGER trg_raw_zoho_crm_deals_upsert
    AFTER INSERT OR UPDATE ON raw_zoho_crm_deals
    FOR EACH ROW
    EXECUTE FUNCTION trg_upsert_opportunity_from_crm();

-- ============================================================
-- 4. View for unmapped CRM accounts -- same pattern as
--    v_unmapped_zoho_customers, feeds a future "CRM" tab on MappingPage.tsx
-- ============================================================
CREATE OR REPLACE VIEW v_unmapped_zoho_crm_accounts AS
SELECT
    r.account_id_zoho AS zoho_id,
    r.account_name    AS zoho_name,
    count(*)          AS deal_count,
    sum(r.amount)     AS total_value
FROM raw_zoho_crm_deals r
WHERE r.account_id_zoho IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM customer_source_mappings m
    WHERE m.source_system = 'zoho_crm' AND m.source_id = r.account_id_zoho
  )
GROUP BY r.account_id_zoho, r.account_name;
