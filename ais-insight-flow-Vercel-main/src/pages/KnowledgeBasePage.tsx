import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { StatusBadge } from '@/components/StatusBadge';
import { useToast } from '@/hooks/use-toast';
import { useNavigate } from 'react-router-dom';
import {
  FileText, Trash2, Eye, Search, Upload,
  FolderOpen, Clock, CheckCircle, Loader2, Building2, Plus, Users,
} from 'lucide-react';

interface UploadedFile {
  id: string;
  filename: string;
  file_type: string | null;
  file_size: number | null;
  uploaded_at: string;
  proposal_id: string | null;
}

interface DraftProposal {
  id: string;
  title: string;
  client_name: string;
  status: string;
  updated_at: string | null;
  created_at: string | null;
  metadata: Record<string, unknown> | null;
}

interface ApprovedProposal {
  id: string;
  title: string;
  client_name: string;
  status: string;
  updated_at: string | null;
  expected_revenue: number | null;
  currency: string | null;
}

export default function KnowledgeBasePage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  interface CompanyProfile {
    legalName: string; foundedYear: string; sapPartnerTier: string;
    isoCertifications: string; offices: string; teamSize: string;
    revenueRange: string; website: string; aboutUs: string;
  }
  interface CompanyReference {
    id: string; clientName: string; industry: string; modules: string;
    employeeCount: string; goLiveDate: string; duration: string;
    contactName: string; contactEmail: string; confidential: boolean;
  }

  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [companyProfile, setCompanyProfile] = useState<CompanyProfile>({
    legalName: 'Abhiyanta India Solutions Pvt. Ltd.',
    foundedYear: '', sapPartnerTier: 'SAP Gold Partner',
    isoCertifications: 'ISO 9001:2015, ISO/IEC 27001:2022',
    offices: 'Pune (HQ), Dubai, Singapore',
    teamSize: '', revenueRange: '', website: 'www.abhiyantatech.com',
    aboutUs: '',
  });
  const [references, setReferences] = useState<CompanyReference[]>([]);
  const [savingProfile, setSavingProfile] = useState(false);
  const [draftProposals, setDraftProposals] = useState<DraftProposal[]>([]);
  const [approvedProposals, setApprovedProposals] = useState<ApprovedProposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchA, setSearchA] = useState('');
  const [searchB, setSearchB] = useState('');
  const [searchC, setSearchC] = useState('');

  const loadProfile = useCallback(async () => {
    try {
      const { data } = await supabase.from('app_config' as never).select('value').eq('key', 'company_profile').maybeSingle();
      if (data) {
        const parsed = typeof (data as any).value === 'string' ? JSON.parse((data as any).value) : (data as any).value;
        if (parsed?.profile) setCompanyProfile(parsed.profile);
        if (parsed?.references) setReferences(parsed.references);
      }
    } catch { /* non-critical */ }
  }, []);

  const saveProfile = async () => {
    setSavingProfile(true);
    try {
      await supabase.from('app_config' as never).upsert({
        key: 'company_profile',
        value: JSON.stringify({ profile: companyProfile, references }),
      } as never, { onConflict: 'key' });
      toast({ title: '✓ Company profile saved' });
    } catch (e) {
      toast({ title: 'Save failed', description: String(e), variant: 'destructive' });
    } finally {
      setSavingProfile(false);
    }
  };

  const addReference = () => setReferences(prev => [...prev, {
    id: `REF-${Date.now()}`, clientName: '', industry: '', modules: '',
    employeeCount: '', goLiveDate: '', duration: '', contactName: '', contactEmail: '', confidential: false,
  }]);

  const updateReference = (id: string, field: string, value: string | boolean) =>
    setReferences(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));

  const deleteReference = (id: string) => setReferences(prev => prev.filter(r => r.id !== id));

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [filesRes, draftsRes, approvedRes] = await Promise.all([
        supabase.from('uploaded_files' as never).select('*').order('uploaded_at', { ascending: false }),
        supabase.from('proposals' as never).select('id,title,client_name,status,updated_at,created_at,metadata').eq('status', 'Draft').order('updated_at', { ascending: false }),
        supabase.from('proposals' as never).select('id,title,client_name,status,updated_at,expected_revenue,currency')
          .in('status', ['Ready for Export', 'Submitted', 'Final Approval']).order('updated_at', { ascending: false }),
      ]);
      setUploadedFiles((filesRes.data as UploadedFile[]) || []);
      setDraftProposals((draftsRes.data as DraftProposal[]) || []);
      setApprovedProposals((approvedRes.data as ApprovedProposal[]) || []);
    } catch (e) {
      toast({ title: 'Error loading knowledge base', description: String(e), variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { fetchAll(); loadProfile(); }, [fetchAll, loadProfile]);

  const deleteDraft = async (id: string, title: string) => {
    if (!confirm(`Delete draft "${title}"? This cannot be undone.`)) return;
    await supabase.from('proposals' as never).delete().eq('id', id);
    setDraftProposals(prev => prev.filter(p => p.id !== id));
    toast({ title: 'Draft deleted', description: title });
  };

  const deleteFile = async (id: string, filename: string) => {
    if (!confirm(`Remove "${filename}" from the knowledge base?`)) return;
    await supabase.from('uploaded_files' as never).delete().eq('id', id);
    setUploadedFiles(prev => prev.filter(f => f.id !== id));
    toast({ title: 'File removed', description: filename });
  };

  const retrieveDraft = (p: DraftProposal) => {
    const meta = p.metadata as Record<string, unknown> | null;
    const step = (meta?.draft_step as number) || 0;
    navigate(`/proposals/new?draft=${p.id}&step=${step}`);
  };

  const formatDate = (d: string | null) =>
    d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

  const formatSize = (bytes: number | null) => {
    if (!bytes) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  };

  const filteredFiles    = uploadedFiles.filter(f => !searchA || f.filename.toLowerCase().includes(searchA.toLowerCase()));
  const filteredDrafts   = draftProposals.filter(p => !searchB || p.title.toLowerCase().includes(searchB.toLowerCase()) || p.client_name.toLowerCase().includes(searchB.toLowerCase()));
  const filteredApproved = approvedProposals.filter(p => !searchC || p.title.toLowerCase().includes(searchC.toLowerCase()) || p.client_name.toLowerCase().includes(searchC.toLowerCase()));

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      <span className="ml-3 text-muted-foreground">Loading knowledge base…</span>
    </div>
  );

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold font-heading">Knowledge Base</h1>
        <p className="text-sm text-muted-foreground">
          {uploadedFiles.length} uploaded files · {draftProposals.length} drafts · {approvedProposals.length} approved proposals
        </p>
      </div>

      <Tabs defaultValue="company">
        <TabsList>
          <TabsTrigger value="company">
            <Building2 className="h-3.5 w-3.5 mr-1.5" />
            Company Profile
          </TabsTrigger>
          <TabsTrigger value="files">
            <Upload className="h-3.5 w-3.5 mr-1.5" />
            Uploaded Files ({uploadedFiles.length})
          </TabsTrigger>
          <TabsTrigger value="drafts">
            <Clock className="h-3.5 w-3.5 mr-1.5" />
            Draft Proposals ({draftProposals.length})
          </TabsTrigger>
          <TabsTrigger value="approved">
            <CheckCircle className="h-3.5 w-3.5 mr-1.5" />
            Approved & Exported ({approvedProposals.length})
          </TabsTrigger>
        </TabsList>


        {/* ── Tab: Company Profile ──────────────────────────────────────── */}
        <TabsContent value="company" className="mt-4 space-y-4">
          <Card className="enterprise-shadow">
            <CardHeader>
              <CardTitle className="font-heading flex items-center gap-2">
                <Building2 className="h-4 w-4 text-primary" /> AIS Company Profile
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                This data is injected into every proposal as verified company facts — replaces hallucinated credentials.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {([
                  ['legalName', 'Legal Entity Name', 'Abhiyanta India Solutions Pvt. Ltd.'],
                  ['foundedYear', 'Founded Year', 'e.g. 2012'],
                  ['sapPartnerTier', 'SAP Partnership Tier', 'e.g. SAP Gold Partner'],
                  ['isoCertifications', 'ISO Certifications', 'ISO 9001:2015, ISO/IEC 27001:2022'],
                  ['offices', 'Office Locations', 'e.g. Pune (HQ), Dubai, Singapore'],
                  ['teamSize', 'Team Size', 'e.g. 250+ consultants'],
                  ['revenueRange', 'Annual Revenue Range (for NDA)', 'e.g. INR 50–100 Cr'],
                  ['website', 'Website', 'www.abhiyantatech.com'],
                ] as [string, string, string][]).map(([field, label, ph]) => (
                  <div key={field} className="space-y-1.5">
                    <Label className="text-xs">{label}</Label>
                    <Input
                      value={(companyProfile as any)[field]}
                      onChange={e => setCompanyProfile(prev => ({ ...prev, [field]: e.target.value }))}
                      placeholder={ph}
                      className="text-sm"
                    />
                  </div>
                ))}
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">About AIS (2–3 sentences for proposals)</Label>
                <Textarea
                  value={companyProfile.aboutUs}
                  onChange={e => setCompanyProfile(prev => ({ ...prev, aboutUs: e.target.value }))}
                  placeholder="Abhiyanta India Solutions Pvt. Ltd. is a SAP Gold Partner with ISO 9001:2015 and ISO/IEC 27001:2022 certifications, delivering SAP implementations and AMS across India, Middle East and APAC since..."
                  className="text-sm min-h-[80px]"
                />
              </div>
            </CardContent>
          </Card>

          {/* Client References */}
          <Card className="enterprise-shadow">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="font-heading flex items-center gap-2">
                    <Users className="h-4 w-4 text-primary" /> Client References ({references.length})
                  </CardTitle>
                  <p className="text-xs text-muted-foreground mt-1">
                    Used in the References section of proposals. Mark as confidential to anonymise the client name in exports.
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={addReference} className="gap-1.5">
                  <Plus className="h-3.5 w-3.5" /> Add Reference
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {references.length === 0 && (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  <Users className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  <p>No references yet. Add client references to use in proposals.</p>
                </div>
              )}
              {references.map((ref, i) => (
                <div key={ref.id} className="p-4 rounded-lg border space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground">Reference {i + 1}</span>
                    <div className="flex items-center gap-3">
                      <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                        <input type="checkbox" checked={ref.confidential} onChange={e => updateReference(ref.id, 'confidential', e.target.checked)} />
                        Confidential (anonymise in proposals)
                      </label>
                      <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive" onClick={() => deleteReference(ref.id)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {([
                      ['clientName', 'Client Name'],
                      ['industry', 'Industry'],
                      ['modules', 'SAP Modules'],
                      ['employeeCount', 'Organisation Size'],
                      ['goLiveDate', 'Go-live Date'],
                      ['duration', 'Engagement Duration'],
                      ['contactName', 'Contact Name'],
                      ['contactEmail', 'Contact Email'],
                    ] as [string, string][]).map(([field, label]) => (
                      <div key={field} className="space-y-1">
                        <Label className="text-xs">{label}</Label>
                        <Input
                          value={(ref as any)[field]}
                          onChange={e => updateReference(ref.id, field, e.target.value)}
                          className="text-sm h-8"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button onClick={saveProfile} disabled={savingProfile} className="gap-2">
              {savingProfile ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {savingProfile ? 'Saving…' : '💾 Save Company Profile & References'}
            </Button>
          </div>
        </TabsContent>

        {/* ── Tab A: Uploaded Files ──────────────────────────────────────── */}
        <TabsContent value="files" className="mt-4 space-y-4">
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search files…" value={searchA} onChange={e => setSearchA(e.target.value)} className="pl-9" />
            </div>
          </div>

          {filteredFiles.length === 0 ? (
            <Card className="enterprise-shadow">
              <CardContent className="py-12 text-center">
                <FolderOpen className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
                <p className="text-muted-foreground">No uploaded files yet.</p>
                <p className="text-xs text-muted-foreground mt-1">Files uploaded during RFP parsing will appear here.</p>
              </CardContent>
            </Card>
          ) : (
            <Card className="enterprise-shadow">
              <CardContent className="pt-4">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="pb-3 font-medium text-muted-foreground">Filename</th>
                      <th className="pb-3 font-medium text-muted-foreground">Type</th>
                      <th className="pb-3 font-medium text-muted-foreground">Size</th>
                      <th className="pb-3 font-medium text-muted-foreground">Uploaded</th>
                      <th className="pb-3 font-medium text-muted-foreground text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredFiles.map(f => (
                      <tr key={f.id} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="py-3">
                          <div className="flex items-center gap-2">
                            <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                            <span className="font-medium">{f.filename}</span>
                          </div>
                        </td>
                        <td className="py-3 text-muted-foreground">{f.file_type || '—'}</td>
                        <td className="py-3 text-muted-foreground">{formatSize(f.file_size)}</td>
                        <td className="py-3 text-muted-foreground">{formatDate(f.uploaded_at)}</td>
                        <td className="py-3 text-right">
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => deleteFile(f.id, f.filename)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── Tab B: Draft Proposals ─────────────────────────────────────── */}
        <TabsContent value="drafts" className="mt-4 space-y-4">
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search drafts…" value={searchB} onChange={e => setSearchB(e.target.value)} className="pl-9" />
          </div>

          {filteredDrafts.length === 0 ? (
            <Card className="enterprise-shadow">
              <CardContent className="py-12 text-center">
                <Clock className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
                <p className="text-muted-foreground">No draft proposals yet.</p>
                <p className="text-xs text-muted-foreground mt-1">Use "Save Draft" in the New Proposal wizard to save your work here.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {filteredDrafts.map(p => {
                const meta = p.metadata as Record<string, unknown> | null;
                const step = (meta?.draft_step as number) || 0;
                const steps = ['Opportunity Details', 'Cover Letter', 'Scope Details', 'Pre-Sales Briefing', 'Resource Selection', 'Cost Sheet', 'Commercial Details', 'Risk & Constraints', 'Internal Notes', 'Review & Submit'];
                return (
                  <Card key={p.id} className="enterprise-shadow">
                    <CardContent className="py-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <p className="font-semibold truncate">{p.title || 'Untitled Proposal'}</p>
                            <StatusBadge status="Draft" />
                          </div>
                          <p className="text-sm text-muted-foreground">{p.client_name}</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            Last saved: {formatDate(p.updated_at)} · Step: {steps[step] || 'Step 1'}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => retrieveDraft(p)}>
                            <Eye className="h-3.5 w-3.5" /> Retrieve & Edit
                          </Button>
                          <Button size="sm" variant="ghost" className="text-destructive" onClick={() => deleteDraft(p.id, p.title)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* ── Tab C: Approved & Exported ────────────────────────────────── */}
        <TabsContent value="approved" className="mt-4 space-y-4">
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search approved proposals…" value={searchC} onChange={e => setSearchC(e.target.value)} className="pl-9" />
          </div>

          {filteredApproved.length === 0 ? (
            <Card className="enterprise-shadow">
              <CardContent className="py-12 text-center">
                <CheckCircle className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
                <p className="text-muted-foreground">No approved proposals yet.</p>
                <p className="text-xs text-muted-foreground mt-1">Proposals that complete the approval workflow will appear here.</p>
              </CardContent>
            </Card>
          ) : (
            <Card className="enterprise-shadow">
              <CardContent className="pt-4">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="pb-3 font-medium text-muted-foreground">Proposal</th>
                      <th className="pb-3 font-medium text-muted-foreground">Client</th>
                      <th className="pb-3 font-medium text-muted-foreground">Status</th>
                      <th className="pb-3 font-medium text-muted-foreground">Revenue</th>
                      <th className="pb-3 font-medium text-muted-foreground">Date</th>
                      <th className="pb-3 font-medium text-muted-foreground text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredApproved.map(p => (
                      <tr key={p.id} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="py-3 font-medium">{p.title}</td>
                        <td className="py-3 text-muted-foreground">{p.client_name}</td>
                        <td className="py-3"><StatusBadge status={p.status} /></td>
                        <td className="py-3 text-muted-foreground">
                          {p.expected_revenue ? `${p.currency === 'INR' ? '₹' : '$'}${(p.expected_revenue / 10000000).toFixed(1)} Cr` : '—'}
                        </td>
                        <td className="py-3 text-muted-foreground">{formatDate(p.updated_at)}</td>
                        <td className="py-3 text-right">
                          <Button size="sm" variant="ghost" onClick={() => navigate(`/proposals/${p.id}`)}>
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}