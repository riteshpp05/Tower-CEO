/**
 * generateProposalContent.ts
 * ─────────────────────────────────────────────────────────────────
 * Generates AI proposal section content using APNJ-LLM-Studio.
 * Supports 4 proposal types, each with their own section list and
 * type-specific prompts. Falls back to tunnel via llmClient.
 * ─────────────────────────────────────────────────────────────────
 */

import { callLLM, callRAG, type LLMEndpoint, type RAGCollection } from '@/lib/llmClient';
import { buildVerifiedContext } from '@/lib/generateQuestionnaire';

// ── RAG Config ────────────────────────────────────────────────────────────────

export interface RAGConfig {
  sources: RAGCollection[];
  disabled: boolean;
}

export const DEFAULT_RAG_CONFIG: RAGConfig = {
  sources: ['unified'],
  disabled: false,
};

async function buildRAGContext(question: string, config: RAGConfig): Promise<string> {
  if (config.disabled || config.sources.length === 0) return '';
  try {
    const results = await Promise.allSettled(
      config.sources.map(src => callRAG(question, src as any))
    );
    const chunks: string[] = [];
    results.forEach((r, i) => {
      if (r.status === 'fulfilled' && r.value.hasContext && r.value.answer) {
        chunks.push(`[Source: ${config.sources[i]}]\n${r.value.answer.trim()}`);
      }
    });
    if (chunks.length === 0) return '';
    return '\n\n=== GROUNDING CONTEXT FROM KNOWLEDGE BASE ===\n'
      + 'Use the following retrieved content as factual grounding:\n\n'
      + chunks.join('\n\n---\n\n')
      + '\n=== END GROUNDING CONTEXT ===\n';
  } catch {
    return '';
  }
}

