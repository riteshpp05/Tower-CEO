/**
 * generateQuestionnaire.ts
 * â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 * Generates a Pre-Sales Briefing questionnaire from RFP raw text.
 * Qwen reads the RFP and produces engagement-specific questions
 * that the pre-sales team must answer before draft generation.
 *
 * For long RFPs, a single-pass truncated read would only ever see
 * the first ~2 pages, biasing the questionnaire toward whatever
 * happens to be at the front of the document. A naive chunk-and-
 * merge (run the question prompt per chunk, concatenate) doesn't
 * work either â€” the prompt deliberately asks for a CURATED 12-16
 * questions, so merging per-chunk results would just produce
 * duplicate/bloated questions instead of a clean fix.
 *
 * Instead this uses two stages:
 *   1. Gap scan â€” every chunk is scanned cheaply for candidate gap
 *      areas (things mentioned but not clarified). Runs in parallel,
 *      short outputs, covers the WHOLE document.
 *   2. Curate â€” the candidate gaps from every chunk, plus a sample
 *      of the document for tone/grounding, are fed into a single
 *      generation call that picks/synthesizes the best 12-16
 *      questions without duplication. Output shape is unchanged
 *      from before, so nothing downstream needs to change.
 * â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 */

import { callLLM } from '@/lib/llmClient';
import { chunkDocument } from '@/lib/chunkDocument';

export interface BriefingQuestion {
  id: string;
  category: 'Scope' | 'Commercial' | 'Resources' | 'Technical' | 'Risk' | 'Client' | 'Client Background' | 'Current Landscape' | 'Business Requirements' | 'Constraints' | 'Technical Approach';
  section: 'context' | 'solution'; // context = Section A, solution = Section B
  question: string;
  answer: string;
  required: boolean;
}

export interface ResourceHourEntry {
  roleId: string;
  skill: string;
  level: string;
  location: string;
  billingRate: number;
  currency: string;
  suggestedHours: number;
  confirmedHours: number;
  notes: string;
  status: 'confirmed' | 'tentative' | 'removed';
}

export interface PresalesBriefing {
  qa: BriefingQuestion[];
  contextSectionComplete: boolean; // Section A completed â€” gates Section B
  resourceHours: ResourceHourEntry[];
  presalesNotes: string;
  kbDocIds: string[];
  generatedAt: string;
  completedAt?: string;
}

