/**
 * PreSalesBriefingStep.tsx
 * ────────────────────────────────────────────────────────────────
 * Step 1.5 in the New Proposal wizard.
 * Pre-sales fills verified answers before Qwen generates anything.
 * This context is injected into every generation call.
 * ────────────────────────────────────────────────────────────────
 */

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Sparkles, Loader2, Check, BookOpen, Users, FileText, AlertCircle, ChevronDown, ChevronUp, Lock, Lightbulb } from 'lucide-react';
import { ComplianceChecklistStep } from '@/components/ComplianceChecklistStep';
import type { ComplianceChecklist } from '@/lib/generateComplianceChecklist';
import {
  generateQuestionnaire,
  CATEGORY_COLORS,
  type BriefingQuestion,
  type ResourceHourEntry,
  type PresalesBriefing,
} from '@/lib/generateQuestionnaire';
import { generateResourceEstimate, type ResourceEstimateResult } from '@/lib/pricingCalculator';
import type { RateCard } from '@/data/mockData';
import type { DbResource } from '@/hooks/useResources';

interface Props {
  // From wizard state
  rfpRawText:      string;
  opportunityType: string;
  clientName:      string;
  modules:         string[];
  geography:       string;
  industry:        string;
  lob:             string;
  dealType:        string;
  expectedDuration:string;
  rfpSessionId:    string;
  costBasis:       'marginal' | 'absorption';
  currency:        string;
  // Available resources
  availableRateCards: RateCard[];
  dbResources:        DbResource[];
  // KB documents from KnowledgeBase
  kbDocuments: { id: string; title: string; type: string }[];
  // Current briefing value
  briefing: PresalesBriefing | null;
  onChange: (briefing: PresalesBriefing) => void;
  checklist: ComplianceChecklist | null;
  onChecklistChange: (checklist: ComplianceChecklist) => void;
}

function detectType(lob: string, ot: string): 'ams' | 'implementation' | 'resource_augmentation' | 'solution' {
  const s = (lob || ot || '').toLowerCase();
  if (s.includes('ams') || s.includes('application management')) return 'ams';
  if (s.includes('resource aug') || s.includes('augmentation')) return 'resource_augmentation';
  if (s.includes('btp') || s.includes('integration') || s.includes('upgrade') || s.includes('migration') || s.includes('fiori')) return 'solution';
  return 'implementation';
}

