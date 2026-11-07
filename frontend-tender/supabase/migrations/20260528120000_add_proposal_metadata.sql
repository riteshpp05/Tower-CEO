-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: add metadata JSONB column to proposals
--
-- Stores all rich wizard fields that don't have dedicated columns:
-- scope details (projectType, implementationModel, clientPainPoints, etc.),
-- risk & constraints, commercial detail, and internal notes.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.proposals
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.proposals.metadata IS
  'Rich New Proposal wizard data: scope, risk, commercial detail, internal notes. '
  'Populated from ProposalMetadata in mockData.ts.';
