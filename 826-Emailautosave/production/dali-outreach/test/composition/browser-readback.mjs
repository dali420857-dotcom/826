import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, '../..');
const artifacts = path.join(here, 'artifacts');
await mkdir(artifacts, { recursive: true });

const server = await createServer({
  root: packageRoot,
  logLevel: 'error',
  server: { host: '127.0.0.1', port: 0, strictPort: false },
});
await server.listen();
const address = server.httpServer?.address();
if (!address || typeof address === 'string') throw new Error('BROWSER_SERVER_ADDRESS_UNAVAILABLE');
const baseUrl = `http://127.0.0.1:${address.port}`;

const browser = await chromium.launch({ headless: true });
const findings = [];

function isLoopback(rawUrl) {
  const url = new URL(rawUrl);
  return url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]';
}

function observe(page) {
  const observation = { consoleProblems: [], nonLoopback: [], nonLoopbackSockets: [] };
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      observation.consoleProblems.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on('request', (request) => {
    if (!isLoopback(request.url())) observation.nonLoopback.push(request.url());
  });
  page.on('websocket', (socket) => {
    if (!isLoopback(socket.url())) observation.nonLoopbackSockets.push(socket.url());
  });
  return observation;
}

async function enableSyntheticPreview(page) {
  await page.addInitScript(() => {
    window.__DALI_OUTREACH_BOOTSTRAP__ = { mode: 'synthetic-preview' };
  });
}

async function inspectPage(page) {
  const overflowX = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  const activeLinks = await page.locator('nav a[aria-current="page"]').count();
  const routeLinks = await page.locator('nav a').allTextContents();
  const accessibility = await page.evaluate(() => {
    const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((heading) => ({
      level: Number(heading.tagName.slice(1)),
      text: heading.textContent?.trim() ?? '',
    }));
    const hierarchyValid = headings.every((heading, index) =>
      index === 0 || heading.level <= headings[index - 1].level + 1,
    );
    const unnamed = [...document.querySelectorAll('a,button,input,select,textarea')]
      .filter((element) => {
        const ariaLabel = element.getAttribute('aria-label')?.trim();
        const labelledBy = element.getAttribute('aria-labelledby');
        const label = element.id ? document.querySelector(`label[for="${CSS.escape(element.id)}"]`) : null;
        const wrappedLabel = element.closest('label');
        const text = element.textContent?.trim();
        const placeholder = element.getAttribute('placeholder')?.trim();
        return !ariaLabel && !labelledBy && !label && !wrappedLabel && !text && !placeholder;
      })
      .map((element) => element.outerHTML.slice(0, 120));
    return {
      headings,
      hierarchyValid,
      h1Count: headings.filter((heading) => heading.level === 1).length,
      unnamed,
    };
  });
  return { overflowX, activeLinks, routeLinks, accessibility };
}

async function verifyKeyboardFocus(page) {
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  const sequence = [];
  for (let index = 0; index < 4; index += 1) {
    await page.keyboard.press('Tab');
    sequence.push(await page.evaluate(() => {
      const element = document.activeElement;
      return element ? `${element.tagName}:${element.textContent?.trim() || element.getAttribute('aria-label') || element.getAttribute('placeholder') || ''}` : 'none';
    }));
  }
  return sequence;
}

async function prepareEmailDraft(page) {
  await page.getByRole('link', { name: '郵件流程' }).click();
  await page.getByRole('heading', { name: 'Email 外聯流程' }).waitFor();
  await page.getByRole('button', { name: '載入合成聯絡人' }).click();
  await page.getByText('2 筆', { exact: true }).waitFor();
  await page.getByRole('button', { name: '建立本機草稿' }).click();
  await page.getByText('待審核', { exact: true }).waitFor();
  await page.getByRole('button', { name: '批准目前版本' }).click();
  await page.getByText('已批准', { exact: true }).waitFor();
}

async function verifyEmailOutcome(page, outcome, expected, { doubleTrigger = false } = {}) {
  await page.goto(`${baseUrl}/#/overview`, { waitUntil: 'networkidle' });
  await prepareEmailDraft(page);
  await page.getByLabel('合成結果').selectOption(outcome);
  const enqueue = page.getByRole('button', { name: '加入本機佇列' });
  if (doubleTrigger) await enqueue.click({ clickCount: 2 });
  else await enqueue.click();
  await page.locator('.email-notice').getByText(expected, { exact: true }).waitFor();
  return page.locator('.email-queue-readback span').textContent();
}

async function verifyTelegramQueueFlow(page) {
  await page.goto(`${baseUrl}/#/overview`, { waitUntil: 'networkidle' });
  await page.getByRole('link', { name: 'Telegram' }).click();
  await page.getByRole('heading', { name: 'Telegram 外聯工作台' }).waitFor();
  await page.getByRole('button', { name: '預覽合成目標' }).click();
  await page.getByText('合成聯絡人', { exact: true }).waitFor();
  await page.getByRole('button', { name: '建立訊息預覽' }).click();
  await page.getByLabel('Telegram 訊息預覽').waitFor();
  await page.getByRole('button', { name: '批准目前內容' }).click();
  await page.getByText(/已綁定批准/).waitFor();
  await page.getByRole('button', { name: '加入本機佇列' }).click();
  await page.getByText('本機佇列已接受；沒有發送真實訊息。', { exact: true }).waitFor();
  await page.getByText('telegram.queued · success', { exact: true }).waitFor();
}

