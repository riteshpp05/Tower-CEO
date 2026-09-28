import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatusBadge } from '@/components/StatusBadge';
import { StatCard } from '@/components/StatCard';
import { useToast } from '@/hooks/use-toast';
import { listTenders, deleteTender } from '@/lib/tenderEngine';
import type { TenderRecord } from '@/lib/tenderEngine';
import {
  ClipboardCheck, Plus, Search, FileText, Loader2,
  CheckCircle2, AlertTriangle, Trash2, ArrowRight,
} from 'lucide-react';

type TenderIndexEntry = Pick<TenderRecord, 'id' | 'title' | 'clientName' | 'status' | 'updatedAt'>;

const STATUS_BADGE_LABEL: Record<TenderRecord['status'], string> = {
  extracting: 'Pending',
  extracted: 'Compliant',
  reviewed: 'Approved',
  error: 'Non-Compliant',
};

const STATUS_DISPLAY_LABEL: Record<TenderRecord['status'], string> = {
  extracting: 'Extracting...',
  extracted: 'Extracted -- needs review',
  reviewed: 'Reviewed',
  error: 'Extraction failed',
};

export default function TenderEnginePage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [entries, setEntries] = useState<TenderIndexEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const list = await listTenders();
    setEntries(list);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = entries.filter(e => {
    if (!search) return true;
    const q = search.toLowerCase();
    return e.title.toLowerCase().includes(q) || e.clientName.toLowerCase().includes(q) || e.id.toLowerCase().includes(q);
  });

  const extractedCount = entries.filter(e => e.status === 'extracted' || e.status === 'reviewed').length;
  const reviewedCount = entries.filter(e => e.status === 'reviewed').length;
  const errorCount = entries.filter(e => e.status === 'error').length;

  const handleDelete = async (id: string, title: string) => {
    if (!window.confirm(`Delete tender "${title}"? This cannot be undone.`)) return;
    setDeletingId(id);
    try {
      await deleteTender(id);
      toast({ title: 'Tender deleted', description: title });
      await load();
    } catch {
      toast({ title: 'Failed to delete tender', variant: 'destructive' });
    } finally {
      setDeletingId(null);
    }
  };

  const openTender = (id: string, status: TenderRecord['status']) => {
    if (status === 'extracting') {
      navigate(`/tender/${id}/brief`);
      return;
    }
    navigate(`/tender/${id}/brief`);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold font-heading">Tender Response Engine</h1>
          <p className="text-sm text-muted-foreground">
            Upload a tender/RFP document to extract the bid brief, qualification criteria, and build the submission package -- with zero hallucination.
          </p>
        </div>
        <Button onClick={() => navigate('/tender/new')}>
          <Plus className="h-4 w-4 mr-2" /> New Tender
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard title="Tenders Extracted" value={extractedCount} icon={<FileText className="h-4 w-4" />} className="border-info/20" />
        <StatCard title="Reviewed" value={reviewedCount} icon={<CheckCircle2 className="h-4 w-4" />} className="border-success/20" />
        <StatCard title="Extraction Errors" value={errorCount} icon={<AlertTriangle className="h-4 w-4" />} className="border-destructive/20" />
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search tenders by title, client, or ID..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      <Card className="enterprise-shadow">
        <CardContent className="pt-6">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading tenders...
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center gap-3">
              <div className="rounded-full bg-muted p-4">
                <ClipboardCheck className="h-8 w-8 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground max-w-sm">
                {entries.length === 0
                  ? 'No tenders yet. Upload a tender/RFP document to get started.'
                  : 'No tenders match your search.'}
              </p>
              {entries.length === 0 && (
                <Button onClick={() => navigate('/tender/new')}>
                  <Plus className="h-4 w-4 mr-2" /> New Tender
                </Button>
              )}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="pb-3 font-medium text-muted-foreground">Tender</th>
                  <th className="pb-3 font-medium text-muted-foreground">Client</th>
                  <th className="pb-3 font-medium text-muted-foreground">Status</th>
                  <th className="pb-3 font-medium text-muted-foreground">Last Updated</th>
                  <th className="pb-3 font-medium text-muted-foreground"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(e => (
                  <tr key={e.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="py-3">
                      <button className="text-left font-medium hover:underline" onClick={() => openTender(e.id, e.status)}>
                        {e.title}
                      </button>
                      <p className="text-xs text-muted-foreground">{e.id}</p>
                    </td>
                    <td className="py-3 text-foreground/80">{e.clientName}</td>
                    <td className="py-3">
                      <StatusBadge status={STATUS_BADGE_LABEL[e.status]} />
                      <p className="text-xs text-muted-foreground mt-1">{STATUS_DISPLAY_LABEL[e.status]}</p>
                    </td>
                    <td className="py-3 text-xs text-muted-foreground">
                      {new Date(e.updatedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </td>
                    <td className="py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => openTender(e.id, e.status)}>
                          Open <ArrowRight className="h-3.5 w-3.5 ml-1" />
                        </Button>
                        <Button
                          variant="ghost" size="sm"
                          disabled={deletingId === e.id}
                          onClick={() => handleDelete(e.id, e.title)}
                          className="text-destructive hover:text-destructive"
                        >
                          {deletingId === e.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
