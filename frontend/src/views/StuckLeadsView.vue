<template>
  <div class="stuck-view">
    <header class="stuck-header">
      <button class="back-btn" @click="$router.back()">← Quay lại</button>
      <h1>
        🚨 Khách hàng đình trệ
        <span v-if="data && data.totalStuck > 0" class="count-badge">{{ data.totalStuck }}</span>
      </h1>
      <div class="stuck-search">
        <input
          v-model="searchQuery"
          type="search"
          placeholder="🔍 Tìm theo tên KH, SĐT, stage..."
          class="search-input"
        />
        <button v-if="searchQuery" class="clear-search" @click="searchQuery = ''" title="Xoá tìm kiếm">✕</button>
      </div>
      <div class="stuck-actions">
        <button class="refresh-btn" :disabled="loading" @click="loadData">
          {{ loading ? '⏳' : '🔄' }} Làm mới
        </button>
        <button class="scan-btn" :disabled="scanning" @click="triggerScan">
          {{ scanning ? '⏳ Đang quét…' : '🔍 Quét lại ngay' }}
        </button>
      </div>
    </header>

    <div v-if="loading && !data" class="loading">⏳ Đang tải…</div>

    <div v-else-if="error" class="error">⚠️ {{ error }}</div>

    <div v-else-if="data && data.totalStuck === 0" class="empty">
      <div class="empty-icon">🎉</div>
      <h2>Chưa có KH đình trệ nào</h2>
      <p>Pipeline đang chạy mượt. Tiếp tục nhé!</p>
    </div>

    <div v-else-if="data" class="stuck-banner">
      <div class="banner-content">
        <strong>🚨 {{ data.totalStuck }} KH cần xứ lý hôm nay</strong>
        <p>Click vào KH để mở chat, hoặc bấm "Gửi mẫu" để dùng template gợi ý.</p>
      </div>
    </div>

    <div v-if="data && filteredByStage.length === 0 && searchQuery" class="empty">
      <div class="empty-icon">🔎</div>
      <h2>Không tìm thấy KH phù hợp</h2>
      <p>Thử từ khoá khác hoặc bấm ✕ để xoá tìm kiếm.</p>
    </div>

    <div v-if="data && filteredByStage.length > 0" class="stage-groups">
      <section v-for="group in filteredByStage" :key="group.stage" class="stage-group">
        <header class="stage-header" :style="{ borderLeftColor: group.color || '#6B7280' }">
          <span class="stage-chip" :style="{ backgroundColor: group.color || '#6B7280' }">
            {{ group.stage }}
          </span>
          <span class="stage-meta">
            {{ group.friends.length }} KH đình trệ > {{ group.thresholdDays }} ngày
          </span>
          <span class="alert-label">{{ group.alertLabel }}</span>
        </header>

        <div class="friends-list">
          <div v-for="f in group.friends" :key="f.friendId" class="friend-row">
            <div class="friend-avatar">
              <img v-if="f.contactAvatar" :src="f.contactAvatar" :alt="f.contactName" />
              <span v-else class="avatar-placeholder">{{ initials(f.contactName) }}</span>
            </div>
            <div class="friend-main">
              <div class="friend-name-row">
                <strong class="friend-name">{{ f.contactName }}</strong>
                <span v-for="tag in f.autoTags" :key="tag" class="auto-tag" :class="`tag-${tag}`">
                  {{ tagIcon(tag) }} {{ tagLabel(tag) }}
                </span>
              </div>
              <div class="friend-meta">
                Điểm <strong>{{ f.score }}</strong>
                · Đình trệ {{ f.daysInStage }} ngày
                <span v-if="f.daysSinceLastInbound != null">
                  · Tin nhắn cuối {{ f.daysSinceLastInbound }} ngày trước
                </span>
              </div>
              <div v-if="group.nbaTemplate" class="suggest-box">
                💡 {{ group.alertLabel }}
              </div>
            </div>
            <div class="friend-actions">
              <button
                class="btn-primary"
                :title="group.nbaTemplate?.label || 'Gửi tin nhắn gợi ý'"
                @click="sendNbaTemplate(f, group)"
              >
                📤 Gửi mẫu
              </button>
              <button class="btn-secondary" @click="openChat(f)">💬 Mở chat</button>
              <button class="btn-ghost" @click="snooze(f)">⏸ Hoãn 3d</button>
            </div>
          </div>
        </div>
      </section>
    </div>

    <!-- Toast feedback -->
    <div v-if="toast" class="toast" :class="toast.type">{{ toast.message }}</div>

    <!-- Template preview modal -->
    <div v-if="previewTemplate" class="modal-overlay" @click.self="previewTemplate = null">
      <div class="modal-card">
        <header class="modal-header">
          <h3>📤 Gửi tin nhắn gợi ý</h3>
          <button class="modal-close" @click="previewTemplate = null">×</button>
        </header>
        <div class="modal-body">
          <label class="modal-label">Tin nhắn (đã điền tên KH):</label>
          <textarea v-model="previewContent" rows="6" class="modal-textarea"></textarea>
          <p class="modal-hint">
            Em sẽ chuyển hướng sang chat để bạn copy/paste hoặc gửi trực tiếp.
            Phiên bản kế tiếp sẽ tự động gửi qua Zalo.
          </p>
        </div>
        <footer class="modal-footer">
          <button class="btn-secondary" @click="previewTemplate = null">Huỷ</button>
          <button class="btn-primary" @click="confirmSendTemplate">
            Mở chat với template
          </button>
        </footer>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useScoring, type StuckLeadsResponse, type StuckStageGroup, type StuckFriend } from '@/composables/use-scoring';
