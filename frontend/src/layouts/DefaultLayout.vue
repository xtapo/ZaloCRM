<template>
  <v-app class="smax-app">
    <!-- ════════ TOP NAV (Smax-style dark, h=52px) ════════ -->
    <header class="smax-topnav">
      <!-- Logo + Workspace selector -->
      <RouterLink to="/" class="logo" title="ZaloCRM">
        <img src="/brand/zalocrm-logo.png" alt="ZaloCRM" />
      </RouterLink>

      <v-menu open-on-hover>
        <template #activator="{ props: act }">
          <button class="workspace" v-bind="act">
            <span class="ws-logo">{{ workspaceShort }}</span>
            <span>{{ workspaceName }}</span>
            <span class="opacity-50">▾</span>
          </button>
        </template>
        <v-list density="compact" min-width="220">
          <v-list-item v-for="ws in workspaces" :key="ws.id" :title="ws.name" />
          <v-divider />
          <v-list-item title="Quản lý workspace" prepend-icon="mdi-cog" />
        </v-list>
      </v-menu>

      <!-- Primary nav tabs (Excel structure) -->
      <nav class="nav-tabs">
        <RouterLink
          v-for="tab in primaryTabs"
          :key="tab.path"
          :to="tab.path"
          class="nav-tab"
          :class="{ active: isActive(tab) }"
        >
          <span class="ic">{{ tab.icon }}</span>{{ tab.label }}
        </RouterLink>

        <!-- Legacy automation dropdown (kept for backward compat — Phase 7 Bot-Auto
             is now a top-level primary tab via primaryTabs array above) -->
        <v-menu open-on-hover>
          <template #activator="{ props: act }">
            <button
              class="nav-tab"
              :class="{ active: isLegacyAutomationActive }"
              v-bind="act"
            >
              <span class="ic">⚡</span>Automation<span class="caret">▾</span>
            </button>
          </template>
          <v-list density="compact" min-width="220">
            <v-list-item to="/automation" title="Rules &amp; Templates (legacy)" prepend-icon="mdi-chart-box-outline" />
          </v-list>
        </v-menu>

        <v-menu open-on-hover>
          <template #activator="{ props: act }">
            <button class="nav-tab" :class="{ active: isSettingsActive }" v-bind="act">
              <span class="ic">⚙</span>Cài đặt<span class="caret">▾</span>
            </button>
          </template>
          <v-list density="compact" min-width="240">
            <v-list-item to="/settings/personal/profile" title="Hồ sơ của tôi" prepend-icon="mdi-account-circle-outline" />
            <v-divider />
            <v-list-subheader>Tổ chức &amp; Nhân sự</v-list-subheader>
            <v-list-item to="/settings/team/users" title="Nhân viên" prepend-icon="mdi-account-cog-outline" />
            <v-list-item to="/settings/team/teams" title="Đội nhóm" prepend-icon="mdi-account-group-outline" />
            <v-list-item to="/settings/team/roles" title="Vai trò &amp; Phân quyền" prepend-icon="mdi-shield-account-outline" />
            <v-divider />
            <v-list-subheader>CRM &amp; Kênh</v-list-subheader>
            <v-list-item to="/settings/crm/tags" title="Tag CRM" prepend-icon="mdi-tag-multiple-outline" />
            <v-list-item to="/settings/crm/scoring" title="Lead scoring" prepend-icon="mdi-chart-line" />
            <v-list-item to="/settings/channels/zalo" title="Tài khoản Zalo" prepend-icon="mdi-cellphone-link" />
            <v-list-item to="/settings/channels/integrations" title="Tích hợp" prepend-icon="mdi-connection" />
            <v-divider />
            <v-list-item to="/settings/dev/api" title="API &amp; Webhook" prepend-icon="mdi-api" />
            <v-divider />
            <v-list-item to="/settings" title="📋 Xem tất cả cài đặt" prepend-icon="mdi-cog-outline" />
          </v-list>
        </v-menu>
      </nav>

      <!-- Flexible spacer pushes everything after it to the right edge. -->
      <div class="topnav-spacer" />

      <!--
        ATTRIBUTION BANNER — moved into DashboardView per copyright holder
        (locnt@locnguyendata.com). Rendering still required by Apache 2.0 §4(d);
        see src/views/DashboardView.vue and src/composables/use-attribution.ts.
      -->

      <!-- Global search trigger -->
      <GlobalSearch class="topnav-search" />

      <!-- Right icon buttons -->
      <RouterLink to="/groups" class="icon-btn" title="Nhóm">
        <v-icon size="18">mdi-account-group-outline</v-icon>
      </RouterLink>

      <NotificationBell class="icon-btn-wrap" />

      <v-menu>
        <template #activator="{ props: act }">
          <button class="user-avatar" v-bind="act" :title="authStore.user?.fullName || 'Tài khoản'">
            {{ initials }}
          </button>
        </template>
        <v-list density="compact" min-width="200">
          <v-list-item :title="authStore.user?.fullName || ''" :subtitle="authStore.user?.email || ''" />
          <v-divider />
          <v-list-item to="/profile" title="Hồ sơ" prepend-icon="mdi-account-circle-outline" />
          <v-list-item @click="toggleTheme" :title="isDark ? 'Theme sáng' : 'Theme tối (legacy)'" :prepend-icon="isDark ? 'mdi-weather-sunny' : 'mdi-weather-night'" />
          <v-divider />
          <v-list-item @click="logout" title="Đăng xuất" prepend-icon="mdi-logout" />
        </v-list>
      </v-menu>
    </header>

    <!-- ════════ MAIN ════════ -->
    <v-main class="smax-main">
      <slot />
    </v-main>

    <!-- Global toast queue -->
    <ToastContainer />
  </v-app>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useTheme } from 'vuetify';
