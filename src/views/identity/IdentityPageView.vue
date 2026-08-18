<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import AuditTrail from "../../components/AuditTrail.vue";
import LoadStatePanel from "../../components/LoadStatePanel.vue";
import MetricCard from "../../components/MetricCard.vue";
import StatusBanner from "../../components/StatusBanner.vue";
import {
  identityFixtures,
  type IdentityFixtureId,
} from "../../core/fixtures/identity";
import {
  LocalScenarioSchema,
  localScenarios,
  type LocalScenario,
} from "../../core/contracts/local";
import type {
  DemoRole,
  LoadState,
  PageAction,
} from "../../core/mock/contracts";
import { usePagesStore } from "../../stores/pages";
import { roleCanAccess, useSessionStore } from "../../stores/session";

const props = defineProps<{ pageId: IdentityFixtureId }>();

const route = useRoute();
const router = useRouter();
const pages = usePagesStore();
const session = useSessionStore();
const selectedScenario = ref<LocalScenario>("success");
const pendingAction = ref<PageAction | null>(null);

const fixture = computed(() => identityFixtures[props.pageId]);
const page = computed(() => pages.page);
const activeAudit = computed(() => pages.activeAudit);
const artifacts = computed(() => pages.response?.artifacts ?? {});
const showErrorPanel = computed(() =>
  ["error", "permission-denied", "timeout"].includes(pages.state),
);
const errorState = computed<
  Extract<LoadState, "error" | "permission-denied" | "timeout">
>(() => {
  if (pages.state === "permission-denied" || pages.state === "timeout") {
    return pages.state;
  }
  return "error";
});

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

const queryScenario = computed<LocalScenario>(() => {
  if (!hasPermission.value) return "permission-denied";
  const value = route.query.scenario;
  const candidate = typeof value === "string" ? value : "success";
  return LocalScenarioSchema.safeParse(candidate).success
    ? (candidate as LocalScenario)
    : "success";
});

const hasPermission = computed(() =>
  roleCanAccess(session.active_role, fixture.value.required_role),
);

const title = computed(
  () => page.value?.title_zh_cn ?? fixture.value.title_zh_cn,
);
const description = computed(
  () => page.value?.description_zh_cn ?? fixture.value.description_zh_cn,
);
const metrics = computed(() => {
  if (page.value) {
    return page.value.metrics.map((metric) => ({
      label: metric.label,
      value: metric.value,
      detail: metric.detail,
      tone: metric.tone,
    }));
  }
  return fixture.value.metrics.map((metric) => ({
    label: metric.label_zh_cn,
    value: metric.value,
    detail: metric.detail_zh_cn,
    tone: metric.tone,
  }));
});
const records = computed(() => page.value?.records ?? []);
const actions = computed(() =>
  (page.value?.actions ?? []).filter(
    () => pages.state === "success" && fixture.value.supports_dry_run,
  ),
);
const isFallback = computed(() => pages.state === "fallback");
const isLogin = computed(() => props.pageId === "login");
const isOverview = computed(() => props.pageId === "index");
const isProfile = computed(() => props.pageId === "user-info");
const isPassword = computed(() => props.pageId === "reset-password");
const isStatistics = computed(() => props.pageId === "account-statistics");
const isIntelligence = computed(() => props.pageId === "intelligence");

watch(
  [queryScenario, () => session.active_role],
  ([scenario]) => {
    selectedScenario.value = scenario;
    void pages.load(props.pageId, scenario);
  },
  { immediate: true },
);

function selectScenario() {
  void router.replace({
    query: { ...route.query, scenario: selectedScenario.value },
  });
}

function retry() {
  void pages.load(props.pageId, selectedScenario.value);
}

function confirmDryRun(action: PageAction) {
  pendingAction.value = action;
}

function applyDryRun() {
  if (!pendingAction.value || isFallback.value) return;
  pages.runDryRun(pendingAction.value.id, session.active_role);
  pendingAction.value = null;
}

function cancelDryRun() {
  pendingAction.value = null;
}
</script>