// â”€â”€ Default questions per proposal type (Section A = context, Section B = solution) â”€â”€
// section:'context' = must complete before section:'solution' is unlocked
const DEFAULT_QUESTIONS: Record<string, BriefingQuestion[]> = {
  ams: [
    // â”€â”€ Section A: Context Definition â”€â”€
    { id: 'q-d-1', section: 'context', category: 'Client Background',    question: 'Who is the primary stakeholder and decision-maker at the client for this AMS engagement?', answer: '', required: true },
    { id: 'q-d-2', section: 'context', category: 'Current Landscape',    question: 'What SAP modules and version is the client currently running? Is the system on-premise, private cloud, or public cloud?', answer: '', required: true },
    { id: 'q-d-3', section: 'context', category: 'Current Landscape',    question: 'What triggered this AMS requirement â€” go-live support, incumbent vendor change, cost reduction, or ongoing need?', answer: '', required: true },
    { id: 'q-d-4', section: 'context', category: 'Business Requirements', question: 'What are the client\'s top 3 pain points with their current SAP support model?', answer: '', required: true },
    { id: 'q-d-5', section: 'context', category: 'Constraints',          question: 'Are there any compliance, data residency, or security constraints that affect offshore delivery?', answer: '', required: false },
    // â”€â”€ Section B: Solution Definition â”€â”€
    { id: 'q-d-6', section: 'solution', category: 'Scope',               question: 'Which SAP modules are confirmed in scope for AMS support? List specifically.', answer: '', required: true },
    { id: 'q-d-7', section: 'solution', category: 'Commercial',          question: 'What is the confirmed annual hours commitment and billing model (retainer vs T&M)?', answer: '', required: true },
    { id: 'q-d-8', section: 'solution', category: 'Commercial',          question: 'What are the agreed hourly rates for AMS support and for change requests / enhancements?', answer: '', required: true },
    { id: 'q-d-9', section: 'solution', category: 'Resources',           question: 'Is an onsite resource required? If yes, what designation, for how long, and at which location?', answer: '', required: true },
    { id: 'q-d-10',section: 'solution', category: 'Technical Approach',  question: 'What ticketing tool will be used? What is the agreed incident response workflow?', answer: '', required: false },
    { id: 'q-d-11',section: 'solution', category: 'Risk',                question: 'Are there known SAP landscape issues, pending upgrades, or open customisations that affect support scope?', answer: '', required: false },
  ],
  implementation: [
    // â”€â”€ Section A: Context Definition â”€â”€
    { id: 'q-d-1', section: 'context', category: 'Client Background',    question: 'Who are the executive sponsor, project owner, and IT lead at the client?', answer: '', required: true },
    { id: 'q-d-2', section: 'context', category: 'Current Landscape',    question: 'What is the client\'s current ERP system (if any)? What data and processes need migrating?', answer: '', required: true },
    { id: 'q-d-3', section: 'context', category: 'Business Requirements', question: 'What business outcomes is the client expecting from this SAP implementation in year 1?', answer: '', required: true },
    { id: 'q-d-4', section: 'context', category: 'Business Requirements', question: 'What is the client\'s internal IT capability â€” do they have a dedicated SAP team, or is this the first SAP project?', answer: '', required: true },
    { id: 'q-d-5', section: 'context', category: 'Constraints',          question: 'What is the hard go-live deadline and what is driving it (board mandate, contract, regulatory)?', answer: '', required: true },
    { id: 'q-d-6', section: 'context', category: 'Constraints',          question: 'What is the confirmed budget range and approval authority?', answer: '', required: true },
    // â”€â”€ Section B: Solution Definition â”€â”€
    { id: 'q-d-7', section: 'solution', category: 'Scope',               question: 'Is this Greenfield, Brownfield, or System Conversion? Which modules are confirmed in scope?', answer: '', required: true },
    { id: 'q-d-8', section: 'solution', category: 'Technical Approach',  question: 'What is the proposed implementation methodology â€” SAP Activate, ASAP, or custom? Fit-to-standard or heavy customisation?', answer: '', required: true },
    { id: 'q-d-9', section: 'solution', category: 'Technical Approach',  question: 'What third-party integrations are required? List systems, APIs, and interfaces.', answer: '', required: false },
    { id: 'q-d-10',section: 'solution', category: 'Resources',           question: 'How many onsite vs offshore resources are required? Which roles must be onsite?', answer: '', required: true },
    { id: 'q-d-11',section: 'solution', category: 'Commercial',          question: 'Is this Fixed Price or T&M? What are the payment milestone triggers?', answer: '', required: true },
    { id: 'q-d-12',section: 'solution', category: 'Risk',                question: 'What are the top 3 delivery risks and AIS\'s proposed mitigation for each?', answer: '', required: false },
  ],
  resource_augmentation: [
    // â”€â”€ Section A: Context Definition â”€â”€
    { id: 'q-d-1', section: 'context', category: 'Client Background',    question: 'Who is managing the augmented resources at the client â€” their project manager or IT lead?', answer: '', required: true },
    { id: 'q-d-2', section: 'context', category: 'Current Landscape',    question: 'What is the client\'s existing SAP team composition? What skill gaps are they trying to fill?', answer: '', required: true },
    { id: 'q-d-3', section: 'context', category: 'Business Requirements', question: 'What triggered this requirement â€” project ramp-up, attrition, skill gap, or go-live support?', answer: '', required: true },
    { id: 'q-d-4', section: 'context', category: 'Constraints',          question: 'Are there background verification, security clearance, or visa requirements for the resources?', answer: '', required: false },
    // â”€â”€ Section B: Solution Definition â”€â”€
    { id: 'q-d-5', section: 'solution', category: 'Resources',           question: 'How many resources are needed, for which SAP modules/skills, and at what seniority level?', answer: '', required: true },
    { id: 'q-d-6', section: 'solution', category: 'Resources',           question: 'Is this onsite, offshore, or hybrid? Specify location if onsite.', answer: '', required: true },
    { id: 'q-d-7', section: 'solution', category: 'Commercial',          question: 'What is the agreed billing rate per resource and invoicing frequency?', answer: '', required: true },
    { id: 'q-d-8', section: 'solution', category: 'Scope',               question: 'What is the engagement duration and are there extension options?', answer: '', required: true },
    { id: 'q-d-9', section: 'solution', category: 'Risk',                question: 'What is the replacement guarantee period and process if a resource is not suitable?', answer: '', required: false },
  ],
  solution: [
    // â”€â”€ Section A: Context Definition â”€â”€
    { id: 'q-d-1', section: 'context', category: 'Client Background',    question: 'Who is the technical owner and business sponsor for this solution at the client?', answer: '', required: true },
    { id: 'q-d-2', section: 'context', category: 'Current Landscape',    question: 'What is the existing system landscape that this solution will integrate with or replace?', answer: '', required: true },
    { id: 'q-d-3', section: 'context', category: 'Business Requirements', question: 'What specific business problem is this solution solving? What does success look like?', answer: '', required: true },
    { id: 'q-d-4', section: 'context', category: 'Constraints',          question: 'What are the performance, availability, and security requirements for this solution?', answer: '', required: false },
    // â”€â”€ Section B: Solution Definition â”€â”€
    { id: 'q-d-5', section: 'solution', category: 'Scope',               question: 'What is the exact technical scope â€” what is being built, configured, or integrated?', answer: '', required: true },
    { id: 'q-d-6', section: 'solution', category: 'Technical Approach',  question: 'What SAP platforms are involved (BTP, Fiori, ABAP, API Management)? Proposed architecture?', answer: '', required: true },
    { id: 'q-d-7', section: 'solution', category: 'Commercial',          question: 'Is this Fixed Price? What are the payment milestones and change request process?', answer: '', required: true },
    { id: 'q-d-8', section: 'solution', category: 'Scope',               question: 'What are the explicit acceptance criteria for each deliverable?', answer: '', required: false },
    { id: 'q-d-9', section: 'solution', category: 'Risk',                question: 'What are the technical risks â€” integration complexity, data volume, third-party dependencies?', answer: '', required: false },
  ],
};

