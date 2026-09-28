/**
 * extractTenderData.ts
 * ─────────────────────────────────────────────────────────────────
 * Zero-hallucination extraction for the Tender Engine.
 *
 * Follows the same "ground truth" guard pattern used in
 * generateQuestionnaire.ts's buildVerifiedContext(): the model is
 * told explicitly not to invent or extrapolate, and every field
 * extracted by the model must carry the verbatim source quote it
 * came from. If a field can't be located in the document, the model
 * is required to say so via confidence: 'not_found' rather than
 * guessing — this is the structural mechanism, not just a prompt
 * suggestion.
 * ─────────────────────────────────────────────────────────────────
 */

import { callLLM } from '@/lib/llmClient';
import { chunkDocument, mergeExtractedLists } from '@/lib/chunkDocument';
import type {
  ExtractedItem,
  ExtractionConfidence,
  QualificationItem,
  TenderMode,
} from '@/lib/tenderEngine';

// ── Shared guard preamble ───────────────────────────────────────────

const EXTRACTION_GUARD = `╔══════════════════════════════════════════════════════════════╗
║  ZERO-HALLUCINATION EXTRACTION — READ CAREFULLY               ║
║  You are extracting facts from a tender/RFP document for a    ║
║  bid team that will rely on this without reading the full     ║
║  document themselves. Accuracy matters more than completeness.║
║                                                                 ║
║  RULES:                                                       ║
║  1. Only report what is explicitly stated in the document.    ║
║  2. NEVER invent, infer beyond the text, guess, or fill gaps   ║
║     with typical/standard values from other tenders you know.  ║
║  3. Every item MUST include a short verbatim quote (max 25     ║
║     words) copied from the document that supports it.         ║
║  4. If a category has no information in the document, return  ║
║     an item with confidence "not_found", value "Not specified  ║
║     in tender document", and an empty sourceQuote.             ║
║  5. confidence must be one of: "exact" (directly stated),      ║
║     "inferred" (reasonably implied by nearby text, not stated  ║
║     word-for-word), or "not_found".                            ║
╚══════════════════════════════════════════════════════════════╝`;

function cleanJson(raw: string): string {
  const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON object found in model output');
  return cleaned.slice(start, end + 1);
}

const VALID_CONFIDENCE: ExtractionConfidence[] = ['exact', 'inferred', 'not_found'];

function sanitizeExtractedItem(raw: any, idx: number, prefix: string): ExtractedItem {
  const confidence: ExtractionConfidence = VALID_CONFIDENCE.includes(raw?.confidence)
    ? raw.confidence
    : 'not_found';
  return {
    id: String(raw?.id ?? `${prefix}${idx + 1}`),
    label: String(raw?.label ?? '').trim() || 'Untitled item',
    value:
      confidence === 'not_found'
        ? String(raw?.value ?? 'Not specified in tender document').trim() || 'Not specified in tender document'
        : String(raw?.value ?? '').trim(),
    sourceQuote: String(raw?.sourceQuote ?? '').trim(),
    sourceLocation: raw?.sourceLocation ? String(raw.sourceLocation).trim() : undefined,
    confidence,
  };
}

function sanitizeExtractedList(raw: unknown, prefix: string): ExtractedItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item, idx) => sanitizeExtractedItem(item, idx, prefix));
}

function fallbackNotFound(label: string, id: string): ExtractedItem {
  return { id, label, value: 'Not specified in tender document', sourceQuote: '', confidence: 'not_found' };
}

function fallbackError(label: string, id: string, error: unknown): ExtractedItem {
  const message = error instanceof Error ? error.message : String(error);
  return {
    id,
    label,
    value: 'Extraction failed for this section — not verified absent',
    sourceQuote: '',
    confidence: 'not_found',
    errorDetail: message,
  };
}

// ── Page 1 — Tender Brief ───────────────────────────────────────────

export interface TenderBriefResult {
  deliverables: ExtractedItem[];
  existingSystems: ExtractedItem[];
  natureOfWork: ExtractedItem[];
  criticalDates: ExtractedItem[];
  projectTimeline: ExtractedItem[];
}

