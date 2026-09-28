-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: app_config key-value table
--
-- Stores runtime config the front-end needs to read, notably the current
-- Cloudflare quick-tunnel URL (which changes every time the host PC restarts).
-- The host writes 'llm_tunnel_url'; the app reads it on load so it never needs
-- a rebuild/redeploy when the tunnel URL changes.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.app_config (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.app_config IS 'Runtime key-value config read by the front-end (e.g. live LLM tunnel URL).';

ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;

-- Anyone (anon included — app uses mock auth) can READ config
DROP POLICY IF EXISTS "Anyone can read app_config" ON public.app_config;
CREATE POLICY "Anyone can read app_config"
  ON public.app_config FOR SELECT
  TO anon, authenticated
  USING (true);

-- Anyone can UPSERT config (the host script writes the tunnel URL).
-- If you later lock this down, use a service-role key in the host script instead.
DROP POLICY IF EXISTS "Anyone can write app_config" ON public.app_config;
CREATE POLICY "Anyone can write app_config"
  ON public.app_config FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "Anyone can update app_config" ON public.app_config;
CREATE POLICY "Anyone can update app_config"
  ON public.app_config FOR UPDATE
  TO anon, authenticated
  USING (true);

-- Seed the tunnel URL row so the app always finds it
INSERT INTO public.app_config (key, value)
VALUES ('llm_tunnel_url', '')
ON CONFLICT (key) DO NOTHING;
