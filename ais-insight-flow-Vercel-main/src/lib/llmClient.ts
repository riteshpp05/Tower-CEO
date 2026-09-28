/**
 * llmClient.ts
 * ─────────────────────────────────────────────────────────────────
 * Handles all LLM calls for the Proposal App.
 *
 * Priority order:
 *   1. Local  → http://127.0.0.1:3000/v1   (APNJ-LLM-Studio, direct)
 *   2. Tunnel → VITE_LLM_TUNNEL_URL         (Cloudflare tunnel to same Studio)
 *   3. Error  → shows a clear message to the user
 *
 * No API key needed for either endpoint.
 * ─────────────────────────────────────────────────────────────────
 */

// ── Endpoint URLs ──────────────────────────────────────────────────────────────
const LOCAL_BASE  = 'http://127.0.0.1:3000';

// Tunnel URL resolution order:
//   1. Live value from Supabase app_config.llm_tunnel_url (auto-updated by host PC)
//   2. Build-time env var VITE_LLM_TUNNEL_URL (fallback)
// This means the host can restart (new quick-tunnel URL) and the app picks it up
// automatically — no Vercel rebuild/redeploy needed.
const ENV_TUNNEL_BASE = (import.meta.env.VITE_LLM_TUNNEL_URL ?? '').replace(/\/+$/, '');

let _cachedTunnelBase: string | null = null;
let _tunnelFetchedAt = 0;
const TUNNEL_CACHE_MS = 30000; // re-check Supabase at most every 30s

async function resolveTunnelBase(): Promise<string> {
  // Use cache if fresh
  if (_cachedTunnelBase !== null && Date.now() - _tunnelFetchedAt < TUNNEL_CACHE_MS) {
    return _cachedTunnelBase;
  }
  try {
    const { supabase } = await import('@/integrations/supabase/client');
    const { data } = await supabase
      .from('app_config' as never)
      .select('value')
      .eq('key', 'llm_tunnel_url')
      .maybeSingle();
    const liveUrl = (data as { value?: string } | null)?.value?.replace(/\/+$/, '') ?? '';
    _cachedTunnelBase = liveUrl || ENV_TUNNEL_BASE;
  } catch {
    _cachedTunnelBase = ENV_TUNNEL_BASE;
  }
  _tunnelFetchedAt = Date.now();
  return _cachedTunnelBase;
}

// How long to wait for local before giving up and trying tunnel.
// 2.5 seconds — fast enough to not annoy users, long enough for a cold Studio.
const LOCAL_TIMEOUT_MS  = 2500;
const TUNNEL_TIMEOUT_MS = 180000; // 3 min — local Gemma can take 60-90s on large prompts

// ── Public types ───────────────────────────────────────────────────────────────
export type LLMEndpoint = 'local' | 'tunnel' | 'unavailable';

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMCallOptions {
  /** Which llama.cpp model profile to target. Default: 'local-model' (Gemma). */
  model?: string;
  temperature?: number;
  max_tokens?: number;
  /** Called as soon as we know which endpoint responded. Use to update UI status. */
  onEndpointResolved?: (endpoint: LLMEndpoint) => void;
}

export interface LLMResult {
  content: string;
  endpoint: LLMEndpoint;
}

export type RAGCollection = 'query' | 'unified' | 'excel' | 'web' | string;

export interface RAGCollectionInfo {
  key: RAGCollection;
  label: string;
  description?: string;
  docCount?: number;
}

export interface RAGResult {
  answer: string;
  sources: RAGSource[];
  hasContext: boolean;
  endpoint: LLMEndpoint;
}

export interface RAGSource {
  source?: string;
  title?: string;
  chunk?: string;
}

// ── Internal fetch helper ──────────────────────────────────────────────────────
async function postWithTimeout(
  url: string,
  body: object,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timer);
    return res;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

// ── Chat completions ───────────────────────────────────────────────────────────
/**
 * Send a chat request to APNJ-LLM-Studio.
 * Tries local first, falls back to tunnel automatically.
 *
 * Usage:
 *   const { content, endpoint } = await callLLM([
 *     { role: 'user', content: 'Generate a pricing rationale for...' }
 *   ]);
 */
