<template>
  <v-row density="comfortable">
    <v-col v-for="card in cards" :key="card.title" cols="12" sm="6" md="4" lg="2">
      <div class="kpi-card">
        <div class="kpi-icon-wrap" :style="{ background: card.bg, color: card.iconColor }">
          <v-icon :icon="card.icon" size="22" />
        </div>
        <div class="kpi-content">
          <div class="kpi-value">{{ card.value }}</div>
          <div class="kpi-title">{{ card.title }}</div>
        </div>
      </div>
    </v-col>
  </v-row>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { BRAND } from '@/constants/chart-theme';

interface KpiData {
  messagesToday: number;
  messagesUnreplied: number;
  messagesUnread: number;
  appointmentsToday: number;
  newContactsThisWeek: number;
  totalContacts: number;
}

const props = defineProps<{
  kpi: KpiData | null;
}>();

/** Nền icon: dùng chung 1 công thức tint mềm thay vì gradient mỗi thẻ một kiểu. */
function tint(hex: string): string {
  return `${hex}1f`;
}

const cards = computed(() => [
  {
    title: 'Tin nhắn hôm nay',
    value: props.kpi?.messagesToday ?? '—',
    icon: 'mdi-message-text-outline',
    iconColor: BRAND.green,
    bg: tint(BRAND.green),
  },
  {
    title: 'Chưa trả lọi',
    value: props.kpi?.messagesUnreplied ?? '—',
    icon: 'mdi-clock-alert-outline',
    iconColor: BRAND.amber,
    bg: tint(BRAND.amber),
  },
  {
    title: 'Chưa đọc',
    value: props.kpi?.messagesUnread ?? '—',
    icon: 'mdi-email-mark-as-unread',
    iconColor: BRAND.orange,
    bg: tint(BRAND.orange),
  },
  {
    title: 'Lịch hẹn hôm nay',
    value: props.kpi?.appointmentsToday ?? '—',
    icon: 'mdi-calendar-check-outline',
    iconColor: BRAND.greenDark,
    bg: tint(BRAND.greenDark),
  },
  {
    title: 'KH mới tuần này',
    value: props.kpi?.newContactsThisWeek ?? '—',
    icon: 'mdi-account-plus-outline',
    iconColor: BRAND.greenDeep,
    bg: tint(BRAND.greenDeep),
  },
  {
    title: 'Tổng khách hàng',
    value: props.kpi?.totalContacts ?? '—',
    icon: 'mdi-account-group-outline',
    iconColor: BRAND.sky,
    bg: tint(BRAND.sky),
  },
]);
</script>

<style scoped>
.kpi-card {
  background: var(--smax-surface, #ffffff);
  border: 1px solid var(--smax-surface-border, rgba(17, 24, 39, 0.04));
  border-radius: 24px;
  padding: 18px;
  display: flex;
  align-items: center;
  gap: 14px;
  box-shadow: var(--shadow-sm, 0 2px 8px rgba(17, 24, 39, 0.04));
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  position: relative;
  overflow: hidden;
  height: 100%;
}

.kpi-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-md, 0 14px 34px rgba(17, 24, 39, 0.08));
}

.kpi-icon-wrap {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.kpi-content {
  min-width: 0;
  flex: 1;
}

.kpi-value {
  font-family: 'Plus Jakarta Sans', sans-serif;
  font-size: 24px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--smax-text, #111827);
  line-height: 1.2;
}

.kpi-title {
  font-size: 12.5px;
  font-weight: 500;
  color: var(--smax-text-muted, #6b7280);
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
