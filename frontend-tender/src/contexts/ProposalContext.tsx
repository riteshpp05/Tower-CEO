import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { type ProposalStatus, type UserRole, type Proposal, type ProposalMetadata, type ApprovalRecord, proposalStages } from '@/data/mockData';

const stageOrder: ProposalStatus[] = [
  'Draft', 'Pre-Sales Review', 'Delivery Review', 'Finance Review', 'Legal Review', 'Final Approval', 'Ready for Export'
];

const stageApproverMap: Record<string, { approver: string; role: UserRole }> = {
  'Pre-Sales Review': { approver: 'Rajesh Sharma',  role: 'Pre-Sales' },
  'Delivery Review':  { approver: 'Anita Deshmukh', role: 'Delivery'  },
  'Finance Review':   { approver: 'Vikram Patel',   role: 'Finance'   },
  'Legal Review':     { approver: 'Meera Iyer',     role: 'Legal'     },
  'Final Approval':   { approver: 'Sunil Kapoor',   role: 'Admin'     },
};

// ── Role-gated visibility ──────────────────────────────────────────────────────
// Which tabs each role can see/edit in the workspace
export const ROLE_TAB_ACCESS: Record<UserRole, { visible: string[]; editable: string[] }> = {
  Admin:      { visible: ['overview','ai-draft','briefing','commercials','legal','team','approvals','export'], editable: ['overview','ai-draft','briefing','commercials','legal','team'] },
  Sales:      { visible: ['overview','ai-draft','briefing','team','approvals','export'], editable: ['overview','ai-draft','briefing','team'] },
  'Pre-Sales':{ visible: ['overview','ai-draft','briefing','commercials','team','approvals','export'], editable: ['overview','ai-draft','briefing','team'] },
  Finance:    { visible: ['overview','commercials','approvals'], editable: ['commercials'] },
  Delivery:   { visible: ['overview','ai-draft','briefing','team','approvals'], editable: [] },
  Legal:      { visible: ['overview','legal','approvals'], editable: ['legal'] },
};

// Which rework comment categories each role can see
export const REWORK_COMMENT_VISIBILITY: Record<UserRole, string[]> = {
  Admin:       ['Scope Error', 'Commercial Error', 'Resource Error', 'Legal Error', 'Other'],
  Sales:       ['Scope Error', 'Resource Error', 'Other'],
  'Pre-Sales': ['Scope Error', 'Resource Error', 'Other'],
  Finance:     ['Commercial Error'],
  Delivery:    ['Scope Error', 'Resource Error'],
  Legal:       ['Legal Error'],
};

function dbToProposal(row: any): Proposal {
  return {
    id: row.id,
    title: row.title,
    clientName: row.client_name,
    clientGroup: row.client_group || '',
    industry: row.industry || '',
    geography: row.geography || 'India',
    lob: row.lob as any,
    opportunityType: row.opportunity_type as any,
    owner: row.owner || '',
    status: row.status as ProposalStatus,
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
    submissionDate: row.submission_date || '',
    priority: row.priority as any || 'Medium',
    dealType: row.deal_type as any || 'Fixed Price',
    currency: row.currency || 'INR',
    expectedDuration: row.expected_duration || '',
    expectedRevenue: Number(row.expected_revenue) || 0,
    grossMargin: Number(row.gross_margin) || 0,
    discount: Number(row.discount) || 0,
    modules: row.modules || [],
    riskLevel: row.risk_level as any || 'Medium',
    approvalProgress: row.approval_progress || 0,
    metadata: row.metadata
      ? (typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata) as ProposalMetadata
      : undefined,
  };
}

