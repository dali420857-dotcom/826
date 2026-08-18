import { fireEvent, render, screen, waitFor } from "@testing-library/vue";
import { createPinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { describe, expect, it } from "vitest";
import PageDashboardView from "../src/views/PageDashboardView.vue";

async function renderPage(path: string, fixtureKey: string, query = {}) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path,
        component: PageDashboardView,
        meta: {
          label: "测试页面",
          fixtureKey,
          requiredRole: "operator",
          supportsDryRun: true,
        },
      },
    ],
  });
  await router.push({ path, query });
  await router.isReady();

  render(PageDashboardView, {
    global: { plugins: [createPinia(), router] },
  });
}

describe("generic page dashboard route", () => {
  it("renders a route-specific local fixture", async () => {
    await renderPage("/device_manager", "device-manager");

    expect(
      await screen.findByRole("heading", { name: "设备管理" }),
    ).toBeTruthy();
    expect(
      screen.getByText("接口：/api/mock/pages/device-manager"),
    ).toBeTruthy();
    expect(screen.getByRole("heading", { name: "本地样本" })).toBeTruthy();
  });

  it("switches roles and shows permission state", async () => {
    await renderPage("/service_manager", "service-manager");

    await fireEvent.click(screen.getByRole("button", { name: "观察员" }));

    expect(await screen.findByText("当前角色没有权限")).toBeTruthy();
    expect(
      await screen.findByRole("heading", { name: "当前范围被拒绝" }),
    ).toBeTruthy();
  });

  it("confirms a dry-run without applying a mutation", async () => {
    await renderPage("/task_manager", "task-manager");

    await screen.findByRole("heading", { name: "任务管理" });
    await fireEvent.click(screen.getByRole("button", { name: "预览任务执行" }));
    await fireEvent.click(screen.getByRole("button", { name: "确认 dry-run" }));

    await waitFor(() =>
      expect(screen.getByText("mutation_applied: false")).toBeTruthy(),
    );
    expect(screen.getByText("readback: local-simulation")).toBeTruthy();
    expect(screen.getByText("task-manager-preview")).toBeTruthy();
  });

  it("renders the empty and fallback states from the generic envelope", async () => {
    await renderPage("/device_manager", "device-manager", {
      scenario: "empty",
    });
    expect(
      await screen.findByRole("heading", { name: "没有符合条件的本地样本" }),
    ).toBeTruthy();
  });

  it("renders a provider error with a safe retry boundary", async () => {
    await renderPage("/device_manager", "device-manager", {
      scenario: "error",
    });
    expect(
      await screen.findByRole("heading", { name: "fixture 读取失败" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "重试本地读取" })).toBeTruthy();
  });
});
