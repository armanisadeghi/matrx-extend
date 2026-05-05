/**
 * Compose recorded frames into an animated GIF.
 *
 * Steps per frame:
 *   1. Decode JPEG bytes → ImageBitmap → RGBA via OffscreenCanvas
 *   2. Composite overlays (clicks, drags, action label, progress bar, watermark)
 *   3. Hand RGBA + delay to the GIF encoder
 *
 * Frame delay is computed from the recorded timestamp deltas, capped to
 * sane bounds so dropped frames don't produce a multi-second hold.
 *
 * 📝 Design notes (overlay model + bitmap-font tradeoff):
 *    .research/record-gif-design-notes.md
 */
import { encodeGif, type GifFrameInput } from '@/lib/recording/gif-encoder';
import type { RecordingState, RecordedEvent } from '@/lib/recording/state';

export interface RenderOptions {
  showClickIndicators: boolean;
  showDragPaths: boolean;
  showActionLabels: boolean;
  showProgressBar: boolean;
  showWatermark: boolean;
  /** NeuQuant sample factor 1..30. */
  quality: number;
}

export const DEFAULT_RENDER_OPTIONS: RenderOptions = {
  showClickIndicators: true,
  showDragPaths: true,
  showActionLabels: true,
  showProgressBar: true,
  showWatermark: true,
  quality: 10,
};

const MIN_FRAME_DELAY_CS = 4; // 25 fps cap
const MAX_FRAME_DELAY_CS = 50; // 0.5 s cap on dropouts
const CLICK_FX_WINDOW_MS = 600; // pulse fades over this window
const LABEL_WINDOW_MS = 1200; // labels linger this long
const DRAG_WINDOW_MS = 800;

export async function renderRecordingToGif(
  state: RecordingState,
  options: RenderOptions,
): Promise<Uint8Array> {
  const frames = state.frames;
  if (frames.length === 0) throw new Error('No frames recorded');

  const width = frames[0]!.width;
  const height = frames[0]!.height;
  if (!width || !height) throw new Error('Recorded frames missing dimensions');

  const inputs: GifFrameInput[] = [];
  const totalDuration = Math.max(1, frames[frames.length - 1]!.ts - frames[0]!.ts);

  for (let i = 0; i < frames.length; i++) {
    const cur = frames[i]!;
    const next = frames[i + 1];
    const rawDelayMs = next ? next.ts - cur.ts : 1000 / 12;
    const delay_cs = clamp(Math.round(rawDelayMs / 10), MIN_FRAME_DELAY_CS, MAX_FRAME_DELAY_CS);

    const rgba = await decodeJpegToRgba(cur.jpeg_b64, width, height);
    compositeOverlays(rgba, width, height, cur.ts, state.events, options, {
      progress: (cur.ts - frames[0]!.ts) / totalDuration,
    });
    inputs.push({ rgba, delay_cs });
  }

  return encodeGif({
    width,
    height,
    frames: inputs,
    quality: options.quality,
    loop: 0,
  });
}

async function decodeJpegToRgba(b64: string, width: number, height: number): Promise<Uint8ClampedArray> {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const blob = new Blob([bytes], { type: 'image/jpeg' });
  const bitmap = await createImageBitmap(blob);
  // Scale every frame to the canonical width × height; CDP guarantees
  // identical metadata across a screencast session, but defensively rescale
  // when a viewport change snuck through.
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    bitmap.close();
    throw new Error('OffscreenCanvas 2d context unavailable');
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const img = ctx.getImageData(0, 0, width, height);
  return img.data;
}

interface CompositeContext {
  progress: number;
}

function compositeOverlays(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  ts: number,
  events: RecordedEvent[],
  opts: RenderOptions,
  ctx: CompositeContext,
) {
  if (opts.showClickIndicators || opts.showDragPaths || opts.showActionLabels) {
    const recent = events.filter((e) => Math.abs(ts - e.ts) <= LABEL_WINDOW_MS);
    if (opts.showClickIndicators) {
      for (const e of recent) {
        if (!e.coordinate) continue;
        if (e.kind !== 'click' && e.kind !== 'right_click' && e.kind !== 'double_click' && e.kind !== 'triple_click') continue;
        const dt = ts - e.ts;
        if (dt < 0 || dt > CLICK_FX_WINDOW_MS) continue;
        drawClickPulse(rgba, width, height, e.coordinate[0], e.coordinate[1], dt / CLICK_FX_WINDOW_MS);
      }
    }
    if (opts.showDragPaths) {
      for (const e of recent) {
        if (e.kind !== 'drag' || !e.drag_path) continue;
        const dt = ts - e.ts;
        if (dt < 0 || dt > DRAG_WINDOW_MS) continue;
        drawDragArrow(rgba, width, height, e.drag_path[0], e.drag_path[1]);
      }
    }
    if (opts.showActionLabels && recent.length > 0) {
      const latest = recent.reduce((a, b) => (Math.abs(ts - b.ts) < Math.abs(ts - a.ts) ? b : a));
      const dt = ts - latest.ts;
      if (dt >= 0 && dt <= LABEL_WINDOW_MS) drawLabel(rgba, width, height, latest.label);
    }
  }
  if (opts.showProgressBar) drawProgressBar(rgba, width, height, ctx.progress);
  if (opts.showWatermark) drawWatermark(rgba, width, height);
}

