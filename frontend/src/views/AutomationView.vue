<template>
  <div>
    <div class="d-flex align-center mb-4 flex-wrap gap-2">
      <h1 class="text-h5 mr-4">Workflow Automation</h1>
      <v-spacer />
      <v-btn v-if="canManage" color="primary" prepend-icon="mdi-plus" @click="openCreateRule">Thêm rule</v-btn>
    </div>

    <v-alert
      v-if="saveError"
      type="error"
      variant="tonal"
      density="compact"
      closable
      class="mb-4"
      @click:close="saveError = ''"
    >{{ saveError }}</v-alert>

    <v-tabs v-model="tab" class="mb-4">
      <v-tab value="rules">Rules</v-tab>
      <v-tab value="templates">Templates</v-tab>
    </v-tabs>

    <v-window v-model="tab">
      <v-window-item value="rules">
        <v-card>
          <v-data-table :headers="ruleHeaders" :items="rules" :loading="rulesLoading" no-data-text="Chưa có automation rule nào">
            <template #item.trigger="{ item }">
              <v-chip size="small" variant="tonal">{{ triggerLabel(item.trigger) }}</v-chip>
            </template>
            <template #item.enabled="{ item }">
              <v-switch :model-value="item.enabled" color="primary" hide-details :disabled="!canManage || ruleSaving" @update:model-value="toggleRule(item, $event)" />
            </template>
            <template #item.runCount="{ item }">
              {{ item.runCount }}<span v-if="item.lastRunAt" class="text-medium-emphasis"> · {{ formatDateTime(item.lastRunAt) }}</span>
            </template>
            <template #item.health="{ item }">
              <v-tooltip v-if="item.lastError" location="top" max-width="420">
                <template #activator="{ props: tooltipProps }">
                  <v-chip v-bind="tooltipProps" size="small" color="error" variant="tonal" prepend-icon="mdi-alert-circle">
                    Lỗi {{ formatDateTime(item.lastErrorAt) }}
                  </v-chip>
                </template>
                {{ item.lastError }}
              </v-tooltip>
              <v-chip v-else-if="item.runCount > 0" size="small" color="success" variant="tonal" prepend-icon="mdi-check">Ổn định</v-chip>
              <span v-else class="text-medium-emphasis">Chưa chạy</span>
            </template>
            <template #item.actions="{ item }">
              <div v-if="canManage">
                <v-btn icon size="small" @click="openRunHistory(item)"><v-icon>mdi-history</v-icon></v-btn>
                <v-btn icon size="small" @click="openEditRule(item)"><v-icon>mdi-pencil</v-icon></v-btn>
                <v-btn icon size="small" color="error" @click="confirmDeleteRule(item)"><v-icon>mdi-delete</v-icon></v-btn>
              </div>
            </template>
          </v-data-table>
        </v-card>
      </v-window-item>

      <v-window-item value="templates">
        <TemplateManager
          :templates="templates"
          :loading="templatesLoading"
          :saving="templateSaving"
          :can-manage="canManage"
          @create="createTemplate"
          @update="updateTemplate"
          @delete="deleteTemplate"
        />
      </v-window-item>
    </v-window>

    <RuleBuilder
      v-model="showRuleDialog"
      :rule="selectedRule"
      :templates="templates"
      :saving="ruleSaving"
      @save="saveRule"
    />

    <!-- Xác nhận xóa — trước đây 1 cú nhấp chuột là xóa rule vĩnh viễn -->
    <v-dialog v-model="showDeleteConfirm" max-width="440">
      <v-card>
        <v-card-title>Xóa automation rule?</v-card-title>
        <v-card-text>
          Rule <strong>{{ ruleToDelete?.name }}</strong> sẽ bị xóa vĩnh viễn cùng toàn bộ lịch sử chạy. Thao tác không thể hoàn tác.
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="showDeleteConfirm = false">Hủy</v-btn>
          <v-btn color="error" :loading="ruleSaving" @click="doDeleteRule">Xóa</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Lịch sử chạy rule -->
    <v-dialog v-model="showRunHistory" max-width="680">
      <v-card>
        <v-card-title class="d-flex align-center">
          Lịch sử chạy — {{ historyRule?.name }}
          <v-spacer />
          <v-btn icon variant="text" size="small" @click="showRunHistory = false"><v-icon>mdi-close</v-icon></v-btn>
        </v-card-title>
        <v-card-text>
          <div v-if="runsLoading" class="d-flex justify-center pa-4"><v-progress-circular indeterminate /></div>
          <div v-else-if="runLogs.length === 0" class="text-medium-emphasis text-center pa-4">Rule chưa từng chạy.</div>
          <v-list v-else density="compact" class="pa-0">
            <v-list-item v-for="run in runLogs" :key="run.id" class="px-0">
              <template #prepend>
                <v-icon :color="run.error ? 'error' : 'success'">{{ run.error ? 'mdi-close-circle' : 'mdi-check-circle' }}</v-icon>
              </template>
              <v-list-item-title class="text-body-2">{{ formatDateTime(run.ranAt) }}</v-list-item-title>
              <v-list-item-subtitle class="text-body-2">
                <v-chip v-for="(a, i) in run.actionsRun" :key="i" size="x-small" :color="a.ok ? 'default' : 'error'" variant="tonal" class="mr-1">
                  {{ actionLabel(a.type) }}{{ a.ok ? '' : ' ✗' }}
                </v-chip>
                <span v-if="run.error" class="text-error">{{ run.error }}</span>
              </v-list-item-subtitle>
            </v-list-item>
          </v-list>
        </v-card-text>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import RuleBuilder from '@/components/automation/RuleBuilder.vue';
