<template>
  <v-row density="comfortable">
    <v-col v-for="card in cards" :key="card.title" cols="12" sm="6" md="4" lg="2">
      <div class="kpi-card" :class="`kpi-${card.theme}`">
        <div class="kpi-icon-wrap" :style="{ background: card.bgGradient, color: card.iconColor }">
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

const cards = computed(() => [
  {
    title: 'Tin nhắn hôm nay',
    value: props.kpi?.messagesToday ?? '—',
    icon: 'mdi-message-text-outline',
    iconColor: '#2563eb',
    bgGradient: 'linear-gradient(135deg, rgba(37, 99, 235, 0.12), rgba(37, 99, 235, 0.04))',
    theme: 'blue',
  },
  {
    title: 'Chưa trả lời',
    value: props.kpi?.messagesUnreplied ?? '—',
    icon: 'mdi-clock-alert-outline',
    iconColor: '#d97706',
    bgGradient: 'linear-gradient(135deg, rgba(217, 119, 6, 0.12), rgba(217, 119, 6, 0.04))',
    theme: 'amber',
  },
  {
    title: 'Chưa đọc',
    value: props.kpi?.messagesUnread ?? '—',
    icon: 'mdi-email-mark-as-unread',
    iconColor: '#ea580c',
    bgGradient: 'linear-gradient(135deg, rgba(234, 88, 12, 0.12), rgba(234, 88, 12, 0.04))',
    theme: 'orange',
  },
  {
    title: 'Lịch hẹn hôm nay',
    value: props.kpi?.appointmentsToday ?? '—',
    icon: 'mdi-calendar-check-outline',
    iconColor: '#059669',
    bgGradient: 'linear-gradient(135deg, rgba(5, 150, 105, 0.12), rgba(5, 150, 105, 0.04))',
    theme: 'emerald',
  },
  {
    title: 'KH mới tuần này',
    value: props.kpi?.newContactsThisWeek ?? '—',
    icon: 'mdi-account-plus-outline',
    iconColor: '#0284c7',
    bgGradient: 'linear-gradient(135deg, rgba(2, 132, 199, 0.12), rgba(2, 132, 199, 0.04))',
    theme: 'sky',
  },
  {
    title: 'Tổng khách hàng',
    value: props.kpi?.totalContacts ?? '—',
    icon: 'mdi-account-group-outline',
    iconColor: '#7c3aed',
    bgGradient: 'linear-gradient(135deg, rgba(124, 58, 237, 0.12), rgba(124, 58, 237, 0.04))',
    theme: 'violet',
  },
]);
</script>

<style scoped>
.kpi-card {
  background: #ffffff;
  border: 1px solid rgba(226, 232, 240, 0.9);
  border-radius: 14px;
  padding: 16px;
  display: flex;
  align-items: center;
  gap: 14px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  position: relative;
  overflow: hidden;
}

.kpi-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 20px -4px rgba(0, 0, 0, 0.08);
  border-color: rgba(203, 213, 225, 1);
}

.kpi-icon-wrap {
  width: 44px;
  height: 44px;
  border-radius: 12px;
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
  font-size: 22px;
  font-weight: 700;
  color: #0f172a;
  line-height: 1.2;
}

.kpi-title {
  font-size: 12.5px;
  font-weight: 500;
  color: #64748b;
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
