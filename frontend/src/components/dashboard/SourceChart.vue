<template>
  <v-card class="chart-card">
    <v-card-title class="chart-title">Nguồn khách hàng</v-card-title>
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
import { SOURCE_COLORS, seriesColor, pieChartOptions } from '@/constants/chart-theme';

ChartJS.register(ArcElement, Tooltip, Legend);

const props = defineProps<{
  data: { source: string; _count: { _all: number } | number }[];
}>();

function getCount(item: { _count: { _all: number } | number }): number {
  return typeof item._count === 'number' ? item._count : item._count._all;
}

const chartData = computed(() => {
  if (!props.data?.length) return null;
  return {
    labels: props.data.map(d => d.source),
    datasets: [{
      data: props.data.map(d => getCount(d)),
      backgroundColor: props.data.map((d, i) => SOURCE_COLORS[d.source] || seriesColor(i)),
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
  color: #111827;
  padding-bottom: 0;
}
.chart-empty {
  text-align: center;
  padding: 32px 0;
  font-size: 13px;
  color: #9ca3af;
}
</style>
