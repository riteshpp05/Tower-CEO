import { useParams, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { TenderDetailHeader } from '@/components/TenderDetailHeader';
import { ExtractedItemCard } from '@/components/ExtractedItemCard';
import { useTender } from '@/hooks/useTender';
import { Loader2, ArrowLeft, ArrowRight, Package, Server, Briefcase, CalendarClock, GanttChartSquare } from 'lucide-react';

function Section({
  title, icon: Icon, items, emptyHint,
}: {
  title: string;
  icon: typeof Package;
  items: { id: string; label: string; value: string; sourceQuote: string; sourceLocation?: string; confidence: 'exact' | 'inferred' | 'not_found' }[];
  emptyHint: string;
}) {
  return (
    <Card className="enterprise-shadow">
      <CardHeader>
        <CardTitle className="font-heading text-base flex items-center gap-2">
          <Icon className="h-4 w-4 text-primary" /> {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">{emptyHint}</p>
        ) : (
          items.map(item => <ExtractedItemCard key={item.id} item={item} />)
        )}
      </CardContent>
    </Card>
  );
}

export default function TenderBriefPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { tender, loading, notFound } = useTender(id);

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
        <TenderDetailHeader tender={tender} active="brief" />
        <div className="flex items-center justify-center h-48 gap-2 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" /> Extraction still in progress…
        </div>
      </div>
    );
  }

  if (tender.status === 'error') {
    return (
      <div className="space-y-6 animate-fade-in">
        <TenderDetailHeader tender={tender} active="brief" />
        <Card className="border-destructive/20 enterprise-shadow">
          <CardContent className="pt-6">
            <p className="text-sm text-destructive">{tender.extractionError || 'Extraction failed. Please try uploading the document again.'}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <TenderDetailHeader tender={tender} active="brief" />

      <p className="text-sm text-muted-foreground max-w-3xl">
        Every item below is extracted directly from the uploaded tender document. Items marked <span className="font-medium">"Not found in document"</span> mean the model could not locate that information — they are not guesses. Verify the source quotes before relying on this for the bid decision.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Section title="Deliverables" icon={Package} items={tender.brief.deliverables} emptyHint="No deliverables extracted." />
        <Section title="Existing Systems / Current Landscape" icon={Server} items={tender.brief.existingSystems} emptyHint="No existing-systems information extracted." />
        <Section title="Nature of Work" icon={Briefcase} items={tender.brief.natureOfWork} emptyHint="No nature-of-work information extracted." />
        <Section title="Critical Bid-Process Dates" icon={CalendarClock} items={tender.brief.criticalDates} emptyHint="No critical dates extracted." />
      </div>

      <Section title="Post-Award Project Timeline" icon={GanttChartSquare} items={tender.brief.projectTimeline} emptyHint="No project timeline extracted." />

      <div className="flex justify-end">
        <Button onClick={() => navigate(`/tender/${tender.id}/qualification`)}>
          Next: Qualification Criteria <ArrowRight className="h-4 w-4 ml-2" />
        </Button>
      </div>
    </div>
  );
}