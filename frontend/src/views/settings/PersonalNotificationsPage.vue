<template>
  <div class="notif-page">
    <div class="page-head">
      <h2 class="page-title">Thông báo</h2>
      <p class="page-desc">
        Chọn nguồn thông báo bạn muốn nhận trong chuông 🔔 trên thanh điều hướng.
        Tắt một nguồn sẽ ẩn cả các cảnh báo đang có của nguồn đó.
      </p>
    </div>

    <div v-if="loading" class="loading">Đang tải...</div>

    <template v-else>
      <div class="source-list">
        <label v-for="s in sources" :key="s.key" class="source-row" :data-test="`pref-${s.key}`">
          <div class="source-info">
            <span class="source-icon">{{ meta[s.key]?.icon }}</span>
            <div>
              <div class="source-label">{{ meta[s.key]?.label ?? s.key }}</div>
              <div class="source-desc">{{ meta[s.key]?.desc }}</div>
            </div>
          </div>
          <input
            v-model="s.enabled"
            type="checkbox"
            class="switch"
            @change="dirty = true"
          />
        </label>

        <div class="section-title">Tuỳ chọn khác</div>

        <label class="source-row" data-test="pref-sound">
          <div class="source-info">
            <span class="source-icon">🔊</span>
            <div>
              <div class="source-label">Âm thanh thông báo</div>
              <div class="source-desc">
                Phát chuông ngắn khi có thông báo mới.
                <button type="button" class="link-btn" @click.prevent="previewSound">Nghe thử</button>
              </div>
            </div>
          </div>
          <input
            v-model="soundOn"
            type="checkbox"
            class="switch"
            @change="dirty = true"
          />
        </label>
      </div>

      <div class="actions">
        <button
          class="btn-primary"
          :disabled="!dirty || saving"
          data-test="save-prefs"
          @click="onSave"
        >
          <span v-if="saving">Đang lưu...</span>
          <span v-else>💾 Lưu tuỳ chọn</span>
        </button>
        <button v-if="dirty" class="btn-ghost" @click="onReset">Huỷ</button>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { api } from '@/api/index';
import { playNotificationSound } from '@/utils/notification-sound';
import { setSoundEnabled } from '@/composables/use-notifications';

interface SourceState {
  key: string;
  enabled: boolean;
}

const SOURCE_META: Record<string, { icon: string; label: string; desc: string }> = {
  unreplied_chat: {
    icon: '💬',
    label: 'Tin nhắn chưa trả lời',
    desc: 'Cuộc trò chuyện chờ quá 30 phút chưa được phản hồi.',
  },
  incoming_message: {
    icon: '⚡',
    label: 'Tin nhắn đến tức thì',
    desc: 'Báo ngay khi khách hàng vừa nhắn tin (hội thoại 1-1, trong 5 phút).',
  },
  appointments: {
    icon: '📅',
    label: 'Lịch hẹn',
    desc: 'Lịch hẹn hôm nay và ngày mai với khách hàng.',
  },
  zalo_connection: {
    icon: '📱',
    label: 'Nick Zalo mất kết nối',
    desc: 'Cảnh báo nick rớt kết nối hoặc cần quét QR lại.',
  },
  security: {
    icon: '🛡️',
    label: 'Sự kiện bảo mật',
    desc: 'Truy cập trái phép bị chặn, nick riêng tư bị khoá (owner/admin).',
  },
  group_pending: {
    icon: '👥',
    label: 'Nhóm phụ trách chờ xử lý',
    desc: 'Nhóm Zalo bạn được phân công có tin nhắn chưa xử lý.',
  },
};

const sources = ref<SourceState[]>([]);
const soundOn = ref(true);
const loading = ref(true);
const dirty = ref(false);
const saving = ref(false);
// Bản gốc để nút Huỷ khôi phục
let original: SourceState[] = [];
let originalSound = true;
const meta = SOURCE_META;

function previewSound(): void {
  playNotificationSound();
}

async function fetchPrefs(): Promise<void> {
  const res = await api.get('/notifications/preferences');
  sources.value = res.data.sources;
  soundOn.value = res.data.sound !== false;
  original = sources.value.map((s) => ({ ...s }));
  originalSound = soundOn.value;
}

async function onSave(): Promise<void> {
  saving.value = true;
  try {
    await api.put('/notifications/preferences', {
      sources: Object.fromEntries(sources.value.map((s) => [s.key, s.enabled])),
      sound: soundOn.value,
    });
    original = sources.value.map((s) => ({ ...s }));
    originalSound = soundOn.value;
    dirty.value = false;
    // Composable đang chạy cập nhật ngay — không cần reload trang.
    setSoundEnabled(soundOn.value);
  } finally {
    saving.value = false;
  }
}

function onReset(): void {
  sources.value = original.map((s) => ({ ...s }));
  soundOn.value = originalSound;
  dirty.value = false;
}

onMounted(async () => {
  try {
    await fetchPrefs();
  } catch {
    // lỗi mạng → trang vẫn render rỗng, không crash
  } finally {
    loading.value = false;
  }
});
</script>

<style scoped>
.notif-page { max-width: 640px; }
.page-head { margin-bottom: 20px; }
.page-title { font-size: 1.25rem; font-weight: 700; margin-bottom: 4px; }
.page-desc { color: #888; font-size: 0.875rem; }

.loading { color: #888; padding: 24px 0; }

.source-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.section-title {
  margin-top: 14px;
  font-size: 0.78rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #999;
}
.link-btn {
  border: none;
  background: none;
  padding: 0;
  color: var(--color-primary, #1976d2);
  cursor: pointer;
  font-size: inherit;
  text-decoration: underline;
}
.source-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 16px;
  border: 1px solid var(--color-border, #e2e2e2);
  border-radius: 10px;
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease;
}
.source-row:hover { border-color: var(--color-primary, #1976d2); }

.source-info { display: flex; align-items: center; gap: 12px; }
.source-icon { font-size: 1.3rem; }
.source-label { font-weight: 600; font-size: 0.9rem; }
.source-desc { font-size: 0.78rem; color: #888; }

.switch {
  appearance: none;
  width: 40px;
  height: 22px;
  border-radius: 11px;
  background: #ccc;
  position: relative;
  cursor: pointer;
  transition: background 0.15s ease;
  flex-shrink: 0;
}
.switch::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: white;
  transition: left 0.15s ease;
}
.switch:checked { background: var(--color-primary, #1976d2); }
.switch:checked::after { left: 20px; }

.actions { margin-top: 20px; display: flex; gap: 10px; }

.btn-primary {
  padding: 9px 20px;
  border-radius: 8px;
  border: none;
  background: var(--color-primary, #1976d2);
  color: white;
  font-weight: 600;
  cursor: pointer;
}
.btn-primary:disabled { opacity: 0.5; cursor: default; }
.btn-ghost {
  padding: 9px 20px;
  border-radius: 8px;
  border: 1px solid var(--color-border, #ddd);
  background: transparent;
  cursor: pointer;
}
</style>
