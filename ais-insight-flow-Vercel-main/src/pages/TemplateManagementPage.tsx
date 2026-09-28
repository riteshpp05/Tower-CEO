import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { StatusBadge } from '@/components/StatusBadge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { StatCard } from '@/components/StatCard';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import {
  Search, FileText, CheckCircle, Archive, RotateCcw, Eye, Pencil, Trash2,
  Plus, ArrowUpCircle, LayoutTemplate, Clock, BookOpen, Layers, GripVertical, X, Sparkles, Bot
} from 'lucide-react';

interface TemplateSection {
  id: string;
  title: string;
  description: string;
  required: boolean;
}

interface ProposalTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  opportunity_type: string;
  sections: TemplateSection[];
  status: string;
  version: string;
  approved_by: string;
  approved_at: string | null;
  tags: string[];
  created_by: string;
  created_at: string;
  updated_at: string;
}

const categories = ['General', 'SAP Implementation', 'AMS', 'Migration', 'BTP / AI', 'Resource Augmentation', 'Tender'];
const opportunityTypes = ['', 'SAP Implementation – Rise', 'SAP Implementation – Grow', 'AMS', 'Resource Augmentation', 'Upgrade / Migration', 'BTP / AI', 'Tender'];

const defaultSections: TemplateSection[] = [
  { id: '1', title: 'Cover Page', description: 'Project title, client name, date, confidentiality notice', required: true },
  { id: '2', title: 'Executive Summary', description: 'High-level overview of the proposal', required: true },
  { id: '3', title: 'Understanding of Requirements', description: 'Client pain points and objectives', required: true },
  { id: '4', title: 'Proposed Solution', description: 'Technical approach and SAP modules', required: true },
  { id: '5', title: 'Implementation Methodology', description: 'SAP Activate or custom methodology phases', required: true },
  { id: '6', title: 'Project Plan & Timeline', description: 'Milestones, phases, deliverables', required: true },
  { id: '7', title: 'Team Structure', description: 'Proposed team members and roles', required: true },
  { id: '8', title: 'Commercial Proposal', description: 'Pricing, rate cards, payment terms', required: true },
  { id: '9', title: 'Risk Mitigation', description: 'Identified risks and mitigation strategies', required: false },
  { id: '10', title: 'SLA & Support', description: 'Service level agreements and post-go-live support', required: false },
  { id: '11', title: 'Company Credentials', description: 'About us, certifications, case studies', required: false },
  { id: '12', title: 'Annexures', description: 'CVs, legal terms, additional documents', required: false },
];

// Sections that AI will write content for (everything except structural ones)
const STRUCTURAL_SECTIONS = new Set(['Cover Page', 'Annexures', 'Commercial Proposal', 'Team Structure']);

const isAiSection = (title: string) => !STRUCTURAL_SECTIONS.has(title);

const getAiSectionCount = (sections: TemplateSection[]) =>
  sections.filter(s => isAiSection(s.title)).length;

const emptyForm = (): Partial<ProposalTemplate> => ({
  name: '', description: '', category: 'General', opportunity_type: '',
  sections: [...defaultSections], status: 'Draft', version: '1.0', tags: [], created_by: '',
});

