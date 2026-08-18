<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import AuditTrail from "../../components/AuditTrail.vue";
import MetricCard from "../../components/MetricCard.vue";
import UiButton from "../../components/shared/UiButton.vue";
import UiCard from "../../components/shared/UiCard.vue";
import UiState from "../../components/shared/UiState.vue";
import {
  LocalScenarioSchema,
  localScenarios,
  type LocalScenario,
} from "../../core/contracts/local";
import type { DemoRole, PageAction } from "../../core/mock/contracts";
import {
  getOperationsFixture,
  type OperationsRecord,
  type OperationsRecordStatus,
} from "../../core/fixtures/operations";
import { usePagesStore } from "../../stores/pages";
import { roleCanAccess, useSessionStore } from "../../stores/session";

const route = useRoute();
const router = useRouter();
const pages = usePagesStore();
const session = useSessionStore();

const selectedScenario = ref<LocalScenario>("success");
const queryText = ref("");
const selectedStatus = ref<"all" | OperationsRecordStatus>("all");
const pendingAction = ref<PageAction | null>(null);

const roleLabels: Record<DemoRole, string> = {
  operator: "操作员",
  viewer: "观察员",
  reviewer: "复核员",
};

const scenarioLabels: Record<LocalScenario, string> = {
  success: "成功",
  empty: "空资料",
  error: "错误",
  "permission-denied": "权限拒绝",
  timeout: "超时",
  fallback: "回退",
};

const fixtureKey = computed(() =>
  String(route.meta.fixtureKey ?? "device-manager"),
);
const fixture = computed(() => getOperationsFixture(fixtureKey.value));
const page = computed(() => pages.page);
const artifacts = computed(() => pages.response?.artifacts ?? {});
const routeRequiredRole = computed<DemoRole>(
  () => (route.meta.requiredRole as DemoRole | undefined) ?? "operator",
);

const statusFilterOptions = computed(() => {
  const kind = fixture.value?.kind;
  return (fixture.value?.filters.slice(1) ?? [])
    .map((label) => {
      const value: OperationsRecordStatus =
        label === "可用" || label === "可分配"
          ? "ready"
          : label === "已验证" || label === "在线" || label === "运行中"
            ? "healthy"
            : label === "需复核"
              ? kind === "device"
                ? "degraded"
                : "review"
              : label === "已暂停"
                ? "paused"
                : label === "已停止"
                  ? "stopped"
                  : "review";
      return { label, value };
    })
    .filter(
      (option, index, options) =>
        options.findIndex((candidate) => candidate.value === option.value) ===
        index,
    );
});

const hasPermission = computed(() =>
  roleCanAccess(session.active_role, routeRequiredRole.value),
);

const queryScenario = computed<LocalScenario>(() => {
  if (!hasPermission.value) return "permission-denied";
  const value = route.query.scenario;
  const candidate = typeof value === "string" ? value : "success";
  return LocalScenarioSchema.safeParse(candidate).success
    ? (candidate as LocalScenario)
    : "success";
});

const errorState = computed<"error" | "permission-denied" | "timeout">(() => {
  if (
    pages.state === "permission-denied" ||
    pages.state === "timeout" ||
    pages.state === "error"
  ) {
    return pages.state;
  }
  return "error";
});

const displayRecords = computed<OperationsRecord[]>(() => {
  if (!page.value || !fixture.value) return [];

  // The response controls whether records are present and supplies the
  // readback timestamp. Domain fixtures provide the typed resource labels.
  return page.value.records.map((record, index) => {
    const sample = fixture.value?.records[index % fixture.value.records.length];
    if (!sample)
      return {
        id: record.id,
        name: record.primary,
        detail: record.secondary,
        status: "review",
        status_label_zh_cn: record.status,
        owner: record.owner === "reviewer" ? "reviewer" : "operator",
        updated_at: record.updated_at,
        metadata: {},
      } satisfies OperationsRecord;

    return {
      ...sample,
      id: record.id,
      name: sample.name || record.primary,
      detail: sample.detail || record.secondary,
      updated_at: record.updated_at,
      owner: record.owner === "reviewer" ? "reviewer" : sample.owner,
    };
  });
});

const filteredRecords = computed(() => {
  const needle = queryText.value.trim().toLowerCase();
  return displayRecords.value.filter((record) => {
    const matchesStatus =
      selectedStatus.value === "all" || record.status === selectedStatus.value;
    const matchesText =
      needle.length === 0 ||
      `${record.name} ${record.detail} ${record.id}`
        .toLowerCase()
        .includes(needle);
    return matchesStatus && matchesText;
  });
});

