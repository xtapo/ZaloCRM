<template>
  <v-dialog :model-value="modelValue" max-width="560" @update:model-value="v => $emit('update:modelValue', v)">
    <v-card>
      <v-card-title class="d-flex align-center">
        <v-icon class="mr-2">mdi-tag-multiple-outline</v-icon>
        Quản lý CRM — {{ displayTitle }}
      </v-card-title>

      <v-card-text v-if="form">
        <v-text-field
          v-model="form.crmName"
          label="Tên hiển thị (CRM)"
          placeholder="Để trống để dùng tên Zalo"
          variant="outlined"
          density="compact"
          hide-details
          class="mb-3"
        />

        <v-select
          v-model="form.assignedUserId"
          :items="userOptions"
          item-title="label"
          item-value="value"
          label="Nhân viên phụ trách"
          variant="outlined"
          density="compact"
          clearable
          hide-details
          class="mb-3"
          :loading="usersLoading"
        />

        <!-- Tags: chip input -->
        <div class="text-caption text-grey mb-1">Tags</div>
        <div class="d-flex flex-wrap align-center gap-1 pa-2 rounded border mb-2">
          <v-chip
            v-for="tag in form.tags"
            :key="tag"
            closable
            size="small"
            color="primary"
            variant="tonal"
            @click:close="removeTag(tag)"
          >
            {{ tag }}
          </v-chip>
          <v-text-field
            v-model="newTag"
            placeholder="Thêm tag + Enter"
            variant="plain"
            density="compact"
            hide-details
            class="flex-1-1 tag-input"
            @keydown.enter.prevent="addTag"
          />
        </div>

        <v-textarea
          v-model="form.notes"
          label="Ghi chú về nhóm"
          variant="outlined"
          density="compact"
          rows="3"
          hide-details
        />
      </v-card-text>

      <v-card-actions class="px-4 pb-4">
        <v-spacer />
        <v-btn variant="text" @click="$emit('update:modelValue', false)">Huỷ</v-btn>
        <v-btn color="primary" :loading="saving" @click="save">Lưu</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useUsers } from '@/composables/use-users';
import type { CrmProfile } from '@/composables/use-groups';

const props = defineProps<{
  modelValue: boolean;
  groupId: string;
  groupName?: string;
  profile?: CrmProfile | null;
}>();

const emit = defineEmits<{
  'update:modelValue': [v: boolean];
  save: [payload: { crmName: string | null; notes: string | null; tags: string[]; assignedUserId: string | null }];
}>();

const { users, loading: usersLoading, fetchUsers } = useUsers();

const form = ref<{ crmName: string; notes: string; tags: string[]; assignedUserId: string | null } | null>(null);
const newTag = ref('');
const saving = ref(false);
// Track users đã load để không fetch lặp
let usersFetched = false;

const userOptions = computed(() => [
  { label: '— Không phụ trách —', value: null as unknown as string },
  ...users.value.map(u => ({ label: `${u.fullName}${u.team ? ` (${u.team.name})` : ''}`, value: u.id })),
]);

const displayTitle = computed(() =>
  props.profile?.crmName || props.groupName || 'nhóm',
);

watch(() => props.modelValue, open => {
  if (!open) return;
  // Sync form từ profile hiện tại mỗi lần mở
  form.value = {
    crmName: props.profile?.crmName ?? '',
    notes: props.profile?.notes ?? '',
    tags: [...(props.profile?.tags ?? [])],
    assignedUserId: props.profile?.assignedUserId ?? null,
  };
  if (!usersFetched) {
    void fetchUsers().then(() => { usersFetched = true; });
  }
});

function addTag() {
  const t = newTag.value.trim();
  if (!t || !form.value) return;
  if (!form.value.tags.includes(t)) form.value.tags.push(t);
  newTag.value = '';
}

function removeTag(tag: string) {
  if (!form.value) return;
  form.value.tags = form.value.tags.filter(t => t !== tag);
}

async function save() {
  if (!form.value) return;
  saving.value = true;
  try {
    emit('save', {
      crmName: form.value.crmName.trim() || null,
      notes: form.value.notes.trim() || null,
      tags: [...form.value.tags],
      assignedUserId: form.value.assignedUserId || null,
    });
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped>
.tag-input :deep(input) {
  min-width: 120px;
}
.gap-1 { gap: 4px; }
</style>
