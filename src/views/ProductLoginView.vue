<script setup lang="ts">
import { computed, ref } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import ProductModal from "../components/product/ProductModal.vue";

const route = useRoute();
const router = useRouter();
const system = computed(() =>
  route.query.system === "customer" ? "customer" : "tg",
);
const isCustomer = computed(() => system.value === "customer");
const systemTitle = computed(() =>
  isCustomer.value ? "客服系统" : "TG Cloud 控制台",
);
const systemSubtitle = computed(() =>
  isCustomer.value ? "Customer Service Workspace" : "Telegram Cloud Control",
);

const termsOpen = ref(true);
const infoOpen = ref(false);
const username = ref("");
const password = ref("");
const rememberUsername = ref(false);
const errorMessage = ref("");

function declineTerms() {
  void router.replace("/");
}

function submit() {
  errorMessage.value = "";
  if (!username.value.trim() || !password.value) {
    errorMessage.value = "请输入帐号与密码（仅用于本地演示，不会发送）。";
    return;
  }
  void router.replace({ path: "/index", query: { system: system.value } });
}
</script>

<template>
  <main
    class="product-login"
    :class="{ 'product-login--customer': isCustomer }"
  >
    <div class="product-login__texture" aria-hidden="true" />
    <RouterLink class="product-login__back" to="/">← 返回系统选择</RouterLink>
    <section class="product-login-card" aria-labelledby="login-title">
      <div class="product-login-card__brand">
        <span class="product-login-card__mark">{{
          isCustomer ? "CS" : "TG"
        }}</span>
        <div>
          <span class="product-kicker">KONK WORKSPACE</span>
          <strong>{{ systemTitle }}</strong>
        </div>
      </div>
      <h1 id="login-title">欢迎回来</h1>
      <p class="product-login-card__subtitle">
        {{ systemSubtitle }} · 本地离线演示
      </p>

      <form
        v-if="!termsOpen"
        class="product-login-form"
        @submit.prevent="submit"
      >
        <label for="product-username">帐号</label>
        <input
          id="product-username"
          v-model="username"
          autocomplete="username"
          placeholder="请输入帐号"
        />
        <label for="product-password">密码</label>
        <input
          id="product-password"
          v-model="password"
          autocomplete="current-password"
          type="password"
          placeholder="请输入密码"
        />
        <label v-if="!isCustomer" class="product-check" for="product-code">
          <span>Google 验证码</span>
          <input
            id="product-code"
            inputmode="numeric"
            maxlength="6"
            placeholder="选填"
          />
        </label>
        <label class="product-check product-check--remember">
          <input v-model="rememberUsername" type="checkbox" />
          <span>记住帐号（仅当前页面）</span>
        </label>
        <p v-if="errorMessage" class="product-form-error" role="alert">
          {{ errorMessage }}
        </p>
        <button class="product-primary-button" type="submit">登入演示</button>
      </form>

      <div v-if="!termsOpen" class="product-login-links">
        <button type="button" @click="infoOpen = true">忘记密码？</button>
        <button type="button" @click="infoOpen = true">注册帐号</button>
      </div>
      <p class="product-login-card__footnote">
        演示模式不会验证、保存或传输真实帐号密码。
      </p>
    </section>

    <ProductModal
      :open="termsOpen"
      title="使用说明与免责声明"
      @close="declineTerms"
    >
      <p class="product-modal__lead">
        这是基于公开页面证据制作的本地 clean-room 交互成品。
      </p>
      <ul class="product-modal__list">
        <li>所有登入、列表与操作都是本地 mock，不会连接真实后端。</li>
        <li>请勿输入真实帐号、密码、验证码、Token 或个人资料。</li>
        <li>建立、删除、发送等动作只生成本地草稿或 dry-run 回执。</li>
      </ul>
      <template #footer>
        <button
          class="product-secondary-button"
          type="button"
          @click="declineTerms"
        >
          暂不进入
        </button>
        <button
          class="product-primary-button"
          type="button"
          @click="termsOpen = false"
        >
          同意并继续
        </button>
      </template>
    </ProductModal>

    <ProductModal
      :open="infoOpen"
      title="本地演示说明"
      @close="infoOpen = false"
    >
      <p class="product-modal__lead">
        帐号服务尚未接入。这个按钮只展示下一层交互，不会发出请求。
      </p>
      <template #footer>
        <button
          class="product-primary-button"
          type="button"
          @click="infoOpen = false"
        >
          知道了
        </button>
      </template>
    </ProductModal>
  </main>
</template>
