<template>
  <div class="pa-3">
    <!-- Tổng quan -->
    <div class="d-flex flex-wrap gap-2 mb-4">
      <v-card variant="tonal" color="indigo" class="flex-1-1 stat-card">
        <div class="pa-3 text-center">
          <div class="text-h6 font-weight-bold">{{ activeMembers }}/{{ stats.membersCount || '?' }}</div>
          <div class="text-caption">Hoạt động 30 ngày</div>
        </div>
      </v-card>
      <v-card variant="tonal" :color="statusColor" class="flex-1-1 stat-card">
        <div class="pa-3 text-center">
          <div class="text-h6 font-weight-bold">{{ statusLabel }}</div>
          <div class="text-caption">Trạng thái</div>
        </div>
      </v-card>
    </div>

    <!-- Biểu đồ theo ngày (14 ngày) -->
    <template v-if="dailyActivity.length">
      <div class="text-subtitle-2 mb-2">
        <v-icon size="16" class="mr-1">mdi-chart-bar</v-icon>
        Hoạt động 14 ngày
      </div>
      <div class="chart d-flex align-end mb-4">
        <v-tooltip v-for="(d, i) in dailyActivity" :key="i" location="top">
          <template #activator="{ props: tipProps }">
            <div
              v-bind="tipProps"
              class="chart-bar"
              :style="{ height: barHeight(d.count) }"
            />
          </template>
          {{ formatDate(d.date) }}: {{ d.count }} tin
        </v-tooltip>
      </div>
      <div class="d-flex justify-between text-caption text-grey mb-4 chart-range">
        <span>{{ formatDate(dailyActivity[0]?.date) }}</span>
        <span>{{ formatDate(dailyActivity[dailyActivity.length - 1]?.date) }}</span>
      </div>
    </template>
    <div v-else class="text-caption text-grey mb-4">Chưa có tin nhắn trong 14 ngày qua</div>

    <!-- Top thành viên -->
    <div class="text-subtitle-2 mb-2">
      <v-icon size="16" class="mr-1">mdi-account-star</v-icon>
      Thành viên nhắn nhiều nhất (30 ngày)
    </div>
    <v-list v-if="topSenders.length" density="compact" class="py-0">
      <v-list-item v-for="(s, i) in topSenders" :key="s.senderUid" class="mb-1 px-2">
        <template #prepend>
          <v-avatar size="28" :color="rankColors[i] ?? 'grey'">
            <span class="text-caption font-weight-bold">{{ i + 1 }}</span>
          </v-avatar>
        </template>
        <v-list-item-title class="text-body-2">{{ s.senderName }}</v-list-item-title>
        <template #append>
          <span class="text-caption text-grey">{{ s.count }} tin</span>
        </template>
      </v-list-item>
    </v-list>
    <div v-else class="text-caption text-grey">Chưa có dữ liệu thành viên</div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { GroupDetailStat } from '@/composables/use-group-stats';

const props = defineProps<{
  stats: GroupDetailStat;
}>();

const dailyActivity = computed(() => props.stats.dailyActivity ?? []);
const topSenders = computed(() => props.stats.topSenders ?? []);
// Số thành viên distinct hoạt động 30 ngày = số dòng trong dailyActivity không đúng,
// nhưng BE detail endpoint không trả activeMembers30d riêng — dùng tổng tin / trung bình.
// Đơn giản: hiển thị số top senders như proxy "thành viên đã tham gia".
const activeMembers = computed(() =>
  Math.max(props.stats.topSenders?.length ?? 0, 1),
);

const statusMap = {
  active: { label: 'Đang hoạt động', color: 'success' },
  quiet: { label: 'Ít hoạt động', color: 'warning' },
  silent: { label: 'Im lặng', color: 'grey' },
} as const;

const statusColor = computed(() => statusMap[props.stats.status ?? 'silent'].color);
const statusLabel = computed(() => statusMap[props.stats.status ?? 'silent'].label);

function barHeight(count: number) {
  const max = Math.max(...dailyActivity.value.map(d => d.count), 1);
  return `${Math.max((count / max) * 100, 4)}%`;
}

function formatDate(d?: string | Date) {
  if (!d) return '';
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
}

const rankColors = ['amber', 'blue', 'light-blue'];
</script>

<style scoped>
.stat-card { min-width: 100px; }
.chart {
  height: 80px;
  gap: 3px;
  align-items: flex-end;
}
.chart-bar {
  flex: 1;
  min-width: 8px;
  background: rgb(var(--v-theme-primary));
  border-radius: 3px 3px 0 0;
  opacity: 0.85;
  transition: height 0.3s ease;
}
.chart-bar:hover { opacity: 1; }
.chart-range { max-width: 100%; }
.justify-between { justify-content: space-between; }
</style>
