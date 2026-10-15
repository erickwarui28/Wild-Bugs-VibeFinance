import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("vf-run-mode", "demo"));
});

async function nav(page: Page, name: string) {
  const menu = page.getByRole("button", { name: "Open menu", exact: true });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole("link", { name, exact: true }).click();
}

async function dashboard(page: Page) {
  await page.goto("/#/");
  await expect(page.getByRole("button", { name: "Save research note", exact: true })).toBeVisible();
  await expect(page.getByText("Frozen evidence from this analysis", { exact: false })).toBeVisible();
}

test("first visits default to Demo, selected Live persists, and timings match the displayed run", async ({ browser }) => {
  const context=await browser.newContext(); const page=await context.newPage();
  try {
    const analysis=page.waitForResponse(r=>r.url().endsWith('/api/analyze')&&r.ok());
    const traced=page.waitForResponse(r=>r.url().includes('/api/trace/')&&r.ok());
    await page.goto('/#/');
    const result=await(await analysis).json(); expect(result.dataMode).toBe('synthetic');
    await expect(page.getByRole('button',{name:'Demo',exact:true})).toHaveAttribute('aria-pressed','true');
    const trace=await(await traced).json(); const steps=trace.steps;
    const span=Math.max(...steps.map((s:{endedAt:string})=>Date.parse(s.endedAt)))-Math.min(...steps.map((s:{startedAt:string})=>Date.parse(s.startedAt)));
    await expect(page.getByText('Server trace',{exact:true}).locator('..').getByText(`${span} ms`,{exact:true})).toBeVisible();
    await expect(page.getByText('Browser request',{exact:true})).toBeVisible();
    await expect(page.getByText('Fixture accuracy vs 30d',{exact:true})).toHaveCount(0);
    await expect(page.getByText('Lower measured volatility',{exact:true})).toBeVisible();
    const live=page.waitForResponse(r=>r.url().endsWith('/api/analyze')&&r.request().postDataJSON()?.mode==='live'&&r.ok());
    await page.getByRole('button',{name:'Try Live',exact:true}).click();await live;
    await page.reload();await expect(page.getByRole('button',{name:'Live',exact:true})).toHaveAttribute('aria-pressed','true');
  } finally {await context.close();}
});