// â”€â”€ Category color map for UI â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const CATEGORY_COLORS: Record<string, string> = {
  // Section A â€” Context
  'Client Background':    'bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-300',
  'Current Landscape':    'bg-cyan-50 text-cyan-700 dark:bg-cyan-950 dark:text-cyan-300',
  'Business Requirements':'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
  'Constraints':          'bg-slate-50 text-slate-700 dark:bg-slate-950 dark:text-slate-300',
  // Section B â€” Solution
  'Scope':          'bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300',
  'Technical':      'bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-300',
  'Technical Approach':'bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-300',
  'Resources':      'bg-purple-50 text-purple-700 dark:bg-purple-950 dark:text-purple-300',
  'Commercial':     'bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300',
  'Risk':           'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300',
  // Legacy fallback
  'Client':         'bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-300',
};

// â”€â”€ Stage 1: Gap scan (per chunk) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
/**
 * Cheaply scans one chunk of the RFP for candidate gap areas â€” things
 * mentioned but not fully clarified, ambiguous statements, or areas a
 * pre-sales team would need the client to confirm before pricing/scoping.
 * Short, plain-text output (not the final question schema) â€” Stage 2 turns
 * these into the actual curated questionnaire.
 */
async function scanChunkForGaps(chunkText: string, chunkLabel: string): Promise<string[]> {
  const prompt = `You are a senior SAP pre-sales consultant reviewing an RFP excerpt${chunkLabel} before a proposal is written.

List things in THIS excerpt that are mentioned but not fully clarified â€” areas where the pre-sales team would need to confirm a detail with the client before pricing, scoping, or planning resources. Think: ambiguous statements, missing specifics (counts, dates, named systems), assumptions the RFP leaves open.

Be brief â€” one short phrase per gap, no explanation. If this excerpt has nothing requiring clarification, return an empty array.

Return ONLY a valid JSON array of short strings, no markdown fences:
["gap area 1", "gap area 2"]

RFP EXCERPT${chunkLabel}:
${chunkText}`;

  try {
    const { content } = await callLLM(
      [{ role: 'user', content: prompt }],
      { temperature: 0.2, max_tokens: 600 }
    );
    const cleaned = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const start = cleaned.indexOf('[');
    const end = cleaned.lastIndexOf(']');
    if (start === -1 || end === -1) return [];
    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed.filter((g): g is string => typeof g === 'string' && g.trim().length > 0).map(g => g.trim()) : [];
  } catch {
    return [];
  }
}