// ─── overlay primitives ────────────────────────────────────────────────────
function setPixel(rgba: Uint8ClampedArray, w: number, h: number, x: number, y: number, r: number, g: number, b: number, a: number) {
  if (x < 0 || y < 0 || x >= w || y >= h) return;
  const i = (y * w + x) * 4;
  const alpha = a / 255;
  rgba[i] = Math.round(rgba[i]! * (1 - alpha) + r * alpha);
  rgba[i + 1] = Math.round(rgba[i + 1]! * (1 - alpha) + g * alpha);
  rgba[i + 2] = Math.round(rgba[i + 2]! * (1 - alpha) + b * alpha);
  rgba[i + 3] = 255;
}

function fillRect(rgba: Uint8ClampedArray, w: number, h: number, x: number, y: number, rw: number, rh: number, r: number, g: number, b: number, a = 255) {
  for (let yy = y; yy < y + rh; yy++) {
    for (let xx = x; xx < x + rw; xx++) {
      setPixel(rgba, w, h, xx, yy, r, g, b, a);
    }
  }
}

function strokeCircle(rgba: Uint8ClampedArray, w: number, h: number, cx: number, cy: number, radius: number, thickness: number, r: number, g: number, b: number, a: number) {
  const rOuter2 = (radius + thickness / 2) ** 2;
  const rInner2 = Math.max(0, (radius - thickness / 2) ** 2);
  const x0 = Math.max(0, Math.floor(cx - radius - thickness));
  const x1 = Math.min(w - 1, Math.ceil(cx + radius + thickness));
  const y0 = Math.max(0, Math.floor(cy - radius - thickness));
  const y1 = Math.min(h - 1, Math.ceil(cy + radius + thickness));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d2 = (x - cx) ** 2 + (y - cy) ** 2;
      if (d2 <= rOuter2 && d2 >= rInner2) setPixel(rgba, w, h, x, y, r, g, b, a);
    }
  }
}

function drawClickPulse(rgba: Uint8ClampedArray, w: number, h: number, x: number, y: number, t: number) {
  // t is 0..1 (0 = just clicked, 1 = fading out)
  const radius = 6 + t * 18;
  const alpha = Math.round((1 - t) * 220);
  strokeCircle(rgba, w, h, x, y, radius, 3, 255, 60, 60, alpha);
  if (t < 0.4) {
    const innerAlpha = Math.round((0.4 - t) * 2 * 220);
    strokeCircle(rgba, w, h, x, y, 4, 5, 255, 60, 60, innerAlpha);
  }
}

function drawDragArrow(rgba: Uint8ClampedArray, w: number, h: number, from: [number, number], to: [number, number]) {
  drawLine(rgba, w, h, from[0], from[1], to[0], to[1], 3, 60, 180, 255, 220);
  // arrow head
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const headLen = 14;
  const px = -uy;
  const py = ux;
  const ax1 = to[0] - ux * headLen + px * 7;
  const ay1 = to[1] - uy * headLen + py * 7;
  const ax2 = to[0] - ux * headLen - px * 7;
  const ay2 = to[1] - uy * headLen - py * 7;
  drawLine(rgba, w, h, ax1, ay1, to[0], to[1], 3, 60, 180, 255, 220);
  drawLine(rgba, w, h, ax2, ay2, to[0], to[1], 3, 60, 180, 255, 220);
}

function drawLine(rgba: Uint8ClampedArray, w: number, h: number, x0: number, y0: number, x1: number, y1: number, thickness: number, r: number, g: number, b: number, a: number) {
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let x = Math.round(x0);
  let y = Math.round(y0);
  const xt = Math.round(x1);
  const yt = Math.round(y1);
  const half = Math.floor(thickness / 2);
  while (true) {
    for (let oy = -half; oy <= half; oy++) {
      for (let ox = -half; ox <= half; ox++) {
        setPixel(rgba, w, h, x + ox, y + oy, r, g, b, a);
      }
    }
    if (x === xt && y === yt) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }
}