import { useRoute, RouterLink } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useRouter } from 'vue-router';
import NotificationBell from '@/components/NotificationBell.vue';
import GlobalSearch from '@/components/GlobalSearch.vue';
import ToastContainer from '@/components/ui/ToastContainer.vue';
const theme = useTheme();
const route = useRoute();
const authStore = useAuthStore();
const router = useRouter();

const isDark = ref((localStorage.getItem('theme') || 'smax-light') === 'legacy-dark');

onMounted(() => {
  const saved = localStorage.getItem('theme') || 'smax-light';
  theme.global.name.value = saved;
  isDark.value = saved === 'legacy-dark';
});

interface NavTab {
  path: string;
  label: string;
  icon: string;
  matchPrefix?: string;
}

// Excel-driven menu (cấp 1) — Automation/Cài đặt được render riêng với dropdown.
// Bot-Auto (Phase 7) là tab top-level riêng (giống smax.ai), tách hẳn khỏi
// legacy Automation dropdown để user không bị nhầm 2 hệ thống.
const primaryTabs: NavTab[] = [
  { path: '/',                       label: 'Dashboard',   icon: '🏠', matchPrefix: '/$' },
  { path: '/chat',                   label: 'Tin nhắn',    icon: '💬' },
  { path: '/friends',                label: 'Bạn bè',      icon: '👥' },
  { path: '/contacts',               label: 'Khách hàng',  icon: '🧑' },
  { path: '/leads/stuck',            label: 'KH đình trệ', icon: '🚨' },
  { path: '/appointments',           label: 'Lịch hẹn',    icon: '📅' },
  { path: '/automation/bot/triggers', label: 'Bot-Auto',   icon: '🤖', matchPrefix: '/automation/bot' },
  { path: '/analytics',              label: 'Phân tích',   icon: '📈' },
  { path: '/reports',                label: 'Báo cáo',     icon: '📊' },
];

function isActive(tab: NavTab): boolean {
  if (tab.matchPrefix === '/$') return route.path === '/';
  if (tab.matchPrefix) {
    return route.path === tab.matchPrefix || route.path.startsWith(tab.matchPrefix + '/');
  }
  return route.path === tab.path || route.path.startsWith(tab.path + '/');
}
const isSettingsActive = computed(() =>
  route.path === '/settings' || route.path.startsWith('/settings/'),
);
// Highlight legacy Automation dropdown ONLY when on /automation (exact) — do NOT
// activate when on /automation/bot/* (that's the top-level Bot-Auto tab).
const isLegacyAutomationActive = computed(
  () => route.path === '/automation' || (route.path.startsWith('/automation') && !route.path.startsWith('/automation/bot')),
);

// Workspace — placeholder single-tenant cho Phase 1
const workspaceName = computed(() => authStore.user?.fullName?.split(' ')[0] || 'hsholding');
const workspaceShort = computed(() =>
  workspaceName.value.slice(0, 2).toUpperCase(),
);
const workspaces = [
  { id: 'default', name: workspaceName.value },
];

const initials = computed(() => {
  const name = authStore.user?.fullName || 'U';
  return name.split(' ').map(p => p[0]).slice(-2).join('').toUpperCase();
});

function toggleTheme() {
  const next = isDark.value ? 'smax-light' : 'legacy-dark';
  isDark.value = !isDark.value;
  theme.global.name.value = next;
  localStorage.setItem('theme', next);
}

function logout() {
  authStore.logout();
  router.push('/login');
}
</script>

<style scoped>
.smax-topnav {
  background: #0f172a;
  background-image: linear-gradient(180deg, rgba(30, 41, 59, 0.6) 0%, rgba(15, 23, 42, 0.95) 100%);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(12px);
  color: white;
  height: 54px;
  display: flex; align-items: center;
  padding: 0 16px; gap: 6px;
  flex-shrink: 0;
  position: sticky; top: 0; z-index: 100;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
}

