import { useParams, useNavigate } from 'react-router-dom';
import { useState, useCallback, useMemo, useEffect } from 'react';
import { useProposals } from '@/contexts/ProposalContext';
import { useCommercialRules } from '@/contexts/CommercialRulesContext';
import { proposalStages, legalClauses } from '@/data/mockData';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { ArrowLeft, Sparkles, Check, RotateCcw, Edit, MessageSquare, Lock, Download, FileText, Loader2, Send, CheckCircle, XCircle, DollarSign, AlertTriangle, Info, Users, X } from 'lucide-react';
import { exportProposalToWord } from '@/lib/exportProposal';
import { generateFullDraft, generateSingleSection, getSectionListForType, type ProposalInputs, type RAGConfig, DEFAULT_RAG_CONFIG } from '@/lib/generateProposalContent';
import { useToast } from '@/hooks/use-toast';
import { useResources, type DbResource } from '@/hooks/useResources';
import { TeamBuilderDialog } from '@/components/resources/TeamBuilderDialog';
import { supabase } from '@/integrations/supabase/client';
import { ReworkDialog } from '@/components/ReworkDialog';
import { ROLE_TAB_ACCESS, REWORK_COMMENT_VISIBILITY, type ReworkComment } from '@/contexts/ProposalContext';
import { useAuth } from '@/contexts/AuthContext';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

type SectionStatus = 'AI-generated' | 'pending review' | 'approved' | 'manually edited';
type ProposalSection = { name: string; status: SectionStatus; content: string };

// Sections are initialised dynamically from the proposal type — no hardcoded defaults
const emptySection = (name: string): ProposalSection => ({ name, status: 'pending review', content: '' });

const sectionStatusColors: Record<string, string> = {
  'AI-generated': 'bg-info/10 text-info',
  'manually edited': 'bg-warning/10 text-warning',
  'approved': 'bg-success/10 text-success',
  'pending review': 'bg-muted text-muted-foreground',
};

// Detect proposal type from lob/opportunityType — mirrors generateProposalContent logic
function detectTypeFromProposal(lob: string, opportunityType?: string): 'implementation' | 'ams' | 'resource_augmentation' | 'solution' {
  const s = (lob || opportunityType || '').toLowerCase();
  if (s.includes('ams') || s.includes('application management')) return 'ams';
  if (s.includes('resource aug') || s.includes('augmentation')) return 'resource_augmentation';
  if (s.includes('btp') || s.includes('integration') || s.includes('upgrade') || s.includes('migration') || s.includes('fiori')) return 'solution';
  return 'implementation';
}

