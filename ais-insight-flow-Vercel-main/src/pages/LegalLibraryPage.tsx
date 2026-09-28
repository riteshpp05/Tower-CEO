import { useState, useMemo } from 'react';
import { legalClauses as initialClauses } from '@/data/mockData';
import type { LegalClause } from '@/data/mockData';
import { StatusBadge } from '@/components/StatusBadge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import {
  Plus, Search, Copy, Pencil, Trash2, ChevronDown, ChevronUp, Scale, Filter,
} from 'lucide-react';

const CATEGORIES = ['NDA', 'Confidentiality', 'IP', 'Limitation of Liability', 'Indemnity', 'Termination', 'Governing Law', 'Force Majeure', 'Non-Solicitation', 'Arbitration', 'Other'];

const emptyForm = (): Omit<LegalClause, 'id'> => ({
  category: '',
  title: '',
  version: '1.0',
  standardText: '',
  status: 'Active',
  lastUpdated: new Date().toISOString().slice(0, 10),
  notes: '',
});

export default function LegalLibraryPage() {
  const { toast } = useToast();
  const [clauses, setClauses] = useState<LegalClause[]>(initialClauses);
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState<string>('All');
  const [filterStatus, setFilterStatus] = useState<string>('All');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingClause, setEditingClause] = useState<LegalClause | null>(null);
  const [form, setForm] = useState<Omit<LegalClause, 'id'>>(emptyForm());
  const [formErrors, setFormErrors] = useState<Partial<Record<keyof LegalClause, string>>>({});

  // Delete confirm state
  const [deleteTarget, setDeleteTarget] = useState<LegalClause | null>(null);

  // ── Filtering ────────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return clauses.filter(c => {
      const matchSearch =
        !search ||
        c.title.toLowerCase().includes(search.toLowerCase()) ||
        c.category.toLowerCase().includes(search.toLowerCase()) ||
        c.standardText.toLowerCase().includes(search.toLowerCase());
      const matchCat = filterCategory === 'All' || c.category === filterCategory;
      const matchStatus = filterStatus === 'All' || c.status === filterStatus;
      return matchSearch && matchCat && matchStatus;
    });
  }, [clauses, search, filterCategory, filterStatus]);

  const categories = useMemo(() => ['All', ...Array.from(new Set(clauses.map(c => c.category)))], [clauses]);

  // ── Helpers ──────────────────────────────────────────────────────────────────
  const nextId = () => {
    const nums = clauses.map(c => parseInt(c.id.replace('LC-', ''), 10)).filter(Boolean);
    return `LC-${String(Math.max(0, ...nums) + 1).padStart(3, '0')}`;
  };

  const validate = (f: Omit<LegalClause, 'id'>) => {
    const errs: Partial<Record<keyof LegalClause, string>> = {};
    if (!f.title.trim()) errs.title = 'Title is required';
    if (!f.category) errs.category = 'Category is required';
    if (!f.standardText.trim()) errs.standardText = 'Clause text is required';
    if (!f.version.trim()) errs.version = 'Version is required';
    return errs;
  };

  // ── Open Add / Edit ──────────────────────────────────────────────────────────
  const openAdd = () => {
    setEditingClause(null);
    setForm(emptyForm());
    setFormErrors({});
    setDialogOpen(true);
  };

  const openEdit = (clause: LegalClause) => {
    setEditingClause(clause);
    const { id, ...rest } = clause;
    setForm(rest);
    setFormErrors({});
    setDialogOpen(true);
  };

  // ── Save ─────────────────────────────────────────────────────────────────────
  const handleSave = () => {
    const errs = validate(form);
    if (Object.keys(errs).length) { setFormErrors(errs); return; }

    if (editingClause) {
      setClauses(prev => prev.map(c => c.id === editingClause.id ? { ...form, id: editingClause.id, lastUpdated: new Date().toISOString().slice(0, 10) } : c));
      toast({ title: 'Clause updated', description: `${form.title} has been updated.` });
    } else {
      const newClause: LegalClause = { ...form, id: nextId(), lastUpdated: new Date().toISOString().slice(0, 10) };
      setClauses(prev => [newClause, ...prev]);
      toast({ title: 'Clause added', description: `${form.title} has been added to the library.` });
    }
    setDialogOpen(false);
  };

  // ── Delete ───────────────────────────────────────────────────────────────────
  const handleDelete = () => {
    if (!deleteTarget) return;
    setClauses(prev => prev.filter(c => c.id !== deleteTarget.id));
    toast({ title: 'Clause deleted', description: `${deleteTarget.title} has been removed.`, variant: 'destructive' });
    setDeleteTarget(null);
  };

  // ── Toggle Status ────────────────────────────────────────────────────────────
  const toggleStatus = (clause: LegalClause) => {
    const next = clause.status === 'Active' ? 'Inactive' : 'Active';
    setClauses(prev => prev.map(c => c.id === clause.id ? { ...c, status: next, lastUpdated: new Date().toISOString().slice(0, 10) } : c));
    toast({ title: `Clause ${next.toLowerCase()}`, description: `${clause.title} is now ${next.toLowerCase()}.` });
  };

  // ── Copy ─────────────────────────────────────────────────────────────────────
  const copyText = (clause: LegalClause) => {
    navigator.clipboard.writeText(clause.standardText);
    toast({ title: 'Copied to clipboard', description: `${clause.title} text copied.` });
  };

  return (
    <div className="space-y-6 animate-fade-in">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold font-heading">Legal Clause Library</h1>
          <p className="text-sm text-muted-foreground">
            {clauses.length} clauses · {clauses.filter(c => c.status === 'Active').length} active
          </p>
        </div>
        <Button onClick={openAdd}>
          <Plus className="h-4 w-4 mr-2" /> New Clause
        </Button>
      </div>

      {/* Search & Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search by title, category or text…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <Select value={filterCategory} onValueChange={setFilterCategory}>
          <SelectTrigger className="w-48">
            <Filter className="h-3.5 w-3.5 mr-2 text-muted-foreground" />
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            {categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="All">All Status</SelectItem>
            <SelectItem value="Active">Active</SelectItem>
            <SelectItem value="Inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Results count */}
      {(search || filterCategory !== 'All' || filterStatus !== 'All') && (
        <p className="text-sm text-muted-foreground">
          Showing {filtered.length} of {clauses.length} clauses
          <button className="ml-2 text-primary hover:underline text-xs" onClick={() => { setSearch(''); setFilterCategory('All'); setFilterStatus('All'); }}>
            Clear filters
          </button>
        </p>
      )}

      {/* Clause Cards */}
      {filtered.length === 0 ? (
        <Card className="enterprise-shadow">
          <CardContent className="py-16 text-center">
            <Scale className="h-10 w-10 text-muted-foreground mx-auto mb-3 opacity-40" />
            <p className="text-sm text-muted-foreground">No clauses match your filters.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {filtered.map(clause => {
            const isExpanded = expandedId === clause.id;
            return (
              <Card key={clause.id} className={`enterprise-shadow transition-all ${clause.status === 'Inactive' ? 'opacity-60' : ''}`}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-3">
                    {/* Left: ID + Title + Tags */}
                    <div className="flex items-center gap-3 flex-wrap min-w-0">
                      <span className="text-xs font-mono text-primary shrink-0">{clause.id}</span>
                      <CardTitle className="text-base font-heading">{clause.title}</CardTitle>
                      <Badge variant="outline" className="text-xs shrink-0">{clause.category}</Badge>
                    </div>
                    {/* Right: Version + Status + Actions */}
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs text-muted-foreground">v{clause.version}</span>
                      <StatusBadge status={clause.status} />
                      <Button size="icon" variant="ghost" className="h-7 w-7" title="Copy clause text" onClick={() => copyText(clause)}>
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7" title="Edit clause" onClick={() => openEdit(clause)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7 hover:text-destructive" title="Delete clause" onClick={() => setDeleteTarget(clause)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setExpandedId(isExpanded ? null : clause.id)}>
                        {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                      </Button>
                    </div>
                  </div>
                </CardHeader>

                <CardContent>
                  {/* Always visible: truncated text */}
                  {!isExpanded && (
                    <p className="text-sm text-foreground/80 leading-relaxed line-clamp-2 cursor-pointer" onClick={() => setExpandedId(clause.id)}>
                      {clause.standardText}
                    </p>
                  )}

                  {/* Expanded: full content */}
                  {isExpanded && (
                    <div className="space-y-3">
                      <div className="bg-muted/40 rounded-md p-4 border border-border">
                        <p className="text-sm leading-relaxed whitespace-pre-wrap">{clause.standardText}</p>
                      </div>
                      {clause.notes && (
                        <p className="text-xs text-muted-foreground italic">
                          <span className="font-medium not-italic text-foreground/70">Note: </span>{clause.notes}
                        </p>
                      )}
                      <div className="flex items-center justify-between pt-1">
                        <p className="text-xs text-muted-foreground">
                          Last updated: {new Date(clause.lastUpdated).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </p>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-xs h-7"
                          onClick={() => toggleStatus(clause)}
                        >
                          Mark as {clause.status === 'Active' ? 'Inactive' : 'Active'}
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* ── Add / Edit Dialog ──────────────────────────────────────────────────── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-heading text-lg">
              {editingClause ? 'Edit Clause' : 'New Legal Clause'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Title */}
            <div className="space-y-1.5">
              <Label htmlFor="cl-title">Title <span className="text-destructive">*</span></Label>
              <Input
                id="cl-title"
                value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder="e.g. Standard Non-Disclosure Agreement"
              />
              {formErrors.title && <p className="text-xs text-destructive">{formErrors.title}</p>}
            </div>

            <div className="grid grid-cols-2 gap-4">
              {/* Category */}
              <div className="space-y-1.5">
                <Label>Category <span className="text-destructive">*</span></Label>
                <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v }))}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
                {formErrors.category && <p className="text-xs text-destructive">{formErrors.category}</p>}
              </div>

              {/* Version */}
              <div className="space-y-1.5">
                <Label htmlFor="cl-version">Version <span className="text-destructive">*</span></Label>
                <Input
                  id="cl-version"
                  value={form.version}
                  onChange={e => setForm(f => ({ ...f, version: e.target.value }))}
                  placeholder="e.g. 1.0"
                />
                {formErrors.version && <p className="text-xs text-destructive">{formErrors.version}</p>}
              </div>
            </div>

            {/* Status */}
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v as 'Active' | 'Inactive' }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Active">Active</SelectItem>
                  <SelectItem value="Inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Standard Text */}
            <div className="space-y-1.5">
              <Label htmlFor="cl-text">Standard Clause Text <span className="text-destructive">*</span></Label>
              <Textarea
                id="cl-text"
                value={form.standardText}
                onChange={e => setForm(f => ({ ...f, standardText: e.target.value }))}
                placeholder="Enter the full legal clause text…"
                rows={6}
                className="resize-y font-mono text-sm"
              />
              {formErrors.standardText && <p className="text-xs text-destructive">{formErrors.standardText}</p>}
            </div>

            {/* Notes */}
            <div className="space-y-1.5">
              <Label htmlFor="cl-notes">Notes / Usage Guidelines</Label>
              <Textarea
                id="cl-notes"
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Optional: when to use this clause, approvals needed, exceptions…"
                rows={2}
                className="resize-y"
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button onClick={handleSave}>
              {editingClause ? 'Save Changes' : 'Add Clause'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirmation ────────────────────────────────────────────────── */}
      <AlertDialog open={!!deleteTarget} onOpenChange={open => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Clause?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <span className="font-medium text-foreground">{deleteTarget?.title}</span>? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={handleDelete}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
}