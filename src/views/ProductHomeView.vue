<!-- RETIREMENT MARKER — retired/disabled 2026-08-17. Historical `/index` page only; do not extend without explicit approval. -->
<script setup lang="ts">
import { computed, ref } from "vue";
import { RouterLink, useRoute } from "vue-router";
import ProductDrawer from "../components/product/ProductDrawer.vue";
import ProductModal from "../components/product/ProductModal.vue";

interface LocalTask {
  id: string;
  name: string;
  type: string;
  status: string;
  updated: string;
}

const route = useRoute();
const isCustomer = computed(() => route.query.system === "customer");
const title = computed(() =>
  isCustomer.value ? "客服系统工作台" : "TG Cloud 控制台",
);
const subtitle = computed(() =>
  isCustomer.value
    ? "统一处理本地工单与客户回访"
    : "统一管理帐号、设备与自动化任务",
);

const tasks = ref<LocalTask[]>([
  {
    id: "task-001",
    name: "早间帐号健康检查",
    type: "健康检查",
    status: "待执行",
    updated: "今天 08:30",
  },
  {
    id: "task-002",
    name: "代理池可用性巡检",
    type: "代理管理",
    status: "已完成",
    updated: "昨天 21:10",
  },
  {
    id: "task-003",
    name: "客服未读工单汇总",
    type: "工单管理",
    status: "草稿",
    updated: "昨天 18:45",
  },
]);
const taskDialogOpen = ref(false);
const taskName = ref("");
const selectedTask = ref<LocalTask | null>(null);
const notificationsOpen = ref(false);
const accountOpen = ref(false);
const toast = ref("");

function createDraft() {
  const name = taskName.value.trim();
  if (!name) return;
  tasks.value.unshift({
    id: `task-${String(tasks.value.length + 1).padStart(3, "0")}`,
    name,
    type: "本地草稿",
    status: "草稿",
    updated: "刚刚",
  });
  taskName.value = "";
  taskDialogOpen.value = false;
  toast.value = "草稿已建立，只保存在本地演示状态。";
  globalThis.setTimeout(() => (toast.value = ""), 2800);
}
</script>