function drawProgressBar(rgba: Uint8ClampedArray, w: number, h: number, progress: number) {
  const barH = 4;
  const y = h - barH - 2;
  fillRect(rgba, w, h, 0, y, w, barH, 0, 0, 0, 120);
  const fillW = Math.round(w * clamp(progress, 0, 1));
  fillRect(rgba, w, h, 0, y, fillW, barH, 60, 180, 255, 240);
}

function drawWatermark(rgba: Uint8ClampedArray, w: number, h: number) {
  const text = 'matrx';
  const scale = 2;
  const tw = text.length * 6 * scale;
  const th = 7 * scale;
  const padding = 6;
  const x = w - tw - padding - 4;
  const y = padding;
  fillRect(rgba, w, h, x - 4, y - 2, tw + 8, th + 4, 0, 0, 0, 140);
  drawText(rgba, w, h, text, x, y, scale, 255, 255, 255, 240);
}

function drawLabel(rgba: Uint8ClampedArray, w: number, h: number, text: string) {
  const safeText = text.replace(/[^\x20-\x7e]/g, '?').slice(0, 32);
  const scale = 2;
  const tw = safeText.length * 6 * scale;
  const th = 7 * scale;
  const padding = 6;
  const x = padding + 4;
  const y = padding;
  fillRect(rgba, w, h, x - 4, y - 2, tw + 8, th + 4, 0, 0, 0, 160);
  drawText(rgba, w, h, safeText, x, y, scale, 255, 255, 255, 240);
}

