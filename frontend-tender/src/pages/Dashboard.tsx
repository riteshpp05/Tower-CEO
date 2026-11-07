import { useProposals } from '@/contexts/ProposalContext';
import { useCommercialRules } from '@/contexts/CommercialRulesContext';
import { StatCard } from '@/components/StatCard';
import { StatusBadge } from '@/components/StatusBadge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FileText, Clock, AlertTriangle, DollarSign } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { Link } from 'react-router-dom';

// Approximate FX to INR for cross-currency pipeline totals
const FX_TO_INR: Record<string, number> = { INR: 1, USD: 84, EUR: 91, SGD: 63, AUD: 55, AED: 23 };

const pieColors = ['hsl(215,80%,42%)', 'hsl(199,89%,48%)', 'hsl(142,71%,45%)', 'hsl(38,92%,50%)', 'hsl(0,72%,51%)', 'hsl(280,60%,50%)', 'hsl(170,60%,45%)'];

export default function Dashboard() {
  const { proposals, approvalRecords } = useProposals();
  const { marginThreshold } = useCommercialRules();

  const statusCounts = proposals.reduce((acc, p) => {
    acc[p.status] = (acc[p.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const lobCounts = proposals.reduce((acc, p) => {
    acc[p.lob] = (acc[p.lob] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const lobData = Object.entries(lobCounts).map(([name, value]) => ({ name: name.replace('SAP Implementation – ', 'SAP '), value }));

  const statusFunnel = [
    { name: 'Draft', count: statusCounts['Draft'] || 0 },
    { name: 'In Review', count: (statusCounts['Pre-Sales Review'] || 0) + (statusCounts['Delivery Review'] || 0) + (statusCounts['Finance Review'] || 0) + (statusCounts['Legal Review'] || 0) },
    { name: 'Final Approval', count: statusCounts['Final Approval'] || 0 },
    { name: 'Ready/Submitted', count: (statusCounts['Ready for Export'] || 0) + (statusCounts['Submitted'] || 0) },
  ];

  const pendingApprovals = approvalRecords.filter(a => a.decision === 'Pending');
  const marginAlerts = proposals.filter(p => p.grossMargin < marginThreshold);
  const upcomingDeadlines = proposals.filter(p => ['Draft', 'Pre-Sales Review', 'Delivery Review', 'Finance Review', 'Legal Review', 'Final Approval'].includes(p.status)).sort((a, b) => a.submissionDate.localeCompare(b.submissionDate)).slice(0, 5);
  // Normalise all proposal revenues to INR for a consistent pipeline total
  const totalRevenueINR = proposals.reduce((s, p) => s + p.expectedRevenue * (FX_TO_INR[p.currency] ?? 1), 0);

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold font-heading">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Proposal pipeline overview — {new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Total Proposals" value={proposals.length} icon={<FileText className="h-4 w-4" />} subtitle="In pipeline" />
        <StatCard title="Pending Approvals" value={pendingApprovals.length} icon={<Clock className="h-4 w-4" />} subtitle="Awaiting action" />
        <StatCard title="Pipeline Revenue" value={`₹${(totalRevenueINR / 10000000).toFixed(1)} Cr`} icon={<DollarSign className="h-4 w-4" />} subtitle="INR-equivalent total" />
        <StatCard title="Margin Alerts" value={marginAlerts.length} icon={<AlertTriangle className="h-4 w-4" />} subtitle={`Below ${marginThreshold}% threshold`} className={marginAlerts.length > 0 ? 'border-warning/30' : ''} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2 enterprise-shadow">
          <CardHeader><CardTitle className="text-base font-heading">Proposal Status Funnel</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={statusFunnel} layout="vertical">
                <XAxis type="number" />
                <YAxis dataKey="name" type="category" width={110} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="count" fill="hsl(215,80%,42%)" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="enterprise-shadow">
          <CardHeader><CardTitle className="text-base font-heading">By Line of Business</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={lobData} cx="50%" cy="50%" outerRadius={80} dataKey="value" label={({ name, value }) => `${name} (${value})`} labelLine={false}>
                  {lobData.map((_, i) => <Cell key={i} fill={pieColors[i % pieColors.length]} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="enterprise-shadow">
          <CardHeader><CardTitle className="text-base font-heading">Pending Approvals</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-3">
              {pendingApprovals.length === 0 && <p className="text-sm text-muted-foreground">No pending approvals</p>}
              {pendingApprovals.map(a => (
                <Link to={`/proposals/${a.proposalId}`} key={a.id} className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 transition-colors">
                  <div>
                    <p className="text-sm font-medium">{a.proposalTitle}</p>
                    <p className="text-xs text-muted-foreground">{a.stage} · {a.approver}</p>
                  </div>
                  <StatusBadge status={a.decision} />
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="enterprise-shadow">
          <CardHeader><CardTitle className="text-base font-heading">Upcoming Deadlines</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-3">
              {upcomingDeadlines.map(p => (
                <Link to={`/proposals/${p.id}`} key={p.id} className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 transition-colors">
                  <div>
                    <p className="text-sm font-medium">{p.clientName}</p>
                    <p className="text-xs text-muted-foreground">{p.title}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium">{new Date(p.submissionDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</p>
                    <StatusBadge status={p.priority} />
                  </div>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {marginAlerts.length > 0 && (
        <Card className="border-warning/30 enterprise-shadow">
          <CardHeader><CardTitle className="text-base font-heading text-warning">⚠ Margin Risk Alerts</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {marginAlerts.map(p => (
                <Link to={`/proposals/${p.id}`} key={p.id} className="flex items-center justify-between p-3 rounded-lg bg-warning/5 border border-warning/20 hover:bg-warning/10 transition-colors">
                  <div>
                    <p className="text-sm font-medium">{p.title}</p>
                    <p className="text-xs text-muted-foreground">Gross Margin: {p.grossMargin}% | Discount: {p.discount}% | Threshold: {marginThreshold}%</p>
                  </div>
                  <StatusBadge status="High" />
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}