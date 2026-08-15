<template>
  <div class="tag-chip-list">
    <span v-for="tag in modelValue" :key="tag" class="tag-chip" :class="chipClass">
      {{ tag }}
      <span v-if="!readonly" class="x" @click="remove(tag)">×</span>
    </span>

    <input
      v-if="adding"
      v-model="draft"
      ref="input"
      class="tag-input"
      :placeholder="placeholder"
      @keydown.enter="commit"
      @keydown.escape="cancel"
      @blur="commit"
    />
    <button
      v-else-if="!readonly"
      class="tag-chip add"
      @click="startAdd"
    >+ {{ addLabel }}</button>

    <span v-if="!modelValue.length && readonly" class="empty">—</span>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick } from 'vue';

const props = withDefaults(defineProps<{
  modelValue: string[];
  readonly?: boolean;
  chipClass?: string;
  placeholder?: string;
  addLabel?: string;
}>(), {
  readonly: false,
  chipClass: 'chip-grey',
  placeholder: 'Tag mới…',
  addLabel: 'Thêm',
});

const emit = defineEmits<{ 'update:modelValue': [tags: string[]] }>();

const adding = ref(false);
const draft = ref('');
const input = ref<HTMLInputElement | null>(null);

function startAdd() {
  adding.value = true;
  draft.value = '';
  nextTick(() => input.value?.focus());
}
function commit() {
  const t = draft.value.trim();
  if (t && !props.modelValue.includes(t)) {
    emit('update:modelValue', [...props.modelValue, t]);
  }
  adding.value = false;
  draft.value = '';
}
function cancel() {
  adding.value = false;
  draft.value = '';
}
function remove(tag: string) {
  emit('update:modelValue', props.modelValue.filter(t => t !== tag));
}
</script>

<style scoped>
.tag-chip-list {
  display: flex; flex-wrap: wrap; gap: 4px;
  align-items: center;
}
.tag-chip {
  padding: 3px 10px;
  border-radius: var(--radius-pill, 999px);
  font-size: 11px;
  font-weight: 600;
  display: inline-flex; align-items: center; gap: 4px;
}
.chip-grey    { background: rgba(17, 24, 39, 0.06);   color: var(--smax-grey-700, #374151); }
.chip-info    { background: rgba(14, 165, 233, 0.12); color: #0369a1; }
.chip-zalo    { background: rgba(245, 158, 11, 0.16); color: #b45309; }
.chip-success { background: rgba(22, 163, 74, 0.14);  color: var(--smax-primary-hover, #15803d); }

.tag-chip .x {
  cursor: pointer;
  opacity: 0.55;
  font-weight: 700;
}
.tag-chip .x:hover { opacity: 1; color: var(--smax-error, #ef4444); }

.tag-chip.add {
  background: transparent;
  border: 1px dashed var(--smax-grey-300, #d1d5db);
  color: var(--smax-grey-700, #374151);
  cursor: pointer;
  padding: 2px 10px;
  border-radius: var(--radius-pill, 999px);
  font-family: inherit;
  font-size: 11px;
  font-weight: 600;
  transition: all 0.2s ease;
}
.tag-chip.add:hover {
  background: var(--smax-primary-soft, #eaf7ef);
  border-color: var(--smax-primary, #16a34a);
  color: var(--smax-primary, #16a34a);
}

.tag-input {
  border: 1px solid var(--smax-primary, #16a34a);
  outline: none;
  padding: 2px 10px;
  border-radius: var(--radius-pill, 999px);
  font-size: 11px;
  width: 110px;
  font-family: inherit;
}

.empty { color: var(--smax-grey-400, #9ca3af); font-size: 11px; }
</style>
