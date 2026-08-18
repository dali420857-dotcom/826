<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import AuditTrail from "../components/AuditTrail.vue";
import LoadStatePanel from "../components/LoadStatePanel.vue";
import MetricCard from "../components/MetricCard.vue";
import StatusBanner from "../components/StatusBanner.vue";
import { usePagesStore } from "../stores/pages";
import { roleCanAccess, useSessionStore } from "../stores/session";
import {
  localScenarios,
  LocalScenarioSchema,
  type LocalScenario,
} from "../core/contracts/local";
import type { DemoRole, LoadState, PageAction } from "../core/mock/contracts";
import { getRouteEntry } from "../shared/route-registry";

const route = useRoute();
const router = useRouter();
const pages = usePagesStore();
const session = useSessionStore();
const selectedScenario = ref<LocalScenario>("success");
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

const fixtureKey = computed(() => String(route.meta.fixtureKey ?? "index"));
const routeEntry = computed(() => getRouteEntry(route.path));
const artifacts = computed(() => pages.response?.artifacts ?? {});
const page = computed(() => pages.page);
const hasPermission = computed(() => canAccess(session.active_role));
const showErrorPanel = computed(() =>
  ["error", "permission-denied", "timeout"].includes(pages.state),
);
const errorState = computed<
  Extract<LoadState, "error" | "permission-denied" | "timeout">
>(() => {
  if (pages.state === "permission-denied" || pages.state === "timeout")
    return pages.state;
  return "error";
});

const queryScenario = computed<LocalScenario>(() => {
  if (!hasPermission.value) return "permission-denied";
  const value = route.query.scenario;
  const candidate = typeof value === "string" ? value : "success";
  return LocalScenarioSchema.safeParse(candidate).success
    ? (candidate as LocalScenario)
    : "success";
});

function canAccess(role: DemoRole) {
  const required = routeEntry.value?.required_role ?? "viewer";
  return roleCanAccess(role, required);
}

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
</script>

<template>
  <section class="page-dashboard" aria-labelledby="page-title">
    <div class="page-heading">
      <div>
        <span class="section-kicker">本地 clean-room 页面</span>
        <h1 id="page-title">{{ page?.title_zh_cn ?? route.meta.label }}</h1>
        <p class="lead">
          {{
            page?.description_zh_cn ??
            "此页面只加载本地 fixture，不连接真实后端。"
          }}
        </p>
      </div>
      <div class="control-stack">
        <label for="scenario">场景</label>
        <select
          id="scenario"
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

    <StatusBanner
      :state="pages.state"
      :summary="pages.response?.summary"
      :error-message="pages.error?.message ?? ''"
    />

    <div
      v-if="pages.state === 'loading'"
      class="loading-grid"
      aria-busy="true"
      aria-label="正在加载页面资料"
    >
      <div v-for="slot in 4" :key="slot" class="skeleton-card" />
      <div class="skeleton-table" />
    </div>

    <template v-else-if="showErrorPanel">
      <LoadStatePanel
        :state="errorState"
        :message="pages.error?.message ?? ''"
        @retry="retry"
      />
      <AuditTrail :audit="pages.activeAudit" :artifacts="artifacts" />
    </template>

    <template v-else-if="page">
      <div class="metric-grid" aria-label="页面指标">
        <MetricCard
          v-for="metric in page.metrics"
          :key="metric.label"
          :label="metric.label"
          :value="metric.value"
          :detail="metric.detail"
          :tone="metric.tone"
        />
      </div>

      <div class="content-grid">
        <section class="panel signals-panel" aria-labelledby="records-title">
          <div class="panel-heading">
            <div>
              <span class="section-kicker">{{ page.page_type }}</span>
              <h2 id="records-title">本地样本</h2>
            </div>
            <span
              class="freshness-label"
              :class="`freshness-label--${page.freshness}`"
            >
              {{ page.freshness === "fresh" ? "新鲜读回" : "缓存读回" }}
            </span>
          </div>

          <div v-if="pages.state === 'empty'" class="empty-state" role="status">
            <span class="empty-icon" aria-hidden="true">○</span>
            <h3>没有符合条件的本地样本</h3>
            <p>fixture 正常响应，但当前场景没有资料。</p>
          </div>

          <div v-else class="table-wrap">
            <table class="signals-table">
              <thead>
                <tr>
                  <th scope="col">对象</th>
                  <th scope="col">状态</th>
                  <th scope="col">负责人</th>
                  <th scope="col">更新时间</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="record in page.records" :key="record.id">
                  <th scope="row">
                    {{ record.primary }}
                    <span class="muted-line">{{ record.secondary }}</span>
                  </th>
                  <td>
                    <span class="severity-pill severity-pill--low">
                      {{ record.status }}
                    </span>
                  </td>
                  <td class="muted-cell">{{ record.owner }}</td>
                  <td class="muted-cell">{{ record.updated_at }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <AuditTrail :audit="pages.activeAudit" :artifacts="artifacts" />
      </div>

      <section
        v-if="page.actions.length > 0"
        class="dry-run-panel"
        aria-labelledby="dry-run-title"
      >
        <div>
          <span class="section-kicker">本地 dry-run</span>
          <h2 id="dry-run-title">确认后只生成本地审计</h2>
          <p>
            所有按钮保留交互流程，但不会调用真实后端。回执固定显示
            mutation_applied: false。
          </p>
        </div>
        <div class="dry-run-actions">
          <button
            v-for="action in page.actions"
            :key="action.id"
            class="secondary-button"
            type="button"
            @click="confirmDryRun(action)"
          >
            {{ action.label_zh_cn }}
          </button>
        </div>
      </section>

      <section
        v-if="pendingAction"
        class="confirm-panel"
        aria-labelledby="confirm-title"
      >
        <h2 id="confirm-title">确认本地模拟操作</h2>
        <p>{{ pendingAction.label_zh_cn }} 不会产生外部请求或真实变更。</p>
        <button class="secondary-button" type="button" @click="applyDryRun">
          确认 dry-run
        </button>
        <button
          class="secondary-button"
          type="button"
          @click="pendingAction = null"
        >
          取消
        </button>
      </section>

      <section v-if="pages.receipt" class="receipt-panel" role="status">
        <strong>{{ pages.receipt.summary }}</strong>
        <p>mutation_applied: {{ pages.receipt.mutation_applied }}</p>
        <p>readback: {{ pages.receipt.readback }}</p>
      </section>
    </template>
  </section>
</template>
