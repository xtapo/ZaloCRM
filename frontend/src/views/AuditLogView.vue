<template>
  <div class="audit-log-view">
    <!-- Header -->
    <header class="page-header">
      <div class="header-left">
        <div class="title-row">
          <span class="title-badge">📋</span>
          <h1>Audit Log</h1>
        </div>
        <p class="subtitle">
          Nhật ký toàn tổ chức: đăng nhập, thay đổi quyền, quản trị hệ thống và mọi thao tác dữ liệu.
        </p>
      </div>
      <div class="header-actions">
        <button class="btn btn-secondary" :disabled="exporting" @click="exportCsv">
          ⬇️ Export CSV
        </button>
        <button class="btn btn-secondary" :disabled="loading" @click="fetchLogs(true)">
          <span :class="{ 'spin-icon': loading }">⟳</span> Làm mới
        </button>
      </div>
    </header>

    <!-- Stat Highlights -->
    <section class="stat-cards">
      <div class="stat-card">
        <div class="stat-icon blue">📊</div>
        <div class="stat-info">
          <div class="stat-value">{{ logs.length }}</div>
          <div class="stat-label">Sự kiện đang hiển thị</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon green">👥</div>
        <div class="stat-info">
          <div class="stat-value">{{ activeUserCount }}</div>
          <div class="stat-label">User có hoạt động</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon orange">⚠️</div>
        <div class="stat-info">
          <div class="stat-value">{{ loginFailedCount }}</div>
          <div class="stat-label">Đăng nhập thất bại</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon purple">🛠️</div>
        <div class="stat-info">
          <div class="stat-value">{{ permissionChangeCount }}</div>
          <div class="stat-label">Thay đổi quyền / quản trị</div>
        </div>
      </div>
    </section>

    <!-- Main Layout: Filters + Logs Table -->
    <div class="content-layout">
      <!-- Filter Sidebar -->
      <aside class="filters-sidebar">
        <!-- Date Presets -->
        <div class="filter-section">
          <label class="section-title">📅 Khoảng thời gian</label>
          <div class="preset-chips">
            <button
              v-for="p in DATE_PRESETS"
              :key="p.value"
              class="preset-chip"
              :class="{ active: activePreset === p.value }"
              @click="applyPreset(p.value)"
            >
              {{ p.label }}
            </button>
          </div>
          <div v-if="activePreset === 'custom'" class="custom-date-inputs">
            <div class="date-field">
              <span>Từ:</span>
              <input type="datetime-local" v-model="customFrom" @change="fetchLogs(true)" />
            </div>
            <div class="date-field">
              <span>Đến:</span>
              <input type="datetime-local" v-model="customTo" @change="fetchLogs(true)" />
            </div>
          </div>
        </div>

        <!-- Category Filter -->
        <div class="filter-section">
          <label class="section-title">🗂 Nhóm sự kiện</label>
          <div class="category-chip-list">
            <button
              v-for="cat in categoryChips"
              :key="cat.value"
              class="category-chip"
              :class="{ active: selectedCategories.has(cat.value) }"
              :style="selectedCategories.has(cat.value) ? { borderColor: cat.color } : undefined"
              @click="toggleCategory(cat.value)"
            >
              <span>{{ cat.icon }}</span> {{ cat.label }}
            </button>
          </div>
        </div>

        <!-- Actor Type -->
        <div class="filter-section">
          <label class="section-title">👤 Đối tượng thực hiện</label>
          <div class="actor-type-row">
            <label
              v-for="t in ACTOR_TYPES"
              :key="t"
              class="actor-type-checkbox"
              :class="{ checked: selectedActorTypes.has(t) }"
            >
              <input
                type="checkbox"
                :checked="selectedActorTypes.has(t)"
                @change="toggleActorType(t)"
              />
              {{ ACTOR_TYPE_LABEL[t] }}
            </label>
          </div>
        </div>

        <!-- User Filter -->
        <div class="filter-section">
          <label class="section-title">🧑 User</label>
          <select class="user-select" v-model="userFilterSelection" @change="onUserFilterChange">
            <option value="">Tất cả user</option>
            <option v-for="u in meta?.users || []" :key="u.id" :value="u.id">
              {{ u.fullName }} ({{ u.email }})
            </option>
          </select>
        </div>

        <!-- Search -->
        <div class="filter-section">
          <label class="section-title">🔍 Tìm kiếm</label>
          <div class="search-box">
            <input
              type="text"
              v-model="searchQuery"
              placeholder="Hành động, nội dung, tên..."
              @keyup.enter="fetchLogs(true)"
            />
            <button v-if="searchQuery" class="clear-btn" @click="searchQuery = ''; fetchLogs(true)">×</button>
          </div>
        </div>

        <button class="btn btn-outline reset-all-btn" @click="resetFilters(DEFAULT_CATEGORIES)">
          ⟲ Đặt lại bộ lọc
        </button>
      </aside>

      <!-- Logs Table -->
      <main class="logs-main">
        <div class="table-card">
          <div class="table-header-bar">
            <div class="table-title">
              <span>Nhật ký hoạt động</span>
              <span class="badge-count">{{ logs.length }}</span>
            </div>
            <div v-if="loading && logs.length" class="inline-loading">Đang tải...</div>
          </div>

          <!-- Loading State -->
          <div v-if="loading && !logs.length" class="empty-state">
            <div class="spinner"></div>
            <p>Đang tải nhật ký hệ thống...</p>
          </div>

          <!-- Empty State -->
          <div v-else-if="!logs.length" class="empty-state">
            <div class="empty-icon">📋</div>
            <h3>Không có nhật ký nào</h3>
            <p class="text-muted">
              Không tìm thấy sự kiện nào khớp với bộ lọc hiện tại trong khoảng thời gian đã chọn.
            </p>
          </div>

          <!-- Table Container -->
          <div v-else class="table-wrapper">
            <table class="logs-table">
              <thead>
                <tr>
                  <th style="width: 160px;">Thời gian</th>
                  <th style="width: 200px;">Người thực hiện</th>
                  <th style="width: 200px;">Hành động</th>
                  <th>Chi tiết</th>
                </tr>
              </thead>
              <tbody>
                <template v-for="item in logs" :key="item.id">
                  <tr class="log-row" :class="{ expanded: expandedRows.has(item.id) }">
                    <!-- Thời gian -->
                    <td class="cell-time">
                      <div class="time-primary">{{ formatRelativeTime(item.createdAt) }}</div>
                      <div class="time-secondary">{{ formatDateTime(item.createdAt) }}</div>
                    </td>

                    <!-- Người thực hiện -->
                    <td class="cell-actor">
                      <div v-if="item.user" class="actor-user">
                        <div class="actor-avatar">{{ item.user.fullName?.charAt(0) || 'U' }}</div>
                        <div class="actor-meta">
                          <div class="actor-name">{{ item.user.fullName }}</div>
                          <div class="actor-email">{{ item.user.email }}</div>
                        </div>
                      </div>
                      <div v-else-if="item.actorType === 'bot'" class="actor-system">
                        <span>🤖</span>
                        <span>{{ item.botName || 'Bot tự động' }}</span>
                      </div>
                      <div v-else class="actor-system">
                        <span>⚙️</span>
                        <span>{{ item.systemSource || 'Hệ thống CRM' }}</span>
                      </div>
                    </td>

                    <!-- Hành động -->
                    <td class="cell-action">
                      <div class="action-tag" :class="categoryClass(item.category)">
                        <span class="tag-icon">{{ actionIcon(item.action) }}</span>
                        <span class="tag-text">{{ actionLabel(item.action) }}</span>
                      </div>
                      <div class="action-category-sub">{{ categoryLabel(item.category) }}</div>
                    </td>

                    <!-- Chi tiết -->
                    <td class="cell-details">
                      <div class="details-summary">
                        <span v-if="detailSummary(item)" class="summary-text">{{ detailSummary(item) }}</span>
                        <span v-else-if="item.entityId" class="entity-id-text mono">{{ shortId(item.entityId) }}</span>
                        <span v-else class="text-muted">—</span>
                        <button
                          v-if="hasDetails(item)"
                          class="expand-btn"
                          @click="toggleExpand(item.id)"
                        >
                          {{ expandedRows.has(item.id) ? '▲ Ẩn' : '▼ Xem' }}
                        </button>
                      </div>
                    </td>
                  </tr>
                  <!-- Expanded diff row -->
                  <tr v-if="expandedRows.has(item.id)" class="expand-row">
                    <td :colspan="4" class="expand-cell">
                      <pre class="diff-block">{{ formatDetails(item.details) }}</pre>
                      <div v-if="item.ipHash || item.userAgent" class="device-info">
                        <span v-if="item.userAgent" class="device-line" :title="item.userAgent">
                          🖥 {{ item.userAgent }}
                        </span>
                        <span v-if="item.ipHash" class="ip-line mono">🌐 IP hash: {{ item.ipHash }}</span>
                      </div>
                    </td>
                  </tr>
                </template>
              </tbody>
            </table>
          </div>

          <!-- Pagination / Load more footer -->
          <div v-if="logs.length" class="table-footer">
            <div class="footer-info">
              Đang hiển thị <strong>{{ logs.length }}</strong> sự kiện
            </div>
            <div v-if="nextCursor" class="footer-actions">
              <button class="btn btn-secondary btn-sm" :disabled="loadingMore" @click="loadMore">
                {{ loadingMore ? 'Đang tải thêm...' : '↓ Tải thêm dữ liệu' }}
              </button>
            </div>
            <div v-else class="end-of-list">
              ─ Đã tải toàn bộ ─
            </div>
          </div>
        </div>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import {
  useAuditLogs,
} from '@/composables/use-audit-logs';
import {
  CATEGORY_META,
  ACTION_META,
  ALL_CATEGORIES,
  categoryOf,
} from '@/constants/activity-types';

