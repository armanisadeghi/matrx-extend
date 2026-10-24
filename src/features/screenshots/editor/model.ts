/**
 * Screenshot editor model — the pure half of the editor: shape types,
 * geometry, hit-testing and canvas rendering. No React, no chrome.*, so
 * it is unit-testable and liftable into a shared package unchanged.
 *
 * Every coordinate is in SOURCE-IMAGE pixels. The crop is a view over the
 * source, never a destructive edit, so undo can bring the edges back.
 */

export type Tool =
  | 'select'
  | 'crop'
  | 'rect'
  | 'ellipse'
  | 'arrow'
  | 'line'
  | 'pen'
  | 'highlighter'
  | 'text'
  | 'blur'
  | 'step';

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface ShapeBase {
  id: string;
  color: string;
  /** Stroke width in source pixels; text and steps derive their size from it. */
  size: number;
}

export type TwoPointKind = 'rect' | 'ellipse' | 'arrow' | 'line' | 'blur';

export type Shape =
  | (ShapeBase & { kind: TwoPointKind; a: Point; b: Point })
  | (ShapeBase & { kind: 'pen' | 'highlighter'; points: Point[] })
  | (ShapeBase & { kind: 'text'; at: Point; text: string })
  | (ShapeBase & { kind: 'step'; at: Point; n: number });

export interface EditorDoc {
  shapes: Shape[];
  crop: Rect | null;
}

export const EMPTY_DOC: EditorDoc = { shapes: [], crop: null };

/** Keyboard letter for each tool — the same letters the best desktop tools use. */
export const TOOL_KEYS: Record<string, Tool> = {
  v: 'select',
  c: 'crop',
  r: 'rect',
  o: 'ellipse',
  a: 'arrow',
  l: 'line',
  p: 'pen',
  h: 'highlighter',
  t: 'text',
  b: 'blur',
  n: 'step',
};

export const PALETTE = [
  '#ef4444',
  '#f59e0b',
  '#22c55e',
  '#3b82f6',
  '#a855f7',
  '#111827',
  '#ffffff',
];

export type SizeStep = 's' | 'm' | 'l';

/**
 * Stroke width for a size step, scaled to the image so a 4K full-page
 * capture and a 1280px viewport both get marks that read at a glance.
 */
export function strokeFor(step: SizeStep, imageW: number, imageH: number): number {
  const unit = Math.max(2, Math.round(Math.min(imageW, imageH) / 400));
  return step === 's' ? unit : step === 'm' ? unit * 2 : unit * 3.5;
}

export function fontSizeFor(size: number): number {
  return Math.max(14, Math.round(size * 7));
}

export function stepRadiusFor(size: number): number {
  return Math.max(12, Math.round(size * 5.5));
}

export function normRect(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x),
    h: Math.abs(b.y - a.y),
  };
}

export function clampRect(r: Rect, w: number, h: number): Rect {
  const x = Math.max(0, Math.min(r.x, w));
  const y = Math.max(0, Math.min(r.y, h));
  return {
    x,
    y,
    w: Math.max(0, Math.min(r.x + r.w, w) - x),
    h: Math.max(0, Math.min(r.y + r.h, h) - y),
  };
}

export function isTwoPoint(shape: Shape): shape is Extract<Shape, { a: Point }> {
  return 'a' in shape;
}

export function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Approximate text box; exact enough for hit-testing and the selection outline. */
export function textBounds(shape: Extract<Shape, { kind: 'text' }>): Rect {
  const fs = fontSizeFor(shape.size);
  const lines = shape.text.split('\n');
  const longest = Math.max(1, ...lines.map((line) => line.length));
  return { x: shape.at.x, y: shape.at.y, w: longest * fs * 0.6, h: lines.length * fs * 1.25 };
}

