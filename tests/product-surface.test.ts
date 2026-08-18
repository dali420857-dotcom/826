import { fireEvent, render, screen, waitFor } from "@testing-library/vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { describe, expect, it } from "vitest";
import PortalView from "../src/views/PortalView.vue";
import ProductHomeView from "../src/views/ProductHomeView.vue";
import ProductLoginView from "../src/views/ProductLoginView.vue";

async function renderWithRouter(component: unknown, initialPath: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", component: PortalView },
      { path: "/login", component: ProductLoginView },
      { path: "/index", component: ProductHomeView },
    ],
  });
  await router.push(initialPath);
  await router.isReady();
  render(component, { global: { plugins: [router] } });
  return router;
}

describe("offline product surface", () => {
  it("offers both public systems from the captured selector entry", async () => {
    await renderWithRouter(PortalView, "/");

    expect(screen.getByRole("heading", { name: /请选择系统/ })).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /进入 TG Cloud 控制台/ }),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: /进入客服系统/ })).toBeTruthy();
  });

  it("requires the terms acknowledgement before showing the local login form", async () => {
    const router = await renderWithRouter(ProductLoginView, "/login?system=tg");

    expect(
      screen.getByRole("dialog", { name: "使用说明与免责声明" }),
    ).toBeTruthy();
    expect(screen.queryByLabelText("帐号")).toBeNull();

    await fireEvent.click(screen.getByRole("button", { name: "同意并继续" }));
    expect(screen.getByLabelText("帐号")).toBeTruthy();
    expect(screen.getByLabelText("密码")).toBeTruthy();

    await fireEvent.update(screen.getByLabelText("帐号"), "demo-operator");
    await fireEvent.update(screen.getByLabelText("密码"), "local-only");
    await fireEvent.click(screen.getByRole("button", { name: "登入演示" }));

    await waitFor(() => expect(router.currentRoute.value.path).toBe("/index"));
    expect(router.currentRoute.value.query.system).toBe("tg");
  });

  it("opens a task drawer and creates a local draft without a remote request", async () => {
    await renderWithRouter(ProductHomeView, "/index?system=tg");

    await fireEvent.click(screen.getByRole("button", { name: "新增本地任务" }));
    expect(screen.getByRole("dialog", { name: "新增本地任务" })).toBeTruthy();
    await fireEvent.update(screen.getByLabelText("任务名称"), "夜间检查");
    await fireEvent.click(screen.getByRole("button", { name: "建立草稿" }));

    expect(screen.getByRole("status").textContent).toContain("草稿已建立");
    expect(screen.getByText("夜间检查")).toBeTruthy();
  });
});
