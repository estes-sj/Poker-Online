// Checks that one tap on the phone dock's Cam, then Mic, turns each device on.
// Chromium gets fake camera/mic devices, so this needs the dev LiveKit from compose.yml.
//   node scripts/dev-table/media-check.mjs <seed.json> [screenshot.png]
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";

const playwrightDir = process.env.PLAYWRIGHT_DIR ?? `${homedir()}/.cache/poker-shot`;
const { chromium } = createRequire(`${playwrightDir}/package.json`)("playwright-core");
const [seedPath, screenshotPath] = process.argv.slice(2);
const seed = JSON.parse(readFileSync(seedPath, "utf8"));

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
});
const context = await browser.newContext({
  viewport: { width: 393, height: 852 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  permissions: ["camera", "microphone"],
});
await context.addInitScript((session) => {
  window.localStorage.setItem("river-club-session", JSON.stringify(session));
  window.sessionStorage.setItem("river-club-mobile-layout-recommendation-dismissed", "1");
}, seed.session);

const page = await context.newPage();
await page.goto(seed.url, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);

const isActive = (kind) => page.evaluate((key) => Boolean(document.querySelector(`.table-chat-mobile-dock__button--${key}.table-chat-mobile-dock__button--active`)), kind);
const settle = async () => {
  await page.waitForTimeout(300);
  await page.waitForFunction(() => !document.querySelector(".table-chat-mobile-dock__button--loading"), null, { timeout: 30000 });
};

await page.click(".table-chat-mobile-dock__button--cam");
await settle();
const camOn = await isActive("cam");
const heroVideo = await page.evaluate(() => Boolean(document.querySelector(".table-seat--hero video")));
const micStillOff = !(await isActive("mic"));

await page.click(".table-chat-mobile-dock__button--mic");
await settle();
const micOn = await isActive("mic");

if (screenshotPath) {
  await page.screenshot({ path: screenshotPath });
}

await browser.close();
console.log(JSON.stringify({ camOn, heroVideo, micStillOff, micOn }));
process.exit(camOn && heroVideo && micStillOff && micOn ? 0 : 1);
