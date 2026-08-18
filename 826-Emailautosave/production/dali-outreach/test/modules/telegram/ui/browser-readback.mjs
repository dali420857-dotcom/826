import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const artifacts = path.join(here, 'artifacts');
await mkdir(artifacts, { recursive: true });

const browser = await chromium.launch({ headless: true });
const findings = [];
try {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 768, height: 900 },
    { width: 320, height: 800 },
  ]) {
    const page = await browser.newPage({ viewport });
    const consoleProblems = [];
    const nonLoopback = [];
    page.on('console', (message) => {
      if (message.type() === 'error' || message.type() === 'warning') consoleProblems.push(`${message.type()}: ${message.text()}`);
    });
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') nonLoopback.push(request.url());
    });

    await page.goto('http://127.0.0.1:4179/test/modules/telegram/ui/viewport-preview.html', { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: 'Telegram 外聯工作台' }).waitFor();
    await page.getByText('tg-***-4821', { exact: true }).waitFor();
    await page.getByRole('button', { name: '預覽合成目標' }).click();
    await page.getByText('合成聯絡人', { exact: true }).waitFor();
    await page.getByRole('button', { name: '建立訊息預覽' }).click();
    await page.getByRole('button', { name: '批准目前內容' }).click();
    await page.getByRole('button', { name: '加入本機佇列' }).click();
    await page.getByRole('status').filter({ hasText: '本機佇列已接受' }).waitFor();

    await page.keyboard.press('Tab');
    const focusedTag = await page.evaluate(() => document.activeElement?.tagName ?? 'NONE');
    const overflowX = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    await page.screenshot({ path: path.join(artifacts, `telegram-${viewport.width}.png`), fullPage: true });
    findings.push({ viewport, consoleProblems, nonLoopback, overflowX, focusedTag });
    await page.close();
  }
} finally {
  await browser.close();
}

const failed = findings.some((item) => item.consoleProblems.length || item.nonLoopback.length || item.overflowX || !['BUTTON', 'INPUT', 'TEXTAREA'].includes(item.focusedTag));
process.stdout.write(`${JSON.stringify({ status: failed ? 'failed' : 'passed', findings }, null, 2)}\n`);
if (failed) process.exitCode = 1;
