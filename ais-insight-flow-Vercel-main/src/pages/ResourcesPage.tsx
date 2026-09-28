import { useState, useRef, useCallback } from 'react';
import { useResources, useCreateResource, useUpdateResource, useDeleteResource, type DbResource } from '@/hooks/useResources';
import { ResourceFormDialog } from '@/components/resources/ResourceFormDialog';
import { ResourceDetailSheet } from '@/components/resources/ResourceDetailSheet';
import { TeamBuilderDialog } from '@/components/resources/TeamBuilderDialog';
import { generateCV, getCVLastGenerated } from '@/lib/generateCV';
import { StatCard } from '@/components/StatCard';
import { StatusBadge } from '@/components/StatusBadge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { Search, Users, Plus, UserPlus, FileText, Loader2, Upload, Download, Pencil, Check, X, TrendingDown } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import * as XLSX from 'xlsx';
import { useCommercialRules } from '@/contexts/CommercialRulesContext';
import { type RateCard, type RoleLevel, type LocationType } from '@/data/mockData';

export default function ResourcesPage() {
  const { data: resources = [], isLoading } = useResources();
  const createResource = useCreateResource();
  const updateResource = useUpdateResource();
  const deleteResource = useDeleteResource();
  const { toast } = useToast();

  const [search, setSearch] = useState('');
  const [moduleFilter, setModuleFilter] = useState('all');
  const [availFilter, setAvailFilter] = useState('all');
  const [geoFilter, setGeoFilter] = useState('all');

  const [formOpen, setFormOpen] = useState(false);
  const [editResource, setEditResource] = useState<DbResource | null>(null);
  const [detailResource, setDetailResource] = useState<DbResource | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [teamOpen, setTeamOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);

  // ── Rate Card ─────────────────────────────────────────────────────────────
  const {
    rateCards, setRateCards, marginThreshold,
    recomputeRateCard, getEffectiveMargin, persistRateCard, deleteRateCard,
  } = useCommercialRules();
  const [editingRateId, setEditingRateId] = useState<string | null>(null);
  const [editRate, setEditRate] = useState<Partial<RateCard>>({});
  const ROLE_LEVELS: RoleLevel[]       = ['Junior', 'Mid', 'Senior', 'Principal'];
  const LOCATION_TYPES: LocationType[] = ['Offshore', 'Onsite', 'Hybrid'];
  const rcAvgMargin   = rateCards.length > 0 ? Math.round(rateCards.reduce((s, r) => s + getEffectiveMargin(r), 0) / rateCards.length) : 0;
  const atRiskCount   = rateCards.filter(r => getEffectiveMargin(r) < marginThreshold).length;
  const marginColor   = (m: number, t: number) =>
    m < t ? 'text-destructive font-bold' : m < t + 10 ? 'text-warning font-medium' : 'text-success font-medium';
  const startEditRate  = (rc: RateCard) => { setEditingRateId(rc.id); setEditRate({ ...rc }); };
  const cancelEditRate = () => { setEditingRateId(null); setEditRate({}); };
  const saveRate = useCallback(() => {
    if (!editingRateId) return;
    const updated = recomputeRateCard({ ...editRate,
      billingRate: Number(editRate.billingRate) || 0, costRate: Number(editRate.costRate) || 0,
      benchPercentage: Number(editRate.benchPercentage) || 0, trainingPercentage: Number(editRate.trainingPercentage) || 0,
      infraPercentage: Number(editRate.infraPercentage) || 0, utilisationRate: Number(editRate.utilisationRate) || 0.80,
    }) as RateCard;
    const final = { ...rateCards.find(r => r.id === editingRateId)!, ...updated } as RateCard;
    setRateCards(prev => prev.map(r => r.id === editingRateId ? final : r));
    persistRateCard(final).catch(() => {});
    toast({ title: '✓ Rate Card Updated', description: `${editRate.skill} saved.` });
    cancelEditRate();
  }, [editingRateId, editRate, rateCards, recomputeRateCard, setRateCards, persistRateCard, toast]);

  const addRateCard = () => {
    const id = `RC-${String(rateCards.length + 1).padStart(3, '0')}`;
    const base: RateCard = {
      id, skill: 'New Role', roleLevel: 'Mid', experienceBand: '4-8 years',
      geography: 'India', locationType: 'Offshore', currency: 'INR',
      billingRate: 100, costRate: 50, benchPercentage: 15, trainingPercentage: 5, infraPercentage: 5,
      costLoadingPercentage: 25, loadedCostRate: 63, utilisationRate: 0.80,
      effectiveCostRate: 63, effectiveLoadedCostRate: 79, margin: 50, marginalMargin: 50,
      absorptionMargin: 37, utilisationAdjustedMarginalMargin: 37, utilisationAdjustedAbsorptionMargin: 21,
    };
    setRateCards(prev => [...prev, base]);
    persistRateCard(base).catch(() => {});
    startEditRate(base);
  };

  const deleteRate = (id: string) => {
    setRateCards(prev => prev.filter(r => r.id !== id));
    deleteRateCard(id).catch(() => {});
    if (editingRateId === id) cancelEditRate();
    toast({ title: '🗑 Removed', description: 'Rate card entry deleted.' });
  };

  // ── Filters ───────────────────────────────────────────────────────────────
  const filtered = resources.filter(r => {
    const matchesSearch = !search || r.name.toLowerCase().includes(search.toLowerCase()) || r.designation.toLowerCase().includes(search.toLowerCase());
    const matchesModule = moduleFilter === 'all' || r.sap_modules.includes(moduleFilter);
    const matchesAvail  = availFilter === 'all' || r.availability === availFilter;
    const matchesGeo    = geoFilter === 'all' || r.geography === geoFilter;
    return matchesSearch && matchesModule && matchesAvail && matchesGeo;
  });

  const available  = resources.filter(r => r.availability === 'Available').length;
  const engaged    = resources.filter(r => r.availability === 'Engaged').length;
  const avgMargin  = resources.length > 0
    ? (resources.reduce((sum, r) => {
        const loaded = r.cost_rate * (1 + r.cost_loading_percentage / 100);
        return sum + (r.billing_rate > 0 ? (r.billing_rate - loaded) / r.billing_rate * 100 : 0);
      }, 0) / resources.length).toFixed(1)
    : '0';
  const geographies = [...new Set(resources.map(r => r.geography))].sort();

  // ── Excel Import ──────────────────────────────────────────────────────────
  const handleDownloadTemplate = () => {
    const headers = ['name','designation','geography','employment_type','availability',
      'years_of_experience','cost_rate','billing_rate','cost_loading_percentage',
      'currency','email','phone','bio','profile_summary',
      'skills','sap_modules','certifications','languages','key_projects'];
    const example = ['Rahul Sharma','SAP Consultant','India','Full-time','Available',
      '5','80','150','20','INR','rahul@example.com','+91 9876543210',
      'Experienced SAP consultant','SAP FI/CO specialist',
      'SAP FI;SAP CO;ABAP','FI;CO;PS','SAP Certified Application Associate','English;Hindi',
      'ICF SAP Implementation;Reliance SAP Migration'];
    const ws = XLSX.utils.aoa_to_sheet([headers, example]);
    ws['!cols'] = headers.map(() => ({ wch: 20 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Resources');
    XLSX.writeFile(wb, 'AIS_Resource_Import_Template.xlsx');
    toast({ title: 'Template downloaded' });
  };

  const handleImportExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, string>>(ws, { defval: '' });
      if (rows.length === 0) { toast({ title: 'No data found', variant: 'destructive' }); return; }
      let success = 0; let errors = 0;
      for (const row of rows) {
        const name = String(row['name'] || '').trim();
        const designation = String(row['designation'] || '').trim();
        if (!name || !designation) { errors++; continue; }
        const resource: Omit<DbResource, 'id' | 'created_at' | 'updated_at'> = {
          name, designation,
          geography: String(row['geography'] || 'India').trim(),
          employment_type: String(row['employment_type'] || 'Full-time').trim(),
          availability: String(row['availability'] || 'Available').trim(),
          years_of_experience: parseInt(String(row['years_of_experience'] || '0')) || 0,
          cost_rate: parseFloat(String(row['cost_rate'] || '0')) || 0,
          billing_rate: parseFloat(String(row['billing_rate'] || '0')) || 0,
          cost_loading_percentage: parseFloat(String(row['cost_loading_percentage'] || '0')) || 0,
          currency: String(row['currency'] || 'INR').trim(),
          email: String(row['email'] || '').trim() || null,
          phone: String(row['phone'] || '').trim() || null,
          bio: String(row['bio'] || '').trim() || null,
          profile_summary: String(row['profile_summary'] || '').trim() || null,
          skills: String(row['skills'] || '').split(';').map(s => s.trim()).filter(Boolean),
          sap_modules: String(row['sap_modules'] || '').split(';').map(s => s.trim()).filter(Boolean),
          certifications: String(row['certifications'] || '').split(';').map(s => s.trim()).filter(Boolean),
          languages: String(row['languages'] || '').split(';').map(s => s.trim()).filter(Boolean),
          key_projects: String(row['key_projects'] || '').split(';').map(s => s.trim()).filter(Boolean),
        };
        try { await createResource.mutateAsync(resource); success++; } catch { errors++; }
      }
      toast({ title: 'Import complete', description: `${success} imported${errors > 0 ? `, ${errors} skipped` : ''}.` });
    } catch (err) {
      toast({ title: 'Import failed', description: String(err), variant: 'destructive' });
    } finally {
      setImporting(false);
      if (importRef.current) importRef.current.value = '';
    }
  };

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleSave = (data: Omit<DbResource, 'id' | 'created_at' | 'updated_at'>) => {
    if (editResource) {
      updateResource.mutate({ id: editResource.id, ...data }, { onSuccess: () => setFormOpen(false) });
    } else {
      createResource.mutate(data, { onSuccess: () => setFormOpen(false) });
    }
  };

  const handleEdit = (r: DbResource) => {
    setEditResource(r);
    setDetailOpen(false);
    setFormOpen(true);
  };

  const [cvGenerating, setCvGenerating] = useState<string | null>(null);
  const [cvLastGen, setCvLastGen] = useState<Record<string, string>>({});

  const checkCVStatus = async (resourceId: string) => {
    const last = await getCVLastGenerated(resourceId);
    if (last) setCvLastGen(prev => ({ ...prev, [resourceId]: last }));
  };

  const handleGenerateCV = async (r: DbResource, isClientFacing = true) => {
    setCvGenerating(r.id);
    try {
      await generateCV(r, isClientFacing);
      const ts = new Date().toLocaleString('en-IN');
      setCvLastGen(prev => ({ ...prev, [r.id]: ts }));
      toast({ title: `✓ CV generated`, description: `${r.name} — ${isClientFacing ? 'Client-facing' : 'Internal'} version downloaded` });
    } catch (e) {
      toast({ title: 'CV generation failed', description: String(e), variant: 'destructive' });
    } finally {
      setCvGenerating(null);
    }
  };

  if (isLoading) return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );

  return (
    <TooltipProvider>
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold font-heading">Resource & CV Builder</h1>
        <p className="text-sm text-muted-foreground">Manage consultant profiles, rate cards and availability</p>
      </div>

      <Tabs defaultValue="consultants">
        <TabsList>
          <TabsTrigger value="consultants">Consultant Pool ({resources.length})</TabsTrigger>
          <TabsTrigger value="ratecard">Rate Card Master ({rateCards.length})</TabsTrigger>
        </TabsList>

        {/* ── Consultant Pool ──────────────────────────────────────────────── */}
        <TabsContent value="consultants" className="space-y-4 mt-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleDownloadTemplate} className="gap-1.5"><Download className="h-4 w-4" />Template</Button>
              <Button variant="outline" onClick={() => importRef.current?.click()} disabled={importing} className="gap-1.5">
                {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {importing ? 'Importing…' : 'Import Excel'}
              </Button>
              <input ref={importRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleImportExcel} />
              <Button variant="outline" onClick={() => setTeamOpen(true)} className="gap-1.5"><UserPlus className="h-4 w-4" />Team Builder</Button>
              <Button onClick={() => { setEditResource(null); setFormOpen(true); }} className="gap-1.5"><Plus className="h-4 w-4" />Add Resource</Button>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-4">
            <StatCard title="Total Resources" value={resources.length} icon={<Users className="h-4 w-4" />} />
            <StatCard title="Available"       value={available}        icon={<Users className="h-4 w-4" />} />
            <StatCard title="Engaged"         value={engaged}          icon={<Users className="h-4 w-4" />} />
            <StatCard title="Avg Margin"      value={`${avgMargin}%`}  icon={<Users className="h-4 w-4" />} />
          </div>

          <div className="flex flex-wrap gap-3">
            <div className="flex items-center gap-2 flex-1 min-w-[200px]">
              <Search className="h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search resources..." value={search} onChange={e => setSearch(e.target.value)} className="h-9" />
            </div>
            <Select value={moduleFilter} onValueChange={setModuleFilter}>
              <SelectTrigger className="w-[160px] h-9"><SelectValue placeholder="SAP Module" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Modules</SelectItem>
                {['FI','CO','MM','SD','PP','QM','PM','ABAP','BASIS','BTP','Fiori','Ariba'].map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={availFilter} onValueChange={setAvailFilter}>
              <SelectTrigger className="w-[180px] h-9"><SelectValue placeholder="Availability" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="Available">Available</SelectItem>
                <SelectItem value="Partially Available">Partially Available</SelectItem>
                <SelectItem value="Engaged">Engaged</SelectItem>
              </SelectContent>
            </Select>
            <Select value={geoFilter} onValueChange={setGeoFilter}>
              <SelectTrigger className="w-[150px] h-9"><SelectValue placeholder="Geography" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Geo</SelectItem>
                {geographies.map(g => <SelectItem key={g} value={g}>{g}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map(r => {
              const loadedCost = r.cost_rate * (1 + r.cost_loading_percentage / 100);
              const margin = r.billing_rate > 0 ? ((r.billing_rate - loadedCost) / r.billing_rate * 100).toFixed(0) : '0';
              return (
                <Card key={r.id} className="enterprise-shadow hover:enterprise-shadow-md transition-shadow cursor-pointer group"
                  onClick={() => { setDetailResource(r); setDetailOpen(true); }}>
                  <CardContent className="pt-4">
                    <div className="flex items-start gap-3">
                      <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary shrink-0">
                        {r.name.split(' ').map(n => n[0]).join('')}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium">{r.name}</p>
                        <p className="text-xs text-muted-foreground">{r.designation}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <StatusBadge status={r.availability} />
                          <span className="text-xs text-muted-foreground">{r.years_of_experience} yrs</span>
                          <span className="text-xs text-muted-foreground">{r.geography}</span>
                        </div>
                        <div className="flex flex-wrap gap-1 mt-2">
                          {r.sap_modules.map(m => <span key={m} className="text-[10px] px-1.5 py-0.5 rounded bg-primary/5 text-primary font-medium">{m}</span>)}
                        </div>
                        <div className="flex items-center justify-between mt-2">
                          <span className="text-xs text-muted-foreground">{r.employment_type} · {r.currency} {r.billing_rate}/hr</span>
                          <span className={`text-xs font-medium ${parseInt(margin) >= 30 ? 'text-green-600' : parseInt(margin) >= 15 ? 'text-amber-600' : 'text-destructive'}`}>{margin}% margin</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-1.5 mt-3 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={e => { e.stopPropagation(); handleEdit(r); }}>Edit</Button>
                      <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                      {cvGenerating === r.id
                        ? <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                        : <>
                          <Button size="sm" variant="outline" className="h-7 text-xs gap-1" title="Generate client-facing CV" onClick={() => handleGenerateCV(r, true)}>
                            <FileText className="h-3 w-3" /> CV
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 text-muted-foreground" title="Generate internal CV (with rates)" onClick={() => handleGenerateCV(r, false)}>
                            <FileText className="h-3 w-3" /> Internal
                          </Button>
                        </>}
                      {cvLastGen[r.id] && <span className="text-[10px] text-muted-foreground ml-1" title={`Last generated: ${cvLastGen[r.id]}`}>✓</span>}
                    </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {filtered.length === 0 && !isLoading && (
            <div className="text-center py-12 text-muted-foreground">
              <Users className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p>No resources match filters</p>
            </div>
          )}
        </TabsContent>

        {/* ── Rate Card Master ─────────────────────────────────────────────── */}
        <TabsContent value="ratecard" className="space-y-4 mt-4">
          <div className="grid grid-cols-3 gap-4">
            <StatCard title="Rate Card Entries" value={rateCards.length}  icon={<Users className="h-4 w-4" />} />
            <StatCard title="Avg Margin"         value={`${rcAvgMargin}%`} icon={<Users className="h-4 w-4" />} />
            <StatCard title="At-Risk Rates"      value={atRiskCount}       icon={<Users className="h-4 w-4" />} />
          </div>
          <Card className="enterprise-shadow">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="font-heading">Rate Card Master</CardTitle>
                <CardDescription>Bench% + Training% + Infra% loading. Utilisation adjusts effective cost per billable hour.</CardDescription>
              </div>
              <Button size="sm" variant="outline" onClick={addRateCard}><Plus className="h-3 w-3 mr-1" /> Add Rate</Button>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="pb-3 font-medium text-muted-foreground min-w-[140px]">Role</th>
                      <th className="pb-3 font-medium text-muted-foreground">Level</th>
                      <th className="pb-3 font-medium text-muted-foreground">Geo / Type</th>
                      <th className="pb-3 font-medium text-muted-foreground">Billing</th>
                      <th className="pb-3 font-medium text-muted-foreground">Cost</th>
                      <th className="pb-3 font-medium text-muted-foreground">Loading</th>
                      <th className="pb-3 font-medium text-muted-foreground">Util%</th>
                      <th className="pb-3 font-medium text-muted-foreground">Marg%</th>
                      <th className="pb-3 font-medium text-muted-foreground">Abs%</th>
                      <th className="pb-3 font-medium text-muted-foreground text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rateCards.map(r => (
                      <tr key={r.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                        {editingRateId === r.id ? (
                          <>
                            <td className="py-2"><Input className="h-7 text-xs w-36" value={editRate.skill || ''} onChange={e => setEditRate(p => ({ ...p, skill: e.target.value }))} /></td>
                            <td className="py-2">
                              <Select value={editRate.roleLevel || 'Mid'} onValueChange={v => setEditRate(p => ({ ...p, roleLevel: v as RoleLevel }))}>
                                <SelectTrigger className="h-7 w-24 text-xs"><SelectValue /></SelectTrigger>
                                <SelectContent>{ROLE_LEVELS.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent>
                              </Select>
                            </td>
                            <td className="py-2 space-y-1">
                              <Input className="h-7 text-xs w-20" value={editRate.geography || ''} onChange={e => setEditRate(p => ({ ...p, geography: e.target.value }))} />
                              <Select value={editRate.locationType || 'Offshore'} onValueChange={v => setEditRate(p => ({ ...p, locationType: v as LocationType }))}>
                                <SelectTrigger className="h-7 w-24 text-xs"><SelectValue /></SelectTrigger>
                                <SelectContent>{LOCATION_TYPES.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent>
                              </Select>
                            </td>
                            <td className="py-2"><Input type="number" className="h-7 text-xs w-16" value={editRate.billingRate || ''} onChange={e => setEditRate(p => ({ ...p, billingRate: Number(e.target.value) }))} /></td>
                            <td className="py-2"><Input type="number" className="h-7 text-xs w-16" value={editRate.costRate || ''} onChange={e => setEditRate(p => ({ ...p, costRate: Number(e.target.value) }))} /></td>
                            <td className="py-2">
                              <div className="flex gap-1">
                                <Input type="number" className="h-7 text-xs w-10" placeholder="B%" value={editRate.benchPercentage ?? ''} onChange={e => setEditRate(p => ({ ...p, benchPercentage: Number(e.target.value) }))} />
                                <Input type="number" className="h-7 text-xs w-10" placeholder="T%" value={editRate.trainingPercentage ?? ''} onChange={e => setEditRate(p => ({ ...p, trainingPercentage: Number(e.target.value) }))} />
                                <Input type="number" className="h-7 text-xs w-10" placeholder="I%" value={editRate.infraPercentage ?? ''} onChange={e => setEditRate(p => ({ ...p, infraPercentage: Number(e.target.value) }))} />
                              </div>
                            </td>
                            <td className="py-2"><Input type="number" step="0.01" className="h-7 text-xs w-16" value={editRate.utilisationRate || ''} onChange={e => setEditRate(p => ({ ...p, utilisationRate: Number(e.target.value) }))} placeholder="0.80" /></td>
                            <td className="py-2 text-muted-foreground italic text-xs">auto</td>
                            <td className="py-2 text-muted-foreground italic text-xs">auto</td>
                            <td className="py-2 text-right">
                              <Button size="icon" variant="ghost" className="h-7 w-7 text-success" onClick={saveRate}><Check className="h-3.5 w-3.5" /></Button>
                              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={cancelEditRate}><X className="h-3.5 w-3.5" /></Button>
                            </td>
                          </>
                        ) : (
                          <>
                            <td className="py-2 font-medium"><div>{r.skill}</div><div className="text-muted-foreground text-[10px]">{r.experienceBand}</div></td>
                            <td className="py-2"><span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${r.roleLevel === 'Principal' ? 'bg-primary/10 text-primary border-primary/20' : r.roleLevel === 'Senior' ? 'bg-info/10 text-info border-info/20' : r.roleLevel === 'Mid' ? 'bg-warning/10 text-warning border-warning/20' : 'bg-muted text-muted-foreground border-border'}`}>{r.roleLevel}</span></td>
                            <td className="py-2"><div>{r.geography}</div><span className={`text-[10px] px-1 py-0.5 rounded font-medium ${r.locationType === 'Offshore' ? 'text-success' : r.locationType === 'Onsite' ? 'text-warning' : 'text-info'}`}>{r.locationType}</span></td>
                            <td className="py-2 font-medium">{r.currency} {r.billingRate}/hr</td>
                            <td className="py-2 text-muted-foreground">{r.costRate}/hr</td>
                            <td className="py-2">
                              <Tooltip><TooltipTrigger><span className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">{r.costLoadingPercentage}%</span></TooltipTrigger>
                                <TooltipContent>Bench: {r.benchPercentage}% · Training: {r.trainingPercentage}% · Infra: {r.infraPercentage}%</TooltipContent>
                              </Tooltip>
                            </td>
                            <td className="py-2 font-mono">{Math.round(r.utilisationRate * 100)}%</td>
                            <td className="py-2"><span className={marginColor(r.marginalMargin, 30)}>{r.marginalMargin}%</span></td>
                            <td className="py-2"><span className={marginColor(r.absorptionMargin, 20)}>{r.absorptionMargin}%</span></td>
                            <td className="py-2 text-right">
                              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => startEditRate(r)}><Pencil className="h-3.5 w-3.5" /></Button>
                              <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => deleteRate(r.id)}><TrendingDown className="h-3.5 w-3.5" /></Button>
                            </td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <ResourceFormDialog open={formOpen} onOpenChange={setFormOpen} resource={editResource} onSave={handleSave}
        saving={createResource.isPending || updateResource.isPending} />
      <ResourceDetailSheet resource={detailResource} open={detailOpen} onOpenChange={setDetailOpen}
        onEdit={handleEdit} onDelete={id => deleteResource.mutate(id)} onGenerateCV={handleGenerateCV} />
      <TeamBuilderDialog open={teamOpen} onOpenChange={setTeamOpen} resources={resources} />
    </div>
    </TooltipProvider>
  );
}