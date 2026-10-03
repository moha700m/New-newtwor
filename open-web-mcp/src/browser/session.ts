import type { BrowserContext, Page } from 'playwright';

export interface BrowserSession {
  id: string;
  context: BrowserContext;
  page: Page;
  createdAt: number;
  lastUsedAt: number;
  nextElementId: number;
}
