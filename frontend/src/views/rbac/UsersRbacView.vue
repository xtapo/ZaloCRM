<template>
  <div class="dept-page">
    <header class="page-hero">
      <div class="hero-left">
        <h1 class="hero-title">Nhân viên</h1>
        <p class="hero-sub">Quản lý người dùng tổ chức · Phân phòng ban · Gán nhóm quyền · Vô hiệu hóa khi nghỉ việc</p>
      </div>
    </header>

    <section class="stats-row" v-if="!loading && stats.total > 0">
      <div class="stat-card stat-primary">
        <div class="stat-label">Tổng nhân viên</div>
        <div class="stat-value">{{ stats.total }}</div>
      </div>
      <div class="stat-card stat-forest">
        <div class="stat-label">Đang hoạt động</div>
        <div class="stat-value">{{ stats.active }}<span class="stat-unit"> / {{ stats.total }}</span></div>
      </div>
      <div class="stat-card stat-mustard">
        <div class="stat-label">Đã gán phòng ban</div>
        <div class="stat-value">{{ stats.withDept }}<span class="stat-unit"> / {{ stats.total }}</span></div>
      </div>
      <div class="stat-card stat-cream">
        <div class="stat-label">Đã gán nhóm quyền</div>
        <div class="stat-value">{{ stats.withGroup }}<span class="stat-unit"> / {{ stats.total }}</span></div>
      </div>
    </section>

    <!-- Filter bar -->
    <div class="at-toolbar" v-if="!loading && store.users.length > 0">
      <div class="search-box at-search">
        <span class="search-icon">🔍</span>
        <input v-model="searchQ" placeholder="Tìm tên / email..." @input="applyFilter" />
        <button v-if="searchQ" class="search-clear" @click="searchQ = ''; applyFilter()">×</button>
      </div>
      <select class="filter-select" v-model="filterDept" @change="applyFilter">
        <option value="">🏢 Mọi phòng ban</option>
        <option v-for="d in flatDepts" :key="d.id" :value="d.id">
          {{ '— '.repeat(d._depth) }}{{ d.name }}
        </option>
      </select>
      <select class="filter-select" v-model="filterGroup" @change="applyFilter">
        <option value="">🛡 Mọi nhóm quyền</option>
        <option v-for="g in flatGroups" :key="g.id" :value="g.id">
          {{ '— '.repeat(g._depth) }}{{ g.name }}
        </option>
      </select>
      <select class="filter-select" v-model="filterActive" @change="applyFilter">
        <option value="all">Mọi trạng thái</option>
        <option value="active">🟢 Đang hoạt động</option>
        <option value="inactive">⚪ Đã vô hiệu</option>
      </select>
      <div class="at-toolbar-spacer"></div>
      <span class="at-count">{{ filteredUsers.length }} / {{ stats.total }} nhân viên</span>
      <button v-if="authStore.isAdmin" class="at-btn at-btn-primary" style="margin-left: 12px; padding: 6px 16px; background: #1b61c9; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 500;" @click="showCreate = true">
        + Thêm nhân viên
      </button>
    </div>

    <div v-if="loading" class="loading-state">
      <div class="skel-card" v-for="i in 4" :key="i" style="height: 44px"></div>
    </div>

    <div v-else-if="filteredUsers.length === 0 && store.users.length === 0" class="empty-state">
      <div class="empty-icon">👥</div>
      <h3>Chưa có nhân viên nào</h3>
      <p>Bấm nút <b>+ Thêm nhân viên</b> ở góc trên hoặc dùng admin endpoint.</p>
    </div>

    <div v-else-if="filteredUsers.length === 0" class="empty-state">
      <div class="empty-icon">🔍</div>
      <h3>Không tìm thấy nhân viên phù hợp</h3>
      <p>Thử bỏ bớt bộ lọc hoặc đổi từ khóa tìm kiếm.</p>
    </div>

    <!-- AIRTABLE-STYLE TABLE -->
    <section v-else class="at-table-wrap">
      <table class="at-table">
        <thead>
          <tr>
            <th class="th-num">#</th>
            <th class="th-name">Nhân viên</th>
            <th class="th-email">Email</th>
            <th class="th-dept">Phòng ban</th>
            <th class="th-role">Chức vụ</th>
            <th class="th-group">Nhóm quyền</th>
            <th class="th-internal">🏠 Liên lạc nội bộ</th>
            <th class="th-status">Trạng thái</th>
            <th class="th-actions"></th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(u, i) in filteredUsers"
            :key="u.id"
            :class="{ 'row-active': selectedUser?.id === u.id, 'row-inactive': !u.isActive }"
            @click="openPanel(u)"
          >
            <td class="cell-num">{{ i + 1 }}</td>
            <td class="cell-name">
              <span class="at-avatar" :style="{ background: avatarColor(u.fullName || u.email) }">
                {{ initials(u.fullName || u.email) }}
              </span>
              <div class="cell-name-text">
                <div class="cell-name-main">{{ u.fullName || '(chưa đặt tên)' }}</div>
                <div v-if="u.role === 'owner'" class="cell-name-sub owner-tag">👑 Chủ tổ chức</div>
              </div>
            </td>
            <td class="cell-email">{{ u.email }}</td>
            <td class="cell-dept">
              <span v-if="u.departmentMember" class="at-chip chip-dept">
                🏢 {{ u.departmentMember.department.name }}
              </span>
              <span v-else class="at-empty">—</span>
            </td>
            <td class="cell-role">
              <template v-if="u.departmentMember">
                <span v-if="u.departmentMember.deptRole === 'leader'" class="at-chip chip-leader">
                  👑 Trưởng phòng
                </span>
                <span v-else-if="u.departmentMember.deptRole === 'deputy'" class="at-chip chip-deputy">
                  🎖️ Phó phòng
                </span>
                <span v-else class="at-chip chip-member">👤 Nhân viên</span>
              </template>
              <span v-else class="at-empty">—</span>
            </td>
            <td class="cell-group">
              <template v-if="u.permissionGroup">
                <span class="at-chip" :class="u.permissionGroup.isSystem ? 'chip-system' : 'chip-custom'">
                  🛡 {{ u.permissionGroup.name }}
                </span>
              </template>
              <span v-else class="at-empty">—</span>
            </td>
            <td class="cell-internal">
              <!-- Phase Privacy v2 2026-05-23 — Nick liên lạc nội bộ -->
              <RouterLink
                v-if="(u as any).internalContactNick"
                :to="'/settings/channels/zalo?tab=privacy'"
                class="at-chip chip-internal"
                @click.stop
                :title="`Nick: ${(u as any).internalContactNick.displayName || '(chưa đặt tên)'}`"
              >
                🏠 {{ (u as any).internalContactNick.displayName || '(chưa đặt tên)' }}
              </RouterLink>
              <span v-else class="at-empty" :title="`Max ${(u as any).maxPrivacyNicks ?? 2} nick riêng tư`">—</span>
            </td>
            <td class="cell-status">
              <span v-if="u.isActive" class="at-chip chip-active">🟢 Hoạt động</span>
              <span v-else class="at-chip chip-inactive">⚪ Vô hiệu</span>
            </td>
            <td class="cell-actions">
              <button class="at-btn-icon" title="Mở chi tiết" @click.stop="openPanel(u)">✎</button>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <!-- Side panel -->
    <UserEditPanel
      :open="panelOpen"
      :user="selectedUser"
      :current-user-id="currentUserId"
      :current-user-role="currentUserRole"
      @close="closePanel"
      @changed="onChanged"
    />

    <!-- Create dialog -->
    <v-dialog v-model="showCreate" max-width="440">
      <v-card>
        <v-card-title>Thêm nhân viên</v-card-title>
        <v-card-text>
          <v-text-field v-model="form.fullName" label="Họ tên *" class="mb-2" />
          <v-text-field v-model="form.email" label="Email *" type="email" class="mb-2" />
          <v-text-field v-model="form.password" label="Mật khẩu *" type="password" class="mb-2" />
          <v-select v-model="form.role" :items="roleOptions" item-title="label" item-value="value" label="Vai trò" />
          <v-alert v-if="dialogError" type="error" density="compact" class="mt-2">{{ dialogError }}</v-alert>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="showCreate = false">Hủy</v-btn>
          <v-btn color="primary" :loading="saving" @click="handleCreate">Tạo</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { RouterLink } from 'vue-router';
