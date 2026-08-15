<template>
  <v-menu v-if="!readonly" v-model="open" :close-on-content-click="true" location="bottom start">
    <template #activator="{ props: act }">
      <span
        v-bind="act"
        class="care-pill"
        :class="chipClass"
        :title="'Click để đổi trạng thái'"
      >
        {{ current.label }}<span class="caret">▾</span>
      </span>
    </template>
    <v-list density="compact" min-width="200" rounded="lg">
      <v-list-item
        v-for="opt in CARE_STATUSES"
        :key="opt.value"
        :title="opt.label"
        rounded="lg"
        :class="{ 'is-selected': opt.value === current.value }"
        @click="select(opt.value)"
      />
    </v-list>
  </v-menu>
  <span v-else class="care-pill" :class="chipClass">
    {{ current.label }}
  </span>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { CARE_STATUSES, type CareStatusValue } from '@/constants/care-status';

const props = defineProps<{
  modelValue: CareStatusValue | string | null | undefined;
  readonly?: boolean;
}>();
const emit = defineEmits<{ 'update:modelValue': [value: CareStatusValue] }>();

const open = ref(false);

const current = computed(() => {
  return CARE_STATUSES.find(s => s.value === props.modelValue) || CARE_STATUSES[0];
});
const chipClass = computed(() => `chip ${current.value.chip}`);

function select(value: CareStatusValue) {
  emit('update:modelValue', value);
  open.value = false;
}
</script>

<style scoped>
.care-pill {
  display: inline-flex; align-items: center; gap: 3px;
  padding: 3px 10px;
  border-radius: var(--radius-pill, 999px);
  font-size: 11px; font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  user-select: none;
  transition: filter 0.2s ease;
}
.care-pill .caret { font-size: 9px; opacity: 0.65; margin-left: 2px; }
.care-pill:hover { filter: brightness(0.97); }

/* Chip color variants — khớp utility global trong style.css,
   khai báo lại ở đây vì style scoped không nhìn thấy class global
   khi component được render trong teleport/menu. */
.chip-grey    { background: rgba(17, 24, 39, 0.06);   color: var(--smax-grey-700, #374151); }
.chip-cyan    { background: rgba(14, 165, 233, 0.12); color: #0369a1; }
.chip-info    { background: rgba(14, 165, 233, 0.14); color: #0369a1; }
.chip-purple  { background: rgba(139, 92, 246, 0.12); color: #6d28d9; }
.chip-warning { background: rgba(245, 158, 11, 0.16); color: #b45309; }
.chip-error   { background: rgba(239, 68, 68, 0.12);  color: #b91c1c; }
.chip-success { background: rgba(22, 163, 74, 0.14);  color: var(--smax-primary-hover, #15803d); }

.is-selected {
  background: var(--smax-primary-soft, #eaf7ef) !important;
  color: var(--smax-primary, #16a34a);
  font-weight: 600;
}
</style>
