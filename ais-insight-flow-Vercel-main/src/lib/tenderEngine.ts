/**
 * tenderEngine.ts
 * -----------------------------------------------------------------
 * Core data model + persistence for the Tender Engine.
 *
 * Storage: reuses the existing `app_config` key-value table --
 * the same pattern as Knowledge Base's `company_profile` row.
 * No new Supabase migration required.
 *
 *   - Index row:   key = 'tender_index'        -> { ids: string[] }
 *   - Record rows: key = 'tender:<id>'          -> TenderRecord (JSON)
 *
 * Each TenderRecord is proposal-compatible in shape (mirrors
 * ProposalMetadata conventions) so it can be promoted into a real
 * Proposal later without re-keying data, even though the Tender
 * Engine itself runs as a fully standalone flow.
 * -----------------------------------------------------------------
 */

import { supabase } from '@/integrations/supabase/client';

// -- Shared extraction primitives -----------------------------------

/** Confidence of an extracted field -- the structural anti-hallucination guard. */
export type ExtractionConfidence = 'exact' | 'inferred' | 'not_found';

export interface ExtractedItem {
  id: string;
  label: string;
  value: string;
  /** Verbatim short snippet (<=25 words) from the RFP supporting this value, for human verification. */
  sourceQuote: string;
  /** Page/clause/section reference if extractable from the document. */
  sourceLocation?: string;
  confidence: ExtractionConfidence;
  /** Set only when confidence is 'not_found' AND the cause was an extraction failure
   *  (LLM call threw, response wasn't valid JSON, etc.) rather than the model genuinely
   *  reporting the document lacks this. Lets the UI distinguish "verified absent" from
   *  "we don't actually know -- extraction broke." */
  errorDetail?: string;
}

export type TenderMode = 'eligibility-only' | 'scored' | 'unknown';

export interface QualificationItem extends ExtractedItem {
  /** Pulled from AIS's own Company Profile / References -- not invented. */
  aisEvidence?: string;
  met: 'yes' | 'no' | 'unverified';
  /** Present only when tenderMode === 'scored'. */
  maxMarks?: number;
  weightage?: number;
}

export type AnnexureKind = 'fill_form' | 'data_table' | 'checklist_only';

export interface AnnexureItem {
  id: string;
  name: string;
  kind: AnnexureKind;
  /** Extracted verbatim format/template text from the RFP, for 'fill_form' annexures. */
  sourceFormat?: string;
  /** Free text AIS fills in (for fill_form) or notes (for checklist_only). */
  filledContent?: string;
  status: 'pending' | 'drafted' | 'ready';
}

export interface CoverLetterData {
  legalName: string;
  corporateStructure: string;
  contactName: string;
  contactTitle: string;
  contactAddress: string;
  contactPhone: string;
  contactEmail: string;
  hasSubcontractors: 'none' | 'yes';
  subcontractorDetails: string;
  pendingLitigation: 'none' | 'disclose';
  litigationDetails: string;
  bankruptcyLast5Yrs: 'none' | 'disclose';
  bankruptcyDetails: string;
  validityDays: number;
  authorisedSignatory: string;
  signatoryTitle: string;
  additionalNotes: string;
}

export const DEFAULT_TENDER_COVER_LETTER: CoverLetterData = {
  legalName: 'Abhiyanta India Solutions Pvt. Ltd.',
  corporateStructure: 'Private Limited Company incorporated under the Companies Act, 2013, India',
  contactName: '',
  contactTitle: '',
  contactAddress: '1st Floor, Lohia Jain IT Park, Paud Road, Kothrud, Pune 411038, Maharashtra, India',
  contactPhone: '+91 90280 51760',
  contactEmail: 'sales@abhiyantatech.com',
  hasSubcontractors: 'none',
  subcontractorDetails: '',
  pendingLitigation: 'none',
  litigationDetails: '',
  bankruptcyLast5Yrs: 'none',
  bankruptcyDetails: '',
  validityDays: 90,
  authorisedSignatory: 'Umesh Shinde',
  signatoryTitle: 'Founder & CEO',
  additionalNotes: '',
};

// -- Main record -----------------------------------------------------

export interface TenderRecord {
  id: string;              // TND-2026-001 style
  title: string;
  clientName: string;
  owner: string;
  createdAt: string;
  updatedAt: string;

  rfpRawText: string;       // from extractDocxText()
  rfpSessionId: string;     // from indexRfpDocument() -- enables RAG follow-up queries
  rfpFiles: string[];

  status: 'extracting' | 'extracted' | 'reviewed' | 'error';
  extractedAt?: string;
  extractionError?: string;

  // Page 1 -- Tender Brief
  brief: {
    deliverables: ExtractedItem[];
    existingSystems: ExtractedItem[];
    natureOfWork: ExtractedItem[];
    criticalDates: ExtractedItem[]; // bid submission deadline, pre-bid meeting, validity, etc.
    projectTimeline: ExtractedItem[]; // post-award delivery timeline / phases
  };

  // Page 2 -- Qualification Criteria
  qualification: {
    tenderMode: TenderMode;
    general: QualificationItem[];
    technical: QualificationItem[];
    emd: ExtractedItem[];
    disqualificationRisks: ExtractedItem[];
  };

  // Page 3 -- Submission Package
  submission: {
    coverLetter: CoverLetterData;
    annexures: AnnexureItem[];
  };
}

export function emptyBrief(): TenderRecord['brief'] {
  return { deliverables: [], existingSystems: [], natureOfWork: [], criticalDates: [], projectTimeline: [] };
}

export function emptyQualification(): TenderRecord['qualification'] {
  return { tenderMode: 'unknown', general: [], technical: [], emd: [], disqualificationRisks: [] };
}

