import { useCallback, useEffect, useState } from 'react';
import { getTender, saveTender } from '@/lib/tenderEngine';
import type { TenderRecord } from '@/lib/tenderEngine';

interface UseTenderResult {
  tender: TenderRecord | null;
  loading: boolean;
  notFound: boolean;
  /** Replaces the in-memory record and persists it. */
  save: (next: TenderRecord) => Promise<void>;
  /** Re-fetches from storage (e.g. after another tab/page mutated it). */
  reload: () => Promise<void>;
}

export function useTender(id: string | undefined): UseTenderResult {
  const [tender, setTender] = useState<TenderRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const reload = useCallback(async () => {
    if (!id) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    setLoading(true);
    const record = await getTender(id);
    if (record) {
      setTender(record);
      setNotFound(false);
    } else {
      setNotFound(true);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    reload();
  }, [reload]);

  const save = useCallback(async (next: TenderRecord) => {
    setTender(next);
    await saveTender(next);
  }, []);

  return { tender, loading, notFound, save, reload };
}