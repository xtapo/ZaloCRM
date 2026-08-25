<template>
  <div class="d-flex flex-column h-100">
    <div class="pa-3 pb-2">
      <v-text-field
        v-model="search"
        density="compact"
        variant="outlined"
        placeholder="Tìm nhóm..."
        prepend-inner-icon="mdi-magnify"
        hide-details
        clearable
      />
      <div class="d-flex align-center mt-2 gap-2">
        <v-chip
          size="small"
          :color="onlyMine ? 'primary' : 'default'"
          :variant="onlyMine ? 'tonal' : 'outlined'"
          prepend-icon="mdi-account-check-outline"
          class="flex-grow-1 justify-center"
          @click="onlyMine = !onlyMine"
        >
          Nhóm của tôi
        </v-chip>
        <v-select
          v-model="tagFilter"
          :items="allTags"
          label="Tag"
          density="compact"
          variant="outlined"
          hide-details
          clearable
          style="max-width: 140px"
        />
      </div>
    </div>

    <v-list v-if="!loading && filtered.length" lines="two" class="flex-1-1 overflow-y-auto">
      <v-list-item
        v-for="group in filtered"
        :key="group.id"
        :active="group.id === selectedId"
        active-color="primary"
        rounded="lg"
        class="mx-2 mb-1"
        @click="$emit('select', group.id)"
      >
        <template #prepend>
          <v-avatar color="primary" size="36">
            <v-icon size="20">mdi-account-group</v-icon>
          </v-avatar>
        </template>
        <v-list-item-title class="text-body-2 font-weight-medium d-flex align-center gap-1">
          <span class="text-truncate">{{ displayName(group) }}</span>
          <!-- Trạng thái hoạt động: xanh = active, vàng = quiet, xám = silent -->
          <span
            v-if="statusOf(group)"
            class="status-dot"
            :class="`status-${statusOf(group)}`"
            :title="{ active: 'Đang hoạt động', quiet: 'Ít hoạt động', silent: 'Im lặng' }[statusOf(group)!]"
          />
        </v-list-item-title>
        <v-list-item-subtitle class="text-caption">
          <span v-if="group.totalMember">{{ group.totalMember }} thành viên</span>
          <template v-if="tagsOf(group).length">
            · {{ tagsOf(group).slice(0, 2).join(', ') }}
          </template>
        </v-list-item-subtitle>
        <template #append>
          <div class="d-flex flex-column align-center">
            <!-- Nhắn tin: ensure-conversation cho group → nav /chat/:convId -->
            <v-btn
              icon="mdi-message-text"
              size="x-small"
              variant="text"
              color="primary"
              :title="`Nhắn tin nhóm ${displayName(group)}`"
              @click.stop="$emit('open-chat', group.id)"
            />
            <!-- Avatar chữ cái đầu người phụ trách -->
            <v-tooltip v-if="assigneeInitial(group)" location="top">
              <template #activator="{ props: tipProps }">
                <v-avatar v-bind="tipProps" size="16" color="indigo" class="mt-1">
                  <span class="text-[8px] font-weight-bold">{{ assigneeInitial(group) }}</span>
                </v-avatar>
              </template>
              {{ assigneeName(group) }}
            </v-tooltip>
          </div>
        </template>
      </v-list-item>
    </v-list>

    <div v-else-if="loading" class="d-flex justify-center pa-6">
      <v-progress-circular indeterminate color="primary" size="32" />
    </div>

    <div v-else class="text-center text-grey pa-6 text-body-2">
      Không có nhóm nào
    </div>

    <div class="pa-3 pt-2">
      <v-btn
        color="primary"
        variant="tonal"
        block
        prepend-icon="mdi-plus"
        @click="$emit('create')"
      >
        Tạo nhóm
      </v-btn>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import type { CrmProfile } from '@/composables/use-groups';
import type { GroupStat } from '@/composables/use-group-stats';

const props = defineProps<{
  groups: any[];
  selectedId: string;
  loading: boolean;
  /** CRM profiles theo groupId (externalGroupId) */
  crmProfiles?: Record<string, CrmProfile>;
  /** Stats theo groupId — dùng cho dot trạng thái */
  statsByGroup?: Record<string, GroupStat>;
  /** userId của user đang đăng nhập — filter "Nhóm của tôi" */
  currentUserId?: string | null;
  /** Map userId → fullName để hiển thị người phụ trách */
  userNameMap?: Record<string, string>;
}>();

defineEmits<{
  select: [groupId: string];
  create: [];
  'open-chat': [groupId: string];
}>();

const search = ref('');
const onlyMine = ref(false);
const tagFilter = ref<string | null>(null);

function profileOf(g: any): CrmProfile | undefined {
  return props.crmProfiles?.[g.id];
}

function displayName(g: any): string {
  return profileOf(g)?.crmName || g.name || g.groupName || 'Nhóm không tên';
}

function tagsOf(g: any): string[] {
  return profileOf(g)?.tags ?? [];
}

function statusOf(g: any): 'active' | 'quiet' | 'silent' | null {
  const s = props.statsByGroup?.[g.id];
  if (!s) {
    // Fallback theo lastMessageAt của group raw nếu chưa load stats
    if (g.lastMessageAt) {
      const idleMs = Date.now() - new Date(g.lastMessageAt).getTime();
      if (idleMs < 3 * 24 * 60 * 60 * 1000) return 'active';
      if (idleMs < 14 * 24 * 60 * 60 * 1000) return 'quiet';
    }
    return null;
  }
  return s.status;
}

function assigneeId(g: any): string | null {
  return profileOf(g)?.assignedUserId ?? null;
}

function assigneeName(g: any): string {
  const id = assigneeId(g);
  return (id && props.userNameMap?.[id]) || '';
}

function assigneeInitial(g: any): string {
  const name = assigneeName(g);
  return name ? name.charAt(0).toUpperCase() : '';
}

const allTags = computed(() => {
  const set = new Set<string>();
  for (const g of props.groups) tagsOf(g).forEach(t => set.add(t));
  return [...set].sort();
});

const filtered = computed(() => {
  let list = props.groups;
  // Filter "Nhóm của tôi" — nhóm user đang đăng nhập phụ trách
  if (onlyMine.value && props.currentUserId) {
    list = list.filter(g => assigneeId(g) === props.currentUserId);
  }
  if (tagFilter.value) {
    list = list.filter(g => tagsOf(g).includes(tagFilter.value!));
  }
  if (search.value) {
    const q = search.value.toLowerCase();
    list = list.filter(g => displayName(g).toLowerCase().includes(q));
  }
  return list;
});
</script>

<style scoped>
.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.status-active { background: #4caf50; }
.status-quiet { background: #ffc107; }
.status-silent { background: #bdbdbd; }
.gap-1 { gap: 4px; }
.gap-2 { gap: 8px; }
.text-\[8px\] { font-size: 8px; }
</style>
