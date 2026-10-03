import type { Page } from 'playwright';

export interface SnapshotElement {
  id: string;
  type: string;
  text: string;
  name?: string;
  value?: string;
  href?: string;
  disabled?: boolean;
}

export async function snapshotInteractive(page: Page, startCounter: number) {
  const result = await page.evaluate(({ startCounter }) => {
    let counter = startCounter;
    const selectors = ['a[href]','button','input:not([type="hidden"])','select','textarea','[role="button"]','[role="link"]'].join(',');
    const nodes = Array.from(document.querySelectorAll<HTMLElement>(selectors)).filter((el) => {
      const style = getComputedStyle(el);
      const visible = Boolean(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
      return visible && style.visibility !== 'hidden' && style.display !== 'none';
    });
    const elements = nodes.slice(0, 500).map((el) => {
      let id = el.getAttribute('data-openweb-id');
      if (!id) {
        id = `e${counter++}`;
        el.setAttribute('data-openweb-id', id);
      }
      const input = el as HTMLInputElement;
      const text = (el.innerText || el.getAttribute('aria-label') || el.getAttribute('title') || input.placeholder || input.value || '').trim().replace(/\s+/g, ' ').slice(0, 300);
      const out: any = { id, type: el.tagName.toLowerCase(), text };
      const name = el.getAttribute('name');
      if (name) out.name = name;
      if ('value' in input && typeof input.value === 'string' && input.value) out.value = input.value.slice(0, 500);
      if (el instanceof HTMLAnchorElement && el.href) out.href = el.href;
      if ('disabled' in input) out.disabled = Boolean(input.disabled);
      return out;
    });
    return { elements, nextCounter: counter, title: document.title, url: location.href };
  }, { startCounter });
  return result as { elements: SnapshotElement[]; nextCounter: number; title: string; url: string };
}