export function shapeBounds(shape: Shape): Rect {
  if (isTwoPoint(shape)) return normRect(shape.a, shape.b);
  if (shape.kind === 'text') return textBounds(shape);
  if (shape.kind === 'step') {
    const r = stepRadiusFor(shape.size);
    return { x: shape.at.x - r, y: shape.at.y - r, w: r * 2, h: r * 2 };
  }
  const xs = shape.points.map((p) => p.x);
  const ys = shape.points.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

function inRect(p: Point, r: Rect, pad = 0): boolean {
  return p.x >= r.x - pad && p.x <= r.x + r.w + pad && p.y >= r.y - pad && p.y <= r.y + r.h + pad;
}

export function hitTest(shape: Shape, p: Point, tolerance: number): boolean {
  const tol = tolerance + shape.size;
  switch (shape.kind) {
    case 'arrow':
    case 'line':
      return distToSegment(p, shape.a, shape.b) <= tol;
    case 'rect':
    case 'ellipse':
    case 'blur':
      return inRect(p, normRect(shape.a, shape.b), tol);
    case 'pen':
    case 'highlighter': {
      const t = shape.kind === 'highlighter' ? tol + shape.size * 2 : tol;
      if (shape.points.length === 1)
        return Math.hypot(p.x - shape.points[0]!.x, p.y - shape.points[0]!.y) <= t;
      for (let i = 1; i < shape.points.length; i++) {
        if (distToSegment(p, shape.points[i - 1]!, shape.points[i]!) <= t) return true;
      }
      return false;
    }
    case 'text':
      return inRect(p, textBounds(shape), tolerance);
    case 'step':
      return (
        Math.hypot(p.x - shape.at.x, p.y - shape.at.y) <= stepRadiusFor(shape.size) + tolerance
      );
  }
}

/** Topmost shape under the point (last drawn wins). */
export function shapeAt(shapes: Shape[], p: Point, tolerance: number): Shape | null {
  for (let i = shapes.length - 1; i >= 0; i--) {
    const s = shapes[i]!;
    if (hitTest(s, p, tolerance)) return s;
  }
  return null;
}

export function translateShape(shape: Shape, dx: number, dy: number): Shape {
  const move = (p: Point): Point => ({ x: p.x + dx, y: p.y + dy });
  if (isTwoPoint(shape)) return { ...shape, a: move(shape.a), b: move(shape.b) };
  if ('points' in shape) return { ...shape, points: shape.points.map(move) };
  return { ...shape, at: move(shape.at) };
}

/** Resize handles: the two defining points of a two-point shape; none for the rest. */
export function handlesOf(shape: Shape): Point[] {
  return isTwoPoint(shape) ? [shape.a, shape.b] : [];
}

export function setHandle(shape: Shape, index: number, p: Point): Shape {
  if (!isTwoPoint(shape)) return shape;
  return index === 0 ? { ...shape, a: p } : { ...shape, b: p };
}

export function nextStepNumber(shapes: Shape[]): number {
  let max = 0;
  for (const s of shapes) if (s.kind === 'step') max = Math.max(max, s.n);
  return max + 1;
}

/** A shape too small to mean anything (a stray click with a drag tool). */
export function isDegenerate(shape: Shape): boolean {
  if (isTwoPoint(shape)) return Math.hypot(shape.b.x - shape.a.x, shape.b.y - shape.a.y) < 4;
  if (shape.kind === 'text') return shape.text.trim() === '';
  return false;
}

/** The region that is exported: the crop, or the whole image. */
export function viewRect(doc: EditorDoc, imageW: number, imageH: number): Rect {
  return doc.crop && doc.crop.w >= 1 && doc.crop.h >= 1
    ? doc.crop
    : { x: 0, y: 0, w: imageW, h: imageH };
}

// ── Rendering ────────────────────────────────────────────────────────────────

type Ctx = CanvasRenderingContext2D;

function readableOutline(color: string): string {
  const hex = color.replace('#', '');
  if (hex.length !== 6) return 'rgba(0,0,0,0.55)';
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.85)';
}

function drawArrowHead(ctx: Ctx, from: Point, to: Point, size: number): void {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const len = Math.max(10, size * 4.5);
  const spread = Math.PI / 7;
  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(to.x - len * Math.cos(angle - spread), to.y - len * Math.sin(angle - spread));
  ctx.lineTo(to.x - len * Math.cos(angle + spread), to.y - len * Math.sin(angle + spread));
  ctx.closePath();
  ctx.fill();
}

function strokePath(ctx: Ctx, points: Point[]): void {
  if (points.length === 0) return;
  ctx.beginPath();
  ctx.moveTo(points[0]!.x, points[0]!.y);
  if (points.length === 1) {
    ctx.lineTo(points[0]!.x + 0.01, points[0]!.y);
  } else {
    for (let i = 1; i < points.length - 1; i++) {
      const mid = {
        x: (points[i]!.x + points[i + 1]!.x) / 2,
        y: (points[i]!.y + points[i + 1]!.y) / 2,
      };
      ctx.quadraticCurveTo(points[i]!.x, points[i]!.y, mid.x, mid.y);
    }
    const last = points[points.length - 1]!;
    ctx.lineTo(last.x, last.y);
  }
  ctx.stroke();
}

