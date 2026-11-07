/**
 * ComplianceChecklistStep.tsx
 * ─────────────────────────────────────────────────────────────────
 * Shown in Pre-Sales Briefing (Panel 5) and in the Workspace.
 * Pre-sales marks each mandatory RFP requirement as met/unmet.
 * Warnings (not blocks) sent to all approvers.
 * ─────────────────────────────────────────────────────────────────
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Sparkles, Loader2, CheckCircle, AlertTriangle, XCircle, Shield } from 'lucide-react';
import {
  generateComplianceChecklist,
  computeComplianceStatus,
  COMPLIANCE_COLORS,
  SEVERITY_COLORS,
  type ComplianceChecklist,
  type ComplianceItem,
} from '@/lib/generateComplianceChecklist';

interface Props {
  rfpRawText:  string;
  clientName:  string;
  checklist:   ComplianceChecklist | null;
  onChange:    (checklist: ComplianceChecklist) => void;
}

export function ComplianceChecklistStep({ rfpRawText, clientName, checklist, onChange }: Props) {
  const [generating, setGenerating] = useState(false);

  const handleGenerate = async () => {
    if (!rfpRawText || rfpRawText.trim().length < 100) return;
    setGenerating(true);
    try {
      const result = await generateComplianceChecklist(rfpRawText, clientName);
      onChange(result);
    } finally {
      setGenerating(false);
    }
  };

  const toggleMet = (id: string) => {
    if (!checklist) return;
    const updated = {
      ...checklist,
      items: checklist.items.map(i => i.id === id ? { ...i, met: !i.met } : i),
    };
    updated.overallStatus = computeComplianceStatus(updated.items);
    onChange(updated);
  };

  const updateNotes = (id: string, notes: string) => {
    if (!checklist) return;
    onChange({ ...checklist, items: checklist.items.map(i => i.id === id ? { ...i, notes } : i) });
  };

  const unmetCritical = (checklist?.items ?? []).filter(i => i.severity === 'critical' && !i.met).length;
  const unmetMajor    = (checklist?.items ?? []).filter(i => i.severity === 'major'    && !i.met).length;
  const metCount      = (checklist?.items ?? []).filter(i => i.met).length;
  const totalCount    = checklist?.items.length ?? 0;

  const statusColor = checklist?.overallStatus === 'compliant' ? 'text-success border-success/30 bg-success/5'
    : checklist?.overallStatus === 'non-compliant' ? 'text-destructive border-destructive/30 bg-destructive/5'
    : 'text-warning border-warning/30 bg-warning/5';

  const StatusIcon = checklist?.overallStatus === 'compliant' ? CheckCircle
    : checklist?.overallStatus === 'non-compliant' ? XCircle : AlertTriangle;

  return (
    <Card className="enterprise-shadow">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="font-heading flex items-center gap-2 text-sm">
              <Shield className="h-4 w-4 text-primary" /> RFP Compliance Checklist
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Qwen reads your RFP and extracts mandatory requirements. Mark each as addressed before submission. Warnings (not blocks) are sent to all approvers.
            </p>
          </div>
          <Button
            onClick={handleGenerate}
            disabled={generating || !rfpRawText || rfpRawText.trim().length < 100}
            variant={checklist ? 'outline' : 'default'}
            size="sm"
          >
            {generating
              ? <><Loader2 className="h-3 w-3 mr-2 animate-spin" /> Extracting…</>
              : <><Sparkles className="h-3 w-3 mr-2" /> {checklist ? 'Re-extract' : 'Extract Requirements'}</>}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">

        {!rfpRawText || rfpRawText.trim().length < 100 && (
          <p className="text-xs text-muted-foreground italic text-center py-4">Upload an RFP first to extract compliance requirements.</p>
        )}

        {!checklist && rfpRawText && rfpRawText.trim().length >= 100 && !generating && (
          <div className="text-center py-6 text-muted-foreground">
            <Shield className="h-8 w-8 mx-auto mb-2 opacity-30" />
            <p className="text-sm">Click "Extract Requirements" to auto-populate the compliance checklist from your RFP.</p>
          </div>
        )}

        {generating && (
          <div className="flex items-center justify-center py-8 gap-3 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">Qwen is reading the RFP and extracting mandatory requirements…</span>
          </div>
        )}

        {checklist && checklist.extractionFailed && (
          <div className="text-center py-6">
            <AlertTriangle className="h-8 w-8 mx-auto mb-2 text-destructive opacity-70" />
            <p className="text-sm text-destructive font-medium">Extraction failed — APNJ-LLM-Studio may be unreachable.</p>
            <p className="text-xs text-muted-foreground mt-1">No requirements were found because extraction couldn't run, not because the RFP has none. Click "Re-extract" to try again.</p>
          </div>
        )}

        {checklist && !checklist.extractionFailed && checklist.items.length === 0 && (
          <div className="text-center py-6 text-muted-foreground">
            <Shield className="h-8 w-8 mx-auto mb-2 opacity-30" />
            <p className="text-sm">No mandatory requirements were found in the RFP. This can happen with informal or proactive opportunities — double check the source document if this seems unexpected.</p>
          </div>
        )}

        {checklist && checklist.items.length > 0 && (
          <>
            {/* Status badge */}
            <div className={`flex items-center gap-3 p-3 rounded-lg border text-sm ${statusColor}`}>
              <StatusIcon className="h-4 w-4 shrink-0" />
              <span>
                {metCount}/{totalCount} requirements addressed
                {unmetCritical > 0 && ` · ${unmetCritical} critical unaddressed`}
                {unmetMajor    > 0 && ` · ${unmetMajor} major unaddressed`}
                {checklist.overallStatus === 'compliant' && ' — all requirements addressed'}
              </span>
            </div>

            {/* Checklist items */}
            <div className="space-y-2">
              {checklist.items.map(item => (
                <div
                  key={item.id}
                  className={`p-3 rounded-lg border transition-colors ${item.met ? 'bg-success/5 border-success/20' : item.severity === 'critical' ? 'bg-destructive/5 border-destructive/20' : 'bg-warning/5 border-warning/20'}`}
                >
                  <div className="flex items-start gap-3">
                    <button
                      type="button"
                      onClick={() => toggleMet(item.id)}
                      className={`mt-0.5 h-5 w-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${item.met ? 'bg-success border-success text-white' : 'border-border bg-background'}`}
                    >
                      {item.met && <CheckCircle className="h-3 w-3" />}
                    </button>
                    <div className="flex-1 min-w-0 space-y-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${COMPLIANCE_COLORS[item.category]}`}>
                          {item.category}
                        </span>
                        <span className={`text-xs font-medium ${SEVERITY_COLORS[item.severity]}`}>
                          {item.severity === 'critical' ? '⚠ Critical' : item.severity === 'major' ? '• Major' : '· Minor'}
                        </span>
                        {item.value && (
                          <span className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">{item.value}</span>
                        )}
                      </div>
                      <p className={`text-sm ${item.met ? 'line-through text-muted-foreground' : ''}`}>
                        {item.requirement}
                      </p>
                      <Textarea
                        value={item.notes}
                        onChange={e => updateNotes(item.id, e.target.value)}
                        placeholder="How is this addressed in our proposal? (sent to approvers)"
                        className="text-xs min-h-[40px] resize-none"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <p className="text-xs text-muted-foreground">
              Unchecked items generate warnings to all approvers at submission — they do not block the proposal.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}