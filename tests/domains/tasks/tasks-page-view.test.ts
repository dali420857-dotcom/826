import { fireEvent, render, waitFor } from "@testing-library/vue";
import { createPinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { describe, expect, it } from "vitest";
import TasksPageView from "../../../src/views/tasks/TasksPageView.vue";

async function renderTaskPage(
  query = "",
  fixtureKey = "task-manager",
  path = "/task_manager",
) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path,
        component: TasksPageView,
        meta: {
          fixtureKey,
          label: fixtureKey,
        },
      },
    ],
  });
  await router.push(`${path}${query}`);
  await router.isReady();

  return render(TasksPageView, {
    global: {
      plugins: [createPinia(), router],
    },
  });
}

describe("TasksPageView", () => {
  it("renders local task data and exposes an auditable dry-run confirmation", async () => {
    const view = await renderTaskPage();

    await waitFor(() => {
      expect(view.getByRole("heading", { name: "任务管理" })).toBeTruthy();
      expect(view.queryByText("正在加载")).toBeNull();
    });

    expect(view.getByText("本地任务样本")).toBeTruthy();
    const preview = view.getByRole("button", {
      name: /预览任务执行|执行本地 dry-run/,
    });
    await fireEvent.click(preview);
    expect(
      view.getByRole("heading", { name: "确认本地模拟操作" }),
    ).toBeTruthy();

    await fireEvent.click(view.getByRole("button", { name: "确认 dry-run" }));
    await waitFor(() => {
      expect(view.getByText("mutation_applied")).toBeTruthy();
      expect(view.getByText("local-simulation")).toBeTruthy();
    });
  });

  it("surfaces fixture errors without attempting a remote mutation", async () => {
    const view = await renderTaskPage("?scenario=error");

    await waitFor(() => {
      expect(view.getByRole("heading", { name: "读取失败" })).toBeTruthy();
    });
    expect(
      view.getAllByText("本地 fixture 返回错误，已安全停止。").length,
    ).toBeGreaterThan(0);
    expect(view.queryByText("确认 dry-run")).toBeNull();
  });

  it("covers empty, fallback, and permission-denied states", async () => {
    const empty = await renderTaskPage("?scenario=empty");
    await waitFor(() =>
      expect(empty.getByRole("heading", { name: "暂无数据" })).toBeTruthy(),
    );

    const fallback = await renderTaskPage("?scenario=fallback");
    await waitFor(() =>
      expect(
        fallback.getByRole("heading", { name: "正在使用回退数据" }),
      ).toBeTruthy(),
    );

    const denied = await renderTaskPage("?scenario=permission-denied");
    await waitFor(() =>
      expect(denied.getByRole("heading", { name: "权限不足" })).toBeTruthy(),
    );
  });

  it("renders the group message form as a local-only preview", async () => {
    const view = await renderTaskPage("", "group-send-msg", "/group_send_msg");
    await waitFor(() =>
      expect(view.getByRole("heading", { name: "群发消息" })).toBeTruthy(),
    );
    await fireEvent.update(view.getByLabelText("目标群组"), "公开样本群组 A");
    await fireEvent.update(view.getByLabelText("消息内容"), "本地预览内容");
    await fireEvent.click(view.getByRole("button", { name: "预览本地发送" }));
    expect(
      view.getByRole("heading", { name: "确认本地模拟操作" }),
    ).toBeTruthy();
    await fireEvent.click(view.getByRole("button", { name: "取消" }));
    expect(view.queryByText("mutation_applied: false")).toBeNull();
  });
});
