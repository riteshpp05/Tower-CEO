/**
 * pricingCalculator.ts
 * ─────────────────────────────────────────────────────────────────
 * Uses APNJ-LLM-Studio (Gemma, default profile) to compute a
 * suggestive price from selected resources, period, and business rules.
 *
 * Rate cards come from resource profiles selected in Step 3 —
 * NOT from a separate rate master.
 * ─────────────────────────────────────────────────────────────────
 */

import { callLLM, type LLMEndpoint } from '@/lib/llmClient';

// ── Types ──────────────────────────────────────────────────────────────────────

export type CostBasis = 'marginal' | 'absorption' | 'utilisation-adjusted';

/** One resource selected by the inputter in Step 3 */
export interface SelectedResource {
  roleId:      string;
  role:        string;
  hours:       number;
  billingRate: number;   // per hour, from resource profile
  costRate:    number;   // per hour, from resource profile
  loadedCostRate:       number;
  effectiveCostRate:    number;
  effectiveLoadedCostRate: number;
  locationType: string; // Offshore | Onsite | Hybrid
  geography:   string;
}

/** A hardware/infrastructure or other-cost line item (manual or AI-generated) */
export interface CostLineItem {
  id:        string;
  category:  'hardware' | 'other';
  item:      string;   // description, e.g. "App Server (prod)", "SAP S/4HANA License"
  qty:       number;
  unitCost:  number;   // cost per unit
  marginPct: number;   // markup % applied to get billing
  notes?:    string;
}

export interface ScopeInput {
  opportunityName:      string;
  clientName:           string;
  geography:            string;
  industry:             string;
  opportunityType:      string;
  modules:              string[];
  projectType:          string;
  implementationModel:  string;
  integrationReqs:      string;
  customDevScope:       string;
  supportWindow:        string;
  slaReqs:              string;
  clientPainPoints:     string;
  mandatoryDeliverables: string;
  securityCompliance:   string;
  expectedDuration:     string;
  dealType:             string;
  currency:             string;
  costBasis:            CostBasis;
  /** 'ai' = AI estimates the full plan; 'manual' = user provides everything, AI explains only */
  mode?:                'ai' | 'manual';
  /** Raw text extracted from uploaded RFP documents — used for form field parsing */
  rfpRawText?:          string;
  /** Session UUID generated at RFP upload time — used to filter RAG queries to this proposal's docs */
  rfpSessionId?:        string;
  /** Pre-selected resources from Step 3 Resource Picker */
  selectedResources:    SelectedResource[];
  /** Manual hardware/other cost lines (manual mode, or AI-mode after user edits) */
  costLines?:           CostLineItem[];
}

export interface CostLineRow {
  id:          string;
  category:    'hardware' | 'other';
  item:        string;
  qty:         number;
  unitCost:    number;
  marginPct:   number;
  lineCost:    number;     // qty × unitCost
  lineRevenue: number;     // lineCost × (1 + marginPct/100)
}

export interface PricingBreakdownRow {
  roleId:       string;
  role:         string;
  hours:        number;
  billingRate:  number;
  costRate:     number;  // depends on chosen basis
  lineRevenue:  number;  // hours × billingRate
  lineCost:     number;  // hours × costRate (basis-dependent)
  lineMargin:   number;  // percentage
}

export interface BusinessRuleApplied {
  ruleId:       string;
  rule:         string;
  adjustment:   string;
  impact:       string;
}

export interface PricingResult {
  // Per-resource breakdown
  breakdown:          PricingBreakdownRow[];
  // Hardware + other cost lines
  costLines:          CostLineRow[];
  // Section subtotals
  resourceRevenue:    number;
  resourceCost:       number;
  hardwareRevenue:    number;
  hardwareCost:       number;
  otherRevenue:       number;
  otherCost:          number;
  // Grand totals (resources + hardware + other)
  totalRevenue:       number;
  totalCost:          number;
  grossMarginPct:     number;
  // Three scenarios
  scenarioBase:       number;  // recommended price
  scenarioStretch:    number;  // conservative — higher price, better margin
  scenarioAggressive: number;  // push pricing — lower margin
  // AI output
  aiSuggestedPrice:   number;
  aiRationale:        string;  // shown to inputter and Finance approver
  rulesApplied:       BusinessRuleApplied[];
  finalMarginPct:     number;  // margin at the suggested price
  // Override
  finalPrice:         number | null;  // null = use AI suggestion; set when inputter overrides
  overrideJustification: string;
  // Meta
  costBasis:          CostBasis;
  currency:           string;
  endpoint:           LLMEndpoint;
}

