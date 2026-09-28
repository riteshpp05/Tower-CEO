-- Create proposals table
CREATE TABLE public.proposals (
  id TEXT NOT NULL PRIMARY KEY,
  title TEXT NOT NULL,
  client_name TEXT NOT NULL DEFAULT '',
  client_group TEXT DEFAULT '',
  industry TEXT DEFAULT '',
  geography TEXT DEFAULT 'India',
  lob TEXT DEFAULT 'SAP Implementation – Rise',
  opportunity_type TEXT DEFAULT 'SAP Implementation – Rise',
  owner TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Draft',
  created_at TEXT DEFAULT '',
  updated_at TEXT DEFAULT '',
  submission_date TEXT DEFAULT '',
  priority TEXT DEFAULT 'Medium',
  deal_type TEXT DEFAULT 'Fixed Price',
  currency TEXT DEFAULT 'INR',
  expected_duration TEXT DEFAULT '',
  expected_revenue NUMERIC DEFAULT 0,
  gross_margin NUMERIC DEFAULT 0,
  discount NUMERIC DEFAULT 0,
  modules TEXT[] NOT NULL DEFAULT '{}'::text[],
  risk_level TEXT DEFAULT 'Medium',
  approval_progress INTEGER DEFAULT 0
);

ALTER TABLE public.proposals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anon can view proposals" ON public.proposals FOR SELECT TO anon USING (true);
CREATE POLICY "Anon can create proposals" ON public.proposals FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Anon can update proposals" ON public.proposals FOR UPDATE TO anon USING (true);
CREATE POLICY "Anon can delete proposals" ON public.proposals FOR DELETE TO anon USING (true);
CREATE POLICY "Auth can view proposals" ON public.proposals FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth can create proposals" ON public.proposals FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth can update proposals" ON public.proposals FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Auth can delete proposals" ON public.proposals FOR DELETE TO authenticated USING (true);

-- Create approval_records table
CREATE TABLE public.approval_records (
  id TEXT NOT NULL PRIMARY KEY,
  proposal_id TEXT NOT NULL REFERENCES public.proposals(id) ON DELETE CASCADE,
  proposal_title TEXT DEFAULT '',
  stage TEXT NOT NULL,
  approver TEXT DEFAULT '',
  approver_role TEXT DEFAULT '',
  decision TEXT NOT NULL DEFAULT 'Pending',
  comments TEXT DEFAULT '',
  timestamp TEXT DEFAULT ''
);

ALTER TABLE public.approval_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anon can view approval_records" ON public.approval_records FOR SELECT TO anon USING (true);
CREATE POLICY "Anon can create approval_records" ON public.approval_records FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Anon can update approval_records" ON public.approval_records FOR UPDATE TO anon USING (true);
CREATE POLICY "Anon can delete approval_records" ON public.approval_records FOR DELETE TO anon USING (true);
CREATE POLICY "Auth can view approval_records" ON public.approval_records FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth can create approval_records" ON public.approval_records FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth can update approval_records" ON public.approval_records FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Auth can delete approval_records" ON public.approval_records FOR DELETE TO authenticated USING (true);