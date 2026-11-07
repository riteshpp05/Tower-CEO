
-- Create admin_users table
CREATE TABLE public.admin_users (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL,
  role text NOT NULL DEFAULT 'Sales',
  status text NOT NULL DEFAULT 'Active',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anon can view admin_users" ON public.admin_users FOR SELECT TO anon USING (true);
CREATE POLICY "Anon can create admin_users" ON public.admin_users FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Anon can update admin_users" ON public.admin_users FOR UPDATE TO anon USING (true);
CREATE POLICY "Anon can delete admin_users" ON public.admin_users FOR DELETE TO anon USING (true);
CREATE POLICY "Auth can view admin_users" ON public.admin_users FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth can create admin_users" ON public.admin_users FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth can update admin_users" ON public.admin_users FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Auth can delete admin_users" ON public.admin_users FOR DELETE TO authenticated USING (true);

-- Create workflow_stages table
CREATE TABLE public.workflow_stages (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  stage text NOT NULL,
  approver text NOT NULL DEFAULT 'Auto',
  mandatory boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.workflow_stages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anon can view workflow_stages" ON public.workflow_stages FOR SELECT TO anon USING (true);
CREATE POLICY "Anon can create workflow_stages" ON public.workflow_stages FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Anon can update workflow_stages" ON public.workflow_stages FOR UPDATE TO anon USING (true);
CREATE POLICY "Anon can delete workflow_stages" ON public.workflow_stages FOR DELETE TO anon USING (true);
CREATE POLICY "Auth can view workflow_stages" ON public.workflow_stages FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth can create workflow_stages" ON public.workflow_stages FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth can update workflow_stages" ON public.workflow_stages FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Auth can delete workflow_stages" ON public.workflow_stages FOR DELETE TO authenticated USING (true);

-- Add updated_at triggers
CREATE TRIGGER update_admin_users_updated_at
  BEFORE UPDATE ON public.admin_users
  FOR EACH ROW EXECUTE FUNCTION public.update_resources_updated_at();

CREATE TRIGGER update_workflow_stages_updated_at
  BEFORE UPDATE ON public.workflow_stages
  FOR EACH ROW EXECUTE FUNCTION public.update_resources_updated_at();
