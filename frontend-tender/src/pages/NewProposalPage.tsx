import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { sapModules, type Proposal, type ProposalMetadata } from '@/data/mockData';
import { useProposals } from '@/contexts/ProposalContext';
import { useCommercialRules } from '@/contexts/CommercialRulesContext';
import { usePricingStrategy } from '@/contexts/PricingStrategyContext';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { useResources, type DbResource } from '@/hooks/useResources';
import { generatePricingEstimate, generateCostLines, generateResourceEstimate, type ResourceEstimateResult, type PricingResult, type SelectedResource, type CostLineItem } from '@/lib/pricingCalculator';
import { callLLM, extractDocxText } from '@/lib/llmClient';
import { chunkDocument } from '@/lib/chunkDocument';
import { mergeRfpFieldSets } from '@/lib/mergeRfpFields';
import { PreSalesBriefingStep } from '@/components/PreSalesBriefingStep';
import { CoverLetterStep, DEFAULT_COVER_LETTER, type CoverLetterData } from '@/components/CoverLetterStep';
import type { ComplianceChecklist } from '@/lib/generateComplianceChecklist';
import type { PresalesBriefing } from '@/lib/generateQuestionnaire';
import { supabase } from '@/integrations/supabase/client';
import { ChevronRight, ChevronLeft, Check, DollarSign, Info, Upload, FileText, Loader2, Sparkles , TrendingUp , BarChart3 , Layers } from 'lucide-react';

const steps = ['Opportunity Details', 'Cover Letter', 'Scope Details', 'Pre-Sales Briefing', 'Resource Selection', 'Cost Sheet', 'Commercial Details', 'Risk & Constraints', 'Internal Notes', 'Review & Submit'];

