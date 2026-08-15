<template>
  <div class="dept-page">
    <header class="page-hero">
      <div class="hero-left">
        <h1 class="hero-title">Sơ đồ tổ chức</h1>
        <p class="hero-sub">Cây phòng ban Getfly model · Phòng cha quản lý mọi phòng con · Cùng cấp không quản lý nhau</p>
      </div>
      <button class="btn-primary" @click="openCreate(null)">
        <span class="btn-icon">+</span> Thêm phòng ban
      </button>
    </header>

    <section class="stats-row" v-if="!loading && stats.totalDepts > 0">
      <div class="stat-card stat-primary"><div class="stat-label">Tổng phòng ban</div><div class="stat-value">{{ stats.totalDepts }}</div></div>
      <div class="stat-card stat-forest"><div class="stat-label">Cấp tối đa</div><div class="stat-value">{{ stats.maxDepth + 1 }}<span class="stat-unit"> / 5</span></div></div>
      <div class="stat-card stat-mustard"><div class="stat-label">Có trưởng phòng</div><div class="stat-value">{{ stats.deptsWithLeader }}<span class="stat-unit"> / {{ stats.totalDepts }}</span></div></div>
      <div class="stat-card stat-cream"><div class="stat-label">Tổng nhân viên</div><div class="stat-value">{{ stats.totalMembers }}</div></div>
    </section>

    <!-- Toolbar: search + view mode -->
    <div class="toolbar" v-if="!loading && store.departments.length > 0">
      <div class="search-box">
        <span class="search-icon">🔍</span>
        <input v-model="searchQ" placeholder="Tìm phòng ban..." />
        <button v-if="searchQ" class="search-clear" @click="searchQ = ''">×</button>
      </div>
      <div class="view-toggle">
        <button :class="{ active: viewMode === 'tree' }" @click="viewMode = 'tree'">
          🌳 Cây thư mục
        </button>
        <button :class="{ active: viewMode === 'org' }" @click="viewMode = 'org'">
          📊 Sơ đồ tổ chức
        </button>
      </div>
    </div>

    <div v-if="loading" class="loading-state">
      <div class="skel-card" v-for="i in 3" :key="i"></div>
    </div>

    <div v-else-if="store.departments.length === 0" class="empty-state">
      <div class="empty-icon">🌳</div>
      <h3>Chưa có phòng ban nào</h3>
      <p>Tạo phòng đầu tiên — vd "Ban Giám Đốc" làm root, rồi thêm phòng con bên dưới.</p>
      <button class="btn-primary" @click="openCreate(null)">+ Thêm phòng ban đầu tiên</button>
    </div>

    <!-- TREE VIEW (vertical 3-row cards in indented tree) -->
    <section v-else-if="viewMode === 'tree'" class="tree-view">
      <DeptTreeNode
        v-for="node in filteredTree"
        :key="node.id"
        :node="node"
        :user-name-map="userNameMap"
        :depth="0"
        :expanded-ids="expandedIds"
        :expanded-members="expandedMembers"
        :member-cache="memberCache"
        @toggle="toggleNode"
        @add-child="openCreate"
        @open-panel="openPanel"
        @toggle-members="toggleMembers"
      />
    </section>

    <!-- ORG CHART VIEW (vertical visual chart) -->
    <section v-else class="org-chart">
      <div class="org-canvas">
        <OrgChartNode
          v-for="node in filteredTree"
          :key="node.id"
          :node="node"
          :user-name-map="userNameMap"
          :expanded-members="expandedMembers"
          :member-cache="memberCache"
          @add-child="openCreate"
          @open-panel="openPanel"
          @toggle-members="toggleMembers"
        />
      </div>
    </section>

    <!-- Create modal -->
    <Transition name="modal-fade">
      <div v-if="showCreate" class="modal-backdrop" @click.self="showCreate = false">
        <div class="modal-card">
          <header class="modal-head">
            <h3>{{ createParentId ? 'Thêm phòng ban con' : 'Thêm phòng ban gốc' }}</h3>
            <button class="modal-close" @click="showCreate = false">×</button>
          </header>
          <div class="modal-body">
            <p v-if="createParentName" class="parent-hint"><span class="hint-label">Thuộc:</span><strong>{{ createParentName }}</strong></p>
            <label class="form-label">Tên phòng ban</label>
            <input ref="nameInput" v-model="newName" placeholder="VD: Phòng Kinh Doanh 1" class="form-input" @keyup.enter="submitCreate" />
            <p v-if="createError" class="form-error">{{ createError }}</p>
          </div>
          <footer class="modal-foot">
            <button class="btn-ghost" @click="showCreate = false">Hủy</button>
            <button class="btn-primary" :disabled="!newName.trim()" @click="submitCreate">Tạo phòng ban</button>
          </footer>
        </div>
      </div>
    </Transition>

    <!-- Side panel (Smax-style) -->
    <DepartmentEditPanel
      :open="panelOpen"
      :node="selectedNode"
      :parent-name="selectedParentName"
      :all-users="allUsers"
      @close="closePanel"
      @archived="onArchived"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, h, type Component, reactive, watch } from 'vue';
