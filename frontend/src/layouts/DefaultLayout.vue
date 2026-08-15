<template>
  <v-app class="smax-app">
    <!-- ════════ TOP NAV (light floating pill, theo mockup tham khảo) ════════ -->
    <header class="smax-topnav">
      <div class="topnav-shell">
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
              <v-list-item
                v-if="authStore.user?.role === 'owner' || authStore.user?.role === 'admin'"
                to="/security-events"
                title="Sự kiện bảo mật"
                prepend-icon="mdi-shield-alert-outline"
              />
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
      </div>
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
// Bot-Auto (Phase 7) là tab top-level riêng (giống smax.ai), tách hản khỏi
// legacy Automation dropdown để user không bị nhầm 2 hệ thống.
const primaryTabs: NavTab[] = [
  { path: '/',                       label: 'Dashboard',   icon: '🏠', matchPrefix: '/$' },
  { path: '/chat',                   label: 'Tin nhắn',    icon: '💬' },
  { path: '/friends',                label: 'Bạn bè',      icon: '👥' },
  { path: '/contacts',               label: 'Khách hàng',  icon: '🧑' },
  { path: '/leads/stuck',            label: 'KH đình trệ', icon: '🚨' },
  { path: '/appointments',           label: 'Lịch họn',    icon: '📅' },
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
/* Canvas xám nhạt — navbar là một "pill" trắng nổi trên canvas */
.smax-app {
  background: #eceef0;
}

.smax-topnav {
  background: transparent;
  height: 76px;
  display: flex;
  align-items: center;
  padding: 14px 20px 6px;
  flex-shrink: 0;
  position: sticky;
  top: 0;
  z-index: 100;
  backdrop-filter: blur(8px);
}

.topnav-shell {
  width: 100%;
  height: 60px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 12px 0 14px;
  background: #ffffff;
  border-radius: 999px;
  box-shadow: 0 6px 18px rgba(17, 24, 39, 0.06);
}

.logo {
  width: 38px; height: 38px;
  background: #eaf7ef; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  margin-right: 8px;
  text-decoration: none;
  overflow: hidden;
  padding: 4px;
  transition: transform 0.2s ease;
}
.logo:hover { transform: scale(1.05); }
.logo img {
  width: 100%; height: 100%;
  object-fit: contain;
}

.workspace {
  background: #f6f8f7;
  border: none;
  display: flex; align-items: center; gap: 8px;
  padding: 7px 14px; border-radius: 999px;
  margin-right: 12px;
  cursor: pointer; color: #111827;
  font-size: 13px; font-weight: 600;
  transition: all 0.2s ease;
}
.workspace:hover {
  background: #eaf7ef;
  color: #15803d;
}
.ws-logo {
  width: 22px; height: 22px;
  background: linear-gradient(135deg, #22c55e, #15803d);
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  color: white; font-size: 11px; font-weight: 700;
}
.opacity-50 { opacity: 0.45; }

.nav-tabs {
  display: flex; align-items: center; gap: 2px;
  flex-wrap: nowrap;
  flex-shrink: 0;
}
.nav-tab {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 14px; border-radius: 999px;
  cursor: pointer;
  color: #6b7280;
  font-size: 13px; font-weight: 500;
  background: transparent; border: none;
  white-space: nowrap;
  text-decoration: none;
  transition: all 0.2s ease;
}

/* Compact nav progressively as viewport shrinks */
@media (max-width: 1500px) {
  .nav-tab { padding: 8px 10px; gap: 4px; font-size: 12.5px; }
}
@media (max-width: 1280px) {
  .nav-tab { padding: 7px 8px; font-size: 12px; }
  .nav-tab .ic { font-size: 13px; }
  .workspace { padding: 6px 10px; margin-right: 8px; font-size: 12px; }
}
@media (max-width: 1100px) {
  .nav-tab { padding: 6px 7px; gap: 3px; }
  .nav-tab .ic { display: none; }
  .workspace span:nth-of-type(2) { display: none; }
}
.nav-tab .ic { font-size: 14px; line-height: 1; }
.nav-tab .caret { font-size: 10px; opacity: 0.6; margin-left: 2px; }
.nav-tab:hover {
  background: #f2f4f3;
  color: #111827;
}
.nav-tab.active {
  background: #16a34a;
  color: #ffffff;
  font-weight: 600;
  box-shadow: 0 8px 18px -8px rgba(22, 163, 74, 0.55);
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
  background: #f6f8f7 !important;
  color: #111827;
  border-radius: 999px !important;
  border: none !important;
  box-shadow: none !important;
  transition: all 0.2s ease;
}
.topnav-search :deep(.v-field:hover) {
  background: #eef1f0 !important;
}
.topnav-search :deep(input) { color: #111827 !important; }

.icon-btn,
:deep(.icon-btn-wrap) > * {
  width: 40px; height: 40px;
  border-radius: 50%;
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  color: #6b7280;
  position: relative;
  font-size: 16px;
  text-decoration: none;
  background: #f6f8f7; border: none;
  margin-left: 6px;
  transition: all 0.2s ease;
}
.icon-btn:hover,
:deep(.icon-btn-wrap) > *:hover {
  background: #eaf7ef;
  color: #15803d;
}

.user-avatar {
  width: 40px; height: 40px;
  border-radius: 50%;
  background: linear-gradient(135deg, #22c55e, #15803d);
  color: white; font-weight: 700;
  border: 2px solid #ffffff;
  cursor: pointer;
  margin-left: 8px;
  font-size: 12px;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 4px 12px rgba(22, 163, 74, 0.25);
  transition: all 0.2s ease;
}
.user-avatar:hover {
  transform: scale(1.05);
}

.smax-main {
  background: #eceef0;
}
.smax-main :deep(.v-main__wrap) { min-height: calc(100vh - 76px); }

:deep(.v-overlay__content > .v-list) {
  background: #ffffff;
  color: #111827;
  border-radius: 20px;
  box-shadow: 0 14px 34px rgba(17, 24, 39, 0.1);
  border: none;
  padding: 6px;
}
:deep(.v-overlay__content > .v-list .v-list-item) {
  border-radius: 12px;
}
</style>