function proposalToDb(p: Partial<Proposal>) {
  const m: Record<string, any> = {};
  if (p.id              !== undefined) m.id               = p.id;
  if (p.title           !== undefined) m.title            = p.title;
  if (p.clientName      !== undefined) m.client_name      = p.clientName;
  if (p.clientGroup     !== undefined) m.client_group     = p.clientGroup;
  if (p.industry        !== undefined) m.industry         = p.industry;
  if (p.geography       !== undefined) m.geography        = p.geography;
  if (p.lob             !== undefined) m.lob              = p.lob;
  if (p.opportunityType !== undefined) m.opportunity_type = p.opportunityType;
  if (p.owner           !== undefined) m.owner            = p.owner;
  if (p.status          !== undefined) m.status           = p.status;
  if (p.createdAt       !== undefined) m.created_at       = p.createdAt;
  if (p.updatedAt       !== undefined) m.updated_at       = p.updatedAt;
  if (p.submissionDate  !== undefined) m.submission_date  = p.submissionDate;
  if (p.priority        !== undefined) m.priority         = p.priority;
  if (p.dealType        !== undefined) m.deal_type        = p.dealType;
  if (p.currency        !== undefined) m.currency         = p.currency;
  if (p.expectedDuration !== undefined) m.expected_duration = p.expectedDuration;
  if (p.expectedRevenue !== undefined) m.expected_revenue = p.expectedRevenue;
  if (p.grossMargin     !== undefined) m.gross_margin     = p.grossMargin;
  if (p.discount        !== undefined) m.discount         = p.discount;
  if (p.modules         !== undefined) m.modules          = p.modules;
  if (p.riskLevel       !== undefined) m.risk_level       = p.riskLevel;
  if (p.approvalProgress !== undefined) m.approval_progress = p.approvalProgress;
  if (p.metadata        !== undefined) m.metadata         = p.metadata;
  return m;
}

function dbToApproval(row: any): ApprovalRecord {
  return {
    id: row.id,
    proposalId: row.proposal_id,
    proposalTitle: row.proposal_title || '',
    stage: row.stage as ProposalStatus,
    approver: row.approver || '',
    approverRole: row.approver_role as UserRole || 'Admin',
    decision: row.decision as any,
    comments: row.comments || '',
    timestamp: row.timestamp || '',
  };
}

export interface ReworkComment {
  stage: string;
  comment: string;
  category: 'Scope Error' | 'Commercial Error' | 'Resource Error' | 'Legal Error' | 'Other';
  by: string;
  byRole: UserRole;
  timestamp: string;
}

interface ProposalContextType {
  proposals: Proposal[];
  approvalRecords: ApprovalRecord[];
  loading: boolean;
  addProposal:        (proposal: Proposal) => void;
  updateProposal:     (id: string, updates: Partial<Proposal>) => void;
  submitForReview:    (proposalId: string) => void;
  handleApproval:     (approvalId: string, decision: 'Approved' | 'Rejected' | 'Sent Back', comment?: string, category?: ReworkComment['category']) => void;
  sendBackForRework:  (proposalId: string, comment: string, category: ReworkComment['category'], by: string, byRole: UserRole) => Promise<void>;
  refreshData:        () => void;
}

const ProposalContext = createContext<ProposalContextType | null>(null);

export const useProposals = () => {
  const ctx = useContext(ProposalContext);
  if (!ctx) throw new Error('useProposals must be inside ProposalProvider');
  return ctx;
};

