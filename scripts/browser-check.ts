import { chromium, firefox, type BrowserType, type Page } from "playwright";
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import type { SavedGame } from "../src/shared/types";

const baseURL = process.env.METRO_URL ?? "http://127.0.0.1:3000";
const runSeconds = Number(process.env.METRO_BROWSER_SECONDS ?? 65);
const localLibs = resolve(".cache/browser-libs/usr/lib/x86_64-linux-gnu");
const fontConfig = resolve(".cache/browser-fonts.conf");
if (await Bun.file(resolve(localLibs, "libfontconfig.so.1")).exists()) {
  await Bun.write(
    fontConfig,
    `<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd"><fontconfig><dir>${resolve(".cache/browser-libs/usr/share/fonts")}</dir><dir>/usr/share/fonts</dir><cachedir>${resolve(".cache/font-cache")}</cachedir></fontconfig>`,
  );
}
const browserEnv = {
  ...process.env,
  LD_LIBRARY_PATH: [localLibs, process.env.LD_LIBRARY_PATH]
    .filter(Boolean)
    .join(":"),
  ...((await Bun.file(fontConfig).exists())
    ? { FONTCONFIG_FILE: fontConfig }
    : {}),
} as Record<string, string>;
// Playwright's preflight ldd runs in the parent process; use the same local libraries there.
process.env.LD_LIBRARY_PATH = browserEnv.LD_LIBRARY_PATH;
if (browserEnv.FONTCONFIG_FILE)
  process.env.FONTCONFIG_FILE = browserEnv.FONTCONFIG_FILE;