<template>
  <section
    class="page-dashboard identity-page"
    :aria-labelledby="`${pageId}-title`"
  >
    <div class="page-heading">
      <div>
        <span class="section-kicker">{{ fixture.eyebrow_zh_cn }}</span>
        <h1 :id="`${pageId}-title`">{{ title }}</h1>
        <p class="lead">{{ description }}</p>
      </div>
      <div class="control-stack">
        <label for="identity-scenario">本地场景</label>
        <select
          id="identity-scenario"
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
        <span>接口：/api/mock/pages/{{ props.pageId }}</span>
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
      aria-label="正在加载身份页面资料"
    >
      <div v-for="slot in 3" :key="slot" class="skeleton-card" />
      <div class="skeleton-table" />
    </div>

    <template v-else-if="showErrorPanel">
      <LoadStatePanel
        :state="errorState"
        :message="pages.error?.message ?? ''"
        @retry="retry"
      />
      <AuditTrail :audit="activeAudit" :artifacts="artifacts" />
    </template>

    <template v-else-if="page || pages.state === 'empty'">
      <div class="metric-grid" aria-label="身份页面指标">
        <MetricCard
          v-for="metric in metrics"
          :key="metric.label"
          :label="metric.label"
          :value="metric.value"
          :detail="metric.detail"
          :tone="metric.tone"
        />
      </div>

      <section
        v-if="isLogin"
        class="identity-callout"
        aria-labelledby="login-demo-title"
      >
        <div>
          <span class="section-kicker">安全入口</span>
          <h2 id="login-demo-title">选择本地演示角色</h2>
          <p>不会验证真实账号或密码，也不会建立远程会话。</p>
        </div>
        <div class="identity-callout-actions">
          <button
            v-for="role in session.roles"
            :key="`login-${role}`"
            class="secondary-button"
            type="button"
            @click="session.setRole(role)"
          >
            以{{ roleLabels[role] }}继续
          </button>
        </div>
      </section>

      <section
        v-if="isProfile"
        class="identity-profile"
        aria-labelledby="profile-title"
      >
        <div class="profile-avatar" aria-hidden="true">D</div>
        <div>
          <span class="section-kicker">本地身份</span>
          <h2 id="profile-title">本地演示操作者</h2>
          <p>
            角色：{{ roleLabels[session.active_role] }} · 来源：local-fixture
          </p>
        </div>
        <span class="freshness-label freshness-label--fresh">无凭证</span>
      </section>

      <section
        v-if="isPassword"
        class="identity-callout"
        aria-labelledby="password-demo-title"
      >
        <div>
          <span class="section-kicker">dry-run 操作</span>
          <h2 id="password-demo-title">模拟密码重置</h2>
          <p>确认后只生成本地审计回执；不会接收、保存或发送真实密码。</p>
        </div>
        <button
          class="secondary-button"
          type="button"
          :disabled="actions.length === 0"
          @click="actions[0] && confirmDryRun(actions[0])"
        >
          预览重置流程
        </button>
      </section>

      <section
        v-if="isOverview"
        class="quick-links"
        aria-labelledby="quick-links-title"
      >
        <div class="panel-heading">
          <div>
            <span class="section-kicker">快捷入口</span>
            <h2 id="quick-links-title">从本地状态开始</h2>
          </div>
        </div>
        <div class="quick-link-grid">
          <RouterLink class="quick-link" to="/preventing_fraud">
            <strong>风险防护</strong>
            <span>查看风险信号与审计</span>
          </RouterLink>
          <RouterLink class="quick-link" to="/account_tatistics">
            <strong>账户统计</strong>
            <span>查看活跃度与风险分布</span>
          </RouterLink>
          <RouterLink class="quick-link" to="/intelligence">
            <strong>情报中心</strong>
            <span>整理公开面观察线索</span>
          </RouterLink>
        </div>
      </section>

      <section
        v-if="isStatistics"
        class="trend-panel"
        aria-labelledby="trend-title"
      >
        <div class="panel-heading">
          <div>
            <span class="section-kicker">本地趋势</span>
            <h2 id="trend-title">活跃度与风险分布</h2>
          </div>
          <span class="freshness-label freshness-label--fresh">只读</span>
        </div>
        <div class="trend-bars">
          <div
            v-for="(record, index) in fixture.records"
            :key="record.id"
            class="trend-row"
          >
            <span>{{ record.title_zh_cn }}</span>
            <div class="trend-track">
              <i :style="{ width: `${42 + index * 18}%` }" />
            </div>
            <strong>{{ 42 + index * 18 }}%</strong>
          </div>
        </div>
      </section>

      <section
        v-if="isIntelligence"
        class="intelligence-summary"
        aria-labelledby="intelligence-title"
      >
        <div>
          <span class="section-kicker">线索摘要</span>
          <h2 id="intelligence-title">观察边界保持开启</h2>
          <p>所有线索均来自本地脱敏样本；不会抓取受限页面或调用第三方账户。</p>
        </div>
        <span class="freshness-label freshness-label--fresh">公开面只读</span>
      </section>

      <div class="content-grid">
        <section
          class="panel signals-panel"
          aria-labelledby="identity-records-title"
        >
          <div class="panel-heading">
            <div>
              <span class="section-kicker">本地 fixture</span>
              <h2 id="identity-records-title">状态记录</h2>
            </div>
            <span
              class="freshness-label"
              :class="`freshness-label--${page?.freshness ?? 'fresh'}`"
            >
              {{ page?.freshness === "stale" ? "缓存读回" : "新鲜读回" }}
            </span>
          </div>

          <div v-if="pages.state === 'empty'" class="empty-state" role="status">
            <span class="empty-icon" aria-hidden="true">○</span>
            <h3>没有符合条件的本地记录</h3>
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
                <tr v-for="record in records" :key="record.id">
                  <th scope="row">
                    {{ record.primary }}
                    <span class="muted-line">{{ record.secondary }}</span>
                  </th>
                  <td>
                    <span class="severity-pill severity-pill--low">{{
                      record.status
                    }}</span>
                  </td>
                  <td class="muted-cell">{{ record.owner }}</td>
                  <td class="muted-cell">{{ record.updated_at }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <AuditTrail :audit="activeAudit" :artifacts="artifacts" />
      </div>

      <section
        v-if="actions.length > 0"
        class="dry-run-panel"
        aria-labelledby="identity-dry-run-title"
      >
        <div>
          <span class="section-kicker">本地 dry-run</span>
          <h2 id="identity-dry-run-title">确认后只生成本地审计</h2>
          <p>
            所有操作都不会调用真实后端，回执固定显示 mutation_applied: false。
          </p>
        </div>
        <div class="dry-run-actions">
          <button
            v-for="action in actions"
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
        aria-labelledby="identity-confirm-title"
      >
        <h2 id="identity-confirm-title">确认本地模拟操作</h2>
        <p>{{ pendingAction.label_zh_cn }}不会产生外部请求或真实变更。</p>
        <button class="secondary-button" type="button" @click="applyDryRun">
          确认 dry-run
        </button>
        <button class="secondary-button" type="button" @click="cancelDryRun">
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

<style scoped>
.identity-callout,
.identity-profile,
.quick-links,
.trend-panel,
.intelligence-summary {
  margin-top: 1rem;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--surface);
  box-shadow: var(--shadow);
}

