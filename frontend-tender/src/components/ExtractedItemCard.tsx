import { FileSearch, AlertCircle, HelpCircle, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ExtractedItem, ExtractionConfidence } from '@/lib/tenderEngine';

const CONFIDENCE_STYLE: Record<ExtractionConfidence, { label: string; classes: string; icon: typeof FileSearch }> = {
  exact: { label: 'Exact match', classes: 'bg-success/10 text-success border-success/20', icon: FileSearch },
  inferred: { label: 'Inferred', classes: 'bg-warning/10 text-warning border-warning/20', icon: HelpCircle },
  not_found: { label: 'Not found in document', classes: 'bg-muted text-muted-foreground border-border', icon: AlertCircle },
};

const ERROR_STYLE = { label: 'Extraction failed', classes: 'bg-destructive/10 text-destructive border-destructive/20', icon: AlertTriangle };

interface Props {
  item: ExtractedItem;
  className?: string;
}

export function ExtractedItemCard({ item, className }: Props) {
  const hasError = item.confidence === 'not_found' && Boolean(item.errorDetail);
  const style = hasError ? ERROR_STYLE : (CONFIDENCE_STYLE[item.confidence] ?? CONFIDENCE_STYLE.not_found);
  const Icon = style.icon;

  return (
    <div className={cn('rounded-lg border p-3 space-y-1.5', hasError && 'border-destructive/20', className)}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium font-heading">{item.label}</p>
        <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap', style.classes)}>
          <Icon className="h-3 w-3" /> {style.label}
        </span>
      </div>
      <p className={cn('text-sm', item.confidence === 'not_found' ? 'text-muted-foreground italic' : 'text-foreground/90')}>
        {item.value}
      </p>
      {hasError && (
        <p className="text-xs text-destructive/80 border-l-2 border-destructive/30 pl-2">
          This section could not be extracted — it has NOT been verified as absent from the document. Error: {item.errorDetail}
        </p>
      )}
      {item.sourceQuote && (
        <p className="text-xs text-muted-foreground border-l-2 border-border pl-2 italic">
          "{item.sourceQuote}"
          {item.sourceLocation && <span className="not-italic"> — {item.sourceLocation}</span>}
        </p>
      )}
    </div>
  );
}