import { useRbacStore, type DepartmentNode, type RbacUser } from '@/stores/rbac';
import { api } from '@/api/index';
import DepartmentEditPanel from '@/components/rbac/DepartmentEditPanel.vue';

const store = useRbacStore();
const allUsers = ref<RbacUser[]>([]);
const viewMode = ref<'tree' | 'org'>('org');
const searchQ = ref('');
const expandedIds = reactive(new Set<string>());

// Inline member expand (per-dept member list under "Nhân viên" row)
const expandedMembers = reactive(new Set<string>());
const memberCache = reactive<Record<string, Array<{ userId: string; fullName: string; email: string; deptRole: string }>>>({});

// Side panel state
const panelOpen = ref(false);
const selectedNode = ref<DepartmentNode | null>(null);
const selectedParentName = ref<string | null>(null);

onMounted(async () => {
  await Promise.all([
    store.loadDepartments(),
    api.get('/rbac/users').then((r) => { allUsers.value = r.data.users ?? []; }).catch(() => {}),
  ]);
  for (const n of store.departments) expandedIds.add(n.id);
});

const userNameMap = computed(() => {
  const m = new Map<string, string>();
  for (const u of allUsers.value) m.set(u.id, u.fullName || u.email);
  return m;
});

// Filter tree by search query
const filteredTree = computed<DepartmentNode[]>(() => {
  if (!searchQ.value.trim()) return store.departments;
  const q = searchQ.value.toLowerCase();
  function matches(n: DepartmentNode): boolean {
    if (n.name.toLowerCase().includes(q)) return true;
    return (n.children ?? []).some(matches);
  }
  function filter(nodes: DepartmentNode[]): DepartmentNode[] {
    return nodes.filter(matches).map((n) => ({ ...n, children: filter(n.children ?? []) }));
  }
  function collectAll(nodes: DepartmentNode[]) {
    for (const n of nodes) { expandedIds.add(n.id); collectAll(n.children ?? []); }
  }
  const result = filter(store.departments);
  collectAll(result);
  return result;
});

function toggleNode(id: string) {
  if (expandedIds.has(id)) expandedIds.delete(id);
  else expandedIds.add(id);
}

async function toggleMembers(deptId: string) {
  if (expandedMembers.has(deptId)) {
    expandedMembers.delete(deptId);
    return;
  }
  expandedMembers.add(deptId);
  if (!memberCache[deptId]) {
    try {
      const { data } = await api.get('/rbac/users', { params: { departmentId: deptId } });
      memberCache[deptId] = (data.users ?? [])
        .filter((u: any) => u.departmentMember?.departmentId === deptId && u.departmentMember?.deptRole === 'member')
        .map((u: any) => ({
          userId: u.id,
          fullName: u.fullName || u.email,
          email: u.email,
          deptRole: u.departmentMember.deptRole,
        }));
    } catch {
      memberCache[deptId] = [];
    }
  }
}

// Refresh cache when store.departments mutate (re-fetch members for expanded depts)
watch(() => store.departments, () => {
  for (const id of Array.from(expandedMembers)) {
    delete memberCache[id];
    // Re-fetch lazily — collapse so next click reloads
    expandedMembers.delete(id);
  }
});

// Find parent name for a given node ID (walk tree)
function findParentName(nodeId: string): string | null {
  function walk(nodes: DepartmentNode[], parentName: string | null): string | null {
    for (const n of nodes) {
      if (n.id === nodeId) return parentName;
      if (n.children?.length) {
        const found = walk(n.children, n.name);
        if (found !== null || n.children.some((c) => c.id === nodeId)) return found ?? n.name;
      }
    }
    return null;
  }
  return walk(store.departments, null);
}

