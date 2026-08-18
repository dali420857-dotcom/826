<script setup lang="ts">
import { RouterLink } from "vue-router";
</script>

<template>
  <main class="product-portal" aria-labelledby="portal-title">
    <div
      class="product-portal__glow product-portal__glow--one"
      aria-hidden="true"
    />
    <div
      class="product-portal__glow product-portal__glow--two"
      aria-hidden="true"
    />
    <section class="product-portal__content">
      <span class="product-kicker">KONK WORKSPACE · LOCAL EDITION</span>
      <h1 id="portal-title">
        请选择系统 <span>/ Please select a system</span>
      </h1>
      <p class="product-portal__lead">
        进入本地离线演示。页面、弹窗、抽屉与操作都在当前设备完成，不会连接真实服务。
      </p>
      <div class="product-system-grid">
        <RouterLink
          class="product-system-card product-system-card--tg"
          to="/login?system=tg"
        >
          <span class="product-system-card__icon" aria-hidden="true">TG</span>
          <span>
            <strong>进入 TG Cloud 控制台</strong>
            <small>Telegram 云控 · TG Cloud Control</small>
          </span>
          <span class="product-system-card__arrow" aria-hidden="true">→</span>
        </RouterLink>
        <RouterLink
          class="product-system-card product-system-card--customer"
          to="/login?system=customer"
        >
          <span class="product-system-card__icon" aria-hidden="true">CS</span>
          <span>
            <strong>进入客服系统</strong>
            <small>Customer Service Workspace</small>
          </span>
          <span class="product-system-card__arrow" aria-hidden="true">→</span>
        </RouterLink>
      </div>
      <div class="product-boundary-note">
        <span class="product-status-dot" aria-hidden="true" />
        <span>本地 clean-room · GET-only 素材证据 · 无真实帐号凭证</span>
      </div>
    </section>
  </main>
</template>
