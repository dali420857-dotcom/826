<script setup lang="ts">
withDefaults(
  defineProps<{
    as?: "article" | "section" | "div";
    title?: string;
    subtitle?: string;
  }>(),
  { as: "article", title: undefined, subtitle: undefined },
);
</script>

<template>
  <component :is="as" class="ui-card">
    <header v-if="title || subtitle || $slots.header" class="ui-card__header">
      <slot name="header">
        <div>
          <h2 v-if="title" class="ui-card__title">{{ title }}</h2>
          <p v-if="subtitle" class="ui-card__subtitle">{{ subtitle }}</p>
        </div>
      </slot>
    </header>
    <div class="ui-card__body">
      <slot />
    </div>
    <footer v-if="$slots.footer" class="ui-card__footer">
      <slot name="footer" />
    </footer>
  </component>
</template>
