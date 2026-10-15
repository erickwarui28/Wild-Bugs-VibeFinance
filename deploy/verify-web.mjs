// Real deployed frontend smoke, with isolated browser storage and Demo only.
// Never prints visitor capabilities or invokes paid models. Screenshots stay local.
import { chromium, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

const output = path.resolve('test-results/deployed-site');
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch();
const errors = [];
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(() => localStorage.setItem('vf-run-mode', 'demo'));
  await context.route(/\/api\/(analyze|compare)$/, async route => {
    if (route.request().postDataJSON()?.mode !== 'demo') {
      errors.push('Blocked a non-Demo analysis request'); await route.abort();
    } else await route.continue();
  });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto('https://erickwarui28.github.io/vibefinance/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'Save research note', exact: true })).toBeVisible({ timeout: 45000 });
  await expect(page.getByText('Explanations: deterministic', { exact: true })).toBeVisible();
  await expect(page.locator('.recharts-line-curve')).toBeVisible();
  await page.screenshot({ path: path.join(output, 'dashboard-desktop.png'), fullPage: true });
  await page.getByRole('button', { name: 'Save research note', exact: true }).click();
  await expect(page.getByText("Saved to your device's research journal.", { exact: true })).toBeVisible();
  await expect(page.getByText("Saved to your device's research journal.", { exact: true })).toHaveCount(0);
  const checked = [];
  for (const name of ['Compare', 'Trace', 'Docs', 'Eval', 'Journal']) {
    await page.getByRole('link', { name, exact: true }).click();
    if (name === 'Compare') await expect(page.getByRole('main').getByText('Asha · Conservative', { exact: true })).toBeVisible();
    if (name === 'Trace') await expect(page.getByRole('region', { name: 'Reasoning overview' })).toBeVisible();
    if (name === 'Docs') await expect(page.getByRole('link', { name: 'Read source →', exact: true }).first()).toBeVisible();
    if (name === 'Eval') await expect(page.getByRole('heading', { name: 'Same-sample baselines and methodology' })).toBeVisible();
    if (name === 'Journal') await expect(page.getByRole('button', { name: 'Export private journal' })).toBeVisible();
    await page.screenshot({ path: path.join(output, `${name.toLowerCase()}-desktop.png`), fullPage: true });
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error(`Overflow: ${name}`);
    checked.push(name);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  const menu = page.getByRole('button', { name: 'Open menu', exact: true });
  await menu.click(); await page.getByRole('link', { name: 'Dashboard', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save research note', exact: true })).toBeVisible();
  await expect(page.locator('.recharts-line-curve')).toBeVisible();
  await page.screenshot({ path: path.join(output, 'dashboard-mobile.png'), fullPage: true });
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error('Mobile overflow');
  if (errors.length) throw new Error(JSON.stringify(errors));
  console.log(JSON.stringify({ ok: true, deployedRoutes: ['Dashboard', ...checked], mobileWidth: 390, paidModelsInvoked: false }));
} finally { await browser.close(); }
