<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import UiButton from "../../components/shared/UiButton.vue";
import UiCard from "../../components/shared/UiCard.vue";
import UiState from "../../components/shared/UiState.vue";
import MetricCard from "../../components/MetricCard.vue";
import {
  LocalScenarioSchema,
  localScenarios,
  type LocalScenario,
} from "../../core/contracts/local";
import { getRouteEntry } from "../../shared/route-registry";
import { roleCanAccess, useDemoSessionStore } from "../../stores/demo-session";
import { usePagesStore } from "../../stores/pages";

type TaskAction = {
  id: string;
  label_zh_cn: string;
  capability: string;
  destructive?: boolean;
};

const scenarioLabels: Record<LocalScenario, string> = {
  success: "成功读回",
  empty: "空资料",
  error: "模拟错误",
  "permission-denied": "权限拒绝",
  timeout: "模拟超时",
  fallback: "缓存回退",
};

const route = useRoute();
const router = useRouter();
const pages = usePagesStore();
const demoSession = useDemoSessionStore();
const selectedScenario = ref<LocalScenario>("success");
const pendingAction = ref<TaskAction | null>(null);
const filterText = ref("");
const formName = ref("");
const formMessage = ref("");

const fixtureKey = computed(() =>
  String(
    route.meta.fixtureKey ??
      getRouteEntry(route.path)?.fixture_key ??
      route.path.replace(/^\//, ""),
  ),
);
const routeEntry = computed(() => getRouteEntry(route.path));
const hasPermission = computed(() => {
  const required = routeEntry.value?.required_role ?? "operator";
  return roleCanAccess(demoSession.role, required);
});
const page = computed(() => pages.page);
const artifacts = computed(() => pages.response?.artifacts ?? {});
const isWorkflow = computed(() => page.value?.page_type === "workflow");
const isForm = computed(() => page.value?.page_type === "form");
const isFilterableTable = computed(() => fixtureKey.value === "screen-data");
const visibleRecords = computed(() => {
  const records = page.value?.records ?? [];
  const query = filterText.value.trim().toLowerCase();
  if (!query) return records;
  return records.filter((record) =>
    `${record.primary} ${record.secondary} ${record.status}`
      .toLowerCase()
      .includes(query),
  );
});
const queryScenario = computed<LocalScenario>(() => {
  if (!hasPermission.value) return "permission-denied";
  const candidate = route.query.scenario;
  const value = typeof candidate === "string" ? candidate : "success";
  return LocalScenarioSchema.safeParse(value).success
    ? (value as LocalScenario)
    : "success";
});
const stateKind = computed<
  | "loading"
  | "empty"
  | "error"
  | "permission-denied"
  | "timeout"
  | "fallback"
  | null
>(() => {
  if (
    pages.state === "loading" ||
    pages.state === "empty" ||
    pages.state === "fallback"
  ) {
    return pages.state;
  }
  if (
    pages.state === "error" ||
    pages.state === "permission-denied" ||
    pages.state === "timeout"
  ) {
    return pages.state;
  }
  return null;
});
const isTerminalError = computed(() =>
  ["error", "permission-denied", "timeout"].includes(pages.state),
);
const uiErrorMessage = computed(() => {
  if (pages.state === "permission-denied") {
    return "当前本地演示角色没有访问权限，已安全停止。";
  }
  if (pages.state === "timeout") {
    return "本地 fixture 读回超时，已安全停止。";
  }
  if (pages.state === "error") {
    return "本地 fixture 返回错误，已安全停止。";
  }
  return pages.error?.message;
});

watch(
  [fixtureKey, queryScenario, () => demoSession.role],
  ([pageId, scenario]) => {
    selectedScenario.value = scenario;
    void pages.load(pageId, scenario);
  },
  { immediate: true },
);

function selectScenario() {
  void router.replace({
    query: { ...route.query, scenario: selectedScenario.value },
  });
}

function retry() {
  void pages.load(fixtureKey.value, selectedScenario.value);
}

function confirmDryRun(action: TaskAction) {
  pendingAction.value = action;
}

function applyDryRun() {
  if (!pendingAction.value) return;
  pages.runDryRun(pendingAction.value.id, demoSession.role);
  pendingAction.value = null;
}

function statusLabel(value: string) {
  const labels: Record<string, string> = {
    queued: "排队中",
    review: "待复核",
    ready: "已准备",
    "safe-stop": "已安全停止",
    draft: "草稿",
  };
  return labels[value] ?? value;
}

function roleLabel() {
  return demoSession.role === "operator"
    ? "操作员"
    : demoSession.role === "reviewer"
      ? "审核员"
      : "查看者";
}
</script>

<template>
  <section class="task-page page-dashboard" aria-labelledby="task-page-title">
    <header class="page-heading task-page__heading">
      <div>
        <span class="section-kicker">任务与采集 · 本地 clean-room</span>
        <h1 id="task-page-title">
          {{ page?.title_zh_cn ?? route.meta.label }}
        </h1>
        <p class="lead">
          {{
            page?.description_zh_cn ??
            routeEntry?.description_zh_cn ??
            "此页面只加载本地 fixture，不连接真实后端。"
          }}
        </p>
      </div>
      <div class="control-stack" aria-label="本地 fixture 控制">
        <label for="task-scenario">演示场景</label>
        <select
          id="task-scenario"
          v-model="selectedScenario"
          :disabled="!hasPermission"
          @change="selectScenario"
        >
          <option
            v-for="scenario in localScenarios"
            :key="scenario"
            :value="scenario"
          >
            {{ scenarioLabels[scenario] }}
          </option>
        </select>
        <span>数据源：/api/mock/pages/{{ fixtureKey }}</span>
      </div>
    </header>

    <div class="session-strip" aria-label="本地演示角色">
      <span>当前角色：{{ roleLabel() }}</span>
      <span class="environment-chip environment-chip--muted">local-demo</span>
      <strong v-if="!hasPermission">当前角色没有访问权限</strong>
    </div>

    <UiState
      v-if="stateKind"
      :kind="stateKind"
      :description="uiErrorMessage"
      @action="retry"
    />

    <template v-if="pages.state === 'success' || pages.state === 'fallback'">
      <template v-if="page">
        <div class="metric-grid" aria-label="任务域指标">
          <MetricCard
            v-for="metric in page.metrics"
            :key="metric.label"
            :label="metric.label"
            :value="metric.value"
            :detail="metric.detail"
            :tone="metric.tone"
          />
        </div>

        <div v-if="isForm" class="task-form-grid">
          <UiCard
            :title="
              fixtureKey === 'group-send-msg' ? '消息草稿' : '本地参数预览'
            "
            subtitle="字段只保留在当前页面，不会上传或保存。"
          >
            <div class="task-form-fields">
              <label for="task-name">{{
                fixtureKey === "group-send-msg" ? "目标群组" : "任务名称"
              }}</label>
              <input
                id="task-name"
                v-model="formName"
                type="text"
                autocomplete="off"
                :placeholder="
                  fixtureKey === 'group-send-msg'
                    ? '例如：公开样本群组 A'
                    : '输入本地演示名称'
                "
              />
              <label v-if="fixtureKey === 'group-send-msg'" for="task-message"
                >消息内容</label
              >
              <textarea
                v-if="fixtureKey === 'group-send-msg'"
                id="task-message"
                v-model="formMessage"
                rows="4"
                placeholder="仅作为本地预览，不会发送。"
              />
              <p class="form-hint">
                输入不会触发网络请求；确认按钮只生成 dry-run 审计回执。
              </p>
            </div>
          </UiCard>

          <UiCard title="安全边界" subtitle="本阶段默认停止在本地。">
            <ul class="boundary-list">
              <li>不连接 Telegram、真实账号或生产数据。</li>
              <li>不发送、不付款、不创建外部资源。</li>
              <li>任何动作均需确认，并固定回传 mutation_applied: false。</li>
            </ul>
          </UiCard>
        </div>

        <UiCard
          v-if="isWorkflow"
          class="workflow-card"
          title="本地流程"
          subtitle="每一步都可在安全停止点结束。"
        >
          <ol class="workflow-steps">
            <li class="workflow-step workflow-step--done">
              <span class="workflow-step__number">1</span>
              <div>
                <strong>读取本地样本</strong>
                <p>已完成 fixture 读回与审计。</p>
              </div>
            </li>
            <li class="workflow-step">
              <span class="workflow-step__number">2</span>
              <div>
                <strong>人工复核参数</strong>
                <p>确认范围、角色与停止条件。</p>
              </div>
            </li>
            <li class="workflow-step">
              <span class="workflow-step__number">3</span>
              <div>
                <strong>生成 dry-run 回执</strong>
                <p>只写本地内存，不执行外部操作。</p>
              </div>
            </li>
          </ol>
        </UiCard>

        <UiCard
          class="records-card"
          :title="isFilterableTable ? '本地筛选样本' : '本地任务样本'"
          subtitle="记录来自 route-specific fixture，时间为固定演示值。"
        >
          <label
            v-if="isFilterableTable"
            class="filter-field"
            for="task-filter"
          >
            <span>筛选关键词</span>
            <input
              id="task-filter"
              v-model="filterText"
              type="search"
              placeholder="搜索名称、状态或说明"
            />
          </label>
          <div
            v-if="visibleRecords.length === 0"
            class="empty-state"
            role="status"
          >
            <span class="empty-icon" aria-hidden="true">○</span>
            <h3>没有符合条件的本地样本</h3>
            <p>fixture 正常响应，但当前场景或筛选条件没有资料。</p>
          </div>
          <div v-else class="table-wrap">
            <table class="signals-table task-records-table">
              <thead>
                <tr>
                  <th scope="col">对象</th>
                  <th scope="col">状态</th>
                  <th scope="col">负责人</th>
                  <th scope="col">更新时间</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="record in visibleRecords" :key="record.id">
                  <th scope="row">
                    {{ record.primary
                    }}<span class="muted-line">{{ record.secondary }}</span>
                  </th>
                  <td>
                    <span class="severity-pill severity-pill--low">{{
                      statusLabel(record.status)
                    }}</span>
                  </td>
                  <td class="muted-cell">{{ record.owner }}</td>
                  <td class="muted-cell">{{ record.updated_at }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </UiCard>

        <section
          v-if="page.actions.length > 0"
          class="dry-run-panel task-dry-run"
          aria-labelledby="task-dry-run-title"
        >
          <div>
            <span class="section-kicker">本地 dry-run</span>
            <h2 id="task-dry-run-title">确认后只生成本地审计</h2>
            <p>
              操作不会发出外部请求。回执固定包含 dry_run:
              true、mutation_applied: false、readback: local-simulation。
            </p>
          </div>
          <div class="dry-run-actions">
            <UiButton
              v-for="action in page.actions"
              :key="action.id"
              variant="secondary"
              @click="confirmDryRun(action)"
            >
              {{ action.label_zh_cn }}
            </UiButton>
          </div>
        </section>

        <section
          v-if="pendingAction"
          class="confirm-panel"
          aria-labelledby="task-confirm-title"
        >
          <h2 id="task-confirm-title">确认本地模拟操作</h2>
          <p>
            {{ pendingAction.label_zh_cn }} 只作用于本地演示，不会发送 Telegram
            或改变真实资源。
          </p>
          <UiButton variant="primary" @click="applyDryRun"
            >确认 dry-run</UiButton
          >
          <UiButton variant="ghost" @click="pendingAction = null"
            >取消</UiButton
          >
        </section>

        <section
          v-if="pages.receipt"
          class="receipt-panel task-receipt"
          role="status"
          aria-live="polite"
        >
          <strong>{{ pages.receipt.summary }}</strong>
          <dl class="receipt-grid">
            <div>
              <dt>dry_run</dt>
              <dd>{{ pages.receipt.dry_run }}</dd>
            </div>
            <div>
              <dt>mutation_applied</dt>
              <dd>{{ pages.receipt.mutation_applied }}</dd>
            </div>
            <div>
              <dt>readback</dt>
              <dd>{{ pages.receipt.readback }}</dd>
            </div>
            <div>
              <dt>审计事件</dt>
              <dd>{{ pages.receipt.audit.event_id }}</dd>
            </div>
          </dl>
        </section>

        <aside class="audit-card task-audit" aria-labelledby="task-audit-title">
          <div class="audit-heading">
            <div>
              <span class="section-kicker">证据</span>
              <h2 id="task-audit-title">审计记录</h2>
            </div>
            <span class="audit-lock">只读</span>
          </div>
          <dl v-if="pages.activeAudit" class="audit-list">
            <div>
              <dt>决策</dt>
              <dd>{{ pages.activeAudit.decision }}</dd>
            </div>
            <div>
              <dt>能力</dt>
              <dd>{{ pages.activeAudit.capability }}</dd>
            </div>
            <div>
              <dt>事件</dt>
              <dd>{{ pages.activeAudit.event_id }}</dd>
            </div>
          </dl>
          <p v-else class="muted-cell">尚未记录审计事件。</p>
          <div v-if="Object.keys(artifacts).length" class="artifact-list">
            <span
              v-for="(value, key) in artifacts"
              :key="key"
              class="artifact-chip"
              >{{ key }}: {{ value }}</span
            >
          </div>
        </aside>
      </template>
    </template>

    <div v-if="isTerminalError" class="sr-only" aria-live="assertive">
      {{ uiErrorMessage ?? "本地 fixture 读取失败，已安全停止。" }}
    </div>
  </section>
</template>

<style scoped>
.task-page__heading {
  align-items: flex-end;
}
.task-form-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(260px, 0.8fr);
  gap: 1rem;
  margin-top: 1rem;
}
.task-form-fields {
  display: grid;
  gap: 0.55rem;
}
.task-form-fields label,
.filter-field span {
  color: var(--muted);
  font-size: 0.72rem;
  font-weight: 800;
}
.task-form-fields input,
.task-form-fields textarea,
.filter-field input {
  width: 100%;
  padding: 0.65rem 0.7rem;
  border: 1px solid #c4d2cc;
  border-radius: 7px;
  color: var(--ink);
  background: var(--surface);
  font: inherit;
}
.task-form-fields textarea {
  resize: vertical;
}
.form-hint {
  margin: 0.25rem 0 0;
  color: var(--muted);
  font-size: 0.75rem;
  line-height: 1.45;
}
.boundary-list {
  display: grid;
  gap: 0.8rem;
  margin: 0;
  padding-left: 1.1rem;
  color: var(--muted);
  font-size: 0.8rem;
  line-height: 1.5;
}
.workflow-card,
.records-card {
  margin-top: 1rem;
}
.workflow-steps {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.8rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
.workflow-step {
  display: flex;
  gap: 0.7rem;
  padding: 0.85rem;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--surface-soft);
}
.workflow-step--done {
  border-color: #b8ddd5;
  background: #f2faf8;
}
.workflow-step__number {
  display: grid;
  width: 1.6rem;
  height: 1.6rem;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 50%;
  color: var(--accent-deep);
  background: var(--accent-soft);
  font-weight: 800;
}
.workflow-step strong {
  display: block;
  color: var(--ink);
  font-size: 0.8rem;
}
.workflow-step p {
  margin: 0.28rem 0 0;
  color: var(--muted);
  font-size: 0.72rem;
  line-height: 1.4;
}
.filter-field {
  display: grid;
  max-width: 360px;
  gap: 0.35rem;
  margin-bottom: 0.9rem;
}
.task-records-table {
  min-width: 620px;
}
.task-dry-run {
  margin-top: 1rem;
}
.task-receipt {
  display: block;
}
.receipt-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.65rem;
  margin: 0.9rem 0 0;
}
.receipt-grid div {
  padding: 0.6rem;
  border: 1px solid #c8e5dc;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.64);
}
.receipt-grid dt {
  color: var(--muted);
  font-size: 0.68rem;
}
.receipt-grid dd {
  margin: 0.25rem 0 0;
  color: var(--ink);
  font-size: 0.75rem;
  font-weight: 800;
  overflow-wrap: anywhere;
}
.task-audit {
  margin-top: 1rem;
}

@media (max-width: 780px) {
  .task-form-grid,
  .workflow-steps {
    grid-template-columns: 1fr;
  }
  .receipt-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 420px) {
  .receipt-grid {
    grid-template-columns: 1fr;
  }
}
</style>
