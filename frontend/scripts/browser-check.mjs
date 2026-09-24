import assert from "node:assert/strict";
import { access, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { chromium } from "playwright-core";

const frontend = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(frontend, "..");
const port = Number(process.env.RATCHET_UI_PORT ?? 4317);
const origin = `http://127.0.0.1:${port}`;
const screenshot = process.argv.includes("--screenshots");
const responsive = process.argv.includes("--responsive");
const verdictScreenshots = process.argv.includes("--verdicts");
const hasProductionBuild = existsSync(resolve(frontend, ".next", "BUILD_ID")) && process.env.RATCHET_UI_USE_DEV_SERVER !== "1";
const desktopPath = resolve(root, ".impeccable", "review", "desktop.png");
const mobilePath = resolve(root, ".impeccable", "review", "mobile.png");
const portalShotDir = process.env.RATCHET_SCREENSHOT_DIR
  ? resolve(root, process.env.RATCHET_SCREENSHOT_DIR)
  : resolve(root, "artifacts", "screenshots");
const deployment = JSON.parse(await readFile(resolve(frontend, "lib", "deployment.json"), "utf8"));
const network = process.env.NEXT_PUBLIC_RATCHET_NETWORK?.trim() || deployment.network || "studioDevnet";
const networkLabel = network === "studionet" ? "Studionet" : "Studio Next";
const chainId = network === "studionet" ? 61999 : 61997;
const configuredAddress = process.env.NEXT_PUBLIC_RATCHET_ADDRESS?.trim() || (
  deployment.network === network && deployment.chainId === chainId ? deployment.contract : ""
);

async function findBrowser() {
  const candidates = [
    process.env.RATCHET_BROWSER_PATH,
    chromium.executablePath(),
    process.platform === "win32" ? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe" : undefined,
    process.platform === "win32" ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" : undefined,
    process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : undefined,
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
  ].filter(Boolean);
  for (const candidate of candidates) {
    try { await access(candidate); return candidate; } catch { /* try next installed browser */ }
  }
  throw new Error("No installed Chromium browser was found. Set RATCHET_BROWSER_PATH to Chrome, Chromium, or Edge.");
}

async function waitForServer(server, output) {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (server.exitCode !== null) throw new Error(`Next dev server exited early.\n${output()}`);
    try {
      const response = await fetch(origin);
      if (response.ok) return;
    } catch { /* server is starting */ }
    await new Promise((done) => setTimeout(done, 750));
  }
  throw new Error(`Next dev server did not become ready.\n${output()}`);
}

