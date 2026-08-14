<template>
  <div class="security-events-view">
    <!-- Header -->
    <header class="page-header">
      <div class="header-left">
        <div class="title-row">
          <span class="shield-badge">🛡️</span>
          <h1>Sự kiện bảo mật</h1>
        </div>
        <p class="subtitle">
          Nhật ký giám sát truy cập trái phép, phát hiện rò rỉ dữ liệu và trạng thái kết nối tài khoản Zalo.
        </p>
      </div>
      <div class="header-actions">
        <button class="btn btn-secondary" :disabled="loading" @click="fetchEvents(true)">
          <span :class="{ 'spin-icon': loading }">⟳</span> Làm mới
        </button>
      </div>
    </header>

    <!-- Stat Highlights -->
    <section class="stat-cards">
      <div class="stat-card">
        <div class="stat-icon red">🚫</div>
        <div class="stat-info">
          <div class="stat-value">{{ scopeDeniedCount }}</div>
          <div class="stat-label">Truy cập ngoài phạm vi</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon orange">🔒</div>
        <div class="stat-info">
          <div class="stat-value">{{ privacyLockedCount }}</div>
          <div class="stat-label">Truy cập nick riêng tư</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon purple">⚠️</div>
        <div class="stat-info">
          <div class="stat-value">{{ regressionCount }}</div>
          <div class="stat-label">Rò rỉ dữ liệu phát hiện</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon blue">📡</div>
        <div class="stat-info">
          <div class="stat-value">{{ sessionIncidentCount }}</div>
          <div class="stat-label">Sự cố phiên Zalo</div>
        </div>
      </div>
    </section>

    <!-- Main Layout: Filters + Events List -->
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
              <input type="datetime-local" v-model="customFrom" @change="onFilterChange" />
            </div>
            <div class="date-field">
              <span>Đến:</span>
              <input type="datetime-local" v-model="customTo" @change="onFilterChange" />
            </div>
          </div>
        </div>

        <!-- Action Filter -->
        <div class="filter-section">
          <div class="section-header">
            <label class="section-title">🏷 Loại sự kiện</label>
            <div class="action-quick-toggle">
              <button class="link-btn" @click="selectAllActions">Tất cả</button>
              <span class="sep">|</span>
              <button class="link-btn" @click="clearAllActions">Bỏ chọn</button>
            </div>
          </div>
          <div class="action-checkbox-list">
            <label
              v-for="act in AVAILABLE_ACTIONS"
              :key="act.id"
              class="action-checkbox-row"
              :class="{ checked: selectedActions.has(act.id) }"
            >
              <input
                type="checkbox"
                :checked="selectedActions.has(act.id)"
                @change="toggleAction(act.id)"
              />
              <span class="act-icon">{{ act.icon }}</span>
              <span class="act-label">{{ act.label }}</span>
            </label>
          </div>
        </div>

        <!-- Search -->
        <div class="filter-section">
          <label class="section-title">🔍 Tìm kiếm</label>
          <div class="search-box">
            <input
              type="text"
              v-model="searchQuery"
              placeholder="Tên nick, lý do, người dùng..."
              @keyup.enter="onFilterChange"
            />
            <button v-if="searchQuery" class="clear-btn" @click="searchQuery = ''; onFilterChange()">×</button>
          </div>
        </div>

        <button class="btn btn-outline reset-all-btn" @click="resetFilters">
          ⟲ Đặt lại bộ lọc
        </button>
      </aside>

      <!-- Events List / Table -->
      <main class="events-main">
        <div class="table-card">
          <div class="table-header-bar">
            <div class="table-title">
              <span>Danh sách sự kiện</span>
              <span class="badge-count">{{ events.length }}</span>
            </div>
            <div v-if="loading && events.length" class="inline-loading">
              Đang tải thêm...
            </div>
          </div>

          <!-- Loading State -->
          <div v-if="loading && !events.length" class="empty-state">
            <div class="spinner"></div>
            <p>Đang tải dữ liệu sự kiện bảo mật...</p>
          </div>

          <!-- Empty State -->
          <div v-else-if="!events.length" class="empty-state">
            <div class="empty-icon">🛡️</div>
            <h3>Không có sự kiện bảo mật nào</h3>
            <p class="text-muted">
              Không tìm thấy nhật ký bảo mật nào khớp với bộ lọc hiện tại trong khoảng thời gian đã chọn.
            </p>
          </div>

          <!-- Table Container -->
          <div v-else class="table-wrapper">
            <table class="events-table">
              <thead>
                <tr>
                  <th style="width: 170px;">Thời gian</th>
                  <th style="width: 220px;">Loại sự kiện</th>
                  <th>Chi tiết sự kiện</th>
                  <th style="width: 200px;">Đối tượng / Nguồn</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="item in events" :key="item.id" class="event-row">
                  <!-- Thời gian -->
                  <td class="cell-time">
                    <div class="time-primary">{{ formatRelativeTime(item.createdAt) }}</div>
                    <div class="time-secondary">{{ formatDateTime(item.createdAt) }}</div>
                  </td>

                  <!-- Loại sự kiện -->
                  <td class="cell-action">
                    <div class="action-tag" :class="actionClass(item.action)">
                      <span class="tag-icon">{{ actionIcon(item.action) }}</span>
                      <span class="tag-text">{{ actionLabel(item.action) }}</span>
                    </div>
                  </td>

                  <!-- Chi tiết sự kiện -->
                  <td class="cell-details">
                    <div class="details-content">
                      <div v-if="item.action === 'security_scope_denied'" class="detail-line">
                        <span class="detail-highlight">Bị chặn truy cập:</span>
                        {{ item.details?.reason || item.details?.path || 'Truy cập tài nguyên ngoài phạm vi phân quyền' }}
                        <span v-if="item.details?.method" class="method-tag">{{ item.details.method }}</span>
                      </div>
                      <div v-else-if="item.action === 'privacy_locked_access'" class="detail-line">
                        <span class="detail-highlight">Cảnh báo:</span>
                        Truy cập nick riêng tư
                        <strong class="nick-tag">{{ item.details?.displayName || 'Nick riêng tư' }}</strong>
                        khi chưa mở khóa PIN.
                      </div>
                      <div v-else-if="item.action === 'security_scope_regression'" class="detail-line text-danger font-weight-bold">
                        <span>Lưới an toàn kích hoạt:</span>
                        {{ item.details?.reason || item.details?.error || 'Phát hiện hành vi rò rỉ dữ liệu' }}
                      </div>
                      <div v-else-if="item.action === 'zalo_session_down'" class="detail-line">
                        Tài khoản Zalo
                        <strong class="nick-tag">{{ item.details?.displayName || item.entityId || 'Zalo Account' }}</strong>
                        mất kết nối
                        <span v-if="item.details?.downMinutes" class="down-min-badge">
                          {{ item.details.downMinutes }} phút
                        </span>
                      </div>
                      <div v-else-if="item.action === 'zalo_session_recovered'" class="detail-line text-success">
                        Tài khoản Zalo
                        <strong class="nick-tag">{{ item.details?.displayName || item.entityId || 'Zalo Account' }}</strong>
                        đã kết nối lại thành công.
                      </div>
                      <div v-else class="detail-line">
                        {{ JSON.stringify(item.details) }}
                      </div>
                    </div>
                  </td>

                  <!-- Người thực hiện / Nguồn -->
                  <td class="cell-actor">
                    <div v-if="item.user" class="actor-user">
                      <div class="actor-avatar">{{ item.user.fullName?.charAt(0) || 'U' }}</div>
                      <div class="actor-meta">
                        <div class="actor-name">{{ item.user.fullName }}</div>
                        <div class="actor-email">{{ item.user.email }}</div>
                      </div>
                    </div>
                    <div v-else-if="item.actorType === 'bot'" class="actor-system">
                      <span class="actor-icon">🤖</span>
                      <span>{{ item.botName || 'Bot tự động' }}</span>
                    </div>
                    <div v-else class="actor-system">
                      <span class="actor-icon">⚙️</span>
                      <span>{{ item.systemSource || 'Hệ thống CRM' }}</span>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Pagination / Load more footer -->
          <div v-if="events.length" class="table-footer">
            <div class="footer-info">
              Đang hiển thị <strong>{{ events.length }}</strong> sự kiện
            </div>
            <div v-if="nextCursor" class="footer-actions">
              <button class="btn btn-secondary btn-sm" :disabled="loadingMore" @click="loadMore">
                {{ loadingMore ? 'Đang tải thêm...' : '↓ Tải thêm dữ liệu' }}
              </button>
            </div>
            <div v-else class="end-of-list">
              ─ Đã tải toàn bộ sự kiện ─
            </div>
          </div>
        </div>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { api } from '@/api/index';
