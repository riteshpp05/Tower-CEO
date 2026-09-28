/**
 * ReworkDialog.tsx
 * Send Back for Rework — structured comment with category tag.
 * Finance comments only visible to Finance.
 * Scope/Resource comments visible to Sales and Pre-Sales.
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RotateCcw, Loader2 } from 'lucide-react';
import type { ReworkComment } from '@/contexts/ProposalContext';

interface Props {
  proposalTitle: string;
  currentStage:  string;
  onConfirm: (comment: string, category: ReworkComment['category']) => Promise<void>;
  onCancel:  () => void;
}

const CATEGORIES: { value: ReworkComment['category']; label: string; description: string }[] = [
  { value: 'Scope Error',      label: 'Scope Error',      description: 'Wrong modules, deliverables, or engagement scope' },
  { value: 'Commercial Error', label: 'Commercial Error', description: 'Pricing, margin, or rate card issues (Finance only)' },
  { value: 'Resource Error',   label: 'Resource Error',   description: 'Wrong team, hours, or resource allocation' },
  { value: 'Legal Error',      label: 'Legal Error',      description: 'Legal clause or compliance issue' },
  { value: 'Other',            label: 'Other',            description: 'Other reason — describe in comment' },
];

export function ReworkDialog({ proposalTitle, currentStage, onConfirm, onCancel }: Props) {
  const [comment,  setComment]  = useState('');
  const [category, setCategory] = useState<ReworkComment['category'] | ''>('');
  const [saving,   setSaving]   = useState(false);

  const canSubmit = comment.trim().length > 10 && category !== '';

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    try {
      await onConfirm(comment.trim(), category as ReworkComment['category']);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-background rounded-xl border shadow-lg w-full max-w-md mx-4 p-6 space-y-5">
        <div>
          <h2 className="font-heading font-semibold text-base flex items-center gap-2">
            <RotateCcw className="h-4 w-4 text-warning" /> Send Back for Rework
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            "{proposalTitle}" at {currentStage} — the proposal will return to Draft and the deal owner will be notified.
          </p>
        </div>

        <div className="space-y-2">
          <Label>Error Category <span className="text-destructive">*</span></Label>
          <Select value={category} onValueChange={v => setCategory(v as ReworkComment['category'])}>
            <SelectTrigger>
              <SelectValue placeholder="Select what needs to be fixed…" />
            </SelectTrigger>
            <SelectContent>
              {CATEGORIES.map(c => (
                <SelectItem key={c.value} value={c.value}>
                  <div>
                    <span className="font-medium">{c.label}</span>
                    <span className="text-xs text-muted-foreground ml-2">{c.description}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Comment <span className="text-destructive">*</span></Label>
          <Textarea
            value={comment}
            onChange={e => setComment(e.target.value)}
            placeholder="Be specific about what needs to be corrected — the deal owner will see this comment and act on it…"
            className="min-h-[100px] text-sm"
          />
          {comment.trim().length > 0 && comment.trim().length < 10 && (
            <p className="text-xs text-destructive">Please provide more detail (minimum 10 characters)</p>
          )}
        </div>

        {category === 'Commercial Error' && (
          <div className="p-3 rounded-lg bg-warning/5 border border-warning/20 text-xs text-warning">
            Commercial error comments are only visible to Finance team members and admins.
          </div>
        )}

        <div className="flex gap-3 justify-end pt-2">
          <Button variant="ghost" onClick={onCancel} disabled={saving}>Cancel</Button>
          <Button
            variant="outline"
            className="border-warning/40 text-warning hover:bg-warning/10"
            onClick={handleSubmit}
            disabled={!canSubmit || saving}
          >
            {saving
              ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Sending Back…</>
              : <><RotateCcw className="h-4 w-4 mr-2" /> Send Back for Rework</>}
          </Button>
        </div>
      </div>
    </div>
  );
}