async function extractBriefFromChunk(chunkText: string, chunkLabel: string): Promise<TenderBriefResult> {
  const prompt = `${EXTRACTION_GUARD}

You are extracting the BID BRIEF from the tender document below${chunkLabel}. Extract five categories:

1. "deliverables" — the exact, specific deliverables/outputs/scope items the tender requires the bidder to provide. Not generic SAP filler — only what THIS document states.
2. "existingSystems" — the client's current systems, landscape, technology stack, or "as-is" state described in the document (e.g. existing ERP, legacy systems, current infrastructure).
3. "natureOfWork" — the type/nature of work expected (e.g. implementation, AMS/support, migration, managed services, staff augmentation) as characterised by the document itself.
4. "criticalDates" — BID-PROCESS dates: submission deadline, pre-bid meeting date, query/clarification deadline, bid opening date, bid validity period. (Do NOT include post-award delivery milestones here — those go in projectTimeline.)
5. "projectTimeline" — POST-AWARD delivery timeline: project duration, phases, go-live dates, milestones for executing the awarded work.

IMPORTANT: this may be one part of a larger document split into sections. If this particular excerpt doesn't contain a category, return "not_found" for it — do not assume the whole document lacks it, since other sections may cover it.

Return ONLY valid compact JSON, no markdown, no commentary:
{
  "deliverables": [{"id":"D1","label":"short label","value":"the specific deliverable text","sourceQuote":"verbatim quote <=25 words","sourceLocation":"section/clause if findable","confidence":"exact"}],
  "existingSystems": [...same shape...],
  "natureOfWork": [...same shape...],
  "criticalDates": [...same shape...],
  "projectTimeline": [...same shape...]
}

If a category truly has nothing in this excerpt, return a single item in that array with confidence "not_found".

TENDER DOCUMENT${chunkLabel}:
${chunkText}`;

  try {
    const { content } = await callLLM(
      [{ role: 'user', content: prompt }],
      { temperature: 0.0, max_tokens: 3000 }
    );
    const parsed = JSON.parse(cleanJson(content));

    const deliverables = sanitizeExtractedList(parsed.deliverables, 'D');
    const existingSystems = sanitizeExtractedList(parsed.existingSystems, 'S');
    const natureOfWork = sanitizeExtractedList(parsed.natureOfWork, 'N');
    const criticalDates = sanitizeExtractedList(parsed.criticalDates, 'CD');
    const projectTimeline = sanitizeExtractedList(parsed.projectTimeline, 'PT');

    return {
      deliverables: deliverables.length ? deliverables : [fallbackNotFound('Deliverables', 'D1')],
      existingSystems: existingSystems.length ? existingSystems : [fallbackNotFound('Existing systems', 'S1')],
      natureOfWork: natureOfWork.length ? natureOfWork : [fallbackNotFound('Nature of work', 'N1')],
      criticalDates: criticalDates.length ? criticalDates : [fallbackNotFound('Critical dates', 'CD1')],
      projectTimeline: projectTimeline.length ? projectTimeline : [fallbackNotFound('Project timeline', 'PT1')],
    };
  } catch (err) {
    console.error(`[extractTenderBrief] Chunk extraction failed${chunkLabel}:`, err);
    return {
      deliverables: [fallbackError('Deliverables', 'D1', err)],
      existingSystems: [fallbackError('Existing systems', 'S1', err)],
      natureOfWork: [fallbackError('Nature of work', 'N1', err)],
      criticalDates: [fallbackError('Critical dates', 'CD1', err)],
      projectTimeline: [fallbackError('Project timeline', 'PT1', err)],
    };
  }
}

export async function extractTenderBrief(rfpRawText: string): Promise<TenderBriefResult> {
  const chunks = chunkDocument(rfpRawText);
  console.log(`[extractTenderBrief] Document is ${rfpRawText.length} chars, split into ${chunks.length} chunk(s)`);
  const startedAt = Date.now();

  const perChunkResults = await Promise.all(
    chunks.map(chunk =>
      extractBriefFromChunk(
        chunk.text,
        chunk.total > 1 ? ` (excerpt ${chunk.index + 1} of ${chunk.total})` : ''
      )
    )
  );

  console.log(`[extractTenderBrief] All ${chunks.length} chunk(s) completed in ${Date.now() - startedAt}ms`);

  if (perChunkResults.length === 1) {
    return perChunkResults[0];
  }

  return {
    deliverables: mergeExtractedLists(perChunkResults.map(r => r.deliverables)),
    existingSystems: mergeExtractedLists(perChunkResults.map(r => r.existingSystems)),
    natureOfWork: mergeExtractedLists(perChunkResults.map(r => r.natureOfWork)),
    criticalDates: mergeExtractedLists(perChunkResults.map(r => r.criticalDates)),
    projectTimeline: mergeExtractedLists(perChunkResults.map(r => r.projectTimeline)),
  };
}

// ── Page 2 — Qualification Criteria ─────────────────────────────────

