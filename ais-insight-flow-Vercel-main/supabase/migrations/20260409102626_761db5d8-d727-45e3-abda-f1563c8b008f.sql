-- Create proposal_templates table
CREATE TABLE public.proposal_templates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  category TEXT NOT NULL DEFAULT 'General',
  opportunity_type TEXT DEFAULT '',
  sections JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'Draft',
  version TEXT NOT NULL DEFAULT '1.0',
  approved_by TEXT DEFAULT '',
  approved_at TIMESTAMP WITH TIME ZONE,
  tags TEXT[] NOT NULL DEFAULT '{}'::text[],
  created_by TEXT DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.proposal_templates ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Anon users can view templates" ON public.proposal_templates FOR SELECT TO anon USING (true);
CREATE POLICY "Anon users can create templates" ON public.proposal_templates FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Anon users can update templates" ON public.proposal_templates FOR UPDATE TO anon USING (true);
CREATE POLICY "Anon users can delete templates" ON public.proposal_templates FOR DELETE TO anon USING (true);
CREATE POLICY "Authenticated users can view templates" ON public.proposal_templates FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can create templates" ON public.proposal_templates FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update templates" ON public.proposal_templates FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete templates" ON public.proposal_templates FOR DELETE TO authenticated USING (true);

-- Timestamp trigger
CREATE TRIGGER update_proposal_templates_updated_at
  BEFORE UPDATE ON public.proposal_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.update_resources_updated_at();