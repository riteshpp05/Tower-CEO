/**
 * mergeRfpFields.ts
 * ─────────────────────────────────────────────────────────────────
 * Pure merge logic for combining multiple extracted-field JSON
 * objects from an RFP into one. Mirrors the per-field merge rules
 * already used by NewProposalPage's mergeRfpData (single-value
 * fields: first non-empty wins; array fields: dedupe-union;
 * free-text fields: newline-concatenate) — but as a standalone
 * function with no React state dependency, so it can be used to
 * merge results across document CHUNKS inside parseSingleFile,
 * not just across separate uploaded FILES.
 *
 * Two merge layers exist in this app and they compose:
 *   1. Per-chunk merge (this file) — combines N chunks of ONE large
 *      document into one field set, used inside parseSingleFile.
 *   2. Per-file merge (mergeRfpData in NewProposalPage.tsx) — combines
 *      results from MULTIPLE uploaded files into the form, unchanged.
 * ─────────────────────────────────────────────────────────────────
 */

// Fields that should newline-concatenate across chunks/files rather than
// "first non-empty wins" — these are narrative/list-like fields where a
// long document plausibly states relevant content in more than one place.
const CONCAT_FIELDS = [
  'integrationReqs',
  'clientPainPoints',
  'mandatoryDeliverables',
  'mandatoryLegalClauses',
  'dependencyRisks',
  'deliveryAssumptions',
  'exclusions',
] as const;

// Fields that are arrays and should dedupe-union rather than overwrite.
const ARRAY_FIELDS = ['modules'] as const;

function str(v: unknown): string {
  return v == null ? '' : String(v);
}

/**
 * Merges an array of extracted-field objects (e.g. one per document chunk)
 * into a single object, applying the same per-field rules as mergeRfpData:
 *   - CONCAT_FIELDS: newline-joined, skipping empty/duplicate values
 *   - ARRAY_FIELDS: deduped union
 *   - everything else: first non-empty value wins (earlier chunks take
 *     priority, since most RFPs front-load identity/classification fields
 *     like clientName, opportunityType, geography near the start)
 */
export function mergeRfpFieldSets(results: Record<string, unknown>[]): Record<string, unknown> {
  if (results.length === 0) return {};
  if (results.length === 1) return results[0];

  const merged: Record<string, unknown> = {};
  const allKeys = new Set<string>();
  results.forEach(r => Object.keys(r).forEach(k => allKeys.add(k)));

  for (const key of allKeys) {
    if ((CONCAT_FIELDS as readonly string[]).includes(key)) {
      const parts = results
        .map(r => str(r[key]).trim())
        .filter(Boolean);
      // Dedupe exact-duplicate lines (common with overlapping chunk windows)
      const seen = new Set<string>();
      const deduped = parts.filter(p => {
        const k = p.toLowerCase();
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      merged[key] = deduped.join('\n');
      continue;
    }

    if ((ARRAY_FIELDS as readonly string[]).includes(key)) {
      const allValues = results.flatMap(r => (Array.isArray(r[key]) ? (r[key] as unknown[]).map(String) : []));
      merged[key] = [...new Set(allValues)];
      continue;
    }

    // Default: first non-empty value wins
    const firstNonEmpty = results.find(r => str(r[key]).trim().length > 0);
    merged[key] = firstNonEmpty ? firstNonEmpty[key] : results[0][key];
  }

  return merged;
}