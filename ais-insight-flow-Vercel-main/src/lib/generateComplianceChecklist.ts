/**
 * generateComplianceChecklist.ts
 * â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 * Reads the RFP and extracts mandatory requirements as a checklist.
 * Warns all approvers of unmet items. Never blocks submission.
 *
 * Long RFPs are split into overlapping chunks (chunkDocument) so
 * requirements stated deep in the document â€” e.g. legal/disqualification
 * clauses near the end â€” aren't missed just because they fall past a
 * fixed truncation point. See chunkDocument.ts for details.
 * â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 */

import { callLLM } from '@/lib/llmClient';
import { chunkDocument } from '@/lib/chunkDocument';

export interface ComplianceItem {
  id:          string;
  category:    'References' | 'Validity' | 'Guarantee' | 'Submission' | 'Pricing' | 'Legal' | 'Team' | 'Other';
  requirement: string;   // What the RFP requires
  value?:      string;   // Extracted specific value e.g. "5 references", "60 days"
  met:         boolean;  // Pre-sales marks this
  notes:       string;   // How AIS addresses it
  severity:    'critical' | 'major' | 'minor';
}

export interface ComplianceChecklist {
  rfpTitle:       string;
  extractedAt:    string;
  items:          ComplianceItem[];
  overallStatus:  'compliant' | 'partial' | 'non-compliant';
  /** True only if EVERY chunk's extraction call failed â€” items will be empty.
   *  Distinguishes "extraction failed" from "RFP genuinely has no mandatory
   *  requirements" (rare, but items: [] with extractionFailed: false is valid). */
  extractionFailed?: boolean;
}

// â”€â”€ Category colours for UI â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const COMPLIANCE_COLORS: Record<ComplianceItem['category'], string> = {
  References:  'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
  Validity:    'bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-300',
  Guarantee:   'bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-300',
  Submission:  'bg-purple-50 text-purple-700 dark:bg-purple-950 dark:text-purple-300',
  Pricing:     'bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300',
  Legal:       'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300',
  Team:        'bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300',
  Other:       'bg-slate-50 text-slate-700 dark:bg-slate-950 dark:text-slate-300',
};

export const SEVERITY_COLORS = {
  critical: 'text-destructive',
  major:    'text-warning',
  minor:    'text-muted-foreground',
};

const VALID_CATEGORIES = ['References', 'Validity', 'Guarantee', 'Submission', 'Pricing', 'Legal', 'Team', 'Other'];
const VALID_SEVERITIES = ['critical', 'major', 'minor'];

interface RawComplianceItem {
  category?: string;
  requirement?: string;
  value?: string;
  severity?: string;
}

function buildPrompt(rfpExcerpt: string, clientName: string, chunkLabel: string): string {
  return `You are a SAP proposal compliance analyst. Read the RFP excerpt below${chunkLabel} and extract ALL mandatory requirements the proposer must meet or address in their submission.

CLIENT: ${clientName}

Focus on:
1. Reference requirements (min count, recency, contact info required)
2. Proposal validity period (min days)
3. Performance/bank guarantees (%, timeline, bank location)
4. Submission format (copies, envelopes, deadline, format)
5. Per-item pricing requirements (specific line items)
6. Legal requirements (governing law, insurance, certifications required)
7. Team/CV requirements (named staff, CVs, certifications, min experience)
8. Any other mandatory must-comply items

For each item extract the specific value if stated (e.g. "5 references", "60 days", "10%").
Severity: critical = disqualification if missing, major = scoring impact, minor = nice to have.

IMPORTANT: this may be one part of a larger document split into sections. Only extract what THIS excerpt actually states â€” do not assume the rest of the document is empty just because this excerpt doesn't mention something.

Return ONLY valid compact JSON, no markdown:
{"rfpTitle":"short title","items":[{"category":"References","requirement":"exact requirement text","value":"extracted value if any","severity":"critical"}]}

If this excerpt has no mandatory requirements, return {"rfpTitle":"...","items":[]}.

RFP EXCERPT${chunkLabel}:
${rfpExcerpt}`;
}

/** Extracts compliance items from a single chunk. Returns null on failure
 *  (distinct from "succeeded but found nothing", which returns an empty array) â€”
 *  callers use this to detect total-failure vs genuine absence. */