try {
  {
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    const observation = observe(page);
    await page.goto(`${baseUrl}/`, { waitUntil: 'networkidle' });
    const activationHeading = await page.getByRole('heading', { name: 'Dali Outreach 尚未啟用' }).textContent();
    const navCount = await page.locator('nav').count();
    const bootstrapMissing = await page.evaluate(() => window.__DALI_OUTREACH_BOOTSTRAP__ === undefined);
    const overflowX = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    findings.push({ kind: 'activation-off', activationHeading, navCount, bootstrapMissing, overflowX, ...observation });
    await page.close();
  }

  for (const viewport of [
    { width: 1920, height: 1080 },
    { width: 1366, height: 768 },
    { width: 390, height: 844 },
  ]) {
    const page = await browser.newPage({ viewport });
    await enableSyntheticPreview(page);
    const observation = observe(page);
    await page.goto(`${baseUrl}/#/overview`, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: '共同營運' }).waitFor();
    await page.getByRole('button', { name: '暫停兩個模塊' }).click();
    await page.getByText('Email：paused · Telegram：paused').waitFor();
    await page.getByRole('button', { name: '恢復兩個模塊' }).click();
    await page.getByText('Email：monitoring · Telegram：monitoring').waitFor();
    const keyboardFocus = await verifyKeyboardFocus(page);

    await page.getByRole('link', { name: 'Telegram' }).click();
    await page.getByRole('heading', { name: 'Telegram 外聯工作台' }).waitFor();
    await page.getByRole('button', { name: '預覽合成目標' }).click();
    await page.getByText('合成聯絡人', { exact: true }).waitFor();
    const inspection = await inspectPage(page);
    await page.screenshot({
      path: path.join(artifacts, `combined-${viewport.width}x${viewport.height}.png`),
      fullPage: true,
    });
    findings.push({ kind: 'composition', viewport, ...observation, ...inspection, keyboardFocus });
    await page.close();
  }

  for (const viewport of [
    { width: 1920, height: 1080 },
    { width: 1366, height: 768 },
  ]) {
    for (const scenario of ['loading', 'degraded', 'unavailable', 'stale', 'duplicate']) {
      const page = await browser.newPage({ viewport });
      await enableSyntheticPreview(page);
      const observation = observe(page);
      await page.goto(`${baseUrl}/test/composition/browser-scenarios.html?scenario=${scenario}`, { waitUntil: 'networkidle' });
      await page.getByRole('heading', { name: '外聯總覽' }).waitFor();
      const inspection = await inspectPage(page);
      const rootCause = await page.locator('.source-state').textContent();
      findings.push({ kind: 'source-state', scenario, viewport, ...observation, ...inspection, rootCause });
      await page.close();
    }
  }

  for (const viewport of [
    { width: 1920, height: 1080 },
    { width: 1366, height: 768 },
  ]) {
    for (const outcome of [
      { value: 'success', expected: '成功 · queued-local' },
      { value: 'failure', expected: '失敗 · fake-failed' },
      { value: 'unknown', expected: '未知 · 需要對帳' },
    ]) {
      const page = await browser.newPage({ viewport });
      await enableSyntheticPreview(page);
      const observation = observe(page);
      const queueReadback = await verifyEmailOutcome(page, outcome.value, outcome.expected);
      const inspection = await inspectPage(page);
      findings.push({ kind: 'email-outcome', outcome: outcome.value, viewport, queueReadback, ...observation, ...inspection });
      await page.close();
    }

    {
      const page = await browser.newPage({ viewport });
      await enableSyntheticPreview(page);
      const observation = observe(page);
      const queueReadback = await verifyEmailOutcome(page, 'success', '成功 · queued-local', { doubleTrigger: true });
      const inspection = await inspectPage(page);
      findings.push({ kind: 'email-double-trigger', viewport, queueReadback, ...observation, ...inspection });
      await page.close();
    }

    {
      const page = await browser.newPage({ viewport });
      await enableSyntheticPreview(page);
      const observation = observe(page);
      await verifyTelegramQueueFlow(page);
      const inspection = await inspectPage(page);
      const audit = await page.getByLabel('稽核事件').textContent();
      findings.push({ kind: 'telegram-queue', viewport, audit, ...observation, ...inspection });
      await page.close();
    }
  }
} finally {
  await browser.close();
  await server.close();
}

const expectedStateCopy = {
  loading: '正在讀取資料',
  degraded: '資料來源降級',
  unavailable: '資料來源目前無法使用',
  stale: '資料快照已過期',
  duplicate: 'duplicate-module-evidence',
};
const failed = findings.some((item) =>
  item.consoleProblems.length > 0 ||
  item.nonLoopback.length > 0 ||
  item.nonLoopbackSockets.length > 0 ||
  item.overflowX ||
  (item.kind === 'activation-off' && (
    item.activationHeading !== 'Dali Outreach 尚未啟用' ||
    item.navCount !== 0 ||
    !item.bootstrapMissing
  )) ||
  (item.kind !== 'activation-off' && (
    item.activeLinks !== 1 ||
    item.routeLinks.length !== 3 ||
    !item.routeLinks.includes('郵件流程') ||
    !item.routeLinks.includes('Telegram') ||
    item.accessibility.h1Count !== 1 ||
    !item.accessibility.hierarchyValid ||
    item.accessibility.unnamed.length > 0
  )) ||
  (item.kind === 'composition' && item.keyboardFocus.some((value) => value === 'none')) ||
  (item.kind === 'source-state' && !item.rootCause.includes(expectedStateCopy[item.scenario])) ||
  (item.kind === 'email-outcome' && !item.queueReadback.includes('1 local records')) ||
  (item.kind === 'email-double-trigger' && !item.queueReadback.includes('1 local records')) ||
  (item.kind === 'telegram-queue' && !item.audit.includes('telegram.queued · success'))
);

process.stdout.write(`${JSON.stringify({ status: failed ? 'failed' : 'passed', baseUrl, findings }, null, 2)}\n`);
if (failed) process.exitCode = 1;
