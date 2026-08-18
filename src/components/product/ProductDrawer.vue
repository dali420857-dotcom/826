<script setup lang="ts">
defineProps<{ open: boolean; title: string }>();
const emit = defineEmits<{ close: [] }>();
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="product-overlay" @click.self="emit('close')">
      <aside
        class="product-drawer"
        role="dialog"
        aria-modal="true"
        :aria-label="title"
      >
        <header class="product-modal__header">
          <h2>{{ title }}</h2>
          <button
            class="product-icon-button"
            type="button"
            aria-label="关闭抽屉"
            @click="emit('close')"
          >
            ×
          </button>
        </header>
        <div class="product-modal__body"><slot /></div>
      </aside>
    </div>
  </Teleport>
</template>