// â”€â”€ Stage 2: Curate (single pass over gap candidates) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function curateQuestionsFromGaps(
  gapCandidates: string[],
  contextSample: string,
  proposalType: 'ams' | 'implementation' | 'resource_augmentation' | 'solution',
  clientName: string,
  modules: string[]
): Promise<BriefingQuestion[]> {
  const typeLabel = {
    ams: 'Application Management Services (AMS)',
    implementation: 'SAP Implementation',
    resource_augmentation: 'Resource Augmentation',
    solution: 'SAP Solution / Integration / BTP',
  }[proposalType];

  const gapList = gapCandidates.length > 0
    ? gapCandidates.map(g => `- ${g}`).join('\n')
    : '(no specific gaps flagged â€” use the document sample below to identify questions)';

  const prompt = `You are a senior SAP pre-sales consultant preparing for a proposal to ${clientName}.

A first pass over the FULL RFP document (which may run many pages) flagged the following candidate gap areas â€” things mentioned but not fully clarified, gathered from across the entire document, not just the start:

${gapList}

You also have a sample excerpt from the start of the document for tone/context:
${contextSample}

Using the gap areas above as your primary source, generate a Pre-Sales Briefing questionnaire.
These questions will be answered by the pre-sales team BEFORE writing the proposal.
The goal is to eliminate all assumptions and hallucination from the proposal by gathering verified facts.

ENGAGEMENT TYPE: ${typeLabel}
SAP MODULES: ${modules.join(', ') || 'To be confirmed'}

RULES:
1. Generate EXACTLY 12-16 questions split into TWO sections.
2. SECTION A (context) = 5-7 questions: understand the client, their landscape, business need, and constraints. These must be answered FIRST.
3. SECTION B (solution) = 6-8 questions: define AIS's solution â€” scope, approach, resources, commercial, risks.
4. Each question must be SPECIFIC â€” draw from the gap areas listed above, which reflect the WHOLE document, not just the excerpt shown.
5. Do NOT produce near-duplicate questions even if similar gaps were flagged more than once â€” merge overlapping gaps into one well-formed question.
6. Mark required=true for anything that affects pricing, scope, or resource planning.
7. Section A categories: Client Background, Current Landscape, Business Requirements, Constraints
8. Section B categories: Scope, Technical Approach, Resources, Commercial, Risk

Return ONLY a valid JSON array with no markdown fences:
[
  {
    "id": "q-1",
    "section": "context",
    "category": "Client Background",
    "question": "specific context question",
    "answer": "",
    "required": true
  },
  {
    "id": "q-6",
    "section": "solution",
    "category": "Scope",
    "question": "specific solution question",
    "answer": "",
    "required": true
  }
]`;

  const { content } = await callLLM(
    [{ role: 'user', content: prompt }],
    { temperature: 0.3, max_tokens: 2000 }
  );

  const cleaned = content
    .replace(/```json\n?/g, '')
    .replace(/```\n?/g, '')
    .trim();

  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start === -1 || end === -1) throw new Error('No JSON array in response');

  const parsed = JSON.parse(cleaned.slice(start, end + 1)) as BriefingQuestion[];

  const validCategories = ['Scope','Commercial','Resources','Technical','Risk','Client',
    'Client Background','Current Landscape','Business Requirements','Constraints','Technical Approach'];

  const valid = parsed
    .filter(q => q && typeof q.question === 'string' && q.question.trim().length > 10)
    .map((q, i) => ({
      id: `q-${i + 1}`,
      section: (['context','solution'].includes(q.section) ? q.section : (i < Math.floor(parsed.length / 2) ? 'context' : 'solution')) as 'context' | 'solution',
      category: (validCategories.includes(q.category) ? q.category : 'Scope') as BriefingQuestion['category'],
      question: String(q.question).trim(),
      answer: '',
      required: Boolean(q.required),
    }));

  if (valid.length < 3) throw new Error('Too few valid questions returned');
  return valid;
}

