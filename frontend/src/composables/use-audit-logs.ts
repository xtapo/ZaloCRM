import { ref } from 'vue';
import { api } from '@/api/index';
import { useToast } from '@/composables/use-toast';

export interface AuditLogItem {
  id: string;
  orgId: string;
  userId?: string | null;
  actorType: string;
  botName?: string | null;
  systemSource?: string | null;
  category: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  details?: Record<string, unknown> | null;
  ipHash?: string | null;
  userAgent?: string | null;
  createdAt: string;
  user?: { id: string; fullName: string; email: string } | null;
}

export interface AuditLogMeta {
  categories: { value: string; count: number }[];
  users: { id: string; fullName: string; email: string }[];
  actions: string[];
}

export interface AuditLogFilters {
  activePreset: string;
  customFrom: string;
  customTo: string;
  selectedUsers: Set<string>;
  selectedCategories: Set<string>;
  selectedActions: Set<string>;
  selectedActorTypes: Set<string>;
  searchQuery: string;
}

const ACTOR_TYPES = ['user', 'bot', 'system'] as const;

export function useAuditLogs() {
  const toast = useToast();

  const loading = ref(false);
  const loadingMore = ref(false);
  const exporting = ref(false);
  const logs = ref<AuditLogItem[]>([]);
  const nextCursor = ref<string | null>(null);
  const meta = ref<AuditLogMeta | null>(null);

  /* ── Filter state ─────────────────────────────────────────────────────── */
  const activePreset = ref('7d');
  const customFrom = ref('');
  const customTo = ref('');
  const selectedUsers = ref<Set<string>>(new Set());
  const selectedCategories = ref<Set<string>>(new Set());
  const selectedActions = ref<Set<string>>(new Set());
  const selectedActorTypes = ref<Set<string>>(new Set(ACTOR_TYPES));
  const searchQuery = ref('');

  /* ── Query builder (dùng chung cho list + export) ─────────────────────── */
  function buildQueryParams(cursor?: string): Record<string, string> {
    const params: Record<string, string> = { limit: '50' };
    if (cursor) params.cursor = cursor;

    const now = new Date();
    if (activePreset.value === '24h') {
      params.from = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();
    } else if (activePreset.value === '7d') {
      params.from = new Date(now.getTime() - 7 * 24 * 3600 * 1000).toISOString();
    } else if (activePreset.value === '30d') {
      params.from = new Date(now.getTime() - 30 * 24 * 3600 * 1000).toISOString();
    } else if (activePreset.value === '90d') {
      params.from = new Date(now.getTime() - 90 * 24 * 3600 * 1000).toISOString();
    } else if (activePreset.value === 'custom') {
      if (customFrom.value) params.from = new Date(customFrom.value).toISOString();
      if (customTo.value) params.to = new Date(customTo.value).toISOString();
    }

    if (selectedUsers.value.size) params.users = Array.from(selectedUsers.value).join(',');
    // categories/actions rỗng hoàn toàn = không filter (khác SecurityEvents dùng 'none')
    if (selectedCategories.value.size) {
      params.categories = Array.from(selectedCategories.value).join(',');
    }
    if (selectedActions.value.size) {
      params.actions = Array.from(selectedActions.value).join(',');
    }
    if (selectedActorTypes.value.size > 0 && selectedActorTypes.value.size < ACTOR_TYPES.length) {
      params.actorTypes = Array.from(selectedActorTypes.value).join(',');
    }
    if (searchQuery.value.trim()) params.search = searchQuery.value.trim();

    return params;
  }

  /* ── Meta (dropdown data) ─────────────────────────────────────────────── */
  async function fetchMeta() {
    try {
      const res = await api.get('/audit-logs/meta');
      meta.value = res.data as AuditLogMeta;
    } catch {
      // Meta là convenience — fail im lặng, dropdown vẫn hoạt động với state local
    }
  }

  /* ── Listing ──────────────────────────────────────────────────────────── */
  async function fetchLogs(reset = false) {
    if (reset) {
      loading.value = true;
      nextCursor.value = null;
    }
    try {
      const res = await api.get('/audit-logs', { params: buildQueryParams() });
      logs.value = res.data.logs || [];
      nextCursor.value = res.data.nextCursor || null;
    } catch (err: any) {
      if (err.response?.status === 403) {
        toast.error('Bạn không có quyền xem audit log của tổ chức.');
      } else {
        toast.error('Không thể tải nhật ký hệ thống.');
      }
    } finally {
      loading.value = false;
    }
  }

  async function loadMore() {
    if (!nextCursor.value || loadingMore.value) return;
    loadingMore.value = true;
    try {
      const res = await api.get('/audit-logs', {
        params: buildQueryParams(nextCursor.value),
      });
      const newItems: AuditLogItem[] = res.data.logs || [];
      logs.value = [...logs.value, ...newItems];
      nextCursor.value = res.data.nextCursor || null;
    } catch {
      toast.error('Lỗi khi tải thêm dữ liệu.');
    } finally {
      loadingMore.value = false;
    }
  }

  /* ── CSV export — mở tab mới với cùng bộ filter hiện tại ─────────────── */
  function exportCsv(): void {
    const params = buildQueryParams();
    delete params.limit; // backend export tự cap 10K
    const qs = new URLSearchParams(params).toString();
    window.open(`/api/v1/audit-logs/export${qs ? `?${qs}` : ''}`, '_blank');
  }

  /* ── Filter handlers ──────────────────────────────────────────────────── */
  function toggleInSet(setRef: typeof selectedUsers, key: string) {
    const next = new Set(setRef.value);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setRef.value = next;
    fetchLogs(true);
  }

  function resetFilters(defaultCategories: string[]) {
    activePreset.value = '7d';
    customFrom.value = '';
    customTo.value = '';
    selectedUsers.value = new Set();
    selectedCategories.value = new Set(defaultCategories);
    selectedActions.value = new Set();
    selectedActorTypes.value = new Set(ACTOR_TYPES);
    searchQuery.value = '';
    fetchLogs(true);
  }

  return {
    // state
    loading,
    loadingMore,
    exporting,
    logs,
    nextCursor,
    meta,
    activePreset,
    customFrom,
    customTo,
    selectedUsers,
    selectedCategories,
    selectedActions,
    selectedActorTypes,
    searchQuery,
    ACTOR_TYPES,
    // methods
    fetchMeta,
    fetchLogs,
    loadMore,
    exportCsv,
    buildQueryParams,
    toggleInSet,
    resetFilters,
  };
}
