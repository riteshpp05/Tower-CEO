import { useParams, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { StatusBadge } from '@/components/StatusBadge';
import { useToast } from '@/hooks/use-toast';
import { TenderDetailHeader } from '@/components/TenderDetailHeader';
import { useTender } from '@/hooks/useTender';
import { CoverLetterStep } from '@/components/CoverLetterStep';
import { exportTenderSubmissionToWord } from '@/lib/exportTenderSubmission';
import type { AnnexureItem, CoverLetterData } from '@/lib/tenderEngine';
import {
  Loader2, ArrowLeft, FileSignature, FolderCheck, FileEdit, Table2, Paperclip,
  Download, CheckCircle2, Circle,
} from 'lucide-react';
import { SaveStatusIndicator, type SaveState } from '@/components/SaveStatusIndicator';

const KIND_META: Record<AnnexureItem['kind'], { label: string; icon: typeof FileEdit; hint: string }> = {
  fill_form: {
    label: 'Fixed Format — Fill In',
    icon: FileEdit,
    hint: 'The tender provides this exact format. Complete it below, matching the structure shown.',
  },
  data_table: {
    label: 'Data Table — Compile',
    icon: Table2,
    hint: 'No template is given — compile this from AIS records (e.g. similar projects, key personnel).',
  },
  checklist_only: {
    label: 'Attach Separately',
    icon: Paperclip,
    hint: 'A static or third-party document (certificate, financial statement, etc.) — not drafted here, just confirm it is ready.',
  },
};

function AnnexureCard({
  annexure, onChange,
}: {
  annexure: AnnexureItem;
  onChange: (next: AnnexureItem) => void;
}) {
  const meta = KIND_META[annexure.kind];
  const Icon = meta.icon;
  const isReady = annexure.status === 'ready';

  const setContent = (filledContent: string) => {
    const status: AnnexureItem['status'] = filledContent.trim() ? 'drafted' : 'pending';
    onChange({ ...annexure, filledContent, status });
  };

  const toggleReady = () => {
    onChange({ ...annexure, status: isReady ? 'drafted' : 'ready' });
  };

  return (
    <Card className="enterprise-shadow">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <CardTitle className="font-heading text-sm flex items-center gap-2">
            <Icon className="h-4 w-4 text-primary" /> {annexure.name}
          </CardTitle>
          <button onClick={toggleReady} className="flex items-center gap-1.5 text-xs font-medium">
            {isReady ? <CheckCircle2 className="h-4 w-4 text-success" /> : <Circle className="h-4 w-4 text-muted-foreground" />}
            <span className={isReady ? 'text-success' : 'text-muted-foreground'}>{isReady ? 'Ready' : 'Mark ready'}</span>
          </button>
        </div>
        <p className="text-xs text-muted-foreground">{meta.label} — {meta.hint}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {annexure.kind === 'fill_form' && annexure.sourceFormat && (
          <div className="rounded-lg bg-muted/40 border p-3">
            <p className="text-xs font-medium text-muted-foreground mb-1">Source format (as per tender document)</p>
            <p className="text-xs text-foreground/80 whitespace-pre-wrap">{annexure.sourceFormat}</p>
          </div>
        )}

        {annexure.kind === 'checklist_only' ? (
          <Textarea
            placeholder="Optional notes (e.g. where this document is stored, who owns it)…"
            value={annexure.filledContent ?? ''}
            onChange={e => setContent(e.target.value)}
            rows={2}
          />
        ) : (
          <Textarea
            placeholder={annexure.kind === 'fill_form' ? 'Fill in this format with AIS details…' : 'Compile the data for this table…'}
            value={annexure.filledContent ?? ''}
            onChange={e => setContent(e.target.value)}
            rows={5}
          />
        )}
      </CardContent>
    </Card>
  );
}

export default function TenderSubmissionPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { tender, loading, notFound, save } = useTender(id);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [exporting, setExporting] = useState(false);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span className="ml-3 text-muted-foreground">Loading tender…</span>
      </div>
    );
  }

  if (notFound || !tender) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <p className="text-muted-foreground">Tender not found</p>
        <Button variant="outline" onClick={() => navigate('/tender')}>
          <ArrowLeft className="h-4 w-4 mr-2" /> Back to Tender Engine
        </Button>
      </div>
    );
  }

  if (tender.status === 'extracting') {
    return (
      <div className="space-y-6 animate-fade-in">
        <TenderDetailHeader tender={tender} active="submission" />
        <div className="flex items-center justify-center h-48 gap-2 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" /> Extraction still in progress…
        </div>
      </div>
    );
  }

  const updateCoverLetter = async (coverLetter: CoverLetterData) => {
    setSaveState('saving');
    try {
      await save({ ...tender, submission: { ...tender.submission, coverLetter } });
      setSaveState('saved');
      setLastSavedAt(new Date());
    } catch {
      setSaveState('error');
      toast({ title: 'Failed to save covering letter', variant: 'destructive' });
    }
  };

  const updateAnnexure = async (next: AnnexureItem) => {
    setSaveState('saving');
    try {
      const annexures = tender.submission.annexures.map(a => (a.id === next.id ? next : a));
      await save({ ...tender, submission: { ...tender.submission, annexures } });
      setSaveState('saved');
      setLastSavedAt(new Date());
    } catch {
      setSaveState('error');
      toast({ title: 'Failed to save annexure', variant: 'destructive' });
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      await exportTenderSubmissionToWord(tender);
      toast({ title: 'Submission package exported', description: 'Word document downloaded.' });
    } catch (err) {
      toast({
        title: 'Export failed',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setExporting(false);
    }
  };

  const annexures = tender.submission.annexures;
  const readyCount = annexures.filter(a => a.status === 'ready').length;

  return (
    <div className="space-y-6 animate-fade-in">
      <TenderDetailHeader tender={tender} active="submission" />

      <div className="flex items-center justify-between gap-4 flex-wrap">
        <p className="text-sm text-muted-foreground max-w-2xl">
          Prepare every document required to file this tender: the mandatory covering letter, plus any annexures or formats the tender document itself prescribes.
        </p>
        <div className="flex items-center gap-2">
          <SaveStatusIndicator state={saveState} lastSavedAt={lastSavedAt} />
          <Button onClick={handleExport} disabled={exporting}>
            {exporting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
            Export Submission Package (.docx)
          </Button>
        </div>
      </div>

      <Card className="enterprise-shadow">
        <CardHeader>
          <CardTitle className="font-heading text-base flex items-center gap-2">
            <FileSignature className="h-4 w-4 text-primary" /> Covering Letter
            <span className="text-xs font-normal text-muted-foreground">(mandatory)</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <CoverLetterStep data={tender.submission.coverLetter} onChange={updateCoverLetter} />
        </CardContent>
      </Card>

      <Card className="enterprise-shadow">
        <CardHeader>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <CardTitle className="font-heading text-base flex items-center gap-2">
              <FolderCheck className="h-4 w-4 text-primary" /> Annexures & Formats
            </CardTitle>
            <StatusBadge status={readyCount === annexures.length && annexures.length > 0 ? 'Compliant' : 'Pending'} />
          </div>
          <p className="text-xs text-muted-foreground">
            {annexures.length > 0
              ? `${readyCount} of ${annexures.length} marked ready — detected directly from the tender document.`
              : 'No annexures were detected in this tender document.'}
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {annexures.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">
              If the tender document does include annexures that weren't detected, you can re-upload it on the New Tender page to re-run extraction.
            </p>
          ) : (
            annexures.map(a => <AnnexureCard key={a.id} annexure={a} onChange={updateAnnexure} />)
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between gap-2">
        <Button variant="outline" onClick={() => navigate(`/tender/${tender.id}/qualification`)}>
          <ArrowLeft className="h-4 w-4 mr-2" /> Back: Qualification Criteria
        </Button>
      </div>
    </div>
  );
}