export interface QualificationExtractionResult {
  tenderMode: TenderMode;
  general: QualificationItem[];
  technical: QualificationItem[];
  emd: ExtractedItem[];
  disqualificationRisks: ExtractedItem[];
}

const VALID_TENDER_MODES: TenderMode[] = ['eligibility-only', 'scored', 'unknown'];

function sanitizeQualificationItem(raw: any, idx: number, prefix: string): QualificationItem {
  const base = sanitizeExtractedItem(raw, idx, prefix);
  const maxMarks = typeof raw?.maxMarks === 'number' && raw.maxMarks > 0 ? raw.maxMarks : undefined;
  const weightage = typeof raw?.weightage === 'number' && raw.weightage > 0 ? raw.weightage : undefined;
  return {
    ...base,
    met: 'unverified',
    maxMarks,
    weightage,
  };
}

function sanitizeQualificationList(raw: unknown, prefix: string): QualificationItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item, idx) => sanitizeQualificationItem(item, idx, prefix));
}

function fallbackNotFoundQualification(label: string, id: string): QualificationItem {
  return { ...fallbackNotFound(label, id), met: 'unverified' };
}

function fallbackErrorQualification(label: string, id: string, error: unknown): QualificationItem {
  return { ...fallbackError(label, id, error), met: 'unverified' };
}

interface QualificationChunkResult {
  tenderMode: TenderMode;
  general: QualificationItem[];
  technical: QualificationItem[];
  emd: ExtractedItem[];
  disqualificationRisks: ExtractedItem[];
}

async function extractQualificationFromChunk(
  chunkText: string,
  chunkLabel: string
): Promise<QualificationChunkResult> {
  const prompt = `${EXTRACTION_GUARD}

You are extracting MANDATORY QUALIFICATION REQUIREMENTS from the tender document below${chunkLabel} — the eligibility and technical criteria a bidder MUST satisfy to qualify, not the scope of work itself.

First, classify "tenderMode":
- "scored" — the document defines a marking/scoring matrix with marks or weightage per criterion (e.g. technical 70 marks, financial 30 marks).
- "eligibility-only" — criteria are pass/fail with no marks or weightage mentioned.
- "unknown" — cannot determine from this excerpt.

Then extract four categories:

1. "general" — General/Pre-Qualification (PQ) eligibility criteria: minimum turnover, years in business/incorporation, similar-project experience count, blacklisting/litigation declarations, registration/licensing requirements.
2. "technical" — Technical qualification/evaluation criteria: required certifications (e.g. CMMI, ISO), minimum certified staff counts, technical scoring sub-criteria and their weightage if the tender is scored.
3. "emd" — Earnest Money Deposit / bid security: amount, format (DD/bank guarantee/online), validity period, forfeiture conditions.
4. "disqualificationRisks" — explicit grounds for rejection or disqualification stated in the document (e.g. incomplete submission, page limits, sealed-cover requirements, late submission, non-compliant format).

For "general" and "technical" items, include "maxMarks" (number) and "weightage" (number, percentage) ONLY if the document states a scoring matrix — omit both fields entirely if tenderMode is "eligibility-only" or if no marks are stated for that specific item.

IMPORTANT: this may be one part of a larger document split into sections. If this particular excerpt doesn't contain a category, return "not_found" for it — do not assume the whole document lacks it, since other sections may cover it.

Return ONLY valid compact JSON, no markdown, no commentary:
{
  "tenderMode": "scored",
  "general": [{"id":"G1","label":"short label","value":"the specific requirement text","sourceQuote":"verbatim quote <=25 words","sourceLocation":"section/clause if findable","confidence":"exact","maxMarks":10,"weightage":5}],
  "technical": [...same shape...],
  "emd": [{"id":"E1","label":"short label","value":"...","sourceQuote":"...","confidence":"exact"}],
  "disqualificationRisks": [...same shape as emd...]
}

If a category truly has nothing in this excerpt, return a single item in that array with confidence "not_found".

TENDER DOCUMENT${chunkLabel}:
${chunkText}`;

  try {
    const { content } = await callLLM(
      [{ role: 'user', content: prompt }],
      { temperature: 0.0, max_tokens: 3000 }
    );
    const parsed = JSON.parse(cleanJson(content));

    const tenderMode: TenderMode = VALID_TENDER_MODES.includes(parsed.tenderMode)
      ? parsed.tenderMode
      : 'unknown';

    const general = sanitizeQualificationList(parsed.general, 'G');
    const technical = sanitizeQualificationList(parsed.technical, 'T');
    const emd = sanitizeExtractedList(parsed.emd, 'E');
    const disqualificationRisks = sanitizeExtractedList(parsed.disqualificationRisks, 'DQ');

    return {
      tenderMode,
      general: general.length ? general : [fallbackNotFoundQualification('General eligibility', 'G1')],
      technical: technical.length ? technical : [fallbackNotFoundQualification('Technical qualification', 'T1')],
      emd: emd.length ? emd : [fallbackNotFound('EMD / bid security', 'E1')],
      disqualificationRisks: disqualificationRisks.length
        ? disqualificationRisks
        : [fallbackNotFound('Disqualification risks', 'DQ1')],
    };
  } catch (err) {
    console.error(`[extractQualificationCriteria] Chunk extraction failed${chunkLabel}:`, err);
    return {
      tenderMode: 'unknown',
      general: [fallbackErrorQualification('General eligibility', 'G1', err)],
      technical: [fallbackErrorQualification('Technical qualification', 'T1', err)],
      emd: [fallbackError('EMD / bid security', 'E1', err)],
      disqualificationRisks: [fallbackError('Disqualification risks', 'DQ1', err)],
    };
  }
}

