<script setup lang="ts">
defineProps<{
  open: boolean;
  title: string;
  labelledBy?: string;
}>();

const emit = defineEmits<{ close: [] }>();
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="product-overlay" @click.self="emit('close')">
      <section
        class="product-modal"
        role="dialog"
        aria-modal="true"
        :aria-label="labelledBy ?? title"
      >
        <header class="product-modal__header">
          <h2>{{ title }}</h2>
          <button
            class="product-icon-button"
            type="button"
            aria-label="关闭弹窗"
            @click="emit('close')"
          >
            ×
          </button>
        </header>
        <div class="product-modal__body"><slot /></div>
        <footer v-if="$slots.footer" class="product-modal__footer">
          <slot name="footer" />
        </footer>
      </section>
    </div>
  </Teleport>
</template>
