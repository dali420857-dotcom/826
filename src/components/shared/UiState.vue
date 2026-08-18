<script setup lang="ts">
import { computed } from "vue";

type UiStateKind =
  "loading" | "empty" | "error" | "permission-denied" | "timeout" | "fallback";

const props = withDefaults(
  defineProps<{
    kind: UiStateKind;
    title?: string;
    description?: string;
    actionLabel?: string;
  }>(),
  {
    title: undefined,
    description: undefined,
    actionLabel: "重试本地读取",
  },
);

const emit = defineEmits<{ action: [] }>();

const defaults: Record<UiStateKind, { title: string; description: string }> = {
  loading: {
    title: "正在加载",
    description: "正在读取本地演示数据。",
  },
  empty: {
    title: "暂无数据",
    description: "当前筛选条件没有匹配的本地记录。",
  },
  error: {
    title: "读取失败",
    description: "本地夹具返回错误，已安全停止。",
  },
  "permission-denied": {
    title: "权限不足",
    description: "当前演示角色没有获准访问此页面。",
  },
  timeout: {
    title: "读取超时",
    description: "在安全时间窗内没有收到本地读回。",
  },
  fallback: {
    title: "正在使用回退数据",
    description: "当前显示的是本地旧快照；变更操作保持禁用。",
  },
};

const copy = computed(() => ({
  title: props.title ?? defaults[props.kind].title,
  description: props.description ?? defaults[props.kind].description,
}));

const liveRole = computed(() =>
  props.kind === "error" ||
  props.kind === "permission-denied" ||
  props.kind === "timeout"
    ? "alert"
    : "status",
);
</script>

<template>
  <section
    class="ui-state"
    :class="`ui-state--${kind}`"
    :data-state="kind"
    :role="liveRole"
    aria-live="polite"
    :aria-busy="kind === 'loading' ? 'true' : undefined"
  >
    <span class="ui-state__icon" aria-hidden="true">
      {{
        kind === "loading"
          ? "…"
          : kind === "empty"
            ? "∅"
            : kind === "fallback"
              ? "~"
              : "!"
      }}
    </span>
    <div class="ui-state__content">
      <h2>{{ copy.title }}</h2>
      <p>{{ copy.description }}</p>
      <button
        v-if="
          kind !== 'loading' && kind !== 'empty' && kind !== 'permission-denied'
        "
        type="button"
        class="ui-button ui-button--secondary"
        @click="emit('action')"
      >
        {{ actionLabel }}
      </button>
    </div>
  </section>
</template>
