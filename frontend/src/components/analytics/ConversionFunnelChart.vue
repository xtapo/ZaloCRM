<template>
  <v-card class="chart-card">
    <v-card-title class="chart-title">Phễu chuyển đổi</v-card-title>
    <v-card-text>
      <div v-if="chartData" class="chart-wrap">
        <Bar :data="chartData" :options="chartOptions" />
      </div>
      <div v-else class="chart-empty">Không có dữ liệu</div>
      <div v-if="data?.avgConversionDays" class="chart-caption">
        Thểi gian chuyển đổi trung bình: {{ data.avgConversionDays }} ngày
      </div>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { Bar } from 'vue-chartjs';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import type { ConversionFunnelData } from '@/composables/use-analytics';
import { BRAND, PIPELINE_COLORS, barChartOptions } from '@/constants/chart-theme';

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

const props = defineProps<{ data: ConversionFunnelData | null }>();

const statusLabels: Record<string, string> = {
  new: 'Mới',
  contacted: 'Đã liên hệ',
  interested: 'Quan tâm',
  converted: 'Chuyển đổi',
  lost: 'Mất',
};

const chartData = computed(() => {
  if (!props.data?.stages?.length) return null;
  return {
    labels: props.data.stages.map((s) => statusLabels[s.status] ?? s.status),
    datasets: [
      {
        label: 'Số khách hàng',
        data: props.data.stages.map((s) => s.count),
        backgroundColor: props.data.stages.map((s) => PIPELINE_COLORS[s.status] ?? BRAND.grey),
      },
    ],
  };
});

// Bar ngang: dùng chung options nhưng đảo trục + ẩn legend, giữ nguyên tooltip %.
const chartOptions = {
  ...barChartOptions,
  indexAxis: 'y' as const,
  resizeDelay: 50,
  plugins: {
    ...barChartOptions.plugins,
    legend: { display: false },
    tooltip: {
      ...barChartOptions.plugins.tooltip,
      callbacks: {
        label: (ctx: any) => {
          const stage = props.data?.stages[ctx.dataIndex];
          return `${ctx.raw} (${stage?.rate ?? 0}%)`;
        },
      },
    },
  },
  scales: {
    x: {
      beginAtZero: true,
      grid: { color: BRAND.gridLine },
      border: { display: false },
      ticks: { color: BRAND.textMuted, font: { size: 11 } },
    },
    y: {
      grid: { display: false },
      border: { display: false },
      ticks: { color: BRAND.textMuted, font: { size: 11 } },
    },
  },
};
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
.chart-wrap {
  position: relative;
  height: 320px;
  width: 100%;
}
.chart-empty {
  text-align: center;
  padding: 32px 0;
  font-size: 13px;
  color: var(--smax-text-subtle, #9ca3af);
}
.chart-caption {
  margin-top: 8px;
  text-align: center;
  font-size: 12px;
  color: var(--smax-text-subtle, #9ca3af);
}
</style>