const {
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
  selectedActorTypes,
  searchQuery,
  ACTOR_TYPES,
  fetchMeta,
  fetchLogs,
  loadMore,
  exportCsv,
  toggleInSet,
  resetFilters,
} = useAuditLogs();

/* ── Filter constants ─────────────────────────────────────────────────── */
const DATE_PRESETS = [
  { label: '24 giờ', value: '24h' },
  { label: '7 ngày', value: '7d' },
  { label: '30 ngày', value: '30d' },
  { label: '90 ngày', value: '90d' },
  { label: 'Tất cả', value: 'all' },
  { label: 'Tùy chọn', value: 'custom' },
];

const ACTOR_TYPE_LABEL: Record<string, string> = {
  user: '👤 User',
  bot: '🤖 Bot',
  system: '⚙️ Hệ thống',
};

const DEFAULT_CATEGORIES = ['auth', 'admin', 'security'];

/* Category chips hiển thị: chỉ những nhóm CÓ dữ liệu + các nhóm default */
const categoryChips = computed(() => {
  const withData = new Set((meta.value?.categories || []).map((c) => c.value));
  return ALL_CATEGORIES.filter(
    (c) => DEFAULT_CATEGORIES.includes(c) || withData.has(c),
  ).map((c) => ({ value: c, ...CATEGORY_META[c] }));
});

