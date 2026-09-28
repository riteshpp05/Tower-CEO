/**
 * useNotifications.ts
 * In-app notification system for proposal workflow events.
 * Notifications are stored in Supabase `notifications` table.
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface Notification {
  id: string;
  proposal_id: string | null;
  proposal_title: string | null;
  message: string;
  type: 'info' | 'approval_required' | 'approved' | 'rejected' | 'sent_back';
  is_read: boolean;
  created_at: string;
}

export function useNotifications() {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchNotifications = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('notifications' as never)
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);
    setNotifications((data as Notification[]) || []);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    fetchNotifications();

    // Real-time subscription
    const channel = supabase
      .channel('notifications')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
      }, () => { fetchNotifications(); })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [fetchNotifications]);

  const markRead = async (id: string) => {
    await supabase
      .from('notifications' as never)
      .update({ is_read: true } as never)
      .eq('id', id);
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
  };

  const markAllRead = async () => {
    await supabase
      .from('notifications' as never)
      .update({ is_read: true } as never)
      .eq('is_read', false);
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
  };

  const unreadCount = notifications.filter(n => !n.is_read).length;

  return { notifications, loading, unreadCount, markRead, markAllRead, refetch: fetchNotifications };
}

/**
 * Send notifications to multiple users when a proposal stage changes.
 * Call this after any approval action.
 */
export async function sendStageNotifications({
  proposalId,
  proposalTitle,
  newStage,
  action,
  actorName,
  recipientIds,
}: {
  proposalId: string;
  proposalTitle: string;
  newStage: string;
  action: 'approved' | 'rejected' | 'sent_back' | 'submitted';
  actorName: string;
  recipientIds: string[];
}) {
  if (recipientIds.length === 0) return;

  const messageMap: Record<string, string> = {
    approved:   `${actorName} approved "${proposalTitle}" → moved to ${newStage}`,
    rejected:   `${actorName} rejected "${proposalTitle}"`,
    sent_back:  `${actorName} sent back "${proposalTitle}" for revision`,
    submitted:  `"${proposalTitle}" submitted for ${newStage} by ${actorName}`,
  };

  const typeMap: Record<string, Notification['type']> = {
    approved:  'approved',
    rejected:  'rejected',
    sent_back: 'sent_back',
    submitted: 'approval_required',
  };

  const rows = recipientIds.map(userId => ({
    user_id:        userId,
    proposal_id:    proposalId,
    proposal_title: proposalTitle,
    message:        messageMap[action],
    type:           typeMap[action],
    is_read:        false,
  }));

  await supabase.from('notifications' as never).insert(rows as never);
}