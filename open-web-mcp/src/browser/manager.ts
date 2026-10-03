import { randomUUID } from 'node:crypto';
import { chromium, type Browser, type BrowserContext, type Page, type Route } from 'playwright';
import type { Config } from '../config/env.js';
import { BrowserSessionError, NavigationTimeoutError } from '../errors/index.js';
import { validatePublicUrl } from '../security/url-validator.js';
import { Semaphore } from '../utils/concurrency.js';
import type { BrowserSession } from './session.js';
import { snapshotInteractive } from './snapshot.js';

export class BrowserManager {
  private browser?: Browser;
  private readonly sessions = new Map<string, BrowserSession>();
  private readonly slots: Semaphore;
  private cleanupTimer?: NodeJS.Timeout;

  constructor(private readonly config: Config) {
    this.slots = new Semaphore(config.MAX_BROWSER_SESSIONS);
    this.cleanupTimer = setInterval(() => void this.cleanupExpired(), 30_000).unref();
  }

  private async getBrowser() {
    if (this.browser?.isConnected()) return this.browser;
    this.browser = await chromium.launch({
      headless: true,
      args: [
        '--disable-dev-shm-usage',
        '--no-sandbox',
        `--js-flags=--max-old-space-size=${Math.max(64, this.config.BROWSER_MEMORY_MB)}`,
      ],
    });
    return this.browser;
  }

  private async secureRoute(route: Route) {
    const requestUrl = route.request().url();
    let parsed: URL;
    try { parsed = new URL(requestUrl); } catch { await route.abort('blockedbyclient'); return; }
    if (!['http:', 'https:'].includes(parsed.protocol)) { await route.continue(); return; }
    try { await validatePublicUrl(requestUrl); }
    catch { await route.abort('blockedbyclient'); return; }
    await route.continue();
  }

  private async newContext(): Promise<BrowserContext> {
    const browser = await this.getBrowser();
    const context = await browser.newContext({
      userAgent: this.config.USER_AGENT,
      viewport: { width: 1440, height: 900 },
      acceptDownloads: false,
      serviceWorkers: 'block',
    });
    await context.route('**/*', (route) => this.secureRoute(route));
    return context;
  }

  async render(url: string) {
    await validatePublicUrl(url);
    const context = await this.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(this.config.PAGE_TIMEOUT_MS);
    try {
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: this.config.PAGE_TIMEOUT_MS });
      await page.waitForLoadState('networkidle', { timeout: Math.min(5000, this.config.PAGE_TIMEOUT_MS) }).catch(() => {});
      const html = await page.content();
      return {
        finalUrl: page.url(),
        title: await page.title(),
        status: response?.status() ?? 200,
        contentType: response?.headers()['content-type'] ?? 'text/html',
        html,
      };
    } catch (error) {
      if (error instanceof Error && /timeout/i.test(error.message)) throw new NavigationTimeoutError(error.message);
      throw error;
    } finally { await context.close(); }
  }

  async navigate(url: string) {
    await validatePublicUrl(url);
    await this.slots.acquire();
    const context = await this.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(this.config.PAGE_TIMEOUT_MS);
    const id = randomUUID();
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: this.config.PAGE_TIMEOUT_MS });
      const now = Date.now();
      this.sessions.set(id, { id, context, page, createdAt: now, lastUsedAt: now, nextElementId: 1 });
      return { session_id: id, url: page.url(), title: await page.title() };
    } catch (error) {
      await context.close(); this.slots.release();
      if (error instanceof Error && /timeout/i.test(error.message)) throw new NavigationTimeoutError(error.message);
      throw error;
    }
  }

  private getSession(id: string) {
    const session = this.sessions.get(id);
    if (!session) throw new BrowserSessionError('Unknown or expired browser session');
    session.lastUsedAt = Date.now();
    return session;
  }

  async snapshot(id: string) {
    const session = this.getSession(id);
    const snap = await snapshotInteractive(session.page, session.nextElementId);
    session.nextElementId = snap.nextCounter;
    return { session_id: id, url: snap.url, title: snap.title, elements: snap.elements };
  }

  private locator(page: Page, elementId: string) {
    if (!/^e\d+$/.test(elementId)) throw new BrowserSessionError('Invalid element id');
    return page.locator(`[data-openweb-id="${elementId}"]`).first();
  }

  async click(id: string, elementId: string) {
    const session = this.getSession(id);
    const locator = this.locator(session.page, elementId);
    if (await locator.count() === 0) throw new BrowserSessionError('Element not found; take a new browser_snapshot');
    await locator.click({ timeout: this.config.PAGE_TIMEOUT_MS });
    await session.page.waitForLoadState('domcontentloaded', { timeout: 3000 }).catch(() => {});
    return { session_id: id, url: session.page.url(), title: await session.page.title() };
  }

  async type(id: string, elementId: string, text: string) {
    const session = this.getSession(id);
    const locator = this.locator(session.page, elementId);
    if (await locator.count() === 0) throw new BrowserSessionError('Element not found; take a new browser_snapshot');
    await locator.fill(text, { timeout: this.config.PAGE_TIMEOUT_MS });
    return { session_id: id, element_id: elementId, value: text };
  }

  async select(id: string, elementId: string, value: string) {
    const session = this.getSession(id);
    const locator = this.locator(session.page, elementId);
    if (await locator.count() === 0) throw new BrowserSessionError('Element not found; take a new browser_snapshot');
    const selected = await locator.selectOption(value);
    return { session_id: id, element_id: elementId, selected };
  }

  async back(id: string) {
    const session = this.getSession(id);
    await session.page.goBack({ waitUntil: 'domcontentloaded', timeout: this.config.PAGE_TIMEOUT_MS });
    return { session_id: id, url: session.page.url(), title: await session.page.title() };
  }

  async reload(id: string) {
    const session = this.getSession(id);
    await session.page.reload({ waitUntil: 'domcontentloaded', timeout: this.config.PAGE_TIMEOUT_MS });
    return { session_id: id, url: session.page.url(), title: await session.page.title() };
  }

  async screenshotUrl(url: string, fullPage: boolean, width: number, height: number) {
    await validatePublicUrl(url);
    const context = await this.newContext();
    const page = await context.newPage();
    await page.setViewportSize({ width, height });
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: this.config.PAGE_TIMEOUT_MS });
      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
      const buffer = await page.screenshot({ type: 'png', fullPage });
      return { base64: buffer.toString('base64'), mimeType: 'image/png', url: page.url(), title: await page.title() };
    } finally { await context.close(); }
  }

  async closeSession(id: string) {
    const session = this.sessions.get(id);
    if (!session) return { session_id: id, closed: false };
    this.sessions.delete(id);
    await session.context.close().catch(() => {});
    this.slots.release();
    return { session_id: id, closed: true };
  }

  async checkReady() {
    try {
      const browser = await this.getBrowser();
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto('about:blank');
      await context.close();
      return true;
    } catch { return false; }
  }

  private async cleanupExpired() {
    const now = Date.now();
    const maxAge = this.config.BROWSER_SESSION_TTL * 1000;
    const idleAge = this.config.BROWSER_IDLE_TTL * 1000;
    const expired = [...this.sessions.values()].filter((s) => now - s.createdAt > maxAge || now - s.lastUsedAt > idleAge);
    await Promise.all(expired.map((s) => this.closeSession(s.id)));
  }

  async shutdown() {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    await Promise.all([...this.sessions.keys()].map((id) => this.closeSession(id)));
    await this.browser?.close().catch(() => {});
    this.browser = undefined;
  }
}