async function extractChecklistFromChunk(
  rfpExcerpt: string,
  clientName: string,
  chunkLabel: string
): Promise<{ rfpTitle: string; items: RawComplianceItem[] } | null> {
  try {
    const { content } = await callLLM(
      [{ role: 'user', content: buildPrompt(rfpExcerpt, clientName, chunkLabel) }],
      { temperature: 0.1, max_tokens: 2000 }
    );

    const cleaned = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end === -1) throw new Error('No JSON');

    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    return {
      rfpTitle: String(parsed.rfpTitle ?? ''),
      items: Array.isArray(parsed.items) ? parsed.items : [],
    };
  } catch {
    return null;
  }
}

/** Dedupes merged items by normalized requirement text, since chunk overlap
 *  can cause the same requirement to be extracted from two adjacent chunks. */
function dedupeByRequirement(items: RawComplianceItem[]): RawComplianceItem[] {
  const seen = new Set<string>();
  const deduped: RawComplianceItem[] = [];
  for (const item of items) {
    const key = String(item.requirement ?? '').trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
}

// â”€â”€ Extract checklist from RFP â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export async function generateComplianceChecklist(
  rfpRawText: string,
  clientName: string,
): Promise<ComplianceChecklist> {
  const chunks = chunkDocument(rfpRawText);

  const chunkResults = await Promise.all(
    chunks.map(chunk =>
      extractChecklistFromChunk(
        chunk.text,
        clientName,
        chunk.total > 1 ? ` (excerpt ${chunk.index + 1} of ${chunk.total})` : ''
      )
    )
  );

  const successfulResults = chunkResults.filter((r): r is { rfpTitle: string; items: RawComplianceItem[] } => r !== null);

  if (successfulResults.length === 0) {
    // Every chunk's call failed â€” surface this honestly rather than
    // returning generic placeholder items that would look like real findings.
    return {
      rfpTitle: clientName,
      extractedAt: new Date().toISOString(),
      overallStatus: 'partial',
      items: [],
      extractionFailed: true,
    };
  }

  const rfpTitle = successfulResults.find(r => r.rfpTitle.trim())?.rfpTitle.trim() || clientName;
  const rawItems = dedupeByRequirement(successfulResults.flatMap(r => r.items))
    .filter(i => String(i.requirement ?? '').trim());

  const items: ComplianceItem[] = rawItems.map((i, idx) => ({
    id:          `C${idx + 1}`,
    category:    VALID_CATEGORIES.includes(i.category ?? '') ? (i.category as ComplianceItem['category']) : 'Other',
    requirement: String(i.requirement).trim(),
    value:       i.value ? String(i.value).trim() : undefined,
    met:         false,
    notes:       '',
    severity:    VALID_SEVERITIES.includes(i.severity ?? '') ? (i.severity as ComplianceItem['severity']) : 'major',
  }));

  return {
    rfpTitle,
    extractedAt: new Date().toISOString(),
    items,
    overallStatus: 'partial',
    extractionFailed: false,
  };
}

// â”€â”€ Compute overall status from items â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export function computeComplianceStatus(items: ComplianceItem[]): ComplianceChecklist['overallStatus'] {
  const unmetCritical = items.filter(i => i.severity === 'critical' && !i.met).length;
  const unmetMajor    = items.filter(i => i.severity === 'major'    && !i.met).length;
  if (unmetCritical > 0) return 'non-compliant';
  if (unmetMajor    > 0) return 'partial';
  return 'compliant';
}

// â”€â”€ Build warning message for approvers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export function buildComplianceWarning(checklist: ComplianceChecklist): string | null {
  const unmet = checklist.items.filter(i => !i.met);
  if (unmet.length === 0) return null;

  const critical = unmet.filter(i => i.severity === 'critical');
  const major    = unmet.filter(i => i.severity === 'major');

  const lines = [`Compliance Warning â€” ${checklist.rfpTitle}:`];
  if (critical.length > 0) {
    lines.push(`${critical.length} CRITICAL item(s) not yet addressed:`);
    critical.forEach(i => lines.push(`  â€¢ [${i.category}] ${i.requirement}${i.value ? ` (${i.value})` : ''}`));
  }
  if (major.length > 0) {
    lines.push(`${major.length} major item(s) not yet addressed:`);
    major.forEach(i => lines.push(`  â€¢ [${i.category}] ${i.requirement}${i.value ? ` (${i.value})` : ''}`));
  }
  lines.push('These are warnings only â€” pre-sales should confirm each item is addressed before final approval.');
  return lines.join('\n');
}