.identity-callout,
.identity-profile,
.intelligence-summary {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1.25rem;
  padding: 1.2rem;
}

.identity-callout h2,
.identity-profile h2,
.intelligence-summary h2 {
  margin: 0.35rem 0 0;
  color: var(--ink);
  font-size: 1.05rem;
}

.identity-callout p,
.identity-profile p,
.intelligence-summary p {
  margin: 0.45rem 0 0;
  color: var(--muted);
  font-size: 0.8rem;
  line-height: 1.55;
}

.identity-callout-actions,
.quick-link-grid {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.5rem;
}

.identity-profile {
  align-items: center;
  justify-content: flex-start;
}

.profile-avatar {
  display: grid;
  width: 3rem;
  height: 3rem;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 13px;
  color: #fff;
  background: var(--accent-deep);
  font-weight: 850;
}

.identity-profile .freshness-label {
  margin-left: auto;
}

.quick-links {
  overflow: hidden;
}

.quick-links .panel-heading,
.trend-panel .panel-heading {
  padding: 1.15rem 1.2rem;
}

.quick-link-grid {
  justify-content: stretch;
  padding: 0 1.2rem 1.2rem;
}

.quick-link {
  display: grid;
  min-width: 160px;
  flex: 1 1 160px;
  gap: 0.3rem;
  padding: 0.85rem;
  border: 1px solid var(--line);
  border-radius: 10px;
  color: var(--ink);
  background: var(--surface-soft);
  text-decoration: none;
}

.quick-link:hover {
  border-color: #b8ddd5;
  background: var(--accent-soft);
}

.quick-link strong {
  color: var(--accent-deep);
  font-size: 0.82rem;
}

.quick-link span {
  color: var(--muted);
  font-size: 0.72rem;
}

.trend-panel {
  overflow: hidden;
}

.trend-bars {
  display: grid;
  gap: 0.85rem;
  padding: 0 1.2rem 1.2rem;
}

.trend-row {
  display: grid;
  grid-template-columns: minmax(130px, 0.75fr) minmax(100px, 2fr) 45px;
  align-items: center;
  gap: 0.75rem;
  color: var(--muted);
  font-size: 0.75rem;
}

.trend-row strong {
  color: var(--ink);
  text-align: right;
}

.trend-track {
  height: 0.5rem;
  overflow: hidden;
  border-radius: 999px;
  background: var(--surface-soft);
}

.trend-track i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--accent), #74b9a9);
}

@media (max-width: 620px) {
  .identity-callout,
  .identity-profile,
  .intelligence-summary {
    display: block;
  }

  .identity-callout-actions {
    justify-content: flex-start;
    margin-top: 1rem;
  }

  .identity-profile .freshness-label {
    display: inline-flex;
    margin-top: 0.75rem;
    margin-left: 0;
  }

  .trend-row {
    grid-template-columns: 1fr 45px;
  }

  .trend-track {
    grid-column: 1 / -1;
    grid-row: 2;
  }

  .trend-row strong {
    grid-column: 2;
    grid-row: 1;
  }
}
</style>
