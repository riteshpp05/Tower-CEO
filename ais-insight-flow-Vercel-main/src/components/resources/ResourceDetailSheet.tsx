import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/StatusBadge';
import { FileText, Edit, Trash2, DollarSign, Briefcase, MapPin, Award } from 'lucide-react';
import type { DbResource } from '@/hooks/useResources';

interface Props {
  resource: DbResource | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onEdit: (r: DbResource) => void;
  onDelete: (id: string) => void;
  onGenerateCV: (r: DbResource) => void;
}

export function ResourceDetailSheet({ resource, open, onOpenChange, onEdit, onDelete, onGenerateCV }: Props) {
  if (!resource) return null;
  const loadedCost = (resource.cost_rate * (1 + resource.cost_loading_percentage / 100)).toFixed(2);
  const margin = resource.billing_rate > 0 ? ((resource.billing_rate - parseFloat(loadedCost)) / resource.billing_rate * 100).toFixed(1) : '0';

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[480px] sm:max-w-[480px] overflow-y-auto">
        <SheetHeader>
          <div className="flex items-center gap-3">
            <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center text-lg font-bold text-primary">
              {resource.name.split(' ').map(n => n[0]).join('')}
            </div>
            <div>
              <SheetTitle className="text-left">{resource.name}</SheetTitle>
              <p className="text-sm text-muted-foreground">{resource.designation}</p>
            </div>
          </div>
        </SheetHeader>

        <div className="space-y-5 mt-6">
          <div className="flex items-center gap-2 flex-wrap">
            <StatusBadge status={resource.availability} />
            <Badge variant="outline">{resource.employment_type}</Badge>
            <Badge variant="outline" className="gap-1"><MapPin className="h-3 w-3" />{resource.geography}</Badge>
            <Badge variant="outline">{resource.years_of_experience} yrs exp</Badge>
          </div>

          {resource.profile_summary && (
            <div>
              <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-1">Profile Summary</h4>
              <p className="text-sm">{resource.profile_summary}</p>
            </div>
          )}

          <div>
            <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-2">SAP Modules</h4>
            <div className="flex flex-wrap gap-1.5">
              {resource.sap_modules.map(m => <Badge key={m} className="text-xs">{m}</Badge>)}
              {resource.sap_modules.length === 0 && <span className="text-xs text-muted-foreground">None</span>}
            </div>
          </div>

          <div>
            <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-2">Skills</h4>
            <div className="flex flex-wrap gap-1.5">
              {resource.skills.map(s => <Badge key={s} variant="secondary" className="text-xs">{s}</Badge>)}
            </div>
          </div>

          {resource.certifications.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-2 flex items-center gap-1"><Award className="h-3 w-3" /> Certifications</h4>
              <ul className="text-sm space-y-1">
                {resource.certifications.map(c => <li key={c} className="text-sm">• {c}</li>)}
              </ul>
            </div>
          )}

          {resource.key_projects.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-2 flex items-center gap-1"><Briefcase className="h-3 w-3" /> Key Projects</h4>
              <ul className="text-sm space-y-1">
                {resource.key_projects.map(p => <li key={p}>• {p}</li>)}
              </ul>
            </div>
          )}

          <div className="border rounded-lg p-3">
            <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-2 flex items-center gap-1"><DollarSign className="h-3 w-3" /> Cost & Rates</h4>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>Base Cost: <strong>{resource.currency} {resource.cost_rate}/hr</strong></div>
              <div>Loading: <strong>{resource.cost_loading_percentage}%</strong></div>
              <div>Loaded Cost: <strong>{resource.currency} {loadedCost}/hr</strong></div>
              <div>Billing Rate: <strong>{resource.currency} {resource.billing_rate}/hr</strong></div>
              <div className="col-span-2">Effective Margin: <strong className={`${parseFloat(margin) >= 30 ? 'text-green-600' : parseFloat(margin) >= 15 ? 'text-amber-600' : 'text-red-600'}`}>{margin}%</strong></div>
            </div>
          </div>

          <div className="text-xs text-muted-foreground">
            {resource.email && <p>📧 {resource.email}</p>}
            {resource.phone && <p>📱 {resource.phone}</p>}
            <p>Languages: {resource.languages.join(', ')}</p>
          </div>

          <div className="flex gap-2 pt-2 border-t">
            <Button size="sm" onClick={() => onGenerateCV(resource)} className="gap-1"><FileText className="h-3.5 w-3.5" />Generate CV</Button>
            <Button size="sm" variant="outline" onClick={() => onEdit(resource)} className="gap-1"><Edit className="h-3.5 w-3.5" />Edit</Button>
            <Button size="sm" variant="destructive" onClick={() => { onDelete(resource.id); onOpenChange(false); }} className="gap-1"><Trash2 className="h-3.5 w-3.5" />Delete</Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
