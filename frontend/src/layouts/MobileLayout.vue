<template>
  <v-app class="mobile-app">
    <OfflineIndicator />

    <!-- Slim mobile app bar -->
    <v-app-bar density="compact" flat class="mobile-appbar">
      <div class="d-flex align-center ml-3" style="gap: 8px;">
        <div class="brand-badge">
          <v-icon size="16" color="white">mdi-robot</v-icon>
        </div>
        <span class="font-weight-bold text-body-1">Zalo<span class="brand-accent">CRM</span></span>
      </div>

      <v-spacer />

      <NotificationBell />
      <v-btn icon size="small" variant="text" @click="toggleTheme">
        <v-icon size="20">{{ isDark ? 'mdi-weather-sunny' : 'mdi-weather-night' }}</v-icon>
      </v-btn>
      <v-btn icon size="small" variant="text" @click="logout">
        <v-icon size="20">mdi-logout</v-icon>
      </v-btn>
    </v-app-bar>

    <!-- Main content with padding for bottom nav -->
    <v-main>
      <div style="padding-bottom: 72px;">
        <slot />
      </div>
    </v-main>

    <BottomNav />
  </v-app>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useTheme } from 'vuetify';
import { useAuthStore } from '@/stores/auth';
import { useRouter } from 'vue-router';
import NotificationBell from '@/components/NotificationBell.vue';
import BottomNav from '@/components/BottomNav.vue';
import OfflineIndicator from '@/components/OfflineIndicator.vue';

// Tên theme phải khớp với plugins/vuetify.ts ('smax-light' | 'legacy-dark').
// Trước đây file này set 'dark'/'light' — 2 theme không tồn tại nên mobile bị
// giữ nguyên màu và lệch hẳn so với desktop.
const LIGHT = 'smax-light';
const DARK = 'legacy-dark';

const theme = useTheme();
const authStore = useAuthStore();
const router = useRouter();
const isDark = ref((localStorage.getItem('theme') || LIGHT) === DARK);

onMounted(() => {
  const saved = localStorage.getItem('theme') || LIGHT;
  theme.global.name.value = saved;
  isDark.value = saved === DARK;
});

function toggleTheme() {
  isDark.value = !isDark.value;
  const next = isDark.value ? DARK : LIGHT;
  theme.global.name.value = next;
  localStorage.setItem('theme', next);
}

function logout() {
  authStore.logout();
  router.push('/login');
}
</script>

<style scoped>
.mobile-app {
  background: #eceef0;
}

.mobile-appbar {
  background: #ffffff !important;
  box-shadow: 0 2px 8px rgba(17, 24, 39, 0.04) !important;
}

.brand-badge {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #22c55e, #15803d);
  border-radius: 50%;
}

.brand-accent {
  color: #16a34a;
}
</style>