/** Pixelate a region of the source image — irreversible in the export, so it really redacts. */
function drawBlur(ctx: Ctx, source: CanvasImageSource, r: Rect, size: number): void {
  if (r.w < 1 || r.h < 1) return;
  const block = Math.max(6, size * 4);
  const sw = Math.max(1, Math.round(r.w / block));
  const sh = Math.max(1, Math.round(r.h / block));
  const tmp = document.createElement('canvas');
  tmp.width = sw;
  tmp.height = sh;
  const t = tmp.getContext('2d');
  if (!t) return;
  t.imageSmoothingEnabled = true;
  t.drawImage(source, r.x, r.y, r.w, r.h, 0, 0, sw, sh);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tmp, 0, 0, sw, sh, r.x, r.y, r.w, r.h);
  ctx.restore();
}

export function drawShape(ctx: Ctx, shape: Shape, source: CanvasImageSource): void {
  ctx.save();
  ctx.strokeStyle = shape.color;
  ctx.fillStyle = shape.color;
  ctx.lineWidth = shape.size;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  switch (shape.kind) {
    case 'rect': {
      const r = normRect(shape.a, shape.b);
      const radius = Math.min(shape.size * 1.5, r.w / 2, r.h / 2);
      ctx.beginPath();
      ctx.roundRect(r.x, r.y, r.w, r.h, radius);
      ctx.stroke();
      break;
    }
    case 'ellipse': {
      const r = normRect(shape.a, shape.b);
      ctx.beginPath();
      ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case 'line':
      strokePath(ctx, [shape.a, shape.b]);
      break;
    case 'arrow': {
      const angle = Math.atan2(shape.b.y - shape.a.y, shape.b.x - shape.a.x);
      const back = Math.max(10, shape.size * 4.5) * 0.8;
      strokePath(ctx, [
        shape.a,
        { x: shape.b.x - back * Math.cos(angle), y: shape.b.y - back * Math.sin(angle) },
      ]);
      drawArrowHead(ctx, shape.a, shape.b, shape.size);
      break;
    }
    case 'pen':
      strokePath(ctx, shape.points);
      break;
    case 'highlighter':
      ctx.globalAlpha = 0.38;
      ctx.globalCompositeOperation = 'multiply';
      ctx.lineWidth = shape.size * 5;
      ctx.lineCap = 'square';
      strokePath(ctx, shape.points);
      break;
    case 'blur':
      drawBlur(ctx, source, normRect(shape.a, shape.b), shape.size);
      break;
    case 'text': {
      const fs = fontSizeFor(shape.size);
      ctx.font = `600 ${fs}px ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif`;
      ctx.textBaseline = 'top';
      ctx.lineWidth = Math.max(2, fs / 7);
      ctx.strokeStyle = readableOutline(shape.color);
      shape.text.split('\n').forEach((line, i) => {
        const y = shape.at.y + i * fs * 1.25;
        ctx.strokeText(line, shape.at.x, y);
        ctx.fillText(line, shape.at.x, y);
      });
      break;
    }
    case 'step': {
      const r = stepRadiusFor(shape.size);
      ctx.beginPath();
      ctx.arc(shape.at.x, shape.at.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = Math.max(2, r / 6);
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
      ctx.fillStyle = readableOutline(shape.color).startsWith('rgba(0') ? '#111827' : '#ffffff';
      ctx.font = `700 ${Math.round(r * 1.1)}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(shape.n), shape.at.x, shape.at.y + r * 0.05);
      break;
    }
  }
  ctx.restore();
}

/**
 * Draw the image and every shape onto `ctx`, framed to `view` (the canvas
 * must already be view.w × view.h). Used for both the live canvas and export,
 * so what you see is exactly what is saved.
 */
export function renderDoc(ctx: Ctx, image: CanvasImageSource, doc: EditorDoc, view: Rect): void {
  ctx.save();
  ctx.clearRect(0, 0, view.w, view.h);
  ctx.translate(-view.x, -view.y);
  ctx.drawImage(image, 0, 0);
  for (const shape of doc.shapes) drawShape(ctx, shape, image);
  ctx.restore();
}

/** Flatten to a PNG blob at full source resolution. */
export async function exportPng(
  image: CanvasImageSource,
  doc: EditorDoc,
  imageW: number,
  imageH: number,
): Promise<{ blob: Blob; width: number; height: number }> {
  const view = viewRect(doc, imageW, imageH);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(view.w);
  canvas.height = Math.round(view.h);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2D canvas available to export the image');
  renderDoc(ctx, image, doc, view);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Could not encode the image'))),
      'image/png',
    ),
  );
  return { blob, width: canvas.width, height: canvas.height };
}