<template>
  <section class="product-home" aria-labelledby="product-home-title">
    <header class="product-home__header">
      <div>
        <span class="product-kicker">{{
          isCustomer ? "CUSTOMER SERVICE" : "TG CLOUD CONTROL"
        }}</span>
        <h1 id="product-home-title">{{ title }}</h1>
        <p>{{ subtitle }}。这是可操作的本地离线版本。</p>
      </div>
      <div class="product-home__actions">
        <button
          class="product-quiet-button"
          type="button"
          @click="notificationsOpen = true"
        >
          通知 <span class="product-badge">3</span>
        </button>
        <button
          class="product-primary-button product-primary-button--add"
          type="button"
          @click="taskDialogOpen = true"
        >
          新增本地任务
        </button>
      </div>
    </header>

    <div class="product-home__notice">
      <span class="product-status-dot" aria-hidden="true" />
      <span
        ><strong>离线演示状态</strong> · 所有数据来自本地
        fixture；外部写入已关闭。</span
      >
      <button type="button" @click="accountOpen = true">查看边界</button>
    </div>

    <div class="product-stat-grid" aria-label="工作台指标">
      <article class="product-stat-card">
        <span>活跃帐号</span><strong>128</strong><small>较昨日 +8</small>
      </article>
      <article class="product-stat-card">
        <span>在线设备</span><strong>96</strong><small>本地健康读回</small>
      </article>
      <article class="product-stat-card">
        <span>待处理任务</span
        ><strong>{{
          tasks.filter((task) => task.status !== "已完成").length
        }}</strong
        ><small>含本地草稿</small>
      </article>
      <article class="product-stat-card product-stat-card--accent">
        <span>风险状态</span><strong>正常</strong
        ><small>最近读回 2 分钟前</small>
      </article>
    </div>

    <div class="product-home__grid">
      <section
        class="product-panel product-panel--wide"
        aria-labelledby="task-list-title"
      >
        <header class="product-panel__header">
          <div>
            <span class="product-kicker">QUEUE</span>
            <h2 id="task-list-title">最近任务</h2>
          </div>
          <RouterLink to="/task_manager">查看全部 →</RouterLink>
        </header>
        <div class="product-table-wrap">
          <table class="product-table">
            <thead>
              <tr>
                <th scope="col">任务</th>
                <th scope="col">类型</th>
                <th scope="col">状态</th>
                <th scope="col">更新时间</th>
                <th scope="col"><span class="sr-only">操作</span></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="task in tasks" :key="task.id">
                <th scope="row">
                  <button
                    class="product-table-link"
                    type="button"
                    @click="selectedTask = task"
                  >
                    {{ task.name }}</button
                  ><small>{{ task.id }}</small>
                </th>
                <td>{{ task.type }}</td>
                <td>
                  <span
                    class="product-status-pill"
                    :class="`product-status-pill--${task.status === '已完成' ? 'success' : 'pending'}`"
                    >{{ task.status }}</span
                  >
                </td>
                <td>{{ task.updated }}</td>
                <td>
                  <button
                    class="product-row-button"
                    type="button"
                    @click="selectedTask = task"
                  >
                    详情
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
      <aside
        class="product-panel product-panel--quick"
        aria-labelledby="quick-actions-title"
      >
        <header class="product-panel__header">
          <div>
            <span class="product-kicker">SHORTCUTS</span>
            <h2 id="quick-actions-title">快捷操作</h2>
          </div>
        </header>
        <nav class="product-shortcut-list" aria-label="快捷操作">
          <RouterLink to="/preventing_fraud"
            ><span>风险防护</span><small>查看风险信号 →</small></RouterLink
          >
          <RouterLink to="/device_manager"
            ><span>设备管理</span><small>查看设备状态 →</small></RouterLink
          >
          <RouterLink to="/source_manager"
            ><span>来源管理</span><small>管理数据来源 →</small></RouterLink
          >
          <RouterLink to="/user_info"
            ><span>用户资料</span><small>查看本地身份 →</small></RouterLink
          >
        </nav>
      </aside>
    </div>

    <p v-if="toast" class="product-toast" role="status">{{ toast }}</p>

    <ProductModal
      :open="taskDialogOpen"
      title="新增本地任务"
      @close="taskDialogOpen = false"
    >
      <label class="product-form-label" for="task-name">任务名称</label>
      <input
        id="task-name"
        v-model="taskName"
        class="product-form-input"
        placeholder="例如：晚间健康检查"
        @keyup.enter="createDraft"
      />
      <p class="product-modal__hint">
        建立后会出现在最近任务，状态为「草稿」，不会调用远端服务。
      </p>
      <template #footer
        ><button
          class="product-secondary-button"
          type="button"
          @click="taskDialogOpen = false"
        >
          取消</button
        ><button
          class="product-primary-button"
          type="button"
          @click="createDraft"
        >
          建立草稿
        </button></template
      >
    </ProductModal>

    <ProductDrawer
      :open="Boolean(selectedTask)"
      title="任务详情"
      @close="selectedTask = null"
    >
      <template v-if="selectedTask"
        ><dl class="product-detail-list">
          <div>
            <dt>任务名称</dt>
            <dd>{{ selectedTask.name }}</dd>
          </div>
          <div>
            <dt>类型</dt>
            <dd>{{ selectedTask.type }}</dd>
          </div>
          <div>
            <dt>状态</dt>
            <dd>{{ selectedTask.status }}</dd>
          </div>
          <div>
            <dt>更新时间</dt>
            <dd>{{ selectedTask.updated }}</dd>
          </div>
        </dl>
        <div class="product-drawer-note">
          这是本地 fixture 的详情抽屉。执行按钮会走
          dry-run，不会发送消息或修改真实帐号。
        </div></template
      >
    </ProductDrawer>
    <ProductDrawer
      :open="notificationsOpen"
      title="通知中心"
      @close="notificationsOpen = false"
      ><div class="product-notification">
        <strong>本地读回完成</strong><span>风险窗口已更新 · 2 分钟前</span>
      </div>
      <div class="product-notification">
        <strong>素材边界保持</strong><span>当前没有外部请求 · 10 分钟前</span>
      </div>
      <div class="product-notification">
        <strong>任务草稿提醒</strong><span>有 1 个本地草稿待查看 · 昨天</span>
      </div></ProductDrawer
    >
    <ProductDrawer
      :open="accountOpen"
      title="安全边界"
      @close="accountOpen = false"
      ><div class="product-account-card">
        <span class="product-account-card__avatar">D</span>
        <div>
          <strong>本地演示操作者</strong
          ><span>operator · local-demo-session</span>
        </div>
      </div>
      <ul class="product-modal__list">
        <li>不读取浏览器 Cookie、Token 或密码。</li>
        <li>只允许本机页面与本地 mock API。</li>
        <li>所有变更按钮只生成 dry-run 回执。</li>
      </ul></ProductDrawer
    >
  </section>
</template>
