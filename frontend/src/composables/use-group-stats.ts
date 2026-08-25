/**
 * Composable cho thống kê hoạt động nhóm Zalo.
 * Nguồn: GET /zalo-accounts/:accountId/groups/stats (tổng quan)
 *        GET /zalo-accounts/:accountId/groups/:groupId/stats (chi tiết 1 nhóm)
 */
import { ref } from 'vue';
import { api } from '@/api/index';

export interface GroupStat {
  groupId: string | null;
  groupName: string | null;
  groupAvatarUrl: string | null;
  membersCount: number;
  lastMessageAt: string | null;
  unreadCount: number;
  isReplied: boolean;
  crmName: string | null;
  notes: string | null;
  tags: string[];
  assignedUserId: string | null;
  messages7d: number;
  messages30d: number;
  activeMembers30d: number;
  topSenders30d: Array<{ senderUid: string; senderName: string; count: number }>;
  status: 'active' | 'quiet' | 'silent';
}

export interface GroupDetailStat extends Omit<GroupStat, 'messages7d' | 'messages30d' | 'activeMembers30d' | 'topSenders30d'> {
  dailyActivity: Array<{ date: string; count: number }>;
  topSenders: Array<{ senderUid: string; senderName: string; count: number }>;
}

export function useGroupStats() {
  const stats = ref<GroupStat[]>([]);
  const detailStats = ref<GroupDetailStat | null>(null);
  const loading = ref(false);

  async function fetchGroupStats(accountId: string) {
    loading.value = true;
    try {
      const res = await api.get(`/zalo-accounts/${accountId}/groups/stats`);
      stats.value = res.data.stats ?? [];
      return stats.value;
    } catch (err) {
      console.error('Failed to fetch group stats:', err);
      return null;
    } finally {
      loading.value = false;
    }
  }

  async function fetchGroupDetailStats(accountId: string, groupId: string) {
    loading.value = true;
    try {
      const res = await api.get(`/zalo-accounts/${accountId}/groups/${groupId}/stats`);
      detailStats.value = res.data.stats;
      return res.data.stats as GroupDetailStat;
    } catch (err) {
      console.error('Failed to fetch group detail stats:', err);
      return null;
    } finally {
      loading.value = false;
    }
  }

  return { stats, detailStats, loading, fetchGroupStats, fetchGroupDetailStats };
}