export function PreSalesBriefingStep({ rfpRawText, opportunityType, clientName, modules, geography, industry, lob, dealType, expectedDuration, rfpSessionId, costBasis, currency, availableRateCards, dbResources, kbDocuments, briefing, onChange, checklist, onChecklistChange }: Props) {
  const [generatingQ, setGeneratingQ]   = useState(false);
  const [estimatingR,  setEstimatingR]  = useState(false);
  const [collapsedCats, setCollapsedCats] = useState<Set<string>>(new Set());

  const proposalType = detectType(lob, opportunityType);

  // ── Auto-generate questionnaire on mount if RFP is available and no briefing yet ──
  useEffect(() => {
    if (availableRateCards.length === 0) return; // wait for rate cards to load
    if (briefing?.resourceHours && briefing.resourceHours.length > 0) return; // already estimated
    if (rfpRawText && rfpRawText.length > 100) {
      handleGenerateQuestions();
      handleEstimateResources();
    } else {
      handleGenerateQuestions();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableRateCards.length]);

  const emptyBriefing = (): PresalesBriefing => ({
    qa: [], resourceHours: [], presalesNotes: '', kbDocIds: [],
    generatedAt: new Date().toISOString(), contextSectionComplete: false,
  });

  // ── Generate questionnaire ─────────────────────────────────────────────────
  const handleGenerateQuestions = useCallback(async () => {
    setGeneratingQ(true);
    try {
      const questions = await generateQuestionnaire(rfpRawText, proposalType, clientName, modules);
      const current = briefing ?? emptyBriefing();
      // Preserve existing answers if re-generating
      const answerMap = new Map((current.qa ?? []).map(q => [q.question, q.answer]));
      const merged = questions.map(q => ({
        ...q,
        answer: answerMap.get(q.question) ?? '',
      }));
      onChange({ ...current, qa: merged, generatedAt: new Date().toISOString() });
    } finally {
      setGeneratingQ(false);
    }
  }, [rfpRawText, proposalType, clientName, modules, briefing, onChange]);

  // ── Estimate resources ─────────────────────────────────────────────────────
  const handleEstimateResources = useCallback(async () => {
    setEstimatingR(true);
    try {
      const result: ResourceEstimateResult = await generateResourceEstimate({
        opportunityName: clientName || 'SAP Engagement',
        clientName: clientName || 'Client',
        geography: geography || 'India',
        industry: industry || '',
        opportunityType: opportunityType || lob || 'SAP Implementation – Rise',
        modules: modules.length > 0 ? modules : [],
        projectType: '', implementationModel: '',
        integrationReqs: '', customDevScope: '', supportWindow: '',
        slaReqs: '', clientPainPoints: '', mandatoryDeliverables: '',
        securityCompliance: '',
        expectedDuration: expectedDuration || '6 months',
        dealType: dealType || 'Fixed Price',
        currency: currency || 'INR',
        costBasis: costBasis || 'marginal',
        selectedResources: [],
        rfpRawText,
      }, availableRateCards, dbResources.map(r => ({
        id: r.id, name: r.name, designation: r.designation,
        sap_modules: r.sap_modules || [], skills: r.skills || [],
        geography: r.geography, availability: r.availability,
        years_of_experience: r.years_of_experience,
        certifications: r.certifications || [], languages: r.languages || [],
        employment_type: r.employment_type, billing_rate: r.billing_rate,
        bio: r.bio, profile_summary: r.profile_summary,
        key_projects: r.key_projects || [],
      })));

      const hours: ResourceHourEntry[] = [];

      // Named consultants from DB
      result.consultants.forEach(c => {
        const dbR = dbResources.find(r => r.id === c.dbId);
        if (!dbR) return;
        hours.push({
          roleId: `db-${dbR.id}`,
          skill: `${dbR.name} (${dbR.designation})`,
          level: dbR.designation,
          location: dbR.employment_type === 'Onsite' ? 'Onsite' : 'Offshore',
          billingRate: dbR.billing_rate,
          currency: dbR.currency || currency,
          suggestedHours: c.hours,
          confirmedHours: c.hours,
          notes: c.reason,
          status: 'tentative',
        });
      });

      // Gap roles from rate cards
      result.gapRoles.forEach(g => {
        const rc = availableRateCards.find(r => r.id === g.roleId);
        if (!rc) return;
        hours.push({
          roleId: g.roleId,
          skill: rc.skill,
          level: rc.roleLevel,
          location: rc.locationType,
          billingRate: rc.billingRate,
          currency: rc.currency,
          suggestedHours: g.hours,
          confirmedHours: g.hours,
          notes: g.reason,
          status: 'tentative',
        });
      });

      const current = briefing ?? emptyBriefing();

      if (hours.length === 0) {
        // LLM returned no valid roles — show error state, do NOT fake data
        onChange({
          ...current,
          resourceHours: [],
          estimationError: 'APNJ-LLM-Studio returned no results. Ensure the Studio is running, then try again. Also check that Opportunity Type is set in Step 1.',
        } as any);
      } else {
        onChange({ ...current, resourceHours: hours, estimationError: undefined } as any);
      }
    } catch (err) {
      console.error('[PreSalesBriefingStep] Resource estimation failed:', err);
      // Connection failed — show error state, do NOT fake data
      const current = briefing ?? emptyBriefing();
      onChange({
        ...current,
        resourceHours: [],
        estimationError: 'Could not connect to APNJ-LLM-Studio. Start the Studio (Start-APNJ-Studio.bat) and click Re-estimate.',
      } as any);
    } finally {
      setEstimatingR(false);
    }
  }, [clientName, geography, industry, opportunityType, lob, modules, dealType, currency, costBasis, expectedDuration, rfpRawText, availableRateCards, dbResources, briefing, onChange]);

  const updateAnswer = (id: string, answer: string) => {
    if (!briefing) return;
    onChange({ ...briefing, qa: briefing.qa.map(q => q.id === id ? { ...q, answer } : q) });
  };

  const updateResourceHours = (roleId: string, field: keyof ResourceHourEntry, value: any) => {
    if (!briefing) return;
    onChange({ ...briefing, resourceHours: briefing.resourceHours.map(r => r.roleId === roleId ? { ...r, [field]: value } : r) });
  };

  const toggleKbDoc = (docId: string) => {
    if (!briefing) return;
    const current = briefing.kbDocIds ?? [];
    const updated = current.includes(docId) ? current.filter(id => id !== docId) : [...current, docId];
    onChange({ ...briefing, kbDocIds: updated });
  };

  const toggleCategory = (cat: string) => {
    setCollapsedCats(prev => {
      const n = new Set(prev);
      n.has(cat) ? n.delete(cat) : n.add(cat);
      return n;
    });
  };

  // Group questions by category
  const byCategory = (briefing?.qa ?? []).reduce<Record<string, BriefingQuestion[]>>((acc, q) => {
    (acc[q.category] = acc[q.category] ?? []).push(q);
    return acc;
  }, {});

  const answeredCount = (briefing?.qa ?? []).filter(q => String(q.answer ?? '').trim().length > 0).length;
  const requiredCount = (briefing?.qa ?? []).filter(q => q.required).length;
  const requiredAnswered = (briefing?.qa ?? []).filter(q => q.required && String(q.answer ?? '').trim().length > 0).length;
  const ctxRequiredCount = (briefing?.qa ?? []).filter(q => (q as any).section !== 'solution' && q.required).length;
  const ctxRequiredAnswered = (briefing?.qa ?? []).filter(q => (q as any).section !== 'solution' && q.required && String(q.answer ?? '').trim().length > 0).length;
  const contextComplete = ctxRequiredAnswered >= Math.min(3, ctxRequiredCount);
  const isComplete = requiredAnswered >= Math.min(3, requiredCount);

  const currSym = currency === 'INR' ? '₹' : currency === 'EUR' ? '€' : currency === 'SGD' ? 'S$' : currency === 'AUD' ? 'A$' : currency === 'AED' ? 'د.إ' : '$';

  return (
    <div className="space-y-6">

      {/* ── Completion badge ── */}
      {briefing && briefing.qa.length > 0 && (
        <div className={`flex items-center gap-3 p-3 rounded-lg border text-sm ${isComplete ? 'bg-success/5 border-success/30' : 'bg-warning/5 border-warning/30'}`}>
          {isComplete
            ? <Check className="h-4 w-4 text-success shrink-0" />
            : <AlertCircle className="h-4 w-4 text-warning shrink-0" />}
          <span className={isComplete ? 'text-success' : 'text-warning'}>
            {answeredCount} of {briefing.qa.length} answered
            {!contextComplete && ` — complete Section A (context) first`}
            {contextComplete && !isComplete && ` — answer remaining required questions in Section B`}
          </span>
        </div>
      )}

      {/* ── Panel 1: AI Questionnaire ── */}
      <Card className="enterprise-shadow">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="font-heading flex items-center gap-2">
                <FileText className="h-4 w-4 text-primary" /> Pre-Sales Questionnaire
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Qwen reads your RFP and generates specific questions. Your answers eliminate hallucination from the proposal.
              </p>
            </div>
            <Button onClick={handleGenerateQuestions} disabled={generatingQ} variant={briefing?.qa.length ? 'outline' : 'default'} size="sm">
              {generatingQ
                ? <><Loader2 className="h-3 w-3 mr-2 animate-spin" /> Generating…</>
                : <><Sparkles className="h-3 w-3 mr-2" /> {briefing?.qa.length ? 'Regenerate Questions' : 'Generate Questions'}</>}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {!briefing?.qa.length && !generatingQ && (
            <div className="text-center py-8 text-muted-foreground">
              <Sparkles className="h-8 w-8 mx-auto mb-3 opacity-30" />
              <p className="text-sm">{rfpRawText?.length > 100 ? 'Click "Generate Questions" to create an RFP-specific questionnaire.' : 'Upload an RFP first to get specific questions, or generate generic ones.'}</p>
            </div>
          )}
          {generatingQ && (
            <div className="flex items-center justify-center py-10 gap-3 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm">Qwen is reading your RFP and generating targeted questions…</span>
            </div>
          )}
          {/* ── Two-section layout ── */}
          {(() => {
            const contextQs  = (briefing?.qa ?? []).filter(q => (q as any).section === 'context' || !('section' in q));
            const solutionQs = (briefing?.qa ?? []).filter(q => (q as any).section === 'solution');
            // Fall back: if no section tags, first half = context, second half = solution
            const allQs = briefing?.qa ?? [];
            const ctxQs  = contextQs.length > 0  ? contextQs  : allQs.slice(0, Math.ceil(allQs.length / 2));
            const solQs  = solutionQs.length > 0 ? solutionQs : allQs.slice(Math.ceil(allQs.length / 2));

            const ctxAnswered  = ctxQs.filter(q => String(q.answer ?? '').trim()).length;
            const ctxRequired  = ctxQs.filter(q => q.required).length;
            const ctxComplete  = ctxAnswered >= Math.min(3, ctxRequired) && ctxRequired > 0;
            const solAnswered  = solQs.filter(q => String(q.answer ?? '').trim()).length;

            const renderQuestion = (q: BriefingQuestion, locked = false) => (
              <div key={q.id} className={`p-4 space-y-2 ${locked ? 'opacity-50 pointer-events-none' : ''}`}>
                <div className="flex items-start gap-2">
                  <span className={`text-xs px-1.5 py-0.5 rounded font-medium shrink-0 ${CATEGORY_COLORS[(q as any).category] ?? 'bg-muted text-muted-foreground'}`}>
                    {(q as any).category}
                  </span>
                  <Label className={`text-sm flex-1 ${q.required ? 'font-medium' : ''}`}>
                    {q.question}
                    {q.required && <span className="text-destructive ml-1">*</span>}
                  </Label>
                  {String(q.answer ?? '').trim() && <Check className="h-3.5 w-3.5 text-success shrink-0 mt-0.5" />}
                </div>
                <Textarea
                  placeholder={q.required ? 'Required — please provide a specific answer…' : 'Optional — add context if available…'}
                  value={q.answer}
                  onChange={e => updateAnswer(q.id, e.target.value)}
                  className="text-sm min-h-[60px] resize-y"
                  disabled={locked}
                />
              </div>
            );

            return (
              <div className="space-y-4">

                {/* Section A — Context Definition */}
                <div className="rounded-lg border-2 border-teal-200 dark:border-teal-800 overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 bg-teal-50 dark:bg-teal-950/40 border-b border-teal-200 dark:border-teal-800">
                    <div className="flex items-center gap-2">
                      <Lightbulb className="h-4 w-4 text-teal-600" />
                      <span className="text-sm font-semibold text-teal-800 dark:text-teal-200">Section A — Client & Context Definition</span>
                      <span className="text-xs text-teal-600 dark:text-teal-400">Must complete before Section B</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-teal-600">{ctxAnswered}/{ctxQs.length} answered</span>
                      {ctxComplete && <span className="text-xs bg-success text-white px-2 py-0.5 rounded-full font-medium">✓ Complete</span>}
                    </div>
                  </div>
                  <div className="divide-y">
                    {ctxQs.length === 0 && (
                      <p className="p-4 text-xs text-muted-foreground italic">Generate questions above to populate this section.</p>
                    )}
                    {ctxQs.map(q => renderQuestion(q, false))}
                  </div>
                </div>

                {/* Section B — Solution Definition */}
                <div className={`rounded-lg border-2 overflow-hidden transition-opacity ${!ctxComplete && solQs.length > 0 ? 'border-muted opacity-60' : 'border-indigo-200 dark:border-indigo-800'}`}>
                  <div className={`flex items-center justify-between px-4 py-3 border-b ${!ctxComplete && solQs.length > 0 ? 'bg-muted/30 border-muted' : 'bg-indigo-50 dark:bg-indigo-950/40 border-indigo-200 dark:border-indigo-800'}`}>
                    <div className="flex items-center gap-2">
                      {!ctxComplete && solQs.length > 0
                        ? <Lock className="h-4 w-4 text-muted-foreground" />
                        : <Sparkles className="h-4 w-4 text-indigo-600" />}
                      <span className={`text-sm font-semibold ${!ctxComplete && solQs.length > 0 ? 'text-muted-foreground' : 'text-indigo-800 dark:text-indigo-200'}`}>
                        Section B — Solution Definition
                      </span>
                      {!ctxComplete && solQs.length > 0 && (
                        <span className="text-xs text-muted-foreground">Complete Section A first</span>
                      )}
                    </div>
                    {ctxComplete && (
                      <span className="text-xs text-indigo-600">{solAnswered}/{solQs.length} answered</span>
                    )}
                  </div>
                  <div className="divide-y">
                    {solQs.length === 0 && ctxComplete && (
                      <p className="p-4 text-xs text-muted-foreground italic">No solution questions yet — generate questions above.</p>
                    )}
                    {solQs.length === 0 && !ctxComplete && (
                      <p className="p-4 text-xs text-muted-foreground italic">Complete Section A to unlock solution questions.</p>
                    )}
                    {solQs.map(q => renderQuestion(q, !ctxComplete && solQs.length > 0))}
                  </div>
                </div>

              </div>
            );
          })()}
        </CardContent>
      </Card>

      {/* ── Panel 2: Resource Estimation Hours ── */}
      <Card className="enterprise-shadow">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="font-heading flex items-center gap-2">
                <Users className="h-4 w-4 text-primary" /> Resource Estimation
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                AI suggests resources and hours. Confirm or adjust before moving to Resource Selection.
              </p>
            </div>
            <Button onClick={handleEstimateResources} disabled={estimatingR || availableRateCards.length === 0} variant="outline" size="sm">
              {estimatingR
                ? <><Loader2 className="h-3 w-3 mr-2 animate-spin" /> Estimating…</>
                : availableRateCards.length === 0
                  ? <><Loader2 className="h-3 w-3 mr-2 animate-spin" /> Loading rates…</>
                  : <><Sparkles className="h-3 w-3 mr-2" /> {briefing?.resourceHours.length ? 'Re-estimate' : 'Estimate Resources'}</>}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {!briefing?.resourceHours.length && !estimatingR && (
            <div className="space-y-2">
              {(briefing as any)?.estimationError ? (
                <div className="p-4 rounded-lg border border-destructive/30 bg-destructive/5 text-sm space-y-2">
                  <p className="font-medium text-destructive">⚠ Estimation failed</p>
                  <p className="text-muted-foreground text-xs">{(briefing as any).estimationError}</p>
                </div>
              ) : (
                <p className="text-center py-6 text-muted-foreground text-sm">
                  Click "Estimate Resources" to get AI-suggested staffing from APNJ-LLM-Studio.
                </p>
              )}
            </div>
          )}
          {estimatingR && (
            <div className="flex items-center justify-center py-8 gap-3 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm">Estimating resources from scope…</span>
            </div>
          )}
          {(briefing?.resourceHours.length ?? 0) > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="pb-2 font-medium text-muted-foreground text-xs">Role</th>
                    <th className="pb-2 font-medium text-muted-foreground text-xs">Location</th>
                    <th className="pb-2 font-medium text-muted-foreground text-xs w-28">Rate</th>
                    <th className="pb-2 font-medium text-muted-foreground text-xs w-24">AI Hours</th>
                    <th className="pb-2 font-medium text-muted-foreground text-xs w-24">Confirmed</th>
                    <th className="pb-2 font-medium text-muted-foreground text-xs">Notes</th>
                    <th className="pb-2 font-medium text-muted-foreground text-xs w-28">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(briefing?.resourceHours ?? []).map(r => (
                    <tr key={r.roleId} className={`border-b last:border-0 ${r.status === 'removed' ? 'opacity-40' : ''}`}>
                      <td className="py-2 font-medium text-xs">{r.skill}</td>
                      <td className="py-2 text-xs text-muted-foreground">{r.location}</td>
                      <td className="py-2 text-xs">{r.currency === 'INR' ? '₹' : '$'}{r.billingRate.toLocaleString('en-IN')}/hr</td>
                      <td className="py-2 text-xs text-muted-foreground">{r.suggestedHours}h</td>
                      <td className="py-2">
                        <Input
                          type="number" min="0" step="8"
                          value={r.confirmedHours}
                          onChange={e => updateResourceHours(r.roleId, 'confirmedHours', Number(e.target.value))}
                          className="h-7 w-20 text-xs text-right px-2"
                          disabled={r.status === 'removed'}
                        />
                      </td>
                      <td className="py-2">
                        <Input
                          value={r.notes}
                          onChange={e => updateResourceHours(r.roleId, 'notes', e.target.value)}
                          placeholder="Add note…"
                          className="h-7 text-xs px-2"
                          disabled={r.status === 'removed'}
                        />
                      </td>
                      <td className="py-2">
                        <div className="flex gap-1">
                          {(['confirmed','tentative','removed'] as const).map(s => (
                            <button
                              key={s}
                              type="button"
                              onClick={() => updateResourceHours(r.roleId, 'status', s)}
                              className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
                                r.status === s
                                  ? s === 'confirmed' ? 'bg-success text-white border-success'
                                    : s === 'removed'  ? 'bg-destructive text-white border-destructive'
                                    : 'bg-warning text-white border-warning'
                                  : 'border-border text-muted-foreground hover:bg-muted'
                              }`}
                            >
                              {s === 'confirmed' ? '✓' : s === 'tentative' ? '?' : '✕'}
                            </button>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t">
                  <tr>
                    <td className="py-2 font-medium text-xs" colSpan={3}>Total Confirmed Hours</td>
                    <td className="py-2 text-xs text-muted-foreground">
                      {(briefing?.resourceHours ?? []).reduce((s, r) => s + r.suggestedHours, 0)}h
                    </td>
                    <td className="py-2 font-medium text-xs">
                      {(briefing?.resourceHours ?? []).filter(r => r.status !== 'removed').reduce((s, r) => s + r.confirmedHours, 0)}h
                    </td>
                    <td colSpan={2}></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Panel 3: Pre-Sales Free Notes ── */}
      <Card className="enterprise-shadow">
        <CardHeader className="pb-2">
          <CardTitle className="font-heading text-sm">Pre-Sales Notes</CardTitle>
          <p className="text-xs text-muted-foreground">Any additional context — competitor intelligence, relationship notes, special considerations. Injected into all AI generation calls.</p>
        </CardHeader>
        <CardContent>
          <Textarea
            placeholder="e.g. Client is evaluating 3 vendors. Our differentiator is the onsite resource availability. CDRI finance team is new to SAP — keep language non-technical in the proposal. Key concern is FM/GM licensing…"
            value={briefing?.presalesNotes ?? ''}
            onChange={e => onChange({ ...(briefing ?? emptyBriefing()), presalesNotes: e.target.value })}
            className="min-h-[100px] text-sm"
          />
        </CardContent>
      </Card>

      {/* ── Panel 4: KB Document Selector ── */}
      {kbDocuments.length > 0 && (
        <Card className="enterprise-shadow">
          <CardHeader className="pb-2">
            <CardTitle className="font-heading flex items-center gap-2 text-sm">
              <BookOpen className="h-4 w-4 text-primary" /> Company Profile / Credentials (Knowledge Base)
            </CardTitle>
            <p className="text-xs text-muted-foreground">Select documents for the Company Credentials section. Qwen will use ONLY the selected KB content — no hallucinated statistics.</p>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {kbDocuments.map(doc => {
                const selected = (briefing?.kbDocIds ?? []).includes(doc.id);
                return (
                  <button
                    key={doc.id}
                    type="button"
                    onClick={() => toggleKbDoc(doc.id)}
                    className={`text-left p-3 rounded-lg border transition-colors flex items-center gap-3 ${
                      selected ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40'
                    }`}
                  >
                    <div className={`h-8 w-8 rounded flex items-center justify-center shrink-0 ${selected ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
                      {selected ? <Check className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{doc.title}</p>
                      <p className="text-xs text-muted-foreground">{doc.type}</p>
                    </div>
                  </button>
                );
              })}
            </div>
            {(briefing?.kbDocIds.length ?? 0) > 0 && (
              <p className="text-xs text-success mt-2">✓ {briefing!.kbDocIds.length} document{briefing!.kbDocIds.length > 1 ? 's' : ''} selected for credentials context</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Panel 5: RFP Compliance Checklist ── */}
      {rfpRawText && rfpRawText.trim().length >= 100 && (
        <ComplianceChecklistStep
          rfpRawText={rfpRawText}
          clientName={clientName}
          checklist={checklist}
          onChange={onChecklistChange}
        />
      )}

    </div>
  );
}