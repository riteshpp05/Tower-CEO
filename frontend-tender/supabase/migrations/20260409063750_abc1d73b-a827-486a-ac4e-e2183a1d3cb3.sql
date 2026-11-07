
-- Allow anon to read resources (mock auth doesn't create Supabase session)
CREATE POLICY "Anon users can view resources"
ON public.resources FOR SELECT TO anon
USING (true);

-- Allow anon to manage resources (mock auth)
CREATE POLICY "Anon users can create resources"
ON public.resources FOR INSERT TO anon
WITH CHECK (true);

CREATE POLICY "Anon users can update resources"
ON public.resources FOR UPDATE TO anon
USING (true);

CREATE POLICY "Anon users can delete resources"
ON public.resources FOR DELETE TO anon
USING (true);