import { useToast } from '@/composables/use-toast';
import { ACTION_META } from '@/constants/activity-types';

interface SecurityEventItem {
  id: string;
  orgId: string;
  userId?: string | null;
  actorType: string;
  botName?: string | null;
  systemSource?: string | null;
  category: string;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  details?: Record<string, any>;
  createdAt: string;
  user?: { id: string; fullName: string; email: string } | null;
}

const toast = useToast();

const loading = ref(false);
const loadingMore = ref(false);
const events = ref<SecurityEventItem[]>([]);
const nextCursor = ref<string | null>(null);

/* ── Filter Constants ─────────────────────────────────────────────────── */
const DATE_PRESETS = [
  { label: '24 giờ', value: '24h' },
  { label: '7 ngày', value: '7d' },
  { label: '30 ngày', value: '30d' },
  { label: 'Tất cả', value: 'all' },
  { label: 'Tùy chọn', value: 'custom' },
];

const AVAILABLE_ACTIONS = [
  { id: 'security_scope_denied', label: 'Truy cập ngoài phạm vi', icon: '🚫' },
  { id: 'privacy_locked_access', label: 'Truy cập nick riêng tư', icon: '🔒' },
  { id: 'security_scope_regression', label: 'Rò rỉ dữ liệu phát hiện', icon: '⚠️' },
  { id: 'zalo_session_down', label: 'Zalo mất kết nối', icon: '🔴' },
  { id: 'zalo_session_recovered', label: 'Zalo kết nối lại', icon: '🟢' },
];

