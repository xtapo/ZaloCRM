<template>
  <div class="d-flex flex-column ga-3">
    <div v-for="(action, index) in modelValue" :key="index" class="pa-3 border rounded d-flex flex-column ga-2">
      <div class="d-flex ga-2 align-center flex-wrap">
        <v-select
          :model-value="action.type"
          :items="actionOptions"
          item-title="title"
          item-value="value"
          label="Hành động"
          density="comfortable"
          style="min-width: 220px"
          @update:model-value="changeActionType(index, $event)"
        />
        <v-btn icon variant="text" color="error" @click="removeAction(index)">
          <v-icon>mdi-delete</v-icon>
        </v-btn>
      </div>

      <template v-if="usersLoading && action.type === 'assign_user'">
        <v-skeleton-loader type="text" max-width="280" />
      </template>
      <v-select
        v-else-if="action.type === 'assign_user'"
        :model-value="action.userId || ''"
        :items="userItems"
        item-title="title"
        item-value="value"
        label="Gán cho user"
        density="comfortable"
        style="max-width: 320px"
        @update:model-value="updateAction(index, 'userId', $event)"
      />

      <v-select
        v-if="action.type === 'send_template'"
        :model-value="action.templateId || ''"
        :items="templateItems"
        item-title="title"
        item-value="value"
        label="Template"
        density="comfortable"
        style="max-width: 320px"
        @update:model-value="updateAction(index, 'templateId', $event)"
      />

      <v-select
        v-if="action.type === 'update_status'"
        :model-value="action.status || ''"
        :items="statusItems"
        item-title="label"
        item-value="value"
        label="Trạng thái mới"
        density="comfortable"
        style="max-width: 320px"
        @update:model-value="updateAction(index, 'status', $event)"
      />

      <template v-if="action.type === 'create_appointment'">
        <v-text-field
          :model-value="String(action.offsetHours ?? 24)"
          label="Số giờ sau trigger"
          density="comfortable"
          type="number"
          style="max-width: 220px"
          @update:model-value="updateNumericAction(index, 'offsetHours', $event)"
        />
        <v-text-field
          :model-value="action.typeLabel || ''"
          label="Loại lịch hẹn"
          density="comfortable"
          style="max-width: 320px"
          @update:model-value="updateAction(index, 'typeLabel', $event)"
        />
        <v-textarea
          :model-value="action.notes || ''"
          label="Ghi chú"
          rows="2"
          density="comfortable"
          style="max-width: 480px"
          @update:model-value="updateAction(index, 'notes', $event)"
        />
      </template>
    </div>

    <div>
      <v-btn variant="tonal" prepend-icon="mdi-plus" @click="addAction">Thêm hành động</v-btn>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api } from '@/api';
import { CONTACT_STATUSES } from '@/constants/contact-status';
import type { AutomationAction } from '@/composables/use-automation-rules';
import type { MessageTemplate } from '@/composables/use-message-templates';

const props = defineProps<{
  modelValue: AutomationAction[];
  templates: MessageTemplate[];
}>();

const emit = defineEmits<{
  'update:modelValue': [value: AutomationAction[]];
}>();

const actionOptions = [
  { title: 'Gán người phụ trách', value: 'assign_user' },
  { title: 'Gửi template', value: 'send_template' },
  { title: 'Đổi trạng thái contact', value: 'update_status' },
  { title: 'Tạo lịch hẹn', value: 'create_appointment' },
];

// Dùng chung bộ pipeline status — trước đây hardcode lệch với ContactsView.
const statusItems = CONTACT_STATUSES;

const usersLoading = ref(false);
const users = ref<Array<{ id: string; fullName: string; email: string; isActive: boolean }>>([]);

async function fetchUsers() {
  usersLoading.value = true;
  try {
    const res = await api.get('/users');
    users.value = res.data.users ?? [];
  } finally {
    usersLoading.value = false;
  }
}

const userItems = computed(() =>
  users.value
    .filter((u) => u.isActive)
    .map((u) => ({ title: u.fullName || u.email, value: u.id })),
);

const templateItems = computed(() => props.templates.map((template) => ({ title: template.name, value: template.id })));

function addAction() {
  emit('update:modelValue', [...props.modelValue, { type: 'update_status', status: 'contacted' }]);
}

// Đổi loại hành động → xóa field cũ của loại trước để không lưu rác
// (vd đổi từ assign_user sang update_status thì phải bỏ userId).
function changeActionType(index: number, nextType: string) {
  const current = props.modelValue[index];
  const cleaned: AutomationAction = { type: nextType };
  if (nextType === 'assign_user') cleaned.userId = current.userId;
  if (nextType === 'send_template') cleaned.templateId = current.templateId;
  if (nextType === 'update_status') cleaned.status = current.status ?? 'contacted';
  if (nextType === 'create_appointment') {
    cleaned.offsetHours = current.offsetHours ?? 24;
    cleaned.typeLabel = current.typeLabel;
    cleaned.notes = current.notes;
  }
  const next = props.modelValue.map((action, currentIndex) => (currentIndex === index ? cleaned : action));
  emit('update:modelValue', next);
}

function updateAction(index: number, key: keyof AutomationAction, value: unknown) {
  const next = props.modelValue.map((action, currentIndex) => (
    currentIndex === index ? { ...action, [key]: value } : action
  ));
  emit('update:modelValue', next);
}

function updateNumericAction(index: number, key: keyof AutomationAction, value: unknown) {
  updateAction(index, key, Number(value ?? 0));
}

function removeAction(index: number) {
  emit('update:modelValue', props.modelValue.filter((_, currentIndex) => currentIndex !== index));
}

onMounted(fetchUsers);
</script>