import {
  useRbacStore,
  type RbacUser,
  type DepartmentNode,
  type PermissionGroupNode,
} from '@/stores/rbac';
import { useAuthStore } from '@/stores/auth';
import UserEditPanel from '@/components/rbac/UserEditPanel.vue';

const store = useRbacStore();
const authStore = useAuthStore();

const searchQ = ref('');
const filterDept = ref('');
const filterGroup = ref('');
const filterActive = ref<'all' | 'active' | 'inactive'>('all');

const panelOpen = ref(false);
const selectedUser = ref<RbacUser | null>(null);

const showCreate = ref(false);
const saving = ref(false);
const dialogError = ref('');
const form = ref({
  fullName: '',
  email: '',
  password: '',
  role: 'member'
});

const roleOptions = [
  { label: 'Nhân viên', value: 'member' },
  { label: 'Quản trị viên', value: 'admin' },
];
if (authStore.isOwner) {
  roleOptions.push({ label: 'Chủ tổ chức', value: 'owner' });
}

const currentUserId = computed(() => authStore.user?.id ?? '');
const currentUserRole = computed(() => authStore.user?.role ?? 'member');

onMounted(async () => {
  await Promise.all([
    store.loadUsers(),
    store.loadDepartments(),
    store.loadPermissionGroups(),
  ]);
});