/* ── Filter State ─────────────────────────────────────────────────────── */
const activePreset = ref('24h');
const customFrom = ref('');
const customTo = ref('');
const selectedActions = ref<Set<string>>(new Set(AVAILABLE_ACTIONS.map((a) => a.id)));
const searchQuery = ref('');

/* ── Metrics Breakdown ────────────────────────────────────────────────── */
const scopeDeniedCount = computed(
  () => events.value.filter((e) => e.action === 'security_scope_denied').length,
);
const privacyLockedCount = computed(
  () => events.value.filter((e) => e.action === 'privacy_locked_access').length,
);
const regressionCount = computed(
  () => events.value.filter((e) => e.action === 'security_scope_regression').length,
);
const sessionIncidentCount = computed(
  () => events.value.filter((e) => e.action === 'zalo_session_down' || e.action === 'zalo_session_recovered').length,
);

/* ── Filter Handlers ──────────────────────────────────────────────────── */
function applyPreset(preset: string) {
  activePreset.value = preset;
  if (preset !== 'custom') {
    fetchEvents(true);
  }
}

function selectAllActions() {
  selectedActions.value = new Set(AVAILABLE_ACTIONS.map((a) => a.id));
  fetchEvents(true);
}

function clearAllActions() {
  selectedActions.value = new Set();
  fetchEvents(true);
}

function toggleAction(actionId: string) {
  if (selectedActions.value.has(actionId)) {
    selectedActions.value.delete(actionId);
  } else {
    selectedActions.value.add(actionId);
  }
  selectedActions.value = new Set(selectedActions.value);
  fetchEvents(true);
}

function onFilterChange() {
  fetchEvents(true);
}

function resetFilters() {
  activePreset.value = '24h';
  customFrom.value = '';
  customTo.value = '';
  selectedActions.value = new Set(AVAILABLE_ACTIONS.map((a) => a.id));
  searchQuery.value = '';
  fetchEvents(true);
}

/* ── Query Builder ────────────────────────────────────────────────────── */
function buildQueryParams(cursor?: string) {
  const params: Record<string, string> = {
    limit: '50',
  };
  if (cursor) {
    params.cursor = cursor;
  }

  const now = new Date();
  if (activePreset.value === '24h') {
    params.from = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();
  } else if (activePreset.value === '7d') {
    params.from = new Date(now.getTime() - 7 * 24 * 3600 * 1000).toISOString();
  } else if (activePreset.value === '30d') {
    params.from = new Date(now.getTime() - 30 * 24 * 3600 * 1000).toISOString();
  } else if (activePreset.value === 'custom') {
    if (customFrom.value) params.from = new Date(customFrom.value).toISOString();
    if (customTo.value) params.to = new Date(customTo.value).toISOString();
  }

  if (selectedActions.value.size > 0 && selectedActions.value.size < AVAILABLE_ACTIONS.length) {
    params.actions = Array.from(selectedActions.value).join(',');
  } else if (selectedActions.value.size === 0) {
    params.actions = 'none';
  }

  if (searchQuery.value.trim()) {
    params.search = searchQuery.value.trim();
  }

  return params;
}

/* ── Data Fetching ────────────────────────────────────────────────────── */
async function fetchEvents(reset = false) {
  if (reset) {
    loading.value = true;
    nextCursor.value = null;
  }

  try {
    const params = buildQueryParams();
    const res = await api.get('/security-events', { params });
    events.value = res.data.events || [];
    nextCursor.value = res.data.nextCursor || null;
  } catch (err: any) {
    if (err.response?.status === 403) {
      toast.error('Bạn không có quyền xem sự kiện bảo mật.');
    } else {
      toast.error('Không thể tải danh sách sự kiện bảo mật.');
    }
  } finally {
    loading.value = false;
  }
}

