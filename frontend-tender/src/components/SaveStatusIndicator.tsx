import { useState, useEffect } from 'react';
import { Loader2, CheckCircle2, Save } from 'lucide-react';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

interface Props {
  state: SaveState;
  lastSavedAt: Date | null;
}

/**
 * Persistent, always-visible save status — every field edit on the Tender
 * Engine's Qualification and Submission pages auto-saves to storage on
 * change. Without a visible indicator this is indistinguishable from
 * nothing being saved at all, so this renders prominently near page
 * actions (not buried at the bottom of the page) in every state:
 * idle ("saves automatically"), saving (spinner), saved (timestamp,
 * ticking every few seconds), and error (explicit warning).
 */
export function SaveStatusIndicator({ state, lastSavedAt }: Props) {
  const [, forceTick] = useState(0);

  // Re-render every few seconds so "Xs ago" stays current without extra logic elsewhere.
  useEffect(() => {
    const interval = setInterval(() => forceTick(t => t + 1), 5000);
    return () => clearInterval(interval);
  }, []);

  const relativeTime = (date: Date): string => {
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 5) return 'just now';
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    return date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  };

  if (state === 'saving') {
    return (
      <span className="text-xs text-muted-foreground flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-muted/50">
        <Loader2 className="h-3 w-3 animate-spin" /> Saving…
      </span>
    );
  }
  if (state === 'error') {
    return (
      <span className="text-xs text-destructive flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-destructive/10">
        Save failed — your last change may not be saved
      </span>
    );
  }
  if (lastSavedAt) {
    return (
      <span className="text-xs text-success flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-success/10">
        <CheckCircle2 className="h-3 w-3" /> Saved {relativeTime(lastSavedAt)}
      </span>
    );
  }
  return (
    <span className="text-xs text-muted-foreground flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-muted/50">
      <Save className="h-3 w-3" /> Every change is saved automatically
    </span>
  );
}