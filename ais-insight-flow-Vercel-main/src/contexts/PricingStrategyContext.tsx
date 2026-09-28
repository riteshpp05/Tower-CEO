import { createContext, useContext, useState, ReactNode } from 'react';

export interface MarketBenchmark {
  id: string;
  skill: string;
  geography: string;
  marketLow: number;
  marketMid: number;
  marketHigh: number;
  currency: string;
  source: string;
}

export interface CostPlusTarget {
  id: string;
  dealType: string;
  targetMarginMarginal: number;
  targetMarginAbsorption: number;
}

export interface PricingTier {
  name: 'Bronze' | 'Silver' | 'Gold';
  label: string;
  multiplier: number;
  color: string;
  includes: string[];
  supportSLA: string;
  responseTime: string;
}

interface PricingStrategyContextType {
  benchmarks: MarketBenchmark[];
  setBenchmarks: React.Dispatch<React.SetStateAction<MarketBenchmark[]>>;
  costPlusTargets: CostPlusTarget[];
  setCostPlusTargets: React.Dispatch<React.SetStateAction<CostPlusTarget[]>>;
  tiers: PricingTier[];
  setTiers: React.Dispatch<React.SetStateAction<PricingTier[]>>;
  getCostPlusPrice: (totalCost: number, dealType: string, method: 'marginal' | 'absorption') => number;
  getMarketPosition: (skill: string, geo: string, aisRate: number) => { label: string; pct: number; bm: MarketBenchmark } | null;
}

const PricingStrategyContext = createContext<PricingStrategyContextType | null>(null);

export const usePricingStrategy = () => {
  const ctx = useContext(PricingStrategyContext);
  if (!ctx) throw new Error('usePricingStrategy must be inside PricingStrategyProvider');
  return ctx;
};

const defaultBenchmarks: MarketBenchmark[] = [
  { id: 'MB-001', skill: 'SAP Solution Architect',  geography: 'India', marketLow: 150, marketMid: 175, marketHigh: 220, currency: 'USD', source: 'LinkedIn / Glassdoor 2025' },
  { id: 'MB-002', skill: 'SAP FI/CO Lead',           geography: 'India', marketLow: 120, marketMid: 145, marketHigh: 180, currency: 'USD', source: 'LinkedIn / Glassdoor 2025' },
  { id: 'MB-003', skill: 'SAP MM/SD Consultant',     geography: 'India', marketLow: 95,  marketMid: 115, marketHigh: 145, currency: 'USD', source: 'LinkedIn / Glassdoor 2025' },
  { id: 'MB-004', skill: 'SAP ABAP Developer',       geography: 'India', marketLow: 85,  marketMid: 105, marketHigh: 135, currency: 'USD', source: 'LinkedIn / Glassdoor 2025' },
  { id: 'MB-005', skill: 'SAP BASIS Administrator',  geography: 'India', marketLow: 100, marketMid: 125, marketHigh: 155, currency: 'USD', source: 'LinkedIn / Glassdoor 2025' },
  { id: 'MB-006', skill: 'SAP BTP Developer',        geography: 'India', marketLow: 80,  marketMid: 100, marketHigh: 130, currency: 'USD', source: 'LinkedIn / Glassdoor 2025' },
  { id: 'MB-007', skill: 'Project Manager',          geography: 'India', marketLow: 130, marketMid: 155, marketHigh: 195, currency: 'USD', source: 'LinkedIn / Glassdoor 2025' },
  { id: 'MB-008', skill: 'SAP Fiori Developer',      geography: 'India', marketLow: 75,  marketMid: 92,  marketHigh: 120, currency: 'USD', source: 'LinkedIn / Glassdoor 2025' },
];

const defaultCostPlusTargets: CostPlusTarget[] = [
  { id: 'CP-001', dealType: 'Fixed Price',            targetMarginMarginal: 40, targetMarginAbsorption: 28 },
  { id: 'CP-002', dealType: 'Time & Material',        targetMarginMarginal: 35, targetMarginAbsorption: 24 },
  { id: 'CP-003', dealType: 'Hybrid',                 targetMarginMarginal: 38, targetMarginAbsorption: 26 },
  { id: 'CP-004', dealType: 'AMS',                    targetMarginMarginal: 42, targetMarginAbsorption: 30 },
  { id: 'CP-005', dealType: 'Resource Augmentation',  targetMarginMarginal: 30, targetMarginAbsorption: 20 },
];

const defaultTiers: PricingTier[] = [
  {
    name: 'Bronze', label: 'Essentials', multiplier: 1.0, color: '#CD7F32',
    includes: ['Core module implementation', 'Standard documentation', 'UAT support', 'Go-live support (2 weeks)', 'Email support post go-live'],
    supportSLA: '8×5 Business Hours', responseTime: '4 hours',
  },
  {
    name: 'Silver', label: 'Standard', multiplier: 1.18, color: '#A8A9AD',
    includes: ['Everything in Bronze', 'Extended hypercare (4 weeks)', 'Performance optimisation', 'Basic customisation & enhancements', 'Dedicated project coordinator', 'Monthly health check (3 months)'],
    supportSLA: '12×6 Extended Hours', responseTime: '2 hours',
  },
  {
    name: 'Gold', label: 'Premium', multiplier: 1.38, color: '#FFD700',
    includes: ['Everything in Silver', 'Priority resource allocation', 'Advanced customisation & ABAP development', 'Integration management', 'Quarterly business reviews (1 year)', 'Dedicated AMS team post go-live', 'Executive sponsorship from AIS'],
    supportSLA: '24×7 Round the Clock', responseTime: '30 minutes',
  },
];

export function PricingStrategyProvider({ children }: { children: ReactNode }) {
  const [benchmarks, setBenchmarks] = useState<MarketBenchmark[]>(defaultBenchmarks);
  const [costPlusTargets, setCostPlusTargets] = useState<CostPlusTarget[]>(defaultCostPlusTargets);
  const [tiers, setTiers] = useState<PricingTier[]>(defaultTiers);

  const getCostPlusPrice = (totalCost: number, dealType: string, method: 'marginal' | 'absorption'): number => {
    const target = costPlusTargets.find(t => t.dealType === dealType) ?? costPlusTargets[0];
    const margin = method === 'marginal' ? target.targetMarginMarginal : target.targetMarginAbsorption;
    return Math.round(totalCost / (1 - margin / 100));
  };

  const getMarketPosition = (skill: string, geo: string, aisRate: number) => {
    const bm = benchmarks.find(b =>
      b.skill.toLowerCase() === skill.toLowerCase() &&
      b.geography.toLowerCase() === geo.toLowerCase()
    );
    if (!bm) return null;
    const range = bm.marketHigh - bm.marketLow;
    const pct = range > 0 ? Math.round(((aisRate - bm.marketLow) / range) * 100) : 50;
    const label = aisRate < bm.marketLow ? 'Below Market' : aisRate > bm.marketHigh ? 'Above Market' : aisRate < bm.marketMid ? 'Competitive' : 'Market Rate';
    return { label, pct: Math.max(0, Math.min(100, pct)), bm };
  };

  return (
    <PricingStrategyContext.Provider value={{
      benchmarks, setBenchmarks,
      costPlusTargets, setCostPlusTargets,
      tiers, setTiers,
      getCostPlusPrice, getMarketPosition,
    }}>
      {children}
    </PricingStrategyContext.Provider>
  );
}