function openPanel(node: DepartmentNode) {
  selectedNode.value = node;
  selectedParentName.value = findParentName(node.id);
  panelOpen.value = true;
}

function closePanel() {
  panelOpen.value = false;
  selectedNode.value = null;
  selectedParentName.value = null;
}

function onArchived() {
  closePanel();
}

const stats = computed(() => {
  let total = 0, withLeader = 0, totalMembers = 0, maxDepth = 0;
  function walk(nodes: DepartmentNode[]) {
    for (const n of nodes) {
      total++;
      if (n.leaderUserId) withLeader++;
      totalMembers += n.memberCount;
      if (n.depth > maxDepth) maxDepth = n.depth;
      if (n.children?.length) walk(n.children);
    }
  }
  walk(store.departments);
  return { totalDepts: total, deptsWithLeader: withLeader, totalMembers, maxDepth };
});

const loading = computed(() => store.loading);

const showCreate = ref(false);
const createParentId = ref<string | null>(null);
const createParentName = ref('');
const newName = ref('');
const createError = ref('');
const nameInput = ref<HTMLInputElement | null>(null);

function openCreate(parent: DepartmentNode | null) {
  createParentId.value = parent?.id ?? null;
  createParentName.value = parent?.name ?? '';
  newName.value = '';
  createError.value = '';
  showCreate.value = true;
  setTimeout(() => nameInput.value?.focus(), 50);
}
async function submitCreate() {
  if (!newName.value.trim()) return;
  try {
    await store.createDepartment({ name: newName.value.trim(), parentId: createParentId.value });
    showCreate.value = false;
  } catch (e: any) { createError.value = e?.response?.data?.error || 'Lỗi tạo phòng ban'; }
}