export function newTenderRecord(opts: {
  id: string;
  title: string;
  clientName: string;
  owner: string;
  rfpRawText: string;
  rfpSessionId: string;
  rfpFiles: string[];
}): TenderRecord {
  const now = new Date().toISOString();
  return {
    id: opts.id,
    title: opts.title,
    clientName: opts.clientName,
    owner: opts.owner,
    createdAt: now,
    updatedAt: now,
    rfpRawText: opts.rfpRawText,
    rfpSessionId: opts.rfpSessionId,
    rfpFiles: opts.rfpFiles,
    status: 'extracting',
    brief: emptyBrief(),
    qualification: emptyQualification(),
    submission: {
      coverLetter: { ...DEFAULT_TENDER_COVER_LETTER },
      annexures: [],
    },
  };
}

// -- Persistence (app_config key-value) ------------------------------

interface TenderIndexEntry {
  id: string;
  title: string;
  clientName: string;
  status: TenderRecord['status'];
  updatedAt: string;
}

const INDEX_KEY = 'tender_index';
const recordKey = (id: string) => `tender:${id}`;

async function readConfigValue<T>(key: string): Promise<T | null> {
  const { data, error } = await supabase
    .from('app_config' as never)
    .select('value')
    .eq('key', key)
    .maybeSingle();
  if (error || !data) return null;
  const raw = (data as { value?: unknown }).value;
  try {
    return (typeof raw === 'string' ? JSON.parse(raw) : raw) as T;
  } catch {
    return null;
  }
}

async function writeConfigValue(key: string, value: unknown): Promise<void> {
  const { error } = await supabase
    .from('app_config' as never)
    .upsert({ key, value: JSON.stringify(value) } as never, { onConflict: 'key' });
  if (error) throw error;
}

async function readIndex(): Promise<TenderIndexEntry[]> {
  const idx = await readConfigValue<{ entries: TenderIndexEntry[] }>(INDEX_KEY);
  return idx?.entries ?? [];
}

async function writeIndex(entries: TenderIndexEntry[]): Promise<void> {
  await writeConfigValue(INDEX_KEY, { entries });
}

/** Fetch the lightweight index (for the dashboard list page). Never throws -- returns [] on failure. */
export async function listTenders(): Promise<TenderIndexEntry[]> {
  try {
    const entries = await readIndex();
    // Most recently updated first
    return [...entries].sort((a, b) => (b.updatedAt > a.updatedAt ? 1 : -1));
  } catch {
    return [];
  }
}

/** Fetch a single full TenderRecord by id. Returns null if not found or on error. */
export async function getTender(id: string): Promise<TenderRecord | null> {
  try {
    return await readConfigValue<TenderRecord>(recordKey(id));
  } catch {
    return null;
  }
}

/** Create or fully overwrite a tender record, and keep the index in sync. */
export async function saveTender(record: TenderRecord): Promise<void> {
  const updated: TenderRecord = { ...record, updatedAt: new Date().toISOString() };
  await writeConfigValue(recordKey(updated.id), updated);

  const entries = await readIndex();
  const without = entries.filter(e => e.id !== updated.id);
  without.push({
    id: updated.id,
    title: updated.title,
    clientName: updated.clientName,
    status: updated.status,
    updatedAt: updated.updatedAt,
  });
  await writeIndex(without);
}

/** Apply a partial update to an existing tender record (read-merge-write). */
export async function updateTender(
  id: string,
  patch: Partial<TenderRecord> | ((prev: TenderRecord) => Partial<TenderRecord>)
): Promise<TenderRecord | null> {
  const existing = await getTender(id);
  if (!existing) return null;
  const delta = typeof patch === 'function' ? patch(existing) : patch;
  const merged: TenderRecord = { ...existing, ...delta, updatedAt: new Date().toISOString() };
  await saveTender(merged);
  return merged;
}

/** Delete a tender record and remove it from the index. */
export async function deleteTender(id: string): Promise<void> {
  const { error } = await supabase.from('app_config' as never).delete().eq('key', recordKey(id));
  if (error) throw error;
  const entries = await readIndex();
  await writeIndex(entries.filter(e => e.id !== id));
}

/** Generates a TND-YYYY-NNN style id, checked against the live index to avoid collisions. */
export async function generateTenderId(): Promise<string> {
  const year = new Date().getFullYear();
  const entries = await readIndex();
  const thisYear = entries.filter(e => e.id.startsWith(`TND-${year}-`));
  const next = thisYear.length + 1;
  let candidate = `TND-${year}-${String(next).padStart(3, '0')}`;
  // Guard against rare collision (e.g. concurrent creation) by scanning forward.
  const taken = new Set(entries.map(e => e.id));
  let bump = next;
  while (taken.has(candidate)) {
    bump += 1;
    candidate = `TND-${year}-${String(bump).padStart(3, '0')}`;
  }
  return candidate;
}

// -- Derived helpers used by the UI -----------------------------------

export function computeQualificationSummary(q: TenderRecord['qualification']) {
  const all = [...q.general, ...q.technical];
  const met = all.filter(i => i.met === 'yes').length;
  const unmet = all.filter(i => i.met === 'no').length;
  const unverified = all.filter(i => i.met === 'unverified').length;
  return { total: all.length, met, unmet, unverified };
}

export function computeScoreSummary(q: TenderRecord['qualification']) {
  if (q.tenderMode !== 'scored') return null;
  const all = [...q.general, ...q.technical];
  const maxTotal = all.reduce((sum, i) => sum + (i.maxMarks ?? 0), 0);
  return { maxTotal, itemCount: all.length };
}
