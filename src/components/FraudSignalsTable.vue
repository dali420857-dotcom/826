<script setup lang="ts">
import type { FraudSignal } from "../core/fraud/contracts";

defineProps<{ signals: FraudSignal[] }>();

function formatTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(new Date(value));
}

const severityLabel: Record<FraudSignal["severity"], string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};
</script>

<template>
  <div class="table-wrap">
    <table class="signals-table">
      <caption class="sr-only">
        Fraud review signals
      </caption>
      <thead>
        <tr>
          <th scope="col">Subject</th>
          <th scope="col">Signal</th>
          <th scope="col">Severity</th>
          <th scope="col">Observed (UTC)</th>
          <th scope="col">Next action</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="signal in signals" :key="signal.id">
          <th scope="row">{{ signal.subject }}</th>
          <td>{{ signal.signal }}</td>
          <td>
            <span
              class="severity-pill"
              :class="`severity-pill--${signal.severity}`"
              >{{ severityLabel[signal.severity] }}</span
            >
          </td>
          <td class="muted-cell">{{ formatTime(signal.observed_at) }}</td>
          <td class="action-cell">{{ signal.action }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