export default function NewProposalPage() {
  const navigate = useNavigate();
  const { proposals, addProposal, submitForReview } = useProposals();
  const { rateCards, rules: businessRules, getMatchingRates, getRatesForGeography, marginThreshold, costingMethod, recomputeRateCard } = useCommercialRules();
  const { costPlusTargets, tiers, getCostPlusPrice, getMarketPosition } = usePricingStrategy();
  const { data: dbResources = [] } = useResources();

  // FX rates â€” used in mapDbResourceToRoleRow and in Commercial Details display
  const [fxRate, setFxRate] = useState({ USD: 84.0, EUR: 91.0, SGD: 63.0, AUD: 55.0, AED: 22.9 });

  /** Map a DbResource (named consultant from Supabase) into the same RateCard-compatible
   *  shape that step 2 uses, so both rate-card templates and real named resources appear. */
  const mapDbResourceToRoleRow = (r: DbResource) => {
    const expYears = r.years_of_experience;
    // FIX: derive roleLevel from designation first, fall back to years of experience.
    // This ensures Directors, Partners, VPs etc. are never shown as Junior.
    const desig = (r.designation || '').toLowerCase();
    const roleLevel: 'Junior' | 'Mid' | 'Senior' | 'Principal' =
      /director|vp|vice.president|partner|cto|coo|founder|head of|principal|managing/i.test(desig) ? 'Principal' :
      /manager|lead|architect|senior|sr\.|consultant \(senior\)/i.test(desig) ? 'Senior' :
      /junior|jr\.|associate|analyst|fresher|trainee/i.test(desig) ? 'Junior' :
      expYears >= 13 ? 'Principal' : expYears >= 9 ? 'Senior' : expYears >= 4 ? 'Mid' : 'Junior';
    const experienceBand =
      expYears >= 15 ? '15+ years' : expYears >= 12 ? '12-15 years' : expYears >= 8 ? '8-12 years' :
      expYears >= 6  ? '6-10 years' : expYears >= 4 ? '4-8 years' : expYears >= 1 ? '1-3 years' : '0-3 years';
    const utilisationRate = 0.80;

    // â”€â”€ FX conversion: convert resource rates into the proposal's currency â”€â”€
    // fxRate holds units of INR per 1 foreign currency unit (e.g. USD: 84)
    // If resource is USD and proposal is INR â†’ multiply by fxRate.USD
    // If resource is INR and proposal is USD â†’ divide by fxRate.USD
    // Same-currency â†’ factor = 1
    const proposalCurrency = form.currency || 'INR';
    const resourceCurrency = r.currency || 'INR';
    let fxFactor = 1;
    const fxLookup: Record<string, number> = { USD: fxRate.USD, EUR: fxRate.EUR, SGD: fxRate.SGD, AUD: fxRate.AUD, AED: fxRate.AED, INR: 1 };
    if (resourceCurrency !== proposalCurrency) {
      // Convert resource native â†’ INR â†’ proposal currency
      const toINR = fxLookup[resourceCurrency] ?? 1;
      const fromINR = fxLookup[proposalCurrency] ?? 1;
      fxFactor = toINR / fromINR;
    }
    const billingRate = Math.round(r.billing_rate * fxFactor);
    const costRate    = Math.round(r.cost_rate * fxFactor);

    const computed = recomputeRateCard({
      billingRate,
      costRate,
      benchPercentage: r.cost_loading_percentage,
      trainingPercentage: 0,
      infraPercentage: 0,
      utilisationRate,
    });
    return {
      id: `db-${r.id}`,
      skill: `${r.name} (${r.designation})`,
      roleLevel,
      experienceBand,
      geography: r.geography,
      locationType: (r.employment_type === 'Onsite' ? 'Onsite' : 'Offshore') as 'Offshore' | 'Onsite' | 'Hybrid',
      currency: proposalCurrency,
      billingRate,
      costRate,
      loadedCostRate: computed.loadedCostRate ?? costRate,
      effectiveCostRate: computed.effectiveCostRate ?? costRate,
      effectiveLoadedCostRate: computed.effectiveLoadedCostRate ?? costRate,
      marginalMargin: computed.marginalMargin ?? 0,
      absorptionMargin: computed.absorptionMargin ?? 0,
      utilisationAdjustedMarginalMargin: computed.utilisationAdjustedMarginalMargin ?? 0,
      utilisationAdjustedAbsorptionMargin: computed.utilisationAdjustedAbsorptionMargin ?? 0,
      margin: computed.margin ?? 0,
      costLoadingPercentage: r.cost_loading_percentage,
      benchPercentage: r.cost_loading_percentage,
      trainingPercentage: 0,
      infraPercentage: 0,
      utilisationRate,
      availability: r.availability,
      isDbResource: true,
    };
  };
  const { toast } = useToast();
  const { user } = useAuth();
  const [step, setStep] = useState(0);
  const [savingDraft, setSavingDraft] = useState(false);
  const [draftId, setDraftId] = useState<string | null>(null);

  // Costing workflow: 'ai' = AI estimates everything, 'manual' = user enters everything
  const [costingMode, setCostingMode] = useState<'ai' | 'manual' | null>(null);
  const [presalesBriefing, setPresalesBriefing] = useState<PresalesBriefing | null>(null);
  const [coverLetter, setCoverLetter] = useState<CoverLetterData>(DEFAULT_COVER_LETTER);
  const [complianceChecklist, setComplianceChecklist] = useState<ComplianceChecklist | null>(null);

  const nextId = `PIP-2026-${String(proposals.length + 1).padStart(3, '0')}`;

  // â”€â”€ Load draft from URL param on mount â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const did = params.get('draft');
    const stepParam = params.get('step');
    if (!did) return;
    setDraftId(did);
    supabase.from('proposals' as never).select('*').eq('id', did).single().then(({ data }: never) => {
      if (!data) return;
      const d = data as Record<string, unknown>;
      const meta = (d.metadata as Record<string, unknown>) || {};
      const formData = (meta.draft_form as Record<string, unknown>) || {};
      setForm(prev => ({ ...prev, ...formData } as typeof prev));
      if (meta.rfp_raw_text) setRfpRawText(meta.rfp_raw_text as string);
      if (meta.rfp_session_id) setRfpSessionId(meta.rfp_session_id as string);
      if (meta.rfp_files) setRfpFiles(meta.rfp_files as string[]);
      if (meta.cost_lines) setCostLines(meta.cost_lines as CostLineItem[]);
      if (meta.resource_hours) setResourceHours(meta.resource_hours as Record<string, number>);
      if (meta.selected_role_ids) setSelectedRoleIds(new Set(meta.selected_role_ids as string[]));
      // FIX: restore AI resource groupings so Pool A / Pool B sections render correctly
      if (meta.ai_consultant_ids) setAiConsultantIds(new Set(meta.ai_consultant_ids as string[]));
      if (meta.ai_gap_role_ids) setAiGapRoleIds(new Set(meta.ai_gap_role_ids as string[]));
      if (meta.ai_reasons) setAiReasons(meta.ai_reasons as Record<string, string>);
      if (meta.ai_estimate) setAiEstimate(meta.ai_estimate as PricingResult);
      if (meta.costing_mode) setCostingMode(meta.costing_mode as 'ai' | 'manual');
      if (meta.presalesBriefing) setPresalesBriefing(meta.presalesBriefing as PresalesBriefing);
      if (meta.coverLetter) setCoverLetter(meta.coverLetter as CoverLetterData);
      if (meta.complianceChecklist) setComplianceChecklist(meta.complianceChecklist as ComplianceChecklist);
      if (stepParam) setStep(parseInt(stepParam) || 0);
    });
  }, []);

  const [form, setForm] = useState({
    opportunityName: '', clientName: '', clientGroup: '', geography: 'India', industry: '',
    opportunityType: '', dealOwner: user?.name || '', submissionDate: '', priority: 'Medium', proposalType: 'Proactive',
    modules: [] as string[], projectType: '', implementationModel: '', integrationReqs: '', customDevScope: '',
    supportWindow: '', slaReqs: '', clientPainPoints: '', mandatoryDeliverables: '',
    dealType: '', currency: 'INR', expectedDuration: '', billingModel: '', paymentMilestone: '',
    clientBudget: '', discountRequested: '', commercialNotes: '',
    timelinePressure: '', mandatoryLegalClauses: '', clientContractFormat: '', securityCompliance: '',
    dependencyRisks: '', specialResources: '', deliveryAssumptions: '', exclusions: '',
    salesNotes: '', presalesNotes: '', competitorContext: '', winStrategy: '', clientRelationship: '',
  });

  // Per-role hours for pricing calculator (keyed by rate card id)
  const [resourceHours, setResourceHours] = useState<Record<string, number>>({});
  const updateHours = (id: string, hrs: number) =>
    setResourceHours(prev => ({ ...prev, [id]: hrs }));

  // Step 2 â€” Resource Selection
  const [selectedRoleIds, setSelectedRoleIds] = useState<Set<string>>(new Set());
  const toggleRole = (id: string) =>
    setSelectedRoleIds(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  const buildSelectedResources = (): SelectedResource[] => {
    const rateCardRows = getMatchingRates(form.geography, form.modules)
      .filter(r => selectedRoleIds.has(r.id))
      .map(r => ({
        roleId: r.id,
        role: r.skill,
        hours: resourceHours[r.id] || 0,
        billingRate: r.billingRate,
        costRate: r.costRate,
        loadedCostRate: r.loadedCostRate,
        effectiveCostRate: r.effectiveCostRate,
        effectiveLoadedCostRate: r.effectiveLoadedCostRate,
        locationType: r.locationType,
        geography: r.geography,
      }));
    const dbRows = dbResources
      .filter(r => selectedRoleIds.has(`db-${r.id}`))
      .map(r => {
        const row = mapDbResourceToRoleRow(r);
        return {
          roleId: row.id,
          role: row.skill,
          hours: resourceHours[row.id] || 0,
          billingRate: row.billingRate,
          costRate: row.costRate,
          loadedCostRate: row.loadedCostRate,
          effectiveCostRate: row.effectiveCostRate,
          effectiveLoadedCostRate: row.effectiveLoadedCostRate,
          locationType: row.locationType,
          geography: row.geography,
        };
      });
    return [...rateCardRows, ...dbRows];
  };

  const [aiEstimate, setAiEstimate] = useState<PricingResult | null>(null);
  const [estimating, setEstimating] = useState(false);
  // Unified cost-sheet line items (hardware + other). AI-filled in AI mode, user-filled in manual.
  const [costLines, setCostLines] = useState<CostLineItem[]>([]);
  const [costLinesLoading, setCostLinesLoading] = useState(false);
  const [resourceEstimating, setResourceEstimating] = useState(false);
  // Track which IDs were AI-selected (consultants from pool vs gap roles from rate cards)
  const [aiConsultantIds, setAiConsultantIds] = useState<Set<string>>(new Set()); // db-${id} format
  const [aiGapRoleIds, setAiGapRoleIds] = useState<Set<string>>(new Set());       // rate-card id format
  const [aiReasons, setAiReasons] = useState<Record<string, string>>({});         // id -> reason

  const handleGenerateEstimate = async () => {
    setEstimating(true);
    try {
      const estimate = await generatePricingEstimate({
        opportunityName: form.opportunityName,
        clientName: form.clientName,
        geography: form.geography,
        industry: form.industry,
        opportunityType: form.opportunityType,
        modules: form.modules,
        projectType: form.projectType,
        implementationModel: form.implementationModel,
        integrationReqs: form.integrationReqs,
        customDevScope: form.customDevScope,
        supportWindow: form.supportWindow,
        slaReqs: form.slaReqs,
        clientPainPoints: form.clientPainPoints,
        mandatoryDeliverables: form.mandatoryDeliverables,
        securityCompliance: form.securityCompliance,
        expectedDuration: form.expectedDuration,
        dealType: form.dealType,
        currency: form.currency,
        costBasis: 'marginal',
        selectedResources: buildSelectedResources(),
        costLines: costLines,
        rfpRawText: rfpRawText,
        rfpSessionId: rfpSessionId || undefined,
        mode: costingMode === 'ai' ? 'ai' : 'manual',
      }, businessRules);
      setAiEstimate(estimate);
      // In AI mode, pre-fill hours from the AI's suggested breakdown.
      // In manual mode, keep the user's own hours untouched.
      if (costingMode === 'ai') {
        const newHours: Record<string, number> = {};
        estimate.breakdown.forEach(r => { newHours[r.roleId] = r.hours; });
        setResourceHours(newHours);
      }
      if (estimate.endpoint === 'unavailable') {
        toast({ title: 'âš  Price Computed (Offline)', description: 'APNJ-LLM-Studio is not reachable â€” price computed from rate cards. Start the Studio for AI rationale.', variant: 'default' });
      } else if (costingMode === 'ai') {
        toast({ title: 'âœ“ AI Estimate Ready', description: 'AI analysed the scope and built a full plan. Review and adjust as needed.' });
      } else {
        toast({ title: 'âœ“ Price Computed', description: 'Price calculated from your inputs and business rules. AI wrote the rationale.' });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Estimation failed';
      // Only surface as a red error if it's NOT a connectivity issue (those are handled gracefully above)
      if (!message.includes('not reachable') && !message.includes('unavailable')) {
        toast({ title: 'âŒ Estimation Failed', description: message, variant: 'destructive' });
      }
    } finally {
      setEstimating(false);
    }
  };

  const updateField = (field: string, value: string) => setForm(prev => ({ ...prev, [field]: value }));
  const toggleModule = (mod: string) => setForm(prev => ({
    ...prev,
    modules: prev.modules.includes(mod) ? prev.modules.filter(m => m !== mod) : [...prev.modules, mod]
  }));

  // RFP upload
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [rfpParsing, setRfpParsing] = useState(false);
  const [rfpFiles, setRfpFiles] = useState<string[]>([]);           // parsed filenames
  const [rfpParseProgress, setRfpParseProgress] = useState('');     // "Parsing file 2 of 3..."
  const [rfpRawText, setRfpRawText] = useState('');                 // consolidated text for AI estimation
  const [rfpSessionId, setRfpSessionId] = useState('');
  /**
   * Merges a newly parsed JSON object into the form.
   * Existing non-empty values are kept; new values fill in blanks.
   * For arrays (modules), the two lists are merged and deduped.
   */
  const mergeRfpData = (d: Record<string, unknown>) => {
    // Safe string extractor â€” prevents non-string RFP values from causing trim() TypeError
    const str = (v: unknown): string => (v == null ? '' : String(v));

    setForm(prev => ({
      ...prev,
      opportunityName:       str(d.opportunityName)        || prev.opportunityName,
      clientName:            str(d.clientName)             || prev.clientName,
      clientGroup:           str(d.clientGroup)            || prev.clientGroup,
      geography:             str(d.geography)              || prev.geography,
      industry:              str(d.industry)               || prev.industry,
      opportunityType: (() => {
        const raw = str(d.opportunityType);
        const normalised = raw
          .replace(' - ', ' â€“ ')
          .replace('SAP Implementation Rise', 'SAP Implementation â€“ Rise')
          .replace('SAP Implementation Grow', 'SAP Implementation â€“ Grow')
          .replace('Upgrade/Migration', 'Upgrade / Migration')
          .replace('Upgrade/migration', 'Upgrade / Migration')
          .replace('BTP/AI', 'BTP / AI')
          .replace('Resource augmentation', 'Resource Augmentation')
          .replace('resource augmentation', 'Resource Augmentation');
        const valid = ['SAP Implementation â€“ Rise','SAP Implementation â€“ Grow','AMS','Resource Augmentation','Upgrade / Migration','BTP / AI','Tender'];
        return valid.includes(normalised) ? normalised : (raw ? raw : prev.opportunityType);
      })(),
      submissionDate:        str(d.submissionDate)         || prev.submissionDate,
      proposalType: (() => {
        const raw = str(d.proposalType);
        const valid = ['RFP','RFQ','Proactive'];
        return valid.includes(raw) ? raw : prev.proposalType;
      })(),
      priority: (() => {
        const raw = str(d.priority);
        const valid = ['Critical','High','Medium','Low'];
        return valid.includes(raw) ? raw : prev.priority;
      })(),
      modules: (() => {
        const incoming = Array.isArray(d.modules) ? (d.modules as unknown[]).map(String) : [];
        const merged = [...new Set([...prev.modules, ...incoming])];
        return merged.length > 0 ? merged : prev.modules;
      })(),
      dealType: (() => {
        const raw = str(d.dealType).trim();
        if (!raw) return prev.dealType;
        const lower = raw.toLowerCase();
        if (lower.includes('fixed')) return 'Fixed Price';
        if (lower.includes('time') || lower.includes('t&m') || lower.includes('material')) return 'Time & Material';
        if (lower.includes('hybrid')) return 'Hybrid';
        return prev.dealType;
      })(),
      currency: (() => {
        const parsed = str(d.currency);
        const valid = ['INR','USD','EUR','SGD','AUD','AED'];
        if (!parsed || !valid.includes(parsed)) return prev.currency;
        if (prev.currency !== 'INR') return prev.currency;
        return parsed;
      })(),
      expectedDuration:      str(d.expectedDuration)       || prev.expectedDuration,
      clientBudget:          d.clientBudget != null ? String(d.clientBudget) : prev.clientBudget,
      integrationReqs:       prev.integrationReqs
        ? prev.integrationReqs + (str(d.integrationReqs) ? '\n' + str(d.integrationReqs) : '')
        : str(d.integrationReqs),
      clientPainPoints:      prev.clientPainPoints
        ? prev.clientPainPoints + (str(d.clientPainPoints) ? '\n' + str(d.clientPainPoints) : '')
        : str(d.clientPainPoints),
      mandatoryDeliverables: prev.mandatoryDeliverables
        ? prev.mandatoryDeliverables + (str(d.mandatoryDeliverables) ? '\n' + str(d.mandatoryDeliverables) : '')
        : str(d.mandatoryDeliverables),
      slaReqs:               str(d.slaReqs)                || prev.slaReqs,
      securityCompliance:    str(d.securityCompliance)     || prev.securityCompliance,
      mandatoryLegalClauses: prev.mandatoryLegalClauses
        ? prev.mandatoryLegalClauses + (str(d.mandatoryLegalClauses) ? '\n' + str(d.mandatoryLegalClauses) : '')
        : str(d.mandatoryLegalClauses),
      customDevScope:        str(d.customDevScope)         || prev.customDevScope,
      implementationModel:   str(d.implementationModel)    || prev.implementationModel,
      supportWindow:         str(d.supportWindow)          || prev.supportWindow,
      projectType:           str(d.projectType)            || prev.projectType,
      timelinePressure:      str(d.timelinePressure)       || prev.timelinePressure,
      dependencyRisks:       prev.dependencyRisks
        ? prev.dependencyRisks + (str(d.dependencyRisks) ? '\n' + str(d.dependencyRisks) : '')
        : str(d.dependencyRisks),
      deliveryAssumptions:   prev.deliveryAssumptions
        ? prev.deliveryAssumptions + (str(d.deliveryAssumptions) ? '\n' + str(d.deliveryAssumptions) : '')
        : str(d.deliveryAssumptions),
      exclusions:            prev.exclusions
        ? prev.exclusions + (str(d.exclusions) ? '\n' + str(d.exclusions) : '')
        : str(d.exclusions),
    }));
  };

  /**
   * Builds the field-extraction prompt for one chunk of RFP text.
   * chunkLabel is empty for single-chunk (most) documents, or
   * " (excerpt N of M)" when the document had to be split.
   */
  const buildExtractionPrompt = (excerpt: string, chunkLabel: string): string => `You are an expert RFP analyst for an SAP consulting firm. Read the RFP document below${chunkLabel} carefully and extract ALL available information into the JSON structure. Be thorough â€” do not leave fields empty if the information exists anywhere in the document.

OPPORTUNITY TYPE mapping rules:
- New SAP S/4HANA implementation with RISE/cloud = "SAP Implementation â€“ Rise"
- New SAP implementation with GROW/mid-market = "SAP Implementation â€“ Grow"
- New on-premise or unspecified SAP implementation = "SAP Implementation â€“ Rise"
- Support/maintenance/operations = "AMS"
- Staff augmentation/resource supply = "Resource Augmentation"
- Version upgrade, migration, conversion = "Upgrade / Migration"
- BTP, Fiori, AI, analytics, integration = "BTP / AI"
- Government tender/bid = "Tender"

DEAL TYPE mapping:
- Fixed/lump-sum/milestone-based = "Fixed Price"
- Hourly/daily/T&M/time and material = "Time & Material"
- Mixed = "Hybrid"

PROPOSAL TYPE mapping:
- Client sent a formal RFP or tender document = "RFP"
- Client sent a Request for Quotation = "RFQ"
- No formal document, proactive outreach = "Proactive"

PRIORITY mapping (based on urgency language in the RFP):
- "urgent", "immediate", "ASAP", hard deadline within 30 days = "Critical"
- "high priority", deadline within 90 days = "High"
- Standard timeline, no urgency language = "Medium"
- No deadline mentioned, exploratory = "Low"

${chunkLabel ? 'IMPORTANT: this may be one part of a larger document split into sections. If a field is not mentioned in THIS excerpt, return an empty string/array for it â€” do not assume the whole document lacks it, since other excerpts may cover it.\n\n' : ''}Return ONLY valid JSON with these exact fields (empty string or empty array if genuinely not found):
{
  "opportunityName": "concise project title from RFP",
  "clientName": "client organisation name",
  "clientGroup": "parent company/group if mentioned",
  "geography": "one of: India, USA, Europe, APAC, Middle East, Global",
  "industry": "industry sector e.g. Manufacturing, BFSI, Retail",
  "opportunityType": "use the mapping rules above â€” do NOT leave blank",
  "proposalType": "use the mapping rules above â€” RFP, RFQ, or Proactive",
  "priority": "use the mapping rules above â€” Critical, High, Medium, or Low",
  "submissionDate": "YYYY-MM-DD if found, else empty string",
  "modules": ["SAP module codes: FI, CO, MM, SD, PP, QM, PM, WM, EWM, HR, PS, PS, ABAP, BASIS, BTP, Fiori, Ariba, MDG, GTS, IBP, APO, CRM, SRM, RE-FX, IM, FSCM, TRM, SAC, Datasphere, SuccessFactors"],
  "dealType": "use mapping rules above",
  "currency": "one of: INR, USD, EUR, SGD, AUD, AED â€” infer from geography if not stated",
  "expectedDuration": "project timeline e.g. 12 months, 18 months",
  "clientBudget": "numeric value only if explicitly stated, else empty string",
  "integrationReqs": "ALL integration requirements â€” list every system, API, interface mentioned",
  "customDevScope": "custom development, enhancements, ABAP, reports, forms, interfaces, workflows mentioned",
  "implementationModel": "e.g. Offshore, Onsite, Hybrid â€” extract from working model/delivery model sections",
  "supportWindow": "business hours, time zone, support hours if mentioned",
  "projectType": "e.g. Greenfield, Brownfield, Selective Data Migration, System Conversion",
  "clientPainPoints": "ALL pain points, challenges, problems, current-state issues mentioned",
  "mandatoryDeliverables": "ALL deliverables, milestones, outputs listed in the RFP",
  "slaReqs": "ALL SLA requirements â€” response times, uptime, availability, support levels",
  "securityCompliance": "security standards, compliance frameworks, certifications required (ISO, SOC2, GDPR, etc.)",
  "mandatoryLegalClauses": "legal requirements â€” NDA, IP ownership, liability, indemnity, penalties mentioned",
  "timelinePressure": "go-live deadlines, aggressive timelines, phase dates if mentioned",
  "dependencyRisks": "dependencies, third-party systems, client responsibilities, risks mentioned",
  "deliveryAssumptions": "assumptions stated in RFP about client responsibilities, access, data readiness",
  "exclusions": "items explicitly listed as out-of-scope or excluded"
}

Return ONLY valid JSON â€” no markdown fences, no explanation.

RFP Document${chunkLabel}:
${excerpt}`;

  /**
   * Extracts fields from a single chunk of RFP text. Returns {} on failure
   * for that chunk â€” mergeRfpFieldSets treats a missing/empty field from
   * one chunk as "this chunk didn't have it", not "the document lacks it",
   * as long as at least one other chunk found something.
   */
  const extractFieldsFromChunk = async (excerpt: string, chunkLabel: string): Promise<Record<string, unknown>> => {
    try {
      const { content: raw } = await callLLM(
        [{ role: 'user', content: buildExtractionPrompt(excerpt, chunkLabel) }],
        { temperature: 0.1, max_tokens: 2000 }
      );
      const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      return JSON.parse(cleaned);
    } catch {
      return {};
    }
  };

  /**
   * Parses a single file via the LLM and returns the extracted JSON.
   * Long documents are split into overlapping chunks (chunkDocument) so
   * fields stated deep in the document â€” e.g. legal clauses, SLA terms
   * near the end of a long RFP â€” aren't missed by a fixed truncation
   * point. Previously this truncated to 4000 chars (~1-2 pages); a real
   * RFP can run 50-150+ pages, so most of the document was never seen.
   */
  const parseSingleFile = async (file: File): Promise<{ data: Record<string, unknown>; rawText: string }> => {
    const ext = file.name.toLowerCase().split('.').pop() || '';
    const supported = ['docx', 'pdf', 'jpg', 'jpeg', 'png', 'tiff', 'tif'];
    if (!supported.includes(ext)) {
      throw new Error(`"${file.name}" is not supported. Use .docx, .pdf, .jpg, .jpeg, .png, or .tiff`);
    }
    // Extract via APNJ-LLM-Studio â€” tables preserved as Markdown, not dropped
    const plainText = await extractDocxText(file);
    if (!plainText || plainText.trim().length < 50) {
      throw new Error(`"${file.name}" appears to be empty or unreadable.`);
    }

    const chunks = chunkDocument(plainText);
    const chunkResults = await Promise.all(
      chunks.map(chunk =>
        extractFieldsFromChunk(
          chunk.text,
          chunk.total > 1 ? ` (excerpt ${chunk.index + 1} of ${chunk.total})` : ''
        )
      )
    );

    const data = mergeRfpFieldSets(chunkResults);
    return { data, rawText: plainText };
  };

  /**
   * Main upload handler â€” accepts multiple files, parses them sequentially
   * (one at a time so we don't overwhelm the local LLM), and merges results.
   */
  const handleRfpUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;

    setRfpParsing(true);
    const successNames: string[] = [];
    const failNames: string[] = [];
    const allRawText: string[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setRfpParseProgress(
        files.length > 1
          ? `Parsing file ${i + 1} of ${files.length}: ${file.name}â€¦`
          : `Parsing ${file.name}â€¦`
      );
      try {
        const { data, rawText } = await parseSingleFile(file);
        mergeRfpData(data);
        successNames.push(file.name);
        allRawText.push(`=== ${file.name} ===\n${rawText}`);
      } catch (err: unknown) {
        failNames.push(`${file.name}: ${err instanceof Error ? err.message : 'unknown error'}`);
      }
    }

    // Store consolidated raw text for AI estimation (resources + cost lines)
    setRfpRawText(prev => [prev, ...allRawText].filter(Boolean).join('\n\n'));
    setRfpFiles(prev => [...prev, ...successNames]);
    setRfpParseProgress('');

    // Result toast
    if (successNames.length > 0 && failNames.length === 0) {
      toast({
        title: `âœ“ ${successNames.length} file${successNames.length > 1 ? 's' : ''} parsed`,
        description: successNames.length > 1
          ? `Parsed and merged: ${successNames.join(', ')}`
          : `Fields pre-filled from "${successNames[0]}". Review each step.`,
      });
    } else if (successNames.length > 0 && failNames.length > 0) {
      toast({
        title: `âš  ${successNames.length} parsed, ${failNames.length} failed`,
        description: `Parsed: ${successNames.join(', ')}. Failed: ${failNames.join('; ')}`,
        variant: 'default',
      });
    } else {
      toast({ title: 'RFP Parse Failed', description: failNames.join('; '), variant: 'destructive' });
    }

    if (fileInputRef.current) fileInputRef.current.value = '';
    setRfpParsing(false);
  };
  const handleSaveDraft = async () => {
    setSavingDraft(true);
    try {
      const id = draftId || `DRAFT-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
      const draftRow = {
        id,
        title: String(form.opportunityName || 'Untitled Proposal'),
        client_name: String(form.clientName || 'Unknown Client'),
        client_group: form.clientGroup ? String(form.clientGroup) : null,
        industry: form.industry ? String(form.industry) : null,
        status: 'Draft',
        geography: String(form.geography || 'India'),
        lob: form.opportunityType ? String(form.opportunityType) : null,
        modules: Array.isArray(form.modules) ? form.modules.map(String) : [],
        currency: String(form.currency || 'INR'),
        expected_duration: form.expectedDuration ? String(form.expectedDuration) : null,
        opportunity_type: form.opportunityType ? String(form.opportunityType) : null,
        submission_date: form.submissionDate ? String(form.submissionDate) : null,
        priority: String(form.priority || 'Medium'),
        deal_type: form.dealType ? String(form.dealType) : null,
        discount: Number(form.discountRequested) || 0,
        owner: form.dealOwner ? String(form.dealOwner) : null,
        risk_level: (String(form.timelinePressure ?? '').toLowerCase().includes('aggressive') || String(form.dependencyRisks ?? '').trim()) ? 'High' : 'Medium',
        updated_at: new Date().toISOString(),
        metadata: {
          draft_step: step,
          draft_form: Object.fromEntries(
            Object.entries(form).map(([k, v]) => [
              k,
              Array.isArray(v) ? v.map(String) : (v == null ? '' : String(v))
            ])
          ),
          rfp_raw_text: rfpRawText,
          rfp_session_id: rfpSessionId,
          rfp_files: rfpFiles,
          cost_lines: costLines,
          resource_hours: resourceHours,
          selected_role_ids: Array.from(selectedRoleIds),
          ai_consultant_ids: Array.from(aiConsultantIds),
          ai_gap_role_ids: Array.from(aiGapRoleIds),
          ai_reasons: aiReasons,
          ai_estimate: aiEstimate,
          costing_mode: costingMode,
          coverLetter: coverLetter,
          complianceChecklist: complianceChecklist,
          presalesBriefing: presalesBriefing ? {
            ...presalesBriefing,
            qa: (presalesBriefing.qa ?? []).map(q => ({
              ...q,
              answer: String(q.answer ?? ''),
              question: String(q.question ?? ''),
              category: String(q.category ?? ''),
            })),
            presalesNotes: String(presalesBriefing.presalesNotes ?? ''),
            kbDocIds: presalesBriefing.kbDocIds ?? [],
            resourceHours: (presalesBriefing.resourceHours ?? []).map(r => ({
              ...r,
              notes: String(r.notes ?? ''),
              skill: String(r.skill ?? ''),
            })),
          } : null,
        },
      };
      await supabase.from('proposals' as never).upsert({
        ...draftRow,
        created_at: draftId ? undefined : new Date().toISOString(),
      } as never, { onConflict: 'id' });
      if (!draftId) setDraftId(id);
      toast({ title: 'âœ“ Draft Saved', description: `"${draftRow.title}" saved to Knowledge Base.` });
    } catch (err) {
      toast({ title: 'Save failed', description: String(err), variant: 'destructive' });
    } finally {
      setSavingDraft(false);
    }
  };

  const handleSubmit = () => {
    if (!form.clientName || !form.opportunityName) {
      toast({ title: 'Missing required fields', description: 'Please fill in Client Name and Opportunity Name.', variant: 'destructive' });
      return;
    }

    // Helper â€” safely converts any value to string or undefined
    const s = (v: unknown): string | undefined => {
      if (v == null || v === '') return undefined;
      return String(v);
    };

    const metadata: ProposalMetadata = {
      proposalType: s(form.proposalType),
      projectType: s(form.projectType),
      implementationModel: s(form.implementationModel),
      supportWindow: s(form.supportWindow),
      slaReqs: s(form.slaReqs),
      integrationReqs: s(form.integrationReqs),
      customDevScope: s(form.customDevScope),
      clientPainPoints: s(form.clientPainPoints),
      mandatoryDeliverables: s(form.mandatoryDeliverables),
      billingModel: s(form.billingModel),
      paymentMilestone: s(form.paymentMilestone),
      commercialNotes: s(form.commercialNotes),
      timelinePressure: s(form.timelinePressure),
      clientContractFormat: s(form.clientContractFormat),
      securityCompliance: s(form.securityCompliance),
      specialResources: s(form.specialResources),
      mandatoryLegalClauses: s(form.mandatoryLegalClauses),
      dependencyRisks: s(form.dependencyRisks),
      deliveryAssumptions: s(form.deliveryAssumptions),
      exclusions: s(form.exclusions),
      salesNotes: s(form.salesNotes),
      presalesNotes: s(form.presalesNotes),
      competitorContext: s(form.competitorContext),
      winStrategy: s(form.winStrategy),
      clientRelationship: s(form.clientRelationship),
      rfpRawText: rfpRawText || undefined,
      rfpFiles: rfpFiles.length > 0 ? rfpFiles : undefined,
      rfpSessionId: rfpSessionId || undefined,
      coverLetter: coverLetter,
      complianceChecklist: complianceChecklist,
      presalesBriefing: presalesBriefing ? {
        ...presalesBriefing,
        qa: (presalesBriefing.qa ?? []).map(q => ({
          ...q,
          answer: String(q.answer ?? ''),
          question: String(q.question ?? ''),
          category: String(q.category ?? ''),
        })),
        presalesNotes: String(presalesBriefing.presalesNotes ?? ''),
        kbDocIds: presalesBriefing.kbDocIds ?? [],
        resourceHours: (presalesBriefing.resourceHours ?? []).map(r => ({
          ...r,
          notes: String(r.notes ?? ''),
          skill: String(r.skill ?? ''),
        })),
      } : undefined,
    };

    const newProposal: Proposal = {
      id: nextId,
      title: String(form.opportunityName || 'Untitled'),
      clientName: String(form.clientName || 'Unknown Client'),
      clientGroup: String(form.clientGroup || ''),
      industry: String(form.industry || ''),
      geography: String(form.geography || 'India'),
      lob: (form.opportunityType || 'SAP Implementation â€“ Rise') as Proposal['lob'],
      opportunityType: (form.opportunityType || 'SAP Implementation â€“ Rise') as Proposal['opportunityType'],
      owner: form.dealOwner || user?.name || 'Unknown',
      status: 'Draft',
      createdAt: new Date().toISOString().slice(0, 10),
      updatedAt: new Date().toISOString().slice(0, 10),
      submissionDate: form.submissionDate || new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
      priority: form.priority as Proposal['priority'],
      dealType: (form.dealType || 'Fixed Price') as Proposal['dealType'],
      currency: form.currency,
      expectedDuration: form.expectedDuration || '12 months',
      expectedRevenue: (() => {
        // Priority: AI suggested price â†’ client budget â†’ cost-sheet total â†’ 0
        if (aiEstimate?.aiSuggestedPrice) return aiEstimate.aiSuggestedPrice;
        if (Number(form.clientBudget) > 0) return Number(form.clientBudget);
        // Compute from cost sheet: resources + cost lines
        const selected = buildSelectedResources();
        const resRev = selected.reduce((s, r) => s + r.hours * r.billingRate, 0);
        const hwRev  = costLines.filter(l => l.category === 'hardware').reduce((s, l) => s + l.qty * l.unitCost * (1 + l.marginPct / 100), 0);
        const otRev  = costLines.filter(l => l.category === 'other').reduce((s, l) => s + l.qty * l.unitCost * (1 + l.marginPct / 100), 0);
        const total  = (resRev + hwRev + otRev) * (1 - (Number(form.discountRequested) || 0) / 100);
        return total > 0 ? Math.round(total) : 0;
      })(),
      grossMargin: (() => {
        if (aiEstimate) return aiEstimate.finalMarginPct;
        // Compute real margin from cost sheet
        const selected = buildSelectedResources();
        const resRev  = selected.reduce((s, r) => s + r.hours * r.billingRate, 0);
        const resCost = selected.reduce((s, r) => s + r.hours * r.costRate, 0);
        const hwRev   = costLines.filter(l => l.category === 'hardware').reduce((s, l) => s + l.qty * l.unitCost * (1 + l.marginPct / 100), 0);
        const hwCost  = costLines.filter(l => l.category === 'hardware').reduce((s, l) => s + l.qty * l.unitCost, 0);
        const otRev   = costLines.filter(l => l.category === 'other').reduce((s, l) => s + l.qty * l.unitCost * (1 + l.marginPct / 100), 0);
        const otCost  = costLines.filter(l => l.category === 'other').reduce((s, l) => s + l.qty * l.unitCost, 0);
        const totalRev  = (resRev + hwRev + otRev) * (1 - (Number(form.discountRequested) || 0) / 100);
        const totalCost = resCost + hwCost + otCost;
        return totalRev > 0 ? Math.round(((totalRev - totalCost) / totalRev) * 100) : 0;
      })(),
      discount: Number(form.discountRequested) || 0,
      modules: form.modules.length > 0 ? form.modules : ['FI'],
      riskLevel: (String(form.timelinePressure ?? '').toLowerCase().includes('aggressive') ||
                  String(form.dependencyRisks ?? '').trim().length > 0) ? 'High' : 'Medium',
      approvalProgress: 0,
      metadata,
    };

    addProposal(newProposal);
    toast({ title: 'âœ“ Proposal Created', description: `${nextId} â€” ${form.opportunityName} has been created.` });
    navigate(`/proposals/${nextId}`);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold font-heading">New Proposal</h1>
          <p className="text-sm text-muted-foreground">Proposal Intake Wizard</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {rfpFiles.length > 0 && !rfpParsing && rfpFiles.map((f, i) => (
            <span key={i} className="text-xs text-success flex items-center gap-1 bg-success/10 px-2 py-0.5 rounded-full">
              <Check className="h-3 w-3" /> {f}
            </span>
          ))}
          {rfpParseProgress && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" /> {rfpParseProgress}
            </span>
          )}
          <input ref={fileInputRef} type="file" accept=".docx,.pdf,.jpg,.jpeg,.png,.tiff" multiple className="hidden" onChange={handleRfpUpload} />
          <Button variant="outline" onClick={() => fileInputRef.current?.click()} disabled={rfpParsing}>
            {rfpParsing ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Parsingâ€¦</>
            ) : (
              <><Upload className="h-4 w-4 mr-2" /> Upload RFP (.docx){rfpFiles.length > 0 ? ' â€” add more' : ' â€” multiple files allowed'}</>
            )}
          </Button>
        </div>
      </div>

      {rfpFiles.length > 0 && !rfpParsing && (
        <div className="p-3 rounded-lg bg-info/5 border border-info/20 text-sm flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-info shrink-0" />
          <span>Fields pre-filled from <strong>{rfpFiles.join(', ')}</strong>. Review each step and adjust as needed before submitting.</span>
        </div>
      )}

      {/* Steps indicator */}
      <div className="flex items-center gap-1">
        {steps.map((s, i) => (
          <div key={i} className="flex items-center gap-1 flex-1">
            <button
              onClick={() => setStep(i)}
              className={`flex items-center gap-2 px-3 py-2 rounded-md text-xs font-medium transition-colors w-full ${
                i === step ? 'bg-primary text-primary-foreground' :
                i < step ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'
              }`}
            >
              {i < step ? <Check className="h-3 w-3" /> : <span className="font-bold">{i + 1}</span>}
              <span className="hidden lg:inline">{s}</span>
            </button>
          </div>
        ))}
      </div>

      <Card className="enterprise-shadow">
        <CardHeader>
          <CardTitle className="font-heading">{steps[step]}</CardTitle>
          <CardDescription>Step {step + 1} of {steps.length}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {step === 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Proposal ID</Label><Input value={nextId} disabled className="bg-muted/50" /></div>
              <div className="space-y-2"><Label>Opportunity Name *</Label><Input value={form.opportunityName} onChange={e => updateField('opportunityName', e.target.value)} placeholder="e.g. SAP S/4HANA Implementation" /></div>
              <div className="space-y-2"><Label>Client Name *</Label><Input value={form.clientName} onChange={e => updateField('clientName', e.target.value)} /></div>
              <div className="space-y-2"><Label>Client Group / Account</Label><Input value={form.clientGroup} onChange={e => updateField('clientGroup', e.target.value)} /></div>
              <div className="space-y-2"><Label>Geography</Label>
                <Select value={form.geography} onValueChange={v => updateField('geography', v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="India">India</SelectItem><SelectItem value="USA">USA</SelectItem><SelectItem value="Europe">Europe</SelectItem><SelectItem value="APAC">APAC</SelectItem><SelectItem value="Middle East">Middle East</SelectItem><SelectItem value="Global">Global</SelectItem></SelectContent>
                </Select>
              </div>
              <div className="space-y-2"><Label>Industry</Label><Input value={form.industry} onChange={e => updateField('industry', e.target.value)} placeholder="e.g. Manufacturing" /></div>
              <div className="space-y-2"><Label>Opportunity Type *</Label>
                <Select value={form.opportunityType} onValueChange={v => updateField('opportunityType', v)}>
                  <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="SAP Implementation â€“ Rise">SAP Implementation â€“ Rise</SelectItem>
                    <SelectItem value="SAP Implementation â€“ Grow">SAP Implementation â€“ Grow</SelectItem>
                    <SelectItem value="AMS">AMS</SelectItem>
                    <SelectItem value="Resource Augmentation">Resource Augmentation</SelectItem>
                    <SelectItem value="Upgrade / Migration">Upgrade / Migration</SelectItem>
                    <SelectItem value="BTP / AI">BTP / AI</SelectItem>
                    <SelectItem value="Tender">Tender</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2"><Label>Deal Owner</Label><Input value={form.dealOwner} onChange={e => updateField('dealOwner', e.target.value)} /></div>
              <div className="space-y-2"><Label>Expected Submission Date</Label><Input type="date" value={form.submissionDate} onChange={e => updateField('submissionDate', e.target.value)} /></div>
              <div className="space-y-2"><Label>Priority</Label>
                <Select value={form.priority} onValueChange={v => updateField('priority', v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="Low">Low</SelectItem><SelectItem value="Medium">Medium</SelectItem><SelectItem value="High">High</SelectItem><SelectItem value="Critical">Critical</SelectItem></SelectContent>
                </Select>
              </div>
              <div className="space-y-2"><Label>Proposal Type</Label>
                <Select value={form.proposalType} onValueChange={v => updateField('proposalType', v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="RFP">RFP</SelectItem><SelectItem value="RFQ">RFQ</SelectItem><SelectItem value="Proactive">Proactive Proposal</SelectItem></SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Currency</Label>
                <Select value={form.currency} onValueChange={v => updateField('currency', v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="INR">â‚¹ INR â€” Indian Rupee</SelectItem>
                    <SelectItem value="USD">$ USD â€” US Dollar</SelectItem>
                    <SelectItem value="EUR">â‚¬ EUR â€” Euro</SelectItem>
                    <SelectItem value="SGD">S$ SGD â€” Singapore Dollar</SelectItem>
                    <SelectItem value="AUD">A$ AUD â€” Australian Dollar</SelectItem>
                    <SelectItem value="AED">Ø¯.Ø¥ AED â€” UAE Dirham</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Used across all pricing, estimates and exports for this proposal.</p>
              </div>
            </div>
          )}
          {step === 1 && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2"><Label>Project Type</Label><Input value={form.projectType} onChange={e => updateField('projectType', e.target.value)} placeholder="e.g. Greenfield / Brownfield" /></div>
                <div className="space-y-2"><Label>Implementation Model</Label><Input value={form.implementationModel} onChange={e => updateField('implementationModel', e.target.value)} placeholder="e.g. SAP Activate" /></div>
                <div className="space-y-2"><Label>Support Window</Label><Input value={form.supportWindow} onChange={e => updateField('supportWindow', e.target.value)} placeholder="e.g. 8x5, 24x7" /></div>
                <div className="space-y-2"><Label>SLA Requirements</Label><Input value={form.slaReqs} onChange={e => updateField('slaReqs', e.target.value)} /></div>
              </div>
              <div className="space-y-2"><Label>Integration Requirements</Label><Textarea value={form.integrationReqs} onChange={e => updateField('integrationReqs', e.target.value)} /></div>
              <div className="space-y-2"><Label>Custom Development Scope</Label><Textarea value={form.customDevScope} onChange={e => updateField('customDevScope', e.target.value)} placeholder="e.g. Custom ABAP reports, Fiori apps, BTP extensions â€” describe scope of custom dev work" /></div>
              <div className="space-y-2"><Label>Client Pain Points</Label><Textarea value={form.clientPainPoints} onChange={e => updateField('clientPainPoints', e.target.value)} /></div>
              <div className="space-y-2"><Label>Mandatory Deliverables</Label><Textarea value={form.mandatoryDeliverables} onChange={e => updateField('mandatoryDeliverables', e.target.value)} /></div>

              {/* â”€â”€ Costing workflow choice â”€â”€ */}
              <div className="pt-4 border-t">
                <Label className="text-sm font-medium">How do you want to build the costing?</Label>
                <p className="text-xs text-muted-foreground mb-3">Choose how resources, hardware, and other costs are determined for this proposal.</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setCostingMode('ai')}
                    className={`text-left p-4 rounded-lg border-2 transition-all ${costingMode === 'ai' ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40'}`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Sparkles className="h-4 w-4 text-primary" />
                      <span className="font-medium text-sm">AI Auto-Calculate</span>
                    </div>
                    <p className="text-xs text-muted-foreground">AI reads the scope and estimates the full plan â€” resources &amp; hours, hardware/infra, other costs, then applies contingency &amp; margin rules. You review and adjust.</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setCostingMode('manual')}
                    className={`text-left p-4 rounded-lg border-2 transition-all ${costingMode === 'manual' ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40'}`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm">âœï¸</span>
                      <span className="font-medium text-sm">Manual Calculation</span>
                    </div>
                    <p className="text-xs text-muted-foreground">You enter everything â€” pick resources &amp; hours, add hardware and other costs. The system computes the price; AI only writes the rationale.</p>
                  </button>
                </div>
                {costingMode && (
                  <p className="text-xs text-success mt-2">
                    {costingMode === 'ai' ? 'ðŸ¤– AI Auto-Calculate selected â€” the next step will pre-fill an estimate you can refine.' : 'âœï¸ Manual Calculation selected â€” you\'ll build the costing yourself in the next step.'}
                  </p>
                )}
              </div>
            </div>
          )}

          {step === 3 && (
            <PreSalesBriefingStep
              rfpRawText={rfpRawText}
              opportunityType={form.opportunityType}
              clientName={form.clientName}
              modules={form.modules}
              geography={form.geography}
              industry={form.industry}
              lob={form.opportunityType}
              dealType={form.dealType}
              expectedDuration={form.expectedDuration}
              rfpSessionId={rfpSessionId}
              costBasis="marginal"
              currency={form.currency}
              availableRateCards={rateCards.length > 0 ? rateCards : []}
              dbResources={dbResources}
              kbDocuments={[]}
              briefing={presalesBriefing}
              onChange={setPresalesBriefing}
              checklist={complianceChecklist}
              onChecklistChange={setComplianceChecklist}
            />
          )}
          {step === 4 && (() => {
            // Rate-card templates (from CommercialRulesContext / mockData)
            const rateCardRoles = getMatchingRates(form.geography, form.modules);
            // All named consultants from Supabase â€” no geography or module filter.
            // The proposal maker decides who to include; AI suggestions are a starting point.
            const dbRoles = dbResources.map(mapDbResourceToRoleRow);
            // Deduplicate: prefer rate card if same id appears in both (shouldn't happen)
            const rateCardIds = new Set(rateCardRoles.map(r => r.id));
            const uniqueDbRoles = dbRoles.filter(r => !rateCardIds.has(r.id));
            const availableRoles = [...rateCardRoles, ...uniqueDbRoles];
            const currSymbol = form.currency === 'INR' ? 'â‚¹' : form.currency === 'EUR' ? 'â‚¬' : form.currency === 'SGD' ? 'S$' : form.currency === 'AUD' ? 'A$' : form.currency === 'AED' ? 'Ø¯.Ø¥' : '$';
            const fmt = (n: number) => {
              if (form.currency === 'INR') {
                if (n >= 10000000) return `â‚¹${(n/10000000).toFixed(2)} Cr`;
                if (n >= 100000) return `â‚¹${(n/100000).toFixed(1)} L`;
                return `â‚¹${n.toLocaleString()}`;
              }
              return `${currSymbol}${n.toLocaleString()}`;
            };
            const selectedRows = availableRoles.filter(r => selectedRoleIds.has(r.id));
            const totalHours = selectedRows.reduce((s, r) => s + (resourceHours[r.id] || 0), 0);
            const totalRevenue = selectedRows.reduce((s, r) => s + (resourceHours[r.id] || 0) * r.billingRate, 0);
            const totalCost = selectedRows.reduce((s, r) => s + (resourceHours[r.id] || 0) * r.costRate, 0);
            const blendedMargin = totalRevenue > 0 ? Math.round(((totalRevenue - totalCost) / totalRevenue) * 100) : 0;

            const grouped: Record<string, typeof availableRoles> = {};
            availableRoles.forEach(r => {
              if (!grouped[r.roleLevel]) grouped[r.roleLevel] = [];
              grouped[r.roleLevel].push(r);
            });
            const levelOrder = ['Principal', 'Senior', 'Mid', 'Junior'];

            return (
              <div className="space-y-5">

                {/* â”€â”€ SAP Module Selection (moved here from Step 0) â”€â”€ */}
                <div className="rounded-lg border p-4 space-y-3 bg-muted/20">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="text-sm font-medium">SAP Modules</Label>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {costingMode === 'ai' && rfpFiles.length > 0
                          ? 'Auto-populated from your uploaded RFP. Adjust if needed.'
                          : 'Select the modules in scope for this engagement.'}
                      </p>
                    </div>
                    {form.modules.length > 0 && (
                      <span className="text-xs text-success bg-success/10 px-2 py-0.5 rounded-full">{form.modules.length} selected</span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {/* Selected modules â€” show as removable chips */}
                    {form.modules.map(mod => (
                      <span key={mod} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium bg-primary text-primary-foreground border border-primary">
                        {mod}
                        <button type="button" onClick={() => toggleModule(mod)} className="ml-0.5 hover:opacity-70 font-bold" title="Remove module">Ã—</button>
                      </span>
                    ))}
                    {/* Unselected modules â€” show as add buttons */}
                    {sapModules.filter(m => !form.modules.includes(m)).map(mod => (
                      <button
                        key={mod}
                        type="button"
                        onClick={() => toggleModule(mod)}
                        className="px-3 py-1.5 rounded-md text-xs font-medium border border-dashed border-border text-muted-foreground hover:border-primary hover:text-foreground transition-colors"
                      >
                        + {mod}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">SAP modules are for reference only â€” all resources and rate cards are shown below regardless of selection.</p>
                </div>

                {/* â”€â”€ AI Auto-Calculate: Estimate Resources button â”€â”€ */}
                {costingMode === 'ai' && (
                  <div className="rounded-lg border-2 border-primary/30 bg-primary/5 p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-semibold flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" /> AI Resource Estimation</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          AI will analyse the scope{rfpFiles.length > 0 ? ' and uploaded RFP documents' : ''} to suggest which roles are needed and how many hours each.
                        </p>
                      </div>
                      <Button
                        type="button"
                        onClick={async () => {
                          setResourceEstimating(true);
                          try {
                            const result: ResourceEstimateResult = await generateResourceEstimate({
                              opportunityName: form.opportunityName,
                              clientName: form.clientName,
                              geography: form.geography,
                              industry: form.industry,
                              opportunityType: form.opportunityType,
                              modules: form.modules,
                              projectType: form.projectType,
                              implementationModel: form.implementationModel,
                              integrationReqs: form.integrationReqs,
                              customDevScope: form.customDevScope,
                              supportWindow: form.supportWindow,
                              slaReqs: form.slaReqs,
                              clientPainPoints: form.clientPainPoints,
                              mandatoryDeliverables: form.mandatoryDeliverables,
                              securityCompliance: form.securityCompliance,
                              expectedDuration: form.expectedDuration,
                              dealType: form.dealType,
                              currency: form.currency,
                              costBasis: 'marginal',
                              selectedResources: [],
                              rfpRawText: rfpRawText,
                            }, availableRoles, dbResources.map(r => ({
                              id: r.id,
                              name: r.name,
                              designation: r.designation,
                              sap_modules: r.sap_modules,
                              skills: r.skills,
                              geography: r.geography,
                              availability: r.availability,
                              years_of_experience: r.years_of_experience,
                              certifications: r.certifications,
                              languages: r.languages,
                              employment_type: r.employment_type,
                              billing_rate: r.billing_rate,
                              bio: r.bio,
                              profile_summary: r.profile_summary,
                              key_projects: r.key_projects,
                            })));

                            const newIds = new Set<string>();
                            const newHours: Record<string, number> = { ...resourceHours };
                            const reasons: Record<string, string> = {};

                            // Add named consultants (db- prefix)
                            const newConsultantIds = new Set<string>();
                            result.consultants.forEach(c => {
                              const id = `db-${c.dbId}`;
                              newIds.add(id);
                              newHours[id] = c.hours;
                              reasons[id] = c.reason;
                              newConsultantIds.add(id);
                            });

                            // Add gap roles (rate-card IDs)
                            const newGapIds = new Set<string>();
                            result.gapRoles.forEach(g => {
                              newIds.add(g.roleId);
                              newHours[g.roleId] = g.hours;
                              reasons[g.roleId] = g.reason;
                              newGapIds.add(g.roleId);
                            });

                            setSelectedRoleIds(newIds);
                            setResourceHours(newHours);
                            setAiConsultantIds(newConsultantIds);
                            setAiGapRoleIds(newGapIds);
                            setAiReasons(reasons);

                            const total = result.consultants.length + result.gapRoles.length;
                            if (total > 0) {
                              toast({
                                title: `âœ“ ${total} resources estimated`,
                                description: `${result.consultants.length} from your resource pool Â· ${result.gapRoles.length} additional gap roles. Review and adjust.`,
                              });
                            } else {
                              toast({ title: 'âš  No suggestions returned', description: 'Select modules and try again, or pick roles manually.', variant: 'default' });
                            }
                          } catch {
                            toast({ title: 'âŒ Estimation failed', description: 'Could not reach APNJ-LLM-Studio.', variant: 'destructive' });
                          } finally {
                            setResourceEstimating(false);
                          }
                        }}
                        disabled={resourceEstimating}
                      >
                        {resourceEstimating
                          ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Estimatingâ€¦</>
                          : <><Sparkles className="h-4 w-4 mr-2" /> {selectedRoleIds.size > 0 ? 'Re-estimate Resources' : 'Estimate Resources'}</>
                        }
                      </Button>
                    </div>
                    {selectedRoleIds.size > 0 && !resourceEstimating && (
                      <p className="text-xs text-success">
                        âœ“ {aiConsultantIds.size} from resource pool Â· {aiGapRoleIds.size} gap roles.
                        Review the sections below â€” remove any person or role that doesn't apply.
                      </p>
                    )}
                  </div>
                )}

                {availableRoles.length === 0 && (
                  <div className="flex items-center gap-2 p-4 rounded-lg bg-muted/30 border text-sm text-muted-foreground">
                    <Info className="h-4 w-4 shrink-0" />
                    No rate cards or named resources match this geography and module selection. Select modules above first, or add resources in the Resources page.
                  </div>
                )}

                {/* â”€â”€ AI mode: Section 1 â€” Named Consultants from Resource Pool â”€â”€ */}
                {costingMode === 'ai' && aiConsultantIds.size > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-semibold flex items-center gap-2">
                        <span className="h-5 w-5 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-bold">1</span>
                        From Resource Pool
                      </h4>
                      <span className="text-xs text-muted-foreground">{aiConsultantIds.size} consultant{aiConsultantIds.size !== 1 ? 's' : ''} selected by AI</span>
                    </div>
                    <div className="space-y-2">
                      {availableRoles
                        .filter(r => aiConsultantIds.has(r.id))
                        .map(r => {
                          const hrs = resourceHours[r.id] || 0;
                          const dbRes = dbResources.find(d => `db-${d.id}` === r.id);
                          return (
                            <div key={r.id} className="flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-muted/20 transition-colors">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <p className="text-sm font-medium truncate">{r.skill}</p>
                                  {dbRes && (
                                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${
                                      dbRes.availability === 'Available' ? 'bg-success/10 text-success' :
                                      dbRes.availability === 'Engaged' ? 'bg-destructive/10 text-destructive' :
                                      'bg-warning/10 text-warning'
                                    }`}>{dbRes.availability}</span>
                                  )}
                                </div>
                                <p className="text-xs text-muted-foreground">{r.locationType} Â· {r.experienceBand}</p>
                                {aiReasons[r.id] && <p className="text-xs text-info/80 italic mt-0.5">AI: {aiReasons[r.id]}</p>}
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <input
                                  type="number" min="0" step="8"
                                  value={hrs}
                                  onChange={e => setResourceHours(prev => ({ ...prev, [r.id]: Number(e.target.value) }))}
                                  className="w-20 h-8 text-center text-sm border rounded bg-background"
                                  placeholder="hrs"
                                />
                                <span className="text-xs text-muted-foreground">hrs</span>
                                <button type="button"
                                  title="Remove from selection"
                                  onClick={() => {
                                    setSelectedRoleIds(prev => { const n = new Set(prev); n.delete(r.id); return n; });
                                    setAiConsultantIds(prev => { const n = new Set(prev); n.delete(r.id); return n; });
                                  }}
                                  className="h-7 w-7 rounded-full flex items-center justify-center text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors">
                                  âœ•
                                </button>
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                )}

                {/* â”€â”€ AI mode: Section 2 â€” Gap Roles from Rate Cards â”€â”€ */}
                {costingMode === 'ai' && aiGapRoleIds.size > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-semibold flex items-center gap-2">
                        <span className="h-5 w-5 rounded-full bg-warning text-warning-foreground text-xs flex items-center justify-center font-bold">2</span>
                        Additional Roles Required (Gaps)
                      </h4>
                      <span className="text-xs text-muted-foreground">{aiGapRoleIds.size} role{aiGapRoleIds.size !== 1 ? 's' : ''} not covered by resource pool</span>
                    </div>
                    <div className="space-y-2">
                      {availableRoles
                        .filter(r => aiGapRoleIds.has(r.id))
                        .map(r => {
                          const hrs = resourceHours[r.id] || 0;
                          return (
                            <div key={r.id} className="flex items-center gap-3 p-3 rounded-lg border border-warning/20 bg-warning/5 hover:bg-warning/10 transition-colors">
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate">{r.skill}</p>
                                <p className="text-xs text-muted-foreground">{r.locationType} Â· {r.experienceBand}</p>
                                {aiReasons[r.id] && <p className="text-xs text-warning/80 italic mt-0.5">Gap: {aiReasons[r.id]}</p>}
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <input
                                  type="number" min="0" step="8"
                                  value={hrs}
                                  onChange={e => setResourceHours(prev => ({ ...prev, [r.id]: Number(e.target.value) }))}
                                  className="w-20 h-8 text-center text-sm border rounded bg-background"
                                  placeholder="hrs"
                                />
                                <span className="text-xs text-muted-foreground">hrs</span>
                                <button type="button"
                                  title="Remove this gap role"
                                  onClick={() => {
                                    setSelectedRoleIds(prev => { const n = new Set(prev); n.delete(r.id); return n; });
                                    setAiGapRoleIds(prev => { const n = new Set(prev); n.delete(r.id); return n; });
                                  }}
                                  className="h-7 w-7 rounded-full flex items-center justify-center text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors">
                                  âœ•
                                </button>
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                )}

                {/* â”€â”€ All Available Resources (manual picker â€” always shown) â”€â”€ */}
                {availableRoles.length > 0 && (
                  <>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium">
                          {costingMode === 'ai' && (aiConsultantIds.size > 0 || aiGapRoleIds.size > 0)
                            ? '3. All Available Roles â€” Add More Manually'
                            : 'Select Roles & Assign Hours'}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">{form.geography} Â· {form.modules.join(', ') || 'All modules'}</p>
                      </div>
                      <div className="flex gap-2">
                        <button type="button" className="text-xs text-primary underline underline-offset-2"
                          onClick={() => setSelectedRoleIds(new Set(availableRoles.map(r => r.id)))}>
                          Select all
                        </button>
                        <span className="text-muted-foreground text-xs">Â·</span>
                        <button type="button" className="text-xs text-muted-foreground underline underline-offset-2"
                          onClick={() => setSelectedRoleIds(new Set())}>
                          Clear
                        </button>
                      </div>
                    </div>

                    <div className="space-y-4">
                      {levelOrder.filter(l => grouped[l]).map(level => (
                        <div key={level}>
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">{level}</p>
                          <div className="space-y-2">
                            {grouped[level].map(r => {
                              const selected = selectedRoleIds.has(r.id);
                              const hrs = resourceHours[r.id] || 0;
                              const lineRev = hrs * r.billingRate;
                              const lineMargin = lineRev > 0 ? Math.round(((lineRev - hrs * r.costRate) / lineRev) * 100) : r.marginalMargin;
                              const marginClass = lineMargin < marginThreshold ? 'text-destructive' : lineMargin < marginThreshold + 10 ? 'text-warning' : 'text-success';
                              return (
                                <div
                                  key={r.id}
                                  className={`flex items-center gap-3 p-3 rounded-lg border transition-colors cursor-pointer ${selected ? 'bg-primary/5 border-primary/30' : 'bg-muted/20 hover:bg-muted/40'}`}
                                  onClick={() => toggleRole(r.id)}
                                >
                                  <input
                                    type="checkbox"
                                    checked={selected}
                                    readOnly
                                    className="h-4 w-4 accent-primary pointer-events-none shrink-0"
                                  />
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium truncate">{r.skill}</p>
                                    <p className="text-xs text-muted-foreground">{r.locationType} Â· {r.experienceBand}
                                      {(r as { isDbResource?: boolean }).isDbResource && (
                                        <span className={`ml-2 px-1.5 py-0.5 rounded-full text-[10px] font-medium ${
                                          (r as { availability?: string }).availability === 'Available' ? 'bg-success/10 text-success' :
                                          (r as { availability?: string }).availability === 'Engaged' ? 'bg-destructive/10 text-destructive' :
                                          'bg-warning/10 text-warning'
                                        }`}>
                                          {(r as { availability?: string }).availability ?? 'Unknown'}
                                        </span>
                                      )}
                                    </p>
                                  </div>
                                  <div className="text-right shrink-0">
                                    <p className="text-xs font-medium">{currSymbol}{r.billingRate}/hr</p>
                                    <p className="text-xs text-muted-foreground">cost {currSymbol}{r.costRate}/hr</p>
                                  </div>
                                  {selected && (
                                    <div className="flex items-center gap-2 shrink-0" onClick={e => e.stopPropagation()}>
                                      <input
                                        type="number"
                                        min="0"
                                        placeholder="hrs"
                                        value={hrs || ''}
                                        onChange={e => updateHours(r.id, Number(e.target.value))}
                                        className="w-20 h-8 text-xs border rounded px-2 bg-background text-foreground text-right"
                                      />
                                      <span className="text-xs text-muted-foreground w-8">hrs</span>
                                      {hrs > 0 && (
                                        <span className={`text-xs font-semibold w-10 text-right ${marginClass}`}>
                                          {lineMargin}%
                                        </span>
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>

                    {selectedRows.length > 0 && (
                      <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
                        <p className="text-xs font-semibold">Selection Summary</p>
                        <div className="grid grid-cols-3 gap-3 text-center">
                          <div className="rounded-md bg-background border p-2">
                            <p className="text-xs text-muted-foreground">Total Hours</p>
                            <p className="text-sm font-bold">{totalHours.toLocaleString()}</p>
                          </div>
                          <div className="rounded-md bg-background border p-2">
                            <p className="text-xs text-muted-foreground">Est. Revenue</p>
                            <p className="text-sm font-bold">{totalRevenue > 0 ? fmt(totalRevenue) : 'â€”'}</p>
                          </div>
                          <div className={`rounded-md bg-background border p-2 ${blendedMargin > 0 && blendedMargin < marginThreshold ? 'border-destructive/40' : ''}`}>
                            <p className="text-xs text-muted-foreground">Blended Margin</p>
                            <p className={`text-sm font-bold ${blendedMargin > 0 ? (blendedMargin < marginThreshold ? 'text-destructive' : 'text-success') : ''}`}>
                              {totalRevenue > 0 ? `${blendedMargin}%` : 'â€”'}
                            </p>
                          </div>
                        </div>
                        <div className="space-y-1">
                          {selectedRows.filter(r => resourceHours[r.id]).map(r => (
                            <div key={r.id} className="flex justify-between text-xs">
                              <span className="text-muted-foreground">{r.skill}</span>
                              <span>{resourceHours[r.id]}h Â· {fmt(resourceHours[r.id] * r.billingRate)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {selectedRows.length === 0 && (
                      <div className="text-center py-4 text-xs text-muted-foreground">
                        Select at least one role above to build your resource plan.
                        <br />You can also skip this step and use the AI estimate in Commercial Details.
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })()}

          {step === 5 && (() => {
            const curr = form.currency;
            const fmt = (n: number) => `${curr} ${Math.round(n).toLocaleString()}`;
            const selectedRows = buildSelectedResources();
            // Resource subtotals
            const resRevenue = selectedRows.reduce((s, r) => s + r.hours * r.billingRate, 0);
            const resCost    = selectedRows.reduce((s, r) => s + r.hours * r.costRate, 0);
            // Cost-line subtotals
            const lineCost = (l: CostLineItem) => l.qty * l.unitCost;
            const lineRev  = (l: CostLineItem) => l.qty * l.unitCost * (1 + l.marginPct / 100);
            const hw = costLines.filter(l => l.category === 'hardware');
            const ot = costLines.filter(l => l.category === 'other');
            const hwRevenue = hw.reduce((s, l) => s + lineRev(l), 0);
            const hwCost    = hw.reduce((s, l) => s + lineCost(l), 0);
            const otRevenue = ot.reduce((s, l) => s + lineRev(l), 0);
            const otCost    = ot.reduce((s, l) => s + lineCost(l), 0);
            // Grand totals
            const grandRevenue = resRevenue + hwRevenue + otRevenue;
            const grandCost    = resCost + hwCost + otCost;
            const grandMargin  = grandRevenue > 0 ? Math.round(((grandRevenue - grandCost) / grandRevenue) * 100) : 0;

            const addLine = (category: 'hardware' | 'other') =>
              setCostLines(prev => [...prev, { id: `m-${Date.now()}`, category, item: '', qty: 1, unitCost: 0, marginPct: category === 'hardware' ? 15 : 10 }]);
            const updateLine = (id: string, patch: Partial<CostLineItem>) =>
              setCostLines(prev => prev.map(l => l.id === id ? { ...l, ...patch } : l));
            const removeLine = (id: string) =>
              setCostLines(prev => prev.filter(l => l.id !== id));

            const loadAiCostLines = async () => {
              setCostLinesLoading(true);
              try {
                const lines = await generateCostLines({
                  opportunityName: form.opportunityName, clientName: form.clientName,
                  geography: form.geography, industry: form.industry, opportunityType: form.opportunityType,
                  modules: form.modules, projectType: form.projectType, implementationModel: form.implementationModel,
                  integrationReqs: form.integrationReqs, customDevScope: form.customDevScope,
                  supportWindow: form.supportWindow, slaReqs: form.slaReqs, clientPainPoints: form.clientPainPoints,
                  mandatoryDeliverables: form.mandatoryDeliverables, securityCompliance: form.securityCompliance,
                  expectedDuration: form.expectedDuration, dealType: form.dealType, currency: form.currency,
                  costBasis: 'marginal', selectedResources: [],
                  rfpRawText: rfpRawText,
                  rfpSessionId: rfpSessionId || undefined,
                });
                if (lines.length > 0) {
                  setCostLines(prev => [...prev, ...lines]);
                  toast({ title: 'âœ“ AI Cost Items Added', description: `${lines.length} hardware/other line items generated. Review and adjust.` });
                } else {
                  toast({ title: 'No items generated', description: 'AI returned no cost lines (or is offline). Add them manually.', variant: 'default' });
                }
              } finally {
                setCostLinesLoading(false);
              }
            };

            const renderLineTable = (cat: 'hardware' | 'other', label: string) => {
              const lines = costLines.filter(l => l.category === cat);
              return (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-medium">{label}</h4>
                    <Button type="button" size="sm" variant="outline" onClick={() => addLine(cat)}>+ Add {cat === 'hardware' ? 'Hardware' : 'Cost'}</Button>
                  </div>
                  {lines.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic px-1">No {label.toLowerCase()} added.</p>
                  ) : (
                    <div className="overflow-x-auto border rounded-lg">
                      <table className="w-full text-xs">
                        <thead className="bg-muted/40">
                          <tr className="text-left">
                            <th className="px-2 py-1.5 font-medium">Item</th>
                            <th className="px-2 py-1.5 font-medium w-16">Qty</th>
                            <th className="px-2 py-1.5 font-medium w-28">Unit Cost</th>
                            <th className="px-2 py-1.5 font-medium w-20">Margin %</th>
                            <th className="px-2 py-1.5 font-medium w-28 text-right">Line Cost</th>
                            <th className="px-2 py-1.5 font-medium w-28 text-right">Line Revenue</th>
                            <th className="w-8"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {lines.map(l => (
                            <tr key={l.id} className="border-t">
                              <td className="px-2 py-1"><input className="w-full h-7 px-1 border rounded bg-background" value={l.item} placeholder="Description" onChange={e => updateLine(l.id, { item: e.target.value })} /></td>
                              <td className="px-2 py-1"><input type="number" min="0" className="w-full h-7 px-1 border rounded bg-background" value={l.qty} onChange={e => updateLine(l.id, { qty: Number(e.target.value) })} /></td>
                              <td className="px-2 py-1"><input type="number" min="0" className="w-full h-7 px-1 border rounded bg-background" value={l.unitCost} onChange={e => updateLine(l.id, { unitCost: Number(e.target.value) })} /></td>
                              <td className="px-2 py-1"><input type="number" min="0" className="w-full h-7 px-1 border rounded bg-background" value={l.marginPct} onChange={e => updateLine(l.id, { marginPct: Number(e.target.value) })} /></td>
                              <td className="px-2 py-1 text-right text-muted-foreground">{fmt(lineCost(l))}</td>
                              <td className="px-2 py-1 text-right font-medium">{fmt(lineRev(l))}</td>
                              <td className="px-2 py-1"><button type="button" className="text-destructive hover:opacity-70" onClick={() => removeLine(l.id)}>âœ•</button></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            };

            return (
              <div className="space-y-5">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-heading font-semibold">Cost Sheet</h3>
                    <p className="text-xs text-muted-foreground">
                      {costingMode === 'ai'
                        ? 'AI-generated full costing â€” resources, hardware, and other costs. Review and adjust any line.'
                        : 'Build the complete costing â€” resources from the previous step, plus hardware and other costs below.'}
                    </p>
                  </div>
                  {costingMode === 'ai' && (
                    <Button type="button" size="sm" onClick={loadAiCostLines} disabled={costLinesLoading}>
                      {costLinesLoading ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Generatingâ€¦</> : <><Sparkles className="h-3 w-3 mr-1" /> AI Generate Hardware & Costs</>}
                    </Button>
                  )}
                </div>

                {/* SECTION 1 â€” Resource Allocation */}
                <div className="space-y-2">
                  <h4 className="text-sm font-medium">1. Resource Allocation</h4>
                  {selectedRows.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic px-1">No resources selected â€” go back to Resource Selection.</p>
                  ) : (
                    <div className="overflow-x-auto border rounded-lg">
                      <table className="w-full text-xs">
                        <thead className="bg-muted/40">
                          <tr className="text-left">
                            <th className="px-2 py-1.5 font-medium">Role</th>
                            <th className="px-2 py-1.5 font-medium">Location</th>
                            <th className="px-2 py-1.5 font-medium w-16">Hours</th>
                            <th className="px-2 py-1.5 font-medium w-24">Bill Rate</th>
                            <th className="px-2 py-1.5 font-medium w-24">Cost Rate</th>
                            <th className="px-2 py-1.5 font-medium w-28 text-right">Cost</th>
                            <th className="px-2 py-1.5 font-medium w-28 text-right">Revenue</th>
                            <th className="px-2 py-1.5 font-medium w-16 text-right">Margin</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedRows.map(r => {
                            const rev = r.hours * r.billingRate;
                            const cost = r.hours * r.costRate;
                            const m = rev > 0 ? Math.round(((rev - cost) / rev) * 100) : 0;
                            return (
                              <tr key={r.roleId} className="border-t">
                                <td className="px-2 py-1">{r.role}</td>
                                <td className="px-2 py-1 text-muted-foreground">{r.locationType}</td>
                                <td className="px-2 py-1">{r.hours}</td>
                                <td className="px-2 py-1">{fmt(r.billingRate)}</td>
                                <td className="px-2 py-1 text-muted-foreground">{fmt(r.costRate)}</td>
                                <td className="px-2 py-1 text-right text-muted-foreground">{fmt(cost)}</td>
                                <td className="px-2 py-1 text-right font-medium">{fmt(rev)}</td>
                                <td className={`px-2 py-1 text-right font-medium ${m < marginThreshold ? 'text-destructive' : 'text-success'}`}>{m}%</td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot className="bg-muted/20 font-medium">
                          <tr className="border-t">
                            <td className="px-2 py-1.5" colSpan={5}>Resource Subtotal</td>
                            <td className="px-2 py-1.5 text-right">{fmt(resCost)}</td>
                            <td className="px-2 py-1.5 text-right">{fmt(resRevenue)}</td>
                            <td className="px-2 py-1.5"></td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </div>

                {/* SECTION 2 â€” Hardware */}
                <div className="space-y-1">
                  <h4 className="text-sm font-medium">2. Hardware / Infrastructure</h4>
                  {renderLineTable('hardware', 'Hardware Items')}
                </div>

                {/* SECTION 3 â€” Other */}
                <div className="space-y-1">
                  <h4 className="text-sm font-medium">3. Other Costs (Licenses, Travel, Training)</h4>
                  {renderLineTable('other', 'Other Cost Items')}
                </div>

                {/* SECTION 4 â€” Roll-up */}
                <div className="rounded-lg border-2 border-primary/20 bg-primary/5 p-4 space-y-2">
                  <h4 className="text-sm font-semibold">4. Cost Sheet Roll-Up</h4>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
                    <span className="text-muted-foreground">Resources</span><span className="text-right">{fmt(resRevenue)}</span>
                    <span className="text-muted-foreground">Hardware</span><span className="text-right">{fmt(hwRevenue)}</span>
                    <span className="text-muted-foreground">Other</span><span className="text-right">{fmt(otRevenue)}</span>
                    <span className="font-medium border-t pt-1">Total Revenue</span><span className="text-right font-medium border-t pt-1">{fmt(grandRevenue)}</span>
                    <span className="text-muted-foreground">Total Cost</span><span className="text-right text-muted-foreground">{fmt(grandCost)}</span>
                    <span className="font-semibold">Gross Margin</span>
                    <span className={`text-right font-semibold ${grandMargin < marginThreshold ? 'text-destructive' : 'text-success'}`}>{grandMargin}%</span>
                  </div>
                  {grandMargin < marginThreshold && (
                    <p className="text-xs text-destructive pt-1">âš  Margin {grandMargin}% is below the {marginThreshold}% threshold â€” Finance approval will be required.</p>
                  )}
                </div>

                {/* SECTION 5 â€” Compute price + rationale */}
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-muted-foreground">
                    Click to apply business rules (margin floor, contingency) and generate the {costingMode === 'ai' ? 'AI' : ''} rationale.
                  </p>
                  <Button type="button" onClick={handleGenerateEstimate} disabled={estimating || selectedRows.length === 0}>
                    {estimating ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Computingâ€¦</> : <><Sparkles className="h-4 w-4 mr-2" /> Compute Final Price</>}
                  </Button>
                </div>

                {aiEstimate && (
                  <div className="rounded-lg border bg-card p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold">Suggested Price</span>
                      <span className="text-lg font-bold text-primary">{fmt(aiEstimate.aiSuggestedPrice)}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">Final margin at this price: <span className="font-medium text-foreground">{aiEstimate.finalMarginPct}%</span></div>
                    {aiEstimate.rulesApplied.length > 0 && (
                      <div className="text-xs space-y-0.5 pt-1 border-t">
                        <span className="font-medium">Rules applied:</span>
                        {aiEstimate.rulesApplied.map((r, i) => (
                          <div key={i} className="text-muted-foreground">â€¢ {r.rule}: {r.adjustment} ({r.impact})</div>
                        ))}
                      </div>
                    )}
                    {aiEstimate.aiRationale && (
                      <div className="text-xs text-foreground/80 leading-relaxed pt-1 border-t">
                        <span className="font-medium text-info">Rationale: </span>{aiEstimate.aiRationale}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })()}

          {step === 6 && (() => {
            const previewRates = getMatchingRates(form.geography, form.modules);
            const showINR = form.currency !== 'INR';
            const toINR = (n: number) => {
              const rates: Record<string, number> = { USD: fxRate.USD, EUR: fxRate.EUR, SGD: fxRate.SGD, AUD: fxRate.AUD, AED: fxRate.AED };
              return Math.round(n * (rates[form.currency] ?? 1));
            };
            const fmtINR = (n: number) => {
              if (n >= 10000000) return `â‚¹${(n/10000000).toFixed(2)} Cr`;
              if (n >= 100000) return `â‚¹${(n/100000).toFixed(1)} L`;
              return `â‚¹${n.toLocaleString()}`;
            };
            return (
            <div className="space-y-4">
              {showINR && (
                <div className="flex items-center gap-4 p-3 rounded-lg bg-info/5 border border-info/20">
                  <span className="text-xs font-medium text-info shrink-0">INR Reference Rates</span>
                  {(['USD','EUR','SGD','AUD','AED'] as const)
                    .filter(cur => cur === form.currency)
                    .map(cur => {
                      const labels: Record<string,string> = { USD:'USD','EUR':'EUR','SGD':'SGD','AUD':'AUD','AED':'AED' };
                      return (
                        <div key={cur} className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">1 {labels[cur]} =</span>
                          <input type="number" min="1" step="0.1"
                            className="w-20 h-7 text-xs border rounded px-2 bg-background"
                            value={fxRate[cur]}
                            onChange={e => setFxRate(prev => ({ ...prev, [cur]: Number(e.target.value) }))}
                          />
                          <span className="text-xs text-muted-foreground">â‚¹</span>
                        </div>
                      );
                    })
                  }
                  <span className="text-xs text-muted-foreground">â€” all amounts show INR equivalent throughout</span>
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2"><Label>Deal Type *</Label>
                  <Select value={form.dealType} onValueChange={v => updateField('dealType', v)}>
                    <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent><SelectItem value="Fixed Price">Fixed Price</SelectItem><SelectItem value="Time & Material">Time & Material</SelectItem><SelectItem value="Hybrid">Hybrid</SelectItem></SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Currency</Label>
                  <div className="flex items-center h-10 px-3 rounded-md border bg-muted/40 text-sm text-muted-foreground">
                    {form.currency === 'INR' ? 'â‚¹ INR' : form.currency === 'EUR' ? 'â‚¬ EUR' : form.currency === 'SGD' ? 'S$ SGD' : form.currency === 'AUD' ? 'A$ AUD' : form.currency === 'AED' ? 'Ø¯.Ø¥ AED' : '$ USD'}
                    <span className="ml-2 text-xs">(set in Opportunity Details)</span>
                  </div>
                </div>
                <div className="space-y-2"><Label>Expected Duration</Label><Input value={form.expectedDuration} onChange={e => updateField('expectedDuration', e.target.value)} placeholder="e.g. 12 months" /></div>
                <div className="space-y-2"><Label>Billing Model</Label><Input value={form.billingModel} onChange={e => updateField('billingModel', e.target.value)} placeholder="e.g. Monthly" /></div>
                <div className="space-y-2"><Label>Client Budget</Label><Input value={form.clientBudget} onChange={e => updateField('clientBudget', e.target.value)} /></div>
                <div className="space-y-2"><Label>Discount Requested (%)</Label><Input value={form.discountRequested} onChange={e => updateField('discountRequested', e.target.value)} /></div>
                <div className="md:col-span-2 space-y-2"><Label>Commercial Notes</Label><Textarea value={form.commercialNotes} onChange={e => updateField('commercialNotes', e.target.value)} /></div>
              </div>

              {/* â”€â”€ AI Pricing Calculator â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
              {(() => {
                const discount = Number(form.discountRequested) || 0;
                const currSymbol = form.currency === 'INR' ? 'â‚¹' : form.currency === 'EUR' ? 'â‚¬' : form.currency === 'SGD' ? 'S$' : form.currency === 'AUD' ? 'A$' : form.currency === 'AED' ? 'Ø¯.Ø¥' : '$';
                const fmt = (n: number) => {
                  if (form.currency === 'INR') {
                    if (n >= 10000000) return `â‚¹${(n/10000000).toFixed(2)} Cr`;
                    if (n >= 100000)   return `â‚¹${(n/100000).toFixed(1)} L`;
                    return `â‚¹${n.toLocaleString()}`;
                  }
                  if (n >= 1000000) return `${currSymbol}${(n/1000000).toFixed(2)}M`;
                  if (n >= 1000) return `${currSymbol}${(n/1000).toFixed(1)}K`;
                  return `${currSymbol}${n.toLocaleString()}`;
                };
                const inrBadge = (n: number) => showINR && n > 0
                  ? <span className="text-[10px] text-muted-foreground ml-1">(â‰ˆ {fmtINR(toINR(n))})</span>
                  : null;

                // Rows from AI-suggested hours (falls back to previewRates if no estimate yet)
                const baseRates = previewRates.length > 0 ? previewRates : [];
                const rows = baseRates.map(r => {
                  const hrs = resourceHours[r.id] || 0;
                  const revenue        = r.billingRate * hrs;
                  const marginalCost   = r.costRate * hrs;
                  const absorptionCost = r.loadedCostRate * hrs;
                  const marginalMargin   = revenue > 0 ? Math.round(((revenue - marginalCost)   / revenue) * 100) : r.marginalMargin;
                  const absorptionMargin = revenue > 0 ? Math.round(((revenue - absorptionCost) / revenue) * 100) : r.absorptionMargin;
                  return { ...r, hrs, revenue, marginalCost, absorptionCost, marginalMargin, absorptionMargin };
                });

                const resourceRevenue     = rows.reduce((s, r) => s + r.revenue, 0);
                const totalAdditional = 0; // Additional costs moved to Cost Sheet (Step 4 costLines)
                // Hardware costs live in Cost Sheet (Step 4 costLines â€” category:'hardware')
                const hwRows: { id: string; item: string; qty: number; unitCost: number; margin: number; totalCost: number; sellingPrice: number }[] = [];
                const totalHwCost     = 0;
                const totalHwRevenue  = 0;
                const totalRevenue        = resourceRevenue + totalHwRevenue;
                const totalMarginalCost   = rows.reduce((s, r) => s + r.marginalCost, 0) + totalHwCost;
                const totalAbsorptionCost = rows.reduce((s, r) => s + r.absorptionCost, 0) + totalHwCost;
                const discountedRevenue   = totalRevenue * (1 - discount / 100);
                const blendedMarginal     = discountedRevenue > 0 ? Math.round(((discountedRevenue - totalMarginalCost)   / discountedRevenue) * 100) : 0;
                const blendedAbsorption   = discountedRevenue > 0 ? Math.round(((discountedRevenue - totalAbsorptionCost) / discountedRevenue) * 100) : 0;
                const activeMargin        = costingMethod === 'marginal' ? blendedMarginal : blendedAbsorption;
                const hasHours            = rows.some(r => r.hrs > 0);

                return (
                  <div className="rounded-lg border p-4 space-y-4">

                    {/* Header + Generate button */}
                    <div className="flex items-center justify-between flex-wrap gap-3">
                      <div>
                        <h4 className="text-sm font-heading font-semibold flex items-center gap-2">
                          <Sparkles className="h-4 w-4 text-primary" /> AI Pricing Calculator
                        </h4>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          AI analyses your scope and suggests resource hours + additional costs
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${costingMethod === 'marginal' ? 'bg-info/10 text-info border-info/30' : 'bg-warning/10 text-warning border-warning/30'}`}>
                          {costingMethod === 'marginal' ? 'Marginal costing' : 'Absorption costing'}
                        </span>
                        <Button
                          type="button"
                          size="sm"
                          onClick={handleGenerateEstimate}
                          disabled={estimating}
                        >
                          {estimating
                            ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> {costingMode === 'ai' ? 'Analysing scopeâ€¦' : 'Writing rationaleâ€¦'}</>
                            : <><Sparkles className="h-3 w-3 mr-1" /> {costingMode === 'ai' ? (aiEstimate ? 'Regenerate AI Estimate' : 'AI Auto-Calculate') : (aiEstimate ? 'Recompute & Explain' : 'Compute Price')}</>
                          }
                        </Button>
                      </div>
                    </div>

                    {/* AI Summary */}
                    {aiEstimate?.aiRationale && (
                      <div className="p-3 rounded-lg bg-info/5 border border-info/20 text-xs text-foreground/80 leading-relaxed">
                        <span className="font-medium text-info">AI Analysis: </span>{aiEstimate.aiRationale}
                      </div>
                    )}

                    {/* Resource Plan Table */}
                    {(baseRates.length > 0) && (
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-xs font-medium">Resource Plan</p>
                          <p className="text-xs text-muted-foreground">{form.geography} Â· {form.modules.join(', ')}</p>
                        </div>
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b text-left">
                              <th className="pb-2 font-medium text-muted-foreground text-xs">Role</th>
                              <th className="pb-2 font-medium text-muted-foreground text-xs">$/hr</th>
                              {costingMethod === 'absorption' && <th className="pb-2 font-medium text-muted-foreground text-xs">Loaded</th>}
                              <th className="pb-2 font-medium text-muted-foreground text-xs">Hours</th>
                              <th className="pb-2 font-medium text-muted-foreground text-xs">Revenue</th>
                              <th className="pb-2 font-medium text-muted-foreground text-xs">Margin</th>
                              {aiEstimate && <th className="pb-2 font-medium text-muted-foreground text-xs">AI Rationale</th>}
                            </tr>
                          </thead>
                          <tbody>
                            {rows.map(r => {
                              const margin = costingMethod === 'marginal' ? r.marginalMargin : r.absorptionMargin;
                              const marginClass = margin < marginThreshold ? 'text-destructive font-bold' : margin < marginThreshold + 10 ? 'text-warning font-medium' : 'text-success font-medium';
                              const aiRow = aiEstimate?.breakdown.find(ar => ar.roleId === r.id);
                              return (
                                <tr key={r.id} className="border-b last:border-0">
                                  <td className="py-2 font-medium text-xs">{r.skill}</td>
                                  <td className="py-2 text-xs text-muted-foreground">${r.billingRate}</td>
                                  {costingMethod === 'absorption' && <td className="py-2 text-xs text-muted-foreground">${r.loadedCostRate}</td>}
                                  <td className="py-2">
                                    <input
                                      type="number" min="0" placeholder="0"
                                      value={resourceHours[r.id] || ''}
                                      onChange={e => updateHours(r.id, Number(e.target.value))}
                                      className="w-20 h-7 text-xs border rounded px-2 bg-background text-foreground"
                                    />
                                  </td>
                                  <td className="py-2 text-xs font-medium">{r.hrs > 0 ? fmt(r.revenue) : 'â€”'}</td>
                                  <td className="py-2">
                                    <span className={`text-xs ${r.hrs > 0 ? marginClass : 'text-muted-foreground'}`}>
                                      {r.hrs > 0 ? `${margin}%${margin < marginThreshold ? ' âš ' : ''}` : 'â€”'}
                                    </span>
                                  </td>
                                  {aiEstimate && (
                                    <td className="py-2 text-xs text-muted-foreground max-w-[180px] truncate">
                                      {'â€”'}
                                    </td>
                                  )}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* Additional costs are managed in Cost Sheet (Step 4) */}

                    {/* AI Assumptions */}
                    {(aiEstimate as any)?.assumptions?.length > 0 && (
                      <div>
                        <p className="text-xs font-medium mb-1">Pricing Assumptions</p>
                        <ul className="space-y-1">
                          {((aiEstimate as any).assumptions as string[]).map((a, i) => (
                            <li key={i} className="text-xs text-muted-foreground flex gap-2">
                              <span className="shrink-0">â€¢</span>{a}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}


                    {/* Hardware costs are managed in Cost Sheet (Step 4) */}

                                        {/* â”€â”€ Full Cost Sheet â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
                    {hasHours && (
                      <div className="rounded-lg border overflow-hidden">
                        <div className="px-4 py-2 bg-muted/30 border-b flex items-center justify-between">
                          <p className="text-xs font-semibold uppercase tracking-wide">Cost Sheet</p>
                          <span className="text-[10px] text-muted-foreground">
                            {costingMethod === 'marginal' ? 'Marginal costing active' : 'Absorption costing active'}
                          </span>
                        </div>
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b bg-muted/10 text-left text-[10px] text-muted-foreground uppercase tracking-wide">
                              <th className="px-3 py-2">Category</th>
                              <th className="px-3 py-2">Item</th>
                              <th className="px-3 py-2 text-right">Hours/Qty</th>
                              <th className="px-3 py-2 text-right">Unit Cost</th>
                              <th className="px-3 py-2 text-right">Total Cost</th>
                              <th className="px-3 py-2 text-right">Selling Price</th>
                              {showINR && <th className="px-3 py-2 text-right">INR Equiv.</th>}
                              <th className="px-3 py-2 text-right">Margin</th>
                            </tr>
                          </thead>
                          <tbody>
                            {/* Resource rows */}
                            {rows.filter(r => r.hrs > 0).map(r => {
                              const cost = costingMethod === 'marginal' ? r.marginalCost : r.absorptionCost;
                              const margin = costingMethod === 'marginal' ? r.marginalMargin : r.absorptionMargin;
                              const mc = margin < marginThreshold ? 'text-destructive' : margin < marginThreshold + 10 ? 'text-warning' : 'text-success';
                              const unitCostRate = costingMethod === 'marginal' ? r.costRate : r.loadedCostRate;
                              return (
                                <tr key={r.id} className="border-b last:border-0 hover:bg-muted/10">
                                  <td className="px-3 py-2 text-muted-foreground">Resources</td>
                                  <td className="px-3 py-2 font-medium">{r.skill}</td>
                                  <td className="px-3 py-2 text-right">{r.hrs}h</td>
                                  <td className="px-3 py-2 text-right text-muted-foreground">{currSymbol}{unitCostRate}/h</td>
                                  <td className="px-3 py-2 text-right">{fmt(cost)}</td>
                                  <td className="px-3 py-2 text-right font-medium">{fmt(r.revenue)}</td>
                                  {showINR && <td className="px-3 py-2 text-right text-muted-foreground">{fmtINR(toINR(r.revenue))}</td>}
                                  <td className={`px-3 py-2 text-right font-semibold ${mc}`}>{margin}%</td>
                                </tr>
                              );
                            })}
                            {/* Hardware rows */}
                            {hwRows.filter(h => h.totalCost > 0).map(h => {
                              const hwMargin = h.sellingPrice > 0 ? Math.round(((h.sellingPrice - h.totalCost) / h.sellingPrice) * 100) : 0;
                              const hwMc = hwMargin < 10 ? 'text-destructive' : hwMargin < 20 ? 'text-warning' : 'text-success';
                              return (
                                <tr key={h.id} className="border-b last:border-0 hover:bg-muted/10">
                                  <td className="px-3 py-2 text-muted-foreground">Hardware</td>
                                  <td className="px-3 py-2 font-medium">{h.item || 'Hardware item'}</td>
                                  <td className="px-3 py-2 text-right">{h.qty}</td>
                                  <td className="px-3 py-2 text-right text-muted-foreground">{fmt(h.unitCost)}</td>
                                  <td className="px-3 py-2 text-right">{fmt(h.totalCost)}</td>
                                  <td className="px-3 py-2 text-right font-medium">{fmt(h.sellingPrice)}</td>
                                  {showINR && <td className="px-3 py-2 text-right text-muted-foreground">{fmtINR(toINR(h.sellingPrice))}</td>}
                                  <td className={`px-3 py-2 text-right font-semibold ${hwMc}`}>{hwMargin}%</td>
                                </tr>
                              );
                            })}
                            {/* Additional costs shown in Cost Sheet (Step 4) */}
                            {/* Totals row */}
                            <tr className="bg-muted/20 font-semibold border-t-2">
                              <td className="px-3 py-2" colSpan={2}>Total</td>
                              <td className="px-3 py-2 text-right">â€”</td>
                              <td className="px-3 py-2 text-right">â€”</td>
                              <td className="px-3 py-2 text-right">{fmt(costingMethod === 'marginal' ? totalMarginalCost : totalAbsorptionCost)}</td>
                              <td className="px-3 py-2 text-right text-primary">{fmt(totalRevenue)}</td>
                              {showINR && <td className="px-3 py-2 text-right text-muted-foreground">{fmtINR(toINR(totalRevenue))}</td>}
                              <td className={`px-3 py-2 text-right ${activeMargin < marginThreshold ? 'text-destructive' : 'text-success'}`}>{activeMargin}%</td>
                            </tr>
                          </tbody>
                        </table>

                        {/* Creator price comparison */}
                        {Number(form.clientBudget) > 0 && (
                          <div className="border-t px-4 py-3 bg-muted/5">
                            <p className="text-xs font-semibold mb-2">Creator Price vs AI Estimate</p>
                            {(() => {
                              const creatorPrice = Number(form.clientBudget);
                              const aiPrice = discountedRevenue;
                              const diff = creatorPrice - aiPrice;
                              const diffPct = aiPrice > 0 ? Math.round((diff / aiPrice) * 100) : 0;
                              const creatorMarginalMargin = creatorPrice > 0 ? Math.round(((creatorPrice - totalMarginalCost) / creatorPrice) * 100) : 0;
                              const creatorAbsorptionMargin = creatorPrice > 0 ? Math.round(((creatorPrice - totalAbsorptionCost) / creatorPrice) * 100) : 0;
                              const creatorActiveMargin = costingMethod === 'marginal' ? creatorMarginalMargin : creatorAbsorptionMargin;
                              const diffClass = diff >= 0 ? 'text-success' : 'text-destructive';
                              return (
                                <div className="grid grid-cols-4 gap-3 text-center">
                                  <div className="rounded-lg border p-2">
                                    <p className="text-[10px] text-muted-foreground">Your Price</p>
                                    <p className="text-sm font-bold">{fmt(creatorPrice)}</p>
                                    {showINR && <p className="text-[10px] text-muted-foreground">{fmtINR(toINR(creatorPrice))}</p>}
                                  </div>
                                  <div className="rounded-lg border p-2">
                                    <p className="text-[10px] text-muted-foreground">AI Recommended</p>
                                    <p className="text-sm font-bold">{fmt(aiPrice)}</p>
                                    {showINR && <p className="text-[10px] text-muted-foreground">{fmtINR(toINR(aiPrice))}</p>}
                                  </div>
                                  <div className={`rounded-lg border p-2 ${diff < 0 ? 'border-destructive/30 bg-destructive/5' : 'border-success/30 bg-success/5'}`}>
                                    <p className="text-[10px] text-muted-foreground">Difference</p>
                                    <p className={`text-sm font-bold ${diffClass}`}>{diff >= 0 ? '+' : ''}{fmt(diff)}</p>
                                    <p className={`text-[10px] ${diffClass}`}>{diffPct >= 0 ? '+' : ''}{diffPct}%</p>
                                  </div>
                                  <div className={`rounded-lg border p-2 ${creatorActiveMargin < marginThreshold ? 'border-destructive/30 bg-destructive/5' : 'border-success/30 bg-success/5'}`}>
                                    <p className="text-[10px] text-muted-foreground">Your Margin ({costingMethod === 'marginal' ? 'Marg.' : 'Abs.'})</p>
                                    <p className={`text-sm font-bold ${creatorActiveMargin < marginThreshold ? 'text-destructive' : 'text-success'}`}>
                                      {creatorActiveMargin}% {creatorActiveMargin < marginThreshold ? 'âš ' : 'âœ“'}
                                    </p>
                                    <p className="text-[10px] text-muted-foreground">AI: {activeMargin}%</p>
                                  </div>
                                </div>
                              );
                            })()}
                          </div>
                        )}
                        {!Number(form.clientBudget) && (
                          <div className="border-t px-4 py-2 text-xs text-muted-foreground text-center">
                            Enter a value in <strong>Client Budget</strong> above to see how your price compares to the AI estimate.
                          </div>
                        )}
                      </div>
                    )}
                    {/* Final Summary */}
                    {hasHours && (
                      <div className="space-y-3 pt-2 border-t">
                        <p className="text-xs font-medium">Project Cost Summary</p>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                          <div className="p-3 rounded-lg bg-muted/50 text-center">
                            <p className="text-xs text-muted-foreground">Resource Revenue</p>
                            <p className="text-sm font-bold font-heading">{fmt(resourceRevenue)}{inrBadge(resourceRevenue)}</p>
                          </div>
                          <div className="p-3 rounded-lg bg-muted/50 text-center">
                            <p className="text-xs text-muted-foreground">Total incl. Costs</p>
                            <p className="text-sm font-bold font-heading">{fmt(totalRevenue)}{inrBadge(totalRevenue)}</p>
                          </div>
                          <div className="p-3 rounded-lg bg-info/5 border border-info/20 text-center">
                            <p className="text-xs text-muted-foreground">Marginal Margin</p>
                            <p className={`text-sm font-bold ${blendedMarginal < 30 ? 'text-destructive' : 'text-success'}`}>{blendedMarginal}%</p>
                            <p className="text-xs text-muted-foreground">Variable cost</p>
                          </div>
                          <div className="p-3 rounded-lg bg-warning/5 border border-warning/20 text-center">
                            <p className="text-xs text-muted-foreground">Absorption Margin</p>
                            <p className={`text-sm font-bold ${blendedAbsorption < 20 ? 'text-destructive' : 'text-success'}`}>{blendedAbsorption}%</p>
                            <p className="text-xs text-muted-foreground">Loaded cost</p>
                          </div>
                        </div>

                        {/* Recommended quote box */}
                        <div className="p-4 rounded-lg border-2 border-primary/20 bg-primary/5">
                          <div className="flex items-center justify-between flex-wrap gap-3">
                            <div>
                              <p className="text-xs text-muted-foreground">Recommended Quote</p>
                              <p className="text-2xl font-bold font-heading text-primary">{fmt(discountedRevenue)}{inrBadge(discountedRevenue)}</p>
                              {discount > 0 && <p className="text-xs text-muted-foreground">After {discount}% discount (list: {fmt(totalRevenue)})</p>}
                            </div>
                            <div className="text-right">
                              <p className="text-xs text-muted-foreground">Active method: <strong>{costingMethod === 'marginal' ? 'Marginal' : 'Absorption'}</strong></p>
                              <p className={`text-lg font-bold ${activeMargin < marginThreshold ? 'text-destructive' : 'text-success'}`}>
                                {activeMargin}% margin {activeMargin < marginThreshold ? 'âš ' : 'âœ“'}
                              </p>
                            </div>
                          </div>
                          <div className="mt-3">
                            <Button
                              type="button" size="sm" variant="outline" className="text-xs"
                              onClick={() => updateField('clientBudget', String(Math.round(discountedRevenue)))}
                            >
                              <DollarSign className="h-3 w-3 mr-1" /> Use {fmt(discountedRevenue)} as Client Budget
                            </Button>
                          </div>
                        </div>

                        {activeMargin < marginThreshold && (
                          <div className="p-3 rounded-lg bg-destructive/5 border border-destructive/20 text-sm">
                            <span className="font-medium text-destructive">âš  Below threshold:</span> {costingMethod === 'marginal' ? 'Marginal' : 'Absorption'} margin of {activeMargin}% is below the {marginThreshold}% minimum. Finance approval will be required.
                          </div>
                        )}
                      </div>
                    )}

                    {/* â”€â”€ Pricing Strategy Recommendations â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
                    {hasHours && (
                      <div className="space-y-4 pt-2 border-t">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Pricing Strategy Recommendations</p>

                        {/* Cost-Plus */}
                        <div className="space-y-2">
                          <p className="text-xs font-medium flex items-center gap-1.5">
                            <TrendingUp className="h-3.5 w-3.5 text-primary" /> Cost-Plus Pricing
                            <span className="text-muted-foreground font-normal">â€” Total Cost Ã· (1 âˆ’ Target Margin%)</span>
                          </p>
                          <div className="grid grid-cols-2 gap-2">
                            {(['marginal','absorption'] as const).map(method => {
                              const cost = method === 'marginal' ? totalMarginalCost : totalAbsorptionCost;
                              const recommended = getCostPlusPrice(cost, form.dealType || 'Fixed Price', method);
                              const target = costPlusTargets.find(t => t.dealType === (form.dealType || 'Fixed Price')) ?? costPlusTargets[0];
                              const margin = method === 'marginal' ? target?.targetMarginMarginal : target?.targetMarginAbsorption;
                              return (
                                <div key={method} className={`p-3 rounded-lg border text-center ${method === 'marginal' ? 'bg-info/5 border-info/20' : 'bg-warning/5 border-warning/20'}`}>
                                  <p className="text-xs text-muted-foreground capitalize">{method} Â· {margin}% target</p>
                                  <p className="text-base font-bold font-heading">{fmt(recommended)}</p>
                                  <Button type="button" size="sm" variant="ghost" className="text-xs h-6 mt-1 px-2" onClick={() => updateField('clientBudget', String(recommended))}>Use this price</Button>
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        {/* Market Position */}
                        {rows.some(r => r.hrs > 0) && (
                          <div className="space-y-2">
                            <p className="text-xs font-medium flex items-center gap-1.5">
                              <BarChart3 className="h-3.5 w-3.5 text-primary" /> Market Position
                            </p>
                            <div className="space-y-2">
                              {rows.filter(r => r.hrs > 0).slice(0, 4).map(r => {
                                const pos = getMarketPosition(r.skill, form.geography, r.billingRate);
                                if (!pos) return null;
                                const posColor = pos.label === 'Competitive' ? 'text-success' : pos.label === 'Market Rate' ? 'text-info' : pos.label === 'Above Market' ? 'text-warning' : 'text-destructive';
                                return (
                                  <div key={r.id} className="flex items-center gap-3 text-xs">
                                    <span className="w-36 shrink-0 truncate text-muted-foreground">{r.skill}</span>
                                    <div className="flex-1 relative h-3 rounded-full bg-muted overflow-hidden">
                                      <div className="absolute inset-0 rounded-full" style={{ background: 'linear-gradient(to right, #22c55e22, #3b82f622, #8b5cf622)' }} />
                                      <div className="absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-primary border border-white" style={{ left: `calc(${pos.pct}% - 4px)` }} />
                                    </div>
                                    <span className={`shrink-0 font-medium ${posColor}`}>{pos.label}</span>
                                    <span className="text-muted-foreground shrink-0">${r.billingRate}/hr</span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* Tiered Pricing */}
                        <div className="space-y-2">
                          <p className="text-xs font-medium flex items-center gap-1.5">
                            <Layers className="h-3.5 w-3.5 text-primary" /> Tiered Options to Present to Client
                          </p>
                          <div className="grid grid-cols-3 gap-2">
                            {tiers.map(tier => {
                              const baseCost = costingMethod === 'marginal' ? totalMarginalCost : totalAbsorptionCost;
                              const baseQuote = getCostPlusPrice(baseCost, form.dealType || 'Fixed Price', costingMethod === 'absorption' ? 'absorption' : 'marginal');
                              const tierPrice = Math.round(baseQuote * tier.multiplier);
                              return (
                                <div key={tier.name} className="p-3 rounded-lg border text-center space-y-1" style={{ borderTop: `2px solid ${tier.color}` }}>
                                  <p className="text-xs font-mono font-medium" style={{ color: tier.color }}>{tier.name}</p>
                                  <p className="text-xs text-muted-foreground">{tier.label}</p>
                                  <p className="text-sm font-bold font-heading">{fmt(tierPrice)}</p>
                                  <p className="text-[10px] text-muted-foreground">{tier.supportSLA}</p>
                                  <Button type="button" size="sm" variant="ghost" className="text-xs h-6 w-full px-1" onClick={() => updateField('clientBudget', String(tierPrice))}>Use price</Button>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}

              {Number(form.discountRequested) > 5 && (
                <div className="p-3 rounded-lg bg-warning/5 border border-warning/20 text-sm">
                  <span className="font-medium text-warning">âš  Discount Alert:</span> Discount of {form.discountRequested}% exceeds the 5% threshold. This will trigger Finance approval.
                </div>
              )}
            </div>
            );
          })()}
          {step === 7 && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2"><Label>Timeline Pressure</Label><Input value={form.timelinePressure} onChange={e => updateField('timelinePressure', e.target.value)} placeholder="e.g. Aggressive, Normal" /></div>
                <div className="space-y-2"><Label>Client Contract Format Required</Label><Input value={form.clientContractFormat} onChange={e => updateField('clientContractFormat', e.target.value)} /></div>
                <div className="space-y-2"><Label>Security / Compliance Expectations</Label><Input value={form.securityCompliance} onChange={e => updateField('securityCompliance', e.target.value)} /></div>
                <div className="space-y-2"><Label>Special Resource Requirements</Label><Input value={form.specialResources} onChange={e => updateField('specialResources', e.target.value)} /></div>
              </div>
              <div className="space-y-2"><Label>Mandatory Legal Clauses</Label><Textarea value={form.mandatoryLegalClauses} onChange={e => updateField('mandatoryLegalClauses', e.target.value)} /></div>
              <div className="space-y-2"><Label>Dependency Risks</Label><Textarea value={form.dependencyRisks} onChange={e => updateField('dependencyRisks', e.target.value)} /></div>
              <div className="space-y-2"><Label>Delivery Assumptions</Label><Textarea value={form.deliveryAssumptions} onChange={e => updateField('deliveryAssumptions', e.target.value)} /></div>
              <div className="space-y-2"><Label>Known Exclusions</Label><Textarea value={form.exclusions} onChange={e => updateField('exclusions', e.target.value)} /></div>
            </div>
          )}
          {step === 8 && (
            <div className="space-y-4">
              <div className="space-y-2"><Label>Sales Notes</Label><Textarea value={form.salesNotes} onChange={e => updateField('salesNotes', e.target.value)} /></div>
              <div className="space-y-2"><Label>Pre-Sales Notes</Label><Textarea value={form.presalesNotes} onChange={e => updateField('presalesNotes', e.target.value)} /></div>
              <div className="space-y-2"><Label>Competitor Context</Label><Textarea value={form.competitorContext} onChange={e => updateField('competitorContext', e.target.value)} /></div>
              <div className="space-y-2"><Label>Win Strategy</Label><Textarea value={form.winStrategy} onChange={e => updateField('winStrategy', e.target.value)} /></div>
              <div className="space-y-2"><Label>Client Relationship Notes</Label><Textarea value={form.clientRelationship} onChange={e => updateField('clientRelationship', e.target.value)} /></div>
            </div>
          )}
          {step === 9 && (
            <div className="space-y-4">
              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <h3 className="font-heading font-semibold">Summary Review</h3>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div><span className="text-muted-foreground">Proposal ID:</span> {nextId}</div>
                  <div><span className="text-muted-foreground">Proposal Type:</span> {form.proposalType || 'â€”'}</div>
                  <div><span className="text-muted-foreground">Client:</span> {form.clientName || 'â€”'}</div>
                  <div><span className="text-muted-foreground">Client Group:</span> {form.clientGroup || 'â€”'}</div>
                  <div><span className="text-muted-foreground">Opportunity:</span> {form.opportunityName || 'â€”'}</div>
                  <div><span className="text-muted-foreground">Industry:</span> {form.industry || 'â€”'}</div>
                  <div><span className="text-muted-foreground">Opportunity Type:</span> {form.opportunityType || 'â€”'}</div>
                  <div><span className="text-muted-foreground">Geography:</span> {form.geography}</div>
                  <div><span className="text-muted-foreground">Deal Type:</span> {form.dealType || 'â€”'}</div>
                  <div><span className="text-muted-foreground">Currency:</span> {form.currency}</div>
                  <div><span className="text-muted-foreground">Priority:</span> {form.priority}</div>
                  <div><span className="text-muted-foreground">Submission Date:</span> {form.submissionDate || 'â€”'}</div>
                  <div><span className="text-muted-foreground">Modules:</span> {form.modules.join(', ') || 'â€”'}</div>
                  <div><span className="text-muted-foreground">Duration:</span> {form.expectedDuration || 'â€”'}</div>
                  <div><span className="text-muted-foreground">Deal Owner:</span> {form.dealOwner || 'â€”'}</div>
                  <div><span className="text-muted-foreground">Costing Mode:</span> {costingMode === 'ai' ? 'AI Auto-Calculate' : costingMode === 'manual' ? 'Manual' : 'â€”'}</div>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                <Button onClick={handleSubmit} variant="outline" size="lg" className="w-full">
                  Create Workspace (Draft)
                </Button>
                <Button
                  onClick={() => {
                    handleSubmit();
                    // Submit for review after a short delay to allow addProposal to complete
                    setTimeout(() => submitForReview(nextId), 300);
                  }}
                  size="lg"
                  className="w-full"
                >
                  Create & Submit for Review
                </Button>
              </div>
              <p className="text-xs text-muted-foreground text-center">
                <strong>Draft</strong> â€” opens workspace, stays in Draft status. &nbsp;|&nbsp;
                <strong>Submit for Review</strong> â€” creates and immediately enters the approval workflow.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-between items-center">
        <Button variant="outline" onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0}>
          <ChevronLeft className="h-4 w-4 mr-1" /> Previous
        </Button>
        <Button variant="outline" onClick={handleSaveDraft} disabled={savingDraft} className="gap-1.5">
          {savingDraft ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {savingDraft ? 'Savingâ€¦' : 'ðŸ’¾ Save Draft'}
        </Button>
        {step < steps.length - 1 && (
          <Button
            onClick={() => setStep(step + 1)}
            disabled={(step === 1 && !costingMode) || (step === 2 && (presalesBriefing?.qa ?? []).filter(q => q.required && String(q.answer ?? '').trim()).length < Math.min(3, (presalesBriefing?.qa ?? []).filter(q => q.required).length))}
            title={
              step === 1 && !costingMode ? 'Choose AI Auto-Calculate or Manual Calculation above first' :
              step === 2 ? 'Answer at least 3 required questions in the Pre-Sales Briefing before proceeding' : undefined
            }
          >
            Next <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        )}
      </div>
    </div>
  );
}