// ─── tiny 5×7 monospaced font ──────────────────────────────────────────────
// Each glyph is 5 columns × 7 rows; bits MSB-first, top to bottom.
const FONT: Record<string, number[]> = {
  ' ': [0, 0, 0, 0, 0, 0, 0],
  '!': [0x04, 0x04, 0x04, 0x04, 0x00, 0x00, 0x04],
  '"': [0x0a, 0x0a, 0x00, 0x00, 0x00, 0x00, 0x00],
  '#': [0x0a, 0x1f, 0x0a, 0x1f, 0x0a, 0x00, 0x00],
  '%': [0x19, 0x1a, 0x04, 0x0b, 0x13, 0x00, 0x00],
  '&': [0x08, 0x14, 0x08, 0x15, 0x12, 0x0d, 0x00],
  "'": [0x04, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00],
  '(': [0x02, 0x04, 0x08, 0x08, 0x08, 0x04, 0x02],
  ')': [0x08, 0x04, 0x02, 0x02, 0x02, 0x04, 0x08],
  '*': [0x00, 0x0a, 0x04, 0x1f, 0x04, 0x0a, 0x00],
  '+': [0x00, 0x04, 0x04, 0x1f, 0x04, 0x04, 0x00],
  ',': [0x00, 0x00, 0x00, 0x00, 0x00, 0x04, 0x08],
  '-': [0x00, 0x00, 0x00, 0x1f, 0x00, 0x00, 0x00],
  '.': [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x04],
  '/': [0x01, 0x02, 0x04, 0x08, 0x10, 0x00, 0x00],
  '0': [0x0e, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0e],
  '1': [0x04, 0x0c, 0x04, 0x04, 0x04, 0x04, 0x0e],
  '2': [0x0e, 0x11, 0x01, 0x06, 0x08, 0x10, 0x1f],
  '3': [0x1f, 0x02, 0x04, 0x02, 0x01, 0x11, 0x0e],
  '4': [0x02, 0x06, 0x0a, 0x12, 0x1f, 0x02, 0x02],
  '5': [0x1f, 0x10, 0x1e, 0x01, 0x01, 0x11, 0x0e],
  '6': [0x06, 0x08, 0x10, 0x1e, 0x11, 0x11, 0x0e],
  '7': [0x1f, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
  '8': [0x0e, 0x11, 0x11, 0x0e, 0x11, 0x11, 0x0e],
  '9': [0x0e, 0x11, 0x11, 0x0f, 0x01, 0x02, 0x0c],
  ':': [0x00, 0x04, 0x00, 0x00, 0x00, 0x04, 0x00],
  ';': [0x00, 0x04, 0x00, 0x00, 0x00, 0x04, 0x08],
  '?': [0x0e, 0x11, 0x01, 0x02, 0x04, 0x00, 0x04],
  'A': [0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  'B': [0x1e, 0x11, 0x11, 0x1e, 0x11, 0x11, 0x1e],
  'C': [0x0e, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0e],
  'D': [0x1e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x1e],
  'E': [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x1f],
  'F': [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x10],
  'G': [0x0e, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0e],
  'H': [0x11, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  'I': [0x0e, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0e],
  'J': [0x07, 0x02, 0x02, 0x02, 0x02, 0x12, 0x0c],
  'K': [0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11],
  'L': [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1f],
  'M': [0x11, 0x1b, 0x15, 0x15, 0x11, 0x11, 0x11],
  'N': [0x11, 0x11, 0x19, 0x15, 0x13, 0x11, 0x11],
  'O': [0x0e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  'P': [0x1e, 0x11, 0x11, 0x1e, 0x10, 0x10, 0x10],
  'Q': [0x0e, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0d],
  'R': [0x1e, 0x11, 0x11, 0x1e, 0x14, 0x12, 0x11],
  'S': [0x0e, 0x11, 0x10, 0x0e, 0x01, 0x11, 0x0e],
  'T': [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
  'U': [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  'V': [0x11, 0x11, 0x11, 0x11, 0x11, 0x0a, 0x04],
  'W': [0x11, 0x11, 0x11, 0x15, 0x15, 0x15, 0x0a],
  'X': [0x11, 0x11, 0x0a, 0x04, 0x0a, 0x11, 0x11],
  'Y': [0x11, 0x11, 0x11, 0x0a, 0x04, 0x04, 0x04],
  'Z': [0x1f, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1f],
  'a': [0x00, 0x00, 0x0e, 0x01, 0x0f, 0x11, 0x0f],
  'b': [0x10, 0x10, 0x16, 0x19, 0x11, 0x11, 0x1e],
  'c': [0x00, 0x00, 0x0e, 0x10, 0x10, 0x11, 0x0e],
  'd': [0x01, 0x01, 0x0d, 0x13, 0x11, 0x11, 0x0f],
  'e': [0x00, 0x00, 0x0e, 0x11, 0x1f, 0x10, 0x0e],
  'f': [0x06, 0x09, 0x08, 0x1c, 0x08, 0x08, 0x08],
  'g': [0x00, 0x00, 0x0f, 0x11, 0x0f, 0x01, 0x0e],
  'h': [0x10, 0x10, 0x16, 0x19, 0x11, 0x11, 0x11],
  'i': [0x04, 0x00, 0x0c, 0x04, 0x04, 0x04, 0x0e],
  'j': [0x02, 0x00, 0x06, 0x02, 0x02, 0x12, 0x0c],
  'k': [0x10, 0x10, 0x12, 0x14, 0x18, 0x14, 0x12],
  'l': [0x0c, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0e],
  'm': [0x00, 0x00, 0x1a, 0x15, 0x15, 0x11, 0x11],
  'n': [0x00, 0x00, 0x16, 0x19, 0x11, 0x11, 0x11],
  'o': [0x00, 0x00, 0x0e, 0x11, 0x11, 0x11, 0x0e],
  'p': [0x00, 0x00, 0x1e, 0x11, 0x1e, 0x10, 0x10],
  'q': [0x00, 0x00, 0x0d, 0x13, 0x0f, 0x01, 0x01],
  'r': [0x00, 0x00, 0x16, 0x19, 0x10, 0x10, 0x10],
  's': [0x00, 0x00, 0x0f, 0x10, 0x0e, 0x01, 0x1e],
  't': [0x08, 0x08, 0x1c, 0x08, 0x08, 0x09, 0x06],
  'u': [0x00, 0x00, 0x11, 0x11, 0x11, 0x13, 0x0d],
  'v': [0x00, 0x00, 0x11, 0x11, 0x11, 0x0a, 0x04],
  'w': [0x00, 0x00, 0x11, 0x11, 0x15, 0x15, 0x0a],
  'x': [0x00, 0x00, 0x11, 0x0a, 0x04, 0x0a, 0x11],
  'y': [0x00, 0x00, 0x11, 0x11, 0x0f, 0x01, 0x0e],
  'z': [0x00, 0x00, 0x1f, 0x02, 0x04, 0x08, 0x1f],
  '_': [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x1f],
  '→': [0x00, 0x04, 0x02, 0x1f, 0x02, 0x04, 0x00],
};

function drawText(rgba: Uint8ClampedArray, w: number, h: number, text: string, x: number, y: number, scale: number, r: number, g: number, b: number, a: number) {
  let cx = x;
  for (const ch of text) {
    const glyph = FONT[ch] ?? FONT['?']!;
    for (let row = 0; row < 7; row++) {
      const bits = glyph[row]!;
      for (let col = 0; col < 5; col++) {
        if (((bits >> (4 - col)) & 1) === 1) {
          for (let sy = 0; sy < scale; sy++) {
            for (let sx = 0; sx < scale; sx++) {
              setPixel(rgba, w, h, cx + col * scale + sx, y + row * scale + sy, r, g, b, a);
            }
          }
        }
      }
    }
    cx += 6 * scale;
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
