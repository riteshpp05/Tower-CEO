/**
 * ReportsPage.tsx  —  /reports
 * Portfolio-level analytics dashboard.
 * (The old per-proposal content generation page has been merged into
 *  ProposalWorkspacePage — open any proposal and use its tabs.)
 */
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useProposals } from '@/contexts/ProposalContext';
import { useCommercialRules } from '@/contexts/CommercialRulesContext';
import { StatCard } from '@/components/StatCard';
import { StatusBadge } from '@/components/StatusBadge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, CartesianGrid, Legend,
} from 'recharts';
import { TrendingUp, DollarSign, AlertTriangle, CheckCircle, FileText } from 'lucide-react';

// Approximate FX → INR for cross-currency totals
const FX: Record<string, number> = { INR: 1, USD: 84, EUR: 91, SGD: 63, AUD: 55, AED: 23 };

const COLORS = [
  'hsl(215,80%,42%)', 'hsl(142,71%,45%)', 'hsl(38,92%,50%)',
  'hsl(0,72%,51%)',   'hsl(280,60%,50%)', 'hsl(199,89%,48%)', 'hsl(170,60%,45%)',
];

export default function ReportsPage() {
  const { proposals } = useProposals();
  const { marginThreshold } = useCommercialRules();

  // ── Aggregate stats ──────────────────────────────────────────────────────────
  const totalINR     = useMemo(() => proposals.reduce((s, p) => s + p.expectedRevenue * (FX[p.currency] ?? 1), 0), [proposals]);
  const avgMargin    = useMemo(() => proposals.length ? Math.round(proposals.reduce((s, p) => s + p.grossMargin, 0) / proposals.length) : 0, [proposals]);
  const atRisk       = useMemo(() => proposals.filter(p => p.grossMargin < marginThreshold).length, [proposals, marginThreshold]);
  const readyToSend  = useMemo(() => proposals.filter(p => p.status === 'Ready for Export' || p.status === 'Submitted').length, [proposals]);

  // ── Charts data ──────────────────────────────────────────────────────────────
  const byStatus = useMemo(() => {
    const map: Record<string, number> = {};
    proposals.forEach(p => { map[p.status] = (map[p.status] || 0) + 1; });
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  }, [proposals]);

  const byLOB = useMemo(() => {
    const map: Record<string, number> = {};
    proposals.forEach(p => {
      const key = p.lob.replace('SAP Implementation – ', 'SAP ');
      map[key] = (map[key] || 0) + 1;
    });
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  }, [proposals]);

  const byGeography = useMemo(() => {
    const map: Record<string, number> = {};
    proposals.forEach(p => { map[p.geography] = (map[p.geography] || 0) + 1; });
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  }, [proposals]);

  const marginBuckets = useMemo(() => {
    const buckets: Record<string, number> = { '<20%': 0, '20–29%': 0, '30–39%': 0, '40–49%': 0, '50%+': 0 };
    proposals.forEach(p => {
      if (p.grossMargin < 20)      buckets['<20%']++;
      else if (p.grossMargin < 30) buckets['20–29%']++;
      else if (p.grossMargin < 40) buckets['30–39%']++;
      else if (p.grossMargin < 50) buckets['40–49%']++;
      else                         buckets['50%+']++;
    });
    return Object.entries(buckets).map(([name, value]) => ({ name, value }));
  }, [proposals]);

  const revenueByMonth = useMemo(() => {
    const map: Record<string, number> = {};
    proposals.forEach(p => {
      const month = p.createdAt?.slice(0, 7) ?? 'Unknown';
      map[month] = (map[month] || 0) + p.expectedRevenue * (FX[p.currency] ?? 1);
    });
    return Object.entries(map)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, value]) => ({ month, value: Math.round(value / 100000) })); // in ₹ Lakh
  }, [proposals]);

  // ── Top proposals by revenue ─────────────────────────────────────────────────
  const topByRevenue = useMemo(() =>
    [...proposals]
      .sort((a, b) => (b.expectedRevenue * (FX[b.currency] ?? 1)) - (a.expectedRevenue * (FX[a.currency] ?? 1)))
      .slice(0, 8),
    [proposals]
  );

  const fmtINR = (n: number) => n >= 10000000 ? `₹${(n / 10000000).toFixed(1)} Cr` : `₹${(n / 100000).toFixed(1)} L`;

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold font-heading">Reports & Analytics</h1>
        <p className="text-sm text-muted-foreground">
          Portfolio overview — {proposals.length} proposals · {new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
        </p>
      </div>

      {/* ── KPI row ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Pipeline Value"      value={fmtINR(totalINR)}   icon={<DollarSign className="h-4 w-4" />}   subtitle="INR-equivalent total" />
        <StatCard title="Avg Gross Margin"    value={`${avgMargin}%`}    icon={<TrendingUp className="h-4 w-4" />}   subtitle={`Threshold: ${marginThreshold}%`} className={avgMargin < marginThreshold ? 'border-warning/30' : ''} />
        <StatCard title="Margin At-Risk"      value={atRisk}             icon={<AlertTriangle className="h-4 w-4" />} subtitle={`Below ${marginThreshold}%`} className={atRisk > 0 ? 'border-destructive/20' : ''} />
        <StatCard title="Ready / Submitted"   value={readyToSend}        icon={<CheckCircle className="h-4 w-4" />}  subtitle="Completed proposals" />
      </div>

      {/* ── Charts row 1 ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2 enterprise-shadow">
          <CardHeader><CardTitle className="text-base font-heading">Revenue Pipeline by Month (₹ Lakh)</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={revenueByMonth}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: number) => [`₹${v}L`, 'Revenue']} />
                <Line type="monotone" dataKey="value" stroke="hsl(215,80%,42%)" strokeWidth={2} dot />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="enterprise-shadow">
          <CardHeader><CardTitle className="text-base font-heading">By Geography</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={byGeography} cx="50%" cy="50%" outerRadius={75} dataKey="value"
                  label={({ name, value }) => `${name} (${value})`} labelLine={false}>
                  {byGeography.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* ── Charts row 2 ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="enterprise-shadow">
          <CardHeader><CardTitle className="text-base font-heading">By Line of Business</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={byLOB} layout="vertical">
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis dataKey="name" type="category" width={90} tick={{ fontSize: 10 }} />
                <Tooltip />
                <Bar dataKey="value" fill="hsl(215,80%,42%)" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="enterprise-shadow">
          <CardHeader><CardTitle className="text-base font-heading">Margin Distribution</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={marginBuckets}>
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {marginBuckets.map((entry, i) => (
                    <Cell key={i} fill={
                      entry.name === '<20%' ? 'hsl(0,72%,51%)' :
                      entry.name === '20–29%' ? 'hsl(38,92%,50%)' :
                      'hsl(142,71%,45%)'
                    } />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="enterprise-shadow">
          <CardHeader><CardTitle className="text-base font-heading">By Pipeline Stage</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={byStatus} cx="50%" cy="50%" outerRadius={75} dataKey="value"
                  label={({ name, value }) => `${value}`} labelLine={false}>
                  {byStatus.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v, _n, { payload }) => [v, payload.name]} />
                <Legend iconSize={10} />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* ── Top proposals table ── */}
      <Card className="enterprise-shadow">
        <CardHeader>
          <CardTitle className="text-base font-heading flex items-center gap-2">
            <FileText className="h-4 w-4" /> Top Proposals by Revenue
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="pb-2 text-muted-foreground font-medium">Proposal</th>
                  <th className="pb-2 text-muted-foreground font-medium">Client</th>
                  <th className="pb-2 text-muted-foreground font-medium">LOB</th>
                  <th className="pb-2 text-muted-foreground font-medium">Stage</th>
                  <th className="pb-2 text-muted-foreground font-medium text-right">Revenue (INR)</th>
                  <th className="pb-2 text-muted-foreground font-medium text-right">Margin</th>
                </tr>
              </thead>
              <tbody>
                {topByRevenue.map(p => (
                  <tr key={p.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                    <td className="py-2">
                      <Link to={`/proposals/${p.id}`} className="font-medium text-primary hover:underline truncate block max-w-[220px]">
                        {p.title}
                      </Link>
                    </td>
                    <td className="py-2 text-xs text-muted-foreground">{p.clientName}</td>
                    <td className="py-2 text-xs">{p.lob.replace('SAP Implementation – ', 'SAP ')}</td>
                    <td className="py-2"><StatusBadge status={p.status} /></td>
                    <td className="py-2 text-right text-xs font-medium">{fmtINR(p.expectedRevenue * (FX[p.currency] ?? 1))}</td>
                    <td className="py-2 text-right">
                      <span className={`text-xs font-semibold ${p.grossMargin < marginThreshold ? 'text-destructive' : 'text-success'}`}>
                        {p.grossMargin}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}