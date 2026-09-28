
-- Create resources table
CREATE TABLE public.resources (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  designation TEXT NOT NULL DEFAULT '',
  skills TEXT[] NOT NULL DEFAULT '{}',
  sap_modules TEXT[] NOT NULL DEFAULT '{}',
  years_of_experience INTEGER NOT NULL DEFAULT 0,
  certifications TEXT[] NOT NULL DEFAULT '{}',
  geography TEXT NOT NULL DEFAULT 'India',
  availability TEXT NOT NULL DEFAULT 'Available' CHECK (availability IN ('Available', 'Partially Available', 'Engaged')),
  languages TEXT[] NOT NULL DEFAULT '{English}',
  employment_type TEXT NOT NULL DEFAULT 'Full-Time' CHECK (employment_type IN ('Full-Time', 'Contractor')),
  cost_rate NUMERIC(10,2) NOT NULL DEFAULT 0,
  billing_rate NUMERIC(10,2) NOT NULL DEFAULT 0,
  cost_loading_percentage NUMERIC(5,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  email TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  bio TEXT DEFAULT '',
  profile_summary TEXT DEFAULT '',
  key_projects TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.resources ENABLE ROW LEVEL SECURITY;

-- All authenticated users can view resources
CREATE POLICY "Authenticated users can view resources"
ON public.resources FOR SELECT TO authenticated
USING (true);

-- All authenticated users can manage resources (until role system is in place)
CREATE POLICY "Authenticated users can create resources"
ON public.resources FOR INSERT TO authenticated
WITH CHECK (true);

CREATE POLICY "Authenticated users can update resources"
ON public.resources FOR UPDATE TO authenticated
USING (true);

CREATE POLICY "Authenticated users can delete resources"
ON public.resources FOR DELETE TO authenticated
USING (true);

-- Timestamp trigger
CREATE OR REPLACE FUNCTION public.update_resources_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_resources_updated_at
BEFORE UPDATE ON public.resources
FOR EACH ROW
EXECUTE FUNCTION public.update_resources_updated_at();
