/** Render a node in happy-dom until it settles and read the parity shape the corpus test compares. */
import { TooltipProvider } from '@ai-matrx/design-system';
import { type ReactNode, act } from 'react';
import { createRoot } from 'react-dom/client';

export interface ParityShape {
  /** Visible text with ALL whitespace removed (code line breaks are elements in one, text in the other). */
  text: string;
  headings: string[];
  listItems: number;
  cells: string[];
  hrefs: string[];
  images: string[];
  /** Code text per fenced block, whitespace removed. */
  code: string[];
}

const squash = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, '');

function shapeOf(el: HTMLElement): ParityShape {
  const c = el.cloneNode(true) as HTMLElement;
  for (const st of c.querySelectorAll('style')) st.remove();
  return {
    text: squash(c.textContent),
    headings: [...c.querySelectorAll('h1,h2,h3,h4,h5,h6')].map(
      (h) => `${h.tagName.toLowerCase()}:${squash(h.textContent)}`,
    ),
    listItems: c.querySelectorAll('li').length,
    cells: [...c.querySelectorAll('th,td')].map((x) => squash(x.textContent)),
    hrefs: [...c.querySelectorAll('a[href]')].map((a) => a.getAttribute('href') ?? ''),
    images: [...c.querySelectorAll('img[src]')]
      .map((i) => i.getAttribute('src') ?? '')
      .filter(Boolean),
    code: [...c.querySelectorAll('pre')].map((p) => squash(p.textContent)).filter(Boolean),
  };
}

export async function renderShape(node: ReactNode): Promise<ParityShape> {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => root.render(<TooltipProvider>{node}</TooltipProvider>));
  let last = '';
  let stable = 0;
  for (let i = 0; i < 600 && stable < 5; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });
    const html = el.innerHTML;
    const loading = !!el.querySelector(
      '[data-markdown-loading],[data-kind-loading],[data-code-block-loading]',
    );
    if (shapeOf(el).text && html === last && !loading) stable++;
    else stable = 0;
    last = html;
  }
  const out = shapeOf(el);
  act(() => root.unmount());
  el.remove();
  return out;
}