// ────────── TREE VIEW NODE (indented + 3-row card body) ──────────
const DeptTreeNode: Component = {
  name: 'DeptTreeNode',
  props: ['node', 'userNameMap', 'depth', 'expandedIds', 'expandedMembers', 'memberCache'],
  emits: ['toggle', 'add-child', 'open-panel', 'toggle-members'],
  setup(props, { emit }) {
    return () => {
      const node: DepartmentNode = props.node;
      const hasChildren = (node.children?.length ?? 0) > 0;
      const isExpanded = props.expandedIds.has(node.id);
      const leaderName = node.leaderUserId ? props.userNameMap.get(node.leaderUserId) : null;
      const deputyName = node.deputyUserId ? props.userNameMap.get(node.deputyUserId) : null;
      const accentColor = ['#181d26', '#aa2d00', '#0a2e0e', '#d9a441', '#1b61c9'][Math.min(node.depth, 4)];
      const isMembersOpen = props.expandedMembers.has(node.id);
      const membersList: Array<{ userId: string; fullName: string; email: string; deptRole: string }> = props.memberCache[node.id] ?? [];

      // Header row (toggle + name + open panel + add child)
      const header = h('div', { class: 'dept-row', style: { '--depth': props.depth, '--accent': accentColor } }, [
        h('button', {
          class: ['dept-toggle', { invisible: !hasChildren }],
          onClick: (e: Event) => { e.stopPropagation(); hasChildren && emit('toggle', node.id); },
        }, [hasChildren ? (isExpanded ? '▾' : '▸') : '·']),
        h('div', { class: 'dept-card', onClick: () => emit('open-panel', node) }, [
          h('div', { class: 'dept-card-accent' }),
          h('div', { class: 'dept-card-body' }, [
            // Header: name + actions
            h('div', { class: 'dept-card-head' }, [
              h('div', { class: 'dept-name-wrap' }, [
                h('span', { class: 'dept-name' }, node.name),
                h('span', { class: 'dept-depth-tag' }, `Cấp ${node.depth + 1}`),
              ]),
              h('div', { class: 'dept-quick-actions' }, [
                h('button', {
                  class: 'btn-quick btn-quick-add',
                  title: 'Thêm phòng con',
                  onClick: (e: Event) => { e.stopPropagation(); emit('add-child', node); },
                }, '+ Phòng con'),
                h('button', {
                  class: 'btn-quick btn-quick-edit',
                  title: 'Mở chi tiết',
                  onClick: (e: Event) => { e.stopPropagation(); emit('open-panel', node); },
                }, '✎ Chi tiết'),
              ]),
            ]),
            // 3-row layout: Trưởng phòng / Phó phòng / Nhân viên
            h('div', { class: 'dept-rows' }, [
              h('div', { class: 'dept-info-row' }, [
                h('span', { class: 'info-ico ico-leader' }, '👑'),
                h('span', { class: 'info-label' }, 'Trưởng phòng:'),
                leaderName
                  ? h('span', { class: 'info-name' }, leaderName)
                  : h('span', { class: 'info-empty' }, 'Chưa bổ nhiệm'),
              ]),
              h('div', { class: 'dept-info-row' }, [
                h('span', { class: 'info-ico ico-deputy' }, '🎖️'),
                h('span', { class: 'info-label' }, 'Phó phòng:'),
                deputyName
                  ? h('span', { class: 'info-name' }, deputyName)
                  : h('span', { class: 'info-empty' }, 'Chưa bổ nhiệm'),
              ]),
              h('div', { class: 'dept-info-row dept-info-row-members' }, [
                h('span', { class: 'info-ico ico-members' }, '👥'),
                h('span', { class: 'info-label' }, 'Nhân viên:'),
                h('span', { class: 'info-count' }, String(node.memberCount)),
                node.memberCount > 0
                  ? h('button', {
                      class: 'btn-expand-members',
                      title: isMembersOpen ? 'Thu gọn' : 'Mở rộng',
                      onClick: (e: Event) => { e.stopPropagation(); emit('toggle-members', node.id); },
                    }, isMembersOpen ? '−' : '+')
                  : null,
              ].filter(Boolean)),
              // Inline expanded member list
              isMembersOpen
                ? h('ul', { class: 'inline-member-list' },
                    membersList.length > 0
                      ? membersList.map((m) =>
                          h('li', { key: m.userId, class: 'inline-member' }, [
                            h('span', { class: 'inline-avatar', style: { background: avatarColor(m.fullName) } }, initials(m.fullName)),
                            h('div', { class: 'inline-info' }, [
                              h('div', { class: 'inline-name' }, m.fullName),
                              h('div', { class: 'inline-email' }, m.email),
                            ]),
                          ])
                        )
                      : [h('li', { class: 'inline-member-empty' }, 'Đang tải hoặc chỉ có chức vụ Trưởng/Phó, chưa có nhân viên thường.')]
                  )
                : null,
            ].filter(Boolean)),
          ]),
        ]),
      ]);

      const children = isExpanded && hasChildren
        ? node.children!.map((c: DepartmentNode) =>
            h(DeptTreeNode as any, {
              key: c.id,
              node: c,
              userNameMap: props.userNameMap,
              depth: props.depth + 1,
              expandedIds: props.expandedIds,
              expandedMembers: props.expandedMembers,
              memberCache: props.memberCache,
              onToggle: (id: string) => emit('toggle', id),
              onAddChild: (n: DepartmentNode) => emit('add-child', n),
              onOpenPanel: (n: DepartmentNode) => emit('open-panel', n),
              onToggleMembers: (id: string) => emit('toggle-members', id),
            }))
        : null;

      return h('div', { class: 'dept-group' }, [header, children]);
    };
  },
};