import { api } from '@/api/index';

const router = useRouter();
const scoring = useScoring();

const data = ref<StuckLeadsResponse | null>(null);
const loading = ref(false);

// Phase 6 polish P2 quick win — Search box trong Stuck Dashboard
// Filter client-side qua contactName / phone / stage. Search rỗng → show all.
const searchQuery = ref('');
const filteredByStage = computed<StuckStageGroup[]>(() => {
  if (!data.value) return [];
  const q = searchQuery.value.trim().toLowerCase();
  if (!q) return data.value.byStage;
  return data.value.byStage
    .map((group) => {
      const stageMatch = group.stage.toLowerCase().includes(q);
      const matchedFriends = group.friends.filter((f) => {
        if (stageMatch) return true;
        const name = (f.contactName || '').toLowerCase();
        const phone = (f.phone || '').toLowerCase();
        return name.includes(q) || phone.includes(q);
      });
      return { ...group, friends: matchedFriends };
    })
    .filter((g) => g.friends.length > 0);
});
const scanning = ref(false);
const error = ref<string | null>(null);
const toast = ref<{ type: 'success' | 'error'; message: string } | null>(null);

const previewTemplate = ref<{ friend: StuckFriend; group: StuckStageGroup } | null>(null);
const previewContent = ref('');

const TAG_LABELS: Record<string, string> = {
  active: 'Hoạt động',
  cooling: 'Đang nguội',
  cold: 'Nguội',
  frozen: 'Đóng băng',
  rewarmed: 'Ấm trở lại',
  stuck: 'Đình trệ',
  ready: 'Sẵn sàng chốt',
  atrisk: 'Có nguy cơ',
};

const TAG_ICONS: Record<string, string> = {
  active: '🔥',
  cooling: '❄️',
  cold: '🧊',
  frozen: '🥶',
  rewarmed: '🔄',
  stuck: '⏰',
  ready: '💯',
  atrisk: '🚧',
};

function initials(name: string): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function tagLabel(tag: string): string {
  return TAG_LABELS[tag] || tag;
}

function tagIcon(tag: string): string {
  return TAG_ICONS[tag] || '🏷️';
}

async function loadData() {
  loading.value = true;
  error.value = null;
  try {
    data.value = await scoring.getStuckLeads();
  } catch (err: any) {
    error.value = err?.response?.data?.error || err?.message || 'Không tải được dữ liệu';
  } finally {
    loading.value = false;
  }
}

