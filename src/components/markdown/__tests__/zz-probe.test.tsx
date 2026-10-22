import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { test } from 'vitest';
import { Markdown } from '../Markdown';
import { RichMarkdownDoor } from '../rich-door';
import { chatMarkdownRegistry } from '@/features/chat/markdown-registry';
import { PARITY_CORPUS } from './parity-corpus';
import { TooltipProvider } from '@ai-matrx/design-system';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function draw(node: React.ReactNode) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => root.render(<TooltipProvider>{node}</TooltipProvider>));
  for (let i = 0; i < 40; i++) {
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    if (!el.querySelector('[data-markdown-loading],[data-kind-loading]')) break;
  }
  await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
  const out = { text: (el.textContent ?? '').replace(/\s+/g, ' ').trim(), html: el.innerHTML };
  act(() => root.unmount());
  el.remove();
  return out;
}

test('probe', { timeout: 300_000 }, async () => {
  for (const c of PARITY_CORPUS) {
    const reg = c.chat ? chatMarkdownRegistry : undefined;
    const a = await draw(<Markdown content={c.content} registry={reg} />);
    const b = await draw(<RichMarkdownDoor content={c.content} registry={reg} />);
    console.log(`=== ${c.name}\nOLD: ${a.text}\nNEW: ${b.text}${a.text === b.text ? '\nSAME' : ''}`);
  }
});