// ────────── ORG CHART NODE (vertical visual chart, same 3-row card) ──────────
const OrgChartNode: Component = {
  name: 'OrgChartNode',
  props: ['node', 'userNameMap', 'expandedMembers', 'memberCache'],
  emits: ['add-child', 'open-panel', 'toggle-members'],
  setup(props, { emit }) {
    return () => {
      const node: DepartmentNode = props.node;
      const leaderName = node.leaderUserId ? props.userNameMap.get(node.leaderUserId) : null;
      const deputyName = node.deputyUserId ? props.userNameMap.get(node.deputyUserId) : null;
      const accentColor = ['#181d26', '#aa2d00', '#0a2e0e', '#d9a441', '#1b61c9'][Math.min(node.depth, 4)];
      const hasChildren = (node.children?.length ?? 0) > 0;
      const isMembersOpen = props.expandedMembers.has(node.id);
      const membersList: Array<{ userId: string; fullName: string; email: string; deptRole: string }> = props.memberCache[node.id] ?? [];

      return h('div', { class: 'org-node' }, [
        h('div', {
          class: 'org-card-wrap dept-card',
          style: { '--accent': accentColor },
          onClick: () => emit('open-panel', node),
        }, [
          h('div', { class: 'dept-card-accent' }),
          h('div', { class: 'dept-card-body' }, [
            h('div', { class: 'dept-card-head' }, [
              h('div', { class: 'dept-name-wrap' }, [
                h('span', { class: 'dept-name' }, node.name),
                h('span', { class: 'dept-depth-tag' }, `Cấp ${node.depth + 1}`),
              ]),
              h('div', { class: 'dept-quick-actions' }, [
                h('button', {
                  class: 'btn-quick btn-quick-add',
                  onClick: (e: Event) => { e.stopPropagation(); emit('add-child', node); },
                }, '+'),
                h('button', {
                  class: 'btn-quick btn-quick-edit',
                  onClick: (e: Event) => { e.stopPropagation(); emit('open-panel', node); },
                }, '✎'),
              ]),
            ]),
            h('div', { class: 'dept-rows' }, [
              h('div', { class: 'dept-info-row' }, [
                h('span', { class: 'info-ico ico-leader' }, '👑'),
                h('span', { class: 'info-label' }, 'Trưởng phòng:'),
                leaderName
                  ? h('span', { class: 'info-name' }, leaderName)
                  : h('span', { class: 'info-empty' }, 'Chưa bổ nhiệm'),
              ]),
              h('div', { class: 'dept-info-row' }, [
                h('span', { class: 'info-ico ico-deputy' }, '🎖️'),
                h('span', { class: 'info-label' }, 'Phó phòng:'),
                deputyName
                  ? h('span', { class: 'info-name' }, deputyName)
                  : h('span', { class: 'info-empty' }, 'Chưa bổ nhiệm'),
              ]),
              h('div', { class: 'dept-info-row dept-info-row-members' }, [
                h('span', { class: 'info-ico ico-members' }, '👥'),
                h('span', { class: 'info-label' }, 'Nhân viên:'),
                h('span', { class: 'info-count' }, String(node.memberCount)),
                node.memberCount > 0
                  ? h('button', {
                      class: 'btn-expand-members',
                      onClick: (e: Event) => { e.stopPropagation(); emit('toggle-members', node.id); },
                    }, isMembersOpen ? '−' : '+')
                  : null,
              ].filter(Boolean)),
              isMembersOpen
                ? h('ul', { class: 'inline-member-list' },
                    membersList.length > 0
                      ? membersList.map((m) =>
                          h('li', { key: m.userId, class: 'inline-member' }, [
                            h('span', { class: 'inline-avatar', style: { background: avatarColor(m.fullName) } }, initials(m.fullName)),
                            h('div', { class: 'inline-info' }, [
                              h('div', { class: 'inline-name' }, m.fullName),
                              h('div', { class: 'inline-email' }, m.email),
                            ]),
                          ])
                        )
                      : [h('li', { class: 'inline-member-empty' }, 'Chưa có nhân viên thường (chỉ có chức vụ).')]
                  )
                : null,
            ].filter(Boolean)),
          ]),
        ]),
        hasChildren
          ? h('div', { class: 'org-children' }, [
              h('div', { class: 'org-connector-down' }),
              h('div', { class: 'org-children-row' }, node.children!.map((c: DepartmentNode) =>
                h('div', { class: 'org-child-wrap', key: c.id }, [
                  h('div', { class: 'org-connector-up' }),
                  h(OrgChartNode as any, {
                    node: c,
                    userNameMap: props.userNameMap,
                    expandedMembers: props.expandedMembers,
                    memberCache: props.memberCache,
                    onAddChild: (n: DepartmentNode) => emit('add-child', n),
                    onOpenPanel: (n: DepartmentNode) => emit('open-panel', n),
                    onToggleMembers: (id: string) => emit('toggle-members', id),
                  }),
                ]),
              )),
            ])
          : null,
      ].filter(Boolean));
    };
  },
};

// ────────── Helpers ──────────
function initials(name: string): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
function avatarColor(name: string): string {
  const colors = ['#aa2d00', '#0a2e0e', '#d9a441', '#1b61c9', '#7a2000', '#1a3866'];
  const hh = (name || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return colors[hh % colors.length];
}
</script>

<style scoped>
.modal-fade-enter-active, .modal-fade-leave-active { transition: opacity 0.15s; }
.modal-fade-enter-from, .modal-fade-leave-to { opacity: 0; }
</style>
