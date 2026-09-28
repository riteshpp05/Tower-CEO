import { useState } from 'react';
import { usePricingStrategy, type MarketBenchmark, type CostPlusTarget } from '@/contexts/PricingStrategyContext';
import { useCommercialRules } from '@/contexts/CommercialRulesContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { Pencil, Check, X, Plus, Trash2, TrendingUp, BarChart3, Layers, Info } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';

// ── Market position bar ───────────────────────────────────────────────────────
function PositionBar({ aisRate, low, mid, high }: { aisRate: number; low: number; mid: number; high: number }) {
  const range = high - low;
  const pct = range > 0 ? Math.max(0, Math.min(100, ((aisRate - low) / range) * 100)) : 50;
  const color = aisRate < low ? '#ef4444' : aisRate > high ? '#8b5cf6' : aisRate < mid ? '#22c55e' : '#3b82f6';
  return (
    <div className="relative w-full h-4 rounded-full bg-muted overflow-visible">
      <div className="absolute inset-0 rounded-full" style={{ background: 'linear-gradient(to right, #22c55e22, #3b82f622, #8b5cf622)' }} />
      {/* Mid marker */}
      <div className="absolute top-0 bottom-0 w-0.5 bg-border/60" style={{ left: `${((mid - low) / range) * 100}%` }} />
      {/* AIS dot */}
      <div
        className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full border-2 border-white shadow"
        style={{ left: `calc(${pct}% - 6px)`, background: color }}
      />
    </div>
  );
}

