// Options page. Two read/write concerns: the edge-base override (validated https
// URL; empty falls back to the production default) and a read-only view of the
// export allowance as a segmented meter. There is deliberately no gate reset
// here (Q4: no self-serve way to refill the free exports).
import { DEFAULT_EDGE_BASE, EDGE_BASE_STORAGE_KEY } from '@/shared/config';
import { FREE_EXPORT_ALLOWANCE, GATE_CTA_URL, getExportsUsed, isGated, remainingExports } from '@/shared/gate';
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

/** Status line under the field, toned win (saved) or loss (rejected). */
function setStatus(status: HTMLElement, input: HTMLInputElement, text: string, tone: 'win' | 'loss'): void {
  status.textContent = text;
  status.classList.remove('win', 'loss');
  status.classList.add(tone);
  if (tone === 'loss') input.setAttribute('aria-invalid', 'true');
  else input.removeAttribute('aria-invalid');
}

/** One segment per free export; the spent ones fill, and turn loss-toned once all are gone. */
async function loadUsage(meter: HTMLElement, usage: HTMLElement): Promise<void> {
  const used = Math.min(await getExportsUsed(), FREE_EXPORT_ALLOWANCE);
  const spent = isGated(used);
  meter.replaceChildren();
  for (let i = 0; i < FREE_EXPORT_ALLOWANCE; i++) {
    const seg = document.createElement('span');
    seg.className = i < used ? 'seg used' : 'seg';
    meter.append(seg);
  }
  meter.classList.toggle('spent', spent);
  meter.setAttribute('aria-valuemin', '0');
  meter.setAttribute('aria-valuemax', String(FREE_EXPORT_ALLOWANCE));
  meter.setAttribute('aria-valuenow', String(used));

  usage.textContent = `${used} of ${FREE_EXPORT_ALLOWANCE} used, ${remainingExports(used)} left`;
  usage.classList.toggle('spent', spent);
  if (spent) {
    const link = document.createElement('a');
    link.href = GATE_CTA_URL;
    link.target = '_blank';
    link.rel = 'noreferrer';
    link.textContent = 'create a free project';
    usage.append('. ', link, ' to keep exporting.');
  }
}

async function main(): Promise<void> {
  const form = byId<HTMLFormElement>('edgeForm');
  const input = byId<HTMLInputElement>('edgeBase');
  const status = byId<HTMLElement>('status');
  const meter = byId<HTMLElement>('meter');
  const usage = byId<HTMLElement>('usage');
  if (!form || !input || !status || !meter || !usage) return;

  const stored = await browser.storage.sync.get(EDGE_BASE_STORAGE_KEY);
  const current = stored[EDGE_BASE_STORAGE_KEY];
  if (typeof current === 'string') input.value = current;

  await loadUsage(meter, usage);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void (async () => {
      const result = normalizeEdgeBase(input.value);
      if (!result.ok) {
        setStatus(status, input, result.message, 'loss');
        return;
      }
      if (result.value === '') {
        await browser.storage.sync.remove(EDGE_BASE_STORAGE_KEY);
        setStatus(status, input, `using the default (${DEFAULT_EDGE_BASE})`, 'win');
      } else {
        await browser.storage.sync.set({ [EDGE_BASE_STORAGE_KEY]: result.value });
        setStatus(status, input, 'saved', 'win');
      }
    })();
  });
  // A rejected value stops being "invalid" the moment the user edits it again.
  input.addEventListener('input', () => input.removeAttribute('aria-invalid'));
}

void main();