export default function ProposalWorkspacePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { proposals, approvalRecords, updateProposal, submitForReview, handleApproval, sendBackForRework, loading } = useProposals();
  const { getMatchingRates, marginThreshold, rules } = useCommercialRules();
  const { toast } = useToast();
  const [sections, setSections] = useState<ProposalSection[]>([]);
  const [generating, setGenerating] = useState<string | null>(null);
  const [ragConfig, setRagConfig] = useState<RAGConfig>(DEFAULT_RAG_CONFIG);
  const [reworkDialogOpen, setReworkDialogOpen] = useState(false);
  const { user } = useAuth();
  const userRole = (user?.role ?? 'Sales') as import('@/data/mockData').UserRole;
  const tabAccess = ROLE_TAB_ACCESS[userRole] ?? ROLE_TAB_ACCESS['Sales'];
  const [activeTab, setActiveTab] = useState('overview');
  const [exporting, setExporting] = useState<string | null>(null);
  const [editingSection, setEditingSection] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');

  // Team Builder state
  const { data: dbResources = [] } = useResources();
  const [selectedTeamIds, setSelectedTeamIds] = useState<Set<string>>(new Set());
  const [teamBuilderOpen, setTeamBuilderOpen] = useState(false);
  const [approvedTemplates, setApprovedTemplates] = useState<{ id: string; name: string; category: string; sections: { id: string; title: string; description: string; required: boolean }[] }[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');

  // Load approved templates from Supabase for the template selector
  useEffect(() => {
    supabase
      .from('proposal_templates')
      .select('id, name, category, sections')
      .eq('status', 'Approved')
      .order('name')
      .then(({ data }) => {
        if (data) setApprovedTemplates(data.map(d => ({
          ...d,
          sections: Array.isArray(d.sections) ? d.sections as { id: string; title: string; description: string; required: boolean }[] : [],
        })));
      });
  }, []);

  // Apply a template's sections to the draft
  const applyTemplate = (templateId: string) => {
    const tpl = approvedTemplates.find(t => t.id === templateId);
    if (!tpl) return;
    // Structural sections that AI should not write — handled by export/other tabs
    const structural = new Set(['Cover Page', 'Annexures', 'Commercial Proposal', 'Team Structure']);
    const newSections = tpl.sections
      .filter(s => s.title.trim())
      .map(s => ({
        name: s.title,
        content: structural.has(s.title)
          ? `This section is assembled automatically from the ${s.title.toLowerCase()} data.`
          : `Click "Generate" or "Generate Full Draft" to create AI content for this section.`,
        status: structural.has(s.title) ? ('approved' as const) : ('pending review' as const),
      }));
    setSections(newSections);
    setSelectedTemplateId(templateId);
    toast({ title: '📋 Template Applied', description: `Sections loaded from "${tpl.name}". Click Generate Full Draft to write content.` });
  };

  const proposal = proposals.find(p => p.id === id);

  // FIX: Initialise sections from proposal type + any previously persisted section content.
  // Runs once when proposal first resolves. Prevents generic hardcoded sections loading
  // for an AMS or Resource Augmentation proposal.
  useEffect(() => {
    if (!proposal) return;
    const type = detectTypeFromProposal(proposal.lob, proposal.opportunityType);
    const names = getSectionListForType(type);
    // If metadata has persisted sections, restore their content
    const persisted: { name: string; content: string; status: string }[] =
      (proposal.metadata as any)?.sections ?? [];
    const persistedMap = new Map(persisted.map(s => [s.name.toLowerCase(), s]));
    setSections(names.map(name => {
      const saved = persistedMap.get(name.toLowerCase());
      return saved
        ? { name, content: saved.content, status: saved.status as SectionStatus }
        : emptySection(name);
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposal?.id, proposal?.lob]);

  const selectedTeam = useMemo(() => dbResources.filter(r => selectedTeamIds.has(r.id)), [dbResources, selectedTeamIds]);
  const teamTotalCost = useMemo(() => selectedTeam.reduce((sum, r) => sum + r.cost_rate * (1 + r.cost_loading_percentage / 100), 0), [selectedTeam]);
  const teamTotalBilling = useMemo(() => selectedTeam.reduce((sum, r) => sum + r.billing_rate, 0), [selectedTeam]);
  const teamBlendedMargin = teamTotalBilling > 0 ? ((teamTotalBilling - teamTotalCost) / teamTotalBilling * 100).toFixed(1) : '0';

  const handleTeamSelect = useCallback((ids: Set<string>) => {
    setSelectedTeamIds(ids);
    setTeamBuilderOpen(false);
    toast({ title: `✓ Team Updated`, description: `${ids.size} resources selected for this proposal.` });
  }, [toast]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span className="ml-3 text-muted-foreground">Loading proposal...</span>
      </div>
    );
  }

  if (!proposal) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <p className="text-muted-foreground">Proposal not found</p>
        <Button variant="outline" onClick={() => navigate('/proposals')}>
          <ArrowLeft className="h-4 w-4 mr-2" /> Back to Proposals
        </Button>
      </div>
    );
  }

  const matchingRates = getMatchingRates(proposal.geography, proposal.modules);
  const approvals = approvalRecords.filter(a => a.proposalId === proposal.id);
  const pendingApproval = approvalRecords.find(a => a.proposalId === proposal.id && a.decision === 'Pending' && a.stage === proposal.status);
  const isReviewStage = ['Pre-Sales Review', 'Delivery Review', 'Finance Review', 'Legal Review', 'Final Approval'].includes(proposal.status);

  const activeLegalClauses = legalClauses.filter(c => c.status === 'Active');

  const handleExport = async (type: 'client' | 'internal' | 'with-cv' | 'without-cv') => {
    setExporting(type);
    try {
      // Use React state sections if they have content, otherwise fall back to metadata
      const persistedSections = ((proposal.metadata as any)?.sections ?? []) as { name: string; content: string; status: string }[];
      const exportSections = sections.some(s => s.content?.trim().length > 20)
        ? sections
        : persistedSections.length > 0
          ? persistedSections
          : sections;

      const filename = await exportProposalToWord({
        proposal,
        sections: exportSections,
        includeAnnexures: type !== 'without-cv',
        isInternal: type === 'internal',
        teamMembers: selectedTeam.map(r => ({
          name: r.name,
          designation: r.designation,
          billing_rate: r.billing_rate,
          cost_rate: r.cost_rate,
          cost_loading_percentage: r.cost_loading_percentage,
          availability: r.availability,
        })),
        legalClauses: activeLegalClauses,
        rateCards: matchingRates,
        commercialRules: rules,
        fxRates: { USD: 84.0, EUR: 91.0, SGD: 63.0, AUD: 55.0, AED: 22.9 },
        coverLetter: (proposal.metadata as any)?.coverLetter ?? undefined,
      });
      toast({ title: '✓ Export Complete', description: `Downloaded ${filename}` });
    } catch (e) {
      toast({ title: 'Export Failed', description: String(e), variant: 'destructive' });
    } finally {
      setExporting(null);
    }
  };

  const currentStageIndex = proposalStages.indexOf(proposal.status);

  const toProposalInputs = (): ProposalInputs => ({
    id: proposal.id,
    title: proposal.title,
    clientName: proposal.clientName,
    clientGroup: proposal.clientGroup,
    industry: proposal.industry,
    geography: proposal.geography,
    lob: proposal.lob,
    opportunityType: proposal.opportunityType,
    dealType: proposal.dealType,
    modules: proposal.modules,
    expectedDuration: proposal.expectedDuration,
    expectedRevenue: proposal.expectedRevenue,
    currency: proposal.currency,
    grossMargin: proposal.grossMargin,
    discount: proposal.discount,
    // Rich wizard fields from metadata
    ...proposal.metadata,
    // RFP raw text — primary source for AI generation
    rfpRawText: proposal.metadata?.rfpRawText,
    // Pre-sales briefing — verified context for hallucination reduction
    presalesBriefing: (proposal.metadata as any)?.presalesBriefing ?? null,
    validityDays: (proposal.metadata as any)?.coverLetter?.validityDays ?? 90,
  });

  // FIX: Persist generated/edited section content to proposals.metadata so it survives page reload
  const persistSections = useCallback(async (updatedSections: ProposalSection[]) => {
    if (!proposal) return;
    try {
      const existingMeta = (proposal.metadata as any) ?? {};
      await supabase.from('proposals' as never).update({
        metadata: { ...existingMeta, sections: updatedSections },
        updated_at: new Date().toISOString(),
      } as never).eq('id', proposal.id);
    } catch { /* non-critical — sections still live in React state */ }
  }, [proposal]);

  const handleGenerate = async (sectionName: string) => {
    setGenerating(sectionName);
    try {
      if (sectionName === 'all') {
        const result = await generateFullDraft(toProposalInputs());
        setSections(prev => {
          const updated = prev.map(s => {
            const match = result.sections.find(
              g => g.name.toLowerCase() === s.name.toLowerCase()
            );
            return match ? { ...s, content: match.content, status: 'AI-generated' as const } : s;
          });
          // Also add any sections returned by AI that don't exist yet (new section types)
          const existingNames = new Set(updated.map(s => s.name.toLowerCase()));
          const extras = result.sections
            .filter(g => !existingNames.has(g.name.toLowerCase()))
            .map(g => ({ name: g.name, content: g.content, status: 'AI-generated' as const }));
          const final = [...updated, ...extras];
          void persistSections(final);
          return final;
        });
        toast({ title: '✅ Full Draft Generated', description: `${result.sections.length} sections generated using APNJ-LLM-Studio.` });
      } else {
        const section = await generateSingleSection(sectionName, toProposalInputs());
        setSections(prev => {
          const updated = prev.map(s =>
            s.name.toLowerCase() === sectionName.toLowerCase()
              ? { ...s, content: section.content, status: 'AI-generated' as const }
              : s
          );
          void persistSections(updated);
          return updated;
        });
        toast({ title: '✅ Section Generated', description: `"${sectionName}" has been rewritten by AI.` });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'AI generation failed';
      toast({ title: '❌ Generation Failed', description: message, variant: 'destructive' });
    } finally {
      setGenerating(null);
    }
  };

  const handleReworkConfirm = async (comment: string, category: ReworkComment['category']) => {
    await sendBackForRework(proposal.id, comment, category, user?.name ?? 'Approver', userRole);
    setReworkDialogOpen(false);
    toast({ title: '↩ Sent Back for Rework', description: `"${proposal.title}" returned to Draft. ${proposal.owner} has been notified.` });
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {reworkDialogOpen && (
        <ReworkDialog
          proposalTitle={proposal.title}
          currentStage={proposal.status}
          onConfirm={handleReworkConfirm}
          onCancel={() => setReworkDialogOpen(false)}
        />
      )}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/proposals')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <h1 className="text-xl font-bold font-heading">{proposal.title}</h1>
          <p className="text-sm text-muted-foreground">{proposal.id} · {proposal.clientName} · {proposal.owner}</p>
        </div>
        <StatusBadge status={proposal.status} />
        <StatusBadge status={proposal.priority} />
        {proposal.status === 'Draft' && (
          <Button onClick={() => {
            submitForReview(proposal.id);
            toast({ title: '🚀 Submitted for Review', description: `${proposal.title} has been submitted to Pre-Sales Review.` });
          }}>
            <Send className="h-4 w-4 mr-2" /> Submit for Review
          </Button>
        )}
        {isReviewStage && pendingApproval && (
          <div className="flex items-center gap-2">
            <Button variant="outline" className="text-success border-success/30 hover:bg-success/10" onClick={() => {
              handleApproval(pendingApproval.id, 'Approved');
              toast({ title: '✓ Approved', description: `${proposal.title} approved at ${proposal.status}. Moving to next stage.` });
            }}>
              <CheckCircle className="h-4 w-4 mr-2" /> Approve & Advance
            </Button>
            <Button variant="outline" className="text-destructive border-destructive/30 hover:bg-destructive/10" onClick={() => {
              handleApproval(pendingApproval.id, 'Rejected');
              toast({ title: '✗ Rejected', description: `${proposal.title} sent back to Draft.` });
            }}>
              <XCircle className="h-4 w-4 mr-2" /> Reject
            </Button>
            <Button variant="outline" className="text-warning border-warning/30 hover:bg-warning/10" onClick={() => setReworkDialogOpen(true)}>
              <RotateCcw className="h-4 w-4 mr-2" /> Send Back for Rework
            </Button>
          </div>
        )}
        {isReviewStage && !pendingApproval && (
          <span className="text-xs text-muted-foreground italic">Awaiting approval record…</span>
        )}
        <Button onClick={() => { setActiveTab('export'); }} variant="outline" size="sm">
          <Download className="h-4 w-4 mr-2" /> Export
        </Button>
      </div>

      {/* Workflow Timeline */}
      <Card className="enterprise-shadow">
        <CardContent className="pt-4">
          <div className="flex items-center gap-1 overflow-x-auto pb-2">
            {proposalStages.slice(0, -1).map((stage, i) => (
              <div key={stage} className="flex items-center gap-1 shrink-0">
                <div className={`px-3 py-1.5 rounded text-xs font-medium whitespace-nowrap ${
                  i < currentStageIndex ? 'bg-success/10 text-success' :
                  i === currentStageIndex ? 'bg-primary text-primary-foreground' :
                  'bg-muted text-muted-foreground'
                }`}>
                  {i < currentStageIndex && <Check className="h-3 w-3 inline mr-1" />}
                  {stage}
                </div>
                {i < proposalStages.length - 2 && <div className="w-4 h-0.5 bg-border shrink-0" />}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="ai-draft">AI Draft</TabsTrigger>
          <TabsTrigger value="commercials">Commercials</TabsTrigger>
          <TabsTrigger value="legal">Legal</TabsTrigger>
          <TabsTrigger value="team">Team & CVs</TabsTrigger>
          <TabsTrigger value="approvals">Approvals</TabsTrigger>
          <TabsTrigger value="export">Export</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4 mt-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="enterprise-shadow">
              <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Deal Details</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">LOB</span><span className="font-medium">{proposal.lob}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Deal Type</span><span className="font-medium">{proposal.dealType}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Duration</span><span className="font-medium">{proposal.expectedDuration}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Modules</span><span className="font-medium">{proposal.modules.join(', ')}</span></div>
              </CardContent>
            </Card>
            <Card className="enterprise-shadow">
              <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Financials</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Revenue</span><span className="font-medium">{proposal.currency === 'INR' ? '₹' : '$'}{(proposal.expectedRevenue / (proposal.currency === 'INR' ? 10000000 : 1000000)).toFixed(1)}{proposal.currency === 'INR' ? ' Cr' : 'M'}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Gross Margin</span><span className={`font-medium ${proposal.grossMargin < marginThreshold ? 'text-destructive' : 'text-success'}`}>{proposal.grossMargin}%</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Discount</span><span className={`font-medium ${proposal.discount > 5 ? 'text-warning' : ''}`}>{proposal.discount}%</span></div>
              </CardContent>
            </Card>
            <Card className="enterprise-shadow">
              <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Timeline</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Created</span><span>{new Date(proposal.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Last Updated</span><span>{new Date(proposal.updatedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Deadline</span><span className="font-medium">{new Date(proposal.submissionDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Risk</span><StatusBadge status={proposal.riskLevel} /></div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="ai-draft" className="space-y-4 mt-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-heading font-semibold">Proposal Content Builder</h2>
                <p className="text-xs text-muted-foreground">Select a template to load sections, then generate AI content.</p>
              </div>
              <Button onClick={() => handleGenerate('all')} disabled={!!generating}>
                {generating === 'all' ? <><span className="animate-spin mr-2">⟳</span> Generating…</> : <><Sparkles className="h-4 w-4 mr-2" /> Generate Full Draft</>}
              </Button>
            </div>
            {/* Template selector */}
            <div className="flex items-center gap-3 p-3 rounded-lg border bg-muted/30">
              <span className="text-sm font-medium shrink-0">Template:</span>
              <Select value={selectedTemplateId} onValueChange={applyTemplate}>
                <SelectTrigger className="h-8 flex-1 max-w-xs">
                  <SelectValue placeholder={approvedTemplates.length === 0 ? 'No approved templates yet' : 'Pick a template to load sections…'} />
                </SelectTrigger>
                <SelectContent>
                  {approvedTemplates.map(t => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name} <span className="text-muted-foreground text-xs ml-1">({t.sections.length} sections)</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedTemplateId && (
                <span className="text-xs text-success font-medium">✓ {sections.length} sections loaded</span>
              )}
              {approvedTemplates.length === 0 && (
                <span className="text-xs text-muted-foreground">Go to Templates → approve a template first</span>
              )}
            </div>
          </div>
          {sections.map((section, i) => (
            <Card key={i} className="enterprise-shadow">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base font-heading">{section.name}</CardTitle>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${sectionStatusColors[section.status]}`}>{section.status}</span>
                    <Button variant="ghost" size="sm" onClick={() => handleGenerate(section.name)} disabled={generating === section.name}>
                      {generating === section.name ? <span className="animate-spin">⟳</span> : <RotateCcw className="h-3 w-3" />}
                    </Button>
                    <Button variant="ghost" size="sm" title="Edit section"
                      onClick={() => { setEditingSection(section.name); setEditContent(section.content); }}>
                      <Edit className="h-3 w-3" />
                    </Button>
                    <Button variant="ghost" size="sm" title="Approve section"
                      onClick={() => {
                        setSections(prev => {
                          const updated = prev.map(s => s.name === section.name
                            ? { ...s, status: 'approved' as const } : s);
                          void persistSections(updated);
                          return updated;
                        });
                        toast({ title: '✓ Section Approved', description: `"${section.name}" marked as approved.` });
                      }}>
                      <Check className="h-3 w-3" />
                    </Button>
                    <Button variant="ghost" size="sm" title="Add comment"
                      onClick={() => toast({ title: 'Comments', description: 'Comment thread coming soon.' })}>
                      <MessageSquare className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {editingSection === section.name ? (
                  <div className="space-y-2">
                    <Textarea
                      value={editContent}
                      onChange={e => setEditContent(e.target.value)}
                      className="min-h-[140px] text-sm leading-relaxed"
                    />
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => {
                        setSections(prev => {
                          const updated = prev.map(s => s.name === section.name
                            ? { ...s, content: editContent, status: 'manually edited' as SectionStatus }
                            : s);
                          void persistSections(updated);
                          return updated;
                        });
                        setEditingSection(null);
                        toast({ title: '✓ Section saved', description: `"${section.name}" updated.` });
                      }}>Save</Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditingSection(null)}>Cancel</Button>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-foreground/80 leading-relaxed">
                    {section.content
                      ? section.content
                      : <span className="italic text-muted-foreground text-xs">No content yet — click ⟳ to generate or ✏ to write.</span>
                    }
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="commercials" className="space-y-4 mt-4">
          <Card className="enterprise-shadow">
            <CardHeader><CardTitle className="font-heading">Commercial Review</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <div className="p-4 rounded-lg bg-muted/50 text-center"><p className="text-xs text-muted-foreground">Total Value</p><p className="text-xl font-bold font-heading">{proposal.currency === 'INR' ? '₹' : '$'}{(proposal.expectedRevenue / (proposal.currency === 'INR' ? 10000000 : 1000000)).toFixed(1)}{proposal.currency === 'INR' ? ' Cr' : 'M'}</p></div>
                <div className="p-4 rounded-lg bg-muted/50 text-center"><p className="text-xs text-muted-foreground">Gross Margin</p><p className={`text-xl font-bold font-heading ${proposal.grossMargin < marginThreshold ? 'text-destructive' : 'text-success'}`}>{proposal.grossMargin}%</p></div>
                <div className="p-4 rounded-lg bg-muted/50 text-center"><p className="text-xs text-muted-foreground">Discount</p><p className={`text-xl font-bold font-heading ${proposal.discount > 5 ? 'text-warning' : ''}`}>{proposal.discount}%</p></div>
                <div className="p-4 rounded-lg bg-muted/50 text-center"><p className="text-xs text-muted-foreground">Deal Type</p><p className="text-lg font-bold font-heading">{proposal.dealType}</p></div>
              </div>
              <div className="space-y-2 mb-6">
                {proposal.grossMargin < marginThreshold && <div className="p-3 rounded-lg bg-destructive/5 border border-destructive/20 text-sm"><span className="font-medium text-destructive">⚠ Low Margin Alert:</span> Gross margin is below {marginThreshold}% threshold. Finance approval required.</div>}
                {proposal.discount > 5 && <div className="p-3 rounded-lg bg-warning/5 border border-warning/20 text-sm"><span className="font-medium text-warning">⚠ Discount Alert:</span> Discount of {proposal.discount}% exceeds 5% threshold. Finance approval required.</div>}
                {proposal.grossMargin >= marginThreshold && proposal.discount <= 5 && <div className="p-3 rounded-lg bg-success/5 border border-success/20 text-sm"><span className="font-medium text-success">✓ Compliant:</span> All commercial parameters within approved thresholds.</div>}
              </div>
            </CardContent>
          </Card>

          {/* Auto-populated Rate Cards */}
          <Card className="enterprise-shadow">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="font-heading flex items-center gap-2"><DollarSign className="h-4 w-4" /> Applicable Rate Cards</CardTitle>
                <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">Auto-populated from Commercial Rules · {proposal.geography}</span>
              </div>
            </CardHeader>
            <CardContent>
              {matchingRates.length === 0 ? (
                <div className="p-4 rounded-lg bg-warning/5 border border-warning/20 text-sm flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-warning shrink-0" />
                  <span>No rate cards found for geography "{proposal.geography}" and selected modules ({proposal.modules.join(', ')}). Please add rates in the <a href="/commercial" className="text-primary underline">Commercial Rules Engine</a>.</span>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="border-b text-left">
                      <th className="pb-3 font-medium text-muted-foreground">Role</th>
                      <th className="pb-3 font-medium text-muted-foreground">Experience</th>
                      <th className="pb-3 font-medium text-muted-foreground">Billing Rate</th>
                      <th className="pb-3 font-medium text-muted-foreground">Cost Rate</th>
                      <th className="pb-3 font-medium text-muted-foreground">Margin</th>
                      <th className="pb-3 font-medium text-muted-foreground">Status</th>
                    </tr></thead>
                    <tbody>
                      {matchingRates.map(r => {
                        // Use rate card's native currency — not proposal currency
                        const rcSym = r.currency === 'INR' ? '₹' : r.currency === 'EUR' ? '€' : r.currency === 'SGD' ? 'S$' : r.currency === 'AUD' ? 'A$' : r.currency === 'AED' ? 'د.إ' : '$';
                        return (
                        <tr key={r.id} className="border-b last:border-0 hover:bg-muted/30">
                          <td className="py-3 font-medium">{r.skill}</td>
                          <td className="py-3 text-xs">{r.experienceBand}</td>
                          <td className="py-3">{rcSym}{r.billingRate.toLocaleString('en-IN')}/hr</td>
                          <td className="py-3 text-muted-foreground">{rcSym}{r.costRate.toLocaleString('en-IN')}/hr</td>
                          <td className="py-3">
                            <span className={r.margin < marginThreshold ? 'text-destructive font-bold' : r.margin < 45 ? 'text-warning font-medium' : 'text-success font-medium'}>
                              {r.margin}%{r.margin < marginThreshold && ' ⚠'}
                            </span>
                          </td>
                          <td className="py-3"><span className="text-xs px-2 py-0.5 rounded-full bg-success/10 text-success">From Rate Card</span></td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <div className="mt-3 p-3 rounded-lg bg-info/5 border border-info/20 text-xs flex items-center gap-2">
                    <Info className="h-3.5 w-3.5 text-info shrink-0" />
                    <span>Rates auto-populated based on proposal geography ({proposal.geography}) and modules ({proposal.modules.join(', ')}). Blended billing rate: <strong>{matchingRates.length > 0 ? (matchingRates[0].currency === 'INR' ? '₹' : matchingRates[0].currency === 'EUR' ? '€' : matchingRates[0].currency === 'SGD' ? 'S$' : '$') : '₹'}{Math.round(matchingRates.reduce((s, r) => s + r.billingRate, 0) / Math.max(matchingRates.length, 1)).toLocaleString('en-IN')}/hr avg</strong> across {matchingRates.length} roles. Edit rates in the <a href="/commercial" className="text-primary underline">Commercial Rules Engine</a>.</span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Team Resource Rates (from Team Builder) */}
          {selectedTeam.length > 0 && (
            <Card className="enterprise-shadow">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="font-heading flex items-center gap-2"><Users className="h-4 w-4" /> Team Resource Rates</CardTitle>
                  <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">From Team Builder · {selectedTeam.length} members</span>
                </div>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="border-b text-left">
                      <th className="pb-3 font-medium text-muted-foreground">Name</th>
                      <th className="pb-3 font-medium text-muted-foreground">Role</th>
                      <th className="pb-3 font-medium text-muted-foreground">Billing Rate</th>
                      <th className="pb-3 font-medium text-muted-foreground">Loaded Cost</th>
                      <th className="pb-3 font-medium text-muted-foreground">Margin</th>
                      <th className="pb-3 font-medium text-muted-foreground">Availability</th>
                    </tr></thead>
                    <tbody>
                      {selectedTeam.map(r => {
                        const loadedCost = r.cost_rate * (1 + r.cost_loading_percentage / 100);
                        const margin = r.billing_rate > 0 ? ((r.billing_rate - loadedCost) / r.billing_rate * 100) : 0;
                        return (
                          <tr key={r.id} className="border-b last:border-0 hover:bg-muted/30">
                            <td className="py-3 font-medium">{r.name}</td>
                            <td className="py-3 text-xs">{r.designation}</td>
                            <td className="py-3">${r.billing_rate}/hr</td>
                            <td className="py-3 text-muted-foreground">${loadedCost.toFixed(0)}/hr</td>
                            <td className="py-3">
                              <span className={margin < marginThreshold ? 'text-destructive font-bold' : margin < marginThreshold + 15 ? 'text-warning font-medium' : 'text-success font-medium'}>
                                {margin.toFixed(1)}%{margin < 30 && ' ⚠'}
                              </span>
                            </td>
                            <td className="py-3"><StatusBadge status={r.availability} /></td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t font-semibold">
                        <td className="py-3" colSpan={2}>Blended Total</td>
                        <td className="py-3">${teamTotalBilling.toFixed(0)}/hr</td>
                        <td className="py-3">${teamTotalCost.toFixed(0)}/hr</td>
                        <td className="py-3">
                          <span className={parseFloat(teamBlendedMargin) < marginThreshold ? 'text-destructive font-bold' : 'text-success font-medium'}>
                            {teamBlendedMargin}%
                          </span>
                        </td>
                        <td></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          <Card className="enterprise-shadow">
            <CardHeader><CardTitle className="font-heading flex items-center gap-2"><AlertTriangle className="h-4 w-4" /> Active Governance Rules</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {rules.filter(r => r.status === 'Active').map(r => (
                  <div key={r.id} className="p-3 rounded-lg border flex items-center justify-between">
                    <div><p className="text-sm font-medium">{r.rule}</p><p className="text-xs text-muted-foreground">{r.value}</p></div>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-success/10 text-success">Enforced</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="legal" className="space-y-4 mt-4">
          <Card className="enterprise-shadow">
            <CardHeader><CardTitle className="font-heading">Legal Clause Selection</CardTitle></CardHeader>
            <CardContent>
              <table className="w-full text-sm">
                <thead><tr className="border-b"><th className="pb-2 text-left text-muted-foreground">Category</th><th className="pb-2 text-left text-muted-foreground">Clause</th><th className="pb-2 text-left text-muted-foreground">Version</th><th className="pb-2 text-left text-muted-foreground">Status</th></tr></thead>
                <tbody>
                  {legalClauses.filter(c => c.status === 'Active').slice(0, 8).map(c => (
                    <tr key={c.id} className="border-b last:border-0">
                      <td className="py-2.5">{c.category}</td>
                      <td className="py-2.5 font-medium">{c.title}</td>
                      <td className="py-2.5 text-xs text-muted-foreground">v{c.version}</td>
                      <td className="py-2.5"><StatusBadge status="Approved" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="team" className="space-y-4 mt-4">
          <Card className="enterprise-shadow">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="font-heading">Proposed Team ({selectedTeam.length} members)</CardTitle>
                <Button onClick={() => setTeamBuilderOpen(true)}>
                  <Users className="h-4 w-4 mr-2" /> {selectedTeam.length > 0 ? 'Edit Team' : 'Build Team'}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {selectedTeam.length === 0 ? (
                <div className="text-center py-8">
                  <Users className="h-10 w-10 mx-auto text-muted-foreground/40 mb-2" />
                  <p className="text-sm text-muted-foreground">No team members selected yet.</p>
                  <p className="text-xs text-muted-foreground mt-1">Use the Team Builder to select resources — their rates will auto-populate in the Commercials tab.</p>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {selectedTeam.map(r => (
                      <div key={r.id} className="p-3 rounded-lg border hover:bg-muted/30 transition-colors">
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary shrink-0">
                            {r.name.split(' ').map(n => n[0]).join('')}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm truncate">{r.name}</p>
                            <p className="text-xs text-muted-foreground truncate">{r.designation}</p>
                            <div className="flex items-center gap-2 mt-1">
                              <span className="text-xs text-muted-foreground">{r.years_of_experience} yrs</span>
                              <StatusBadge status={r.availability} />
                            </div>
                          </div>
                          <button onClick={() => setSelectedTeamIds(prev => { const n = new Set(prev); n.delete(r.id); return n; })} className="text-muted-foreground hover:text-destructive shrink-0">
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <div className="mt-2 pt-2 border-t flex items-center justify-between text-xs text-muted-foreground">
                          <span>${r.billing_rate}/hr billing</span>
                          <span>${(r.cost_rate * (1 + r.cost_loading_percentage / 100)).toFixed(0)}/hr loaded</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 p-3 rounded-lg bg-info/5 border border-info/20 text-xs flex items-center gap-2">
                    <Info className="h-3.5 w-3.5 text-info shrink-0" />
                    <span>Team blended billing: <strong>${teamTotalBilling.toFixed(0)}/hr</strong> · Loaded cost: <strong>${teamTotalCost.toFixed(0)}/hr</strong> · Margin: <strong className={parseFloat(teamBlendedMargin) >= marginThreshold ? 'text-success' : 'text-destructive'}>{teamBlendedMargin}%</strong></span>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <TeamBuilderDialog
            open={teamBuilderOpen}
            onOpenChange={setTeamBuilderOpen}
            resources={dbResources}
            initialSelected={selectedTeamIds}
            onConfirm={handleTeamSelect}
          />
        </TabsContent>

        <TabsContent value="approvals" className="space-y-4 mt-4">
          {/* Rework comments — role-scoped visibility */}
          {(() => {
            const allRework = ((proposal.metadata as any)?.reworkComments ?? []) as ReworkComment[];
            const visible = allRework.filter(c =>
              REWORK_COMMENT_VISIBILITY[userRole]?.includes(c.category)
            );
            if (visible.length === 0) return null;
            return (
              <Card className="enterprise-shadow border-warning/30">
                <CardHeader className="pb-2">
                  <CardTitle className="font-heading text-sm flex items-center gap-2">
                    <RotateCcw className="h-4 w-4 text-warning" /> Rework Comments
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {visible.map((c, i) => (
                    <div key={i} className="p-3 rounded-lg border border-warning/20 bg-warning/5 space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{c.by}</span>
                          <span className="text-muted-foreground">({c.byRole})</span>
                          <span className="px-1.5 py-0.5 rounded bg-warning/20 text-warning font-medium">{c.category}</span>
                          <span className="text-muted-foreground">at {c.stage}</span>
                        </div>
                        <span className="text-muted-foreground">{c.timestamp}</span>
                      </div>
                      <p className="text-sm">{c.comment}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            );
          })()}
          <Card className="enterprise-shadow">
            <CardHeader><CardTitle className="font-heading">Approval History</CardTitle></CardHeader>
            <CardContent>
              {approvals.length === 0 ? <p className="text-sm text-muted-foreground">No approval records yet.</p> : (
                <div className="space-y-3">
                  {approvals.map(a => (
                    <div key={a.id} className="flex items-start gap-3 p-3 rounded-lg border">
                      <div className={`h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${a.decision === 'Approved' ? 'bg-success/10 text-success' : a.decision === 'Pending' ? 'bg-warning/10 text-warning' : 'bg-destructive/10 text-destructive'}`}>
                        {a.decision === 'Approved' ? '✓' : a.decision === 'Pending' ? '⏳' : '✗'}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-medium">{a.stage}</p>
                          <StatusBadge status={a.decision} />
                        </div>
                        <p className="text-xs text-muted-foreground">{a.approver} · {a.approverRole} · {a.timestamp}</p>
                        {a.comments && <p className="text-sm mt-1 text-foreground/80">{a.comments}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="export" className="space-y-4 mt-4">
          <Card className="enterprise-shadow">
            <CardHeader><CardTitle className="font-heading">Export Center</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">Assemble and export the final proposal document.</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {([
                  { key: 'client' as const, label: 'Client-Facing Proposal (Word)', desc: 'Full proposal with all sections' },
                  { key: 'internal' as const, label: 'Internal Review Version (Word)', desc: 'With section status annotations' },
                  { key: 'with-cv' as const, label: 'With CV Annexures', desc: 'Includes selected team CVs' },
                  { key: 'without-cv' as const, label: 'Without CV Annexures', desc: 'Core proposal only' },
                ]).map((opt) => (
                  <button key={opt.key} onClick={() => handleExport(opt.key)} disabled={!!exporting}
                    className="flex items-center gap-3 p-4 rounded-lg border hover:bg-muted/30 transition-colors text-left disabled:opacity-50">
                    {exporting === opt.key ? <Loader2 className="h-5 w-5 text-primary shrink-0 animate-spin" /> : <Download className="h-5 w-5 text-primary shrink-0" />}
                    <div>
                      <p className="text-sm font-medium">{opt.label}</p>
                      <p className="text-xs text-muted-foreground">{opt.desc}</p>
                    </div>
                  </button>
                ))}
              </div>
              {proposal.approvalProgress < 100 && (
                <div className="p-3 rounded-lg bg-warning/5 border border-warning/20 text-sm">
                  <Lock className="h-4 w-4 inline mr-1 text-warning" />
                  <span className="text-warning font-medium">Note:</span> Some approvals are still pending. Exported document will be marked accordingly.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}