<script setup lang="ts">
defineProps<{
  label: string;
  value: string | number;
  detail: string;
  tone?: "teal" | "amber" | "red" | "neutral";
}>();
</script>

<template>
  <article class="metric-card" :class="`metric-card--${tone ?? 'neutral'}`">
    <span class="metric-label">{{ label }}</span>
    <strong class="metric-value">{{ value }}</strong>
    <span class="metric-detail">{{ detail }}</span>
  </article>
</template>
