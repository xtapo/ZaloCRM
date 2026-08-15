<template>
  <v-card class="chart-card">
    <v-card-title class="chart-title">Tin nhắn theo ngày</v-card-title>
    <v-card-text>
      <Bar v-if="chartData" :data="chartData" :options="barChartOptions" style="height: 250px;" />
      <div v-else class="chart-empty">Không có dữ liệu</div>
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
import { BRAND, barChartOptions } from '@/constants/chart-theme';

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

const props = defineProps<{
  data: { date: string; sent: number; received: number }[];
}>();

const chartData = computed(() => {
  if (!props.data?.length) return null;
  return {
    labels: props.data.map(d => d.date.slice(5)), // MM-DD
    datasets: [
      { label: 'Đã gửi', data: props.data.map(d => d.sent), backgroundColor: BRAND.green },
      { label: 'Đã nhận', data: props.data.map(d => d.received), backgroundColor: BRAND.greenSoft },
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