async function loadMore() {
  if (!nextCursor.value || loadingMore.value) return;
  loadingMore.value = true;

  try {
    const params = buildQueryParams(nextCursor.value);
    const res = await api.get('/security-events', { params });
    const newItems: SecurityEventItem[] = res.data.events || [];
    events.value = [...events.value, ...newItems];
    nextCursor.value = res.data.nextCursor || null;
  } catch {
    toast.error('Lỗi khi tải thêm dữ liệu');
  } finally {
    loadingMore.value = false;
  }
}

/* ── Formatters ───────────────────────────────────────────────────────── */
function formatDateTime(iso: string) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function formatRelativeTime(iso: string) {
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
  return formatDateTime(iso).split(' ')[1];
}

function actionLabel(action: string): string {
  return ACTION_META[action]?.label || action;
}

function actionIcon(action: string): string {
  return ACTION_META[action]?.icon || '🛡️';
}

function actionClass(action: string): string {
  switch (action) {
    case 'security_scope_denied':
      return 'tag-danger';
    case 'privacy_locked_access':
      return 'tag-warning';
    case 'security_scope_regression':
      return 'tag-regression';
    case 'zalo_session_down':
      return 'tag-session-down';
    case 'zalo_session_recovered':
      return 'tag-success';
    default:
      return 'tag-default';
  }
}

onMounted(() => {
  fetchEvents(true);
});
</script>

<style scoped>
.security-events-view {
  padding: 24px;
  max-width: 1400px;
  margin: 0 auto;
  min-height: calc(100vh - 60px);
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

.shield-badge {
  font-size: 26px;
  line-height: 1;
}

.page-header h1 {
  font-size: 24px;
  font-weight: 700;
  color: #0f172a;
  margin: 0;
}

.subtitle {
  color: #64748b;
  font-size: 14px;
  margin-top: 4px;
  margin-bottom: 0;
}

.header-actions {
  display: flex;
  gap: 10px;
}

/* ── Stat Highlights ──────────────────────────────────────────────────── */
.stat-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 16px;
  margin-bottom: 24px;
}

