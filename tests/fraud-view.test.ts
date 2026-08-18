import { render, screen, waitFor } from "@testing-library/vue";
import { createPinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { describe, expect, it } from "vitest";
import FraudPreventionView from "../src/views/FraudPreventionView.vue";

async function renderView(scenario: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/preventing_fraud", component: FraudPreventionView }],
  });
  await router.push({ path: "/preventing_fraud", query: { scenario } });
  await router.isReady();

  render(FraudPreventionView, {
    global: { plugins: [createPinia(), router] },
  });
}

describe("fraud prevention route", () => {
  it("shows a skeleton while a readback is pending", async () => {
    await renderView("timeout");

    expect(screen.getByLabelText("正在加载风险信号")).toBeTruthy();
    expect(
      await screen.findByRole("heading", { name: "新鲜读回超时" }),
    ).toBeTruthy();
  });

  it("shows signals and the read-only audit trail", async () => {
    await renderView("success");

    expect(
      await screen.findByRole("heading", { name: "风险信号" }),
    ).toBeTruthy();
    expect(screen.getByText("Account cluster A-17")).toBeTruthy();
    expect(screen.getByText("inspect_fraud_overview")).toBeTruthy();
  });

  it("shows a meaningful empty state", async () => {
    await renderView("empty");

    expect(
      await screen.findByRole("heading", { name: "当前窗口没有信号" }),
    ).toBeTruthy();
    expect(screen.getByText("无资料")).toBeTruthy();
  });

  it("explains a permission denial and does not offer a retry", async () => {
    await renderView("permission-denied");

    expect(
      await screen.findByRole("heading", { name: "当前范围被拒绝" }),
    ).toBeTruthy();
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "重试本地读取" })).toBeNull(),
    );
  });

  it("labels stale fallback data and its safe-stop action", async () => {
    await renderView("fallback");

    expect(await screen.findByText("回退启用")).toBeTruthy();
    expect(screen.getByText("mutations_allowed: false")).toBeTruthy();
    expect(screen.getByText(/暂停所有变更动作/)).toBeTruthy();
  });
});