/** Prefers a definitive classification ("scored" or "eligibility-only") over "unknown" —
 * a chunk that never saw the scoring section correctly says "unknown" for itself, but that
 * shouldn't override a different chunk that DID find a definitive answer. If chunks disagree
 * (one says scored, another eligibility-only), "scored" wins since a scoring matrix found
 * anywhere in the document means the tender is scored.
 */
function resolveTenderMode(modes: TenderMode[]): TenderMode {
  if (modes.includes('scored')) return 'scored';
  if (modes.includes('eligibility-only')) return 'eligibility-only';
  return 'unknown';
}

export async function extractQualificationCriteria(
  rfpRawText: string
): Promise<QualificationExtractionResult> {
  const chunks = chunkDocument(rfpRawText);

  const perChunkResults = await Promise.all(
    chunks.map(chunk =>
      extractQualificationFromChunk(
        chunk.text,
        chunk.total > 1 ? ` (excerpt ${chunk.index + 1} of ${chunk.total})` : ''
      )
    )
  );

  if (perChunkResults.length === 1) {
    return perChunkResults[0];
  }

  return {
    tenderMode: resolveTenderMode(perChunkResults.map(r => r.tenderMode)),
    general: mergeExtractedLists(perChunkResults.map(r => r.general)),
    technical: mergeExtractedLists(perChunkResults.map(r => r.technical)),
    emd: mergeExtractedLists(perChunkResults.map(r => r.emd)),
    disqualificationRisks: mergeExtractedLists(perChunkResults.map(r => r.disqualificationRisks)),
  };
}

// ── AIS evidence matching (uses Company Profile, never invents) ────

interface CompanyProfileForMatching {
  legalName?: string;
  foundedYear?: string;
  sapPartnerTier?: string;
  isoCertifications?: string;
  offices?: string;
  teamSize?: string;
  revenueRange?: string;
  aboutUs?: string;
}

/**
 * Attaches AIS's own evidence (from the real Company Profile, not invented)
 * to qualification items where a confident textual match exists. Items with
 * no match are left without aisEvidence and met stays 'unverified' — a human
 * must confirm, this function never marks something 'yes' on its own.
 */
export function attachCompanyEvidence(
  items: QualificationItem[],
  profile: CompanyProfileForMatching | null
): QualificationItem[] {
  if (!profile) return items;

  const evidenceMap: { keywords: string[]; evidence: string | undefined }[] = [
    { keywords: ['cmmi', 'iso', 'certif'], evidence: profile.isoCertifications },
    { keywords: ['turnover', 'revenue', 'financial'], evidence: profile.revenueRange },
    { keywords: ['partner', 'sap gold', 'sap partner'], evidence: profile.sapPartnerTier },
    { keywords: ['team size', 'consultants on roll', 'staff strength', 'headcount'], evidence: profile.teamSize },
    { keywords: ['years', 'incorporat', 'establish', 'experience'], evidence: profile.foundedYear ? `Founded ${profile.foundedYear}` : undefined },
    { keywords: ['office', 'presence', 'location'], evidence: profile.offices },
  ];

  return items.map(item => {
    const haystack = `${item.label} ${item.value}`.toLowerCase();
    const match = evidenceMap.find(e => e.evidence && e.keywords.some(k => haystack.includes(k)));
    if (match?.evidence) {
      return { ...item, aisEvidence: match.evidence };
    }
    return item;
  });
}