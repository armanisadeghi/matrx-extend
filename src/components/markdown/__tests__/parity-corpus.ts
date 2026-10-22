/**
 * Real-shaped side-panel messages for the old-vs-new markdown parity test: agent answers with code in
 * several languages, tables, lists, links, images, reasoning/thinking/reflection tags (incl.
 * self-closing and streaming partials), notes and scrape captures.
 */
export interface ParityCase {
  name: string;
  content: string;
  /** Render through the chat registry (thinking / reasoning / reflection). */
  chat?: boolean;
}

const SVG_DATA =
  'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxIDEiPjwvc3ZnPg==';

export const PARITY_CORPUS: ParityCase[] = [
  {
    name: 'plain answer with headings and emphasis',
    content:
      '# Summary\n\nThe page loads **three** scripts and one *deferred* stylesheet.\n\n## Next steps\n\nCheck the `robots.txt` file first.',
  },
  {
    name: 'bulleted and numbered lists with nesting',
    content:
      '- First item\n- Second item\n  - nested a\n  - nested b\n- Third\n\n1. Open the tab\n2. Click **Run**\n3. Read the result',
  },
  {
    name: 'task list and strikethrough',
    content: '- [x] Scraped the page\n- [ ] Saved the capture\n\n~~old price~~ new price',
  },
  {
    name: 'python code block',
    content:
      'Here is the script:\n\n```python\nimport requests\n\nresp = requests.get("https://example.com")\nprint(resp.status_code)\n```\n\nRun it locally.',
  },
  {
    name: 'typescript and bash code blocks',
    content:
      '```ts\nexport function add(a: number, b: number): number {\n  return a + b;\n}\n```\n\n```bash\npnpm install\npnpm dev\n```',
  },
  {
    name: 'json code block',
    content: '```json\n{\n  "title": "Example Domain",\n  "links": 1,\n  "ok": true\n}\n```',
  },
  {
    name: 'short one-line fence',
    content: 'Use this selector:\n\n```css\n.main > h1\n```',
  },
  {
    name: 'gfm table',
    content: '| Metric | Value |\n|---|---|\n| LCP | 2.1s |\n| CLS | 0.02 |\n| TBT | 140ms |',
  },
  {
    name: 'links inline and autolink',
    content: 'See [the docs](https://example.com/docs) and https://example.org for more.',
  },
  {
    name: 'remote image',
    content: 'Screenshot:\n\n![hero](https://example.com/hero.png)',
  },
  {
    name: 'scrape capture with an inline svg data image',
    content: `Logo: ![logo](${SVG_DATA})`,
  },
  {
    name: 'blockquote and horizontal rule',
    content: '> Quoted from the page header.\n\n---\n\nAfter the rule.',
  },
  {
    name: 'inline html and dollar amounts stay text',
    content: 'Price is $5 and $10 today. The tag <b>bold</b> is shown as written.',
  },
  {
    name: 'thinking then answer',
    chat: true,
    content:
      '<thinking>I should check the title first.</thinking>\n\nThe title is **Example Domain**.',
  },
  {
    name: 'reasoning and reflection blocks',
    chat: true,
    content:
      '<reasoning>Compare both pages.</reasoning>\n\nBoth pages match.\n\n<reflection>The answer is complete.</reflection>',
  },
  {
    name: 'self-closing reflection tag',
    chat: true,
    content: 'Before.\n\n<reflection mood="done"/>\n\nAfter the tag.',
  },
  {
    name: 'streaming partial: open thinking tag at the tail',
    chat: true,
    content: 'Starting.\n\n<thinking>Looking at the DOM tree and the',
  },
  {
    name: 'streaming partial: unclosed code fence',
    content: 'Here:\n\n```js\nconst x = 1;\nconst y =',
  },
  {
    name: 'note with headings h3-h6',
    content: '### Section\n\nBody text.\n\n#### Sub\n\n##### Small caps\n\n###### Tiny',
  },
];
