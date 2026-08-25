<template>
  <v-menu v-model="menuOpen" offset-y :close-on-content-click="false" max-width="380">
    <template #activator="{ props: menuProps }">
      <v-btn icon variant="text" v-bind="menuProps" class="mr-1">
        <v-badge
          :content="unreadCount > 99 ? '99+' : unreadCount"
          :model-value="unreadCount > 0"
          color="error"
          overlap
        >
          <v-icon>mdi-bell-outline</v-icon>
        </v-badge>
      </v-btn>
    </template>
    <v-card style="max-height: 440px; overflow-y: auto;">
      <div class="d-flex align-center pa-3">
        <span class="text-body-1 font-weight-bold">Thông báo</span>
        <v-spacer />
        <v-btn
          v-if="unreadCount > 0"
          variant="text"
          density="compact"
          size="small"
          data-test="mark-all-read"
          @click="markAllRead"
        >
          <v-icon start size="16">mdi-check-all</v-icon>
          Đọc tất cả
        </v-btn>
      </div>
      <v-divider />
      <v-list density="compact" v-if="notifications.length > 0">
        <v-list-item
          v-for="n in notifications"
          :key="n.id"
          :data-test="`notification-${n.id}`"
          :class="['py-2', { 'unseen-item': !n.readAt }]"
          @click="handleClick(n)"
        >
          <template #prepend>
            <div class="d-flex align-center">
              <v-icon
                :color="iconColor(n.type)"
                size="20"
              >
                {{ iconFor(n.type) }}
              </v-icon>
              <!-- Chấm xanh chưa đọc -->
              <v-icon v-if="!n.readAt" color="primary" size="8" class="ml-1">mdi-circle</v-icon>
            </div>
          </template>
          <v-list-item-title class="text-body-2" :class="{ 'font-weight-bold': !n.readAt }">
            {{ n.title }}
          </v-list-item-title>
          <v-list-item-subtitle class="text-caption">
            {{ n.detail }} · {{ relativeTime(n.createdAt) }}
          </v-list-item-subtitle>
        </v-list-item>
      </v-list>
      <div v-else class="pa-4 text-center text-caption text-grey">Không có thông báo</div>
    </v-card>
  </v-menu>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useNotifications, type NotificationItem } from '@/composables/use-notifications';

const { notifications, unreadCount, markRead, markAllRead } = useNotifications();
const router = useRouter();
const menuOpen = ref(false);

function iconColor(type: string): string {
  return type === 'error' ? 'red' : type === 'warning' ? 'orange' : 'blue';
}

function iconFor(type: string): string {
  return type === 'error' ? 'mdi-alert-circle' : type === 'warning' ? 'mdi-alert' : 'mdi-information';
}

async function handleClick(n: NotificationItem) {
  await markRead(n);
  // Backend persist sẵn `link` theo từng loại thông báo — hết if-chain phía FE.
  if (n.link) {
    menuOpen.value = false; // đóng đè menu trước khi điều hướng tới nội dung
    router.push(n.link);
  }
}

/** Thời gian tương đối tiếng Việt (vd "5 phút trước"). */
function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return 'vừa xong';
  if (min < 60) return `${min} phút trước`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} giờ trước`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} ngày trước`;
  return new Date(iso).toLocaleDateString('vi-VN');
}
</script>

<style scoped>
.unseen-item {
  background: rgba(var(--v-theme-primary), 0.06);
}
</style>
