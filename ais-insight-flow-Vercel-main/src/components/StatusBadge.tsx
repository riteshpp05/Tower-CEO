import { cn } from '@/lib/utils';

type StatusType = 'Draft' | 'Pre-Sales Review' | 'Delivery Review' | 'Finance Review' | 'Legal Review' | 'Final Approval' | 'Ready for Export' | 'Submitted' | 'Archived' | 'Approved' | 'Pending' | 'Rejected' | 'Sent Back' | 'Compliant' | 'Partially Compliant' | 'Non-Compliant' | 'Active' | 'Inactive' | 'Low' | 'Medium' | 'High' | 'Critical' | 'Available' | 'Partially Available' | 'Engaged';

const statusStyles: Record<string, string> = {
  'Draft': 'bg-muted text-muted-foreground',
  'Pre-Sales Review': 'bg-info/10 text-info',
  'Delivery Review': 'bg-info/10 text-info',
  'Finance Review': 'bg-warning/10 text-warning',
  'Legal Review': 'bg-warning/10 text-warning',
  'Final Approval': 'bg-primary/10 text-primary',
  'Ready for Export': 'bg-success/10 text-success',
  'Submitted': 'bg-success/15 text-success',
  'Archived': 'bg-muted text-muted-foreground',
  'Approved': 'bg-success/10 text-success',
  'Pending': 'bg-warning/10 text-warning',
  'Rejected': 'bg-destructive/10 text-destructive',
  'Sent Back': 'bg-warning/10 text-warning',
  'Compliant': 'bg-success/10 text-success',
  'Partially Compliant': 'bg-warning/10 text-warning',
  'Non-Compliant': 'bg-destructive/10 text-destructive',
  'Active': 'bg-success/10 text-success',
  'Inactive': 'bg-muted text-muted-foreground',
  'Low': 'bg-success/10 text-success',
  'Medium': 'bg-warning/10 text-warning',
  'High': 'bg-destructive/10 text-destructive',
  'Critical': 'bg-destructive/15 text-destructive',
  'Available': 'bg-success/10 text-success',
  'Partially Available': 'bg-warning/10 text-warning',
  'Engaged': 'bg-destructive/10 text-destructive',
};

export function StatusBadge({ status, className }: { status: StatusType | string; className?: string }) {
  return (
    <span className={cn(
      'inline-flex items-center rounded-md px-2.5 py-0.5 text-xs font-medium whitespace-nowrap',
      statusStyles[status] || 'bg-muted text-muted-foreground',
      className
    )}>
      {status}
    </span>
  );
}
