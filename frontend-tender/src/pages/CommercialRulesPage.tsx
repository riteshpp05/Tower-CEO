import { useState, useCallback } from 'react';
import { useCommercialRules, type CostingMethod } from '@/contexts/CommercialRulesContext';
import { StatusBadge } from '@/components/StatusBadge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import {
  AlertTriangle, Settings, Pencil, Check, X,
  Plus, Trash2, Calculator
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

const METHOD_INFO = {
  marginal: {
    label: 'Marginal Costing', badge: 'Variable Cost Only',
    color: 'bg-info/10 text-info border-info/30',
    description: 'Margin uses direct salary cost only. Best for competitive pricing and short-term decisions.',
    formula: 'Margin = (Billing − Direct Cost) ÷ Billing', threshold: 30,
  },
  absorption: {
    label: 'Absorption Costing', badge: 'Full Overhead Loaded',
    color: 'bg-warning/10 text-warning border-warning/30',
    description: 'Margin absorbs all overhead (bench, training, infra) via split loading percentages.',
    formula: 'Loaded Cost = Direct × (1 + Bench% + Training% + Infra%)  |  Margin = (Billing − Loaded) ÷ Billing', threshold: 20,
  },
  'utilisation-adjusted': {
    label: 'Utilisation-Adjusted', badge: 'Real Effective Cost',
    color: 'bg-success/10 text-success border-success/30',
    description: 'Divides loaded cost by utilisation rate to reflect true cost per billable hour. Most accurate for IT services.',
    formula: 'Effective Cost = Loaded Cost ÷ Utilisation Rate  |  Margin = (Billing − Effective Cost) ÷ Billing', threshold: 25,
  },
};


export default function CommercialRulesPage() {
  const { toast } = useToast();
  const {
    rules, setRules,
    costingMethod, setCostingMethod, loading,
    persistRule, deleteRule,
  } = useCommercialRules();

  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [editRule, setEditRule] = useState<{ rule?: string; value?: string }>({});

  // ── Rule helpers ──────────────────────────────────────────────────────────
  const startEditRule  = (r: { id: string; rule: string; value: string }) => { setEditingRuleId(r.id); setEditRule({ rule: r.rule, value: r.value }); };
  const cancelEditRule = () => { setEditingRuleId(null); setEditRule({}); };

  const saveRule = useCallback(() => {
    if (!editingRuleId) return;
    const updated = { ...rules.find(r => r.id === editingRuleId)!, rule: editRule.rule || '', value: editRule.value || '' };
    setRules(prev => prev.map(r => r.id === editingRuleId ? updated : r));
    persistRule(updated).catch(() =>
      toast({ title: 'Sync failed', description: 'Rule saved locally but failed to persist.', variant: 'destructive' })
    );
    toast({ title: '✓ Rule Updated', description: `${updated.rule} saved.` });
    cancelEditRule();
  }, [editingRuleId, editRule, toast, setRules]);

  const addRule = () => {
    const nr = { id: `BR-${Date.now()}`, rule: 'New Rule', value: 'Define value', status: 'Active' };
    setRules(prev => [...prev, nr]);
    persistRule(nr).catch(() => {});
    startEditRule(nr);
  };

  const marginColor = (m: number, t: number) =>
    m < t ? 'text-destructive font-bold' : m < t + 10 ? 'text-warning font-medium' : 'text-success font-medium';

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      <span className="ml-3 text-muted-foreground">Loading commercial rules…</span>
    </div>
  );

  return (
    <TooltipProvider>
    <div className="space-y-6 animate-fade-in">

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold font-heading">Commercial Rules Engine</h1>
          <p className="text-sm text-muted-foreground">Costing method & pricing governance rules</p>
        </div>
      </div>

      {/* ── Costing Method ──────────────────────────────────────────────────── */}
      <Card className="enterprise-shadow border-2 border-primary/20">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Calculator className="h-5 w-5 text-primary" />
            <CardTitle className="font-heading">Costing Method</CardTitle>
          </div>
          <CardDescription>Three methods available — each gives a different margin view</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {(Object.keys(METHOD_INFO) as CostingMethod[]).map(method => {
              const mi = METHOD_INFO[method];
              const isActive = costingMethod === method;
              return (
                <button key={method} onClick={() => { setCostingMethod(method); toast({ title: `✓ Switched to ${mi.label}` }); }}
                  className={`text-left p-4 rounded-lg border-2 transition-all ${isActive ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40 hover:bg-muted/30'}`}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-semibold font-heading text-sm">{mi.label}</span>
                    <div className="flex items-center gap-1">
                      <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${mi.color}`}>{mi.badge}</span>
                      {isActive && <span className="text-xs bg-primary text-primary-foreground px-2 py-0.5 rounded-full font-medium">Active</span>}
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed mb-2">{mi.description}</p>
                  <p className="text-xs font-mono bg-muted/50 px-2 py-1 rounded text-foreground/70 leading-relaxed">{mi.formula}</p>
                  <p className="text-xs text-muted-foreground mt-1">Min threshold: <span className="font-medium text-foreground">{mi.threshold}%</span></p>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>



      {/* ── Business Rules ──────────────────────────────────────────────────── */}
      <Card className="enterprise-shadow">
        <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-2">
          <div>
            <CardTitle className="font-heading flex items-center gap-2"><Settings className="h-4 w-4" /> Business Rules</CardTitle>
            <CardDescription>Governance thresholds — changes reflect live in the New Proposal form</CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={addRule}><Plus className="h-3 w-3 mr-1" /> Add Rule</Button>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {rules.map(r => (
              <div key={r.id} className="p-3 rounded-lg border flex items-center justify-between gap-2">
                {editingRuleId === r.id ? (
                  <div className="flex-1 space-y-2">
                    <Input className="h-8 text-sm" value={editRule.rule || ''} onChange={e => setEditRule(p => ({ ...p, rule: e.target.value }))} />
                    <Input className="h-8 text-sm" value={editRule.value || ''} onChange={e => setEditRule(p => ({ ...p, value: e.target.value }))} />
                    <div className="flex gap-1">
                      <Button size="sm" variant="outline" className="text-success" onClick={saveRule}><Check className="h-3 w-3 mr-1" />Save</Button>
                      <Button size="sm" variant="ghost" onClick={cancelEditRule}><X className="h-3 w-3 mr-1" />Cancel</Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex-1">
                      <p className="text-xs font-medium text-muted-foreground">{r.id}</p>
                      <p className="text-sm font-medium">{r.rule}</p>
                      <p className="text-xs text-muted-foreground">{r.value}</p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => {
                        const updated = { ...r, status: r.status === 'Active' ? 'Inactive' : 'Active' };
                        setRules(prev => prev.map(x => x.id === r.id ? updated : x));
                        persistRule(updated).catch(() => {});
                      }}>
                        <StatusBadge status={r.status} />
                      </button>
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => startEditRule(r)}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => { setRules(prev => prev.filter(x => x.id !== r.id)); deleteRule(r.id).catch(() => {}); if (editingRuleId === r.id) cancelEditRule(); }}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

    </div>
    </TooltipProvider>
  );
}