export default function PricingStrategyPage() {
  const { toast } = useToast();
  const { rateCards } = useCommercialRules();
  const { benchmarks, setBenchmarks, costPlusTargets, setCostPlusTargets, tiers, setTiers } = usePricingStrategy();

  // ── Benchmark edit state ──────────────────────────────────────────────────
  const [editBmId, setEditBmId] = useState<string | null>(null);
  const [editBm, setEditBm] = useState<Partial<MarketBenchmark>>({});

  const saveBm = () => {
    if (!editBmId) return;
    setBenchmarks(prev => prev.map(b => b.id === editBmId ? { ...b, ...editBm } : b));
    toast({ title: '✓ Benchmark Updated' });
    setEditBmId(null); setEditBm({});
  };

  const addBm = () => {
    const id = `MB-${String(benchmarks.length + 1).padStart(3, '0')}`;
    const nb: MarketBenchmark = { id, skill: 'New Role', geography: 'India', marketLow: 100, marketMid: 130, marketHigh: 160, currency: 'USD', source: 'Manual entry' };
    setBenchmarks(prev => [...prev, nb]);
    setEditBmId(id); setEditBm(nb);
  };

  // ── Cost-plus edit state ──────────────────────────────────────────────────
  const [editCpId, setEditCpId] = useState<string | null>(null);
  const [editCp, setEditCp] = useState<Partial<CostPlusTarget>>({});

  const saveCp = () => {
    if (!editCpId) return;
    setCostPlusTargets(prev => prev.map(t => t.id === editCpId ? { ...t, ...editCp } : t));
    toast({ title: '✓ Target Updated' });
    setEditCpId(null); setEditCp({});
  };

  // ── Tier edit state ───────────────────────────────────────────────────────
  const [editTierName, setEditTierName] = useState<string | null>(null);
  const [editTierMultiplier, setEditTierMultiplier] = useState<string>('');
  const [editTierSLA, setEditTierSLA] = useState<string>('');
  const [editTierRT, setEditTierRT] = useState<string>('');

  const saveTier = (name: string) => {
    setTiers(prev => prev.map(t => t.name === name ? {
      ...t,
      multiplier: Number(editTierMultiplier) || t.multiplier,
      supportSLA: editTierSLA || t.supportSLA,
      responseTime: editTierRT || t.responseTime,
    } : t));
    toast({ title: `✓ ${name} Tier Updated` });
    setEditTierName(null);
  };

  // ── Blended AIS rate for comparison ──────────────────────────────────────
  const blendedAISRate = rateCards.length > 0
    ? Math.round(rateCards.reduce((s, r) => s + r.billingRate, 0) / rateCards.length)
    : 0;

  return (
    <TooltipProvider>
    <div className="space-y-6 animate-fade-in">

      <div>
        <h1 className="text-2xl font-bold font-heading">Pricing Strategy</h1>
        <p className="text-sm text-muted-foreground">Manage competitor benchmarks, cost-plus targets, and tiered pricing packages</p>
      </div>

      <Tabs defaultValue="benchmarks">
        <TabsList className="mb-4">
          <TabsTrigger value="benchmarks" className="gap-2"><BarChart3 className="h-3.5 w-3.5" /> Competitor Benchmarks</TabsTrigger>
          <TabsTrigger value="costplus"   className="gap-2"><TrendingUp className="h-3.5 w-3.5" /> Cost-Plus Targets</TabsTrigger>
          <TabsTrigger value="tiers"      className="gap-2"><Layers className="h-3.5 w-3.5" /> Tiered Pricing</TabsTrigger>
        </TabsList>

        {/* ── TAB 1: Competitor Benchmarks ─────────────────────────────────── */}
        <TabsContent value="benchmarks">
          <Card className="enterprise-shadow">
            <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-2">
              <div>
                <CardTitle className="font-heading">Market Rate Benchmarks</CardTitle>
                <CardDescription>Compare AIS billing rates against market low / mid / high per role</CardDescription>
              </div>
              <Button size="sm" variant="outline" onClick={addBm}><Plus className="h-3 w-3 mr-1" /> Add Role</Button>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="pb-3 font-medium text-muted-foreground">Role</th>
                      <th className="pb-3 font-medium text-muted-foreground">Geo</th>
                      <th className="pb-3 font-medium text-muted-foreground">Market Low</th>
                      <th className="pb-3 font-medium text-muted-foreground">Market Mid</th>
                      <th className="pb-3 font-medium text-muted-foreground">Market High</th>
                      <th className="pb-3 font-medium text-muted-foreground">AIS Rate</th>
                      <th className="pb-3 font-medium text-muted-foreground">Position</th>
                      <th className="pb-3 font-medium text-muted-foreground">Source</th>
                      <th className="pb-3 font-medium text-muted-foreground text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {benchmarks.map(b => {
                      const aisCard = rateCards.find(r => r.skill.toLowerCase() === b.skill.toLowerCase());
                      const aisRate = aisCard?.billingRate ?? 0;
                      const pos = aisRate > 0
                        ? (aisRate < b.marketLow ? 'Below Market' : aisRate > b.marketHigh ? 'Above Market' : aisRate < b.marketMid ? 'Competitive' : 'Market Rate')
                        : null;
                      const posColor = pos === 'Competitive' ? 'text-success' : pos === 'Market Rate' ? 'text-info' : pos === 'Above Market' ? 'text-warning' : pos === 'Below Market' ? 'text-destructive' : 'text-muted-foreground';

                      return (
                        <tr key={b.id} className="border-b last:border-0 hover:bg-muted/20">
                          {editBmId === b.id ? (
                            <>
                              <td className="py-2"><Input className="h-7 text-xs w-40" value={editBm.skill ?? b.skill} onChange={e => setEditBm(p => ({ ...p, skill: e.target.value }))} /></td>
                              <td className="py-2"><Input className="h-7 text-xs w-16" value={editBm.geography ?? b.geography} onChange={e => setEditBm(p => ({ ...p, geography: e.target.value }))} /></td>
                              <td className="py-2"><Input type="number" className="h-7 text-xs w-16" value={editBm.marketLow ?? b.marketLow} onChange={e => setEditBm(p => ({ ...p, marketLow: Number(e.target.value) }))} /></td>
                              <td className="py-2"><Input type="number" className="h-7 text-xs w-16" value={editBm.marketMid ?? b.marketMid} onChange={e => setEditBm(p => ({ ...p, marketMid: Number(e.target.value) }))} /></td>
                              <td className="py-2"><Input type="number" className="h-7 text-xs w-16" value={editBm.marketHigh ?? b.marketHigh} onChange={e => setEditBm(p => ({ ...p, marketHigh: Number(e.target.value) }))} /></td>
                              <td className="py-2 text-xs text-muted-foreground">{aisRate > 0 ? `$${aisRate}` : '—'}</td>
                              <td className="py-2" colSpan={2}><Input className="h-7 text-xs w-36" value={editBm.source ?? b.source} onChange={e => setEditBm(p => ({ ...p, source: e.target.value }))} placeholder="Source" /></td>
                              <td className="py-2 text-right">
                                <Button size="icon" variant="ghost" className="h-7 w-7 text-success" onClick={saveBm}><Check className="h-3 w-3" /></Button>
                                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setEditBmId(null); setEditBm({}); }}><X className="h-3 w-3" /></Button>
                              </td>
                            </>
                          ) : (
                            <>
                              <td className="py-3 font-medium text-xs">{b.skill}</td>
                              <td className="py-3 text-xs text-muted-foreground">{b.geography}</td>
                              <td className="py-3 text-xs">${b.marketLow}</td>
                              <td className="py-3 text-xs">${b.marketMid}</td>
                              <td className="py-3 text-xs">${b.marketHigh}</td>
                              <td className="py-3 text-xs font-medium">{aisRate > 0 ? `$${aisRate}` : <span className="text-muted-foreground">No rate card</span>}</td>
                              <td className="py-3 min-w-[140px]">
                                {aisRate > 0 ? (
                                  <div className="space-y-1">
                                    <span className={`text-xs font-medium ${posColor}`}>{pos}</span>
                                    <PositionBar aisRate={aisRate} low={b.marketLow} mid={b.marketMid} high={b.marketHigh} />
                                    <div className="flex justify-between text-[10px] text-muted-foreground">
                                      <span>${b.marketLow}</span><span>${b.marketMid}</span><span>${b.marketHigh}</span>
                                    </div>
                                  </div>
                                ) : <span className="text-xs text-muted-foreground">—</span>}
                              </td>
                              <td className="py-3 text-xs text-muted-foreground">{b.source}</td>
                              <td className="py-3 text-right">
                                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setEditBmId(b.id); setEditBm({}); }}><Pencil className="h-3 w-3" /></Button>
                                <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => { setBenchmarks(p => p.filter(x => x.id !== b.id)); toast({ title: 'Benchmark removed' }); }}><Trash2 className="h-3 w-3" /></Button>
                              </td>
                            </>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {blendedAISRate > 0 && (
                <div className="mt-4 p-3 rounded-lg bg-muted/30 border text-xs flex items-center gap-2">
                  <Info className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  Blended AIS billing rate across all rate cards: <strong>${blendedAISRate}/hr</strong>. Update rate cards in the Commercial Rules Engine.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── TAB 2: Cost-Plus Targets ─────────────────────────────────────── */}
        <TabsContent value="costplus">
          <Card className="enterprise-shadow">
            <CardHeader>
              <CardTitle className="font-heading">Cost-Plus Margin Targets</CardTitle>
              <CardDescription>
                Set the target margin % per deal type. Recommended quote = Total Cost ÷ (1 − Target Margin%)
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {costPlusTargets.map(t => (
                  <div key={t.id} className="p-4 rounded-lg border flex items-center gap-4 flex-wrap">
                    {editCpId === t.id ? (
                      <div className="flex-1 grid grid-cols-2 md:grid-cols-4 gap-3 items-end">
                        <div className="space-y-1 md:col-span-2">
                          <Label className="text-xs">Deal Type</Label>
                          <Input className="h-8" value={editCp.dealType ?? t.dealType} onChange={e => setEditCp(p => ({ ...p, dealType: e.target.value }))} />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Target Margin — Marginal %</Label>
                          <div className="flex items-center gap-1">
                            <Input type="number" className="h-8" value={editCp.targetMarginMarginal ?? t.targetMarginMarginal} onChange={e => setEditCp(p => ({ ...p, targetMarginMarginal: Number(e.target.value) }))} />
                            <span className="text-xs text-muted-foreground">%</span>
                          </div>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Target Margin — Absorption %</Label>
                          <div className="flex items-center gap-1">
                            <Input type="number" className="h-8" value={editCp.targetMarginAbsorption ?? t.targetMarginAbsorption} onChange={e => setEditCp(p => ({ ...p, targetMarginAbsorption: Number(e.target.value) }))} />
                            <span className="text-xs text-muted-foreground">%</span>
                          </div>
                        </div>
                        <div className="flex gap-2 md:col-span-4">
                          <Button size="sm" variant="outline" className="text-success" onClick={saveCp}><Check className="h-3 w-3 mr-1" /> Save</Button>
                          <Button size="sm" variant="ghost" onClick={() => { setEditCpId(null); setEditCp({}); }}><X className="h-3 w-3 mr-1" /> Cancel</Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex-1">
                          <p className="font-medium text-sm">{t.dealType}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Marginal target: <strong>{t.targetMarginMarginal}%</strong> · Absorption target: <strong>{t.targetMarginAbsorption}%</strong>
                          </p>
                          <div className="flex gap-4 mt-2">
                            {(['Marginal', 'Absorption'] as const).map(method => {
                              const margin = method === 'Marginal' ? t.targetMarginMarginal : t.targetMarginAbsorption;
                              const exampleCost = 100000;
                              const recommended = Math.round(exampleCost / (1 - margin / 100));
                              return (
                                <div key={method} className="text-xs">
                                  <span className="text-muted-foreground">{method} (on $100K cost): </span>
                                  <span className="font-medium">${(recommended / 1000).toFixed(0)}K quote</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setEditCpId(t.id); setEditCp({}); }}><Pencil className="h-3 w-3" /></Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => { setCostPlusTargets(p => p.filter(x => x.id !== t.id)); toast({ title: 'Target removed' }); }}><Trash2 className="h-3 w-3" /></Button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
                <Button size="sm" variant="outline" onClick={() => {
                  const nb: CostPlusTarget = { id: `CP-${Date.now()}`, dealType: 'New Deal Type', targetMarginMarginal: 35, targetMarginAbsorption: 25 };
                  setCostPlusTargets(p => [...p, nb]);
                  setEditCpId(nb.id); setEditCp(nb);
                }}><Plus className="h-3 w-3 mr-1" /> Add Deal Type</Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── TAB 3: Tiered Pricing ────────────────────────────────────────── */}
        <TabsContent value="tiers">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {tiers.map(tier => (
              <Card key={tier.name} className="enterprise-shadow" style={{ borderTop: `3px solid ${tier.color}` }}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-xs font-mono font-medium" style={{ color: tier.color }}>{tier.name}</span>
                      <CardTitle className="font-heading text-lg">{tier.label}</CardTitle>
                    </div>
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => {
                      setEditTierName(tier.name);
                      setEditTierMultiplier(String(tier.multiplier));
                      setEditTierSLA(tier.supportSLA);
                      setEditTierRT(tier.responseTime);
                    }}><Pencil className="h-3.5 w-3.5" /></Button>
                  </div>
                  {editTierName === tier.name ? (
                    <div className="space-y-2 mt-2">
                      <div className="flex items-center gap-2">
                        <Label className="text-xs shrink-0">Price Multiplier</Label>
                        <Input type="number" step="0.01" className="h-7 text-xs" value={editTierMultiplier} onChange={e => setEditTierMultiplier(e.target.value)} />
                        <span className="text-xs text-muted-foreground">×</span>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Support SLA</Label>
                        <Input className="h-7 text-xs" value={editTierSLA} onChange={e => setEditTierSLA(e.target.value)} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Response Time</Label>
                        <Input className="h-7 text-xs" value={editTierRT} onChange={e => setEditTierRT(e.target.value)} />
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" className="text-success text-xs" onClick={() => saveTier(tier.name)}><Check className="h-3 w-3 mr-1" /> Save</Button>
                        <Button size="sm" variant="ghost" className="text-xs" onClick={() => setEditTierName(null)}><X className="h-3 w-3 mr-1" /> Cancel</Button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-1 mt-1">
                      <p className="text-sm font-medium">{tier.multiplier}× base price</p>
                      <p className="text-xs text-muted-foreground">{tier.supportSLA} · {tier.responseTime} response</p>
                    </div>
                  )}
                </CardHeader>
                <CardContent>
                  <ul className="space-y-1.5">
                    {tier.includes.map((item, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs">
                        <span className="shrink-0 mt-0.5" style={{ color: tier.color }}>✓</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ))}
          </div>
          <div className="mt-4 p-3 rounded-lg bg-muted/30 border text-xs flex items-center gap-2">
            <Info className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            Tier prices in the Pricing Calculator = Cost-Plus recommended price × tier multiplier. Bronze is always 1.0× (base price).
          </div>
        </TabsContent>
      </Tabs>
    </div>
    </TooltipProvider>
  );
}