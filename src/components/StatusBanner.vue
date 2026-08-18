<script setup lang="ts">
import { computed } from "vue";
import type { LoadState } from "../core/mock/contracts";

const props = defineProps<{
  state: LoadState;
  summary?: string;
  errorMessage?: string;
}>();

const copy = computed(() => {
  const summaries: Record<
    LoadState,
    { label: string; tone: string; defaultText: string }
  > = {
    idle: {
      label: "待命",
      tone: "neutral",
      defaultText: "选择本地 fixture 场景后开始。",
    },
    loading: {
      label: "载入中",
      tone: "neutral",
      defaultText: "正在读取本地 fixture。",
    },
    success: {
      label: "新鲜读回",
      tone: "success",
      defaultText: "当前只读资料来自本地 fixture。",
    },
    empty: {
      label: "无资料",
      tone: "neutral",
      defaultText: "当前场景没有符合条件的本地样本。",
    },
    fallback: {
      label: "回退启用",
      tone: "warning",
      defaultText: "正在显示本地缓存；真实变更仍然关闭。",
    },
    error: {
      label: "读取错误",
      tone: "danger",
      defaultText: "fixture 返回错误，流程已安全停止。",
    },
    "permission-denied": {
      label: "权限拒绝",
      tone: "danger",
      defaultText: "当前本地角色没有权限查看此范围。",
    },
    timeout: {
      label: "已超时",
      tone: "warning",
      defaultText: "安全时限内没有取得新鲜读回。",
    },
  };
  const stateCopy = summaries[props.state];
  return {
    ...stateCopy,
    text: props.errorMessage ?? props.summary ?? stateCopy.defaultText,
  };
});
</script>

<template>
  <div
    class="status-banner"
    :class="`status-banner--${copy.tone}`"
    role="status"
    aria-live="polite"
  >
    <span class="status-banner-icon" aria-hidden="true">{{
      copy.tone === "danger" ? "!" : copy.tone === "warning" ? "~" : "✓"
    }}</span>
    <div>
      <strong>{{ copy.label }}</strong>
      <p>{{ copy.text }}</p>
    </div>
  </div>
</template>
