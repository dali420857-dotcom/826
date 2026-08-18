import { fireEvent, render, screen } from "@testing-library/vue";
import { createPinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { describe, expect, it } from "vitest";
import IdentityPageView from "../../../src/views/identity/IdentityPageView.vue";

async function renderIdentityPage(pageId: string, scenario = "success") {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/identity", component: IdentityPageView }],
  });
  await router.push({ path: "/identity", query: { scenario } });
  await router.isReady();

  render(IdentityPageView, {
    props: { pageId },
    global: { plugins: [createPinia(), router] },
  });
}

describe("identity page surfaces", () => {
  it("renders the local login role selector without credential inputs", async () => {
    await renderIdentityPage("login");

    expect(
      await screen.findByRole("heading", { name: "选择本地演示角色" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "以操作员继续" })).toBeTruthy();
    expect(screen.queryByLabelText(/密码/)).toBeNull();
  });

  it("renders account statistics with a local readback", async () => {
    await renderIdentityPage("account-statistics");

    expect(
      await screen.findByRole("heading", { name: "活跃度与风险分布" }),
    ).toBeTruthy();
    expect(screen.getAllByText("只读").length).toBeGreaterThan(0);
    expect(screen.getByText("本地 fixture")).toBeTruthy();
  });

  it("exposes a safe empty state from the local mock scenario", async () => {
    await renderIdentityPage("intelligence", "empty");

    expect(
      await screen.findByRole("heading", { name: "没有符合条件的本地记录" }),
    ).toBeTruthy();
    expect(
      screen.getByText("fixture 正常响应，但当前场景没有资料。"),
    ).toBeTruthy();
  });

  it("keeps password reset as a local dry-run confirmation", async () => {
    await renderIdentityPage("reset-password");

    await fireEvent.click(
      await screen.findByRole("button", { name: "预览重置流程" }),
    );
    expect(
      screen.getByRole("heading", { name: "确认本地模拟操作" }),
    ).toBeTruthy();
    await fireEvent.click(screen.getByRole("button", { name: "确认 dry-run" }));
    expect(
      screen.getAllByText("mutation_applied: false").length,
    ).toBeGreaterThan(0);
  });

  it("renders overview and profile-only presentation blocks", async () => {
    await renderIdentityPage("index");
    expect(
      await screen.findByRole("heading", { name: "从本地状态开始" }),
    ).toBeTruthy();

    await renderIdentityPage("user-info");
    expect(
      await screen.findByRole("heading", { name: "本地演示操作者" }),
    ).toBeTruthy();
  });

  it("labels fallback and error states without exposing remote details", async () => {
    await renderIdentityPage("user-info", "fallback");
    expect(await screen.findByText("缓存读回")).toBeTruthy();

    await renderIdentityPage("intelligence", "error");
    expect(
      await screen.findByRole("heading", { name: "fixture 读取失败" }),
    ).toBeTruthy();
  });
});
