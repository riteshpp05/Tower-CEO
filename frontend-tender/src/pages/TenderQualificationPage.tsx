import { useParams, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/StatusBadge';
import { StatCard } from '@/components/StatCard';
import { useToast } from '@/hooks/use-toast';
import { TenderDetailHeader } from '@/components/TenderDetailHeader';
import { useTender } from '@/hooks/useTender';
import { computeQualificationSummary, computeScoreSummary } from '@/lib/tenderEngine';
import type { QualificationItem, TenderRecord } from '@/lib/tenderEngine';
import {
  Loader2, ArrowLeft, ArrowRight, ShieldCheck, Award, Banknote, AlertOctagon,
  CheckCircle2, XCircle, HelpCircle,
} from 'lucide-react';
import { SaveStatusIndicator, type SaveState } from '@/components/SaveStatusIndicator';

const MET_CYCLE: QualificationItem['met'][] = ['unverified', 'yes', 'no'];

const MET_STYLE: Record<QualificationItem['met'], { label: string; classes: string; icon: typeof CheckCircle2 }> = {
  yes: { label: 'Met', classes: 'bg-success/10 text-success border-success/20', icon: CheckCircle2 },
  no: { label: 'Not Met', classes: 'bg-destructive/10 text-destructive border-destructive/20', icon: XCircle },
  unverified: { label: 'Unverified', classes: 'bg-muted text-muted-foreground border-border', icon: HelpCircle },
};

function QualificationRow({
  item, scored, onCycleMet,
}: {
  item: QualificationItem;
  scored: boolean;
  onCycleMet: (id: string) => void;
}) {
  const metStyle = MET_STYLE[item.met];
  const MetIcon = metStyle.icon;
  const confidenceFaint = item.confidence === 'not_found';

  return (
    <tr className="border-b last:border-0 align-top">
      <td className="py-3 pr-3 max-w-[220px]">
        <p className="text-sm font-medium">{item.label}</p>
        <p className={confidenceFaint ? 'text-xs text-muted-foreground italic mt-0.5' : 'text-xs text-foreground/80 mt-0.5'}>{item.value}</p>
        {item.sourceQuote && (
          <p className="text-[11px] text-muted-foreground border-l-2 border-border pl-1.5 mt-1 italic">"{item.sourceQuote}"</p>
        )}
      </td>
      <td className="py-3 pr-3 max-w-[200px] text-xs text-foreground/80">
        {item.aisEvidence || <span className="text-muted-foreground italic">No matching AIS evidence on file</span>}
      </td>
      {scored && (
        <td className="py-3 pr-3 text-xs text-center whitespace-nowrap">
          {item.maxMarks != null ? (
            <span>{item.maxMarks} marks{item.weightage != null ? ` (${item.weightage}%)` : ''}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </td>
      )}
      <td className="py-3">
        <button
          onClick={() => onCycleMet(item.id)}
          className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${metStyle.classes}`}
          title="Click to cycle: Unverified -> Met -> Not Met"
        >
          <MetIcon className="h-3 w-3" /> {metStyle.label}
        </button>
      </td>
    </tr>
  );
}

function QualificationTable({
  title, icon: Icon, items, scored, onCycleMet,
}: {
  title: string;
  icon: typeof ShieldCheck;
  items: QualificationItem[];
  scored: boolean;
  onCycleMet: (id: string) => void;
}) {
  return (
    <Card className="enterprise-shadow">
      <CardHeader>
        <CardTitle className="font-heading text-base flex items-center gap-2">
          <Icon className="h-4 w-4 text-primary" /> {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">No items extracted.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="pb-2 font-medium text-muted-foreground">Requirement</th>
                <th className="pb-2 font-medium text-muted-foreground">AIS Evidence</th>
                {scored && <th className="pb-2 font-medium text-muted-foreground text-center">Marks</th>}
                <th className="pb-2 font-medium text-muted-foreground">Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map(item => (
                <QualificationRow key={item.id} item={item} scored={scored} onCycleMet={onCycleMet} />
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

const TENDER_MODE_LABEL: Record<TenderRecord['qualification']['tenderMode'], string> = {
  'eligibility-only': 'Eligibility-Only (Pass/Fail)',
  scored: 'Scored Technical Evaluation',
  unknown: 'Could Not Determine',
};

export default function TenderQualificationPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { tender, loading, notFound, save } = useTender(id);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);

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
        <TenderDetailHeader tender={tender} active="qualification" />
        <div className="flex items-center justify-center h-48 gap-2 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" /> Extraction still in progress…
        </div>
      </div>
    );
  }

  const scored = tender.qualification.tenderMode === 'scored';
  const summary = computeQualificationSummary(tender.qualification);
  const scoreSummary = computeScoreSummary(tender.qualification);

  const cycleMet = async (itemId: string) => {
    const cycle = (item: QualificationItem): QualificationItem => {
      if (item.id !== itemId) return item;
      const currentIdx = MET_CYCLE.indexOf(item.met);
      const nextMet = MET_CYCLE[(currentIdx + 1) % MET_CYCLE.length];
      return { ...item, met: nextMet };
    };

    setSaveState('saving');
    try {
      const next = {
        ...tender,
        qualification: {
          ...tender.qualification,
          general: tender.qualification.general.map(cycle),
          technical: tender.qualification.technical.map(cycle),
        },
      };
      await save(next);
      setSaveState('saved');
      setLastSavedAt(new Date());
    } catch {
      setSaveState('error');
      toast({ title: 'Failed to save status change', variant: 'destructive' });
    }
  };

  const markReviewed = async () => {
    setSaveState('saving');
    try {
      await save({ ...tender, status: 'reviewed' });
      setSaveState('saved');
      setLastSavedAt(new Date());
      toast({ title: 'Tender marked as reviewed' });
    } catch {
      setSaveState('error');
      toast({ title: 'Failed to update status', variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <TenderDetailHeader tender={tender} active="qualification" />

      <div className="flex items-center justify-between gap-4 flex-wrap">
        <p className="text-sm text-muted-foreground max-w-2xl">
          Mandatory general and technical qualification requirements, extracted with zero hallucination. Click a status badge to mark each item Met / Not Met as your team verifies it.
        </p>
        <div className="flex items-center gap-2">
          <SaveStatusIndicator state={saveState} lastSavedAt={lastSavedAt} />
          <StatusBadge status={tender.status === 'reviewed' ? 'Approved' : 'Pending'} />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard title="Tender Mode" value={TENDER_MODE_LABEL[tender.qualification.tenderMode]} icon={<ShieldCheck className="h-4 w-4" />} />
        <StatCard title="Requirements Met" value={summary.met} subtitle={`of ${summary.total} total`} icon={<CheckCircle2 className="h-4 w-4" />} className="border-success/20" />
        <StatCard title="Not Met" value={summary.unmet} icon={<XCircle className="h-4 w-4" />} className="border-destructive/20" />
        <StatCard
          title={scored ? 'Max Marks Available' : 'Unverified Items'}
          value={scored ? (scoreSummary?.maxTotal ?? 0) : summary.unverified}
          icon={scored ? <Award className="h-4 w-4" /> : <HelpCircle className="h-4 w-4" />}
        />
      </div>

      <QualificationTable
        title="General / Pre-Qualification Eligibility"
        icon={ShieldCheck}
        items={tender.qualification.general}
        scored={scored}
        onCycleMet={cycleMet}
      />

      <QualificationTable
        title="Technical Qualification"
        icon={Award}
        items={tender.qualification.technical}
        scored={scored}
        onCycleMet={cycleMet}
      />

      <Card className="enterprise-shadow">
        <CardHeader>
          <CardTitle className="font-heading text-base flex items-center gap-2">
            <Banknote className="h-4 w-4 text-primary" /> EMD / Bid Security
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {tender.qualification.emd.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">No EMD information extracted.</p>
          ) : (
            tender.qualification.emd.map(item => (
              <div key={item.id} className="rounded-lg border p-3 space-y-1">
                <p className="text-sm font-medium">{item.label}</p>
                <p className={item.confidence === 'not_found' ? 'text-sm text-muted-foreground italic' : 'text-sm'}>{item.value}</p>
                {item.sourceQuote && <p className="text-xs text-muted-foreground italic border-l-2 border-border pl-2">"{item.sourceQuote}"</p>}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card className="border-destructive/20 enterprise-shadow">
        <CardHeader>
          <CardTitle className="font-heading text-base flex items-center gap-2 text-destructive">
            <AlertOctagon className="h-4 w-4" /> Disqualification Risks
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {tender.qualification.disqualificationRisks.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">No disqualification clauses extracted.</p>
          ) : (
            tender.qualification.disqualificationRisks.map(item => (
              <div key={item.id} className="rounded-lg border border-destructive/20 p-3 space-y-1">
                <p className="text-sm font-medium">{item.label}</p>
                <p className={item.confidence === 'not_found' ? 'text-sm text-muted-foreground italic' : 'text-sm'}>{item.value}</p>
                {item.sourceQuote && <p className="text-xs text-muted-foreground italic border-l-2 border-border pl-2">"{item.sourceQuote}"</p>}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between gap-2">
        <Button variant="outline" onClick={() => navigate(`/tender/${tender.id}/brief`)}>
          <ArrowLeft className="h-4 w-4 mr-2" /> Back: Tender Brief
        </Button>
        <div className="flex items-center gap-2">
          {tender.status !== 'reviewed' && (
            <Button variant="outline" onClick={markReviewed} disabled={saveState === 'saving'}>
              {saveState === 'saving' ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
              Mark Reviewed
            </Button>
          )}
          <Button onClick={() => navigate(`/tender/${tender.id}/submission`)}>
            Next: Submission Package <ArrowRight className="h-4 w-4 ml-2" />
          </Button>
        </div>
      </div>
    </div>
  );
}