async function triggerScan() {
  scanning.value = true;
  try {
    const result = await scoring.scanStuckNow();
    showToast(
      'success',
      `Đã quét ${result.scanned} KH. ${result.newlyStuck} mới đình trệ, ${result.unstuck} hết đình trệ.`
    );
    await loadData();
  } catch (err: any) {
    showToast('error', 'Quét thất bại: ' + (err?.message || 'unknown'));
  } finally {
    scanning.value = false;
  }
}

function showToast(type: 'success' | 'error', message: string) {
  toast.value = { type, message };
  setTimeout(() => {
    toast.value = null;
  }, 3000);
}

function sendNbaTemplate(friend: StuckFriend, group: StuckStageGroup) {
  if (!group.nbaTemplate) {
    showToast('error', 'Chưa cấu hình template cho stage này');
    return;
  }
  previewTemplate.value = { friend, group };
  // Fill placeholders
  let content = group.nbaTemplate.contentTemplate;
  content = content.replace(/\{\{customerName\}\}/g, friend.contactName);
  content = content.replace(/\{\{projectName\}\}/g, 'dự án');
  content = content.replace(/\{\{promoMonth\}\}/g, 'ưu đãi tháng này');
  content = content.replace(/\{\{viewingLink\}\}/g, '');
  content = content.replace(/\{\{callTime\}\}/g, '');
  content = content.replace(/\{\{progressUpdate\}\}/g, '');
  content = content.replace(/\{\{unitInfo\}\}/g, '');
  content = content.replace(/\{\{priceInfo\}\}/g, '');
  previewContent.value = content;
}

async function confirmSendTemplate() {
  if (!previewTemplate.value) return;
  const friendId = previewTemplate.value.friend.friendId;
  const templateKey = previewTemplate.value.group.nbaTemplate?.key ?? null;
  const content = previewContent.value.trim();
  if (!content) { showToast('error', 'Nội dung rỗng'); return; }

  // Phase 6 polish P1 — gửi trực tiếp qua API thay copy clipboard.
  // BE: POST /leads/stuck/send-template { friendId, templateKey, overrideContent }
  //     → resolve conversation → render variables + markdown → sendMessage Zalo
  try {
    const res = await api.post('/leads/stuck/send-template', {
      friendId,
      templateKey,
      overrideContent: content,
    });
    if (res?.data?.ok) {
      const cId = previewTemplate.value.friend.contactId;
      previewTemplate.value = null;
      showToast('success', '✅ Đã gửi tin nhắn cho KH');
      // Optional: open chat để sale theo dõi rep
      doOpenChat(friendId, cId);
    } else {
      showToast('error', 'Gửi thất bại — kiểm tra connection nick Zalo');
    }
  } catch (err: any) {
    const msg = err?.response?.data?.error || err?.message || 'unknown';
    const detail = err?.response?.data?.message;
    if (msg === 'no_conversation') {
      // KH chưa từng chat — fallback clipboard + open chat
      if (navigator.clipboard) navigator.clipboard.writeText(content).catch(() => {});
      const cId = previewTemplate.value?.friend.contactId;
      previewTemplate.value = null;
      showToast('success', 'KH chưa có hội thoại. Đã copy nội dung — mở chat để gửi.');
      doOpenChat(friendId, cId);
    } else if (msg === 'rate_limited') {
      showToast('error', `🚫 ${detail || 'Đã đạt giới hạn nhắn tin hôm nay'}`);
    } else if (msg === 'nick_disconnected') {
      showToast('error', '⚠ Nick Zalo của KH đang ngắt kết nối — reconnect lại trước');
    } else {
      showToast('error', `Lỗi: ${msg}`);
    }
  }
}

async function doOpenChat(friendId: string, contactId?: string) {
  try {
    const res = await api.post(`/friends/${friendId}/ensure-conversation`, {});
    if (res.data?.conversationId) {
      router.push({ name: 'Chat', params: { convId: res.data.conversationId } });
      return;
    }
  } catch (err) {
    console.error('[StuckLeads] ensure-conversation failed:', err);
  }
  if (contactId) {
    router.push(`/chat?contactId=${contactId}`);
  }
}

