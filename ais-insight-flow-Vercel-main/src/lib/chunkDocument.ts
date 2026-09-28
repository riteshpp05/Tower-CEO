/**
 * chunkDocument.ts
 * ─────────────────────────────────────────────────────────────────
 * Splits long documents into overlapping windows sized to fit
 * comfortably inside Qwen2.5's context window, so extraction never
 * silently misses content that falls past a fixed truncation point.
 *
 * Why this exists: a real tender can run 50-150+ pages
 * (~150,000-400,000 characters). A naive slice(0, N) truncation —
 * the previous approach — only ever sees the first few pages, so
 * anything later (e.g. "Current Systems" on page 15 of a 71-page
 * tender) gets reported as "not found" even though it's clearly in
 * the document. That's worse than no zero-hallucination guard at
 * all, because it looks authoritative while being wrong.
 *
 * Approach:
 *   - If the whole document fits in one window, return it as a
 *     single chunk — this is the common case and costs exactly one
 *     LLM call, same as before.
 *   - If it doesn't fit, split into overlapping windows. Overlap
 *     ensures a field whose supporting text straddles a window
 *     boundary still appears whole in at least one chunk.
 * ─────────────────────────────────────────────────────────────────
 */

// Qwen2.5 supports a 32K-token context. Conservative chars-per-token
// estimate for English/mixed text is ~3.5. We reserve headroom for the
// guard preamble, instructions, and JSON output tokens, so the budget
// here is intentionally well under the theoretical max.
const CHARS_PER_TOKEN_ESTIMATE = 3.5;
const CONTEXT_BUDGET_TOKENS = 24000; // leaves ~8K tokens for prompt scaffolding + output
export const MAX_CHUNK_CHARS = Math.floor(CONTEXT_BUDGET_TOKENS * CHARS_PER_TOKEN_ESTIMATE); // ~84,000 chars

// Overlap between consecutive chunks, so content near a boundary isn't split.
const CHUNK_OVERLAP_CHARS = 4000;

export interface DocumentChunk {
  index: number;
  total: number;
  text: string;
}

/**
 * Splits text into overlapping chunks. Returns a single chunk if the
 * text already fits within MAX_CHUNK_CHARS.
 */
export function chunkDocument(text: string, maxChunkChars: number = MAX_CHUNK_CHARS): DocumentChunk[] {
  if (text.length <= maxChunkChars) {
    return [{ index: 0, total: 1, text }];
  }

  const step = maxChunkChars - CHUNK_OVERLAP_CHARS;
  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + maxChunkChars, text.length);
    chunks.push(text.slice(start, end));
    if (end === text.length) break;
    start += step;
  }

  return chunks.map((chunkText, index) => ({ index, total: chunks.length, text: chunkText }));
}

/**
 * Merges extracted-item arrays from multiple chunks into one deduplicated
 * list. Items are deduped by sourceQuote (case-insensitive, trimmed) since
 * overlapping chunk windows can cause the same fact to be extracted twice.
 * "not_found" placeholder items are dropped if ANY chunk found a real item
 * for that category — a real hit from one chunk always beats a "not found"
 * from another, since the latter just means that particular chunk didn't
 * contain the answer, not that the document lacks it.
 */
export function mergeExtractedLists<T extends { sourceQuote: string; confidence: string; value: string }>(
  lists: T[][]
): T[] {
  const all = lists.flat();
  const realItems = all.filter(item => item.confidence !== 'not_found');

  if (realItems.length === 0) {
    // Nothing found in any chunk — return the first not_found placeholder, if any.
    return all.length > 0 ? [all[0]] : [];
  }

  const seen = new Set<string>();
  const deduped: T[] = [];
  for (const item of realItems) {
    const key = (item.sourceQuote || item.value).trim().toLowerCase();
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    deduped.push(item);
  }
  return deduped;
}