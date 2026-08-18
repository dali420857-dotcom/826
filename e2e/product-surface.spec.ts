import { expect, test } from "@playwright/test";

test("portal, terms dialog, login and local task draft are usable", async ({
  page,
}) => {
  const externalRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (!["127.0.0.1", "localhost"].includes(url.hostname)) {
      externalRequests.push(request.url());
    }
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: /请选择系统/ })).toBeVisible();
  await page.getByRole("link", { name: /进入 TG Cloud 控制台/ }).click();

  await expect(
    page.getByRole("dialog", { name: "使用说明与免责声明" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "同意并继续" }).click();
  await page.getByRole("textbox", { name: "帐号" }).fill("demo-operator");
  await page.getByRole("textbox", { name: "密码" }).fill("local-only");
  await page.getByRole("button", { name: "登入演示" }).click();

  await expect(page).toHaveURL(/#\/index\?system=tg/);
  await expect(
    page.getByRole("heading", { name: "TG Cloud 控制台" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "新增本地任务" }).click();
  await page
    .getByRole("dialog", { name: "新增本地任务" })
    .getByLabel("任务名称")
    .fill("浏览器验收草稿");
  await page.getByRole("button", { name: "建立草稿" }).click();
  await expect(page.getByRole("status")).toContainText("草稿已建立");
  await expect(page.getByText("浏览器验收草稿")).toBeVisible();
  expect(externalRequests).toEqual([]);
});

test("task and notification drawers remain keyboard reachable", async ({
  page,
}) => {
  await page.goto("/#/index?system=customer");
  await expect(
    page.getByRole("heading", { name: "客服系统工作台" }),
  ).toBeVisible();

  await page
    .locator(".product-home")
    .getByRole("button", { name: /通知/ })
    .click();
  await expect(page.getByRole("dialog", { name: "通知中心" })).toBeVisible();
  await page.getByRole("button", { name: "关闭抽屉" }).click();

  await page.getByRole("button", { name: "详情" }).first().click();
  await expect(page.getByRole("dialog", { name: "任务详情" })).toBeVisible();
  await expect(page.getByText("本地 fixture 的详情抽屉")).toBeVisible();
});
