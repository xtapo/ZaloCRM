<template>
  <v-card class="chart-card">
    <v-card-title class="chart-title">Trạng thái lịch hẹn</v-card-title>
    <v-card-text>
      <Pie v-if="chartData" :data="chartData" :options="pieChartOptions" style="height: 250px;" />
      <div v-else class="chart-empty">Không có dữ liệu</div>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { Pie } from 'vue-chartjs';
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js';
import { BRAND, APPOINTMENT_COLORS, pieChartOptions } from '@/constants/chart-theme';

ChartJS.register(ArcElement, Tooltip, Legend);

const props = defineProps<{
  data: { status: string; _count: { _all: number } | number }[];
}>();

const statusLabels: Record<string, string> = {
  scheduled: 'Đã lên lịch',
  completed: 'Hoàn thành',
  cancelled: 'Đã hủy',
  no_show: 'Vắng mặt',
};

function getCount(item: { _count: { _all: number } | number }): number {
  return typeof item._count === 'number' ? item._count : item._count._all;
}

const chartData = computed(() => {
  if (!props.data?.length) return null;
  return {
    labels: props.data.map(d => statusLabels[d.status] || d.status),
    datasets: [{
      data: props.data.map(d => getCount(d)),
      backgroundColor: props.data.map(d => APPOINTMENT_COLORS[d.status] || BRAND.greyLight),
    }],
  };
});
</script>

<style scoped>
.chart-card {
  border-radius: 24px;
  border: none;
  box-shadow: 0 2px 8px rgba(17, 24, 39, 0.04);
}
.chart-title {
  font-family: 'Plus Jakarta Sans', sans-serif;
  font-size: 14px;
  font-weight: 700;
  color: var(--smax-text, #111827);
  padding-bottom: 0;
}
.chart-empty {
  text-align: center;
  padding: 32px 0;
  font-size: 13px;
  color: var(--smax-text-subtle, #9ca3af);
}
</style>