test("automatically analyzes current selections and refresh bypasses the cache", async ({ page }) => {
  await page.route("**/api/health", async route => {
    const response = await route.fetch(); const body = await response.json();
    await route.fulfill({ response, json: { ...body, provider: "openai" } });
  });
  await dashboard(page);
  expect(await page.getByText("Explanations: deterministic", { exact: true }).count()).toBe(1);
  await page.getByRole("combobox", { name: "Ticker", exact: true }).selectOption("TCS");
  await page.getByRole("combobox", { name: "Profile", exact: true }).selectOption("conservative");
  await expect(page.getByRole("heading", { name: "TCS research · Asha", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Run demo: TCS · conservative", exact: true })).toBeEnabled();
  await expect(page.getByText("TCS close", { exact: true })).toBeVisible();
  const response = page.waitForResponse((r) => r.url().endsWith("/api/analyze") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Run demo: TCS · conservative", exact: true }).click();
  expect((await (await response).json()).agentCache.hit).toBe(false);
});

test("auto Compare reuses matching private agents and Trace remains accessible", async ({ page }) => {
  await dashboard(page);
  const response = page.waitForResponse((r) => r.url().endsWith("/api/compare"));
  await nav(page, "Compare");
  const result = await (await response).json();
  expect(result.results[0].agentCache.hit).toBe(true);
  for (const name of ["Asha · Conservative", "Rohan · Moderate", "Meera · Aggressive"]) await expect(page.getByRole("main").getByText(name, { exact: true })).toBeVisible();
  await expect(page.getByText("Reused matching agent evidence", { exact: false })).toBeVisible();
  await page.goto(`/#/trace/${result.runId}`);
  await expect(page.getByText("Total elapsed:", { exact: false })).toBeVisible();
  await expect(page.getByText("agent-cache", { exact: true }).first()).toBeVisible();
});

test("citations open immutable source documents and journal notes survive reload", async ({ page }) => {
  await dashboard(page);
  await page.getByRole("button", { name: "Save research note", exact: true }).click();
  const citation = page.getByRole("button", { name: /DOC-INFY-Q2-R#c0/ }).first();
  await citation.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("link", { name: "Open document", exact: true }).click();
  await expect(page.getByText("Viewing a frozen source", { exact: false })).toBeVisible();
  await expect(page.getByRole("heading", { name: "INFY Q2 results note", exact: true })).toBeVisible();
  await expect(page).toHaveURL(/snapshotId=/);
  await nav(page, "Journal");
  await page.getByRole("textbox", { name: "Your research note", exact: true }).fill("QA: revisit the original source evidence.");
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Your research note", exact: true })).toHaveValue("QA: revisit the original source evidence.");
});

test("opening Docs or Eval does not start a model analysis", async ({ page }) => {
  const analyses: string[] = [];
  page.on("request", (request) => { if (/\/api\/(analyze|compare)$/.test(request.url())) analyses.push(request.url()); });
  await page.goto("/#/docs");
  await expect(page.getByRole("link", { name: "Read source →", exact: true }).first()).toBeVisible();
  await nav(page, "Eval");
  await expect(page.getByRole("heading", { name: /Eval|Evaluation/i }).first()).toBeVisible();
  expect(analyses).toEqual([]);
});

test("evaluation publishes honest paired methodology and recovers from a failed load", async ({ page }) => {
  await page.goto("/#/eval");
  await expect(page.getByRole("heading", { name: "Same-sample baselines and methodology" })).toBeVisible();
  await expect(page.getByText("Calibration is disabled.", { exact: false })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Retrieval grounding checks" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Engine workload benchmark" })).toBeVisible();
  const report = await page.request.get("http://127.0.0.1:18092/api/eval");
  const body = await report.json(); expect(body.backtest.version).toBe(2);
  expect(body.backtest.methodology.calibrated).toBe(false);
  expect(body.backtest.composite.n + body.backtest.abstained).toBe(body.backtest.eligible);
  expect(body.backtest.retrieval.checks.every((check: { allCitationsResolvable: boolean }) => check.allCitationsResolvable)).toBe(true);
  await page.route("**/api/eval", route => route.fulfill({ status: 503, body: "unavailable" }));
  // Route remount must surface a failed load instead of claiming an empty evaluation.
  await nav(page, "Docs"); await nav(page, "Eval");
  await expect(page.getByRole("alert")).toContainText("could not be loaded");
  await page.unroute("**/api/eval"); await page.getByRole("button", { name: "Retry evaluation" }).click();
  await expect(page.getByRole("heading", { name: "Same-sample baselines and methodology" })).toBeVisible();
});

test("journal backups validate atomically, preserve notes and export note-free briefs", async ({ page }) => {
  await dashboard(page);
  await page.getByRole("button", { name: "Save research note", exact: true }).click();
  await nav(page, "Journal");
  await page.getByRole("textbox", { name: "Your research note", exact: true }).fill("PRIVATE-NOTE-MUST-NOT-LEAK");
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("vf-research-journal") ?? "[]"));
  const file = { format: "vibefinance-journal", version: 1, entries: stored.map((entry: object) => ({ ...entry, note: "imported replacement" })) };
  await page.getByLabel("Import journal file").setInputFiles({ name: "backup.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(file)) });
  await expect(page.getByRole("status").filter({ hasText: "Journal imported" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Your research note", exact: true })).toHaveValue("PRIVATE-NOTE-MUST-NOT-LEAK");
  await page.getByLabel("Import journal file").setInputFiles({ name: "bad.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ ...file, version: 99 })) });
  await expect(page.getByRole("alert")).toContainText("version-1");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("vf-research-journal") ?? "[]"))).toEqual(stored);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download evidence brief (without notes)", exact: true }).click();
  const stream = await (await download).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const brief = Buffer.concat(chunks).toString("utf8");
  expect(brief).toContain("VibeFinance evidence brief");
  expect(brief).not.toContain("PRIVATE-NOTE-MUST-NOT-LEAK");
  await expect(page.getByRole("main")).toBeVisible();
});

test("quota failures are visible and preserve the last matching result", async ({ page }) => {
  await dashboard(page);
  await page.route("**/api/analyze", (route) => route.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ error: "The application's OpenAI spending budget has been reached." }) }));
  await page.getByRole("button", { name: "Run demo: INFY · moderate", exact: true }).click();
  await expect(page.getByText("The application's OpenAI spending budget has been reached.", { exact: true })).toBeVisible();
  await expect(page.getByText("INFY close", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Run demo: INFY · moderate", exact: true })).toBeEnabled();
});

test("abandoned refresh is cancelled when leaving Dashboard", async ({ page }) => {
  await page.addInitScript(() => {
    const original = window.fetch.bind(window);
    window.fetch = (input, options) => {
      if (String(input).endsWith("/api/analyze")) options?.signal?.addEventListener("abort", () => { document.documentElement.dataset.qaAnalysisAborted = "yes"; }, { once: true });
      return original(input, options);
    };
  });
  await dashboard(page);
  let observed = false;
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/analyze", async (route) => {
    observed = true;
    await held;
    try { await route.continue(); } catch { /* The browser may already have cancelled the request. */ }
  });
  try {
    await page.getByRole("button", { name: "Run demo: INFY · moderate", exact: true }).click();
    await expect.poll(() => observed).toBe(true);
    await nav(page, "Docs");
    await expect(page.locator("html")).toHaveAttribute("data-qa-analysis-aborted", "yes");
    await expect(page.getByRole("heading", { name: "Evidence library", exact: true })).toBeVisible();
  } finally { release(); }
});

test("Live mode uses recorded live fixtures and a mode-correct disclosure", async ({ page }) => {
  await dashboard(page);
  const response = page.waitForResponse((r) => r.url().endsWith("/api/analyze") && r.request().postDataJSON()?.mode === "live");
  await page.getByRole("button", { name: "Live", exact: true }).click();
  const result = await (await response).json();
  expect(result.dataMode).toBe("live"); expect(result.provenance).toBe("LIVE");
  expect(result.evidenceCoverage.channels[0].retrievedThrough).toBeTruthy();
  const coverage=page.getByRole("region",{name:"Source freshness and coverage"});
  await expect(coverage.getByRole("article").filter({has:page.getByRole("heading",{name:"Closing prices",exact:true})}).getByText("Live-sourced",{exact:true})).toBeVisible();
  await expect(coverage.getByText("Synthetic demo",{exact:true})).toHaveCount(0);
  await expect(page.getByText("Frozen evidence from this analysis", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "About the data", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "About the data · Live", exact: true })).toBeVisible();
  await expect(page.getByText("Prices are daily NSE close-field observations", { exact: false })).toBeVisible();
  await expect(page.getByText("Synthetic NSE-style prices come from a seeded regime generator.", { exact: false })).toHaveCount(0);
});

test("all main routes pass automated accessibility checks", async ({ page }) => {
  test.setTimeout(60_000);
  await dashboard(page);
  await page.getByRole("button", { name: "Save research note", exact: true }).click();
  const toast = page.getByText("Saved to your device's research journal.", { exact: true });
  await expect(toast).toBeVisible();
  const feedback = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(feedback.violations).toEqual([]);
  await expect(toast).toHaveCount(0);
  for (const name of ["Compare", "Trace", "Docs", "Eval", "Journal"]) {
    await nav(page, name);
    await expect(page.getByRole("main")).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(results.violations.map((issue) => ({ page: name, id: issue.id, targets: issue.nodes.map((node) => node.target) }))).toEqual([]);
  }
});

test("offline Live is honest and the bundled Demo remains available", async ({ page }) => {
  await page.route("**/api/**", (route) => route.abort());
  await page.addInitScript(() => localStorage.setItem("vf-run-mode", "live"));
  await page.goto("/#/");
  await expect(page.getByText("API unreachable. Reconnect for live analysis, or switch to Demo.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Demo", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save research note", exact: true })).toBeVisible();
  await expect(page.getByText("API unreachable. The offline demo supports INFY for Rohan.", { exact: true })).toBeVisible();
  await expect(page.getByRole("region",{name:"Source freshness and coverage"})).toBeVisible();
  await expect(page.getByText("270 observations",{exact:true})).toBeVisible();
});

test("source coverage and glossary explain Demo evidence without another analysis",async({page})=>{
  const calls:string[]=[];page.on("request",r=>{if(r.method()==="POST"&&/\/api\/(analyze|compare)$/.test(r.url()))calls.push(r.url());});
  await dashboard(page);
  const coverage=page.getByRole("region",{name:"Source freshness and coverage"});
  await expect(coverage.getByText("Synthetic demo",{exact:true})).toHaveCount(3);
  await coverage.screenshot({path:test.info().outputPath("source-coverage.png")});
  const before=calls.length;
  const confidence=page.getByRole("button",{name:"Explain Evidence confidence",exact:true});
  await confidence.click();const dialog=page.getByRole("dialog",{name:"Research glossary"});
  await expect(dialog.getByText("It is not the probability",{exact:false})).toBeVisible();
  await dialog.getByLabel("Find a term").fill("RSI");await expect(dialog.getByText("RSI (Relative Strength Index)",{exact:true})).toBeVisible();
  await dialog.getByLabel("Find a term").fill("no-such-term");await expect(dialog.getByText("No matching terms.",{exact:false})).toBeVisible();
  await dialog.getByRole("button",{name:"Show all terms"}).click();
  const axe=await new AxeBuilder({page}).withTags(["wcag2a","wcag2aa","wcag21aa"]).analyze();expect(axe.violations).toEqual([]);
  await page.keyboard.press("Escape");await expect(confidence).toBeFocused();expect(calls).toHaveLength(before);
});

test("missing evidence is explicit and saved coverage stays tied to its snapshot",async({page})=>{
  await dashboard(page);
  await page.getByRole("button",{name:"Save research note",exact:true}).click();
  await nav(page,"Journal");await page.getByText("Saved source coverage",{exact:true}).click();
  await expect(page.getByRole("region",{name:"Source freshness and coverage"})).toBeVisible();
  await nav(page,"Dashboard");
  await page.getByRole("button",{name:"Degrade · 0",exact:true}).click();
  const response=page.waitForResponse(r=>r.url().endsWith("/api/analyze")&&r.request().postDataJSON()?.degrade?.includes("missingFiling"));
  await page.getByRole("switch",{name:"Missing filing",exact:true}).click();await page.keyboard.press("Escape");
  const result=await(await response).json();expect(result.evidenceCoverage.channels.find((c:{kind:string})=>c.kind==="documents").count).toBe(0);
  const docs=page.getByRole("region",{name:"Source freshness and coverage"}).getByRole("article").filter({has:page.getByRole("heading",{name:"Documents / summaries",exact:true})});
  await expect(docs.getByText("Missing from this analysis",{exact:true})).toBeVisible();
});

test("keyboard navigation, dialog focus, responsive layout and automated accessibility checks", async ({ page }, testInfo) => {
  await dashboard(page);
  await page.screenshot({ path: testInfo.outputPath("dashboard.png"), fullPage: false });
  await page.getByRole("link", { name: "Skip to main content", exact: true }).focus();
  await expect(page.getByRole("link", { name: "Skip to main content", exact: true })).toBeFocused();
  await page.keyboard.press("Enter"); await expect(page.getByRole("main")).toBeFocused();
  const about = page.getByRole("button", { name: "About the data", exact: true });
  await about.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape"); await expect(about).toBeFocused();
  if (testInfo.project.name.startsWith("mobile")) {
    const columns = page.locator(".bento-layout > .bento-column");
    await expect(columns.nth(0)).toHaveClass(/bento-summary/);
    await expect(columns.nth(1)).toHaveClass(/bento-main/);
    await expect(columns.nth(2)).toHaveClass(/bento-sidebar/);
    await page.getByRole("button", { name: "Open menu", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Navigation", exact: true })).toBeVisible();
    await page.keyboard.press("Escape"); await expect(page.getByRole("button", { name: "Open menu", exact: true })).toBeFocused();
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.map((issue) => ({ id: issue.id, impact: issue.impact, targets: issue.nodes.map((node) => node.target) }))).toEqual([]);
  const degrade = page.getByRole("button", { name: "Degrade · 0", exact: true });
  await degrade.click(); await expect(page.getByRole("dialog", { name: "Degrade", exact: true })).toBeVisible();
  const modal = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(modal.violations.map((issue) => issue.id)).toEqual([]);
  await page.keyboard.press("Escape"); await expect(degrade).toBeFocused();
});
