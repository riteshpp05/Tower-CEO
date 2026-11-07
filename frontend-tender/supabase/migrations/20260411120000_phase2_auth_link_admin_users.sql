-- Phase 2: link admin_users to auth.users and expose current role via SECURITY DEFINER function.
-- Does NOT touch RLS policies (Phase 3). Does NOT backfill existing rows (handled via runbook).
--
-- Phase 3 reminder: once the permissive anon policies on admin_users are removed, we will need
-- an RLS policy on public.admin_users that allows an authenticated user to SELECT their own row
-- (USING user_id = auth.uid()), because AuthContext fetches `name` and `adminUserId` from that
-- table immediately after sign-in. Without such a policy the context will receive an empty row
-- and the user will appear nameless. Do NOT add that policy in this migration.

-- 1. Rename legacy role value so it matches the new UserRole union.
UPDATE public.admin_users
SET role = 'Delivery'
WHERE role = 'Delivery Head';

-- 2. Add user_id FK to auth.users.
ALTER TABLE public.admin_users
  ADD COLUMN user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- 3. One auth user maps to at most one admin_users row.
ALTER TABLE public.admin_users
  ADD CONSTRAINT admin_users_user_id_key UNIQUE (user_id);

-- 4. Lookup indexes.
CREATE INDEX admin_users_user_id_idx ON public.admin_users (user_id);
CREATE INDEX admin_users_email_lower_idx ON public.admin_users (lower(email));

-- 5. Role resolver used by app + (later) RLS. Fail-closed: returns NULL if no active link.
CREATE OR REPLACE FUNCTION public.get_current_user_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role
  FROM public.admin_users
  WHERE user_id = auth.uid()
    AND status = 'Active'
  LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.get_current_user_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_current_user_role() TO authenticated;

-- 6. Auto-link trigger: when a new auth.users row is inserted, link the oldest matching
--    admin_users row (case-insensitive email) that is not already linked. Fail-closed:
--    no match => do nothing, user will have no role and be locked out until an admin adds them.
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_id uuid;
  extra_count int;
BEGIN
  SELECT id INTO target_id
  FROM public.admin_users
  WHERE lower(email) = lower(NEW.email)
    AND user_id IS NULL
  ORDER BY created_at ASC
  LIMIT 1;

  IF target_id IS NULL THEN
    RETURN NEW;  -- no match, fail-closed
  END IF;

  UPDATE public.admin_users
  SET user_id = NEW.id,
      updated_at = now()
  WHERE id = target_id;

  SELECT count(*) INTO extra_count
  FROM public.admin_users
  WHERE lower(email) = lower(NEW.email)
    AND id <> target_id;

  IF extra_count > 0 THEN
    RAISE NOTICE 'handle_new_auth_user: % additional admin_users rows matched email % and were left unlinked',
      extra_count, NEW.email;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_auth_user();