const flatDepts = computed(() => {
  const out: Array<DepartmentNode & { _depth: number }> = [];
  function walk(nodes: DepartmentNode[], depth: number) {
    for (const n of nodes) {
      out.push({ ...n, _depth: depth });
      if (n.children?.length) walk(n.children, depth + 1);
    }
  }
  walk(store.departments, 0);
  return out;
});
const flatGroups = computed(() => {
  const out: Array<PermissionGroupNode & { _depth: number }> = [];
  function walk(nodes: PermissionGroupNode[], depth: number) {
    for (const n of nodes) {
      out.push({ ...n, _depth: depth });
      if (n.children?.length) walk(n.children, depth + 1);
    }
  }
  walk(store.permissionGroups, 0);
  return out;
});

const filteredUsers = computed(() => {
  return store.users.filter((u) => {
    if (filterActive.value === 'active' && !u.isActive) return false;
    if (filterActive.value === 'inactive' && u.isActive) return false;
    return true;
  });
});

const stats = computed(() => {
  let total = store.users.length;
  let active = 0, withDept = 0, withGroup = 0;
  for (const u of store.users) {
    if (u.isActive) active++;
    if (u.departmentMember) withDept++;
    if (u.permissionGroupId) withGroup++;
  }
  return { total, active, withDept, withGroup };
});

const loading = computed(() => store.loading);

let debounceTimer: any;
function applyFilter() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    store.loadUsers({
      q: searchQ.value || undefined,
      departmentId: filterDept.value || undefined,
      permissionGroupId: filterGroup.value || undefined,
    });
  }, 300);
}

function openPanel(u: RbacUser) {
  selectedUser.value = u;
  panelOpen.value = true;
}
function closePanel() {
  panelOpen.value = false;
  selectedUser.value = null;
}
async function onChanged() {
  await store.loadUsers({
    q: searchQ.value || undefined,
    departmentId: filterDept.value || undefined,
    permissionGroupId: filterGroup.value || undefined,
  });
  if (selectedUser.value) {
    const updated = store.users.find((u) => u.id === selectedUser.value!.id);
    if (updated) selectedUser.value = updated;
  }
}

import { api } from '@/api/index';
async function handleCreate() {
  if (!form.value.fullName || !form.value.email || !form.value.password) {
    dialogError.value = 'Vui lòng nhập đủ họ tên, email và mật khẩu';
    return;
  }
  saving.value = true;
  dialogError.value = '';
  try {
    await api.post('/users', form.value);
    showCreate.value = false;
    form.value = { fullName: '', email: '', password: '', role: 'member' };
    await store.loadUsers();
  } catch (err: any) {
    dialogError.value = err.response?.data?.message || 'Lỗi khi tạo nhân viên';
  } finally {
    saving.value = false;
  }
}

