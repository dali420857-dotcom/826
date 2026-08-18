<script setup lang="ts">
import type { LoadState } from "../core/mock/contracts";

defineProps<{
  state: Extract<LoadState, "error" | "permission-denied" | "timeout">;
  message: string;
}>();

const emit = defineEmits<{ retry: [] }>();
</script>

<template>
  <section
    class="load-state-panel"
    :class="`load-state-panel--${state}`"
    role="alert"
    aria-live="assertive"
  >
    <div class="load-state-symbol" aria-hidden="true">
      {{
        state === "permission-denied" ? "⊘" : state === "timeout" ? "◷" : "×"
      }}
    </div>
    <div>
      <h2>
        {{
          state === "permission-denied"
            ? "当前范围被拒绝"
            : state === "timeout"
              ? "新鲜读回超时"
              : "fixture 读取失败"
        }}
      </h2>
      <p>{{ message }}</p>
      <button
        v-if="state !== 'permission-denied'"
        class="secondary-button"
        type="button"
        @click="emit('retry')"
      >
        重试本地读取
      </button>
    </div>
  </section>
</template>