.logo {
  width: 36px; height: 36px;
  background: #ffffff; border-radius: 9px;
  display: flex; align-items: center; justify-content: center;
  margin-right: 6px;
  text-decoration: none;
  overflow: hidden;
  padding: 3px;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
  transition: transform 0.2s ease;
}
.logo:hover { transform: scale(1.05); }
.logo img {
  width: 100%; height: 100%;
  object-fit: contain;
}

.workspace {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.08);
  display: flex; align-items: center; gap: 8px;
  padding: 6px 12px; border-radius: 9px;
  margin-right: 14px;
  cursor: pointer; color: white;
  font-size: 13px; font-weight: 500;
  transition: all 0.2s ease;
}
.workspace:hover {
  background: rgba(255, 255, 255, 0.12);
  border-color: rgba(255, 255, 255, 0.16);
}
.ws-logo {
  width: 22px; height: 22px;
  background: linear-gradient(135deg, #3b82f6, #1d4ed8);
  border-radius: 6px;
  display: flex; align-items: center; justify-content: center;
  color: white; font-size: 11px; font-weight: 700;
  box-shadow: 0 2px 4px rgba(37, 99, 235, 0.4);
}
.opacity-50 { opacity: 0.5; }

.nav-tabs {
  display: flex; align-items: center; gap: 3px;
  flex-wrap: nowrap;
  flex-shrink: 0;
}
.nav-tab {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 12px; border-radius: 8px;
  cursor: pointer;
  color: rgba(241, 245, 249, 0.75);
  font-size: 13px; font-weight: 500;
  background: transparent; border: 1px solid transparent;
  white-space: nowrap;
  text-decoration: none;
  transition: all 0.2s ease;
}

/* Compact nav progressively as viewport shrinks */
@media (max-width: 1500px) {
  .nav-tab { padding: 8px 9px; gap: 4px; font-size: 12.5px; }
}
@media (max-width: 1280px) {
  .nav-tab { padding: 7px 7px; font-size: 12px; }
  .nav-tab .ic { font-size: 13px; }
  .workspace { padding: 5px 9px; margin-right: 8px; font-size: 12px; }
}
@media (max-width: 1100px) {
  .nav-tab { padding: 6px 6px; gap: 3px; }
  .nav-tab .ic { display: none; }
  .workspace span:nth-of-type(2) { display: none; }
}
.nav-tab .ic { font-size: 14px; line-height: 1; }
.nav-tab .caret { font-size: 10px; opacity: 0.7; margin-left: 2px; }
.nav-tab:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #ffffff;
}
.nav-tab.active {
  background: linear-gradient(135deg, rgba(37, 99, 235, 0.9), rgba(29, 78, 216, 0.9));
  color: #ffffff;
  font-weight: 600;
  box-shadow: 0 2px 8px rgba(37, 99, 235, 0.35);
  border-color: rgba(255, 255, 255, 0.15);
}

.topnav-spacer { flex: 1; min-width: 0; }

.topnav-search {
  max-width: 240px;
  flex-shrink: 1;
}
@media (max-width: 1500px) {
  .topnav-search { max-width: 180px; }
}
@media (max-width: 1280px) {
  .topnav-search { max-width: 140px; }
}
@media (max-width: 1100px) {
  .topnav-search { display: none; }
}
.topnav-search :deep(.v-field) {
  background: rgba(255, 255, 255, 0.06) !important;
  color: white;
  border-radius: 8px !important;
  border: 1px solid rgba(255, 255, 255, 0.08) !important;
  transition: all 0.2s ease;
}
.topnav-search :deep(.v-field:hover) {
  background: rgba(255, 255, 255, 0.1) !important;
}
.topnav-search :deep(input) { color: white !important; }

.icon-btn,
:deep(.icon-btn-wrap) > * {
  width: 38px; height: 38px;
  border-radius: 9px;
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  color: rgba(241, 245, 249, 0.8);
  position: relative;
  font-size: 16px;
  text-decoration: none;
  background: transparent; border: none;
  transition: all 0.2s ease;
}
.icon-btn:hover,
:deep(.icon-btn-wrap) > *:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #ffffff;
}

.user-avatar {
  width: 36px; height: 36px;
  border-radius: 50%;
  background: linear-gradient(135deg, #3b82f6, #7c3aed);
  color: white; font-weight: 700;
  border: 2px solid rgba(255, 255, 255, 0.2);
  cursor: pointer;
  margin-left: 10px;
  font-size: 12px;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
  transition: all 0.2s ease;
}
.user-avatar:hover {
  transform: scale(1.05);
  border-color: rgba(255, 255, 255, 0.5);
}

.smax-main {
  background: #f8fafc;
}
.smax-main :deep(.v-main__wrap) { min-height: calc(100vh - 54px); }

:deep(.v-overlay__content > .v-list) {
  background: #ffffff;
  color: #0f172a;
  border-radius: 12px;
  box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
  border: 1px solid rgba(226, 232, 240, 0.8);
}
</style>
