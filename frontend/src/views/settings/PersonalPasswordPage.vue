<template>
  <div class="password-page">
    <div class="page-head">
      <h2 class="page-title">Đổi mật khẩu</h2>
      <p class="page-desc">Đặt mật khẩu mới cho tài khoản. Mật khẩu nên dài ≥8 ký tự, chứa chữ + số.</p>
    </div>

    <form class="password-form" @submit.prevent="onSubmit">
      <div class="form-row">
        <label for="new-pw">Mật khẩu mới</label>
        <input
          id="new-pw"
          v-model="newPassword"
          type="password"
          autocomplete="new-password"
          minlength="6"
          required
          placeholder="Tối thiểu 6 ký tự"
        />
      </div>
      <div class="form-row">
        <label for="confirm-pw">Xác nhận mật khẩu</label>
        <input
          id="confirm-pw"
          v-model="confirmPassword"
          type="password"
          autocomplete="new-password"
          required
          placeholder="Nhập lại mật khẩu mới"
        />
      </div>

      <div v-if="error" class="form-error">{{ error }}</div>
      <div v-if="success" class="form-success">✓ Đã đổi mật khẩu thành công</div>

      <div class="actions">
        <RouterLink to="/settings/personal/profile" class="btn-ghost">Huỷ</RouterLink>
        <button type="submit" class="btn-primary" :disabled="!canSubmit || saving">
          <span v-if="saving">Đang lưu...</span>
          <span v-else>💾 Đổi mật khẩu</span>
        </button>
      </div>
    </form>

    <div class="note">
      <strong>Lưu ý:</strong> Sau khi đổi mật khẩu, các phiên đăng nhập trên thiết bị khác có thể vẫn còn hiệu lực
      cho đến khi token hiện tại hết hạn. Vào <RouterLink to="/settings/personal/sessions">Phiên đăng nhập</RouterLink>
      để đăng xuất thiết bị khác (sắp ra mắt).
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { api } from '@/api/index';
import { useAuthStore } from '@/stores/auth';

const authStore = useAuthStore();

const newPassword = ref('');
const confirmPassword = ref('');
const saving = ref(false);
const error = ref('');
const success = ref(false);

const canSubmit = computed(() =>
  newPassword.value.length >= 6 &&
  newPassword.value === confirmPassword.value
);

async function onSubmit() {
  if (!canSubmit.value || !authStore.user) return;
  error.value = '';
  success.value = false;
  if (newPassword.value !== confirmPassword.value) {
    error.value = 'Mật khẩu xác nhận không khớp';
    return;
  }
  saving.value = true;
  try {
    await api.put(`/users/${authStore.user.id}/password`, { newPassword: newPassword.value });
    success.value = true;
    newPassword.value = '';
    confirmPassword.value = '';
  } catch (err: any) {
    error.value = err.response?.data?.error || 'Không thể đổi mật khẩu';
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped>
.password-page { max-width: 480px; font-family: inherit; }
.page-head { margin-bottom: 24px; }
.page-title { font-size: 20px; font-weight: 700; color: var(--smax-text, #1F2D3D); margin: 0 0 4px; }
.page-desc { font-size: 13px; color: var(--smax-text-muted, #6B7785); margin: 0; line-height: 1.5; }

.password-form {
  background: var(--smax-surface, white);
  border: 1px solid var(--smax-surface-border, #E4E5E9);
  border-radius: 12px;
  padding: 24px;
}
.form-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 16px;
}
.form-row label {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--smax-text-muted, #6B7785);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.form-row input {
  padding: 9px 12px;
  font-size: 14px;
  border: 1px solid var(--smax-surface-border, #E4E5E9);
  border-radius: 8px;
  outline: none;
  font-family: inherit;
  background: var(--smax-surface-muted, white);
  color: var(--smax-text, #1F2D3D);
}
.form-row input:focus {
  border-color: var(--smax-primary, #16a34a);
  box-shadow: 0 0 0 3px rgba(22, 163, 74, 0.15);
}

.form-error {
  font-size: 12.5px;
  color: #EF4444;
  background: #FEF2F2;
  padding: 8px 12px;
  border-radius: 6px;
  margin-bottom: 12px;
}
.form-success {
  font-size: 12.5px;
  color: #166534;
  background: #DCFCE7;
  padding: 8px 12px;
  border-radius: 6px;
  margin-bottom: 12px;
}

.actions {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
  margin-top: 8px;
}
.btn-ghost,
.btn-primary {
  padding: 9px 18px;
  font-size: 13px;
  font-weight: 500;
  border-radius: 8px;
  border: 1px solid var(--smax-surface-border, #E4E5E9);
  background: var(--smax-surface, white);
  color: var(--smax-text, #1F2D3D);
  cursor: pointer;
  font-family: inherit;
  text-decoration: none;
}
.btn-primary {
  background: var(--smax-primary, #16a34a);
  border-color: var(--smax-primary, #16a34a);
  color: white;
}
.btn-primary:hover:not(:disabled) { background: var(--smax-primary-hover, #15803d); border-color: var(--smax-primary-hover, #15803d); }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-ghost:hover { background: var(--smax-surface-muted, #F4F4F7); }

.note {
  margin-top: 16px;
  padding: 12px 16px;
  background: var(--smax-surface-muted, #FAFAFC);
  border-left: 3px solid var(--smax-primary, #16a34a);
  border-radius: 6px;
  font-size: 12.5px;
  color: var(--smax-text-muted, #6B7785);
  line-height: 1.55;
}
.note a {
  color: var(--smax-primary, #16a34a);
  text-decoration: none;
  font-weight: 500;
}
.note a:hover { text-decoration: underline; }
</style>
