import { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { rateCards as initialRateCards, type RateCard } from '@/data/mockData';

export type CostingMethod = 'marginal' | 'absorption' | 'utilisation-adjusted';

export interface BusinessRule {
  id: string;
  rule: string;
  value: string;
  status: string;
}

// ── Threshold constants ────────────────────────────────────────────────────────
const MARGIN_THRESHOLD_MARGINAL    = 30;
const MARGIN_THRESHOLD_ABSORPTION  = 20;
const MARGIN_THRESHOLD_UTILISATION = 25;

const initialRules: BusinessRule[] = [
  { id: 'BR-1',  rule: 'Minimum Gross Margin (Marginal)',              value: '30%',                         status: 'Active' },
  { id: 'BR-2',  rule: 'Minimum Gross Margin (Absorption)',            value: '20%',                         status: 'Active' },
  { id: 'BR-2B', rule: 'Minimum Gross Margin (Utilisation-Adjusted)',  value: '25%',                         status: 'Active' },
  { id: 'BR-3',  rule: 'Maximum Discount without Approval',            value: '5%',                          status: 'Active' },
  { id: 'BR-4',  rule: 'Non-Standard Payment Terms',                   value: 'Requires Finance Approval',   status: 'Active' },
  { id: 'BR-5',  rule: 'Resource Underpricing Alert',                  value: '< 80% of Rate Card',          status: 'Active' },
  { id: 'BR-6',  rule: 'Default Bench Loading %',                      value: '15%',                         status: 'Active' },
  { id: 'BR-7',  rule: 'Default Training & Certification Loading %',   value: '5%',                          status: 'Active' },
  { id: 'BR-8',  rule: 'Default Infrastructure Loading %',             value: '5%',                          status: 'Active' },
  { id: 'BR-9',  rule: 'Minimum Deal Size',                            value: '₹25,00,000',                  status: 'Active' },
  { id: 'BR-10', rule: 'Minimum Engagement Duration (T&M)',            value: '3 months',                    status: 'Active' },
  { id: 'BR-11', rule: 'Fixed Price Contingency (mandatory)',          value: '10%',                         status: 'Active' },
  { id: 'BR-12', rule: 'Target Offshore / Onsite Ratio',               value: '70% Offshore',                status: 'Active' },
  { id: 'BR-13', rule: 'Cost-to-Serve Loading (small deals)',          value: '8%',                          status: 'Active' },
  { id: 'BR-14', rule: 'Target Billable Utilisation',                  value: '80%',                         status: 'Active' },
  { id: 'BR-15', rule: 'Sub-contractor Margin Floor',                  value: '15%',                         status: 'Active' },
  { id: 'BR-16', rule: 'Currency Risk Buffer (non-INR)',               value: '3%',                          status: 'Active' },
];

// ── Context shape ──────────────────────────────────────────────────────────────
interface CommercialRulesContextType {
  rateCards: RateCard[];
  rules: BusinessRule[];
  costingMethod: CostingMethod;
  marginThreshold: number;
  loading: boolean;
  setRateCards: React.Dispatch<React.SetStateAction<RateCard[]>>;
  setRules: React.Dispatch<React.SetStateAction<BusinessRule[]>>;
  setCostingMethod: (method: CostingMethod) => void;
  persistRateCard: (rc: RateCard) => Promise<void>;
  deleteRateCard: (id: string) => Promise<void>;
  persistRule: (rule: BusinessRule) => Promise<void>;
  deleteRule: (id: string) => Promise<void>;
  getEffectiveCost: (rc: RateCard) => number;
  getEffectiveMargin: (rc: RateCard) => number;
  recomputeRateCard: (rc: Partial<RateCard> & {
    billingRate: number; costRate: number;
    benchPercentage: number; trainingPercentage: number; infraPercentage: number;
    utilisationRate: number;
  }) => Partial<RateCard>;
  getRatesForGeography: (geography: string) => RateCard[];
  getMatchingRates: (geography: string, modules: string[]) => RateCard[];
  getRuleValue: (id: string, fallback: number) => number;
  getScenarioMargins: (
    rows: { billingRate: number; costRate: number; loadedCostRate: number; effectiveCostRate: number; effectiveLoadedCostRate: number; hrs: number }[],
    discountPct: number
  ) => { base: number; downside: number; stretch: number };
}

const CommercialRulesContext = createContext<CommercialRulesContextType | null>(null);

export const useCommercialRules = () => {
  const ctx = useContext(CommercialRulesContext);
  if (!ctx) throw new Error('useCommercialRules must be inside CommercialRulesProvider');
  return ctx;
};

// ── Helpers: DB row ↔ RateCard ─────────────────────────────────────────────────
function computeMargins(
  billingRate: number, costRate: number,
  benchPercentage: number, trainingPercentage: number, infraPercentage: number,
  utilisationRate: number
) {
  const costLoadingPercentage   = benchPercentage + trainingPercentage + infraPercentage;
  const loadedCostRate          = Math.round(costRate * (1 + costLoadingPercentage / 100));
  const effectiveCostRate       = Math.round(costRate / utilisationRate);
  const effectiveLoadedCostRate = Math.round(loadedCostRate / utilisationRate);
  const marginalMargin                      = billingRate > 0 ? Math.round(((billingRate - costRate)               / billingRate) * 100) : 0;
  const absorptionMargin                    = billingRate > 0 ? Math.round(((billingRate - loadedCostRate)         / billingRate) * 100) : 0;
  const utilisationAdjustedMarginalMargin   = billingRate > 0 ? Math.round(((billingRate - effectiveCostRate)      / billingRate) * 100) : 0;
  const utilisationAdjustedAbsorptionMargin = billingRate > 0 ? Math.round(((billingRate - effectiveLoadedCostRate)/ billingRate) * 100) : 0;
  return { costLoadingPercentage, loadedCostRate, effectiveCostRate, effectiveLoadedCostRate,
           marginalMargin, absorptionMargin, utilisationAdjustedMarginalMargin, utilisationAdjustedAbsorptionMargin };
}

function rowToRateCard(row: Record<string, unknown>): RateCard {
  const billingRate         = Number(row.billing_rate)         || 0;
  const costRate            = Number(row.cost_rate)            || 0;
  const benchPercentage     = Number(row.bench_percentage)     || 15;
  const trainingPercentage  = Number(row.training_percentage)  || 5;
  const infraPercentage     = Number(row.infra_percentage)     || 5;
  const utilisationRate     = Number(row.utilisation_rate)     || 0.80;
  const computed = computeMargins(billingRate, costRate, benchPercentage, trainingPercentage, infraPercentage, utilisationRate);
  return {
    id: String(row.id), skill: String(row.skill || ''), roleLevel: (row.role_level as RateCard['roleLevel']) || 'Mid',
    experienceBand: String(row.experience_band || ''), geography: String(row.geography || 'India'),
    locationType: (row.location_type as RateCard['locationType']) || 'Offshore',
    currency: String(row.currency || 'USD'),
    billingRate, costRate, benchPercentage, trainingPercentage, infraPercentage, utilisationRate,
    margin: computed.marginalMargin,
    ...computed,
  };
}

function rateCardToRow(rc: RateCard) {
  return {
    id: rc.id, skill: rc.skill, role_level: rc.roleLevel, experience_band: rc.experienceBand,
    geography: rc.geography, location_type: rc.locationType, currency: rc.currency,
    billing_rate: rc.billingRate, cost_rate: rc.costRate,
    bench_percentage: rc.benchPercentage, training_percentage: rc.trainingPercentage,
    infra_percentage: rc.infraPercentage, utilisation_rate: rc.utilisationRate,
  };
}

function rowToRule(row: Record<string, unknown>, index: number): BusinessRule {
  return { id: String(row.id), rule: String(row.rule || ''), value: String(row.value || ''), status: String(row.status || 'Active') };
}

// ── Provider ──────────────────────────────────────────────────────────────────
export function CommercialRulesProvider({ children }: { children: ReactNode }) {
  const [rateCards, setRateCards] = useState<RateCard[]>(initialRateCards);
  const [rules, setRules]         = useState<BusinessRule[]>(initialRules);
  const [costingMethod, setCostingMethodState] = useState<CostingMethod>('marginal');
  const [loading, setLoading]     = useState(true);
  const seeded = useRef(false);

  // ── Load from Supabase on mount ─────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [rcRes, rulesRes, cfgRes] = await Promise.all([
          supabase.from('commercial_rate_cards' as never).select('*').order('id'),
          supabase.from('commercial_business_rules' as never).select('*').order('sort_order'),
          supabase.from('app_config' as never).select('value').eq('key', 'costing_method').maybeSingle(),
        ]);

        const rcRows    = (rcRes.data   as Record<string, unknown>[] | null) ?? [];
        const ruleRows  = (rulesRes.data as Record<string, unknown>[] | null) ?? [];
        const methodVal = (cfgRes.data  as { value?: string } | null)?.value as CostingMethod | undefined;

        if (rcRows.length > 0) {
          setRateCards(rcRows.map(rowToRateCard));
        } else if (!seeded.current) {
          // First ever load — seed the DB with the initial mock data
          seeded.current = true;
          const rows = initialRateCards.map(rateCardToRow);
          await supabase.from('commercial_rate_cards' as never).upsert(rows as never);
        }

        if (ruleRows.length > 0) {
          setRules(ruleRows.map((r, i) => rowToRule(r, i)));
        } else if (!seeded.current) {
          const rows = initialRules.map((r, i) => ({ id: r.id, rule: r.rule, value: r.value, status: r.status, sort_order: i }));
          await supabase.from('commercial_business_rules' as never).upsert(rows as never);
        }

        if (methodVal && ['marginal', 'absorption', 'utilisation-adjusted'].includes(methodVal)) {
          setCostingMethodState(methodVal);
        }
      } catch {
        // Supabase unreachable — fall back to in-memory defaults silently
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // ── Costing method — persisted in app_config ────────────────────────────────
  const setCostingMethod = useCallback((method: CostingMethod) => {
    setCostingMethodState(method);
    setRateCards(prev => prev.map(rc => ({ ...rc, margin: method === 'marginal' ? rc.marginalMargin : method === 'absorption' ? rc.absorptionMargin : rc.utilisationAdjustedMarginalMargin })));
    supabase.from('app_config' as never)
      .upsert({ key: 'costing_method', value: method } as never, { onConflict: 'key' })
      .then(() => {}).catch(() => {}); // non-critical
  }, []);

  // ── Rate card persistence ───────────────────────────────────────────────────
  const persistRateCard = useCallback(async (rc: RateCard) => {
    const { error } = await supabase.from('commercial_rate_cards' as never)
      .upsert(rateCardToRow(rc) as never, { onConflict: 'id' });
    if (error) throw new Error(error.message);
  }, []);

  const deleteRateCard = useCallback(async (id: string) => {
    const { error } = await supabase.from('commercial_rate_cards' as never).delete().eq('id', id);
    if (error) throw new Error(error.message);
  }, []);

  // ── Rule persistence ────────────────────────────────────────────────────────
  const persistRule = useCallback(async (rule: BusinessRule) => {
    const sortOrder = rules.findIndex(r => r.id === rule.id);
    const { error } = await supabase.from('commercial_business_rules' as never)
      .upsert({ id: rule.id, rule: rule.rule, value: rule.value, status: rule.status, sort_order: sortOrder >= 0 ? sortOrder : 999 } as never, { onConflict: 'id' });
    if (error) throw new Error(error.message);
  }, [rules]);

  const deleteRule = useCallback(async (id: string) => {
    const { error } = await supabase.from('commercial_business_rules' as never).delete().eq('id', id);
    if (error) throw new Error(error.message);
  }, []);

  // ── Derived helpers (unchanged from original) ───────────────────────────────
  const marginThreshold = costingMethod === 'marginal' ? MARGIN_THRESHOLD_MARGINAL
    : costingMethod === 'absorption' ? MARGIN_THRESHOLD_ABSORPTION : MARGIN_THRESHOLD_UTILISATION;

  const getEffectiveCost = useCallback((rc: RateCard) =>
    costingMethod === 'marginal' ? rc.costRate : costingMethod === 'absorption' ? rc.loadedCostRate : rc.effectiveLoadedCostRate,
  [costingMethod]);

  const getEffectiveMargin = useCallback((rc: RateCard) =>
    costingMethod === 'marginal' ? rc.marginalMargin : costingMethod === 'absorption' ? rc.absorptionMargin : rc.utilisationAdjustedAbsorptionMargin,
  [costingMethod]);

  const getRuleValue = useCallback((id: string, fallback: number) => {
    const rule = rules.find(r => r.id === id && r.status === 'Active');
    if (!rule) return fallback;
    const num = parseFloat(rule.value.replace(/[₹%,\s]/g, '').replace(/[^0-9.]/g, ''));
    return isNaN(num) ? fallback : num;
  }, [rules]);

  const recomputeRateCard = useCallback((rc: Partial<RateCard> & {
    billingRate: number; costRate: number;
    benchPercentage: number; trainingPercentage: number; infraPercentage: number; utilisationRate: number;
  }): Partial<RateCard> => {
    const { billingRate, costRate, benchPercentage, trainingPercentage, infraPercentage, utilisationRate } = rc;
    const computed = computeMargins(billingRate, costRate, benchPercentage, trainingPercentage, infraPercentage, utilisationRate);
    const margin = costingMethod === 'marginal' ? computed.marginalMargin
      : costingMethod === 'absorption' ? computed.absorptionMargin : computed.utilisationAdjustedMarginalMargin;
    return { ...rc, margin, ...computed };
  }, [costingMethod]);

  const getScenarioMargins = useCallback((
    rows: { billingRate: number; costRate: number; loadedCostRate: number; effectiveCostRate: number; effectiveLoadedCostRate: number; hrs: number }[],
    discountPct: number
  ) => {
    const calc = (mult: number) => {
      const rev  = rows.reduce((s, r) => s + r.billingRate * r.hrs, 0);
      const cost = rows.reduce((s, r) => {
        const c = costingMethod === 'marginal' ? r.costRate : costingMethod === 'absorption' ? r.loadedCostRate : r.effectiveLoadedCostRate;
        return s + c * r.hrs * mult;
      }, 0);
      const dRev = rev * (1 - discountPct / 100);
      return dRev > 0 ? Math.round(((dRev - cost) / dRev) * 100) : 0;
    };
    return { base: calc(1.0), downside: calc(1.20), stretch: calc(0.90) };
  }, [costingMethod]);

  const moduleSkillMap: Record<string, string[]> = {
    'FI': ['SAP FI/CO Lead', 'SAP FI Consultant', 'SAP Solution Architect', 'SAP FI/CO Junior Consultant'],
    'CO': ['SAP FI/CO Lead', 'SAP Solution Architect', 'SAP FI/CO Junior Consultant'],
    'MM': ['SAP MM/SD Consultant', 'SAP Solution Architect', 'SAP MM/SD Junior Consultant'],
    'SD': ['SAP MM/SD Consultant', 'SAP Solution Architect', 'SAP MM/SD Junior Consultant'],
    'PP': ['SAP PP Consultant', 'SAP Solution Architect'],
    'QM': ['SAP QM/PM Consultant'], 'PM': ['SAP QM/PM Consultant'],
    'ABAP': ['SAP ABAP Developer'], 'BASIS': ['SAP BASIS Administrator'],
    'BTP': ['SAP BTP Developer'], 'Fiori': ['SAP Fiori Developer'],
  };

  const getRatesForGeography = useCallback((geography: string) => {
    const geo = geography.toLowerCase();
    return rateCards.filter(r => r.geography.toLowerCase() === geo || geo === 'global');
  }, [rateCards]);

  const getMatchingRates = useCallback((geography: string, modules: string[]) => {
    const relevant = new Set<string>(['Project Manager', 'SAP Solution Architect', 'Change Management Consultant']);
    modules.forEach(mod => moduleSkillMap[mod]?.forEach(s => relevant.add(s)));
    const geo = geography.toLowerCase();
    return rateCards.filter(r => (r.geography.toLowerCase() === geo || geo === 'global') && relevant.has(r.skill));
  }, [rateCards]);

  return (
    <CommercialRulesContext.Provider value={{
      rateCards, rules, costingMethod, marginThreshold, loading,
      setRateCards, setRules, setCostingMethod,
      persistRateCard, deleteRateCard, persistRule, deleteRule,
      getEffectiveCost, getEffectiveMargin, recomputeRateCard,
      getRatesForGeography, getMatchingRates, getRuleValue, getScenarioMargins,
    }}>
      {children}
    </CommercialRulesContext.Provider>
  );
}