// ── Cost rate selector based on chosen basis ────────────────────────────────────
function getEffectiveCostRate(resource: SelectedResource, basis: CostBasis): number {
  switch (basis) {
    case 'marginal':              return resource.costRate;
    case 'absorption':            return resource.loadedCostRate;
    case 'utilisation-adjusted':  return resource.effectiveLoadedCostRate;
  }
}

// ── Compute numeric breakdown (no AI needed) ────────────────────────────────────
function computeBreakdown(
  resources: SelectedResource[],
  basis: CostBasis
): { rows: PricingBreakdownRow[]; totalRevenue: number; totalCost: number; grossMarginPct: number } {
  let totalRevenue = 0;
  let totalCost    = 0;

  const rows: PricingBreakdownRow[] = resources.map(r => {
    const costRate    = getEffectiveCostRate(r, basis);
    const lineRevenue = r.hours * r.billingRate;
    const lineCost    = r.hours * costRate;
    const lineMargin  = lineRevenue > 0
      ? Math.round(((lineRevenue - lineCost) / lineRevenue) * 100)
      : 0;

    totalRevenue += lineRevenue;
    totalCost    += lineCost;

    return {
      roleId: r.roleId, role: r.role, hours: r.hours,
      billingRate: r.billingRate, costRate,
      lineRevenue: Math.round(lineRevenue),
      lineCost:    Math.round(lineCost),
      lineMargin,
    };
  });

  const grossMarginPct = totalRevenue > 0
    ? Math.round(((totalRevenue - totalCost) / totalRevenue) * 100)
    : 0;

  return {
    rows,
    totalRevenue: Math.round(totalRevenue),
    totalCost:    Math.round(totalCost),
    grossMarginPct,
  };
}

// ── Compute hardware/other cost line subtotals (no AI needed) ───────────────────
function computeCostLines(lines: CostLineItem[] = []) {
  const rows: CostLineRow[] = lines.map(l => {
    const lineCost    = l.qty * l.unitCost;
    const lineRevenue = lineCost * (1 + l.marginPct / 100);
    return {
      id: l.id, category: l.category, item: l.item, qty: l.qty,
      unitCost: l.unitCost, marginPct: l.marginPct,
      lineCost: Math.round(lineCost),
      lineRevenue: Math.round(lineRevenue),
    };
  });
  const sum = (cat: 'hardware' | 'other', field: 'lineCost' | 'lineRevenue') =>
    rows.filter(r => r.category === cat).reduce((s, r) => s + r[field], 0);
  return {
    rows,
    hardwareCost:    sum('hardware', 'lineCost'),
    hardwareRevenue: sum('hardware', 'lineRevenue'),
    otherCost:       sum('other', 'lineCost'),
    otherRevenue:    sum('other', 'lineRevenue'),
  };
}

// ── Deterministic rule-based price computation (NO AI) ──────────────────────────
/**
 * Computes the suggested price in CODE by applying business rules to the real
 * resource total. The LLM never invents the number — it only explains this result.
 * Returns the final price plus a structured list of exactly which rules moved it.
 */
function computeRuleBasedPrice(
  totalRevenue: number,
  totalCost: number,
  grossMarginPct: number,
  businessRules: { id: string; rule: string; value: string }[],
): { price: number; applied: BusinessRuleApplied[] } {
  let price = totalRevenue;
  const applied: BusinessRuleApplied[] = [];
  const pctOf = (v: string) => { const n = parseFloat(String(v).replace('%', '')); return isNaN(n) ? null : n; };

  for (const r of businessRules) {
    const name = r.rule.toLowerCase();

    // 1. Minimum gross margin floor — raise price if below threshold
    if (name.includes('margin') && (name.includes('min') || name.includes('floor') || name.includes('threshold'))) {
      const minMargin = pctOf(r.value);
      if (minMargin !== null && grossMarginPct < minMargin) {
        const before = price;
        // price needed so that (price - cost) / price = minMargin  ->  price = cost / (1 - margin)
        price = Math.round(totalCost / (1 - minMargin / 100));
        applied.push({
          ruleId: r.id, rule: r.rule,
          adjustment: `Raised price to meet ${minMargin}% minimum margin (was ${grossMarginPct}%)`,
          impact: `+${(price - before).toLocaleString()}`,
        });
      } else if (minMargin !== null) {
        applied.push({
          ruleId: r.id, rule: r.rule,
          adjustment: `No change - current margin ${grossMarginPct}% already meets ${minMargin}% floor`,
          impact: `0`,
        });
      }
    }

    // 2. Fixed-price contingency — add a buffer
    else if (name.includes('contingency')) {
      const pct = pctOf(r.value);
      if (pct !== null) {
        const add = Math.round(price * (pct / 100));
        price += add;
        applied.push({
          ruleId: r.id, rule: r.rule,
          adjustment: `Added ${pct}% contingency buffer`,
          impact: `+${add.toLocaleString()}`,
        });
      }
    }
  }

  return { price: Math.round(price), applied };
}

