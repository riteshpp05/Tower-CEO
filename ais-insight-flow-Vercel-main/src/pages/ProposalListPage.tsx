import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useProposals } from '@/contexts/ProposalContext';
import { useAuth } from '@/contexts/AuthContext';
import { useCommercialRules } from '@/contexts/CommercialRulesContext';
import { StatusBadge } from '@/components/StatusBadge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, Plus, FileText } from 'lucide-react';

export default function ProposalListPage() {
  const { proposals, approvalRecords } = useProposals();
  const { user } = useAuth();
  const { marginThreshold } = useCommercialRules();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [lobFilter, setLobFilter] = useState('all');

  const isPendingView = searchParams.get('filter') === 'pending';

  const pendingProposalIds = useMemo(() => {
    if (!user) return new Set<string>();

    return new Set(
      approvalRecords
        .filter(record => record.decision === 'Pending' && (record.approverRole === user.role || record.approver === user.name))
        .map(record => record.proposalId)
    );
  }, [approvalRecords, user]);

  const pendingCount = pendingProposalIds.size;

  const filtered = proposals.filter(p => {
    const matchesPending = !isPendingView || pendingProposalIds.has(p.id);
    const matchesSearch = !search || p.title.toLowerCase().includes(search.toLowerCase()) || p.clientName.toLowerCase().includes(search.toLowerCase()) || p.id.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === 'all' || p.status === statusFilter;
    const matchesLob = lobFilter === 'all' || p.lob === lobFilter;
    return matchesPending && matchesSearch && matchesStatus && matchesLob;
  });

  const pageTitle = isPendingView ? 'Pending My Action' : 'Proposals';
  const pageDescription = isPendingView
    ? `${pendingCount} proposal${pendingCount === 1 ? '' : 's'} awaiting your review`
    : `${proposals.length} proposals in pipeline`;
  const emptyMessage = isPendingView ? 'No proposals are currently awaiting your action' : 'No proposals match your filters';

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold font-heading">{pageTitle}</h1>
          <p className="text-sm text-muted-foreground">{pageDescription}</p>
        </div>
        <Button onClick={() => navigate('/proposals/new')}>
          <Plus className="h-4 w-4 mr-2" /> New Proposal
        </Button>
      </div>

      <Card className="enterprise-shadow">
        <CardContent className="pt-4">
          <div className="flex flex-wrap gap-3 mb-4">
            <div className="flex items-center gap-2 flex-1 min-w-[200px]">
              <Search className="h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search proposals..." value={search} onChange={e => setSearch(e.target.value)} className="h-9" />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[180px] h-9"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="Draft">Draft</SelectItem>
                <SelectItem value="Pre-Sales Review">Pre-Sales Review</SelectItem>
                <SelectItem value="Delivery Review">Delivery Review</SelectItem>
                <SelectItem value="Finance Review">Finance Review</SelectItem>
                <SelectItem value="Legal Review">Legal Review</SelectItem>
                <SelectItem value="Final Approval">Final Approval</SelectItem>
                <SelectItem value="Ready for Export">Ready for Export</SelectItem>
                <SelectItem value="Submitted">Submitted</SelectItem>
              </SelectContent>
            </Select>
            <Select value={lobFilter} onValueChange={setLobFilter}>
              <SelectTrigger className="w-[200px] h-9"><SelectValue placeholder="Line of Business" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All LOBs</SelectItem>
                <SelectItem value="SAP Implementation – Rise">SAP Rise</SelectItem>
                <SelectItem value="SAP Implementation – Grow">SAP Grow</SelectItem>
                <SelectItem value="AMS">AMS</SelectItem>
                <SelectItem value="Resource Augmentation">Resource Aug.</SelectItem>
                <SelectItem value="Upgrade / Migration">Upgrade / Migration</SelectItem>
                <SelectItem value="BTP / AI">BTP / AI</SelectItem>
                <SelectItem value="Tender">Tender</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="pb-3 font-medium text-muted-foreground">ID</th>
                  <th className="pb-3 font-medium text-muted-foreground">Client / Opportunity</th>
                  <th className="pb-3 font-medium text-muted-foreground">LOB</th>
                  <th className="pb-3 font-medium text-muted-foreground">Owner</th>
                  <th className="pb-3 font-medium text-muted-foreground">Stage</th>
                  <th className="pb-3 font-medium text-muted-foreground">Priority</th>
                  <th className="pb-3 font-medium text-muted-foreground">Deadline</th>
                  <th className="pb-3 font-medium text-muted-foreground">Revenue</th>
                  <th className="pb-3 font-medium text-muted-foreground">Margin</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(p => (
                  <tr key={p.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors cursor-pointer" onClick={() => navigate(`/proposals/${p.id}`)}>
                    <td className="py-3 font-mono text-xs text-primary">{p.id}</td>
                    <td className="py-3">
                      <p className="font-medium">{p.clientName}</p>
                      <p className="text-xs text-muted-foreground truncate max-w-[250px]">{p.title}</p>
                    </td>
                    <td className="py-3 text-xs">{p.lob.replace('SAP Implementation – ', 'SAP ')}</td>
                    <td className="py-3 text-xs">{p.owner}</td>
                    <td className="py-3"><StatusBadge status={p.status} /></td>
                    <td className="py-3"><StatusBadge status={p.priority} /></td>
                    <td className="py-3 text-xs">{new Date(p.submissionDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                    <td className="py-3 text-xs font-medium">{p.currency === 'INR' ? '₹' : '$'}{(p.expectedRevenue / (p.currency === 'INR' ? 10000000 : 1000000)).toFixed(1)}{p.currency === 'INR' ? ' Cr' : 'M'}</td>
                    <td className="py-3"><span className={p.grossMargin < marginThreshold ? 'text-destructive font-medium' : 'text-success font-medium'}>{p.grossMargin}%</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filtered.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <FileText className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p>{emptyMessage}</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}