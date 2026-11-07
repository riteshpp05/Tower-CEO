/**
 * LLMStatusBadge.tsx
 * Self-contained — includes its own TooltipProvider.
 * Drop anywhere in the sidebar or topbar, no wrapper needed.
 */

import { useState, useEffect } from 'react';
import { checkLLMHealth, type LLMEndpoint } from '@/lib/llmClient';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Cpu, Wifi, WifiOff, Loader2 } from 'lucide-react';

type Status = LLMEndpoint | 'checking';

export function LLMStatusBadge() {
  const [status, setStatus] = useState<Status>('checking');

  const check = async () => {
    const result = await checkLLMHealth();
    setStatus(result);
  };

  useEffect(() => {
    check();
    const interval = setInterval(check, 30_000);
    return () => clearInterval(interval);
  }, []);

  // Config defined inside component — avoids module-level JSX (Vite HMR safe)
  const config: Record<Status, { label: string; icon: React.ReactElement; className: string; tooltip: string }> = {
    checking: {
      label:     'Checking…',
      icon:      <Loader2 className="h-3 w-3 animate-spin" />,
      className: 'text-muted-foreground',
      tooltip:   'Connecting to APNJ-LLM-Studio…',
    },
    local: {
      label:     'LLM · Local',
      icon:      <Cpu className="h-3 w-3" />,
      className: 'text-green-500',
      tooltip:   'Connected locally (127.0.0.1:3000). All AI features active.',
    },
    tunnel: {
      label:     'LLM · Tunnel',
      icon:      <Wifi className="h-3 w-3" />,
      className: 'text-yellow-500',
      tooltip:   'Local unreachable — using Cloudflare tunnel. AI responses may be slower.',
    },
    unavailable: {
      label:     'LLM · Offline',
      icon:      <WifiOff className="h-3 w-3" />,
      className: 'text-red-500',
      tooltip:   'APNJ-LLM-Studio not reachable. Run Start-APNJ-Studio.bat to enable AI features.',
    },
  };

  const cfg = config[status];

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={check}
            className={`flex items-center gap-1.5 text-xs cursor-pointer select-none bg-transparent border-0 p-0 ${cfg.className}`}
          >
            {cfg.icon}
            <span>{cfg.label}</span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-xs">
          {cfg.tooltip}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}