// ── AI: estimate resources — prioritise named pool, identify gaps ───────────────
export interface ResourceEstimateResult {
  /** Named consultants from the resource pool the AI recommends */
  consultants: { dbId: string; hours: number; reason: string }[];
  /** Rate-card roles the AI needs that aren't covered by named consultants */
  gapRoles: { roleId: string; hours: number; reason: string }[];
}

/**
 * Resource estimation — two-pool approach, RFP-first, modules never used as filter.
 *
 * Pool A — Real people (DbResource): matched on skills, experience, certifications,
 *           bio, key_projects vs what the RFP/scope asks for.
 * Pool B — Rate-card roles (anonymous): gap-fill only, shown without name.
 *
 * Context priority:
 *   1. rfpRawText (primary — extracted from uploaded RFP, tables included)
 *   2. callRAG enrichment (past SoWs / KB docs in ChromaDB, if any indexed)
 *   3. Scope fields (always present — fallback when no RFP uploaded)
 */
export async function generateResourceEstimate(
  scope: ScopeInput,
  availableRoles: { id: string; skill: string; roleLevel: string; locationType: string; billingRate: number; geography: string }[],
  namedResources: {
    id: string; name: string; designation: string;
    sap_modules: string[]; skills: string[];
    geography: string; availability: string; years_of_experience: number;
    certifications?: string[]; languages?: string[]; employment_type?: string;
    billing_rate?: number; bio?: string | null; profile_summary?: string | null;
    key_projects?: string[];
  }[] = []
): Promise<ResourceEstimateResult> {

  // ── 1. Build primary context ─────────────────────────────────────────────────
  // RFP text is the primary signal. Truncate to 3000 chars — enough to capture
  // team/skills sections without blowing the context window.
  const rfpSection = scope.rfpRawText?.trim()
    ? [
        '=== RFP / CLIENT REQUIREMENT (PRIMARY SOURCE) ===',
        scope.rfpRawText.slice(0, 1500),
        '=== END RFP ===',
      ].join('\n')
    : '';

  // ── 2. RAG enrichment — query THIS proposal's indexed RFP documents ────────
  // Uses rfpSessionId to filter ChromaDB to only this proposal's chunks.
  // Falls back to empty if no session ID or RAG unavailable.
  let ragSection = '';
  try {
    const { queryRfpContext } = await import('@/lib/llmClient');
    if (scope.rfpSessionId) {
      const ragText = await queryRfpContext(
        'What roles, skills, experience levels, certifications, team structure and resource requirements are needed?',
        scope.rfpSessionId,
        'resources'
      );
      if (ragText.trim()) {
        ragSection = [
          '=== RFP RESOURCE REQUIREMENTS (from indexed document) ===',
          ragText.slice(0, 800),
          '=== END ===',
        ].join('\n');
      }
    }
  } catch {
    // RAG unavailable — continue without it
  }

  // ── 3. Scope fallback (always present) ───────────────────────────────────────
  const scopeSection = [
    `Engagement   : ${scope.opportunityName} for ${scope.clientName}`,
    `Type         : ${scope.opportunityType || 'SAP Implementation'}`,
    `Geography    : ${scope.geography}`,
    `Duration     : ${scope.expectedDuration || 'not specified'}`,
    `Impl. Model  : ${scope.implementationModel || 'not specified'}`,
    `Deliverables : ${scope.mandatoryDeliverables || 'standard SAP deliverables'}`,
    `Pain Points  : ${scope.clientPainPoints || 'not specified'}`,
    `Integration  : ${scope.integrationReqs || 'standard'}`,
    `Custom Dev   : ${scope.customDevScope || 'minimal'}`,
    `SLA / Support: ${scope.slaReqs || 'standard'} | ${scope.supportWindow || ''}`,
    `Security     : ${scope.securityCompliance || 'standard'}`,
  ].join('\n');

  // ── 4. Build Pool A — full consultant profiles (no geography/module filter) ──
  // Send all fields except email, phone, cost_rate (internal).
  // The LLM uses skills, certs, bio, key_projects to match RFP requirements.
  const consultantList = namedResources.length > 0
    ? namedResources.map((r, i) => {
        const parts = [
          `C${i + 1}`,
          `DB_ID="${r.id}"`,
          r.name,
          r.designation,
          `Exp:${r.years_of_experience}yr`,
          `Geography:${r.geography}`,
          `Availability:${r.availability}`,
          r.employment_type ? `Type:${r.employment_type}` : '',
          r.billing_rate ? `Rate:${r.billing_rate}/hr` : '',
          `Skills:${r.skills.join(', ')}`,
          `Modules:${r.sap_modules.join(', ')}`,
          r.certifications?.length ? `Certs:${r.certifications.join(', ')}` : '',
          r.languages?.length ? `Languages:${r.languages.join(', ')}` : '',
          // bio/summary/projects omitted — keep prompt under 8192 token ctx window
        ].filter(Boolean);
        return parts.join(' | ');
      }).join('\n')
    : 'No named consultants in resource pool.';

  // ── 5. Build Pool B — rate-card roles for gap-fill (no name, no individual) ──
  const roleList = availableRoles.length > 0
    ? availableRoles.map((r, i) =>
        `R${i + 1} | ROLE_ID="${r.id}" | ${r.skill} | ${r.roleLevel} | ${r.locationType} | ${r.geography} | ${r.billingRate}/hr`
      ).join('\n')
    : 'No rate-card roles available.';

  // ── 6. Build the prompt ───────────────────────────────────────────────────────
  const contextBlock = [rfpSection, ragSection, scopeSection]
    .filter(Boolean).join('\n\n');

  // ── Hour calculation guide based on AIS delivery model ─────────────────────
  // FTE model: 1 FTE = 22 working days/month = 176 hrs/month
  // Hours = FTE × duration_months × 176
  // Standard AIS role hours for S/4HANA migration (4-7 month delivery):
  //   Project Director (0.15 FTE × 7mo)   = 185 hrs
  //   Project Manager  (1.0 FTE × 7mo)    = 1232 hrs
  //   Solution Architect (0.75 FTE × 5mo) = 660 hrs
  //   Basis Lead (1.0 FTE × 7mo)          = 1232 hrs
  //   Functional Lead (1.0 FTE × 6mo)     = 1056 hrs
  //   Functional Consultant (0.75 × 5mo)  = 660 hrs
  //   ABAP Lead (0.75 FTE × 5mo)          = 660 hrs
  //   ABAP Developer (1.5 FTE × 5mo)      = 1320 hrs

  const deliveryMonths = (() => {
    const dur = (scope.expectedDuration || '').toLowerCase();
    const m = parseFloat(dur.match(/(\d+\.?\d*)\s*month/)?.[1] || '0');
    const w = parseFloat(dur.match(/(\d+\.?\d*)\s*week/)?.[1] || '0');
    return m > 0 ? m : w > 0 ? w / 4 : 5; // default 5 months if not specified
  })();

  // ── Build a focused, short prompt — Qwen2.5-7B Q4 works best under 2000 tokens input
  // Key principles:
  // 1. Scope first — give Qwen just enough context to understand the engagement
  // 2. Pool B (rate cards) always populated — even if modules not yet selected
  // 3. Pool A (named consultants) capped at 10 to keep prompt short
  // 4. MUST populate gapRoles from Pool B — not optional
  // 5. Simple JSON output format — no nested rules that confuse small models

  // Cap consultant list to top 10 most relevant — keep prompt short
  const cappedConsultants = namedResources.slice(0, 10);
  const cappedConsultantList = cappedConsultants.length > 0
    ? cappedConsultants.map((r, i) =>
        `C${i + 1} | DB_ID="${r.id}" | ${r.name} | ${r.designation} | ${r.years_of_experience}yr | ${r.sap_modules.slice(0,4).join(',')} | ${r.availability}`
      ).join('\n')
    : 'None';

  // Scope summary — short, under 300 chars
  const scopeSummary = [
    `Client: ${scope.clientName}`,
    `Type: ${scope.opportunityType || 'SAP Implementation'}`,
    `Modules: ${scope.modules?.join(', ') || 'FI, CO, MM, SD, BASIS'}`,
    `Duration: ${scope.expectedDuration || `${deliveryMonths} months`}`,
    scope.rfpRawText ? `RFP summary: ${scope.rfpRawText.slice(0, 300)}` : '',
  ].filter(Boolean).join(' | ');

  const prompt = `You are a SAP staffing expert. Select a delivery team for this engagement.

ENGAGEMENT: ${scopeSummary}

FTE MODEL: 1 FTE = ${deliveryMonths} months × 176 hrs = ${Math.round(deliveryMonths * 176)} hrs per FTE.

POOL A — Named Consultants (use the DB_ID exactly as shown in quotes):
${cappedConsultantList}

POOL B — Rate Card Roles (use the ROLE_ID exactly as shown in quotes):
${roleList}

INSTRUCTIONS:
- From POOL A: select consultants whose SAP modules match. Use the DB_ID string exactly as it appears after DB_ID= in the list above.
- From POOL B: select 5-7 roles needed for delivery. Use the ROLE_ID string exactly as it appears after ROLE_ID= in the list above.
- Hours per role = FTE × ${Math.round(deliveryMonths * 176)}. Full-time=that number, half-time=half, advisory=quarter.
- Reason: 2-3 words only.
- Output compact single-line JSON. No line breaks inside JSON. No explanation text.

Example of correct output format (use real IDs from lists above, not these examples):
{"consultants":[{"dbId":"abc-123","hours":880,"reason":"FI CO lead"}],"gapRoles":[{"roleId":"RC-007","hours":880,"reason":"project oversight"},{"roleId":"RC-001","hours":660,"reason":"solution design"}]}

Now output the JSON for this engagement:`;

  // ── 7. Call LLM + validate response ─────────────────────────────────────────
  try {
    const { content } = await callLLM(
      [{ role: 'user', content: prompt }],
      { temperature: 0.1, max_tokens: 1500 }
    );

    const cleaned = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    console.log('[generateResourceEstimate] Raw response:', cleaned.slice(0, 500));
    let jsonStr = cleaned;
    const start = jsonStr.indexOf('{');
    let end     = jsonStr.lastIndexOf('}');
    console.log('[generateResourceEstimate] JSON bounds: start=', start, 'end=', end, 'length=', jsonStr.length);
    if (start === -1) {
      console.warn('[generateResourceEstimate] No JSON object found in response');
      return { consultants: [], gapRoles: [] };
    }
    // If truncated (no closing }), attempt repair by closing open arrays/objects
    if (end === -1 || end < start) {
      jsonStr = jsonStr.slice(start);
      // Count open brackets to close them
      let openCurly  = 0, openSquare = 0;
      for (const ch of jsonStr) {
        if (ch === '{') openCurly++;
        else if (ch === '}') openCurly--;
        else if (ch === '[') openSquare++;
        else if (ch === ']') openSquare--;
      }
      // Remove trailing incomplete key-value pair
      const lastComma = jsonStr.lastIndexOf(',');
      const lastBrace = jsonStr.lastIndexOf('{');
      if (lastBrace > lastComma) jsonStr = jsonStr.slice(0, lastComma > 0 ? lastComma : jsonStr.length);
      // Close open structures
      jsonStr += ']'.repeat(Math.max(0, openSquare)) + '}'.repeat(Math.max(0, openCurly));
      end = jsonStr.lastIndexOf('}');
    }
    if (end === -1) return { consultants: [], gapRoles: [] };

    const parsed = JSON.parse(jsonStr.slice(start, end + 1)) as {
      consultants?: Array<{ dbId?: string; hours?: number; reason?: string }>;
      gapRoles?:    Array<{ roleId?: string; hours?: number; reason?: string }>;
    };

    // Build index maps: C1 → actual uuid, R1 → actual role id
    // LLM sometimes returns the index key instead of the full ID
    const consultantIndexMap: Record<string, string> = {};
    namedResources.forEach((r, i) => { consultantIndexMap[`C${i + 1}`] = r.id; });

    const roleIndexMap: Record<string, string> = {};
    availableRoles.forEach((r, i) => { roleIndexMap[`R${i + 1}`] = r.id; });

    const validDbIds   = new Set(namedResources.map(r => r.id));
    const validRoleIds = new Set(availableRoles.map(r => r.id));
    console.log('[generateResourceEstimate] validRoleIds:', [...validRoleIds].slice(0, 5));
    console.log('[generateResourceEstimate] validDbIds count:', validDbIds.size);
    console.log('[generateResourceEstimate] parsed gapRoles:', JSON.stringify(parsed.gapRoles?.slice(0,3)));

    // Resolve consultant ID — try: exact uuid → index key (C1) → strip DB_ID= prefix
    const resolveConsultantId = (raw: string): string | null => {
      if (validDbIds.has(raw)) return raw;
      if (consultantIndexMap[raw]) return consultantIndexMap[raw];
      const stripped = raw.replace(/^DB_ID=/i, '').replace(/^"/, '').replace(/"$/, '');
      if (validDbIds.has(stripped)) return stripped;
      return null;
    };

    // Resolve role ID — try: exact id → index key (R1) → strip ROLE_ID= prefix
    const resolveRoleId = (raw: string): string | null => {
      if (validRoleIds.has(raw)) return raw;
      if (roleIndexMap[raw]) return roleIndexMap[raw];
      const stripped = raw.replace(/^ROLE_ID=/i, '').replace(/^"/, '').replace(/"$/, '');
      if (validRoleIds.has(stripped)) return stripped;
      return null;
    };

    const consultants = (parsed.consultants ?? [])
      .map(c => {
        const resolvedId = c.dbId ? resolveConsultantId(c.dbId) : null;
        if (!resolvedId || Number(c.hours) <= 0) return null;
        return { dbId: resolvedId, hours: Math.round(Number(c.hours)), reason: c.reason ?? '' };
      })
      .filter((c): c is NonNullable<typeof c> => c !== null);

    const gapRoles = (parsed.gapRoles ?? [])
      .map(g => {
        const resolvedId = g.roleId ? resolveRoleId(g.roleId) : null;
        if (!resolvedId || Number(g.hours) <= 0) return null;
        return { roleId: resolvedId, hours: Math.round(Number(g.hours)), reason: g.reason ?? '' };
      })
      .filter((g): g is NonNullable<typeof g> => g !== null);

    // ── Fallback: if LLM returned nothing valid but roles exist,
    // auto-select top roles whose skill matches opportunityType keywords ─────
    if (consultants.length === 0 && gapRoles.length === 0 && availableRoles.length > 0) {
      const keywords = [
        scope.opportunityType, scope.mandatoryDeliverables,
        scope.integrationReqs, scope.customDevScope,
      ].join(' ').toLowerCase();

      const fallbackRoles = availableRoles
        .filter(r => keywords.includes(r.skill.toLowerCase().split(' ')[1] ?? ''))
        .slice(0, 6);

      const monthsMatch = scope.expectedDuration?.match(/(\d+)/);
      const months = monthsMatch ? parseInt(monthsMatch[1]) : 6;
      const baseHours = months * 160;

      return {
        consultants: [],
        gapRoles: fallbackRoles.map(r => ({
          roleId: r.id,
          hours: Math.round(baseHours * 0.15),
          reason: `Auto-selected: ${r.skill} required for ${scope.opportunityType || 'project'} (LLM returned no valid suggestions)`,
        })),
      };
    }

    return { consultants, gapRoles };

  } catch (err) {
    console.error('[generateResourceEstimate] Error:', err);
    return { consultants: [], gapRoles: [] };
  }
}

