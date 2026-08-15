<template>
  <Teleport to="body">
    <div class="toast-container">
      <TransitionGroup name="toast">
        <div
          v-for="t in items"
          :key="t.id"
          class="toast"
          :class="t.type"
        >
          <span class="toast-msg" @click="!t.action && dismiss(t.id)">{{ t.message }}</span>
          <button
            v-if="t.action"
            class="toast-action"
            @click="onAction(t)"
          >{{ t.action.label }}</button>
          <button
            v-if="t.action"
            class="toast-close"
            title="Đóng"
            @click="dismiss(t.id)"
          >×</button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { useToast, type ToastItem } from '@/composables/use-toast';

const { items, dismiss } = useToast();

async function onAction(t: ToastItem) {
  if (!t.action) return;
  try {
    await t.action.handler();
  } catch (err) {
    console.error('[toast-action] handler error', err);
  }
}
</script>

<style scoped>
.toast-container {
  position: fixed;
  bottom: 20px; right: 20px;
  display: flex; flex-direction: column-reverse; gap: 8px;
  z-index: 9999;
  pointer-events: none;
}
.toast {
  background: #111827;
  color: white;
  padding: 11px 16px;
  border-radius: 14px;
  font-size: 13px;
  box-shadow: 0 14px 34px rgba(17, 24, 39, 0.18);
  pointer-events: auto;
  max-width: 460px;
  border-left: 3px solid rgba(255, 255, 255, 0.25);
  word-wrap: break-word;
  display: flex;
  align-items: center;
  gap: 10px;
}
/* Fallback hex để không phụ thuộc token cũ (--smax-success/warning/error đã bỏ) */
.toast.success { border-left-color: var(--smax-primary, #16a34a); }
.toast.warning { border-left-color: #f59e0b; }
.toast.error   { border-left-color: #ef4444; }

.toast-msg {
  flex: 1;
  cursor: pointer;
}
.toast-action {
  background: rgba(34, 197, 94, 0.22);
  color: #86efac;
  border: none;
  padding: 5px 14px;
  border-radius: 9999px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  letter-spacing: 0.2px;
  flex-shrink: 0;
}
.toast-action:hover { background: rgba(34, 197, 94, 0.4); color: #ffffff; }
.toast-close {
  background: transparent;
  border: none;
  color: rgba(255, 255, 255, 0.5);
  font-size: 18px;
  cursor: pointer;
  padding: 0 4px;
  line-height: 1;
  flex-shrink: 0;
}
.toast-close:hover { color: #fff; }

.toast-enter-active,
.toast-leave-active { transition: all 0.25s ease; }
.toast-enter-from   { opacity: 0; transform: translateX(60%); }
.toast-leave-to     { opacity: 0; transform: translateX(60%); }
</style>
