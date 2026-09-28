import { useState, useEffect, useCallback } from 'react';
import { useProposals } from '@/contexts/ProposalContext';
import { useAuth } from '@/contexts/AuthContext';
import { StatusBadge } from '@/components/StatusBadge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CheckCircle, XCircle, RotateCcw, Eye } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { ReworkDialog } from '@/components/ReworkDialog';
import type { ReworkComment } from '@/contexts/ProposalContext';

interface WorkflowStage {
  stage: string;
  required_roles: string[];
}

export default function ApprovalsPage() {
  const { approvalRecords, handleApproval, sendBackForRework } = useProposals();
  const { user } = useAuth();
  const { toast } = useToast();
  const [workflowStages, setWorkflowStages] = useState<WorkflowStage[]>([]);
  // Rework dialog state — tracks which approval record is pending rework
  const [reworkTarget, setReworkTarget] = useState<{ id: string; proposalId: string; proposalTitle: string; stage: string } | null>(null);

  const userRoles = user?.roles || (user?.role ? [user.role] : []);
  const isAdmin = userRoles.includes('Admin');

  const fetchStages = useCallback(async () => {
    const { data } = await supabase
      .from('workflow_stages' as never)
      .select('stage, required_roles')
      .order('sort_order');
    setWorkflowStages((data as WorkflowStage[]) || []);
  }, []);

  useEffect(() => { fetchStages(); }, [fetchStages]);

  const canApproveStage = (stage: string): boolean => {
    if (isAdmin) return true;
    const stageConfig = workflowStages.find(s => s.stage === stage);
    if (!stageConfig || !stageConfig.required_roles?.length) return false;
    return stageConfig.required_roles.some(r => userRoles.includes(r as import('@/data/mockData').UserRole));
  };

  const onApprove = (id: string, title: string) => {
    handleApproval(id, 'Approved');
    toast({ title: '✓ Approved', description: `${title} approved — moving to next stage.` });
  };

  const onReject = (id: string, title: string) => {
    handleApproval(id, 'Rejected');
    toast({ title: '✗ Rejected', description: `${title} returned to Draft.` });
  };

  const handleReworkConfirm = async (comment: string, category: ReworkComment['category']) => {
    if (!reworkTarget) return;
    await sendBackForRework(
      reworkTarget.proposalId,
      comment,
      category,
      user?.name ?? 'Approver',
      (user?.role ?? 'Admin') as import('@/data/mockData').UserRole
    );
    setReworkTarget(null);
    toast({ title: '↩ Sent Back for Rework', description: `"${reworkTarget.proposalTitle}" returned to Draft. Owner notified.` });
  };

  const pending   = approvalRecords.filter(a => a.decision === 'Pending');
  const completed = approvalRecords.filter(a => a.decision !== 'Pending');
  const actionable = pending.filter(a => canApproveStage(a.stage));
  const readOnly   = pending.filter(a => !canApproveStage(a.stage));

  return (
    <div className="space-y-6 animate-fade-in">
      {reworkTarget && (
        <ReworkDialog
          proposalTitle={reworkTarget.proposalTitle}
          currentStage={reworkTarget.stage}
          onConfirm={handleReworkConfirm}
          onCancel={() => setReworkTarget(null)}
        />
      )}

      <div>
        <h1 className="text-2xl font-bold font-heading">Approvals Inbox</h1>
        <p className="text-sm text-muted-foreground">
          {actionable.length} pending your action
          {readOnly.length > 0 ? ` · ${readOnly.length} in other stages` : ''}
        </p>
      </div>

      {/* Actionable by current user */}
      <Card className="enterprise-shadow">
        <CardHeader>
          <CardTitle className="font-heading">Pending Your Action</CardTitle>
        </CardHeader>
        <CardContent>
          {actionable.length === 0 ? (
            <p className="text-sm text-muted-foreground">No approvals pending your action — all caught up!</p>
          ) : (
            <div className="space-y-3">
              {actionable.map(a => (
                <div key={a.id} className="flex items-center justify-between p-4 rounded-lg border hover:bg-muted/30 transition-colors">
                  <div>
                    <Link to={`/proposals/${a.proposalId}`} className="text-sm font-medium text-primary hover:underline">{a.proposalTitle}</Link>
                    <p className="text-xs text-muted-foreground">{a.stage} · {a.approver} · {a.timestamp}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="outline" className="text-success border-success/30 hover:bg-success/10"
                      onClick={() => onApprove(a.id, a.proposalTitle)}>
                      <CheckCircle className="h-3 w-3 mr-1" /> Approve
                    </Button>
                    <Button size="sm" variant="outline" className="text-destructive border-destructive/30 hover:bg-destructive/10"
                      onClick={() => onReject(a.id, a.proposalTitle)}>
                      <XCircle className="h-3 w-3 mr-1" /> Reject
                    </Button>
                    <Button size="sm" variant="outline" className="text-warning border-warning/30 hover:bg-warning/10"
                      onClick={() => setReworkTarget({ id: a.id, proposalId: a.proposalId, proposalTitle: a.proposalTitle, stage: a.stage })}>
                      <RotateCcw className="h-3 w-3 mr-1" /> Send Back
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Read-only: other stages */}
      {readOnly.length > 0 && (
        <Card className="enterprise-shadow">
          <CardHeader>
            <CardTitle className="font-heading text-muted-foreground text-sm">Other Pending Stages (View Only)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {readOnly.map(a => (
                <div key={a.id} className="flex items-center justify-between p-3 rounded-lg border bg-muted/20">
                  <div>
                    <Link to={`/proposals/${a.proposalId}`} className="text-sm font-medium hover:underline">{a.proposalTitle}</Link>
                    <p className="text-xs text-muted-foreground">{a.stage} · {a.approver} · {a.timestamp}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status="Pending" />
                    <Link to={`/proposals/${a.proposalId}`}>
                      <Button size="sm" variant="ghost" className="h-7 text-xs gap-1">
                        <Eye className="h-3 w-3" /> View
                      </Button>
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Completed */}
      <Card className="enterprise-shadow">
        <CardHeader><CardTitle className="font-heading">Completed Reviews</CardTitle></CardHeader>
        <CardContent>
          {completed.length === 0 ? <p className="text-sm text-muted-foreground">No completed reviews yet.</p> : (
            <div className="space-y-2">
              {completed.map(a => (
                <div key={a.id} className="flex items-center justify-between p-3 rounded-lg border">
                  <div>
                    <Link to={`/proposals/${a.proposalId}`} className="text-sm font-medium hover:underline">{a.proposalTitle}</Link>
                    <p className="text-xs text-muted-foreground">{a.stage} · {a.approver} · {a.timestamp}</p>
                    {a.comments && <p className="text-xs text-foreground/70 mt-1">{a.comments}</p>}
                  </div>
                  <StatusBadge status={a.decision} />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}