// ── AI: generate hardware + other cost line items from scope (AI mode only) ─────
/**
 * Asks the LLM to propose hardware/infra and other (licenses, travel, training)
 * cost line items based on the engagement scope. Returns structured CostLineItems.
 * Falls back to an empty list if the LLM is unavailable or returns bad JSON.
 */
export async function generateCostLines(scope: ScopeInput): Promise<CostLineItem[]> {
  // RFP context: use RAG query if session ID available, else fall back to raw text
  let rfpContext = '';
  try {
    if (scope.rfpSessionId) {
      const { queryRfpContext } = await import('@/lib/llmClient');
      const hwText = await queryRfpContext(
        'What hardware, servers, HCI, network equipment, storage, rack, infrastructure, software licenses, virtualization, OS, backup, travel, training costs are required?',
        scope.rfpSessionId,
        'hardware'
      );
      if (hwText.trim()) {
        rfpContext = `RFP CONTEXT (from indexed document — extract all costs):\n${hwText.slice(0, 2000)}`;
      }
    }
  } catch { /* RAG unavailable */ }
  if (!rfpContext && scope.rfpRawText) {
    rfpContext = `RFP CONTEXT (extract hardware/licenses/travel from this):\n${scope.rfpRawText.slice(0, 2000)}`;
  }

  const scopeContext = [
    `Engagement: ${scope.opportunityName} | Client: ${scope.clientName}`,
    `Geography: ${scope.geography} | Type: ${scope.opportunityType} | Duration: ${scope.expectedDuration}`,
    `Implementation: ${scope.implementationModel || 'Hybrid'} | Currency: ${scope.currency}`,
    `Integration: ${scope.integrationReqs || 'standard'} | Custom Dev: ${scope.customDevScope || 'none'}`,
  ].join('\n');

  const prompt = [
    rfpContext,
    '',
    scopeContext,
    '',
    'You are a SAP project cost estimator. List hardware and other costs for this engagement.',
    'Step 1: Extract EVERY hardware/server/infrastructure item from the RFP above.',
    'Step 2: Extract EVERY software license, SAP license, third-party tool from the RFP.',
    'Step 3: Extract travel, training, change management costs from the RFP.',
    'Step 4: Add up to 3 standard SAP project costs NOT already found.',
    '',
    'Output ONLY a JSON array. No text before or after. No markdown fences. Max 10 items.',
    'Each item: {"category":"hardware" or "other","item":"name","qty":1,"unitCost":number,"marginPct":number,"notes":"source"}',
    `unitCost in ${scope.currency}. marginPct 10-20 for hardware, 0-15 for other.`,
    '',
    'JSON array:',
  ].filter(Boolean).join('\n').trim();

  try {
    const { content } = await callLLM(
      [{ role: 'user', content: prompt }],
      { temperature: 0.15, max_tokens: 1000 }
    );
    const cleaned = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const start = cleaned.indexOf('[');
    const end   = cleaned.lastIndexOf(']');
    if (start === -1 || end === -1) return [];
    const parsed = JSON.parse(cleaned.slice(start, end + 1)) as Array<Partial<CostLineItem>>;
    return parsed
      .filter(p => p.item && (p.category === 'hardware' || p.category === 'other'))
      .map((p, i) => ({
        id:        `ai-${Date.now()}-${i}`,
        category:  p.category as 'hardware' | 'other',
        item:      String(p.item),
        qty:       Number(p.qty) || 1,
        unitCost:  Number(p.unitCost) || 0,
        marginPct: Number(p.marginPct) || 0,
        notes:     p.notes ? String(p.notes) : undefined,
      }));
  } catch {
    return []; // LLM offline or bad JSON — user can add manually
  }
}

