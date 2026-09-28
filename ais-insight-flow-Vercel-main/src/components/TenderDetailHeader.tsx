import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/StatusBadge';
import { cn } from '@/lib/utils';
import { ArrowLeft, FileText, ClipboardCheck, FolderCheck } from 'lucide-react';
import type { TenderRecord } from '@/lib/tenderEngine';

type TenderTab = 'brief' | 'qualification' | 'submission';

const TABS: { key: TenderTab; label: string; icon: typeof FileText }[] = [
  { key: 'brief', label: 'Tender Brief', icon: FileText },
  { key: 'qualification', label: 'Qualification Criteria', icon: ClipboardCheck },
  { key: 'submission', label: 'Submission Package', icon: FolderCheck },
];

const STATUS_BADGE_LABEL: Record<TenderRecord['status'], string> = {
  extracting: 'Pending',
  extracted: 'Compliant',
  reviewed: 'Approved',
  error: 'Non-Compliant',
};

interface Props {
  tender: TenderRecord;
  active: TenderTab;
}

export function TenderDetailHeader({ tender, active }: Props) {
  const navigate = useNavigate();

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={() => navigate('/tender')} className="-ml-2">
        <ArrowLeft className="h-4 w-4 mr-1" /> Back to Tender Engine
      </Button>

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold font-heading">{tender.title}</h1>
            <StatusBadge status={STATUS_BADGE_LABEL[tender.status]} />
          </div>
          <p className="text-sm text-muted-foreground">{tender.clientName} · {tender.id}</p>
        </div>
      </div>

      <div className="flex items-center gap-1 border-b">
        {TABS.map(tab => {
          const Icon = tab.icon;
          const isActive = tab.key === active;
          return (
            <button
              key={tab.key}
              onClick={() => navigate(`/tender/${tender.id}/${tab.key}`)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
                isActive
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              )}
            >
              <Icon className="h-3.5 w-3.5" /> {tab.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}