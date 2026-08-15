<template>
  <v-card class="chart-card">
    <v-card-title class="chart-title">Pipeline khách hàng</v-card-title>
    <v-card-text>
      <Doughnut v-if="chartData" :data="chartData" :options="pieChartOptions" style="height: 250px;" />
      <div v-else class="chart-empty">Không có dữ liệu</div>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { Doughnut } from 'vue-chartjs';
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js';
import { BRAND, PIPELINE_COLORS, pieChartOptions } from '@/constants/chart-theme';

ChartJS.register(ArcElement, Tooltip, Legend);

const props = defineProps<{
  data: { status: string | null; _count: { _all: number } | number }[];
}>();

const statusLabels: Record<string, string> = {
  new: 'Mới',
  contacted: 'Đã liên hệ',
  interested: 'Quan tâm',
  converted: 'Chuyển đổi',
  lost: 'Mất',
};

function getCount(item: { _count: { _all: number } | number }): number {
  return typeof item._count === 'number' ? item._count : item._count._all;
}

const chartData = computed(() => {
  if (!props.data?.length) return null;
  const filtered = props.data.filter(d => d.status);
  if (!filtered.length) return null;
  return {
    labels: filtered.map(d => statusLabels[d.status || ''] || d.status),
    datasets: [{
      data: filtered.map(d => getCount(d)),
      backgroundColor: filtered.map(d => PIPELINE_COLORS[d.status || ''] || BRAND.greyLight),
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
