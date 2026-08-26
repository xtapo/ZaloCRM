<script setup lang="ts">
// Chọn chiến lược chia variant A/B cho block có nhiều variants:
// - random: mỗi lần chạy chọn ngẫu nhiên (mặc định, chống spam-detect)
// - even_split: chia đều theo hash taskId — retries giữ nguyên variant
import type { VariantStrategy } from '@/api/automation/types';

const model = defineModel<VariantStrategy>({ required: true });

const items = [
  { value: 'random' as const, title: 'Ngẫu nhiên (random)', hint: 'Mỗi task chọn 1 variant ngẫu nhiên' },
  { value: 'even_split' as const, title: 'Chia đều A/B (even split)', hint: 'Chia đều theo taskId — retry không đổi variant' },
];
</script>

<template>
  <v-select
    v-model="model"
    :items="items"
    item-title="title"
    item-value="value"
    label="Chiến lược chia variant"
    variant="outlined"
    density="comfortable"
    hint="Chỉ có tác dụng khi block có từ 2 variant trở lên"
    persistent-hint
  >
    <template #item="{ props: itemProps }">
      <v-list-item v-bind="itemProps" />
    </template>
  </v-select>
</template>
