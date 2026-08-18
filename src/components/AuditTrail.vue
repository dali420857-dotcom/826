<script setup lang="ts">
import type { AuditEvent } from "../core/mock/contracts";

defineProps<{
  audit: AuditEvent | null;
  artifacts: Record<string, unknown>;
}>();

function formatTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

function displayValue(value: unknown) {
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}
</script>

<template>
  <aside class="audit-card" aria-labelledby="audit-title">
    <div class="audit-heading">
      <div>
        <span class="section-kicker">证据</span>
        <h2 id="audit-title">审计记录</h2>
      </div>
      <span class="audit-lock" aria-label="只读审计记录">只读</span>
    </div>
    <dl v-if="audit" class="audit-list">
      <div>
        <dt>决策</dt>
        <dd>{{ audit.decision }}</dd>
      </div>
      <div>
        <dt>能力</dt>
        <dd>{{ audit.capability }}</dd>
      </div>
      <div>
        <dt>事件</dt>
        <dd>{{ audit.event_id }}</dd>
      </div>
      <div>
        <dt>记录时间 UTC</dt>
        <dd>{{ formatTime(audit.timestamp) }}</dd>
      </div>
    </dl>
    <p v-else class="muted-cell">尚未记录审计事件。</p>
    <div v-if="Object.keys(artifacts).length > 0" class="artifact-list">
      <span v-for="(value, key) in artifacts" :key="key" class="artifact-chip">
        {{ key }}: {{ displayValue(value) }}
      </span>
    </div>
  </aside>
</template>
