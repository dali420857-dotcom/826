import { fireEvent, render, screen } from "@testing-library/vue";
import { createPinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { describe, expect, it } from "vitest";
import OperationsPageView from "../../../src/views/operations/OperationsPageView.vue";

async function renderOperations(
  path: string,
  fixtureKey: string,
  scenario: string,
) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path,
        component: OperationsPageView,
        meta: {
          fixtureKey,
          label: "运营资源",
          requiredRole: "operator",
        },
      },
    ],
  });
  await router.push({ path, query: { scenario } });
  await router.isReady();

  render(OperationsPageView, {
    global: { plugins: [createPinia(), router] },
  });
}

describe("operations page surfaces", () => {
  it("renders a typed device readback and audit trail", async () => {
    await renderOperations("/device_manager", "device-manager", "success");

    expect(
      await screen.findByRole("heading", { name: "设备管理清单" }),
    ).toBeTruthy();
    expect(screen.getByText("demo-device-01")).toBeTruthy();
    expect(screen.getByText("inspect_device-manager")).toBeTruthy();
  });

  it("keeps permission denial explicit without a retry action", async () => {
    await renderOperations(
      "/proxy_manager",
      "proxy-manager",
      "permission-denied",
    );

    expect(
      await screen.findByRole("heading", { name: "权限不足" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "重试本地读取" })).toBeNull();
  });

  it("requires confirmation before creating a local dry-run receipt", async () => {
    await renderOperations("/service_manager", "service-manager", "success");

    const action = await screen.findByRole("button", {
      name: "执行本地 dry-run",
    });
    await fireEvent.click(action);

    expect(
      await screen.findByRole("heading", { name: "确认本地模拟操作" }),
    ).toBeTruthy();
    await fireEvent.click(screen.getByRole("button", { name: "确认 dry-run" }));

    expect(await screen.findByText("mutation_applied: false")).toBeTruthy();
    expect(screen.getByText("readback: local-simulation")).toBeTruthy();
  });

  it("covers empty, fallback, and error presentation states", async () => {
    await renderOperations("/ip_manager", "ip-manager", "empty");
    expect(
      await screen.findByRole("heading", { name: "暂无符合条件的资源" }),
    ).toBeTruthy();

    await renderOperations("/source_manager", "source-manager", "fallback");
    expect(
      await screen.findByRole("heading", { name: "正在使用回退数据" }),
    ).toBeTruthy();

    await renderOperations("/proxy_manager", "proxy-manager", "error");
    expect(
      await screen.findByRole("heading", { name: "读取失败" }),
    ).toBeTruthy();
  });

  it("filters the local resource table without a provider request", async () => {
    await renderOperations("/device_manager", "device-manager", "success");
    const search = await screen.findByPlaceholderText("搜索资源名称或标识");
    await fireEvent.update(search, "不存在的资源");
    expect(
      await screen.findByRole("heading", { name: "暂无符合条件的资源" }),
    ).toBeTruthy();
  });
});