const nextBin = resolve(root, "node_modules", "next", "dist", "bin", "next");
let logs = "";
const server = spawn(process.execPath, [nextBin, hasProductionBuild ? "start" : "dev", "--hostname", "127.0.0.1", "--port", String(port)], {
  cwd: frontend,
  env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stdout.on("data", (chunk) => { logs = `${logs}${chunk}`.slice(-8_000); });
server.stderr.on("data", (chunk) => { logs = `${logs}${chunk}`.slice(-8_000); });

let browser;
try {
  await waitForServer(server, () => logs);
  browser = await chromium.launch({ headless: true, executablePath: await findBrowser() });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(origin, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.getByRole("heading", { name: /Upgrades must stay inside what they declare/i }).waitFor({ timeout: 20_000 });
  if (configuredAddress) {
    await page.waitForFunction(() => {
      const heading = document.querySelector(".release-heading-row h3")?.textContent?.trim();
      const picker = document.querySelector(".release-picker-label select");
      const selectedId = picker instanceof HTMLSelectElement ? picker.value : "";
      const detailError = [...document.querySelectorAll('[role="status"]')]
        .some((item) => item.textContent?.includes("Could not read "));
      if (!picker) return Boolean(heading && heading !== "Reading release index…");
      return Boolean(selectedId && (heading === selectedId || detailError));
    }, undefined, { timeout: 45_000 });
  }
  const body = await page.locator("body").innerText();
  assert.match(body, /Ratchet/);
  assert.ok(body.includes(networkLabel), `page should identify ${networkLabel}`);
  assert.match(body, /DECLARED|Declared/i);
  assert.match(body, /OBSERVED|Observed/i);
  assert.match(body, /ADVANCE/);
  assert.match(body, /HOLD/);
  assert.match(body, /ROLLBACK/);
  if (configuredAddress) {
    assert.ok(body.includes(configuredAddress.slice(0, 12)), "configured page must display the deployed contract address");
    assert.match(body, /No release selected|RATCHET-|RPC unavailable|Could not read/i, "configured page must show live contract state or an honest read failure");
    if (body.includes("Live RPC")) assert.ok(body.includes(`Live RPC · chain ${chainId}`), `${networkLabel} chain IDs must be displayed in decimal`);
  } else {
    assert.match(body, /No contract|not configured|Connect Ratchet/i);
    assert.doesNotMatch(body, /0x[a-fA-F0-9]{40}/, "unconfigured page must not display a fabricated live contract address");
  }

  if (verdictScreenshots) {
    assert.ok(configuredAddress, "verdict screenshots require the live deployment address");
    const expected = [
      ["RATCHET-ADVANCE", "ADVANCED"],
      ["RATCHET-HOLD", "HELD"],
      ["RATCHET-ROLLBACK", "ROLLED_BACK"],
    ];
    const picker = page.locator(".release-picker-label select");
    const available = await picker.locator("option").evaluateAll((options) => options.map((option) => option.value));
    const missing = expected.map(([id]) => id).filter((id) => !available.includes(id));
    assert.deepEqual(missing, [], `live contract is missing demo releases: ${missing.join(", ")}`);
    await mkdir(portalShotDir, { recursive: true });
    for (const [id, state] of expected) {
      await picker.selectOption(id);
      const stateSnapshot = await page.waitForFunction(({ releaseId, releaseState }) => {
        const title = document.querySelector(".release-heading-row h3")?.textContent?.trim();
        const verdict = document.querySelector(".verdict-word")?.textContent?.trim();
        const status = document.querySelector(".release-heading-row .status")?.textContent?.trim();
        const failure = Array.from(document.querySelectorAll(".inline-alert.error"))
          .map((alert) => alert.textContent?.trim() ?? "")
          .find((message) => message.includes(releaseId) || message.includes("Could not read"));
        if (failure) return { failure, title, verdict, status };
        return title === releaseId && verdict === releaseId.replace("RATCHET-", "") && status === releaseState
          ? { title, verdict, status }
          : false;
      }, { releaseId: id, releaseState: state }, { timeout: 45_000 });
      const renderedState = await stateSnapshot.jsonValue();
      assert.ok(!renderedState.failure, `${id} could not load from the live contract: ${renderedState.failure}`);
      assert.deepEqual(
        [renderedState.title, renderedState.verdict, renderedState.status],
        [id, id.replace("RATCHET-", ""), state],
        `${id} did not render the expected live verdict`,
      );
      await page.evaluate(() => document.fonts.ready);
      const slug = id.toLowerCase();
      for (const [width, height, suffix] of [[1440, 1000, "desktop"], [375, 844, "mobile"]]) {
        await page.setViewportSize({ width, height });
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(120);
        const metrics = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
        assert.ok(metrics.scroll <= metrics.client + 1, `${id} has horizontal overflow at ${width}px: ${JSON.stringify(metrics)}`);
        await page.screenshot({ path: resolve(portalShotDir, `${slug}-${suffix}.png`), fullPage: true, animations: "disabled", caret: "hide" });
      }
    }
    console.log(`Saved six live verdict screenshots under ${portalShotDir}.`);
  }

  const widths = responsive ? [1440, 1280, 768, 390, 375] : [1440];
  for (const width of widths) {
    await page.setViewportSize({ width, height: width <= 390 ? 844 : 1000 });
    await page.waitForTimeout(100);
    const metrics = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    assert.ok(metrics.scroll <= metrics.client + 1, `horizontal overflow at ${width}px: ${JSON.stringify(metrics)}`);
    if (width <= 390) {
      const touchTargets = await page.locator("button, a, input, select, textarea").evaluateAll((items) => items.map((item) => {
        const box = item.getBoundingClientRect();
        return { tag: item.tagName, width: box.width, height: box.height, label: item.getAttribute("aria-label") || item.textContent?.trim().slice(0, 32) };
      }).filter((item) => item.width > 0 && item.height > 0 && (item.width < 43 || item.height < 43)));
      assert.equal(touchTargets.length, 0, `touch targets below 44px at ${width}px: ${JSON.stringify(touchTargets)}`);
    }
  }

  if (screenshot) {
    await mkdir(resolve(root, ".impeccable", "review"), { recursive: true });
    await mkdir(portalShotDir, { recursive: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({ path: desktopPath, fullPage: true, animations: "disabled" });
    await page.screenshot({ path: resolve(portalShotDir, "desktop.png"), fullPage: true, animations: "disabled" });
    await page.setViewportSize({ width: 375, height: 844 });
    await page.screenshot({ path: mobilePath, fullPage: true, animations: "disabled" });
    await page.screenshot({ path: resolve(portalShotDir, "mobile.png"), fullPage: true, animations: "disabled" });
    console.log(`Saved desktop and mobile screenshots under ${resolve(root, ".impeccable", "review")} and ${portalShotDir}.`);
  }
  assert.deepEqual(pageErrors, [], `uncaught browser errors: ${pageErrors.join("; ")}`);
  console.log(`UI checks passed${responsive ? " at 1440, 1280, 768, 390, and 375px" : ""}.`);
} finally {
  if (browser) await browser.close();
  server.kill();
}
