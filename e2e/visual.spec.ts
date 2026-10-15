import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function navigate(page: Page, name: string) {
  const menu = page.getByRole("button", { name: "Open menu", exact: true });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole("link", { name, exact: true }).click();
}

test("submission visual sweep across routes widths landscape and zoom emulation", async ({ page }, info) => {
  test.skip(info.project.name !== "chromium", "Supplementary visual sweep; journeys run in every browser profile.");
  test.setTimeout(180_000);
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem("vf-run-mode", "demo"));
  for (const [width, height] of [[360, 800], [390, 844], [768, 1024], [1024, 768], [1280, 900], [1440, 1000], [844, 390]]) {
    await page.setViewportSize({ width: width!, height: height! });
    await page.goto("/#/");
    await expect(page.getByRole("button", { name: "Save research note", exact: true })).toBeVisible();
    if (width === 360) {
      await page.getByRole("button", { name: "Save research note", exact: true }).click();
      await expect(page.getByText("Saved to your device's research journal.", { exact: true })).toBeVisible();
      await expect(page.getByText("Saved to your device's research journal.", { exact: true })).toHaveCount(0);
    }
    for (const name of ["Dashboard", "Compare", "Trace", "Docs", "Eval", "Journal"]) {
      if (name !== "Dashboard") await navigate(page, name);
      if (name === "Dashboard") {
        await expect(page.locator(".bento-signals article")).toHaveCount(4);
        await expect(page.locator(".recharts-line-curve")).toBeVisible();
      }
      if (name === "Compare") await expect(page.getByRole("main").getByText("Asha · Conservative", { exact: true })).toBeVisible();
      if (name === "Trace") await expect(page.getByRole("region", { name: "Reasoning overview" })).toBeVisible();
      if (name === "Docs") await expect(page.getByRole("link", { name: "Read source →", exact: true }).first()).toBeVisible();
      if (name === "Eval") await expect(page.getByRole("heading", { name: "Same-sample baselines and methodology" })).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), `${name} overflow at ${width}`).toBe(false);
      if ([390, 1440].includes(width!)) await page.screenshot({ path: info.outputPath(`${name.toLowerCase()}-${width}.png`), fullPage: true });
    }
    await navigate(page, "Dashboard");
    await expect(page.locator(".bento-signals article")).toHaveCount(4);
    await expect(page.locator(".recharts-line-curve")).toBeVisible();
    if (![390, 1440].includes(width!)) await page.screenshot({ path: info.outputPath(`dashboard-${width}x${height}.png`), fullPage: true });
  }
  // Model browser-zoom reflow: 1440 physical pixels / 2 = 720 CSS pixels.
  // CSS zoom alone is not equivalent: it leaves media-query widths unchanged.
  await page.setViewportSize({ width: 720, height: 500 });
  const session = await page.context().newCDPSession(page);
  await session.send("Emulation.setDeviceMetricsOverride", { width: 720, height: 500, deviceScaleFactor: 2, mobile: false });
  await expect(page.getByRole("button", { name: "Save research note", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  await page.screenshot({ path: info.outputPath("dashboard-zoom-reflow-200.png"), fullPage: true });
  const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(accessibility.violations).toEqual([]); expect(errors).toEqual([]);
});
