// Options page. Two read/write concerns: the edge-base override (validated https
// URL; empty falls back to the production default) and a read-only view of the
// export allowance. There is deliberately no gate reset here (Q4: no self-serve
// way to refill the free exports).
import { DEFAULT_EDGE_BASE, EDGE_BASE_STORAGE_KEY } from '@/shared/config';
import { FREE_EXPORT_ALLOWANCE, getExportsUsed, remainingExports } from '@/shared/gate';
import { browser } from 'wxt/browser';

function byId<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

/** Valid override: parses and uses https. Empty is valid (means "use default"). */
function normalizeEdgeBase(raw: string): { ok: true; value: string } | { ok: false; message: string } {
  const trimmed = raw.trim();
  if (trimmed === '') return { ok: true, value: '' };
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, message: 'that is not a valid URL' };
  }
  if (url.protocol !== 'https:') return { ok: false, message: 'the edge base must use https' };
  return { ok: true, value: trimmed };
}

async function loadUsage(usage: HTMLElement): Promise<void> {
  const used = await getExportsUsed();
  usage.textContent = `free exports used: ${Math.min(used, FREE_EXPORT_ALLOWANCE)} / ${FREE_EXPORT_ALLOWANCE} (${remainingExports(used)} left)`;
}

async function main(): Promise<void> {
  const input = byId<HTMLInputElement>('edgeBase');
  const save = byId<HTMLButtonElement>('save');
  const status = byId<HTMLElement>('status');
  const usage = byId<HTMLElement>('usage');
  if (!input || !save || !status || !usage) return;

  const stored = await browser.storage.sync.get(EDGE_BASE_STORAGE_KEY);
  const current = stored[EDGE_BASE_STORAGE_KEY];
  if (typeof current === 'string') input.value = current;

  await loadUsage(usage);

  save.addEventListener('click', () => {
    void (async () => {
      const result = normalizeEdgeBase(input.value);
      if (!result.ok) {
        status.textContent = result.message;
        return;
      }
      if (result.value === '') {
        await browser.storage.sync.remove(EDGE_BASE_STORAGE_KEY);
        status.textContent = `using the default (${DEFAULT_EDGE_BASE})`;
      } else {
        await browser.storage.sync.set({ [EDGE_BASE_STORAGE_KEY]: result.value });
        status.textContent = 'saved';
      }
    })();
  });
}

void main();
