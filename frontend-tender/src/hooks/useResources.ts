import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface DbResource {
  id: string;
  name: string;
  designation: string;
  skills: string[];
  sap_modules: string[];
  years_of_experience: number;
  certifications: string[];
  geography: string;
  availability: string;
  languages: string[];
  employment_type: string;
  cost_rate: number;
  billing_rate: number;
  cost_loading_percentage: number;
  currency: string;
  email: string | null;
  phone: string | null;
  bio: string | null;
  profile_summary: string | null;
  key_projects: string[];
  created_at: string;
  updated_at: string;
}

export function useResources() {
  return useQuery({
    queryKey: ['resources'],
    queryFn: async () => {
      const { data, error } = await supabase.from('resources').select('*').order('name');
      if (error) throw error;
      return data as DbResource[];
    },
  });
}

export function useCreateResource() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (resource: Omit<DbResource, 'id' | 'created_at' | 'updated_at'>) => {
      const { data, error } = await supabase.from('resources').insert(resource).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['resources'] });
      toast({ title: 'Resource created successfully' });
    },
    onError: (e: Error) => toast({ title: 'Error creating resource', description: e.message, variant: 'destructive' }),
  });
}

export function useUpdateResource() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<DbResource> & { id: string }) => {
      const { data, error } = await supabase.from('resources').update(updates).eq('id', id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['resources'] });
      toast({ title: 'Resource updated successfully' });
    },
    onError: (e: Error) => toast({ title: 'Error updating resource', description: e.message, variant: 'destructive' }),
  });
}

export function useDeleteResource() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('resources').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['resources'] });
      toast({ title: 'Resource deleted' });
    },
    onError: (e: Error) => toast({ title: 'Error deleting resource', description: e.message, variant: 'destructive' }),
  });
}
