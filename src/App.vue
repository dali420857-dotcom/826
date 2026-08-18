<!--
  RETIREMENT MARKER — retired/disabled 2026-08-17.
  Historical DALI console shell only. Do not import, mount, extend, or add
  navigation here without explicit approval for a replacement UI.
-->
<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { RouterLink, RouterView, useRoute } from "vue-router";
import ProductDrawer from "./components/product/ProductDrawer.vue";
import { ROUTE_REGISTRY as routeRegistry } from "./shared/route-registry";
import {
  roleCanAccess,
  useSessionStore,
  type DemoRole,
} from "./stores/session";

const route = useRoute();
const session = useSessionStore();
const notificationsOpen = ref(false);
const accountOpen = ref(false);

const isPublicEntry = computed(
  () => route.path === "/" || route.path === "/login",
);

watch(
  () => route.fullPath,
  () => {
    notificationsOpen.value = false;
    accountOpen.value = false;
  },
);

const sectionLabels: Record<string, string> = {
  identity: "身份与账号",
  risk: "风险与分析",
  operations: "运营资源",
  tasks: "任务与采集",
  workspace: "工作台",
};

const roleLabels: Record<DemoRole, string> = {
  operator: "操作员",
  viewer: "观察员",
  reviewer: "复核员",
};

type NavItem = (typeof routeRegistry)[number];

const groupedNav = computed(() =>
  routeRegistry.reduce<Record<string, NavItem[]>>((groups, item) => {
    (groups[item.category] ??= []).push(item);
    return groups;
  }, {}),
);

const currentLabel = computed(() => String(route.meta.label ?? "工作台"));

function canAccess(required: DemoRole) {
  return roleCanAccess(session.active_role, required);
}
</script>

<template>
  <RouterView v-if="isPublicEntry" />
  <div v-else class="app-shell">
    <header class="topbar">
      <RouterLink class="brand" to="/index" aria-label="本地控制台首页">
        <span class="brand-mark" aria-hidden="true">LC</span>
        <span>
          <strong>本地控制台</strong>
          <small>clean-room fixture workspace</small>
        </span>
      </RouterLink>

      <div class="topbar-context">
        <span class="eyebrow">当前页面</span>
        <span class="context-name">{{ currentLabel }}</span>
        <span class="environment-chip">
          <span class="status-dot" aria-hidden="true" />
          本地 fixture
        </span>
        <span class="environment-chip environment-chip--muted">
          {{ roleLabels[session.active_role] }}
        </span>
        <button
          class="topbar-action"
          type="button"
          @click="notificationsOpen = true"
        >
          通知 <span class="product-badge">3</span>
        </button>
        <button
          class="topbar-action topbar-action--account"
          type="button"
          @click="accountOpen = true"
        >
          {{ session.operator_id }}
        </button>
      </div>
    </header>

    <div class="workspace-grid">
      <aside class="sidebar" aria-label="主导航">
        <div class="sidebar-intro">
          <span class="eyebrow">导航</span>
          <p>只读观察与本地 dry-run</p>
        </div>

        <nav>
          <section
            v-for="(items, section) in groupedNav"
            :key="section"
            class="nav-section"
          >
            <h2>{{ sectionLabels[section] }}</h2>
            <RouterLink
              v-for="item in items"
              :key="item.path"
              class="nav-link"
              :class="{ 'nav-link--locked': !canAccess(item.required_role) }"
              :to="item.path"
              :aria-label="item.label_zh_cn"
            >
              <span class="nav-indicator" aria-hidden="true" />
              <span>{{ item.label_zh_cn }}</span>
              <small v-if="!canAccess(item.required_role)">无权限</small>
            </RouterLink>
          </section>
        </nav>

        <div class="sidebar-footer">
          <span class="eyebrow">边界</span>
          <p>127.0.0.1 · 不保存 token · 不连接真实后端</p>
        </div>
      </aside>

      <main id="main-content" class="main-content" tabindex="-1">
        <RouterView />
      </main>
    </div>
    <ProductDrawer
      :open="notificationsOpen"
      title="通知中心"
      @close="notificationsOpen = false"
    >
      <div class="product-notification">
        <strong>本地读回完成</strong><span>当前页面资料已更新</span>
      </div>
      <div class="product-notification">
        <strong>外部写入已关闭</strong><span>所有操作均为本地 dry-run</span>
      </div>
    </ProductDrawer>
    <ProductDrawer
      :open="accountOpen"
      title="本地演示帐号"
      @close="accountOpen = false"
    >
      <div class="product-account-card">
        <span class="product-account-card__avatar">D</span>
        <div>
          <strong>本地演示操作者</strong
          ><span>{{ roleLabels[session.active_role] }} · 不保存凭证</span>
        </div>
      </div>
      <RouterLink
        class="product-drawer-link"
        to="/user_info"
        @click="accountOpen = false"
        >查看用户资料 →</RouterLink
      >
      <RouterLink
        class="product-drawer-link"
        to="/"
        @click="accountOpen = false"
        >返回系统选择 →</RouterLink
      >
    </ProductDrawer>
  </div>
</template>