// ── Main function ───────────────────────────────────────────────────────────────
export async function generatePricingEstimate(
  scope:         ScopeInput,
  businessRules: { id: string; rule: string; value: string }[],
  onEndpointResolved?: (ep: LLMEndpoint) => void
): Promise<PricingResult> {
  const { rows, totalRevenue: resourceRevenue, totalCost: resourceCost } = computeBreakdown(
    scope.selectedResources,
    scope.costBasis
  );

  // Hardware + other cost lines
  const cl = computeCostLines(scope.costLines);

  // Grand totals = resources + hardware + other
  const totalRevenue = resourceRevenue + cl.hardwareRevenue + cl.otherRevenue;
  const totalCost    = resourceCost + cl.hardwareCost + cl.otherCost;
  const grossMarginPct = totalRevenue > 0
    ? Math.round(((totalRevenue - totalCost) / totalRevenue) * 100)
    : 0;

  // ── Price is computed DETERMINISTICALLY here, not by the LLM ──
  const { price: computedPrice, applied: computedRules } = computeRuleBasedPrice(
    totalRevenue, totalCost, grossMarginPct, businessRules
  );
  const finalMarginPct = computedPrice > 0
    ? Math.round(((computedPrice - totalCost) / computedPrice) * 100)
    : 0;

  // Three scenarios derived from the COMPUTED price
  const scenarioBase       = computedPrice;
  const scenarioStretch    = Math.round(computedPrice * 1.08);
  const scenarioAggressive = Math.round(computedPrice * 0.95);

  // Build the resource summary for the prompt
  const resourceSummary = rows.map(r =>
    `  • ${r.role}: ${r.hours} hrs × ${scope.currency} ${r.billingRate}/hr = ${scope.currency} ${r.lineRevenue.toLocaleString()} revenue | margin ${r.lineMargin}%`
  ).join('\n');

  const costBasisLabel = {
    'marginal':             'Marginal Cost (direct cost only)',
    'absorption':           'Absorption Cost (direct + overhead loading)',
    'utilisation-adjusted': 'Utilisation-Adjusted Cost (absorption / utilisation rate)',
  }[scope.costBasis];

  const rulesAppliedText = computedRules.length > 0
    ? computedRules.map(r => `  • ${r.rule}: ${r.adjustment} (impact: ${r.impact})`).join('\n')
    : '  • No price-affecting rules applied — margin already compliant.';

  const rfpCtx = scope.rfpRawText
    ? `\nRFP CONTEXT (for reference when writing the rationale):\n${scope.rfpRawText.slice(0, 1500)}\n`
    : '';

  const prompt = `
You are a pricing analyst at a SAP consulting firm. The price below has ALREADY been
calculated by the system. Your ONLY job is to write a short, factual rationale explaining it.
Do NOT invent or change the price. Do NOT mention rules that are not in the "RULES ACTUALLY APPLIED" list.

ENGAGEMENT: ${scope.opportunityName} for ${scope.clientName}
GEOGRAPHY: ${scope.geography} | INDUSTRY: ${scope.industry}
DEAL TYPE: ${scope.dealType} | DURATION: ${scope.expectedDuration}
COST BASIS: ${costBasisLabel}
${rfpCtx}
CALCULATED FIGURES (do not change these):
  Resource Revenue (at billing rates): ${scope.currency} ${totalRevenue.toLocaleString()}
  Total Cost: ${scope.currency} ${totalCost.toLocaleString()}
  Raw Gross Margin: ${grossMarginPct}%
  >>> FINAL SUGGESTED PRICE: ${scope.currency} ${computedPrice.toLocaleString()} <<<
  Final Margin at suggested price: ${finalMarginPct}%

RULES ACTUALLY APPLIED (these are the ONLY rules you may reference):
${rulesAppliedText}

RESOURCE PLAN:
${resourceSummary}

Write your answer in this EXACT format:

RATIONALE:
[2-4 sentences. Explain ONLY the price of ${scope.currency} ${computedPrice.toLocaleString()}. Reference ONLY the rules in the "RULES ACTUALLY APPLIED" list above. State the final margin of ${finalMarginPct}%. Do NOT mention offshore ratios, sub-contractor floors, or any rule not listed above. Be factual and concise — this goes to Finance.]
`.trim();

  // ── LLM writes the RATIONALE only — price is already fixed by code ──────────────
  const aiSuggestedPrice = computedPrice;           // deterministic, never from LLM
  const rulesApplied     = computedRules;            // deterministic, never from LLM
  let aiRationale        = '';
  let endpoint: LLMEndpoint = 'unavailable';

  try {
    const result = await callLLM(
      [{ role: 'user', content: prompt }],
      { temperature: 0.2, max_tokens: 400, onEndpointResolved }
    );
    endpoint = result.endpoint;
    const rationaleMatch = result.content.match(/RATIONALE:\s*([\s\S]*)/i);
    aiRationale = (rationaleMatch ? rationaleMatch[1] : result.content)
      .replace(/RULES_APPLIED:[\s\S]*/i, '')
      .replace(/RISKS:[\s\S]*/i, '')
      .trim();
  } catch {
    onEndpointResolved?.('unavailable');
    // Offline: build factual rationale from the computed rules
    const ruleText = computedRules.length > 0
      ? computedRules.map(r => `${r.rule} (${r.adjustment})`).join('; ')
      : 'no price-affecting rules triggered';
    aiRationale =
      `Suggested price of ${scope.currency} ${computedPrice.toLocaleString()} is the resource revenue ` +
      `of ${scope.currency} ${totalRevenue.toLocaleString()} adjusted by: ${ruleText}. ` +
      `Final gross margin is ${finalMarginPct}% on a ${costBasisLabel} basis. ` +
      `(AI rationale offline — figures computed from rate cards.)`;
  }

  return {
    breakdown:             rows,
    costLines:             cl.rows,
    resourceRevenue,
    resourceCost,
    hardwareRevenue:       cl.hardwareRevenue,
    hardwareCost:          cl.hardwareCost,
    otherRevenue:          cl.otherRevenue,
    otherCost:             cl.otherCost,
    totalRevenue,
    totalCost,
    grossMarginPct,
    scenarioBase,
    scenarioStretch,
    scenarioAggressive,
    aiSuggestedPrice,
    aiRationale,
    rulesApplied,
    finalMarginPct,
    finalPrice:            null,
    overrideJustification: '',
    costBasis:             scope.costBasis,
    currency:              scope.currency,
    endpoint,
  };
}