/**
 * extractAnnexures.ts
 * ─────────────────────────────────────────────────────────────────
 * Detects annexures/formats the tender document requires bidders to
 * submit, and classifies each one so the Submission page knows how
 * to render it:
 *   - fill_form      → a fixed-format form/affidavit/undertaking the
 *                       RFP provides verbatim; AIS fills in the blanks.
 *   - data_table      → a table AIS must compile itself (e.g. list of
 *                       similar projects, key personnel).
 *   - checklist_only  → a third-party/static document AIS must attach
 *                       (e.g. CA certificate, incorporation certificate)
 *                       — nothing to draft, just confirm it's ready.
 * ─────────────────────────────────────────────────────────────────
 */

import { callLLM } from '@/lib/llmClient';
import { chunkDocument } from '@/lib/chunkDocument';
import type { AnnexureItem, AnnexureKind } from '@/lib/tenderEngine';

const VALID_KINDS: AnnexureKind[] = ['fill_form', 'data_table', 'checklist_only'];

function cleanJson(raw: string): string {
  const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON object found in model output');
  return cleaned.slice(start, end + 1);
}

function sanitizeAnnexure(raw: any, idx: number): AnnexureItem {
  const kind: AnnexureKind = VALID_KINDS.includes(raw?.kind) ? raw.kind : 'checklist_only';
  return {
    id: String(raw?.id ?? `ANX${idx + 1}`),
    name: String(raw?.name ?? '').trim() || `Annexure ${idx + 1}`,
    kind,
    sourceFormat: raw?.sourceFormat ? String(raw.sourceFormat).trim() : undefined,
    filledContent: '',
    status: 'pending',
  };
}

async function extractAnnexuresFromChunk(chunkText: string, chunkLabel: string): Promise<AnnexureItem[]> {
  const prompt = `You are identifying every ANNEXURE, FORMAT, FORM, SCHEDULE, or ATTACHMENT that the tender document below${chunkLabel} explicitly requires bidders to submit as part of their bid.

Only list annexures/formats EXPLICITLY named or described in this excerpt. Do NOT invent standard annexures that are not mentioned. If genuinely none are found in this excerpt, return an empty array — other excerpts from the same document may contain them.

Classify each one as "kind":
- "fill_form" - the document provides a fixed format/template (e.g. "Annexure A: Bid Letter Format", affidavit format, undertaking format) that AIS must fill in and sign. If the format text itself appears in the document, copy it into "sourceFormat" (verbatim, trimmed to essentials, max 400 words).
- "data_table" - AIS must compile a table of its own data (e.g. List of Similar Projects Executed, List of Key Personnel, Manufacturer's Authorisation List) - no template format is given, just a data requirement.
- "checklist_only" - a third-party or static document AIS must simply attach/produce (e.g. CA certificate for turnover, audited financial statements, certificate of incorporation, PAN/GST/registration copies) - nothing to draft.

Return ONLY valid compact JSON, no markdown, no commentary:
{"annexures":[{"id":"ANX1","name":"Annexure A - Bid Letter Format","kind":"fill_form","sourceFormat":"verbatim format text if applicable, else omit"}]}

TENDER DOCUMENT${chunkLabel}:
${chunkText}`;

  try {
    const { content } = await callLLM(
      [{ role: 'user', content: prompt }],
      { temperature: 0.0, max_tokens: 3000 }
    );
    const parsed = JSON.parse(cleanJson(content));
    const list = Array.isArray(parsed.annexures) ? parsed.annexures : [];
    return list.map((item: any, idx: number) => sanitizeAnnexure(item, idx));
  } catch (err) {
    // Extraction failure for this chunk - return empty rather than fabricating
    // annexures that may not apply to this tender. Logged so failures are visible
    // in the console instead of silently disappearing.
    console.error(`[extractAnnexures] Chunk extraction failed${chunkLabel}:`, err);
    return [];
  }
}

/** Dedupes annexures across chunks by name (case-insensitive, trimmed) — overlapping
 * chunk windows can cause the same annexure to be detected in two adjacent chunks. */
function dedupeAnnexures(items: AnnexureItem[]): AnnexureItem[] {
  const seen = new Set<string>();
  const deduped: AnnexureItem[] = [];
  for (const item of items) {
    const key = item.name.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
}

export async function extractAnnexures(rfpRawText: string): Promise<AnnexureItem[]> {
  const chunks = chunkDocument(rfpRawText);

  const perChunkResults = await Promise.all(
    chunks.map(chunk =>
      extractAnnexuresFromChunk(
        chunk.text,
        chunk.total > 1 ? ` (excerpt ${chunk.index + 1} of ${chunk.total})` : ''
      )
    )
  );

  return dedupeAnnexures(perChunkResults.flat());
}