// â”€â”€ Generate questionnaire from RFP â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export async function generateQuestionnaire(
  rfpRawText: string,
  proposalType: 'ams' | 'implementation' | 'resource_augmentation' | 'solution',
  clientName: string,
  modules: string[]
): Promise<BriefingQuestion[]> {

  if (!rfpRawText || rfpRawText.trim().length < 100) {
    // No RFP â€” return type-specific defaults
    return DEFAULT_QUESTIONS[proposalType] ?? DEFAULT_QUESTIONS.implementation;
  }

  try {
    const chunks = chunkDocument(rfpRawText);

    // Stage 1: scan every chunk for gap candidates (cheap, parallel, covers whole doc)
    const gapResults = await Promise.all(
      chunks.map(chunk =>
        scanChunkForGaps(chunk.text, chunks.length > 1 ? ` (excerpt ${chunk.index + 1} of ${chunks.length})` : '')
      )
    );
    const gapCandidates = [...new Set(gapResults.flat().map(g => g.trim()).filter(Boolean))];

    // Stage 2: curate the final 12-16 questions from the gap candidates,
    // with a short sample from the start of the doc for tone/grounding.
    const contextSample = rfpRawText.slice(0, 2000);
    return await curateQuestionsFromGaps(gapCandidates, contextSample, proposalType, clientName, modules);

  } catch {
    // Fallback to defaults if either stage fails or returns invalid JSON
    return DEFAULT_QUESTIONS[proposalType] ?? DEFAULT_QUESTIONS.implementation;
  }
}

// â”€â”€ Build verified context string for injection into proposal prompts â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export function buildVerifiedContext(briefing: PresalesBriefing | null | undefined): string {
  if (!briefing) return '';

  const answeredQA = briefing.qa.filter(q => String(q.answer ?? '').trim().length > 0);
  if (answeredQA.length === 0 && !String(briefing.presalesNotes ?? '').trim()) return '';

  const lines: string[] = [
    '',
    'â•”â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•—',
    'â•‘  VERIFIED PRE-SALES BRIEFING â€” TREAT AS GROUND TRUTH    â•‘',
    'â•‘  These answers were provided by the pre-sales team.      â•‘',
    'â•‘  Use ONLY these facts for scope, commercial, and         â•‘',
    'â•‘  resource sections. DO NOT invent or extrapolate.        â•‘',
    'â•šâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•',
    '',
  ];

  if (answeredQA.length > 0) {
    lines.push('VERIFIED Q&A:');
    answeredQA.forEach(q => {
      lines.push(`[${q.category}] Q: ${q.question}`);
      lines.push(`           A: ${String(q.answer ?? '').trim()}`);
      lines.push('');
    });
  }

  if (String(briefing.presalesNotes ?? '').trim()) {
    lines.push('PRE-SALES ADDITIONAL CONTEXT:');
    lines.push(String(briefing.presalesNotes).trim());
    lines.push('');
  }

  // Resource hours if confirmed
  const confirmedResources = briefing.resourceHours.filter(r => r.status === 'confirmed' && r.confirmedHours > 0);
  if (confirmedResources.length > 0) {
    lines.push('CONFIRMED RESOURCE PLAN (use these hours exactly):');
    confirmedResources.forEach(r => {
      lines.push(`  - ${r.skill} (${r.level}, ${r.location}): ${r.confirmedHours} hours @ ${r.currency} ${r.billingRate}/hr`);
    });
    lines.push('');
  }

  lines.push(
    'ANTI-HALLUCINATION RULES:',
    '1. Never state AIS has "X years of experience" unless specified above.',
    '2. Never state AIS has "X clients" unless specified above.',
    '3. For Company Credentials, use ONLY content retrieved from the Knowledge Base.',
    '4. For ticket volumes, use ONLY numbers stated in the Q&A above.',
    '5. For SLA times, use ONLY values stated above or standard AIS defaults:',
    '   P1=1hr response/4hr resolution, P2=2hr/8hr, P3=4hr/24hr, P4=8hr/48hr.',
    '6. The support window is 9:00 AM â€“ 6:00 PM IST, Mondayâ€“Friday unless stated otherwise above.',
    '',
  );

  return lines.join('\n');
}
