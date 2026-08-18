<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import AuditTrail from "../components/AuditTrail.vue";
import FraudSignalsTable from "../components/FraudSignalsTable.vue";
import LoadStatePanel from "../components/LoadStatePanel.vue";
import MetricCard from "../components/MetricCard.vue";
import StatusBanner from "../components/StatusBanner.vue";
import { useFraudStore } from "../stores/fraud";
import {
  fraudScenarios,
  FraudScenarioSchema,
  type FraudLoadState,
  type FraudScenario,
} from "../core/fraud/contracts";

const route = useRoute();
const router = useRouter();
const fraud = useFraudStore();
const selectedScenario = ref<FraudScenario>("success");

const scenarioLabels: Record<FraudScenario, string> = {
  success: "成功读回",
  empty: "空窗口",
  error: "服务错误",
  "permission-denied": "权限拒绝",
  timeout: "请求超时",
  fallback: "只读回退",
};

const scenarioHelp: Record<FraudScenario, string> = {
  success: "从本地 fixture 读回新的风险信号。",
  empty: "窗口有效，但没有匹配的风险信号。",
  error: "服务错误后安全停止流程。",
  "permission-denied": "当前策略拒绝了观察范围。",
  timeout: "在安全时限内没有取得读回。",
  fallback: "显示过期快照，所有变更路径关闭。",
};

const queryScenario = computed<FraudScenario>(() => {
  const value = route.query.scenario;
  const candidate = typeof value === "string" ? value : "success";
  return FraudScenarioSchema.safeParse(candidate).success
    ? (candidate as FraudScenario)
    : "success";
});

const overview = computed(() => fraud.overview);
const artifacts = computed(() => fraud.response?.artifacts ?? {});
const errorMessage = computed(() => fraud.error?.message ?? "");
const errorState = computed<
  Extract<FraudLoadState, "error" | "permission-denied" | "timeout">
>(() => {
  if (fraud.state === "permission-denied" || fraud.state === "timeout")
    return fraud.state;
  return "error";
});
const showErrorPanel = computed(() =>
  ["error", "permission-denied", "timeout"].includes(fraud.state),
);

watch(
  queryScenario,
  (scenario) => {
    selectedScenario.value = scenario;
    void fraud.load(scenario);
  },
  { immediate: true },
);

function selectScenario() {
  void router.replace({
    query: { ...route.query, scenario: selectedScenario.value },
  });
}

function retry() {
  void fraud.load(selectedScenario.value);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function displayNextAction(action: string) {
  const translations: Record<string, string> = {
    "Review high-severity signals before any approved operation.":
      "任何获批操作前先复核高风险信号。",
    "Keep monitoring the next review window.": "继续观察下一个复核窗口。",
    "Do not start a mutation while the provider is unavailable.":
      "服务不可用时暂停所有变更动作。",
    "Revalidate provider health before requesting a fresh readback.":
      "请求新鲜读回前先重新验证服务健康状态。",
    "Request the observation scope from an authorized operator.":
      "请向已授权操作员申请观察范围。",
    "Retry once after checking local fixture health.":
      "检查本地 fixture 健康状态后重试一次。",
  };
  return translations[action] ?? action;
}
</script>

<template>
  <section class="fraud-page" aria-labelledby="fraud-title">
    <div class="page-heading">
      <div>
        <span class="section-kicker">观察能力 · 必须读回</span>
        <h1 id="fraud-title">风险防护</h1>
        <p class="lead">
          通过可审计的本地 fixture
          查看风险信号，不触碰外部账户、设备或付款状态。
        </p>
      </div>
      <div class="scenario-control">
        <label for="scenario">本地场景</label>
        <select
          id="scenario"
          v-model="selectedScenario"
          @change="selectScenario"
        >
          <option
            v-for="scenario in fraudScenarios"
            :key="scenario"
            :value="scenario"
          >
            {{ scenarioLabels[scenario] }}
          </option>
        </select>
        <span>{{ scenarioHelp[selectedScenario] }}</span>
      </div>
    </div>

    <StatusBanner
      :state="fraud.state"
      :summary="fraud.response?.summary"
      :error-message="errorMessage"
    />

    <div
      v-if="fraud.state === 'loading'"
      class="loading-grid"
      aria-busy="true"
      aria-label="正在加载风险信号"
    >
      <div v-for="slot in 4" :key="slot" class="skeleton-card" />
      <div class="skeleton-table" />
    </div>

    <template v-else-if="showErrorPanel">
      <LoadStatePanel
        :state="errorState"
        :message="errorMessage"
        @retry="retry"
      />
      <AuditTrail :audit="fraud.activeAudit" :artifacts="artifacts" />
    </template>

    <template v-else-if="overview">
      <div class="metric-grid" aria-label="风险复核指标">
        <MetricCard
          label="已复核"
          :value="formatNumber(overview.total_reviewed)"
          detail="本地时间窗口"
          tone="teal"
        />
        <MetricCard
          label="风险分数"
          :value="`${overview.risk_score}/100`"
          detail="当前本地分数"
          tone="amber"
        />
        <MetricCard
          label="已暂存"
          :value="formatNumber(overview.blocked_count)"
          detail="需要授权复核"
          tone="red"
        />
        <MetricCard
          label="待复核"
          :value="formatNumber(overview.review_count)"
          detail="人工决策队列"
          tone="neutral"
        />
      </div>

      <div class="content-grid">
        <section class="panel signals-panel" aria-labelledby="signals-title">
          <div class="panel-heading">
            <div>
              <span class="section-kicker">风险队列</span>
              <h2 id="signals-title">风险信号</h2>
            </div>
            <span
              class="freshness-label"
              :class="`freshness-label--${overview.freshness}`"
            >
              {{ overview.freshness === "fresh" ? "新鲜读回" : "缓存读回" }}
            </span>
          </div>
          <div v-if="fraud.state === 'empty'" class="empty-state" role="status">
            <span class="empty-icon" aria-hidden="true">○</span>
            <h3>当前窗口没有信号</h3>
            <p>fixture 响应正常，但当前没有需要复核的内容。</p>
          </div>
          <FraudSignalsTable v-else :signals="overview.signals" />
        </section>

        <AuditTrail :audit="fraud.activeAudit" :artifacts="artifacts" />
      </div>

      <section class="next-actions" aria-labelledby="next-actions-title">
        <div>
          <span class="section-kicker">安全下一步</span>
          <h2 id="next-actions-title">保持证据边界</h2>
        </div>
        <ul>
          <li
            v-for="action in fraud.response?.next_actions ?? []"
            :key="action"
          >
            {{ displayNextAction(action) }}
          </li>
        </ul>
      </section>
    </template>
  </section>
</template>
