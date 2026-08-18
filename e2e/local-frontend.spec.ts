import { expect, test } from "@playwright/test";

const routes = [
  "/login",
  "/index",
  "/preventing_fraud",
  "/user_info",
  "/reset_password",
  "/account_tatistics",
  "/intelligence",
  "/proxy_manager",
  "/source_manager",
  "/device_manager",
  "/ip_manager",
  "/service_manager",
  "/task_manager",
  "/group_send_msg",
  "/pull_group",
  "/screen_data",
  "/position",
  "/group_adv",
  "/build_group",
  "/collect",
  "/position_collect",
  "/work_order",
];

test.beforeEach(async ({ page }) => {
  const consoleErrors: string[] = [];
  const externalRequests: string[] = [];

  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("request", (request) => {
    const url = new URL(request.url());
    const loopback = ["127.0.0.1", "localhost"].includes(url.hostname);
    if (!loopback) externalRequests.push(request.url());
  });

  await page.exposeFunction("__e2eConsoleErrors", () => consoleErrors);
  await page.exposeFunction("__e2eExternalRequests", () => externalRequests);
});

test("all public routes render without blank pages", async ({ page }) => {
  for (const route of routes) {
    await page.goto(`/#${route}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator("main")).not.toBeEmpty();
  }
});

test("all public routes stay usable at supported viewport widths", async ({
  page,
}) => {
  test.setTimeout(60_000);
  for (const viewport of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width: viewport, height: 900 });
    for (const route of routes) {
      await page.goto(`/#${route}`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.locator("main")).not.toBeEmpty();
    }
  }
});

test("role switching changes permission UI", async ({ page }) => {
  await page.goto("/#/device_manager");
  await expect(
    page.getByRole("heading", { name: "设备管理", exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "观察员" }).click();

  await expect(page.getByText("当前角色没有权限")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "权限不足", exact: true }),
  ).toBeVisible();
});

test("generic pages expose the full safe state matrix", async ({ page }) => {
  const states = [
    ["error", "读取失败"],
    ["permission-denied", "权限不足"],
    ["timeout", "读取超时"],
    ["empty", "暂无符合条件的资源"],
    ["fallback", "正在使用回退数据"],
  ] as const;

  for (const [scenario, heading] of states) {
    await page.goto(`/#/device_manager?scenario=${scenario}`);
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }
});

test("preventing_fraud covers core read states", async ({ page }) => {
  await page.goto("/#/preventing_fraud?scenario=success");
  await expect(
    page.getByRole("heading", { name: "风险防护", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("新鲜读回").first()).toBeVisible();

  await page.goto("/#/preventing_fraud?scenario=empty");
  await expect(
    page.getByRole("heading", { name: "当前窗口没有信号" }),
  ).toBeVisible();

  await page.goto("/#/preventing_fraud?scenario=fallback");
  await expect(page.getByText("回退启用")).toBeVisible();
  await expect(page.getByText("mutations_allowed: false")).toBeVisible();
});

test("device task and service dry-run flows stay local", async ({ page }) => {
  for (const route of [
    "/device_manager",
    "/task_manager",
    "/service_manager",
  ]) {
    await page.goto(`/#${route}`);
    const action = page.locator(".dry-run-actions button").first();
    await expect(action).toBeVisible();
    await expect(action).toBeEnabled();
    await action.click();
    await page.getByRole("button", { name: "确认 dry-run" }).click();
    await expect(page.getByText("mutation_applied: false")).toBeVisible();
    await expect(page.getByText("readback: local-simulation")).toBeVisible();
  }
});

test("no console errors or non-loopback network requests", async ({ page }) => {
  await page.goto("/#/task_manager");
  const action = page.locator(".dry-run-actions button").first();
  await expect(action).toBeVisible();
  await expect(action).toBeEnabled();
  await action.click();
  await page.getByRole("button", { name: "取消" }).click();

  const consoleErrors = await page.evaluate(() => window.__e2eConsoleErrors());
  const externalRequests = await page.evaluate(() =>
    window.__e2eExternalRequests(),
  );

  expect(consoleErrors).toEqual([]);
  expect(externalRequests).toEqual([]);
});