function openChat(f: StuckFriend) {
  doOpenChat(f.friendId, f.contactId);
}

function snooze(f: StuckFriend) {
  // v1: chỉ ẩn UI local 3 ngày qua localStorage
  const key = `snooze:stuck:${f.friendId}`;
  const until = Date.now() + 3 * 24 * 60 * 60 * 1000;
  try {
    localStorage.setItem(key, String(until));
  } catch {
    /* ignore */
  }
  showToast('success', `Đã hoãn ${f.contactName} 3 ngày`);
  // Filter out from current view
  if (data.value) {
    for (const grp of data.value.byStage) {
      grp.friends = grp.friends.filter((x) => x.friendId !== f.friendId);
    }
    data.value.totalStuck = data.value.byStage.reduce((s, g) => s + g.friends.length, 0);
  }
}

onMounted(loadData);
</script>

<style scoped>
/* Soft-UI xanh lá — token lấy từ style.css (có fallback để an toàn) */
.stuck-view {
  max-width: 1200px;
  margin: 0 auto;
  padding: 24px;
}

.stuck-header {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 24px;
  flex-wrap: wrap;
}
.stuck-header h1 {
  font-family: var(--font-heading, 'Plus Jakarta Sans', sans-serif);
  font-size: 24px;
  letter-spacing: -0.02em;
  margin: 0;
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--smax-text, #111827);
}
.count-badge {
  background: var(--smax-error, #ef4444);
  color: white;
  font-size: 14px;
  padding: 2px 12px;
  border-radius: var(--radius-pill, 999px);
  font-weight: 700;
}
.back-btn,
.refresh-btn,
.scan-btn {
  background: var(--smax-surface, #fff);
  border: none;
  padding: 9px 16px;
  border-radius: var(--radius-pill, 999px);
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
  color: var(--smax-text, #111827);
  box-shadow: var(--shadow-xs, 0 1px 2px rgba(17, 24, 39, 0.04));
  transition: all 0.2s ease;
}
.back-btn:hover,
.refresh-btn:hover {
  background: var(--smax-primary-soft, #eaf7ef);
  color: var(--smax-primary-hover, #15803d);
}
.scan-btn {
  background: var(--smax-primary, #16a34a);
  color: white;
  box-shadow: var(--shadow-glow, 0 10px 24px -8px rgba(22, 163, 74, 0.18));
}
.scan-btn:hover {
  background: var(--smax-primary-hover, #15803d);
  color: white;
}
.scan-btn:disabled,
.refresh-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.stuck-actions {
  display: flex;
  gap: 8px;
}

/* Phase 6 polish — Search box trong Stuck Dashboard */
.stuck-search {
  position: relative;
  flex: 1;
  max-width: 360px;
  margin: 0 12px;
}
.search-input {
  width: 100%;
  height: 40px;
  padding: 0 34px 0 16px;
  border: none;
  border-radius: var(--radius-pill, 999px);
  font-size: 13px;
  background: var(--smax-surface, #fff);
  color: var(--smax-text, #111827);
  outline: none;
  box-shadow: var(--shadow-xs, 0 1px 2px rgba(17, 24, 39, 0.04));
  transition: box-shadow 0.15s ease;
}
.search-input:focus {
  box-shadow: 0 0 0 3px rgba(22, 163, 74, 0.15);
}
.search-input::placeholder { color: var(--smax-text-subtle, #9ca3af); }
.clear-search {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  background: transparent;
  border: none;
  font-size: 15px;
  color: var(--smax-text-muted, #6b7280);
  cursor: pointer;
  padding: 4px 8px;
  border-radius: var(--radius-pill, 999px);
}
.clear-search:hover {
  color: var(--smax-primary-hover, #15803d);
  background: var(--smax-primary-soft, #eaf7ef);
}

.loading,
.error,
.empty {
  background: var(--smax-surface, #fff);
  border-radius: var(--radius-xl, 24px);
  box-shadow: var(--shadow-sm, 0 2px 8px rgba(17, 24, 39, 0.04));
  padding: 48px;
  text-align: center;
  color: var(--smax-text-muted, #6b7280);
}
.empty-icon {
  font-size: 48px;
  margin-bottom: 12px;
}
.empty h2 {
  font-family: var(--font-heading, 'Plus Jakarta Sans', sans-serif);
  margin: 0 0 8px;
  color: var(--smax-text, #111827);
}

.stuck-banner {
  background: linear-gradient(135deg, rgba(245, 158, 11, 0.14), rgba(239, 68, 68, 0.12));
  border-left: 4px solid var(--smax-error, #ef4444);
  padding: 16px 20px;
  border-radius: var(--radius-lg, 20px);
  margin-bottom: 16px;
}
.stuck-banner strong {
  font-size: 16px;
  color: #991b1b;
}
.stuck-banner p {
  margin: 4px 0 0;
  font-size: 13px;
  color: #7f1d1d;
}

.stage-groups {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.stage-group {
  background: var(--smax-surface, #fff);
  border-radius: var(--radius-xl, 24px);
  overflow: hidden;
  box-shadow: var(--shadow-sm, 0 2px 8px rgba(17, 24, 39, 0.04));
  transition: box-shadow 0.25s ease;
}
.stage-group:hover {
  box-shadow: var(--shadow-md, 0 6px 18px rgba(17, 24, 39, 0.06));
}
.stage-header {
  padding: 14px 18px;
  background: var(--smax-surface-muted, #f6f8f7);
  border-bottom: 1px solid rgba(17, 24, 39, 0.04);
  border-left: 4px solid var(--smax-text-muted, #6b7280);
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.stage-chip {
  padding: 4px 12px;
  border-radius: var(--radius-pill, 999px);
  font-size: 12px;
  font-weight: 700;
  color: white;
}
.stage-meta {
  font-size: 13px;
  color: var(--smax-text-muted, #6b7280);
}
.alert-label {
  font-size: 12px;
  color: var(--smax-text-muted, #6b7280);
  font-style: italic;
  margin-left: auto;
}

.friends-list {
  padding: 0;
}
.friend-row {
  display: grid;
  grid-template-columns: 40px 1fr auto;
  gap: 12px;
  padding: 14px 18px;
  border-bottom: 1px solid rgba(17, 24, 39, 0.04);
  align-items: center;
  transition: background 0.15s ease;
}
.friend-row:hover {
  background: var(--smax-primary-soft, #eaf7ef);
}
.friend-row:last-child {
  border-bottom: none;
}
.friend-avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: linear-gradient(135deg, #4ade80, #15803d);
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-weight: 600;
  font-size: 14px;
  overflow: hidden;
}
.friend-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.friend-main {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.friend-name-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.friend-name {
  font-size: 14px;
  color: var(--smax-text, #111827);
}
.auto-tag {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 10px;
  border-radius: var(--radius-pill, 999px);
  font-size: 11px;
  font-weight: 600;
}
/* Đồng bộ với constants/auto-tags.ts */
.tag-active { background: rgba(22, 163, 74, 0.14); color: #15803d; }
.tag-ready { background: rgba(21, 128, 61, 0.14); color: #0f6b34; }
.tag-cooling { background: rgba(56, 189, 248, 0.16); color: #0369a1; }
.tag-cold { background: rgba(14, 165, 233, 0.14); color: #0369a1; }
.tag-frozen { background: rgba(3, 105, 161, 0.12); color: #0c4a6e; }
.tag-rewarmed { background: rgba(245, 158, 11, 0.16); color: #b45309; }
.tag-stuck { background: rgba(249, 115, 22, 0.16); color: #c2410c; }
.tag-atrisk { background: rgba(239, 68, 68, 0.14); color: #b91c1c; }

.friend-meta {
  font-size: 12px;
  color: var(--smax-text-muted, #6b7280);
}

.suggest-box {
  background: var(--smax-primary-soft, #eaf7ef);
  border: 1px solid rgba(22, 163, 74, 0.18);
  border-radius: var(--radius-sm, 12px);
  padding: 6px 12px;
  margin-top: 4px;
  font-size: 12px;
  color: var(--smax-primary-hover, #15803d);
}

.friend-actions {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.btn-primary,
.btn-secondary,
.btn-ghost {
  border: none;
  padding: 7px 14px;
  border-radius: var(--radius-pill, 999px);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.2s ease;
}
.btn-primary {
  background: var(--smax-primary, #16a34a);
  color: white;
}
.btn-primary:hover {
  background: var(--smax-primary-hover, #15803d);
}
.btn-secondary {
  background: var(--smax-surface-muted, #f6f8f7);
  color: var(--smax-grey-700, #374151);
}
.btn-secondary:hover {
  background: var(--smax-primary-soft, #eaf7ef);
  color: var(--smax-primary-hover, #15803d);
}
.btn-ghost {
  background: transparent;
  color: var(--smax-text-muted, #6b7280);
}
.btn-ghost:hover {
  color: var(--smax-text, #111827);
}

.toast {
  position: fixed;
  top: 24px;
  right: 24px;
  background: var(--smax-text, #111827);
  color: white;
  padding: 12px 20px;
  border-radius: var(--radius-sm, 12px);
  font-size: 13px;
  box-shadow: var(--shadow-lg, 0 14px 34px rgba(17, 24, 39, 0.08));
  z-index: 9999;
  animation: slideIn 0.2s;
}
.toast.success {
  background: var(--smax-primary, #16a34a);
}
.toast.error {
  background: var(--smax-error, #ef4444);
}
@keyframes slideIn {
  from { transform: translateX(120%); }
  to { transform: translateX(0); }
}

.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(17, 24, 39, 0.45);
  backdrop-filter: blur(2px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.modal-card {
  background: var(--smax-surface, white);
  color: var(--smax-text, #111827);
  border: 1px solid var(--smax-surface-border, rgba(17, 24, 39, 0.08));
  border-radius: var(--radius-xl, 24px);
  width: 90%;
  max-width: 520px;
  overflow: hidden;
  box-shadow: var(--shadow-lg, 0 14px 34px rgba(17, 24, 39, 0.08));
}
.modal-header {
  padding: 18px 22px;
  border-bottom: 1px solid var(--smax-surface-border, rgba(17, 24, 39, 0.06));
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.modal-header h3 {
  font-family: var(--font-heading, 'Plus Jakarta Sans', sans-serif);
  margin: 0;
  font-size: 16px;
  color: var(--smax-text, #111827);
}
.modal-close {
  border: none;
  background: transparent;
  font-size: 24px;
  cursor: pointer;
  color: var(--smax-text-subtle, #9ca3af);
}
.modal-close:hover { color: var(--smax-text, #111827); }
.modal-body {
  padding: 18px 22px;
}
.modal-label {
  display: block;
  font-size: 12px;
  font-weight: 600;
  color: var(--smax-text-muted, #6b7280);
  margin-bottom: 8px;
}
.modal-textarea {
  width: 100%;
  border: 1px solid var(--smax-surface-border, rgba(17, 24, 39, 0.1));
  border-radius: var(--radius-sm, 12px);
  padding: 12px;
  font-family: inherit;
  font-size: 13px;
  background: var(--smax-surface-muted, #f8fafc);
  color: var(--smax-text, #111827);
  resize: vertical;
  outline: none;
}
.modal-textarea:focus {
  border-color: var(--smax-primary, #16a34a);
  box-shadow: 0 0 0 3px rgba(22, 163, 74, 0.12);
}
.modal-hint {
  font-size: 11px;
  color: var(--smax-text-subtle, #9ca3af);
  margin-top: 8px;
}
.modal-footer {
  padding: 14px 22px;
  border-top: 1px solid var(--smax-surface-border, rgba(17, 24, 39, 0.06));
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