function initials(name: string): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
function avatarColor(name: string): string {
  const colors = ['#aa2d00', '#0a2e0e', '#d9a441', '#1b61c9', '#7a2000', '#1a3866'];
  const h = (name || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return colors[h % colors.length];
}
</script>

<style scoped>
/* UsersRbacView — Airtable-style table */

.at-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}
.at-search {
  min-width: 260px;
  max-width: 340px;
  flex: 1;
}
.at-toolbar-spacer { flex: 1; }
.at-count {
  font-size: 12px;
  color: var(--smax-text-muted, #41454d);
  background: var(--smax-surface-muted, #f0f1f3);
  padding: 6px 12px;
  border-radius: 9999px;
  font-weight: 500;
  white-space: nowrap;
}

/* Airtable table */
.at-table-wrap {
  background: var(--smax-surface, white);
  border: 1px solid var(--smax-surface-border, #e0e2e6);
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
}
.at-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  table-layout: auto;
}

/* Header — sticky, Airtable gray */
.at-table thead th {
  position: sticky;
  top: 0;
  background: var(--smax-surface-muted, #f8fafc);
  padding: 12px 14px;
  text-align: left;
  font-weight: 600;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  color: var(--smax-text-muted, #41454d);
  border-bottom: 2px solid var(--smax-surface-border, #e0e2e6);
  white-space: nowrap;
}
.th-num { width: 46px; text-align: center !important; }
.th-name { min-width: 200px; }
.th-email { min-width: 180px; }
.th-dept { min-width: 140px; }
.th-role { width: 140px; }
.th-group { min-width: 130px; }
.th-status { width: 130px; }
.th-actions { width: 48px; }

/* Rows */
.at-table tbody tr {
  cursor: pointer;
  transition: background 0.1s;
  border-bottom: 1px solid var(--smax-surface-border, #f0f1f3);
}
.at-table tbody tr:hover { background: var(--smax-surface-muted, #f8fafc); }
.at-table tbody tr.row-active { background: var(--smax-primary-soft, #eaf7ef); }
.at-table tbody tr.row-active:hover { background: var(--smax-primary-soft, #d8ecda); }
.at-table tbody tr.row-inactive .cell-name-main,
.at-table tbody tr.row-inactive .cell-email {
  color: var(--smax-text-subtle, #9297a0);
  text-decoration: line-through;
  text-decoration-color: var(--smax-surface-border, #c9ccd1);
}
.at-table tbody tr:last-child { border-bottom: 0; }
.at-table tbody td {
  padding: 12px 14px;
  vertical-align: middle;
}

/* Cells */
.cell-num {
  text-align: center;
  color: var(--smax-text-subtle, #9297a0);
  font-size: 11px;
  font-weight: 500;
}
.cell-name {
  display: flex;
  align-items: center;
  gap: 10px;
}
.at-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  color: white;
  font-size: 11px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.cell-name-text { min-width: 0; }
.cell-name-main {
  font-size: 13px;
  font-weight: 500;
  color: var(--smax-text, #181d26);
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cell-name-sub {
  font-size: 10px;
  font-weight: 600;
  margin-top: 2px;
  text-transform: uppercase;
  letter-spacing: 0.4px;
}
.owner-tag { color: var(--smax-warning, #7a5818); }
.admin-tag { color: var(--smax-primary-hover, #0a2e0e); }

.cell-email {
  font-family: 'JetBrains Mono', 'SF Mono', Menlo, monospace;
  font-size: 12px;
  color: var(--smax-text-muted, #41454d);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 260px;
}

/* Airtable chips */
.at-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: 9999px;
  font-size: 11px;
  font-weight: 500;
  white-space: nowrap;
  line-height: 1.2;
}
.chip-dept { background: var(--smax-primary-soft, #e3ede4); color: var(--smax-primary-hover, #0a2e0e); }
.chip-leader { background: var(--smax-warning-soft, #fdf3df); color: var(--smax-warning, #7a5818); }
.chip-deputy { background: var(--smax-error-soft, #f5e9d4); color: var(--smax-error, #aa2d00); }
.chip-member { background: var(--smax-surface-muted, #f0f1f3); color: var(--smax-text-muted, #41454d); }
.chip-system { background: var(--smax-warning-soft, #fdf3df); color: var(--smax-warning, #7a5818); }
.chip-custom { background: var(--smax-primary-soft, #e0e9f5); color: var(--smax-primary, #1b61c9); }
/* Phase Privacy v2 2026-05-23 — Nick liên lạc nội bộ chip */
.chip-internal {
  background: var(--smax-warning-soft, #FEF3C7); color: var(--smax-warning, #92400E);
  text-decoration: none; cursor: pointer;
}
.chip-internal:hover { opacity: 0.9; }
.chip-active { background: var(--smax-primary-soft, #d8ecda); color: var(--smax-primary-hover, #0a2e0e); }
.chip-inactive { background: var(--smax-surface-muted, #f0f1f3); color: var(--smax-text-subtle, #9297a0); }

.at-empty {
  color: var(--smax-text-subtle, #c9ccd1);
  font-size: 12px;
}

.cell-actions { text-align: right; }
.at-btn-icon {
  background: var(--smax-surface, white);
  border: 1px solid var(--smax-surface-border, #dddddd);
  width: 28px;
  height: 28px;
  border-radius: 6px;
  cursor: pointer;
  color: var(--smax-text-muted, #41454d);
  font-size: 12px;
  transition: all 0.1s;
}
.at-btn-icon:hover {
  background: var(--smax-primary, #181d26);
  color: white;
  border-color: var(--smax-primary, #181d26);
}
</style>
