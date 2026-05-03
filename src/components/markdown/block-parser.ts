/**
 * Splits a markdown stream into a sequence of blocks the renderer can dispatch:
 *
 *   - `markdown` — plain markdown, handed to react-markdown
 *   - `xml`      — `<tag attr="…">…</tag>` or `<tag/>` — dispatched by tag name
 *   - `code`     — fenced ``` block — dispatched by language; if `json` and
 *                  parseable, the renderer further dispatches by the first key
 *
 * Designed to be safe to run on every streaming chunk. Open / unclosed blocks
 * at the end of `content` are surfaced with `complete: false` so the caller
 * can render a partial state instead of dropping the in-flight content.
 */

export type Block =
  | { kind: 'markdown'; text: string }
  | {
      kind: 'xml';
      tag: string;
      attrs: Record<string, string>;
      inner: string;
      raw: string;
      complete: boolean;
    }
  | {
      kind: 'code';
      lang: string;
      code: string;
      raw: string;
      complete: boolean;
    };

const XML_OPEN_RE =
  /^<([a-zA-Z][a-zA-Z0-9_-]*)((?:\s+[a-zA-Z_][a-zA-Z0-9_:-]*\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))*)\s*(\/)?>/;

export function parseBlocks(content: string): Block[] {
  const blocks: Block[] = [];
  let i = 0;
  let mdStart = 0;

  const flushMd = (end: number) => {
    if (end > mdStart) {
      const text = content.slice(mdStart, end);
      if (text.length > 0) blocks.push({ kind: 'markdown', text });
    }
  };

  while (i < content.length) {
    const atLineStart = i === 0 || content[i - 1] === '\n';

    if (atLineStart && content.startsWith('```', i)) {
      const headerEnd = content.indexOf('\n', i + 3);
      if (headerEnd === -1) {
        // Streaming: fence header still arriving. Treat the rest as in-flight code.
        flushMd(i);
        const lang = content.slice(i + 3).trim();
        blocks.push({
          kind: 'code',
          lang,
          code: '',
          raw: content.slice(i),
          complete: false,
        });
        return blocks;
      }
      const lang = content.slice(i + 3, headerEnd).trim();
      const closeIdx = findFenceClose(content, headerEnd + 1);
      if (closeIdx === -1) {
        flushMd(i);
        blocks.push({
          kind: 'code',
          lang,
          code: content.slice(headerEnd + 1),
          raw: content.slice(i),
          complete: false,
        });
        return blocks;
      }
      flushMd(i);
      const code = content.slice(headerEnd + 1, closeIdx);
      const blockEnd = closeIdx + 4; // past "\n```"
      blocks.push({
        kind: 'code',
        lang,
        code,
        raw: content.slice(i, blockEnd),
        complete: true,
      });
      i = blockEnd;
      mdStart = i;
      continue;
    }

    if (content[i] === '<' && /[a-zA-Z]/.test(content[i + 1] ?? '')) {
      const xml = matchXml(content, i);
      if (xml) {
        flushMd(i);
        blocks.push(xml.block);
        i = xml.end;
        mdStart = i;
        continue;
      }
    }

    i++;
  }

  flushMd(content.length);
  return blocks;
}

function findFenceClose(content: string, from: number): number {
  let pos = from;
  while (pos < content.length) {
    if (content.startsWith('```', pos) && (pos === 0 || content[pos - 1] === '\n')) {
      return pos - 1;
    }
    pos = content.indexOf('\n```', pos);
    if (pos === -1) return -1;
    pos += 1;
  }
  return -1;
}

function matchXml(content: string, start: number): { block: Block; end: number } | null {
  const openMatch = XML_OPEN_RE.exec(content.slice(start));
  if (!openMatch || !openMatch[1]) return null;
  const tag = openMatch[1];
  const attrsStr = openMatch[2] ?? '';
  const selfClosing = !!openMatch[4];
  const openLen = openMatch[0].length;
  const attrs = parseAttrs(attrsStr);

  if (selfClosing) {
    return {
      block: {
        kind: 'xml',
        tag,
        attrs,
        inner: '',
        raw: openMatch[0],
        complete: true,
      },
      end: start + openLen,
    };
  }

  const closeTag = `</${tag}>`;
  const after = start + openLen;
  const closeIdx = content.indexOf(closeTag, after);
  if (closeIdx === -1) {
    // Streaming: opening tag is here but the closer hasn't arrived yet.
    return {
      block: {
        kind: 'xml',
        tag,
        attrs,
        inner: content.slice(after),
        raw: content.slice(start),
        complete: false,
      },
      end: content.length,
    };
  }
  const inner = content.slice(after, closeIdx);
  const end = closeIdx + closeTag.length;
  return {
    block: {
      kind: 'xml',
      tag,
      attrs,
      inner,
      raw: content.slice(start, end),
      complete: true,
    },
    end,
  };
}

const ATTR_RE = /([a-zA-Z_][a-zA-Z0-9_:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;

function parseAttrs(input: string): Record<string, string> {
  const out: Record<string, string> = {};
  let m: RegExpExecArray | null;
  ATTR_RE.lastIndex = 0;
  m = ATTR_RE.exec(input);
  while (m !== null) {
    const key = m[1];
    if (key) out[key] = m[2] ?? m[3] ?? m[4] ?? '';
    m = ATTR_RE.exec(input);
  }
  return out;
}

/**
 * Pulls the first key of a JSON object out of a string without fully parsing.
 * Returns null for arrays, primitives, or malformed input.
 */
export function firstJsonKey(raw: string): string | null {
  let i = 0;
  while (i < raw.length && /\s/.test(raw[i] ?? '')) i++;
  if (raw[i] !== '{') return null;
  i++;
  while (i < raw.length && /\s/.test(raw[i] ?? '')) i++;
  if (raw[i] !== '"') return null;
  i++;
  let key = '';
  while (i < raw.length && raw[i] !== '"') {
    const ch = raw[i];
    if (ch === undefined) break;
    if (ch === '\\' && i + 1 < raw.length) {
      key += raw[i + 1] ?? '';
      i += 2;
      continue;
    }
    key += ch;
    i++;
  }
  return key.length > 0 ? key : null;
}
