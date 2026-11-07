/**
 * RAGSourcePicker.tsx
 * ─────────────────────────────────────────────────────────────────
 * UI component that lets the user choose which APNJ-LLM-Studio
 * RAG collections to query before generating proposal content.
 *
 * Built-in apps (always shown):
 *   • Documents  → /rag/query   (PDFs, Word, TXT indexed by doc_processor.py)
 *   • Web Pages  → /rag/web     (crawled pages indexed by web_crawler.py)
 *   • All        → /rag/unified (all collections simultaneously)
 *
 * Custom apps: discovered live from /rag/collections in the Studio.
 * ─────────────────────────────────────────────────────────────────
 */

import { useState, useEffect } from 'react';
import { checkLLMHealth, listRAGCollections, type RAGCollection } from '@/lib/llmClient';
import { Loader2, Database, Globe, Layers, RefreshCw, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RAGApp {
  key: RAGCollection;
  label: string;
  description: string;
  icon: React.ReactNode;
  docCount?: number;
  custom?: boolean;
}

export interface RAGPickerValue {
  selectedKeys: RAGCollection[];
  /** If true, skip RAG entirely and let the LLM free-generate */
  disabled: boolean;
}

interface RAGSourcePickerProps {
  value: RAGPickerValue;
  onChange: (v: RAGPickerValue) => void;
  /** Which section this picker controls — shown in label */
  context?: string;
  compact?: boolean;
}

// ── Built-in apps ─────────────────────────────────────────────────────────────

const BUILTIN_APPS: Omit<RAGApp, 'docCount'>[] = [
  {
    key: 'query',
    label: 'Documents',
    description: 'PDFs, Word & TXT files indexed from your knowledge base (case studies, methodology docs, past proposals)',
    icon: <Database className="h-4 w-4" />,
  },
  {
    key: 'web',
    label: 'Web Pages',
    description: 'Pages crawled by APNJ web_crawler.py (SAP help, client websites, industry content)',
    icon: <Globe className="h-4 w-4" />,
  },
  {
    key: 'unified',
    label: 'All Collections',
    description: 'Queries every collection simultaneously — best for comprehensive grounding',
    icon: <Layers className="h-4 w-4" />,
  },
];

// ── Component ─────────────────────────────────────────────────────────────────

export function RAGSourcePicker({ value, onChange, context, compact = false }: RAGSourcePickerProps) {
  const [apps, setApps] = useState<RAGApp[]>(BUILTIN_APPS);
  const [probing, setProbing] = useState(false);
  const [studioStatus, setStudioStatus] = useState<'unknown' | 'online' | 'offline'>('unknown');

  // Probe Studio on mount — discover collections and check health
  useEffect(() => {
    probe();
  }, []);

  const probe = async () => {
    setProbing(true);
    try {
      const health = await checkLLMHealth();
      setStudioStatus(health === 'unavailable' ? 'offline' : 'online');

      if (health !== 'unavailable') {
        // Try to discover custom collections from Studio
        const discovered = await listRAGCollections();
        const customApps: RAGApp[] = discovered
          .filter(col => !['query', 'web', 'unified', 'excel'].includes(col.key))
          .map(col => ({
            key: col.key as RAGCollection,
            label: col.label,
            description: col.description ?? `Custom collection: ${col.key}`,
            icon: <Database className="h-4 w-4" />,
            docCount: col.docCount,
            custom: true,
          }));

        setApps([...BUILTIN_APPS, ...customApps]);
      }
    } catch {
      setStudioStatus('offline');
    } finally {
      setProbing(false);
    }
  };

  const toggle = (key: RAGCollection) => {
    const already = value.selectedKeys.includes(key);
    // 'unified' is exclusive — selecting it deselects others and vice versa
    if (key === 'unified') {
      onChange({ ...value, selectedKeys: already ? [] : ['unified'] });
    } else {
      const next = already
        ? value.selectedKeys.filter(k => k !== key)
        : [...value.selectedKeys.filter(k => k !== 'unified'), key];
      onChange({ ...value, selectedKeys: next });
    }
  };

  const toggleDisabled = () => {
    onChange({ selectedKeys: [], disabled: !value.disabled });
  };

  if (compact) {
    return (
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-muted-foreground shrink-0">RAG sources:</span>
        {apps.filter(a => a.key !== 'unified').map(app => (
          <button
            key={app.key}
            type="button"
            disabled={value.disabled}
            onClick={() => toggle(app.key)}
            className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
              value.selectedKeys.includes(app.key)
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-muted/30 text-muted-foreground border-muted hover:border-primary/40'
            } ${value.disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
          >
            {app.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => toggle('unified')}
          disabled={value.disabled}
          className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
            value.selectedKeys.includes('unified')
              ? 'bg-primary text-primary-foreground border-primary'
              : 'bg-muted/30 text-muted-foreground border-muted hover:border-primary/40'
          } ${value.disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
        >
          All
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border p-4 bg-muted/10">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold flex items-center gap-2">
            <Database className="h-4 w-4 text-primary" />
            RAG Knowledge Sources
            {context && <span className="text-xs font-normal text-muted-foreground">— {context}</span>}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Select which APNJ Studio collections to query for grounding context before generating
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* Studio status pill */}
          <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium flex items-center gap-1 ${
            studioStatus === 'online'  ? 'bg-success/10 text-success border-success/30' :
            studioStatus === 'offline' ? 'bg-destructive/10 text-destructive border-destructive/30' :
            'bg-muted text-muted-foreground'
          }`}>
            {studioStatus === 'online'  && <CheckCircle2 className="h-2.5 w-2.5" />}
            {studioStatus === 'offline' && <AlertTriangle className="h-2.5 w-2.5" />}
            {studioStatus === 'unknown' && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
            Studio {studioStatus}
          </span>
          <Button
            type="button" variant="ghost" size="sm"
            className="h-7 w-7 p-0"
            onClick={probe} disabled={probing}
            title="Re-probe Studio for available collections"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${probing ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* Disable RAG toggle */}
      <div
        className={`flex items-center gap-3 p-2 rounded-lg border cursor-pointer transition-colors ${
          value.disabled ? 'bg-warning/10 border-warning/30' : 'bg-muted/20 hover:bg-muted/30'
        }`}
        onClick={toggleDisabled}
      >
        <div className={`w-8 h-4 rounded-full transition-colors relative ${value.disabled ? 'bg-warning' : 'bg-muted'}`}>
          <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${value.disabled ? 'left-4' : 'left-0.5'}`} />
        </div>
        <div>
          <p className="text-xs font-medium">Skip RAG — generate without knowledge grounding</p>
          <p className="text-[10px] text-muted-foreground">
            {value.disabled
              ? 'LLM will generate from training data only — risk of hallucination'
              : 'RAG enabled — LLM will use your indexed documents as grounding context'}
          </p>
        </div>
      </div>

      {/* Studio offline warning */}
      {studioStatus === 'offline' && (
        <div className="flex items-start gap-2 p-2 rounded-lg bg-destructive/5 border border-destructive/20 text-xs text-destructive">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>
            APNJ-LLM-Studio is not reachable. Start Studio first (Start-APNJ-Studio.bat) or the RAG calls will fail.
            Generation will still run but <strong>without knowledge grounding</strong>.
          </span>
        </div>
      )}

      {/* Collection cards */}
      {!value.disabled && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {apps.map(app => {
            const selected = value.selectedKeys.includes(app.key);
            return (
              <button
                key={app.key}
                type="button"
                onClick={() => toggle(app.key)}
                className={`text-left p-3 rounded-lg border transition-all ${
                  selected
                    ? 'bg-primary/5 border-primary/40 ring-1 ring-primary/20'
                    : 'bg-background hover:bg-muted/30 border-muted'
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className={selected ? 'text-primary' : 'text-muted-foreground'}>
                    {app.icon}
                  </span>
                  <span className="text-xs font-semibold">{app.label}</span>
                  {app.custom && (
                    <span className="text-[9px] px-1 rounded bg-info/10 text-info border border-info/20 ml-auto">
                      custom
                    </span>
                  )}
                  {selected && (
                    <CheckCircle2 className="h-3 w-3 text-primary ml-auto" />
                  )}
                </div>
                <p className="text-[10px] text-muted-foreground leading-snug">{app.description}</p>
                {app.docCount !== undefined && (
                  <p className="text-[10px] text-info mt-1">{app.docCount} docs indexed</p>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Summary */}
      {!value.disabled && value.selectedKeys.length > 0 && (
        <p className="text-[10px] text-muted-foreground">
          Will query: <strong className="text-foreground">{value.selectedKeys.join(', ')}</strong> — retrieved context will be injected into every generation prompt
        </p>
      )}
      {!value.disabled && value.selectedKeys.length === 0 && (
        <p className="text-[10px] text-warning">
          ⚠ No collection selected — generation will run without RAG grounding. Select at least one above.
        </p>
      )}
    </div>
  );
}