await mkdir("test-results", { recursive: true });
function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
async function savedState(page: Page): Promise<SavedGame | null> {
  return page.evaluate(
    () =>
      new Promise((resolve) => {
        const request = indexedDB.open("metro-wien", 1);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("saves", "readonly");
          const get = tx.objectStore("saves").get("current");
          tx.oncomplete = () => {
            db.close();
            resolve(get.result ?? null);
          };
        };
      }),
  );
}
async function save(page: Page): Promise<SavedGame> {
  const before = Date.now();
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  await page.waitForFunction(
    async ({ before }) =>
      new Promise<boolean>((resolve) => {
        const request = indexedDB.open("metro-wien", 1);
        request.onsuccess = () => {
          const db = request.result,
            tx = db.transaction("saves", "readonly"),
            get = tx.objectStore("saves").get("current");
          tx.oncomplete = () => {
            db.close();
            resolve(Date.parse(get.result?.savedAt ?? "") >= before);
          };
        };
      }),
    { before },
  );
  return (await savedState(page))!;
}
async function checkBrowser(name: string, type: BrowserType) {
  const browser = await type.launch({ headless: true, env: browserEnv });
  const errors: string[] = [];
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("response", (response) => {
    if (response.status() >= 400)
      errors.push(`${response.status()} ${response.url()}`);
  });
  try {
    await page.goto(baseURL);
    await page
      .getByRole("button", { name: "Betrieb übernehmen", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Simulation pausieren", exact: true })
      .click();
    assert(
      (await page.locator(".left-sidebar .line-row").count()) === 18,
      "Expected 18 selected lines",
    );
    assert(
      (await page.locator(".network-map .station").count()) === 335,
      "Expected all335 stations",
    );
    assert(
      (await page.locator(".vehicle-marker").count()) > 100,
      "Worker should provide a populated vehicle network",
    );
    await page
      .locator(".left-sidebar")
      .getByRole("button", { name: "Linie 13A auswählen", exact: true })
      .click();
    assert(
      await page
        .locator(".selection-title")
        .innerText()
        .then((t) => t.includes("13A")),
      "Bus must be selectable",
    );
    await page
      .locator(".left-sidebar")
      .getByRole("button", { name: "Linie U1 auswählen", exact: true })
      .click();
    const beforeDeployment = await save(page);
    await page
      .getByRole("button", { name: "Fahrzeug einsetzen", exact: false })
      .click();
    const afterDeployment = await save(page);
    assert(
      afterDeployment.state.vehicles.length ===
        beforeDeployment.state.vehicles.length,
      "Deployment must conserve finite fleet",
    );
    assert(
      afterDeployment.state.vehicles.some((v) => v.status === "deploying"),
      "Deployment must take time",
    );
    await page
      .getByRole("textbox", { name: "Station suchen" })
      .fill("Karlsplatz");
    await page
      .locator(".search-results")
      .getByRole("button", { name: "Karlsplatz", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Andrang auslösen", exact: true })
      .click();
    await page.locator(".event-crowd").first().waitFor();
    assert(
      (await page.locator(".event-crowd").count()) > 0,
      "Crowd event must appear",
    );
    await page
      .getByRole("button", { name: "Ereignis auslösen", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Streckensperre", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Ersatzbuslinie einrichten", exact: true })
      .click();
    await page.waitForFunction(
      () => document.querySelectorAll(".left-sidebar .line-row").length === 19,
    );
    assert(
      (await page.locator(".left-sidebar .line-row").count()) === 19,
      "Replacement bus must become controllable line",
    );
    await page
      .getByRole("button", { name: "Zur Linienübersicht", exact: true })
      .click();
    await page.locator(".vehicle-list > button").first().click();
    await page.selectOption("#target-line", "U2");
    await page
      .getByRole("button", { name: "Umleitung prüfen", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .filter({ hasText: "Einsatz bestätigen" })
      .waitFor();
    await page.getByRole("button", { name: "Bestätigen", exact: true }).click();
    const transferred = await save(page);
    assert(
      transferred.state.vehicles.some((v) => v.status === "transfer"),
      "Confirmed route must dispatch physical transfer",
    );
    await page.screenshot({ path: `test-results/${name}-desktop.png` });
    await page.getByRole("button", { name: "5-fache Geschwindigkeit" }).click();
    await page
      .getByRole("button", { name: "Simulation starten", exact: true })
      .click();
    console.log(`${name}: running full network at5× for ${runSeconds}s`);
    // Real worker time, not timer emulation: inspect progress in five-second windows.
    for (let elapsed = 0; elapsed < runSeconds; elapsed += 5)
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(5, runSeconds - elapsed) * 1000),
      );
    await page
      .getByRole("button", { name: "Simulation pausieren", exact: true })
      .click();
    const beforeReload = await save(page);
    const s = beforeReload.state;
    const waiting = Object.values(s.waiting)
      .flat()
      .reduce((n, g) => n + g.count, 0);
    const onboard = s.vehicles.reduce(
      (n, v) => n + v.passengers.reduce((m, g) => m + g.count, 0),
      0,
    );
    assert(
      s.time >= transferred.state.time + runSeconds * 4,
      "Simulation must progress at5×",
    );
    assert(
      s.metrics.generated ===
        s.metrics.completed + s.metrics.abandoned + waiting + onboard,
      "Real browser simulation must conserve passengers",
    );
    assert(
      s.vehicles.length === beforeDeployment.state.vehicles.length,
      "Real browser simulation must conserve vehicles",
    );
    await page.reload();
    await page
      .getByRole("button", { name: "Simulation starten", exact: true })
      .waitFor();
    const loaded = await save(page);
    assert(
      JSON.stringify(loaded.state) === JSON.stringify(s),
      "Reload must preserve full state, including deterministic PRNG, and remain paused",
    );
    assert(!errors.length, errors.join("\n"));
    await page.screenshot({ path: `test-results/${name}-after-run.png` });
    await page.setViewportSize({ width: 1366, height: 768 });
    assert(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <= window.innerWidth &&
          document.documentElement.scrollHeight <= window.innerHeight,
      ),
      "Desktop laptop layout must fit without page overflow",
    );
    assert(
      await page
        .getByRole("button", { name: "Simulation starten", exact: true })
        .isVisible(),
      "Playback must remain accessible on laptop screens",
    );
    await page.screenshot({ path: `test-results/${name}-laptop.png` });
    const report = {
      browser: name,
      viewport: "1600x1000",
      additionalViewport: "1366x768",
      runSeconds,
      simulatedSeconds: s.time - transferred.state.time,
      fleet: s.vehicles.length,
      generated: s.metrics.generated,
      completed: s.metrics.completed,
      waiting,
      onboard,
      errors,
      saveReloadExact: true,
    };
    await Bun.write(
      `test-results/${name}.json`,
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify(report));
  } catch (error) {
    await page
      .screenshot({ path: `test-results/${name}-failure.png` })
      .catch(() => {});
    console.error(`${name} failed:`, error);
    throw error;
  } finally {
    await browser.close();
  }
}
const results = await Promise.allSettled([
  checkBrowser("chromium", chromium),
  checkBrowser("firefox", firefox),
]);
results.forEach((r) => {
  if (r.status === "rejected") console.error(r.reason);
});
if (results.some((r) => r.status === "rejected")) process.exit(1);
