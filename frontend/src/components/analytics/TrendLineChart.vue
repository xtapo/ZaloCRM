<template>
  <v-card class="chart-card">
    <v-card-title class="chart-title">{{ title }}</v-card-title>
    <v-card-text>
      <div v-if="chartData" class="chart-wrap">
        <Line :data="chartData" :options="lineChartOptions" />
      </div>
      <div v-else class="chart-empty">Không có dữ liệu</div>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { Line } from 'vue-chartjs';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import { BRAND, lineChartOptions } from '@/constants/chart-theme';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);

const props = defineProps<{
  title: string;
  currentWeek: { date: string; value: number }[];
  previousWeek: { date: string; value: number }[];
}>();

const dayLabels = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];

const chartData = computed(() => {
  if (!props.currentWeek?.length && !props.previousWeek?.length) return null;
  const labels = props.currentWeek?.length
    ? props.currentWeek.map((_, i) => dayLabels[i] ?? `D${i + 1}`)
    : dayLabels;
  return {
    labels,
    datasets: [
      {
        label: 'Tuần này',
        data: props.currentWeek?.map((d) => d.value) ?? [],
        borderColor: BRAND.green,
        backgroundColor: BRAND.green,
      },
      {
        label: 'Tuần trước',
        data: props.previousWeek?.map((d) => d.value) ?? [],
        borderColor: BRAND.greyLight,
        backgroundColor: BRAND.greyLight,
        borderDash: [5, 5],
      },
    ],
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
.chart-wrap { position: relative; height: 240px; width: 100%; }
.chart-empty {
  text-align: center;
  padding: 32px 0;
  font-size: 13px;
  color: var(--smax-text-subtle, #9ca3af);
}
</style>
