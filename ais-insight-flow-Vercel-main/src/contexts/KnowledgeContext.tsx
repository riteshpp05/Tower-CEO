import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { knowledgeItems as initialItems, type KnowledgeItem } from '@/data/mockData';

interface KnowledgeContextType {
  items: KnowledgeItem[];
  addItem: (item: KnowledgeItem) => void;
  updateItem: (id: string, updates: Partial<KnowledgeItem>) => void;
  deleteItem: (id: string) => void;
  approveItem: (id: string) => void;
  rejectItem: (id: string) => void;
  archiveItem: (id: string) => void;
  restoreItem: (id: string) => void;
  bumpVersion: (id: string) => void;
}

const KnowledgeContext = createContext<KnowledgeContextType | null>(null);

export const useKnowledge = () => {
  const ctx = useContext(KnowledgeContext);
  if (!ctx) throw new Error('useKnowledge must be inside KnowledgeProvider');
  return ctx;
};

export function KnowledgeProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<KnowledgeItem[]>(initialItems);

  const addItem = useCallback((item: KnowledgeItem) => {
    setItems(prev => [item, ...prev]);
  }, []);

  const updateItem = useCallback((id: string, updates: Partial<KnowledgeItem>) => {
    setItems(prev => prev.map(i => i.id === id ? { ...i, ...updates, lastUpdated: new Date().toISOString().slice(0, 10) } : i));
  }, []);

  const deleteItem = useCallback((id: string) => {
    setItems(prev => prev.filter(i => i.id !== id));
  }, []);

  const approveItem = useCallback((id: string) => {
    setItems(prev => prev.map(i => i.id === id ? { ...i, approvalStatus: 'Approved' as const, lastUpdated: new Date().toISOString().slice(0, 10) } : i));
  }, []);

  const rejectItem = useCallback((id: string) => {
    setItems(prev => prev.map(i => i.id === id ? { ...i, approvalStatus: 'Pending' as const, lastUpdated: new Date().toISOString().slice(0, 10) } : i));
  }, []);

  const archiveItem = useCallback((id: string) => {
    setItems(prev => prev.map(i => i.id === id ? { ...i, approvalStatus: 'Archived' as const, lastUpdated: new Date().toISOString().slice(0, 10) } : i));
  }, []);

  const restoreItem = useCallback((id: string) => {
    setItems(prev => prev.map(i => i.id === id ? { ...i, approvalStatus: 'Pending' as const, lastUpdated: new Date().toISOString().slice(0, 10) } : i));
  }, []);

  const bumpVersion = useCallback((id: string) => {
    setItems(prev => prev.map(i => {
      if (i.id !== id) return i;
      const parts = i.version.split('.');
      const major = parseInt(parts[0]) || 1;
      const minor = (parseInt(parts[1]) || 0) + 1;
      return { ...i, version: `${major}.${minor}`, approvalStatus: 'Pending' as const, lastUpdated: new Date().toISOString().slice(0, 10) };
    }));
  }, []);

  return (
    <KnowledgeContext.Provider value={{ items, addItem, updateItem, deleteItem, approveItem, rejectItem, archiveItem, restoreItem, bumpVersion }}>
      {children}
    </KnowledgeContext.Provider>
  );
}