import TemplateManager from '@/components/automation/TemplateManager.vue';
import { useAutomationRules, type AutomationRule, type AutomationRunLog } from '@/composables/use-automation-rules';
import { useMessageTemplates } from '@/composables/use-message-templates';
import { useAuthStore } from '@/stores/auth';
import { formatInOrgTz } from '@/composables/use-org-timezone';

const authStore = useAuthStore();
const canManage = computed(() => authStore.isAdmin);
const tab = ref('rules');
const showRuleDialog = ref(false);
const selectedRule = ref<AutomationRule | null>(null);
const saveError = ref('');

const showDeleteConfirm = ref(false);
const ruleToDelete = ref<AutomationRule | null>(null);

const showRunHistory = ref(false);
const historyRule = ref<AutomationRule | null>(null);
const runLogs = ref<AutomationRunLog[]>([]);
const runsLoading = ref(false);

const {
  rules,
  loading: rulesLoading,
  saving: ruleSaving,
  fetchRules,
  createRule,
  updateRule,
  deleteRule: removeRule,
  fetchRuleRuns,
} = useAutomationRules();

const {
  templates,
  loading: templatesLoading,
  saving: templateSaving,
  fetchTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
} = useMessageTemplates();

const ruleHeaders = [
  { title: 'Tên rule', key: 'name' },
  { title: 'Trigger', key: 'trigger' },
  { title: 'Ưu tiên', key: 'priority' },
  { title: 'Đã chạy', key: 'runCount' },
  { title: 'Tình trạng', key: 'health', sortable: false },
  { title: 'Bật', key: 'enabled', sortable: false },
  { title: 'Hành động', key: 'actions', sortable: false, align: 'end' as const },
];

function triggerLabel(trigger: string) {
  const labels: Record<string, string> = {
    message_received: 'Tin nhắn đến',
    contact_created: 'Contact mới',
    status_changed: 'Đổi trạng thái',
  };
  return labels[trigger] ?? trigger;
}

function actionLabel(type: string) {
  const labels: Record<string, string> = {
    assign_user: 'Gán user',
    send_template: 'Gửi template',
    update_status: 'Đổi status',
    create_appointment: 'Tạo hẹn',
  };
  return labels[type] ?? type;
}

function formatDateTime(value: string) {
  return formatInOrgTz(value);
}

function openCreateRule() {
  selectedRule.value = null;
  saveError.value = '';
  showRuleDialog.value = true;
}

function openEditRule(rule: AutomationRule) {
  selectedRule.value = rule;
  saveError.value = '';
  showRuleDialog.value = true;
}

async function saveRule(payload: Partial<AutomationRule>) {
  saveError.value = '';
  try {
    if (payload.id) {
      await updateRule(payload.id, payload);
    } else {
      await createRule(payload);
    }
    showRuleDialog.value = false;
  } catch (err: unknown) {
    // Hiện lỗi validation từ backend ngay trên view thay vì nuốt im lặng
    const message = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
    saveError.value = message || 'Không lưu được rule. Vui lòng thử lại.';
  }
}

async function toggleRule(rule: AutomationRule, enabled: boolean | null) {
  await updateRule(rule.id, { enabled: !!enabled });
}

function confirmDeleteRule(rule: AutomationRule) {
  ruleToDelete.value = rule;
  showDeleteConfirm.value = true;
}

async function doDeleteRule() {
  if (!ruleToDelete.value) return;
  try {
    await removeRule(ruleToDelete.value.id);
    showDeleteConfirm.value = false;
  } finally {
    ruleToDelete.value = null;
  }
}

async function openRunHistory(rule: AutomationRule) {
  historyRule.value = rule;
  runLogs.value = [];
  showRunHistory.value = true;
  runsLoading.value = true;
  try {
    runLogs.value = await fetchRuleRuns(rule.id);
  } finally {
    runsLoading.value = false;
  }
}

onMounted(async () => {
  await Promise.all([fetchRules(), fetchTemplates()]);
});
</script>
