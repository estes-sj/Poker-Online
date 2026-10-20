// Screenshots a seeded bot table at phone size.
//   node scripts/dev-table/shoot.mjs <seed.json> <outDir> [shots=1] [intervalMs=4000] [width=393] [height=852]
// Needs playwright-core installed outside the repo (PLAYWRIGHT_DIR, default ~/.cache/poker-shot)
// and CHROMIUM_PATH pointing at a Chromium binary.
import { readFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";

const playwrightDir = process.env.PLAYWRIGHT_DIR ?? `${homedir()}/.cache/poker-shot`;
const { chromium } = createRequire(`${playwrightDir}/package.json`)("playwright-core");

const [seedPath, outDir, shots = "1", intervalMs = "4000", width = "393", height = "852"] = process.argv.slice(2);
const seed = JSON.parse(readFileSync(seedPath, "utf8"));
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
const context = await browser.newContext({
  viewport: { width: Number(width), height: Number(height) },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
});
await context.addInitScript((session) => {
  window.localStorage.setItem("river-club-session", JSON.stringify(session));
  window.sessionStorage.setItem("river-club-mobile-layout-recommendation-dismissed", "1");
  // Hide the Next.js dev-mode badge so screenshots look like production.
  document.addEventListener("DOMContentLoaded", () => {
    const style = document.createElement("style");
    style.textContent = "nextjs-portal { display: none !important; }";
    document.head.append(style);
  });
}, seed.session);

const page = await context.newPage();
await page.goto(seed.url, { waitUntil: "networkidle" });
await page.waitForTimeout(2500);

for (let index = 0; index < Number(shots); index += 1) {
  const file = `${outDir}/table-${width}x${height}-${String(index + 1).padStart(2, "0")}.png`;
  await page.screenshot({ path: file });
  console.log(file);
  if (index + 1 < Number(shots)) {
    await page.waitForTimeout(Number(intervalMs));
  }
}

await browser.close();