export default function TemplateManagementPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [templates, setTemplates] = useState<ProposalTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [viewItem, setViewItem] = useState<ProposalTemplate | null>(null);
  const [editItem, setEditItem] = useState<ProposalTemplate | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<Partial<ProposalTemplate>>(emptyForm());
  const [tagInput, setTagInput] = useState('');

  useEffect(() => { fetchTemplates(); }, []);

  const fetchTemplates = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.from('proposal_templates').select('*').order('updated_at', { ascending: false });
      if (error) {
        toast({ title: 'Error loading templates', description: error.message, variant: 'destructive' });
      } else {
        setTemplates((data || []).map(d => ({
          ...d,
          sections: Array.isArray(d.sections) ? d.sections as unknown as TemplateSection[] : [],
          tags: d.tags || [],
        })));
      }
    } catch (err) {
      toast({ title: 'Failed to load templates', description: 'Check your Supabase connection.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const filtered = templates.filter(t => {
    const matchSearch = !search || t.name.toLowerCase().includes(search.toLowerCase()) || t.description.toLowerCase().includes(search.toLowerCase());
    const matchCat = categoryFilter === 'all' || t.category === categoryFilter;
    const matchStatus = statusFilter === 'all' || t.status === statusFilter;
    return matchSearch && matchCat && matchStatus;
  });

  const counts = {
    total: templates.length,
    approved: templates.filter(t => t.status === 'Approved').length,
    pending: templates.filter(t => t.status === 'Pending Review').length,
    draft: templates.filter(t => t.status === 'Draft').length,
  };

  const updateField = (field: string, value: any) => setForm(prev => ({ ...prev, [field]: value }));

  const addSection = () => {
    const sections = [...(form.sections || [])];
    sections.push({ id: String(Date.now()), title: '', description: '', required: false });
    updateField('sections', sections);
  };

  const updateSection = (idx: number, field: keyof TemplateSection, value: any) => {
    const sections = [...(form.sections || [])];
    sections[idx] = { ...sections[idx], [field]: value };
    updateField('sections', sections);
  };

  const removeSection = (idx: number) => {
    const sections = [...(form.sections || [])];
    sections.splice(idx, 1);
    updateField('sections', sections);
  };

  const addTag = () => {
    if (!tagInput.trim()) return;
    const tags = [...(form.tags || [])];
    if (!tags.includes(tagInput.trim())) tags.push(tagInput.trim());
    updateField('tags', tags);
    setTagInput('');
  };

  const removeTag = (tag: string) => updateField('tags', (form.tags || []).filter(t => t !== tag));

  const handleCreate = async () => {
    if (!form.name) { toast({ title: 'Name required', variant: 'destructive' }); return; }
    const { error } = await supabase.from('proposal_templates').insert({
      name: form.name,
      description: form.description || '',
      category: form.category || 'General',
      opportunity_type: form.opportunity_type || '',
      sections: form.sections as any,
      status: 'Draft',
      version: '1.0',
      tags: form.tags || [],
      created_by: user?.name || 'Admin',
    });
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
    toast({ title: '✓ Template Created', description: `"${form.name}" saved as Draft.` });
    setShowCreate(false);
    setForm(emptyForm());
    fetchTemplates();
  };

  const handleSaveEdit = async () => {
    if (!editItem || !form.name) return;
    const { error } = await supabase.from('proposal_templates').update({
      name: form.name,
      description: form.description || '',
      category: form.category || 'General',
      opportunity_type: form.opportunity_type || '',
      sections: form.sections as any,
      tags: form.tags || [],
    }).eq('id', editItem.id);
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
    toast({ title: '✓ Template Updated', description: `"${form.name}" saved.` });
    setEditItem(null);
    setForm(emptyForm());
    fetchTemplates();
  };

  const handleSubmitForReview = async (t: ProposalTemplate) => {
    await supabase.from('proposal_templates').update({ status: 'Pending Review' }).eq('id', t.id);
    toast({ title: '📋 Submitted', description: `"${t.name}" submitted for review.` });
    fetchTemplates();
  };

  const handleApprove = async (t: ProposalTemplate) => {
    await supabase.from('proposal_templates').update({
      status: 'Approved',
      approved_by: user?.name || 'Admin',
      approved_at: new Date().toISOString(),
    }).eq('id', t.id);
    toast({ title: '✓ Approved', description: `"${t.name}" is now available for proposals.` });
    if (viewItem?.id === t.id) setViewItem(null);
    fetchTemplates();
  };

  const handleArchive = async (t: ProposalTemplate) => {
    await supabase.from('proposal_templates').update({ status: 'Archived' }).eq('id', t.id);
    toast({ title: '📦 Archived', description: `"${t.name}" moved to archive.` });
    if (viewItem?.id === t.id) setViewItem(null);
    fetchTemplates();
  };

  const handleRestore = async (t: ProposalTemplate) => {
    await supabase.from('proposal_templates').update({ status: 'Draft' }).eq('id', t.id);
    toast({ title: '↩ Restored', description: `"${t.name}" moved back to Draft.` });
    if (viewItem?.id === t.id) setViewItem(null);
    fetchTemplates();
  };

  const handleBumpVersion = async (t: ProposalTemplate) => {
    const parts = t.version.split('.');
    const major = parseInt(parts[0]) || 1;
    const minor = parseInt(parts[1]) || 0;
    const newVersion = `${major}.${minor + 1}`;
    await supabase.from('proposal_templates').update({ version: newVersion, status: 'Pending Review' }).eq('id', t.id);
    toast({ title: '⬆ Version Bumped', description: `"${t.name}" → v${newVersion}. Needs re-approval.` });
    if (viewItem?.id === t.id) setViewItem(null);
    fetchTemplates();
  };

  const handleDelete = async (t: ProposalTemplate) => {
    await supabase.from('proposal_templates').delete().eq('id', t.id);
    toast({ title: '🗑 Deleted', description: `"${t.name}" removed.` });
    if (viewItem?.id === t.id) setViewItem(null);
    fetchTemplates();
  };

  const openEdit = (t: ProposalTemplate) => {
    setEditItem(t);
    setForm({ ...t });
  };

  // form fields rendered inline in each dialog below

  const statusMap: Record<string, string> = { Draft: 'Draft', 'Pending Review': 'Pending', Approved: 'Approved', Archived: 'Archived' };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold font-heading">Template Management</h1>
          <p className="text-sm text-muted-foreground">{counts.total} templates · {counts.pending} pending review</p>
        </div>
        <Button onClick={() => { setForm(emptyForm()); setShowCreate(true); }}><Plus className="h-4 w-4 mr-2" /> New Template</Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard title="Total Templates" value={counts.total} icon={<LayoutTemplate className="h-4 w-4" />} />
        <StatCard title="Approved" value={counts.approved} icon={<CheckCircle className="h-4 w-4" />} />
        <StatCard title="Pending Review" value={counts.pending} icon={<Clock className="h-4 w-4" />} />
        <StatCard title="Drafts" value={counts.draft} icon={<FileText className="h-4 w-4" />} />
      </div>

      <Card className="enterprise-shadow">
        <CardContent className="pt-4">
          <div className="flex flex-wrap gap-3 mb-4">
            <div className="flex items-center gap-2 flex-1 min-w-[200px]"><Search className="h-4 w-4 text-muted-foreground" /><Input placeholder="Search templates..." value={search} onChange={e => setSearch(e.target.value)} className="h-9" /></div>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-[180px] h-9"><SelectValue placeholder="Category" /></SelectTrigger>
              <SelectContent><SelectItem value="all">All Categories</SelectItem>{categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[160px] h-9"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="Draft">Draft</SelectItem>
                <SelectItem value="Pending Review">Pending Review</SelectItem>
                <SelectItem value="Approved">Approved</SelectItem>
                <SelectItem value="Archived">Archived</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {loading ? (
            <div className="text-center py-12 text-muted-foreground">Loading templates...</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b text-left">
                  <th className="pb-3 font-medium text-muted-foreground">Template Name</th>
                  <th className="pb-3 font-medium text-muted-foreground">Category</th>
                  <th className="pb-3 font-medium text-muted-foreground">Sections</th>
                  <th className="pb-3 font-medium text-muted-foreground">Ver</th>
                  <th className="pb-3 font-medium text-muted-foreground">Status</th>
                  <th className="pb-3 font-medium text-muted-foreground">Updated</th>
                  <th className="pb-3 font-medium text-muted-foreground text-right">Actions</th>
                </tr></thead>
                <tbody>
                  {filtered.map(t => (
                    <tr key={t.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="py-3">
                        <div><span className="font-medium">{t.name}</span></div>
                        {t.description && <div className="text-xs text-muted-foreground truncate max-w-[250px]">{t.description}</div>}
                      </td>
                      <td className="py-3 text-xs">{t.category}</td>
                      <td className="py-3 text-xs">
                        <div className="flex items-center gap-1.5">
                          <span>{t.sections.length}</span>
                          {getAiSectionCount(t.sections) > 0 && (
                            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-info/10 text-info text-[10px] font-medium">
                              <Sparkles className="h-2.5 w-2.5" />{getAiSectionCount(t.sections)} AI
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 text-xs">v{t.version}</td>
                      <td className="py-3"><StatusBadge status={statusMap[t.status] || t.status} /></td>
                      <td className="py-3 text-xs">{new Date(t.updated_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                      <td className="py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button size="icon" variant="ghost" className="h-7 w-7" title="View" onClick={() => setViewItem(t)}><Eye className="h-3.5 w-3.5" /></Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7" title="Edit" onClick={() => openEdit(t)}><Pencil className="h-3.5 w-3.5" /></Button>
                          {t.status === 'Draft' && (
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-info" title="Submit for Review" onClick={() => handleSubmitForReview(t)}><CheckCircle className="h-3.5 w-3.5" /></Button>
                          )}
                          {t.status === 'Pending Review' && (
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-success" title="Approve" onClick={() => handleApprove(t)}><CheckCircle className="h-3.5 w-3.5" /></Button>
                          )}
                          {t.status === 'Approved' && (
                            <>
                              <Button size="icon" variant="ghost" className="h-7 w-7" title="Bump Version" onClick={() => handleBumpVersion(t)}><ArrowUpCircle className="h-3.5 w-3.5" /></Button>
                              <Button size="icon" variant="ghost" className="h-7 w-7 text-warning" title="Archive" onClick={() => handleArchive(t)}><Archive className="h-3.5 w-3.5" /></Button>
                            </>
                          )}
                          {t.status === 'Archived' && (
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-info" title="Restore" onClick={() => handleRestore(t)}><RotateCcw className="h-3.5 w-3.5" /></Button>
                          )}
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" title="Delete" onClick={() => handleDelete(t)}><Trash2 className="h-3.5 w-3.5" /></Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!loading && filtered.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <LayoutTemplate className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p>No templates found</p>
              <Button variant="outline" className="mt-3" onClick={() => { setForm(emptyForm()); setShowCreate(true); }}>
                <Plus className="h-4 w-4 mr-2" /> Create your first template
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* View Detail Dialog */}
      <Dialog open={!!viewItem} onOpenChange={() => setViewItem(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="font-heading">{viewItem?.name}</DialogTitle></DialogHeader>
          {viewItem && (
            <div className="space-y-4 text-sm">
              {viewItem.description && <p className="text-muted-foreground">{viewItem.description}</p>}
              <div className="grid grid-cols-2 gap-3">
                <div><span className="text-muted-foreground">Category:</span> {viewItem.category}</div>
                <div><span className="text-muted-foreground">Opportunity Type:</span> {viewItem.opportunity_type || 'Any'}</div>
                <div><span className="text-muted-foreground">Version:</span> v{viewItem.version}</div>
                <div><span className="text-muted-foreground">Status:</span> <StatusBadge status={statusMap[viewItem.status] || viewItem.status} /></div>
                <div><span className="text-muted-foreground">Created by:</span> {viewItem.created_by}</div>
                {viewItem.approved_by && <div><span className="text-muted-foreground">Approved by:</span> {viewItem.approved_by}</div>}
              </div>
              {viewItem.tags.length > 0 && (
                <div>
                  <span className="text-muted-foreground">Tags:</span>
                  <div className="flex flex-wrap gap-1 mt-1">{viewItem.tags.map(tag => <span key={tag} className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">{tag}</span>)}</div>
                </div>
              )}
              <div>
                <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                  <h4 className="font-semibold flex items-center gap-2"><Layers className="h-4 w-4" /> Sections ({viewItem.sections.length})</h4>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-info/10 text-info font-medium">
                      <Sparkles className="h-3 w-3" /> {getAiSectionCount(viewItem.sections)} AI-written
                    </span>
                    <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">
                      {viewItem.sections.length - getAiSectionCount(viewItem.sections)} Structural
                    </span>
                  </div>
                </div>
                <div className="space-y-1">
                  {viewItem.sections.map((sec, i) => (
                    <div key={sec.id} className="flex items-start gap-3 p-2 rounded border bg-muted/20">
                      <span className="text-xs font-mono text-muted-foreground mt-0.5 w-5">{i + 1}.</span>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm">{sec.title}</span>
                          {sec.required && <span className="text-destructive text-xs">*required</span>}
                          {isAiSection(sec.title) ? (
                            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-info/10 text-info text-[10px] font-medium">
                              <Sparkles className="h-2.5 w-2.5" /> AI-written
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-muted text-muted-foreground text-[10px] font-medium">
                              Structural
                            </span>
                          )}
                        </div>
                        {sec.description && <div className="text-xs text-muted-foreground mt-0.5">{sec.description}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex gap-2 pt-2 flex-wrap">
                {viewItem.status === 'Draft' && (
                  <Button size="sm" variant="outline" onClick={() => { handleSubmitForReview(viewItem); }}><CheckCircle className="h-3 w-3 mr-1" /> Submit for Review</Button>
                )}
                {viewItem.status === 'Pending Review' && (
                  <Button size="sm" className="text-success" variant="outline" onClick={() => { handleApprove(viewItem); }}><CheckCircle className="h-3 w-3 mr-1" /> Approve</Button>
                )}
                {viewItem.status === 'Approved' && (
                  <>
                    <Button size="sm" variant="outline" onClick={() => { handleBumpVersion(viewItem); }}><ArrowUpCircle className="h-3 w-3 mr-1" /> Bump Version</Button>
                    <Button size="sm" variant="outline" onClick={() => { handleArchive(viewItem); }}><Archive className="h-3 w-3 mr-1" /> Archive</Button>
                  </>
                )}
                {viewItem.status === 'Archived' && (
                  <Button size="sm" variant="outline" onClick={() => { handleRestore(viewItem); }}><RotateCcw className="h-3 w-3 mr-1" /> Restore</Button>
                )}
                <Button size="sm" variant="outline" onClick={() => { openEdit(viewItem); setViewItem(null); }}><Pencil className="h-3 w-3 mr-1" /> Edit</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Create Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="font-heading">Create New Template</DialogTitle></DialogHeader>
      <div className="space-y-4">
          <div className="space-y-2"><Label>Template Name *</Label><Input value={form.name || ''} onChange={e => updateField('name', e.target.value)} placeholder="e.g. SAP S/4HANA Implementation Proposal" /></div>
          <div className="space-y-2"><Label>Description</Label><Textarea value={form.description || ''} onChange={e => updateField('description', e.target.value)} placeholder="What is this template for?" rows={2} /></div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2"><Label>Category</Label>
              <Select value={form.category || 'General'} onValueChange={v => updateField('category', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{categories.map(cat => <SelectItem key={cat} value={cat}>{cat}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2"><Label>Opportunity Type</Label>
              <Select value={form.opportunity_type || ''} onValueChange={v => updateField('opportunity_type', v)}>
                <SelectTrigger><SelectValue placeholder="Any" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Any</SelectItem>
                  {opportunityTypes.filter(Boolean).map(ot => <SelectItem key={ot} value={ot}>{ot}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Tags</Label>
            <div className="flex items-center gap-2">
              <Input value={tagInput} onChange={e => setTagInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addTag())} placeholder="Add tag and press Enter" className="h-8" />
              <Button type="button" size="sm" variant="outline" onClick={addTag}>Add</Button>
            </div>
            {(form.tags || []).length > 0 && (
              <div className="flex flex-wrap gap-1">
                {(form.tags || []).map(tag => (
                  <span key={tag} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs">
                    {tag}<button type="button" onClick={() => removeTag(tag)}><X className="h-2.5 w-2.5" /></button>
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-semibold">Template Sections</Label>
              <Button type="button" size="sm" variant="outline" onClick={addSection}><Plus className="h-3 w-3 mr-1" /> Add Section</Button>
            </div>
            <div className="space-y-2 max-h-[280px] overflow-y-auto pr-1">
              {(form.sections || []).map((sec, idx) => (
                <div key={sec.id} className="flex items-start gap-2 p-2 rounded-lg border bg-muted/20">
                  <GripVertical className="h-4 w-4 mt-2 text-muted-foreground shrink-0" />
                  <div className="flex-1 space-y-1">
                    <Input value={sec.title} onChange={e => updateSection(idx, 'title', e.target.value)} placeholder="Section title" className="h-8 text-sm" />
                    <Input value={sec.description} onChange={e => updateSection(idx, 'description', e.target.value)} placeholder="Brief description" className="h-7 text-xs" />
                  </div>
                  <label className="flex items-center gap-1 text-xs text-muted-foreground mt-2 shrink-0">
                    <input type="checkbox" checked={sec.required} onChange={e => updateSection(idx, 'required', e.target.checked)} className="rounded" />
                    Req
                  </label>
                  <Button type="button" size="icon" variant="ghost" className="h-7 w-7 shrink-0 mt-0.5" onClick={() => removeSection(idx)}><X className="h-3 w-3" /></Button>
                </div>
              ))}
            </div>
          </div>
        </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={handleCreate}><Plus className="h-4 w-4 mr-2" /> Create Template</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={!!editItem} onOpenChange={() => setEditItem(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="font-heading">Edit Template — {editItem?.name}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
          <div className="space-y-2"><Label>Template Name *</Label><Input value={form.name || ''} onChange={e => updateField('name', e.target.value)} placeholder="e.g. SAP S/4HANA Implementation Proposal" /></div>
          <div className="space-y-2"><Label>Description</Label><Textarea value={form.description || ''} onChange={e => updateField('description', e.target.value)} placeholder="What is this template for?" rows={2} /></div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2"><Label>Category</Label>
              <Select value={form.category || 'General'} onValueChange={v => updateField('category', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{categories.map(cat => <SelectItem key={cat} value={cat}>{cat}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2"><Label>Opportunity Type</Label>
              <Select value={form.opportunity_type || ''} onValueChange={v => updateField('opportunity_type', v)}>
                <SelectTrigger><SelectValue placeholder="Any" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Any</SelectItem>
                  {opportunityTypes.filter(Boolean).map(ot => <SelectItem key={ot} value={ot}>{ot}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Tags</Label>
            <div className="flex items-center gap-2">
              <Input value={tagInput} onChange={e => setTagInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addTag())} placeholder="Add tag and press Enter" className="h-8" />
              <Button type="button" size="sm" variant="outline" onClick={addTag}>Add</Button>
            </div>
            {(form.tags || []).length > 0 && (
              <div className="flex flex-wrap gap-1">
                {(form.tags || []).map(tag => (
                  <span key={tag} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs">
                    {tag}<button type="button" onClick={() => removeTag(tag)}><X className="h-2.5 w-2.5" /></button>
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-semibold">Template Sections</Label>
              <Button type="button" size="sm" variant="outline" onClick={addSection}><Plus className="h-3 w-3 mr-1" /> Add Section</Button>
            </div>
            <div className="space-y-2 max-h-[280px] overflow-y-auto pr-1">
              {(form.sections || []).map((sec, idx) => (
                <div key={sec.id} className="flex items-start gap-2 p-2 rounded-lg border bg-muted/20">
                  <GripVertical className="h-4 w-4 mt-2 text-muted-foreground shrink-0" />
                  <div className="flex-1 space-y-1">
                    <Input value={sec.title} onChange={e => updateSection(idx, 'title', e.target.value)} placeholder="Section title" className="h-8 text-sm" />
                    <Input value={sec.description} onChange={e => updateSection(idx, 'description', e.target.value)} placeholder="Brief description" className="h-7 text-xs" />
                  </div>
                  <label className="flex items-center gap-1 text-xs text-muted-foreground mt-2 shrink-0">
                    <input type="checkbox" checked={sec.required} onChange={e => updateSection(idx, 'required', e.target.checked)} className="rounded" />
                    Req
                  </label>
                  <Button type="button" size="icon" variant="ghost" className="h-7 w-7 shrink-0 mt-0.5" onClick={() => removeSection(idx)}><X className="h-3 w-3" /></Button>
                </div>
              ))}
            </div>
          </div>
        </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditItem(null)}>Cancel</Button>
            <Button onClick={handleSaveEdit}><CheckCircle className="h-4 w-4 mr-2" /> Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}