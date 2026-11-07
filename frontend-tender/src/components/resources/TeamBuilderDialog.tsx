import { useState, useMemo, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { StatusBadge } from '@/components/StatusBadge';
import { Search, Users, AlertTriangle, DollarSign, X } from 'lucide-react';
import type { DbResource } from '@/hooks/useResources';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  resources: DbResource[];
  initialSelected?: Set<string>;
  onConfirm?: (selected: Set<string>) => void;
}

export function TeamBuilderDialog({ open, onOpenChange, resources, initialSelected, onConfirm }: Props) {
  const [selected, setSelected] = useState<Set<string>>(initialSelected ?? new Set());
  const [search, setSearch] = useState('');
  const [moduleFilter, setModuleFilter] = useState('');

  useEffect(() => {
    if (open && initialSelected) setSelected(new Set(initialSelected));
  }, [open, initialSelected]);

  const filtered = useMemo(() => resources.filter(r => {
    const matchSearch = !search || r.name.toLowerCase().includes(search.toLowerCase()) || r.designation.toLowerCase().includes(search.toLowerCase());
    const matchModule = !moduleFilter || r.sap_modules.includes(moduleFilter);
    return matchSearch && matchModule;
  }), [resources, search, moduleFilter]);

  const team = resources.filter(r => selected.has(r.id));

  const toggleResource = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const totalCost = team.reduce((sum, r) => sum + r.cost_rate * (1 + r.cost_loading_percentage / 100), 0);
  const totalBilling = team.reduce((sum, r) => sum + r.billing_rate, 0);
  const blendedMargin = totalBilling > 0 ? ((totalBilling - totalCost) / totalBilling * 100).toFixed(1) : '0';
  const unavailable = team.filter(r => r.availability === 'Engaged');
  const partial = team.filter(r => r.availability === 'Partially Available');

  const allModules = [...new Set(resources.flatMap(r => r.sap_modules))].sort();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Users className="h-5 w-5" /> Team Builder</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-5 gap-4">
          {/* Left: resource picker */}
          <div className="col-span-3 space-y-3">
            <div className="flex gap-2">
              <div className="flex items-center gap-2 flex-1">
                <Search className="h-4 w-4 text-muted-foreground" />
                <Input placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} className="h-8" />
              </div>
              <select value={moduleFilter} onChange={e => setModuleFilter(e.target.value)} className="h-8 px-2 border rounded text-xs bg-background">
                <option value="">All Modules</option>
                {allModules.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div className="max-h-[400px] overflow-y-auto space-y-1">
              {filtered.map(r => (
                <div key={r.id} className={`flex items-center gap-3 p-2 rounded-lg border cursor-pointer hover:bg-accent/50 transition-colors ${selected.has(r.id) ? 'bg-primary/5 border-primary/30' : ''}`}
                  onClick={() => toggleResource(r.id)}>
                  <Checkbox checked={selected.has(r.id)} />
                  <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary shrink-0">
                    {r.name.split(' ').map(n => n[0]).join('')}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{r.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{r.designation}</p>
                  </div>
                  <StatusBadge status={r.availability} />
                  <span className="text-xs text-muted-foreground">${r.billing_rate}/hr</span>
                </div>
              ))}
            </div>
          </div>

          {/* Right: team summary */}
          <div className="col-span-2 space-y-3">
            <h3 className="text-sm font-semibold">Selected Team ({team.length})</h3>
            {team.length === 0 && <p className="text-xs text-muted-foreground py-8 text-center">Select resources from the left to build your team</p>}

            <div className="space-y-1.5 max-h-[250px] overflow-y-auto">
              {team.map(r => (
                <div key={r.id} className="flex items-center gap-2 text-sm p-1.5 rounded bg-muted/50">
                  <span className="flex-1 truncate">{r.name}</span>
                  <span className="text-xs text-muted-foreground">${r.billing_rate}/hr</span>
                  <button onClick={() => toggleResource(r.id)} className="text-muted-foreground hover:text-destructive"><X className="h-3.5 w-3.5" /></button>
                </div>
              ))}
            </div>

            {team.length > 0 && (
              <div className="border rounded-lg p-3 space-y-2">
                <h4 className="text-xs font-semibold uppercase text-muted-foreground flex items-center gap-1"><DollarSign className="h-3 w-3" /> Team Economics</h4>
                <div className="text-sm space-y-1">
                  <div className="flex justify-between"><span>Total Loaded Cost:</span><strong>${totalCost.toFixed(0)}/hr</strong></div>
                  <div className="flex justify-between"><span>Total Billing:</span><strong>${totalBilling.toFixed(0)}/hr</strong></div>
                  <div className="flex justify-between"><span>Blended Margin:</span>
                    <strong className={`${parseFloat(blendedMargin) >= 30 ? 'text-green-600' : parseFloat(blendedMargin) >= 15 ? 'text-amber-600' : 'text-red-600'}`}>{blendedMargin}%</strong>
                  </div>
                </div>

                {/* Skill coverage */}
                <div className="pt-2 border-t">
                  <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-1">Module Coverage</h4>
                  <div className="flex flex-wrap gap-1">
                    {[...new Set(team.flatMap(r => r.sap_modules))].map(m => <Badge key={m} className="text-[10px]">{m}</Badge>)}
                  </div>
                </div>

                {/* Warnings */}
                {(unavailable.length > 0 || partial.length > 0) && (
                  <div className="pt-2 border-t space-y-1">
                    {unavailable.map(r => (
                      <div key={r.id} className="flex items-center gap-1.5 text-xs text-red-600">
                        <AlertTriangle className="h-3 w-3" /><span>{r.name} is Engaged</span>
                      </div>
                    ))}
                    {partial.map(r => (
                      <div key={r.id} className="flex items-center gap-1.5 text-xs text-amber-600">
                        <AlertTriangle className="h-3 w-3" /><span>{r.name} is Partially Available</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {onConfirm && (
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={() => onConfirm(selected)} disabled={selected.size === 0}>
              <Users className="h-4 w-4 mr-2" /> Confirm Team ({selected.size})
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