export async function callLLM(
  messages: LLMMessage[],
  options: LLMCallOptions = {}
): Promise<LLMResult> {
  const {
    model       = 'local-model',
    temperature = 0.7,
    max_tokens  = 2048,
    onEndpointResolved,
  } = options;

  const body = { model, messages, temperature, max_tokens };

  // ── 1. Try local ─────────────────────────────────────────────────────────────
  try {
    const res = await postWithTimeout(
      `${LOCAL_BASE}/v1/chat/completions`,
      body,
      LOCAL_TIMEOUT_MS
    );
    if (res.ok) {
      const data = await res.json();
      onEndpointResolved?.('local');
      return {
        content: data.choices[0].message.content,
        endpoint: 'local',
      };
    }
  } catch {
    // Local not running or timed out — silent, try tunnel next
  }

  // ── 2. Fall back to tunnel ────────────────────────────────────────────────────
  const TUNNEL_BASE = await resolveTunnelBase();
  if (TUNNEL_BASE) {
    try {
      const res = await postWithTimeout(
        `${TUNNEL_BASE}/v1/chat/completions`,
        body,
        TUNNEL_TIMEOUT_MS
      );
      if (res.ok) {
        const data = await res.json();
        onEndpointResolved?.('tunnel');
        return {
          content: data.choices[0].message.content,
          endpoint: 'tunnel',
        };
      }
    } catch {
      // Tunnel also failed
    }
  }

  // ── 3. Both failed ────────────────────────────────────────────────────────────
  onEndpointResolved?.('unavailable');
  throw new Error(
    'APNJ-LLM-Studio is not reachable.\n\n' +
    'Please check:\n' +
    '• Start-APNJ-Studio.bat is running on the host machine\n' +
    '• If working remotely, confirm the Cloudflare tunnel is active\n' +
    '• VITE_LLM_TUNNEL_URL is set correctly in your .env'
  );
}

// ── RAG / Knowledge search ─────────────────────────────────────────────────────
/**
 * Query APNJ-Studio's RAG system (ChromaDB).
 * Use this for Legal Library clause matching, Knowledge Base search, etc.
 *
 * endpoint options:
 *   'query'   — search PDFs / Word / TXT docs only
 *   'excel'   — search Excel files only
 *   'web'     — search crawled web pages only
 *   'unified' — search ALL collections simultaneously (recommended)
 *
 * Usage:
 *   const { answer, sources } = await callRAG(
 *     `Legal clauses for SAP Rise Fixed Price India`,
 *     'unified'
 *   );
 */
export async function callRAG(
  question: string,
  ragEndpoint: RAGCollection = 'unified'
): Promise<RAGResult> {
  const path = `/rag/${ragEndpoint}`;
  const body = { question };

  // ── 1. Try local ─────────────────────────────────────────────────────────────
  try {
    const res = await postWithTimeout(
      `${LOCAL_BASE}${path}`,
      body,
      LOCAL_TIMEOUT_MS
    );
    if (res.ok) {
      const data = await res.json();
      return {
        answer:     data.answer     ?? '',
        sources:    data.sources    ?? [],
        hasContext: data.has_context !== false,
        endpoint:   'local',
      };
    }
  } catch {
    // Try tunnel
  }

  // ── 2. Fall back to tunnel ────────────────────────────────────────────────────
  const TUNNEL_BASE = await resolveTunnelBase();
  if (TUNNEL_BASE) {
    try {
      const res = await postWithTimeout(
        `${TUNNEL_BASE}${path}`,
        body,
        TUNNEL_TIMEOUT_MS
      );
      if (res.ok) {
        const data = await res.json();
        return {
          answer:     data.answer     ?? '',
          sources:    data.sources    ?? [],
          hasContext: data.has_context !== false,
          endpoint:   'tunnel',
        };
      }
    } catch {
      // Both failed
    }
  }

  throw new Error('RAG service unavailable. Ensure APNJ-LLM-Studio is running.');
}

// ── Collection discovery ──────────────────────────────────────────────────────
/**
 * Asks APNJ-Studio for the list of available RAG collections.
 * Studio should expose GET /rag/collections → [{ key, label, doc_count }]
 * Falls back to the 3 built-in collections if the endpoint doesn't exist.
 */