.stat-card {
  background: #ffffff;
  border-radius: 12px;
  padding: 16px 20px;
  border: 1px solid #e2e8f0;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
  display: flex;
  align-items: center;
  gap: 16px;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.stat-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
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

.stat-icon.red { background: #fee2e2; color: #dc2626; }
.stat-icon.orange { background: #ffedd5; color: #ea580c; }
.stat-icon.purple { background: #f3e8ff; color: #9333ea; }
.stat-icon.blue { background: #e0f2fe; color: #0284c7; }

.stat-value {
  font-size: 22px;
  font-weight: 700;
  color: #0f172a;
  line-height: 1.2;
}

.stat-label {
  font-size: 13px;
  color: #64748b;
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
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 18px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
}

.filter-section {
  margin-bottom: 22px;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.section-title {
  font-size: 13px;
  font-weight: 600;
  color: #475569;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  display: block;
  margin-bottom: 10px;
}

.action-quick-toggle {
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 4px;
}

.link-btn {
  background: none;
  border: none;
  color: #2563eb;
  cursor: pointer;
  padding: 0;
  font-size: 12px;
}
.link-btn:hover { text-decoration: underline; }
.sep { color: #cbd5e1; }

.preset-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.preset-chip {
  padding: 6px 12px;
  font-size: 12.5px;
  border-radius: 20px;
  border: 1px solid #e2e8f0;
  background: #f8fafc;
  color: #475569;
  cursor: pointer;
  transition: all 0.15s ease;
}

.preset-chip:hover {
  background: #f1f5f9;
  border-color: #cbd5e1;
}

.preset-chip.active {
  background: #2563eb;
  color: #ffffff;
  border-color: #2563eb;
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
  color: #64748b;
  gap: 4px;
}

.date-field input {
  padding: 6px 8px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  font-size: 12px;
}

.action-checkbox-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.action-checkbox-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #334155;
  cursor: pointer;
  padding: 6px 8px;
  border-radius: 6px;
  transition: background 0.15s;
}

.action-checkbox-row:hover {
  background: #f1f5f9;
}

.action-checkbox-row input {
  cursor: pointer;
}

.search-box {
  position: relative;
  display: flex;
  align-items: center;
}

.search-box input {
  width: 100%;
  padding: 8px 30px 8px 10px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  font-size: 13px;
  transition: border-color 0.2s;
}

.search-box input:focus {
  outline: none;
  border-color: #2563eb;
  box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.1);
}

.clear-btn {
  position: absolute;
  right: 8px;
  background: none;
  border: none;
  color: #94a3b8;
  cursor: pointer;
  font-size: 16px;
}

.reset-all-btn {
  width: 100%;
  padding: 8px;
  font-size: 13px;
  margin-top: 10px;
}

/* ── Events Table Main ────────────────────────────────────────────────── */
.events-main {
  min-width: 0;
}

.table-card {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
  overflow: hidden;
}

.table-header-bar {
  padding: 16px 20px;
  border-bottom: 1px solid #e2e8f0;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.table-title {
  font-size: 15px;
  font-weight: 600;
  color: #0f172a;
  display: flex;
  align-items: center;
  gap: 8px;
}

.badge-count {
  background: #f1f5f9;
  color: #475569;
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 600;
}

.table-wrapper {
  overflow-x: auto;
}

.events-table {
  width: 100%;
  border-collapse: collapse;
  text-align: left;
  font-size: 13px;
}

.events-table th {
  background: #f8fafc;
  color: #475569;
  font-weight: 600;
  padding: 12px 16px;
  border-bottom: 1px solid #e2e8f0;
}

.events-table td {
  padding: 14px 16px;
  border-bottom: 1px solid #f1f5f9;
  vertical-align: middle;
}

.event-row:hover {
  background: #f8fafc;
}

.cell-time {
  white-space: nowrap;
}

.time-primary {
  font-weight: 600;
  color: #1e293b;
}

.time-secondary {
  font-size: 11.5px;
  color: #64748b;
  margin-top: 2px;
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

.tag-danger { background: #fee2e2; color: #b91c1c; border: 1px solid #fca5a5; }
.tag-warning { background: #fef3c7; color: #b45309; border: 1px solid #fcd34d; }
.tag-regression { background: #f3e8ff; color: #7e22ce; border: 1px solid #d8b4fe; }
.tag-session-down { background: #ffe4e6; color: #be123c; border: 1px solid #fda4af; }
.tag-success { background: #dcfce7; color: #15803d; border: 1px solid #86efac; }
.tag-default { background: #f1f5f9; color: #475569; border: 1px solid #cbd5e1; }

.details-content {
  color: #334155;
  font-size: 13px;
  line-height: 1.5;
}

.detail-highlight {
  font-weight: 600;
  color: #1e293b;
  margin-right: 4px;
}

.nick-tag {
  background: #f1f5f9;
  padding: 2px 6px;
  border-radius: 4px;
  font-weight: 600;
  color: #0f172a;
}

.down-min-badge {
  background: #fee2e2;
  color: #b91c1c;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 700;
  margin-left: 4px;
}

.method-tag {
  background: #e2e8f0;
  color: #334155;
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 11px;
  font-weight: 700;
  margin-left: 6px;
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
  background: #2563eb;
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
  color: #1e293b;
  font-size: 12.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.actor-email {
  font-size: 11px;
  color: #64748b;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.actor-system {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  color: #64748b;
}

/* ── States ───────────────────────────────────────────────────────────── */
.empty-state {
  padding: 60px 20px;
  text-align: center;
  color: #475569;
}

.empty-icon {
  font-size: 48px;
  margin-bottom: 12px;
}

.empty-state h3 {
  font-size: 16px;
  font-weight: 600;
  color: #1e293b;
  margin-bottom: 6px;
}

.empty-state p {
  font-size: 13px;
  color: #64748b;
  max-width: 450px;
  margin: 0 auto;
}

.spinner {
  width: 32px;
  height: 32px;
  border: 3px solid #e2e8f0;
  border-top-color: #2563eb;
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
  border-top: 1px solid #e2e8f0;
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: #f8fafc;
}

.footer-info {
  font-size: 13px;
  color: #64748b;
}

.end-of-list {
  font-size: 12px;
  color: #94a3b8;
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
  background: #f1f5f9;
  color: #334155;
  border: 1px solid #cbd5e1;
}

.btn-secondary:hover:not(:disabled) {
  background: #e2e8f0;
  color: #0f172a;
}

.btn-outline {
  background: transparent;
  border: 1px solid #cbd5e1;
  color: #475569;
}

.btn-outline:hover {
  background: #f8fafc;
  color: #0f172a;
}

.btn-sm {
  padding: 5px 12px;
  font-size: 12px;
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.text-danger { color: #dc2626 !important; }
.text-success { color: #16a34a !important; }
</style>
