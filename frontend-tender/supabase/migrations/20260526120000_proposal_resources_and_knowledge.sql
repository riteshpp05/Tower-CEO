-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: proposal_resources + knowledge_items persistent tables
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. proposal_resources ─────────────────────────────────────────────────────
-- Stores the resource plan (selected roles + hours) for each proposal.
-- One row per role per proposal.

CREATE TABLE IF NOT EXISTS public.proposal_resources (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id      text  NOT NULL REFERENCES public.proposals(id) ON DELETE CASCADE,
  role_id          text  NOT NULL,           -- maps to RateCard.id (e.g. 'RC-001')
  role             text  NOT NULL,           -- display name (e.g. 'SAP Solution Architect')
  hours            numeric(10,2) NOT NULL DEFAULT 0,
  billing_rate     numeric(10,2) NOT NULL,
  cost_rate        numeric(10,2) NOT NULL,
  loaded_cost_rate numeric(10,2) NOT NULL,
  location_type    text  NOT NULL,           -- Offshore | Onsite | Hybrid
  geography        text  NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- Index for fast look-ups by proposal
CREATE INDEX IF NOT EXISTS idx_proposal_resources_proposal_id
  ON public.proposal_resources(proposal_id);

-- Trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_proposal_resources_updated_at ON public.proposal_resources;
CREATE TRIGGER trg_proposal_resources_updated_at
  BEFORE UPDATE ON public.proposal_resources
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 2. knowledge_items ────────────────────────────────────────────────────────
-- Persists the Knowledge Base items (currently in-memory mock only).

CREATE TABLE IF NOT EXISTS public.knowledge_items (
  id               text PRIMARY KEY,         -- e.g. 'KB-001'
  title            text NOT NULL,
  type             text NOT NULL,
  lob              text NOT NULL,
  industry         text NOT NULL,
  geography        text NOT NULL,
  modules          text[] NOT NULL DEFAULT '{}',
  version          text NOT NULL DEFAULT '1.0',
  approval_status  text NOT NULL DEFAULT 'Draft'
    CHECK (approval_status IN ('Approved','Draft','Under Review','Pending','Archived')),
  owner            text NOT NULL,
  upload_date      text NOT NULL,
  last_updated     text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_knowledge_items_updated_at ON public.knowledge_items;
CREATE TRIGGER trg_knowledge_items_updated_at
  BEFORE UPDATE ON public.knowledge_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 3. Row Level Security ─────────────────────────────────────────────────────
-- Enable RLS on both tables. Only authenticated users can read/write.

ALTER TABLE public.proposal_resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_items     ENABLE ROW LEVEL SECURITY;

-- proposal_resources: authenticated users can read all; only owners can insert/update/delete
CREATE POLICY "proposal_resources_select" ON public.proposal_resources
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "proposal_resources_insert" ON public.proposal_resources
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "proposal_resources_update" ON public.proposal_resources
  FOR UPDATE TO authenticated USING (true);

CREATE POLICY "proposal_resources_delete" ON public.proposal_resources
  FOR DELETE TO authenticated USING (true);

-- knowledge_items: authenticated users can read; admins can write
CREATE POLICY "knowledge_items_select" ON public.knowledge_items
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "knowledge_items_all" ON public.knowledge_items
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── 4. Helpful comments ────────────────────────────────────────────────────────
COMMENT ON TABLE public.proposal_resources IS
  'Resource plan (selected roles + hours) for each proposal. Populated from Step 3 of the New Proposal wizard.';

COMMENT ON TABLE public.knowledge_items IS
  'Knowledge Base items — case studies, methodologies, credentials, rate cards etc.';