function buildRFPContext(rfpRawText?: string): string {
  if (!rfpRawText?.trim()) return '';
  // Qwen2.5 has a 32K-token context shared across the whole prompt (system
  // prefix, base context, type-specific section prompt, verified pre-sales
  // context, RAG context, this RFP context, AND the output tokens). The
  // previous 6,000-char limit (~1,700 tokens) was far too conservative —
  // it only ever saw the first 2-3 pages of a real RFP.
  //
  // This function is intentionally NOT chunked/multi-pass like the
  // extraction pipelines (Tender Engine, compliance checklist, field
  // auto-fill, questionnaire) — by the time proposal content is generated,
  // the Pre-Sales Briefing has already run and verifiedContext carries the
  // human-confirmed, whole-document facts. Chunking a GENERATION call would
  // mean producing multiple drafts of the same section and somehow merging
  // them, a much harder problem than merging extracted facts. Instead, this
  // raises the budget generously so the writer sees as much of the source
  // document as reasonably fits, as supplementary grounding/flavor — not
  // the primary source of truth, which verifiedContext already is.
  //
  // ~40,000 chars (~11,500 tokens) leaves comfortable headroom for the rest
  // of the prompt plus a 6,000-token output, the largest output budget used
  // by callers of this function.
  const RFP_CONTEXT_CHAR_LIMIT = 40000;
  const rfpTruncated = rfpRawText.slice(0, RFP_CONTEXT_CHAR_LIMIT);
  const rfpNote = rfpRawText.length > RFP_CONTEXT_CHAR_LIMIT ? '\n[... document truncated for length ...]' : '';
  const SEP = '='.repeat(60);
  return [
    '',
    SEP,
    'RFP / CLIENT REQUIREMENT DOCUMENT — PRIMARY SOURCE',
    'You MUST base all proposal sections on the specific requirements found here.',
    'Reference client-specific details, not generic consulting filler.',
    '',
    rfpTruncated + rfpNote,
    SEP,
    '',
  ].join('\n');
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ProposalInputs {
  id:                     string;
  title:                  string;
  clientName:             string;
  clientGroup?:           string;
  industry?:              string;
  geography?:             string;
  lob:                    string;
  opportunityType?:       string;
  dealType:               string;
  modules:                string[];
  expectedDuration?:      string;
  expectedRevenue?:       number;
  currency?:              string;
  grossMargin?:           number;
  discount?:              number;
  // Scope
  clientPainPoints?:      string;
  integrationReqs?:       string;
  customDevScope?:        string;
  mandatoryDeliverables?: string;
  slaReqs?:               string;
  supportWindow?:         string;
  projectType?:           string;
  implementationModel?:   string;
  // Risk & Legal
  timelinePressure?:      string;
  mandatoryLegalClauses?: string;
  securityCompliance?:    string;
  dependencyRisks?:       string;
  deliveryAssumptions?:   string;
  exclusions?:            string;
  // Commercial
  billingModel?:          string;
  paymentMilestone?:      string;
  clientBudget?:          string;
  discountRequested?:     string;
  commercialNotes?:       string;
  // Internal
  winStrategy?:           string;
  competitorContext?:     string;
  clientRelationship?:    string;
  salesNotes?:            string;
  presalesNotes?:         string;
  // Pricing
  pricingRationale?:      string;
  costBasis?:             string;
  selectedResources?:     string;
  // Resource profiles (for Resource Augmentation CV generation)
  resourceProfiles?:      ResourceProfile[];
  // Commercial
  validityDays?:          number;
  paymentSchedule?:       string;
  performanceGuarantee?:  boolean;
  // RFP source document
  rfpRawText?:            string;
  // Pre-Sales Briefing — verified context to eliminate hallucination
  presalesBriefing?:      import('@/lib/generateQuestionnaire').PresalesBriefing | null;
}

export interface ResourceProfile {
  name:            string;
  designation:     string;
  yearsExperience: number;
  skills:          string[];
  sapModules:      string[];
  certifications:  string[];
  availability:    string;
  billingRate:     number;
  currency:        string;
  geography:       string;
  bio?:            string;
  profileSummary?: string;
  keyProjects?:    string;
}

export interface GeneratedSection {
  name:    string;
  content: string;
  status:  'AI-generated';
}

export interface FullDraftResult {
  sections:     GeneratedSection[];
  legalClauses: string[];
  endpoint:     LLMEndpoint;
}

// ── Proposal type detection ───────────────────────────────────────────────────

type ProposalType = 'implementation' | 'ams' | 'resource_augmentation' | 'solution';

function detectProposalType(inputs: ProposalInputs): ProposalType {
  const lob = (inputs.lob || inputs.opportunityType || '').toLowerCase();
  if (lob.includes('ams') || lob.includes('application management')) return 'ams';
  if (lob.includes('resource aug') || lob.includes('augmentation')) return 'resource_augmentation';
  if (lob.includes('btp') || lob.includes('integration') || lob.includes('upgrade') || lob.includes('migration') || lob.includes('fiori')) return 'solution';
  return 'implementation';
}

// ── Section lists per proposal type ──────────────────────────────────────────
// These MUST match the section names used in the proposal template

export function getSectionListForType(type: ProposalType): string[] {
  switch (type) {
    case 'ams':
      return [
        'Executive Summary',
        'Company Background',
        'Company Qualifications & Team Profiles',
        'Client References',
        'Scope of Support',
        'Service Delivery Model',
        'SLA Framework',
        'Transition Plan',
        'Governance & Reporting',
        'Pricing Schedule',
        'Maintenance Agreements',
        'Assumptions & Exclusions',
      ];
    case 'resource_augmentation':
      return [
        'Executive Summary',
        'Resource Profiles',
        'Engagement Model',
        'Commercial Summary',
        'Assumptions & Exclusions',
      ];
    case 'solution':
      return [
        'Executive Summary',
        'Solution Overview',
        'Technical Scope & Architecture',
        'Implementation Approach',
        'Acceptance Criteria',
        'Commercial Summary',
        'Assumptions & Exclusions',
      ];
    case 'implementation':
    default:
      return [
        'Executive Summary',
        'Company Background',
        'Client Context & Challenges',
        'Scope of Work',
        'Solution Approach',
        'Implementation Methodology',
        'Project Plan & Timeline',
        'Team Structure',
        'Client References',
        'Commercial Summary',
        'Risk & Mitigation',
        'Assumptions & Exclusions',
      ];
  }
}

// ── Context builder (shared across types) ────────────────────────────────────

function buildBaseContext(inputs: ProposalInputs): string {
  const curr = inputs.currency ?? 'INR';
  const rev  = inputs.expectedRevenue
    ? curr === 'INR'
      ? `₹${inputs.expectedRevenue.toLocaleString('en-IN')}`
      : `${curr} ${inputs.expectedRevenue.toLocaleString()}`
    : 'TBD';

  // Use confirmed modules from briefing Q&A if available
  const confirmedModulesNote = inputs.presalesBriefing?.qa.find(
    q => q.answer && q.question.toLowerCase().includes('module')
  )?.answer;

  return `
CLIENT: ${inputs.clientName}${inputs.clientGroup ? ` (${inputs.clientGroup})` : ''}
INDUSTRY: ${inputs.industry ?? 'Not specified'}
GEOGRAPHY: ${inputs.geography ?? 'India'}
LINE OF BUSINESS: ${inputs.lob}
DEAL TYPE: ${inputs.dealType}
SAP MODULES IN SCOPE: ${inputs.modules.join(', ') || 'To be confirmed'}
ENGAGEMENT DURATION: ${inputs.expectedDuration ?? 'TBD'}
CURRENCY: ${curr}
ENGAGEMENT VALUE: ${rev}
GROSS MARGIN TARGET: ${inputs.grossMargin ?? 'TBD'}%

SCOPE DETAILS:
- Confirmed modules (from briefing): ${confirmedModulesNote ?? (inputs.modules.join(', ') || 'To be confirmed')}
- Client pain points: ${inputs.clientPainPoints ?? 'Not provided'}
- Integration requirements: ${inputs.integrationReqs ?? 'None specified'}
- Custom development: ${inputs.customDevScope ?? 'None'}
- Mandatory deliverables: ${inputs.mandatoryDeliverables ?? 'Standard deliverables'}
- SLA requirements: ${inputs.slaReqs ?? 'Standard'}
- Support window: ${inputs.supportWindow ?? 'Business hours'}

COMMERCIAL:
- Billing model: ${inputs.billingModel ?? inputs.dealType}
- Payment terms: ${inputs.paymentMilestone ?? 'Monthly'}
- Discount: ${inputs.discount ?? 0}%
- Pricing notes: ${inputs.commercialNotes ?? 'None'}

RISK & CONSTRAINTS:
- Timeline pressure: ${inputs.timelinePressure ?? 'Normal'}
- Dependency risks: ${inputs.dependencyRisks ?? 'None identified'}
- Delivery assumptions: ${inputs.deliveryAssumptions ?? 'Standard'}
- Security/Compliance: ${inputs.securityCompliance ?? 'Standard'}
- Exclusions: ${inputs.exclusions ?? 'As per Out of Scope section'}
`.trim();
}

// ── Type-specific prompt builders ─────────────────────────────────────────────

function buildImplementationPrompt(inputs: ProposalInputs, context: string): string {
  return `You are a senior SAP consulting proposal writer at Tower-CEO Technologies (Tower-CEO), an ISO 9001:2015 and ISO/IEC 27001:2022 certified SAP consulting firm based in India.

Write a professional, client-facing SAP Implementation proposal for the engagement below.
Use formal business language. Be SPECIFIC — reference the client's actual pain points and requirements.
Do NOT use generic filler like "our team of experts" or "world-class solutions".
Do NOT include internal notes, win strategy, or competitor information.
Do NOT include Terms & Conditions — added separately.
Write in plain professional prose. Do NOT use Markdown formatting — no ###, no **, no __, no - bullet syntax, no numbered lists with dots. Use plain text only.

${context}

Write EXACTLY these sections. Each section heading must appear exactly as shown, followed by a colon on its own line:

EXECUTIVE SUMMARY:
3 paragraphs: (1) Client business context and specific challenges, (2) AIS's proposed SAP S/4HANA solution and approach, (3) Key value proposition and expected outcomes. Reference the client by name throughout.

CLIENT CONTEXT & CHALLENGES:
Detailed analysis of the client's current state, specific pain points, business drivers for this SAP implementation, and what success looks like for them. Be specific to this client and industry.

SCOPE OF WORK:
Comprehensive scope covering: SAP modules being implemented with specific functional coverage per module, implementation phases and activities, key deliverables per phase, what is in scope vs out of scope. Use sub-headings per module.

SOLUTION APPROACH:
AIS's specific approach to this engagement: project type (Greenfield/Brownfield), implementation methodology (SAP Activate phases: Discover, Prepare, Explore, Realize, Deploy, Run), fit-to-standard approach, configuration vs customisation strategy, data migration approach, testing strategy.

IMPLEMENTATION METHODOLOGY:
Detailed SAP Activate methodology breakdown: phase-by-phase activities, key workshops and accelerators, quality gates, go-live criteria, hypercare plan post go-live.

PROJECT PLAN & TIMELINE:
Phase-wise timeline for the ${inputs.expectedDuration ?? 'project duration'}: start date assumptions, phase durations, key milestones, go-live date, hypercare period. Present as a structured timeline.

TEAM STRUCTURE:
Proposed team composition: roles, seniority levels, onsite vs offshore allocation, responsibilities. Include Project Manager, Solution Architect, module leads, and support roles.

COMMERCIAL SUMMARY:
Engagement commercial terms: deal type (${inputs.dealType}), currency (${inputs.currency ?? 'INR'}), billing model, payment milestones, validity period (${inputs.validityDays ?? 90} days from proposal date), governing law (${(() => { const g = String(inputs.geography ?? '').toLowerCase(); return g.includes('middle east') || g.includes('kuwait') || g.includes('uae') ? 'State of Kuwait' : g.includes('us') || g.includes('usa') ? 'State of New York, USA' : g.includes('europe') ? 'England and Wales' : 'India (Courts of Pune, Maharashtra)'; })()} ), any commercial assumptions.

RISK & MITIGATION:
At least 5 specific risks for this engagement with likelihood, impact, and concrete mitigation strategy for each. Include client-side risks (data readiness, resource availability, decision-making) and AIS-side risks.

ASSUMPTIONS & EXCLUSIONS:
Numbered list of delivery assumptions (minimum 5) and a separate numbered list of explicit exclusions (minimum 5) specific to this engagement.`;
}

function buildAMSPrompt(inputs: ProposalInputs, context: string): string {
  // Geography-aware defaults
  const geo = String(inputs.geography ?? '').toLowerCase();
  const isMiddleEast = geo.includes('middle east') || geo.includes('kuwait') || geo.includes('uae') || geo.includes('saudi');
  const supportWindow = inputs.supportWindow || (isMiddleEast ? 'Sunday–Thursday, 9:00 AM – 5:00 PM AST (Kuwait)' : '9:00 AM – 6:00 PM IST, Monday–Friday');
  const govLaw = isMiddleEast ? 'State of Kuwait' : 'India (Courts of Pune, Maharashtra)';
  const perfGuaranteeBank = isMiddleEast ? 'a prime bank in Kuwait' : 'a reputable bank in India';
  const hasKBDocs = (inputs.presalesBriefing?.kbDocIds?.length ?? 0) > 0;
  const credGuard = hasKBDocs
    ? 'For Company Background and Qualifications: use ONLY content from the Knowledge Base documents retrieved above. Do not invent statistics.'
    : 'For Company Background: state AIS legal entity (Tower-CEO Technologies Pvt. Ltd.), offices (Pune HQ, Dubai, Singapore), SAP Gold Partner, ISO 9001:2015 and ISO/IEC 27001:2022 certified. Do NOT invent years of experience, client counts, or revenue figures. For Client References: write "Five client references including three from the last three years are submitted as a separate confidential attachment."';

  return `You are a senior SAP consulting proposal writer at Tower-CEO Technologies (Tower-CEO), SAP Gold Partner, ISO 9001:2015 and ISO/IEC 27001:2022 certified.

Write a professional, client-facing SAP AMS proposal for ${inputs.clientName}.
Be SPECIFIC. Use formal business language. Plain prose — no Markdown, no ###, no **, no bullets.

ANTI-HALLUCINATION RULES (MANDATORY):
1. Never invent company statistics, years, or client counts.
2. SLA times — use exactly: Sev1: 1hr response / 2-3hr resolution. Sev2: 2hr / 4hr. Sev3: 1 business day / 3 business days. Sev4: 1 business day / 3 business days.
3. Sev1 and Sev2 are covered 24/7/365 including weekends and public holidays.
4. Business hours support window: ${supportWindow}.
5. Change request estimates: within 3 working days of submission.
6. Governing law: ${govLaw}.
7. ${credGuard}

${context}

Write EXACTLY these sections, heading on its own line followed by a colon:

EXECUTIVE SUMMARY:
3 paragraphs: (1) Client SAP landscape and support challenges from verified context, (2) AIS proposed AMS model — team, coverage, delivery model, (3) Value proposition: continuity, SLA commitment, cost efficiency, transformation readiness.

COMPANY BACKGROUND:
AIS legal entity (Tower-CEO Technologies Pvt. Ltd.), headquarters Pune India with offices in Dubai and Singapore. SAP Gold Partner. ISO 9001:2015 and ISO/IEC 27001:2022 certifications. Financial stability and debt-free operations. No parent or subsidiary companies.

COMPANY QUALIFICATIONS & TEAM PROFILES:
AIS qualifications for this engagement: relevant SAP expertise in modules (${inputs.modules.join(', ')}), financial and government sector experience. Proposed team with roles, FTE allocation, module coverage, and seniority level for each role. State that detailed CVs with certification IDs and project history are provided as a separate attachment per RFP requirements.

CLIENT REFERENCES:
Five client references demonstrating relevant SAP AMS experience, at least three from the last three years. For each reference: organisation name, industry, SAP modules supported, organisation size, go-live date, engagement duration, and contact name. If KB references are available use them. Otherwise write: "Five client references including three implemented in the last three years are submitted as a separate confidential attachment per the RFP submission requirements."

SCOPE OF SUPPORT:
Detailed AMS scope for ${inputs.clientName}: modules in scope (${inputs.modules.join(', ')}), L1/L2/L3 support boundaries (client IT team handles L1; AIS provides L2 and coordinates L3 with SAP), ticket types handled (incidents, service requests, change requests, enhancements, advisory), what is explicitly excluded. Annual commitment based on verified context.

SERVICE DELIVERY MODEL:
Delivery approach: offshore/onsite model, named resource allocation, AIS ITSM ticketing platform for incident logging and SLA tracking (client can integrate their tool if mandated), escalation path (Consultant to Service Manager to Engagement Lead to CEO), knowledge transfer plan, monthly reporting. Patch management: critical security patches applied immediately upon release, medium-severity within 1 week, general updates on quarterly cycle coordinated with client. Change request estimates within 3 working days per contract terms.

SLA FRAMEWORK:
P1 Critical: System down or data loss. Response: 1 hour. Resolution: 2-3 hours. Coverage: 24 hours 7 days 365 days. Escalation: Engagement Manager within 2 hours.
P2 High: Major function impaired. Response: 2 hours. Resolution: 4 hours. Coverage: 24 hours 7 days 365 days. Escalation: Service Manager.
P3 Medium: Partial function impaired. Response: 1 business day. Resolution: 3 business days. Coverage: Business hours.
P4 Low: Minor or cosmetic issue. Response: 1 business day. Resolution: 3 business days. Coverage: Business hours.
Business hours: ${supportWindow}. SLA breach penalty: 5 percent of monthly invoice per sustained P1/P2 breach, capped at 15 percent of quarterly payment. Quarterly service review to assess SLA compliance.

TRANSITION PLAN:
Phase 1 Knowledge Acquisition (Weeks 1-2): incumbent vendor handover, comprehensive landscape assessment, knowledge base creation, documentation update. Phase 2 Shadow Support (Weeks 3-4): AIS shadows current support processes, builds KEDB, establishes tooling. Phase 3 Parallel Run (Weeks 5-6): AIS operates alongside existing support, validates coverage. Phase 4 Full Handover (Week 7): AIS assumes full responsibility. Arabic language documentation for business users where required.

GOVERNANCE & REPORTING:
Governance: weekly status call (ticket review, SLA performance), monthly service review (trend analysis, improvement actions), quarterly business review (strategic alignment, roadmap). Reports: monthly SLA dashboard, ticket aging, CR pipeline, trend analysis. Escalation matrix from consultant to CEO level. All change requests scoped and priced within 3 working days.

PRICING SCHEDULE:
Per-item pricing for all modules in scope is provided in the separate Financial Proposal / Annexure as required by the RFP. Rates are fixed for the full contract term. Change request rates: per man-day and per hour as agreed, fixed for contract duration. Payment: quarterly in advance.

MAINTENANCE AGREEMENTS:
Contract term: 1 year from execution date, with renewal option. Quarterly payment schedule. Performance guarantee: 10 percent of contract price, irrevocable and unconditional, issued by ${perfGuaranteeBank}, furnished within 10 days of contract signing. Proposal validity: ${inputs.validityDays ?? 90} days from submission. Governing law: ${govLaw}. SLA service credits apply as defined above.

ASSUMPTIONS & EXCLUSIONS:
Numbered assumptions (minimum 8): client provides system access and VPN credentials; client IT team handles L1 end-user support; client provides named SPOC; existing documentation made available at transition start; critical business periods communicated 2 weeks in advance; client approves all change requests in writing before execution; client provides test environment access; client infrastructure maintained by client or SAP RISE team. Explicit exclusions (minimum 6): new SAP module implementations or system conversions; SAP license procurement; infrastructure upgrades; custom development beyond agreed CR budget; end-user training beyond agreed sessions; data migration or master data cleansing.`;
}

function buildResourceAugmentationPrompt(inputs: ProposalInputs, context: string): string {
  const profiles = inputs.resourceProfiles ?? [];
  const profileSummary = profiles.length > 0
    ? profiles.map(p =>
        `- ${p.name} | ${p.designation} | ${p.yearsExperience} yrs | ${p.sapModules.join(', ')} | ${p.availability} | ${p.currency} ${p.billingRate}/hr`
      ).join('\n')
    : 'Resource profiles to be confirmed';

  return `You are a senior SAP consulting proposal writer at Tower-CEO Technologies (Tower-CEO).

Write a professional resource augmentation proposal for the client below.
The centrepiece of this proposal is the individual resource profiles — write them in detail.
Be SPECIFIC. Each profile should read like a professional CV summary, not a generic description.
Do NOT use generic filler. Do NOT include internal notes or Terms & Conditions.
Write in plain professional prose. Do NOT use Markdown formatting — no ###, no **, no __, no - bullet syntax, no numbered lists with dots. Use plain text only.

${context}

RESOURCES BEING PROPOSED:
${profileSummary}

Write EXACTLY these sections, each heading on its own line followed by a colon:

EXECUTIVE SUMMARY:
2 paragraphs: (1) Client's requirement for SAP expertise and the engagement context, (2) AIS's approach to resource augmentation — quality of resources, vetting process, flexibility.

RESOURCE PROFILES:
For EACH resource listed above, write a detailed profile with these sub-sections:
  [Full Name] — [Designation]
  Summary: 2-3 sentence professional overview highlighting their SAP expertise and value to this engagement
  SAP Expertise: Specific modules, functional areas, and technical skills
  Key Experience: 3-4 bullet points of specific project experience and achievements
  Certifications: SAP and other relevant certifications
  Availability: Current availability and proposed start date
  Engagement Rate: ${inputs.currency ?? 'INR'} [rate]/hr (Time & Material)

ENGAGEMENT MODEL:
How the resource augmentation works: client oversight, AIS HR management, reporting structure, timesheet and invoicing process, performance review process, replacement guarantee terms, ramp-up period.

COMMERCIAL SUMMARY:
Rate card per resource, billing model (Time & Material), invoicing frequency, payment terms, validity period (90 days). Note that rates are exclusive of travel and out-of-pocket expenses unless stated.

ASSUMPTIONS & EXCLUSIONS:
Numbered assumptions (minimum 5: client provides workspace/tools/access, AIS retains employer relationship, etc.) and exclusions (minimum 4: recruitment fees, relocation, etc.).`;
}

function buildSolutionPrompt(inputs: ProposalInputs, context: string): string {
  return `You are a senior SAP consulting proposal writer at Tower-CEO Technologies (Tower-CEO).

Write a professional proposal for a focused SAP solution/integration/BTP engagement.
This is a narrowly scoped engagement — be very precise about what is in and out of scope.
Acceptance criteria are critical — write them clearly and measurably.
Do NOT use generic filler. Do NOT include internal notes or Terms & Conditions.
Write in plain professional prose. Do NOT use Markdown formatting — no ###, no **, no __, no - bullet syntax, no numbered lists with dots. Use plain text only.

${context}

Write EXACTLY these sections, each heading on its own line followed by a colon:

EXECUTIVE SUMMARY:
2 paragraphs: (1) The specific business problem being solved and why it matters to the client, (2) AIS's proposed solution — what it does, how it works, what the outcome is.

SOLUTION OVERVIEW:
What AIS is building/integrating/configuring: the solution name, the business process it enables, the SAP modules/platforms involved (${inputs.modules.join(', ')}), the end-user impact, and how it fits into the client's existing landscape.

TECHNICAL SCOPE & ARCHITECTURE:
Precise technical scope: what is being built, what APIs/interfaces are involved, what SAP standard functionality is used vs extended, data flows, integration points, security model. What is NOT in technical scope.

IMPLEMENTATION APPROACH:
Sprint-based or phased delivery plan for ${inputs.expectedDuration ?? 'the engagement duration'}: sprint breakdown, activities per sprint, deliverables, testing approach (unit, integration, UAT), deployment approach, go-live process.

ACCEPTANCE CRITERIA:
Numbered list of specific, measurable acceptance criteria — minimum 8. Each criterion must be testable: "The system shall...", "Integration shall process... within X seconds", "Report shall display...". No vague criteria.

COMMERCIAL SUMMARY:
Engagement commercial terms: Fixed Price or T&M (${inputs.dealType}), total engagement value, payment milestones tied to deliverables, change request process and day rates, validity period (90 days).

ASSUMPTIONS & EXCLUSIONS:
Numbered assumptions (minimum 5) and explicit technical exclusions (minimum 5) — be precise about what's out of scope technically.`;
}

// ── Legal clause fetch ────────────────────────────────────────────────────────

export async function fetchLegalClauses(inputs: ProposalInputs): Promise<string[]> {
  const question = [
    `Standard legal clauses for SAP consulting proposal.`,
    `LOB: ${inputs.lob}.`,
    `Deal type: ${inputs.dealType}.`,
    `Geography: ${inputs.geography ?? 'India'}.`,
    inputs.mandatoryLegalClauses ? `Mandatory clauses: ${inputs.mandatoryLegalClauses}.` : '',
  ].filter(Boolean).join(' ');

  try {
    const { answer, hasContext } = await callRAG(question, 'unified');
    if (!hasContext || !answer) return [];
    return answer
      .split(/\n(?=\d+\.)|(?:\n\n)/)
      .map(c => c.replace(/^\d+\.\s*/, '').trim())
      .filter(c => c.length > 20);
  } catch {
    return [];
  }
}

// ── Section parser ────────────────────────────────────────────────────────────

function parseSections(content: string, sectionNames: string[]): GeneratedSection[] {
  const sections: GeneratedSection[] = [];

  for (let i = 0; i < sectionNames.length; i++) {
    const name    = sectionNames[i];
    const nameUC  = name.toUpperCase();
    const next    = sectionNames[i + 1];
    const nextUC  = next ? next.toUpperCase() : null;

    // Match the section heading (case-insensitive, with or without colon)
    const pattern = new RegExp(
      `${nameUC.replace(/[&]/g, '\\$&')}:?\\s*\\n([\\s\\S]*?)${nextUC ? `(?=${nextUC.replace(/[&]/g, '\\$&')}:)` : '$'}`,
      'i'
    );
    const match = content.match(pattern);

    sections.push({
      name,
      content: match ? match[1].trim() : `[${name} — not generated. Click Regenerate to generate this section individually.]`,
      status:  'AI-generated',
    });
  }

  return sections;
}

// ── Generate Full Draft ───────────────────────────────────────────────────────

export async function generateFullDraft(
  inputs: ProposalInputs,
  onEndpointResolved?: (ep: LLMEndpoint) => void,
  ragConfig: RAGConfig = DEFAULT_RAG_CONFIG
): Promise<FullDraftResult> {

  const type          = detectProposalType(inputs);
  const sectionNames  = getSectionListForType(type);
  const baseContext   = buildBaseContext(inputs);

  // Build type-specific prompt
  let prompt: string;
  switch (type) {
    case 'ams':                  prompt = buildAMSPrompt(inputs, baseContext);                  break;
    case 'resource_augmentation': prompt = buildResourceAugmentationPrompt(inputs, baseContext); break;
    case 'solution':             prompt = buildSolutionPrompt(inputs, baseContext);              break;
    default:                     prompt = buildImplementationPrompt(inputs, baseContext);        break;
  }

  // RAG grounding
  const ragQuestion = [
    `SAP ${type} proposal ${inputs.modules.join(' ')} ${inputs.clientName}`,
    inputs.industry    ? `for ${inputs.industry}` : '',
    inputs.geography   ? `in ${inputs.geography}` : '',
    inputs.clientPainPoints ? inputs.clientPainPoints.slice(0, 200) : '',
    inputs.rfpRawText  ? inputs.rfpRawText.slice(0, 300) : '',
  ].filter(Boolean).join(' ');

  const [ragContext, legalClauses] = await Promise.all([
    buildRAGContext(ragQuestion, ragConfig),
    fetchLegalClauses(inputs),
  ]);

  const rfpContext    = buildRFPContext(inputs.rfpRawText);
  // Build verified context from pre-sales briefing — eliminates hallucination
  const verifiedContext = buildVerifiedContext(inputs.presalesBriefing ?? null);

  const groundedPrompt = rfpContext
    ? `${rfpContext}${verifiedContext}\n\n${prompt}${ragContext}`
    : `${verifiedContext}${prompt}${ragContext}`;

  const { content, endpoint } = await callLLM(
    [{ role: 'user', content: groundedPrompt }],
    {
      model:       'local-model',
      temperature: 0.65,
      max_tokens:  6000,
      onEndpointResolved,
    }
  );

  const sections = parseSections(content, sectionNames);

  return { sections, legalClauses, endpoint };
}

// ── Single section regeneration ───────────────────────────────────────────────

export async function generateSingleSection(
  sectionName: string,
  inputs: ProposalInputs,
  onEndpointResolved?: (ep: LLMEndpoint) => void,
  ragConfig: RAGConfig = DEFAULT_RAG_CONFIG
): Promise<GeneratedSection> {

  const type        = detectProposalType(inputs);
  const baseContext = buildBaseContext(inputs);

  // Section-specific focused prompts
  const sectionPrompts: Record<string, string> = {
    // ── Implementation ──
    'Executive Summary': `Write a 3-paragraph Executive Summary for a ${inputs.lob} proposal for ${inputs.clientName} (${inputs.industry ?? 'enterprise'}, ${inputs.geography ?? 'India'}). Modules: ${inputs.modules.join(', ')}. Pain points: ${inputs.clientPainPoints ?? 'digital transformation'}. Be specific to this client. No generic filler.`,

    'Client Context & Challenges': `Write a detailed Client Context & Challenges section for ${inputs.clientName}. Industry: ${inputs.industry}. Analyse their current SAP landscape, specific pain points (${inputs.clientPainPoints ?? 'operational challenges'}), business drivers for this implementation, and what success looks like. Be specific — no generic filler.`,

    'Scope of Work': `Write a comprehensive Scope of Work for a ${inputs.lob} engagement for ${inputs.clientName}. Modules: ${inputs.modules.join(', ')}. Integration: ${inputs.integrationReqs ?? 'standard'}. Custom dev: ${inputs.customDevScope ?? 'minimal'}. Deliverables: ${inputs.mandatoryDeliverables ?? 'standard SAP deliverables'}. Use sub-headings per module.`,

    'Solution Approach': `Write a Solution Approach section for ${inputs.clientName}. Project type: ${inputs.projectType ?? 'Greenfield'}. Implementation model: ${inputs.implementationModel ?? 'SAP Activate'}. Cover: fit-to-standard approach, configuration vs customisation, data migration, testing strategy. Be specific.`,

    'Implementation Methodology': `Write a detailed Implementation Methodology section using SAP Activate for ${inputs.clientName}. Duration: ${inputs.expectedDuration ?? 'TBD'}. Cover all 6 phases (Discover, Prepare, Explore, Realize, Deploy, Run) with key activities, workshops, quality gates, and go-live criteria.`,

    'Project Plan & Timeline': `Write a Project Plan & Timeline section for ${inputs.clientName}. Total duration: ${inputs.expectedDuration ?? 'TBD'}. Timeline pressure: ${inputs.timelinePressure ?? 'normal'}. Show phase breakdown with durations, key milestones, go-live date, and hypercare period. Be specific about weeks/months per phase.`,

    'Team Structure': `Write a Team Structure section for the ${inputs.clientName} engagement. Modules: ${inputs.modules.join(', ')}. Geography: ${inputs.geography ?? 'India'}. Resources: ${inputs.selectedResources ?? 'to be confirmed'}. Include Project Manager, Solution Architect, module leads. Specify onsite vs offshore allocation.`,

    // ── AMS ──
    'Scope of Support': `Write a detailed Scope of Support section for AMS services to ${inputs.clientName}. Modules: ${inputs.modules.join(', ')}. Annual hours: ${inputs.slaReqs ?? '200 hours/year'}. Cover incident types, change requests, enhancements, exclusions. Be specific about what is and is not included.`,

    'Service Delivery Model': `Write a Service Delivery Model section for AMS to ${inputs.clientName}. Support window: ${inputs.supportWindow ?? 'Business hours IST'}. Cover: offshore/onsite model, ticketing process, named resources, escalation path, reporting cadence, knowledge management.`,

    'SLA Framework': `Write a complete SLA Framework section for AMS to ${inputs.clientName}. Support window: ${inputs.supportWindow ?? 'Business hours IST, 9AM-6PM, Mon-Fri'}. Write each priority level as follows — start each with the priority code (P1, P2, P3, P4) then colon, then Definition:, Response Time:, Resolution Target:, Escalation: on separate lines. Use plain text only, no Markdown, no bold, no bullets. P1 Critical: Definition: System down or data loss. Response Time: 1 hour. Resolution Target: 4 hours. Escalation: Engagement Manager within 2 hours. P2 High: Definition: Major function impaired. Response Time: 2 hours. Resolution Target: 8 business hours. Escalation: Service Manager. P3 Medium: Definition: Partial function impaired. Response Time: 4 hours. Resolution Target: 24 business hours. Escalation: Service Desk. P4 Low: Definition: Minor cosmetic issue. Response Time: 8 hours. Resolution Target: 48 business hours. Escalation: Service Desk. Add SLA breach penalty: 5 percent of monthly fee per P1 breach, capped at 15 percent of monthly invoice.`,

    'Transition Plan': `Write a detailed Transition Plan section for AMS onboarding for ${inputs.clientName}. Cover 4 phases: Knowledge Acquisition (weeks 1-2), Shadow Support (weeks 3-4), Parallel Run (weeks 5-6), Full Handover. Include documentation requirements and success criteria per phase.`,

    'Governance & Reporting': `Write a Governance & Reporting section for the ${inputs.clientName} AMS engagement. Cover: weekly/monthly/quarterly governance cadence, report types (SLA performance, ticket aging, trends), escalation matrix, change management process for enhancements.`,

    'Company Credentials': `Write a Company Credentials section for Tower-CEO Technologies (Tower-CEO). Include: ISO 9001:2015 and ISO/IEC 27001:2022 certifications, SAP partnership status, years in SAP consulting, AMS expertise, team size, key differentiators. Add 2-3 anonymised reference engagements relevant to ${inputs.industry ?? 'this industry'}.`,

    // ── Resource Augmentation ──
    'Resource Profiles': `Write detailed professional profiles for each resource being proposed to ${inputs.clientName}. Resources: ${inputs.selectedResources ?? inputs.resourceProfiles?.map(p => p.name).join(', ') ?? 'to be confirmed'}. For each resource: professional summary, SAP expertise, key experience (3-4 bullet points), certifications, availability, engagement rate. Write as polished professional bios.`,

    'Engagement Model': `Write an Engagement Model section for resource augmentation to ${inputs.clientName}. Cover: how resources integrate with client team, AIS HR management, reporting structure, timesheet process, invoicing, performance reviews, replacement guarantee, ramp-up period.`,

    // ── Solution/BTP ──
    'Solution Overview': `Write a Solution Overview section for the ${inputs.title} engagement for ${inputs.clientName}. Modules/platforms: ${inputs.modules.join(', ')}. Describe: what is being built, the business process it enables, how it fits existing landscape, end-user impact.`,

    'Technical Scope & Architecture': `Write a Technical Scope & Architecture section for ${inputs.clientName}. Modules: ${inputs.modules.join(', ')}. Custom dev: ${inputs.customDevScope ?? 'none'}. Integration: ${inputs.integrationReqs ?? 'none'}. Describe: technical components, APIs, data flows, security model, what is NOT in scope technically.`,

    'Implementation Approach': `Write an Implementation Approach section for ${inputs.clientName}. Duration: ${inputs.expectedDuration ?? 'TBD'}. Deal type: ${inputs.dealType}. Use sprint-based delivery: sprint breakdown, activities per sprint, testing approach, deployment, go-live process.`,

    'Acceptance Criteria': `Write a numbered list of at least 10 specific, measurable Acceptance Criteria for the ${inputs.title} engagement for ${inputs.clientName}. Each criterion must start with "The system shall..." or "The integration shall..." and be testable. Modules: ${inputs.modules.join(', ')}.`,

    // ── Shared ──
    'Commercial Summary': `Write a Commercial Summary section for the ${inputs.clientName} engagement. Deal type: ${inputs.dealType}. Duration: ${inputs.expectedDuration ?? 'TBD'}. Billing model: ${inputs.billingModel ?? inputs.dealType}. Currency: ${inputs.currency ?? 'INR'}. Payment terms: ${inputs.paymentMilestone ?? 'monthly'}. Discount: ${inputs.discount ?? 0}%. Validity: 90 days from proposal date. ${inputs.commercialNotes ?? ''}`,

    'Risk & Mitigation': `Write a Risk & Mitigation section for the ${inputs.clientName} engagement. Duration: ${inputs.expectedDuration ?? 'TBD'}. Timeline pressure: ${inputs.timelinePressure ?? 'normal'}. Dependency risks: ${inputs.dependencyRisks ?? 'standard'}. Identify at least 6 specific risks with likelihood, impact, and concrete mitigation for each. Include both client-side and AIS-side risks.`,

    'Assumptions & Exclusions': `Write Assumptions & Exclusions for the ${inputs.clientName} ${inputs.lob} engagement. Delivery assumptions: ${inputs.deliveryAssumptions ?? 'standard'}. Exclusions: ${inputs.exclusions ?? 'standard'}. Write a numbered list of at least 6 assumptions and a separate numbered list of at least 5 explicit exclusions specific to this engagement type.`,
  };

  const basePrompt = sectionPrompts[sectionName]
    ?? `Write the "${sectionName}" section for a professional SAP consulting proposal for ${inputs.clientName}. LOB: ${inputs.lob}. Modules: ${inputs.modules.join(', ')}. Geography: ${inputs.geography ?? 'India'}. Be specific and client-focused. No generic filler.`;

  const systemPrefix = `You are a senior SAP consulting proposal writer at Tower-CEO Technologies (Tower-CEO), an ISO 9001:2015 and ISO/IEC 27001:2022 certified SAP consulting firm. Write professional, client-facing content only. No internal notes, no generic filler, no placeholders.\n\n${baseContext}\n\n`;

  const ragQuestion = `${sectionName} SAP proposal ${inputs.lob} ${inputs.modules.join(' ')} ${inputs.clientName}`;
  const ragContext  = await buildRAGContext(ragQuestion, ragConfig);
  const rfpContext  = buildRFPContext(inputs.rfpRawText);

  const verifiedCtx = buildVerifiedContext(inputs.presalesBriefing ?? null);

  const groundedPrompt = rfpContext
    ? `${rfpContext}${verifiedCtx}\n\n${systemPrefix}${basePrompt}${ragContext}`
    : `${verifiedCtx}${systemPrefix}${basePrompt}${ragContext}`;

  const { content, endpoint } = await callLLM(
    [{ role: 'user', content: groundedPrompt }],
    { temperature: 0.65, max_tokens: 2000, onEndpointResolved }
  );

  return { name: sectionName, content: content.trim(), status: 'AI-generated' };
}

// ── Resource CV generator (Resource Augmentation only) ────────────────────────

export async function generateResourceCV(
  profile: ResourceProfile,
  clientName: string,
  currency: string,
  onEndpointResolved?: (ep: LLMEndpoint) => void
): Promise<GeneratedSection> {
  const prompt = `You are writing a professional resource profile for a SAP consulting proposal to ${clientName}.

Write a polished, client-facing professional profile for the following consultant.
Write in third person. Be specific about their SAP expertise. Make it compelling.
No generic filler like "results-driven professional" or "proven track record".

CONSULTANT DETAILS:
Name: ${profile.name}
Designation: ${profile.designation}
Years of Experience: ${profile.yearsExperience}
SAP Modules: ${profile.sapModules.join(', ')}
Skills: ${profile.skills.join(', ')}
Certifications: ${profile.certifications.join(', ') || 'None listed'}
Availability: ${profile.availability}
Billing Rate: ${currency} ${profile.billingRate}/hr
Geography: ${profile.geography}
${profile.bio ? `Bio: ${profile.bio}` : ''}
${profile.profileSummary ? `Profile Summary: ${profile.profileSummary}` : ''}
${profile.keyProjects ? `Key Projects: ${profile.keyProjects}` : ''}

Write the profile with these sub-sections:
Professional Summary: (2-3 sentences — specific SAP expertise and career highlight)
SAP Expertise: (bullet list of modules and functional areas)
Key Experience: (3-4 bullet points of specific achievements and project types)
Certifications: (list)
Engagement Terms: ${currency} ${profile.billingRate}/hr | ${profile.availability} | ${profile.geography}`;

  const { content, endpoint } = await callLLM(
    [{ role: 'user', content: prompt }],
    { temperature: 0.6, max_tokens: 800, onEndpointResolved }
  );

  return {
    name:    `Resource Profile: ${profile.name}`,
    content: content.trim(),
    status:  'AI-generated',
  };
}