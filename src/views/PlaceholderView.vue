<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import {
  getRouteEntry,
  type RouteRegistryEntry,
} from "../shared/route-registry";
import { roleCanAccess, useDemoSessionStore } from "../stores/demo-session";

const route = useRoute();
const sessionStore = useDemoSessionStore();

const entry = computed<RouteRegistryEntry | undefined>(() =>
  getRouteEntry(route.path),
);
const allowed = computed(() =>
  entry.value
    ? roleCanAccess(sessionStore.role, entry.value.required_role)
    : false,
);
const title = computed(
  () => entry.value?.label_zh_cn ?? String(route.meta.label ?? "本地页面"),
);
const description = computed(
  () =>
    entry.value?.description_zh_cn ??
    String(route.meta.description ?? "此页面暂未配置本地夹具。"),
);
</script>

<template>
  <section class="placeholder-page" aria-labelledby="placeholder-title">
    <span class="section-kicker">本地页面壳</span>
    <h1 id="placeholder-title">{{ title }}</h1>
    <p class="lead">{{ description }}</p>
    <div
      class="placeholder-card"
      :class="{ 'placeholder-card--denied': !allowed }"
      role="status"
      aria-live="polite"
    >
      <span class="placeholder-icon" aria-hidden="true">{{
        allowed ? "↗" : "⊘"
      }}</span>
      <div>
        <strong>{{
          allowed ? "页面正在使用本地夹具" : "当前角色没有访问权限"
        }}</strong>
        <p v-if="allowed">
          此页面保留公开路由与交互入口；后端尚未接入，所有操作都会停留在本地
          dry-run。
        </p>
        <p v-else>
          请切换到“{{
            entry?.required_role === "operator" ? "操作员" : "审核员"
          }}”演示角色后再查看此页面。 角色切换只影响本地界面，不代表真实授权。
        </p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.placeholder-card--denied {
  border-color: #efc2bd;
}

.placeholder-card--denied .placeholder-icon {
  color: var(--danger);
  background: var(--danger-soft);
}
</style>