watch(
  [fixtureKey, queryScenario],
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

function confirmDryRun(action: PageAction) {
  pendingAction.value = action;
}

function applyDryRun() {
  if (!pendingAction.value) return;
  pages.runDryRun(pendingAction.value.id, session.active_role);
  pendingAction.value = null;
}

function formatStatus(status: OperationsRecordStatus) {
  const labels: Record<OperationsRecordStatus, string> = {
    ready: "可用",
    review: "待复核",
    paused: "已暂停",
    degraded: "需复核",
    healthy: "运行中",
    stopped: "已停止",
  };
  return labels[status];
}

function statusTone(status: OperationsRecordStatus) {
  if (status === "review" || status === "degraded") return "medium";
  if (status === "paused" || status === "stopped") return "high";
  return "low";
}
</script>

<template>
  <section class="operations-page" aria-labelledby="operations-title">
    <div class="page-heading operations-heading">
      <div>
        <span class="section-kicker">{{
          fixture?.eyebrow_zh_cn ?? "运营资源"
        }}</span>
        <h1 id="operations-title">
          {{ fixture?.title_zh_cn ?? route.meta.label }}
        </h1>
        <p class="lead">
          {{
            fixture?.description_zh_cn ??
            "此页面只加载本地 fixture，不连接真实后端。"
          }}
        </p>
      </div>

      <div class="control-stack operations-controls">
        <label for="operations-scenario">场景</label>
        <select
          id="operations-scenario"
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
        <span>接口：/api/mock/pages/{{ fixtureKey }}</span>
      </div>
    </div>

    <div class="session-strip" aria-label="本地演示角色">
      <span>当前角色</span>
      <button
        v-for="role in session.roles"
        :key="role"
        class="role-button"
        :class="{ 'role-button--active': role === session.active_role }"
        type="button"
        @click="session.setRole(role)"
      >
        {{ roleLabels[role] }}
      </button>
      <strong v-if="!hasPermission">当前角色没有权限</strong>
    </div>

    <div class="operations-toolbar" role="toolbar" aria-label="资源筛选">
      <label class="operations-search">
        <span class="sr-only">搜索资源</span>
        <input
          v-model="queryText"
          type="search"
          placeholder="搜索资源名称或标识"
        />
      </label>
      <label class="operations-filter">
        <span class="sr-only">状态筛选</span>
        <select v-model="selectedStatus" aria-label="状态筛选">
          <option value="all">全部状态</option>
          <option
            v-for="filter in statusFilterOptions"
            :key="filter.value"
            :value="filter.value"
          >
            {{ filter.label }}
          </option>
        </select>
      </label>
      <span class="operations-scope">范围：local-fixture · 只读观察</span>
    </div>

    <UiState
      v-if="pages.state === 'loading'"
      kind="loading"
      title="正在读取资源"
      description="正在读取本地演示数据，不会连接外部服务。"
    />

    <template
      v-else-if="
        ['error', 'permission-denied', 'timeout'].includes(pages.state)
      "
    >
      <UiState
        :kind="errorState"
        :title="
          errorState === 'permission-denied'
            ? '权限不足'
            : errorState === 'timeout'
              ? '读取超时'
              : '读取失败'
        "
        :description="pages.error?.message"
        @action="retry"
      />
      <AuditTrail :audit="pages.activeAudit" :artifacts="artifacts" />
    </template>

    <template v-else-if="page && fixture">
      <UiState
        v-if="pages.state === 'fallback'"
        kind="fallback"
        title="正在使用回退数据"
        description="当前显示本地旧快照；所有外部变更保持关闭。"
      />

      <div class="metric-grid" aria-label="资源指标">
        <MetricCard
          v-for="metric in page.metrics"
          :key="metric.label"
          :label="metric.label"
          :value="metric.value"
          :detail="metric.detail"
          :tone="metric.tone"
        />
      </div>

      <div class="operations-grid">
        <UiCard
          class="operations-table-card"
          :title="`${fixture.title_zh_cn}清单`"
          :subtitle="`共 ${filteredRecords.length} 条本地样本`"
        >
          <template #header>
            <div class="operations-card-heading">
              <div>
                <span class="section-kicker">{{ fixture.eyebrow_zh_cn }}</span>
                <h2 class="ui-card__title">{{ fixture.title_zh_cn }}清单</h2>
                <p class="ui-card__subtitle">
                  共 {{ filteredRecords.length }} 条本地样本
                </p>
              </div>
              <UiButton
                v-if="page.actions.length > 0"
                variant="primary"
                :disabled="!hasPermission || pages.state === 'fallback'"
                @click="confirmDryRun(page.actions[0])"
              >
                {{ fixture.primary_action_zh_cn }}
              </UiButton>
            </div>
          </template>

          <div
            v-if="pages.state === 'empty' || filteredRecords.length === 0"
            class="empty-state"
            role="status"
          >
            <span class="empty-icon" aria-hidden="true">○</span>
            <h3>暂无符合条件的资源</h3>
            <p>本地 fixture 正常响应，但当前场景或筛选条件没有记录。</p>
          </div>

          <div v-else class="table-wrap">
            <table class="signals-table operations-table">
              <thead>
                <tr>
                  <th scope="col">{{ fixture.columns_zh_cn[0] }}</th>
                  <th scope="col">{{ fixture.columns_zh_cn[1] }}</th>
                  <th scope="col">{{ fixture.columns_zh_cn[2] }}</th>
                  <th scope="col">{{ fixture.columns_zh_cn[3] }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="record in filteredRecords" :key="record.id">
                  <th scope="row">
                    {{ record.name }}
                    <span class="muted-line">{{ record.id }}</span>
                  </th>
                  <td>
                    <span class="muted-line operations-detail">{{
                      record.detail
                    }}</span>
                    <span
                      v-for="(value, key) in record.metadata"
                      :key="key"
                      class="operations-meta"
                    >
                      {{ key }}: {{ value }}
                    </span>
                  </td>
                  <td>
                    <span
                      class="severity-pill"
                      :class="`severity-pill--${statusTone(record.status)}`"
                    >
                      {{
                        record.status_label_zh_cn || formatStatus(record.status)
                      }}
                    </span>
                  </td>
                  <td class="muted-cell">{{ record.updated_at }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </UiCard>

        <AuditTrail :audit="pages.activeAudit" :artifacts="artifacts" />
      </div>

      <section class="next-actions" aria-labelledby="operations-next-actions">
        <div>
          <span class="section-kicker">安全范围</span>
          <h2 id="operations-next-actions">保持本地证据边界</h2>
        </div>
        <ul>
          <li
            v-for="action in pages.response?.next_actions ?? []"
            :key="action"
          >
            {{ action }}
          </li>
        </ul>
      </section>

      <section
        v-if="page.actions.length > 0"
        class="dry-run-panel operations-dry-run"
        aria-labelledby="operations-dry-run-title"
      >
        <div>
          <span class="section-kicker">本地 dry-run</span>
          <h2 id="operations-dry-run-title">确认后只生成本地审计</h2>
          <p>操作按钮保留流程预览，但不会调用真实后端或修改资源。</p>
        </div>
        <div class="dry-run-actions">
          <UiButton
            v-for="action in page.actions"
            :key="action.id"
            :disabled="!hasPermission || pages.state === 'fallback'"
            @click="confirmDryRun(action)"
          >
            {{ action.label_zh_cn }}
          </UiButton>
        </div>
      </section>

      <section
        v-if="pendingAction"
        class="confirm-panel"
        aria-labelledby="operations-confirm-title"
      >
        <h2 id="operations-confirm-title">确认本地模拟操作</h2>
        <p>{{ pendingAction.label_zh_cn }} 不会产生外部请求或真实变更。</p>
        <UiButton variant="primary" @click="applyDryRun">确认 dry-run</UiButton>
        <UiButton @click="pendingAction = null">取消</UiButton>
      </section>

      <section
        v-if="pages.receipt"
        class="receipt-panel"
        role="status"
        aria-label="本地 dry-run 回执"
      >
        <strong>{{ pages.receipt.summary }}</strong>
        <p>mutation_applied: {{ pages.receipt.mutation_applied }}</p>
        <p>readback: {{ pages.receipt.readback }}</p>
      </section>
    </template>
  </section>
</template>

<style scoped>
.operations-page {
  padding: clamp(0.5rem, 2vw, 1.5rem) 0 3rem;
}

.operations-heading {
  align-items: flex-start;
}

.operations-controls {
  margin-top: 0.25rem;
}

.operations-toolbar {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  margin-bottom: 1.25rem;
  padding: 0.7rem;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.72);
}

.operations-search {
  flex: 1 1 18rem;
}

.operations-search input,
.operations-filter select {
  width: 100%;
  min-height: 2.25rem;
  padding: 0 0.7rem;
  border: 1px solid #c4d2cc;
  border-radius: 7px;
  color: var(--ink);
  background: var(--surface);
}

.operations-filter {
  flex: 0 1 11rem;
}

.operations-scope {
  color: var(--muted);
  font-size: 0.72rem;
  white-space: nowrap;
}

.operations-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.65fr) minmax(260px, 0.8fr);
  gap: 1rem;
  margin-top: 1rem;
}

.operations-table-card {
  min-width: 0;
  overflow: hidden;
}

.operations-card-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  width: 100%;
}

.operations-detail,
.operations-meta {
  display: block;
}

.operations-meta {
  margin-top: 0.2rem;
  color: var(--muted);
  font-size: 0.68rem;
}

.operations-table {
  min-width: 620px;
}

.operations-dry-run {
  margin-top: 1rem;
}

@media (max-width: 780px) {
  .operations-toolbar {
    align-items: stretch;
    flex-direction: column;
  }

  .operations-filter {
    flex-basis: auto;
  }

  .operations-scope {
    white-space: normal;
  }

  .operations-grid {
    grid-template-columns: 1fr;
  }

  .operations-card-heading {
    flex-direction: column;
  }
}
</style>