/* ── Stats ────────────────────────────────────────────────────────────── */
const activeUserCount = computed(
  () => new Set(logs.value.filter((l) => l.userId && l.user).map((l) => l.userId)).size,
);
const loginFailedCount = computed(
  () => logs.value.filter((l) => l.action === 'auth_login_failed').length,
);
const permissionChangeCount = computed(() =>
  logs.value.filter(
    (l) =>
      l.action.startsWith('permission_group') ||
      l.action === 'user_assign_permission_group' ||
      ['role_change'].includes(l.action),
  ).length,
);

/* ── Row expansion ────────────────────────────────────────────────────── */
const expandedRows = ref<Set<string>>(new Set());
function toggleExpand(id: string) {
  const next = new Set(expandedRows.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  expandedRows.value = next;
}

function hasDetails(item: { details?: Record<string, unknown> | null }): boolean {
  return !!item.details && Object.keys(item.details).length > 0;
}

function formatDetails(details?: Record<string, unknown> | null): string {
  if (!details || !Object.keys(details).length) return '(không có chi tiết)';
  return JSON.stringify(details, null, 2);
}

/** Tóm tắt một dòng cho cột chi tiết — lấy vài field quan trọng đầu tiên */
function detailSummary(
  item: { action: string; details?: Record<string, unknown> | null },
): string {
  const d = item.details;
  if (!d) return '';
  // Ưu tiên các field phổ biến theo loại action
  for (const key of [
    'email', 'targetEmail', 'fullName', 'name', 'reason', 'type',
    'oldGroupId', 'newGroupId',
  ]) {
    if (d[key] != null && typeof d[key] !== 'object') {
      const val = String(d[key]);
      return val.length > 60 ? `${val.slice(0, 60)}…` : val;
    }
  }
  const keys = Object.keys(d);
  if (!keys.length) return '';
  return `${keys.length} trường`;
}

function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 12)}…` : id;
}

/* ── Filter handlers ──────────────────────────────────────────────────── */
function applyPreset(preset: string) {
  activePreset.value = preset;
  if (preset !== 'custom') fetchLogs(true);
}

const userFilterSelection = ref('');
function onUserFilterChange() {
  selectedUsers.value = userFilterSelection.value
    ? new Set([userFilterSelection.value])
    : new Set();
  fetchLogs(true);
}

function toggleCategory(value: string) {
  toggleInSet(selectedCategories, value);
}
function toggleActorType(value: string) {
  toggleInSet(selectedActorTypes, value);
}

/* ── Formatters ───────────────────────────────────────────────────────── */
function formatDateTime(iso: string): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function formatRelativeTime(iso: string): string {
  if (!iso) return '';
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return 'Vừa xong';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} phút trước`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} giờ trước`;
  const diffDays = Math.floor(diffHour / 24);
  if (diffDays <= 30) return `${diffDays} ngày trước`;
  return formatDateTime(iso);
}

function actionLabel(action: string): string {
  return ACTION_META[action]?.label || action;
}
function actionIcon(action: string): string {
  return ACTION_META[action]?.icon || CATEGORY_META[categoryOf(action)].icon;
}
function categoryLabel(category?: string | null): string {
  if (!category || !(category in CATEGORY_META)) return 'Khác';
  return CATEGORY_META[category as keyof typeof CATEGORY_META].label;
}
function categoryClass(category?: string | null): string {
  switch (category) {
    case 'auth':
      return 'tag-auth';
    case 'admin':
      return 'tag-admin';
    case 'security':
      return 'tag-danger';
    case 'automation':
      return 'tag-bot';
    case 'system':
      return 'tag-default';
    default:
      return 'tag-neutral';
  }
}

/* ── Init ─────────────────────────────────────────────────────────────── */
onMounted(async () => {
  fetchMeta();
  await fetchLogs(true);
});
</script>

<style scoped>
.audit-log-view {
  padding: 24px;
  max-width: 1400px;
  margin: 0 auto;
  min-height: calc(100vh - var(--smax-topnav-h, 76px));
}

/* ── Page Header ──────────────────────────────────────────────────────── */
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 24px;
  gap: 16px;
}

.title-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.title-badge {
  font-size: 26px;
  line-height: 1;
}

.page-header h1 {
  font-size: 24px;
  font-weight: 700;
  color: var(--smax-text, #0f172a);
  margin: 0;
}

.subtitle {
  color: var(--smax-text-muted, #64748b);
  font-size: 14px;
  margin-top: 4px;
  margin-bottom: 0;
}

.header-actions {
  display: flex;
  gap: 10px;
  flex-shrink: 0;
}

/* ── Stat Highlights ──────────────────────────────────────────────────── */
.stat-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 16px;
  margin-bottom: 24px;
}

.stat-card {
  background: var(--smax-surface, #ffffff);
  border-radius: 12px;
  padding: 16px 20px;
  border: 1px solid var(--smax-surface-border, #e2e8f0);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
  display: flex;
  align-items: center;
  gap: 16px;
}

.stat-icon {
  width: 44px;
  height: 44px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
}

.stat-icon.blue { background: #e0f2fe; color: #0284c7; }
.stat-icon.green { background: var(--smax-primary-soft, #dcfce7); color: #15803d; }
.stat-icon.orange { background: var(--smax-warning-soft, #ffedd5); color: var(--smax-warning, #ea580c); }
.stat-icon.purple { background: #f3e8ff; color: #9333ea; }

.stat-value {
  font-size: 22px;
  font-weight: 700;
  color: var(--smax-text, #0f172a);
  line-height: 1.2;
}

.stat-label {
  font-size: 13px;
  color: var(--smax-text-muted, #64748b);
  margin-top: 2px;
}

/* ── Content Layout ───────────────────────────────────────────────────── */
.content-layout {
  display: grid;
  grid-template-columns: 280px 1fr;
  gap: 20px;
  align-items: start;
}

@media (max-width: 960px) {
  .content-layout {
    grid-template-columns: 1fr;
  }
}

/* ── Filters Sidebar ──────────────────────────────────────────────────── */
.filters-sidebar {
  background: var(--smax-surface, #ffffff);
  border: 1px solid var(--smax-surface-border, #e2e8f0);
  border-radius: 12px;
  padding: 18px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
}

.filter-section {
  margin-bottom: 22px;
}

.section-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--smax-text-muted, #475569);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  display: block;
  margin-bottom: 10px;
}

.preset-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.preset-chip {
  padding: 6px 12px;
  font-size: 12.5px;
  border-radius: 20px;
  border: 1px solid var(--smax-surface-border, #e2e8f0);
  background: var(--smax-surface-muted, #f8fafc);
  color: var(--smax-text-muted, #475569);
  cursor: pointer;
  transition: all 0.15s ease;
}

.preset-chip:hover {
  background: var(--smax-primary-soft, #f1f5f9);
  border-color: var(--smax-primary, #cbd5e1);
}

.preset-chip.active {
  background: var(--smax-primary, #16a34a);
  color: #ffffff;
  border-color: var(--smax-primary, #16a34a);
  font-weight: 500;
}

.custom-date-inputs {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.date-field {
  display: flex;
  flex-direction: column;
  font-size: 12px;
  color: var(--smax-text-muted, #64748b);
  gap: 4px;
}

.date-field input {
  padding: 6px 8px;
  border: 1px solid var(--smax-surface-border, #cbd5e1);
  background: var(--smax-surface-muted, #f8fafc);
  color: var(--smax-text, #0f172a);
  border-radius: 6px;
  font-size: 12px;
}

/* Category chips */
.category-chip-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.category-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 11px;
  font-size: 12.5px;
  border-radius: 18px;
  border: 1.5px solid transparent;
  background: var(--smax-surface-muted, #f1f5f9);
  color: var(--smax-text-muted, #334155);
  cursor: pointer;
  transition: all 0.15s ease;
}

.category-chip:hover {
  background: var(--smax-primary-soft, #f1f5f9);
}

.category-chip.active {
  background: var(--smax-primary-soft, #dcfce7);
  border-color: var(--smax-primary, #16a34a);
  color: var(--smax-primary, #15803d);
  font-weight: 600;
}

/* Actor types */
.actor-type-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.actor-type-checkbox {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--smax-text, #334155);
  cursor: pointer;
  padding: 5px 8px;
  border-radius: 6px;
}

.actor-type-checkbox:hover {
  background: var(--smax-surface-muted, #f1f5f9);
}

.actor-type-checkbox input {
  cursor: pointer;
}

/* User select */
.user-select {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--smax-surface-border, #cbd5e1);
  background: var(--smax-surface-muted, #f8fafc);
  color: var(--smax-text, #0f172a);
  border-radius: 8px;
  font-size: 13px;
}

/* Search */
.search-box {
  position: relative;
  display: flex;
  align-items: center;
}

.search-box input {
  width: 100%;
  padding: 8px 30px 8px 10px;
  border: 1px solid var(--smax-surface-border, #cbd5e1);
  border-radius: 8px;
  font-size: 13px;
  background: var(--smax-surface-muted, #f8fafc);
  color: var(--smax-text, #0f172a);
}

.search-box input:focus {
  outline: none;
  border-color: var(--smax-primary, #16a34a);
  box-shadow: 0 0 0 2px rgba(22, 163, 74, 0.15);
}

.clear-btn {
  position: absolute;
  right: 8px;
  background: none;
  border: none;
  color: var(--smax-text-subtle, #94a3b8);
  cursor: pointer;
  font-size: 16px;
}

.reset-all-btn {
  width: 100%;
  padding: 8px;
  font-size: 13px;
  margin-top: 10px;
}

/* ── Logs Table Main ──────────────────────────────────────────────────── */
.logs-main {
  min-width: 0;
}

.table-card {
  background: var(--smax-surface, #ffffff);
  border: 1px solid var(--smax-surface-border, #e2e8f0);
  border-radius: 12px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
  overflow: hidden;
}

.table-header-bar {
  padding: 16px 20px;
  border-bottom: 1px solid var(--smax-surface-border, #e2e8f0);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.table-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--smax-text, #0f172a);
  display: flex;
  align-items: center;
  gap: 8px;
}

.badge-count {
  background: var(--smax-surface-muted, #f1f5f9);
  color: var(--smax-text-muted, #475569);
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 600;
}

.inline-loading {
  font-size: 12.5px;
  color: var(--smax-text-muted, #64748b);
}

.table-wrapper {
  overflow-x: auto;
}

.logs-table {
  width: 100%;
  border-collapse: collapse;
  text-align: left;
  font-size: 13px;
}

.logs-table th {
  background: var(--smax-surface-muted, #f8fafc);
  color: var(--smax-text-muted, #475569);
  font-weight: 600;
  padding: 12px 16px;
  border-bottom: 1px solid var(--smax-surface-border, #e2e8f0);
}

.logs-table td {
  padding: 12px 16px;
  border-bottom: 1px solid var(--smax-surface-border, #f1f5f9);
  vertical-align: middle;
}

.log-row:hover {
  background: var(--smax-surface-muted, #f8fafc);
}

.log-row.expanded {
  background: var(--smax-surface-muted, #f8fafc);
}

.cell-time {
  white-space: nowrap;
}

.time-primary {
  font-weight: 600;
  color: var(--smax-text, #1e293b);
}

.time-secondary {
  font-size: 11.5px;
  color: var(--smax-text-muted, #64748b);
  margin-top: 2px;
}

/* ── Actor Info ───────────────────────────────────────────────────────── */
.actor-user {
  display: flex;
  align-items: center;
  gap: 8px;
}

.actor-avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--smax-primary, #16a34a);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 12px;
  flex-shrink: 0;
}

.actor-meta {
  min-width: 0;
}

.actor-name {
  font-weight: 600;
  color: var(--smax-text, #1e293b);
  font-size: 12.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.actor-email {
  font-size: 11px;
  color: var(--smax-text-muted, #64748b);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.actor-system {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  color: var(--smax-text-muted, #64748b);
}

/* ── Action Tags ──────────────────────────────────────────────────────── */
.action-tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}

.tag-auth {
  background: #dbeafe;
  color: #1d4ed8;
  border: 1px solid rgba(37, 99, 235, 0.25);
}

.tag-admin {
  background: #f3e8ff;
  color: #7e22ce;
  border: 1px solid rgba(147, 51, 234, 0.25);
}

.tag-danger {
  background: var(--smax-error-soft, #fee2e2);
  color: var(--smax-error, #b91c1c);
  border: 1px solid rgba(239, 68, 68, 0.3);
}

.tag-bot {
  background: var(--smax-primary-soft, #dcfce7);
  color: var(--smax-primary, #15803d);
  border: 1px solid rgba(22, 163, 74, 0.3);
}

.tag-default {
  background: var(--smax-surface-muted, #f1f5f9);
  color: var(--smax-text-muted, #475569);
  border: 1px solid var(--smax-surface-border, #cbd5e1);
}

.tag-neutral {
  background: var(--smax-surface-muted, #f8fafc);
  color: var(--smax-text-muted, #64748b);
  border: 1px solid var(--smax-surface-border, #e2e8f0);
}

.action-category-sub {
  margin-top: 4px;
  font-size: 10.5px;
  color: var(--smax-text-muted, #94a3b8);
  white-space: nowrap;
}

/* ── Details Cell ─────────────────────────────────────────────────────── */
.details-summary {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.summary-text {
  color: var(--smax-text, #334155);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 320px;
}

.entity-id-text {
  color: var(--smax-text-muted, #64748b);
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11.5px;
}

.expand-btn {
  flex-shrink: 0;
  background: none;
  border: 1px solid var(--smax-surface-border, #cbd5e1);
  color: var(--smax-text-muted, #475569);
  padding: 2px 8px;
  border-radius: 5px;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s;
}

.expand-btn:hover {
  background: var(--smax-surface-muted, #f1f5f9);
  color: var(--smax-text, #0f172a);
}

.expand-row td.expand-cell {
  background: var(--smax-surface-muted, #f8fafc);
  padding: 14px 20px 16px 40px;
}

.diff-block {
  margin: 0 0 10px;
  background: var(--smax-surface, #ffffff);
  border: 1px solid var(--smax-surface-border, #e2e8f0);
  border-radius: 8px;
  padding: 12px 14px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11.5px;
  line-height: 1.55;
  color: var(--smax-text, #334155);
  overflow-x: auto;
  max-width: 720px;
}

.device-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11.5px;
  color: var(--smax-text-muted, #64748b);
}

.device-line {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 680px;
}

.ip-line {
  color: var(--smax-text-subtle, #94a3b8);
}

.text-muted { color: var(--smax-text-subtle, #94a3b8); }

/* ── States ───────────────────────────────────────────────────────────── */
.empty-state {
  padding: 60px 20px;
  text-align: center;
  color: var(--smax-text-muted, #475569);
}

.empty-icon {
  font-size: 48px;
  margin-bottom: 12px;
}

.empty-state h3 {
  font-size: 16px;
  font-weight: 600;
  color: var(--smax-text, #1e293b);
  margin-bottom: 6px;
}

.empty-state p {
  font-size: 13px;
  color: var(--smax-text-muted, #64748b);
  max-width: 450px;
  margin: 0 auto;
}

.spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--smax-surface-border, #e2e8f0);
  border-top-color: var(--smax-primary, #16a34a);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  margin: 0 auto 12px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.spin-icon {
  display: inline-block;
  animation: spin 1s linear infinite;
}

/* ── Footer ───────────────────────────────────────────────────────────── */
.table-footer {
  padding: 14px 20px;
  border-top: 1px solid var(--smax-surface-border, #e2e8f0);
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: var(--smax-surface-muted, #f8fafc);
}

.footer-info {
  font-size: 13px;
  color: var(--smax-text-muted, #64748b);
}

.end-of-list {
  font-size: 12px;
  color: var(--smax-text-subtle, #94a3b8);
}

/* ── Buttons ──────────────────────────────────────────────────────────── */
.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  border: none;
  transition: all 0.15s ease;
}

.btn-secondary {
  background: var(--smax-surface-muted, #f1f5f9);
  color: var(--smax-text, #334155);
  border: 1px solid var(--smax-surface-border, #cbd5e1);
}

.btn-secondary:hover:not(:disabled) {
  background: var(--smax-surface-border, #e2e8f0);
  color: var(--smax-text, #0f172a);
}

.btn-outline {
  background: transparent;
  border: 1px solid var(--smax-surface-border, #cbd5e1);
  color: var(--smax-text-muted, #475569);
}

.btn-outline:hover {
  background: var(--smax-surface-muted, #f8fafc);
  color: var(--smax-text, #0f172a);
}

.btn-sm {
  padding: 5px 12px;
  font-size: 12px;
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
