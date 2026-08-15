<template>
  <div class="dashboard-page pa-6">
    <!-- ATTRIBUTION BANNER — Required by Apache License 2.0 NOTICE clause §4(d) -->
    <a
      v-if="attribution.enabled.value"
      class="contact-marquee dashboard-marquee"
      :href="attribution.href"
      target="_blank"
      rel="noopener"
      :title="attribution.text"
    >
      <span class="marquee-track">
        {{ attribution.text }}&nbsp;•&nbsp;{{ attribution.text }}&nbsp;•&nbsp;
      </span>
    </a>

    <!-- Header bar -->
    <div class="dash-header mb-6">
      <div class="dash-title-wrap">
        <div class="dash-icon-badge">
          <v-icon size="24" color="primary">mdi-view-dashboard-outline</v-icon>
        </div>
        <div>
          <div class="d-flex align-center gap-2">
            <h1 class="dash-title">Tổng quan hệ thống</h1>
            <span class="live-pill">
              <span class="live-dot" /> Trực tiếp
            </span>
          </div>
          <p class="dash-subtitle">
            Theo dõi hiệu suất hội thoại, tương tác Zalo và lịch hẹn khách hàng toàn hệ thống
          </p>
        </div>
      </div>

      <div class="dash-actions">
        <button class="btn-refresh" :disabled="loading" @click="fetchAll" title="Tải lại dữ liệu">
          <v-icon size="16" :class="{ 'spin-icon': loading }">mdi-refresh</v-icon>
          Cập nhật
        </button>
      </div>
    </div>

    <v-progress-linear v-if="loading" indeterminate color="primary" class="mb-4 rounded-pill" height="3" />

    <!-- KPI Section -->
    <KpiCards :kpi="kpi" class="mb-6" />

    <!-- Main Analytics Charts -->
    <v-row class="mb-6">
      <v-col cols="12" md="8">
        <MessageVolumeChart :data="messageVolume" />
      </v-col>
      <v-col cols="12" md="4">
        <PipelineChart :data="pipeline" />
      </v-col>
    </v-row>

    <!-- Secondary Charts -->
    <v-row>
      <v-col cols="12" md="6">
        <SourceChart :data="sources" />
      </v-col>
      <v-col cols="12" md="6">
        <AppointmentChart :data="appointments" />
      </v-col>
    </v-row>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import KpiCards from '@/components/dashboard/KpiCards.vue';
import MessageVolumeChart from '@/components/dashboard/MessageVolumeChart.vue';
import PipelineChart from '@/components/dashboard/PipelineChart.vue';
import SourceChart from '@/components/dashboard/SourceChart.vue';
import AppointmentChart from '@/components/dashboard/AppointmentChart.vue';
import { useDashboard } from '@/composables/use-dashboard';
// Apache 2.0 §4(d) attribution — see src/composables/use-attribution.ts + NOTICE
import { useAttribution } from '@/composables/use-attribution';

const attribution = useAttribution();

const {
  kpi, messageVolume, pipeline, sources, appointments,
  loading, fetchAll,
} = useDashboard();

onMounted(() => fetchAll());
</script>

<style scoped>
.dashboard-page {
  max-width: 1600px;
  margin: 0 auto;
}

.dash-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.dash-title-wrap {
  display: flex;
  align-items: center;
  gap: 14px;
}

.dash-icon-badge {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: #ffffff;
  border: none;
  box-shadow: 0 2px 8px rgba(17, 24, 39, 0.04);
  display: flex;
  align-items: center;
  justify-content: center;
}

.dash-title {
  font-family: 'Plus Jakarta Sans', sans-serif;
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: #111827;
  margin: 0;
}

.dash-subtitle {
  font-size: 13px;
  color: #6b7280;
  margin: 2px 0 0 0;
}

.live-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  border-radius: 9999px;
  background: #dcfce7;
  color: #15803d;
  font-size: 11px;
  font-weight: 700;
  border: none;
}

.live-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #16a34a;
  box-shadow: 0 0 8px #16a34a;
  animation: pulse-dot 2s infinite;
}

@keyframes pulse-dot {
  0% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.4; transform: scale(0.8); }
  100% { opacity: 1; transform: scale(1); }
}

.btn-refresh {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 9px 18px;
  border-radius: 9999px;
  background: #ffffff;
  border: none;
  color: #374151;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 2px 8px rgba(17, 24, 39, 0.04);
}

.btn-refresh:hover:not(:disabled) {
  background: #16a34a;
  color: #ffffff;
  box-shadow: 0 10px 24px -8px rgba(22, 163, 74, 0.45);
}

.btn-refresh:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.spin-icon {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.contact-marquee {
  display: block;
  max-width: 380px;
  margin: 0 0 16px auto;
  padding: 6px 14px;
  background: #dcfce7;
  border: none;
  border-radius: 9999px;
  color: #15803d;
  font-size: 12.5px;
  font-weight: 600;
  text-decoration: none;
  overflow: hidden;
  white-space: nowrap;
}
.contact-marquee:hover {
  background: #bbf7d0;
}
.marquee-track {
  display: inline-block;
  animation: marquee 30s linear infinite;
  padding-left: 100%;
}
.contact-marquee:hover .marquee-track {
  animation-play-state: paused;
}
@keyframes marquee {
  0% { transform: translateX(0); }
  100% { transform: translateX(-100%); }
}
</style>
