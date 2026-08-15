<template>
  <v-card class="chart-card">
    <v-card-title class="chart-title">Thểi gian trả lọi trung bình</v-card-title>
    <v-card-text>
      <div v-if="chartData" class="chart-wrap">
        <Line :data="chartData" :options="chartOptions" />
      </div>
      <div v-else class="chart-empty">Không có dữ liệu</div>
      <div v-if="data?.overall" class="chart-caption">
        Trung bình tổng: {{ formatTime(data.overall) }}
      </div>
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
  Filler,
} from 'chart.js';
import type { ResponseTimeData } from '@/composables/use-analytics';
import { BRAND, lineChartOptions } from '@/constants/chart-theme';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler);

const props = defineProps<{ data: ResponseTimeData | null }>();

const chartData = computed(() => {
  if (!props.data?.daily?.length) return null;
  return {
    labels: props.data.daily.map((d) => d.date.slice(5)),
    datasets: [
      {
        label: 'TG trả lọi (giây)',
        data: props.data.daily.map((d) => d.avgSeconds),
        borderColor: BRAND.green,
        backgroundColor: 'rgba(22, 163, 74, 0.12)',
        fill: true,
      },
    ],
  };
});

const chartOptions = {
  ...lineChartOptions,
  plugins: {
    ...lineChartOptions.plugins,
    legend: { display: false },
    tooltip: {
      ...lineChartOptions.plugins.tooltip,
      callbacks: {
        label: (ctx: any) => formatTime(ctx.raw),
      },
    },
  },
};

function formatTime(seconds: number | null): string {
  if (seconds == null) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s} giây`;
  return `${m} phút ${s} giây`;
}
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
.chart-wrap { position: relative; height: 280px; width: 100%; }
.chart-empty {
  text-align: center;
  padding: 32px 0;
  font-size: 13px;
  color: #9ca3af;
}
.chart-caption {
  margin-top: 8px;
  text-align: center;
  font-size: 12px;
  color: #9ca3af;
}
</style>