export async function listRAGCollections(): Promise<RAGCollectionInfo[]> {
  const FALLBACK: RAGCollectionInfo[] = [
    { key: 'query',   label: 'Documents',      description: 'PDFs, Word, TXT files' },
    { key: 'web',     label: 'Web Pages',       description: 'Crawled web content' },
    { key: 'unified', label: 'All Collections', description: 'All collections simultaneously' },
  ];

  const tryFetch = async (base: string): Promise<RAGCollectionInfo[] | null> => {
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(`${base}/rag/collections`, { signal: controller.signal });
      clearTimeout(t);
      if (!res.ok) return null;
      const data: Array<{ key: string; label?: string; description?: string; doc_count?: number }> = await res.json();
      return data.map(d => ({
        key:         d.key,
        label:       d.label ?? d.key.charAt(0).toUpperCase() + d.key.slice(1),
        description: d.description,
        docCount:    d.doc_count,
      }));
    } catch {
      return null;
    }
  };

  const local = await tryFetch(LOCAL_BASE);
  if (local) return local;
  const TUNNEL_BASE = await resolveTunnelBase();
  if (TUNNEL_BASE) {
    const tunnel = await tryFetch(TUNNEL_BASE);
    if (tunnel) return tunnel;
  }
  return FALLBACK;
}

// ── Health check (used by LLMStatusBadge) ─────────────────────────────────────
/**
 * Quick ping to check which endpoint is reachable right now.
 * Does NOT use the chat endpoint — just GETs /v1/models which is near-instant.
 */
export async function checkLLMHealth(): Promise<LLMEndpoint> {
  // Try local
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 2000); // BUG FIX: save ref so we can clear it
    const res = await fetch(`${LOCAL_BASE}/v1/models`, { signal: controller.signal });
    clearTimeout(t); // BUG FIX: clear timer on success so it doesn't fire after we've moved on
    if (res.ok) return 'local';
  } catch {
    // Try tunnel
  }

  // Try tunnel
  const TUNNEL_BASE = await resolveTunnelBase();
  if (TUNNEL_BASE) {
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 5000); // BUG FIX: save ref
      const res = await fetch(`${TUNNEL_BASE}/v1/models`, { signal: controller.signal });
      clearTimeout(t); // BUG FIX: clear on success
      if (res.ok) return 'tunnel';
    } catch {
      // Both unreachable
    }
  }

  return 'unavailable';
}
// ── DOCX Extraction ───────────────────────────────────────────────────────────
/**
 * Send a .docx file to APNJ-LLM-Studio for table-safe Markdown extraction.
 * Replaces mammoth.extractRawText() — tables are preserved as Markdown pipes.
 *
 * Tries local first (port 3000 CORS proxy), falls back to tunnel.
 *
 * Usage:
 *   const markdown = await extractDocxText(file);
 *   // markdown contains paragraphs + tables as | col | col | rows
 */
export async function extractDocxText(file: File): Promise<string> {
  const buildForm = () => {
    const form = new FormData();
    form.append('file', file, file.name);
    return form;
  };

  const doExtract = async (baseUrl: string): Promise<string> => {
    // 1. Submit the file
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000); // 30s to submit
    let res: Response;
    try {
      res = await fetch(`${baseUrl}/rag/extract-docx`, {
        method: 'POST',
        body: buildForm(),
        signal: controller.signal,
      });
      clearTimeout(timer);
    } catch (err) {
      clearTimeout(timer);
      throw err;
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error ?? `Server returned ${res.status}`);
    }

    const data = await res.json();

    // DOCX returns text directly
    if (data.text) return data.text as string;

    // PDF/Image returns job_id — poll for result
    if (data.job_id) {
      const jobId = data.job_id as string;
      console.log(`[extractDocxText] Async job started: ${jobId}`);

      // Poll every 5 seconds for up to 60 minutes
      const maxAttempts = 720;
      for (let i = 0; i < maxAttempts; i++) {
        await new Promise(r => setTimeout(r, 5000));

        const pollController = new AbortController();
        const pollTimer = setTimeout(() => pollController.abort(), 10000);
        try {
          const pollRes = await fetch(`${baseUrl}/rag/job-status/${jobId}`, {
            signal: pollController.signal,
          });
          clearTimeout(pollTimer);
          if (!pollRes.ok) continue;
          const pollData = await pollRes.json();

          if (pollData.status === 'done' && pollData.text) {
            console.log(`[extractDocxText] Job done: ${pollData.text.length} chars`);
            return pollData.text as string;
          }
          if (pollData.status === 'error') {
            throw new Error(pollData.detail || 'Extraction failed');
          }
          // Still processing — log progress
          if (pollData.pages_total > 0) {
            console.log(`[extractDocxText] Processing: ${pollData.pages_done}/${pollData.pages_total} pages`);
          }
        } catch (e) {
          clearTimeout(pollTimer);
          // Continue polling on transient errors
        }
      }
      throw new Error('Extraction timed out after 60 minutes');
    }

    throw new Error('Server returned empty text');
  };

  // Try local first, then tunnel
  try {
    return await doExtract(LOCAL_BASE);
  } catch {
    // Local failed — try tunnel
  }

  const TUNNEL_BASE = await resolveTunnelBase();
  if (TUNNEL_BASE) {
    try {
      return await doExtract(TUNNEL_BASE);
    } catch {
      // Both failed
    }
  }

  throw new Error(
    'APNJ-LLM-Studio is not reachable.\n\n' +
    'Please check:\n' +
    '• Start-APNJ-Studio.bat is running on the host machine\n' +
    '• If working remotely, confirm the Cloudflare tunnel is active'
  );
}


