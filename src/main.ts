// RETIREMENT MARKER — retired/disabled 2026-08-17.
// Historical DALI console bootstrap; do not extend or re-expose without approval.
import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import { router } from "./router";
import { worker } from "./mocks/browser";
import "./styles.css";

async function bootstrap() {
  await worker.start({
    // Fail closed for unregistered application requests while allowing the
    // dev server's module and static asset graph to load normally.
    onUnhandledRequest(request, print) {
      const url = new URL(request.url);
      const isLoopback = ["127.0.0.1", "localhost"].includes(url.hostname);
      const isApplicationApi = url.pathname.startsWith("/api/");

      // Same-origin module/static requests belong to Vite. Application API
      // requests must be registered in handlers, and every non-loopback
      // request is blocked regardless of path.
      if (isLoopback && !isApplicationApi) return;
      print.error();
      throw new Error(`Blocked unhandled local request: ${request.url}`);
    },
    serviceWorker: { url: "/mockServiceWorker.js" },
  });

  createApp(App).use(createPinia()).use(router).mount("#app");
}

void bootstrap();