export function ProposalProvider({ children }: { children: ReactNode }) {
  const [proposals,       setProposals]       = useState<Proposal[]>([]);
  const [approvalRecords, setApprovalRecords] = useState<ApprovalRecord[]>([]);
  const [loading,         setLoading]         = useState(true);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [pRes, aRes] = await Promise.all([
      supabase.from('proposals'        as any).select('*').order('updated_at', { ascending: false }),
      supabase.from('approval_records' as any).select('*').order('timestamp',   { ascending: false }),
    ]);
    if (pRes.data) setProposals((pRes.data as any[]).map(dbToProposal));
    if (aRes.data) setApprovalRecords((aRes.data as any[]).map(dbToApproval));
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const addProposal = useCallback(async (proposal: Proposal) => {
    setProposals(prev => [proposal, ...prev]);
    await supabase.from('proposals' as any).insert(proposalToDb(proposal));
  }, []);

  const updateProposal = useCallback(async (id: string, updates: Partial<Proposal>) => {
    setProposals(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p));
    await supabase.from('proposals' as any).update(proposalToDb(updates)).eq('id', id);
  }, []);

  const submitForReview = useCallback(async (proposalId: string) => {
    const p = proposals.find(pr => pr.id === proposalId);
    if (!p) return;

    const newStatus: ProposalStatus = 'Pre-Sales Review';
    const progress = Math.round((2 / 7) * 100);
    const now   = new Date().toISOString().replace('T', ' ').slice(0, 16);
    const today = new Date().toISOString().split('T')[0];

    setProposals(prev => prev.map(pr =>
      pr.id !== proposalId ? pr : { ...pr, status: newStatus, approvalProgress: progress, updatedAt: today }
    ));
    await supabase.from('proposals' as any)
      .update({ status: newStatus, approval_progress: progress, updated_at: today })
      .eq('id', proposalId);

    const recordId = `APR-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const record: ApprovalRecord = {
      id: recordId, proposalId, proposalTitle: p.title,
      stage: newStatus,
      approver:     stageApproverMap[newStatus]?.approver ?? 'System',
      approverRole: stageApproverMap[newStatus]?.role     ?? 'Admin',
      decision: 'Pending', comments: '', timestamp: now,
    };
    setApprovalRecords(prev => [record, ...prev]);
    await supabase.from('approval_records' as any).insert({
      id: record.id, proposal_id: record.proposalId, proposal_title: record.proposalTitle,
      stage: record.stage, approver: record.approver, approver_role: record.approverRole,
      decision: record.decision, comments: record.comments, timestamp: record.timestamp,
    });

    // In-app notification — fire and forget, non-critical
    void (async () => {
      try {
        await supabase.from('notifications' as any).insert({
          id: `NOTIF-${Date.now()}`,
          user_id: stageApproverMap[newStatus]?.approver ?? 'system',
          type: 'approval_required',
          title: 'Proposal submitted for review',
          message: `"${p.title}" has been submitted for Pre-Sales Review.`,
          proposal_id: proposalId,
          read: false,
          created_at: new Date().toISOString(),
        });
      } catch { /* non-critical */ }
    })();
  }, [proposals]);

  // ── sendBackForRework ──────────────────────────────────────────────────────
  const sendBackForRework = useCallback(async (
    proposalId: string,
    comment: string,
    category: ReworkComment['category'],
    by: string,
    byRole: UserRole
  ) => {
    const p = proposals.find(pr => pr.id === proposalId);
    if (!p) return;

    const today = new Date().toISOString().split('T')[0];
    const ts    = new Date().toISOString().replace('T', ' ').slice(0, 16);

    const newReworkComment: ReworkComment = {
      stage: p.status, comment, category, by, byRole, timestamp: ts,
    };

    // Snapshot current state into metadata.versions before unlocking
    const existingMeta = (p.metadata as any) ?? {};
    const existingVersions = (existingMeta.versions as any[]) ?? [];
    const snapshot = {
      version: existingVersions.length + 1,
      status: p.status,
      snapshotAt: ts,
      snapshotBy: by,
      reason: comment,
      category,
    };

    // Append rework comment — role-scoped (stored with byRole so UI can filter)
    const existingRework = (existingMeta.reworkComments as ReworkComment[]) ?? [];
    const updatedMeta = {
      ...existingMeta,
      reworkComments: [...existingRework, newReworkComment],
      versions: [...existingVersions, snapshot],
    };

    // Unlock proposal → Draft
    setProposals(prev => prev.map(pr =>
      pr.id !== proposalId ? pr : {
        ...pr, status: 'Draft', approvalProgress: 0,
        updatedAt: today, metadata: updatedMeta as ProposalMetadata,
      }
    ));
    await supabase.from('proposals' as any).update({
      status: 'Draft',
      approval_progress: 0,
      updated_at: today,
      metadata: updatedMeta,
    }).eq('id', proposalId);

    // Mark pending approval record as Sent Back
    const pendingApproval = approvalRecords.find(
      a => a.proposalId === proposalId && a.decision === 'Pending'
    );
    if (pendingApproval) {
      setApprovalRecords(prev => prev.map(a =>
        a.id !== pendingApproval.id ? a : { ...a, decision: 'Sent Back', comments: comment, timestamp: ts }
      ));
      await supabase.from('approval_records' as any)
        .update({ decision: 'Sent Back', comments: comment, timestamp: ts })
        .eq('id', pendingApproval.id);
    }

    // In-app notification to deal owner — fire and forget, non-critical
    void (async () => {
      try {
        await supabase.from('notifications' as any).insert({
          id: `NOTIF-${Date.now()}`,
          user_id: p.owner,
          type: 'rework_required',
          title: 'Proposal sent back for rework',
          message: `"${p.title}" was sent back by ${by} (${category}): ${comment.slice(0, 100)}${comment.length > 100 ? '…' : ''}`,
          proposal_id: proposalId,
          read: false,
          created_at: new Date().toISOString(),
        });
      } catch { /* non-critical */ }
    })();
  }, [proposals, approvalRecords]);

  // ── handleApproval ─────────────────────────────────────────────────────────
  const handleApproval = useCallback(async (
    approvalId: string,
    decision: 'Approved' | 'Rejected' | 'Sent Back',
    comment?: string,
    category?: ReworkComment['category']
  ) => {
    const target = approvalRecords.find(a => a.id === approvalId);
    if (!target) return;

    const now   = new Date().toISOString().replace('T', ' ').slice(0, 16);
    const today = new Date().toISOString().split('T')[0];
    const resolvedComment = comment || (
      decision === 'Approved'   ? `Approved by ${target.approver}` :
      decision === 'Rejected'   ? `Rejected by ${target.approver}` :
      `Sent back for revision by ${target.approver}`
    );

    setApprovalRecords(prev => prev.map(a =>
      a.id !== approvalId ? a : { ...a, decision, timestamp: now, comments: resolvedComment }
    ));
    await supabase.from('approval_records' as any)
      .update({ decision, timestamp: now, comments: resolvedComment })
      .eq('id', approvalId);

    const pid   = target.proposalId;
    const stage = target.stage;

    if (decision === 'Approved') {
      const idx       = stageOrder.indexOf(stage);
      const nextStage = idx >= 0 && idx < stageOrder.length - 1 ? stageOrder[idx + 1] : 'Ready for Export';
      const progress  = Math.min(100, Math.round(((idx + 2) / stageOrder.length) * 100));

      setProposals(prev => prev.map(p =>
        p.id !== pid ? p : { ...p, status: nextStage, approvalProgress: progress, updatedAt: today }
      ));
      await supabase.from('proposals' as any)
        .update({ status: nextStage, approval_progress: progress, updated_at: today })
        .eq('id', pid);

      if (nextStage !== 'Ready for Export' && stageApproverMap[nextStage]) {
        const newId  = `APR-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const newRec: ApprovalRecord = {
          id: newId, proposalId: pid, proposalTitle: target.proposalTitle,
          stage: nextStage,
          approver:     stageApproverMap[nextStage].approver,
          approverRole: stageApproverMap[nextStage].role,
          decision: 'Pending', comments: '', timestamp: now,
        };
        setApprovalRecords(prev => [newRec, ...prev]);
        await supabase.from('approval_records' as any).insert({
          id: newRec.id, proposal_id: newRec.proposalId, proposal_title: newRec.proposalTitle,
          stage: newRec.stage, approver: newRec.approver, approver_role: newRec.approverRole,
          decision: newRec.decision, comments: newRec.comments, timestamp: newRec.timestamp,
        });
      }

    } else if (decision === 'Rejected') {
      setProposals(prev => prev.map(p =>
        p.id !== pid ? p : { ...p, status: 'Draft', approvalProgress: 0, updatedAt: today }
      ));
      await supabase.from('proposals' as any)
        .update({ status: 'Draft', approval_progress: 0, updated_at: today })
        .eq('id', pid);

    } else if (decision === 'Sent Back' && category) {
      // Delegate to sendBackForRework for proper version snapshot + notification
      const p = proposals.find(pr => pr.id === pid);
      if (p) {
        await sendBackForRework(pid, resolvedComment, category, target.approver, target.approverRole);
      }
    }
  }, [approvalRecords, proposals, sendBackForRework]);

  return (
    <ProposalContext.Provider value={{
      proposals, approvalRecords, loading,
      addProposal, updateProposal, submitForReview,
      handleApproval, sendBackForRework, refreshData: fetchAll,
    }}>
      {children}
    </ProposalContext.Provider>
  );
}