// ── RFP Document Indexing ─────────────────────────────────────────────────────
/**
 * Index a .docx RFP file into ChromaDB permanently, tagged with a session UUID.
 * Every chunk gets { proposal_id: rfpSessionId } metadata so future RAG queries
 * can filter to only this proposal's documents.
 *
 * Called once per file at upload time in NewProposalPage.
 * Uses POST /rag/index-rfp (multipart: file + proposal_id field).
 */
export async function indexRfpDocument(file: File, rfpSessionId: string): Promise<{ chunks: number }> {
  const buildForm = () => {
    const form = new FormData();
    form.append('file', file, file.name);
    form.append('proposal_id', rfpSessionId);
    return form;
  };

  const fetchWithTimeout = async (url: string, timeoutMs: number): Promise<{ chunks: number }> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { method: 'POST', body: buildForm(), signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error ?? `Server returned ${res.status}`);
      }
      const data = await res.json();
      return { chunks: data.chunks ?? 0 };
    } catch (err) {
      clearTimeout(timer);
      throw err;
    }
  };

  try {
    return await fetchWithTimeout(`${LOCAL_BASE}/rag/index-rfp`, LOCAL_TIMEOUT_MS);
  } catch { /* try tunnel */ }

  const TUNNEL_BASE = await resolveTunnelBase();
  if (TUNNEL_BASE) {
    try {
      return await fetchWithTimeout(`${TUNNEL_BASE}/rag/index-rfp`, TUNNEL_TIMEOUT_MS);
    } catch { /* both failed */ }
  }

  throw new Error('APNJ-LLM-Studio is not reachable — RFP indexing failed.');
}

// ── RFP Context Query ─────────────────────────────────────────────────────────
/**
 * Query ChromaDB for chunks tagged with this proposal's rfpSessionId.
 * Returns the relevant text as a single string for injection into LLM prompts.
 *
 * type:
 *   'resources' → roles, skills, team structure, certifications
 *   'hardware'  → servers, HCI, storage, network, licenses, travel
 *   'other'     → training, change management, support, other costs
 *   'scope'     → deliverables, modules, timeline, integration
 */
export async function queryRfpContext(
  question: string,
  rfpSessionId: string,
  type: 'resources' | 'hardware' | 'other' | 'scope'
): Promise<string> {
  const body = { question, proposal_id: rfpSessionId, type };

  const fetchWithTimeout = async (url: string, timeoutMs: number): Promise<string> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const data = await res.json();
      return (data.context as string) ?? '';
    } catch (err) {
      clearTimeout(timer);
      throw err;
    }
  };

  try {
    return await fetchWithTimeout(`${LOCAL_BASE}/rag/query-rfp`, LOCAL_TIMEOUT_MS);
  } catch { /* try tunnel */ }

  const TUNNEL_BASE = await resolveTunnelBase();
  if (TUNNEL_BASE) {
    try {
      return await fetchWithTimeout(`${TUNNEL_BASE}/rag/query-rfp`, TUNNEL_TIMEOUT_MS);
    } catch { /* both failed */ }
  }

  return ''; // Silent fallback — caller handles empty string
}