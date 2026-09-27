// Screenshots via Playwright driving the Microsoft Edge already installed on Windows
// (channel "msedge"), so no separate browser download is needed.
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { imagePath, recordImage, type EvidenceMeta } from "./lib";

let browser: Browser | undefined;

async function getBrowser() {
  browser ??= await chromium.launch({ channel: "msedge" });
  return browser;
}

export interface ShotOptions {
  url: string;
  /** Runs before the page opens, e.g. to log in via context.request (cookies are shared). */
  setup?: (context: BrowserContext) => Promise<void>;
  /** Runs before the screenshot, e.g. to log in or click through to a state. */
  prepare?: (page: Page) => Promise<void>;
  fullPage?: boolean;
  viewport?: { width: number; height: number };
}

export async function screenshot(meta: EvidenceMeta, opts: ShotOptions) {
  const context = await (await getBrowser()).newContext({
    viewport: opts.viewport ?? { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  await opts.setup?.(context);
  const page = await context.newPage();
  await page.goto(opts.url, { waitUntil: "networkidle" });
  await opts.prepare?.(page);
  await page.screenshot({ path: imagePath(meta), fullPage: opts.fullPage ?? true });
  await context.close();
  recordImage(meta);
}

export async function closeBrowser() {
  await browser?.close();
  browser = undefined;
}
