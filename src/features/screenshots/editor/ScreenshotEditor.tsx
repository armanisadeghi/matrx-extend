/**
 * Full-tab screenshot editor: crop and mark up a capture, then save it as a
 * new file, copy it, download it, or hand it to the website's editor.
 *
 * Opened from the Screenshots tab (Edit, or Area capture which lands on the
 * crop tool) at `/screenshot-editor.html?file=<file_id>&shot=<row_id>`. The
 * pure drawing model lives in `./model.ts`; this file is input + chrome.
 */

import {
  type EditorTarget,
  fileWebUrl,
  openOnWebsite,
  webAnnotateUrl,
  webImageEditorUrl,
} from '@/features/screenshots/links';
import { downloadFileBytes } from '@/lib/api/routes/files';
import { newId } from '@/lib/id';
import { type ScreenshotRow, fetchScreenshotById } from '@/lib/supabase/queries';
import { Button, Popover, PopoverContent, PopoverTrigger } from '@ai-matrx/design-system';
import { copyImage } from '@ai-matrx/kit/clipboard';
import { downloadFile } from '@ai-matrx/kit/download';
import {
  AlertTriangle,
  Check,
  Circle,
  Copy,
  Crop,
  Download,
  ExternalLink,
  EyeOff,
  Globe2,
  Hash,
  Highlighter,
  Loader2,
  Minus,
  MousePointer2,
  MoveUpRight,
  Pencil,
  Redo2,
  RotateCcw,
  Save,
  Square,
  Trash2,
  Type,
  Undo2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  EMPTY_DOC,
  type EditorDoc,
  PALETTE,
  type Point,
  type Rect,
  type Shape,
  type SizeStep,
  TOOL_KEYS,
  type Tool,
  type TwoPointKind,
  clampRect,
  exportPng,
  fontSizeFor,
  handlesOf,
  isDegenerate,
  nextStepNumber,
  normRect,
  renderDoc,
  setHandle,
  shapeAt,
  shapeBounds,
  strokeFor,
  translateShape,
  viewRect,
} from './model';
import { type SavedEdit, saveEditedScreenshot } from './save';

// ── History ─────────────────────────────────────────────────────────────────

interface History {
  past: EditorDoc[];
  present: EditorDoc;
  future: EditorDoc[];
}

type HistoryAction = { type: 'commit'; doc: EditorDoc } | { type: 'undo' } | { type: 'redo' };

function historyReducer(state: History, action: HistoryAction): History {
  switch (action.type) {
    case 'commit':
      return { past: [...state.past, state.present], present: action.doc, future: [] };
    case 'undo': {
      const prev = state.past[state.past.length - 1];
      if (!prev) return state;
      return {
        past: state.past.slice(0, -1),
        present: prev,
        future: [state.present, ...state.future],
      };
    }
    case 'redo': {
      const next = state.future[0];
      if (!next) return state;
      return { past: [...state.past, state.present], present: next, future: state.future.slice(1) };
    }
  }
}

// ── Toolbar config ──────────────────────────────────────────────────────────

const TOOLS: Array<{ tool: Tool; label: string; key: string; icon: typeof Crop }> = [
  { tool: 'select', label: 'Select', key: 'V', icon: MousePointer2 },
  { tool: 'crop', label: 'Crop', key: 'C', icon: Crop },
  { tool: 'ellipse', label: 'Circle', key: 'O', icon: Circle },
  { tool: 'rect', label: 'Box', key: 'R', icon: Square },
  { tool: 'arrow', label: 'Arrow', key: 'A', icon: MoveUpRight },
  { tool: 'line', label: 'Line', key: 'L', icon: Minus },
  { tool: 'pen', label: 'Pen', key: 'P', icon: Pencil },
  { tool: 'highlighter', label: 'Highlight', key: 'H', icon: Highlighter },
  { tool: 'text', label: 'Text', key: 'T', icon: Type },
  { tool: 'blur', label: 'Blur', key: 'B', icon: EyeOff },
  { tool: 'step', label: 'Step number', key: 'N', icon: Hash },
];

const SIZES: Array<{ step: SizeStep; label: string; dot: number }> = [
  { step: 's', label: 'Thin', dot: 4 },
  { step: 'm', label: 'Medium', dot: 7 },
  { step: 'l', label: 'Thick', dot: 11 },
];

const DRAW_KINDS = new Set<Tool>([
  'rect',
  'ellipse',
  'arrow',
  'line',
  'blur',
  'pen',
  'highlighter',
]);

type Drag =
  | { mode: 'draw'; shape: Shape }
  | { mode: 'move'; id: string; start: Point; original: Shape }
  | { mode: 'handle'; id: string; index: number; original: Shape }
  | { mode: 'crop'; start: Point };

interface TextEdit {
  at: Point;
  value: string;
  /** Set when re-editing an existing text shape. */
  id: string | null;
  color: string;
  size: number;
}

/** Shift-constrain: square boxes / circles, 45° arrows and lines. */
function constrain(kind: TwoPointKind, a: Point, b: Point, shift: boolean): Point {
  if (!shift) return b;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (kind === 'arrow' || kind === 'line') {
    const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
    const len = Math.hypot(dx, dy);
    return { x: a.x + len * Math.cos(angle), y: a.y + len * Math.sin(angle) };
  }
  const side = Math.max(Math.abs(dx), Math.abs(dy));
  return { x: a.x + Math.sign(dx || 1) * side, y: a.y + Math.sign(dy || 1) * side };
}

export function ScreenshotEditor({ target }: { target: EditorTarget }) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [original, setOriginal] = useState<ScreenshotRow | null>(null);
  const [history, dispatch] = useReducer(historyReducer, {
    past: [],
    present: EMPTY_DOC,
    future: [],
  });
  const doc = history.present;
  const [tool, setTool] = useState<Tool>(target.tool ?? 'arrow');
  const [color, setColor] = useState<string>(PALETTE[0]!);
  const [sizeStep, setSizeStep] = useState<SizeStep>('m');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Shape | null>(null);
  const [cropDraft, setCropDraft] = useState<Rect | null>(null);
  const [textEdit, setTextEdit] = useState<TextEdit | null>(null);
  const [zoom, setZoom] = useState<'fit' | 1>('fit');
  const [containerW, setContainerW] = useState(0);
  const [busy, setBusy] = useState<null | 'save' | 'copy' | 'download' | 'web'>(null);
  const [saved, setSaved] = useState<SavedEdit | null>(null);
  const [savedAt, setSavedAt] = useState<EditorDoc | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const textRef = useRef<HTMLTextAreaElement | null>(null);

  const imgW = image?.naturalWidth ?? 0;
  const imgH = image?.naturalHeight ?? 0;
  const dirty = history.past.length > 0 && doc !== savedAt;

  // ── Load ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | null = null;
    void downloadFileBytes(target.fileId, controller.signal)
      .then(({ blob }) => {
        objectUrl = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => setImage(img);
        img.onerror = () => setLoadError('This file is not an image the editor can open.');
        img.src = objectUrl;
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted)
          setLoadError(err instanceof Error ? err.message : 'Could not load the screenshot.');
      });
    if (target.screenshotId) {
      void fetchScreenshotById(target.screenshotId)
        .then(setOriginal)
        .catch(() => setOriginal(null));
    }
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [target.fileId, target.screenshotId]);

  useEffect(() => {
    if (original?.page_title) document.title = `Edit — ${original.page_title}`;
  }, [original?.page_title]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => setContainerW(entry?.contentRect.width ?? 0));
    ro.observe(el);
    return () => ro.disconnect();
  }, [image]);

  // Leaving with unsaved marks asks first.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  // While cropping, show the whole image so the crop can grow back out.
  const view = useMemo<Rect>(
    () => (tool === 'crop' ? { x: 0, y: 0, w: imgW, h: imgH } : viewRect(doc, imgW, imgH)),
    [tool, doc, imgW, imgH],
  );
  const scale =
    zoom === 1 || view.w === 0 ? 1 : Math.min(1, Math.max(0.05, (containerW - 48) / view.w));
  const stroke = strokeFor(sizeStep, imgW || 1000, imgH || 1000);

  // ── Draw ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !image) return;
    canvas.width = Math.max(1, Math.round(view.w));
    canvas.height = Math.max(1, Math.round(view.h));
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const shapes = doc.shapes
      .map((s) => (draft && draft.id === s.id ? draft : s))
      .filter((s) => !(textEdit?.id && s.id === textEdit.id));
    if (draft && !doc.shapes.some((s) => s.id === draft.id)) shapes.push(draft);
    renderDoc(ctx, image, { ...doc, shapes }, view);

    const px = 1 / scale;
    ctx.save();
    ctx.translate(-view.x, -view.y);
    const selected = selectedId ? shapes.find((s) => s.id === selectedId) : null;
    if (selected && tool !== 'crop') {
      const b = shapeBounds(selected);
      const pad = selected.size + 4 * px;
      ctx.setLineDash([5 * px, 4 * px]);
      ctx.lineWidth = 1.5 * px;
      ctx.strokeStyle = '#3b82f6';
      ctx.strokeRect(b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2);
      ctx.setLineDash([]);
      for (const h of handlesOf(selected)) {
        ctx.beginPath();
        ctx.arc(h.x, h.y, 5 * px, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.lineWidth = 2 * px;
        ctx.stroke();
      }
    }
    if (tool === 'crop') {
      const c = cropDraft ?? doc.crop;
      if (c && c.w > 0 && c.h > 0) {
        ctx.beginPath();
        ctx.rect(0, 0, imgW, imgH);
        ctx.rect(c.x, c.y, c.w, c.h);
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fill('evenodd');
        ctx.lineWidth = 2 * px;
        ctx.strokeStyle = '#ffffff';
        ctx.setLineDash([6 * px, 4 * px]);
        ctx.strokeRect(c.x, c.y, c.w, c.h);
      }
    }
    ctx.restore();
  }, [image, doc, draft, cropDraft, selectedId, tool, view, scale, textEdit, imgW, imgH]);

  // ── Pointer input ─────────────────────────────────────────────────────────
  const toImage = useCallback(
    (e: { clientX: number; clientY: number }): Point => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const r = canvas.getBoundingClientRect();
      return {
        x: (e.clientX - r.left) * (view.w / r.width) + view.x,
        y: (e.clientY - r.top) * (view.h / r.height) + view.y,
      };
    },
    [view],
  );

  const commitShapes = useCallback(
    (shapes: Shape[]) => dispatch({ type: 'commit', doc: { ...doc, shapes } }),
    [doc],
  );

  const commitText = useCallback(() => {
    const t = textEdit;
    if (!t) return;
    setTextEdit(null);
    const value = t.value.replace(/\s+$/, '');
    if (t.id) {
      const shapes = value
        ? doc.shapes.map((s) => (s.id === t.id && s.kind === 'text' ? { ...s, text: value } : s))
        : doc.shapes.filter((s) => s.id !== t.id);
      commitShapes(shapes);
      return;
    }
    if (!value) return;
    const shape: Shape = {
      id: newId('shape'),
      kind: 'text',
      at: t.at,
      text: value,
      color: t.color,
      size: t.size,
    };
    commitShapes([...doc.shapes, shape]);
    setSelectedId(shape.id);
  }, [textEdit, doc.shapes, commitShapes]);

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0 || !image) return;
    if (textEdit) {
      commitText();
      return;
    }
    const p = toImage(e);
    const tolerance = 6 / scale;
    e.currentTarget.setPointerCapture(e.pointerId);

    if (tool === 'text') {
      const hit = shapeAt(doc.shapes, p, tolerance);
      if (hit?.kind === 'text') {
        setTextEdit({ at: hit.at, value: hit.text, id: hit.id, color: hit.color, size: hit.size });
      } else {
        setTextEdit({ at: p, value: '', id: null, color, size: stroke });
      }
      return;
    }
    if (tool === 'step') {
      const shape: Shape = {
        id: newId('shape'),
        kind: 'step',
        at: p,
        n: nextStepNumber(doc.shapes),
        color,
        size: stroke,
      };
      commitShapes([...doc.shapes, shape]);
      setSelectedId(shape.id);
      return;
    }
    if (tool === 'crop') {
      dragRef.current = { mode: 'crop', start: p };
      setCropDraft({ x: p.x, y: p.y, w: 0, h: 0 });
      return;
    }
    if (tool === 'select') {
      const selected = selectedId ? doc.shapes.find((s) => s.id === selectedId) : null;
      if (selected) {
        const index = handlesOf(selected).findIndex(
          (h) => Math.hypot(h.x - p.x, h.y - p.y) <= 9 / scale,
        );
        if (index >= 0) {
          dragRef.current = { mode: 'handle', id: selected.id, index, original: selected };
          return;
        }
      }
      const hit = shapeAt(doc.shapes, p, tolerance);
      setSelectedId(hit?.id ?? null);
      if (hit) dragRef.current = { mode: 'move', id: hit.id, start: p, original: hit };
      return;
    }
    if (DRAW_KINDS.has(tool)) {
      const base = { id: newId('shape'), color, size: stroke };
      const shape: Shape =
        tool === 'pen' || tool === 'highlighter'
          ? { ...base, kind: tool, points: [p] }
          : { ...base, kind: tool as TwoPointKind, a: p, b: p };
      dragRef.current = { mode: 'draw', shape };
      setDraft(shape);
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const p = toImage(e);
    if (drag.mode === 'crop') {
      setCropDraft(clampRect(normRect(drag.start, p), imgW, imgH));
      return;
    }
    if (drag.mode === 'move') {
      setDraft(translateShape(drag.original, p.x - drag.start.x, p.y - drag.start.y));
      return;
    }
    if (drag.mode === 'handle') {
      setDraft(setHandle(drag.original, drag.index, p));
      return;
    }
    const s = drag.shape;
    let next: Shape;
    if (s.kind === 'pen' || s.kind === 'highlighter') {
      const last = s.points[s.points.length - 1]!;
      if (Math.hypot(p.x - last.x, p.y - last.y) < 1.5 / scale) return;
      next = { ...s, points: [...s.points, p] };
    } else if ('a' in s) {
      next = { ...s, b: constrain(s.kind, s.a, p, e.shiftKey) };
    } else {
      return;
    }
    drag.shape = next;
    setDraft(next);
  };

  const onPointerUp = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    if (drag.mode === 'crop') {
      const c = cropDraft;
      setCropDraft(null);
      if (c && c.w >= 8 && c.h >= 8) {
        dispatch({ type: 'commit', doc: { ...doc, crop: c } });
        setTool('select');
      }
      return;
    }
    const finished = draft;
    setDraft(null);
    if (!finished) return;
    if (drag.mode === 'draw') {
      if (isDegenerate(finished)) return;
      commitShapes([...doc.shapes, finished]);
      setSelectedId(finished.id);
      return;
    }
    if (finished !== drag.original)
      commitShapes(doc.shapes.map((s) => (s.id === finished.id ? finished : s)));
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const hit = shapeAt(doc.shapes, toImage(e), 6 / scale);
    if (hit?.kind === 'text')
      setTextEdit({ at: hit.at, value: hit.text, id: hit.id, color: hit.color, size: hit.size });
  };

  // ── Style changes apply to the selection too ──────────────────────────────
  const restyleSelected = (patch: Partial<Pick<Shape, 'color' | 'size'>>) => {
    if (!selectedId) return;
    commitShapes(doc.shapes.map((s) => (s.id === selectedId ? ({ ...s, ...patch } as Shape) : s)));
  };
  const pickColor = (c: string) => {
    setColor(c);
    restyleSelected({ color: c });
  };
  const pickSize = (step: SizeStep) => {
    setSizeStep(step);
    restyleSelected({ size: strokeFor(step, imgW || 1000, imgH || 1000) });
  };

  const deleteSelected = useCallback(() => {
    if (!selectedId) return;
    commitShapes(doc.shapes.filter((s) => s.id !== selectedId));
    setSelectedId(null);
  }, [selectedId, doc.shapes, commitShapes]);

  const resetCrop = () => {
    if (doc.crop) dispatch({ type: 'commit', doc: { ...doc, crop: null } });
  };

  // ── Output ────────────────────────────────────────────────────────────────
  const render = useCallback(async () => {
    if (!image) throw new Error('The screenshot has not loaded yet.');
    return exportPng(image, doc, imgW, imgH);
  }, [image, doc, imgW, imgH]);

  const flash = (kind: 'ok' | 'error', text: string) => setNotice({ kind, text });

  const save = useCallback(async (): Promise<SavedEdit | null> => {
    setBusy('save');
    setNotice(null);
    try {
      const out = await render();
      const result = await saveEditedScreenshot({
        ...out,
        sourceFileId: target.fileId,
        original,
      });
      setSaved(result);
      setSavedAt(doc);
      flash('ok', original ? 'Saved to Screenshots and Files' : 'Saved to Files');
      return result;
    } catch (err) {
      flash('error', err instanceof Error ? err.message : 'Could not save.');
      return null;
    } finally {
      setBusy(null);
    }
  }, [render, target.fileId, original, doc]);

  const copy = useCallback(async () => {
    setBusy('copy');
    try {
      const { blob } = await render();
      const ok = await copyImage(blob);
      flash(ok ? 'ok' : 'error', ok ? 'Copied' : 'Copy was blocked. Use Download instead.');
    } catch (err) {
      flash('error', err instanceof Error ? err.message : 'Could not copy.');
    } finally {
      setBusy(null);
    }
  }, [render]);

  const download = useCallback(async () => {
    setBusy('download');
    try {
      const { blob } = await render();
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      downloadFile(`screenshot-${stamp}.png`, blob, 'image/png');
    } catch (err) {
      flash('error', err instanceof Error ? err.message : 'Could not download.');
    } finally {
      setBusy(null);
    }
  }, [render]);

  /** The website works on a stored file: save unsaved marks first so they travel along. */
  const openWeb = useCallback(
    async (build: (fileId: string) => string) => {
      let fileId = saved && !dirty ? saved.fileId : target.fileId;
      if (dirty) {
        setBusy('web');
        const result = await save();
        if (!result) return;
        fileId = result.fileId;
      }
      openOnWebsite(build(fileId));
    },
    [saved, dirty, target.fileId, save],
  );

  // ── Keyboard ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (textEdit || el?.closest('input, textarea, [contenteditable="true"]')) return;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (mod && key === 'z') {
        e.preventDefault();
        dispatch({ type: e.shiftKey ? 'redo' : 'undo' });
      } else if (mod && key === 'y') {
        e.preventDefault();
        dispatch({ type: 'redo' });
      } else if (mod && key === 's') {
        e.preventDefault();
        void save();
      } else if (mod && key === 'c') {
        e.preventDefault();
        void copy();
      } else if (key === 'delete' || key === 'backspace') {
        e.preventDefault();
        deleteSelected();
      } else if (key === 'escape') {
        setSelectedId(null);
        setCropDraft(null);
        if (tool === 'crop') setTool('select');
      } else if (!mod && !e.altKey && TOOL_KEYS[key]) {
        setTool(TOOL_KEYS[key]!);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [textEdit, save, copy, deleteSelected, tool]);

  useEffect(() => {
    if (textEdit) requestAnimationFrame(() => textRef.current?.focus());
  }, [textEdit]);

  useEffect(() => {
    if (!notice || notice.kind === 'error') return;
    const t = setTimeout(() => setNotice(null), 2500);
    return () => clearTimeout(t);
  }, [notice]);

  // ── UI ────────────────────────────────────────────────────────────────────
  if (loadError) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-background p-6 text-center">
        <AlertTriangle className="size-6 text-destructive" />
        <p className="text-sm font-medium">Could not open this screenshot</p>
        <p className="max-w-md text-xs text-muted-foreground">{loadError}</p>
        <Button variant="secondary" onClick={() => openOnWebsite(fileWebUrl(target.fileId))}>
          <ExternalLink className="size-3.5" />
          Open in Files
        </Button>
      </div>
    );
  }

  const displayW = Math.round(view.w * scale);
  const displayH = Math.round(view.h * scale);
  const webFileId = saved && !dirty ? saved.fileId : target.fileId;

  return (
    <div className="flex h-screen flex-col bg-muted/40 text-foreground">
      <header className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border bg-background px-3 py-2">
        <div className="flex items-center gap-0.5" role="toolbar" aria-label="Tools">
          {TOOLS.map(({ tool: t, label, key, icon: Icon }) => (
            <Button
              key={t}
              size="sm"
              variant={tool === t ? 'secondary' : 'ghost'}
              className="size-8 p-0"
              aria-pressed={tool === t}
              aria-label={label}
              title={`${label} (${key})`}
              onClick={() => setTool(t)}
            >
              <Icon className="size-4" />
            </Button>
          ))}
        </div>
        <div className="mx-2 h-6 w-px bg-border" />
        <div className="flex items-center gap-1" role="radiogroup" aria-label="Color">
          {PALETTE.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={color === c}
              aria-label={`Color ${c}`}
              title={c}
              onClick={() => pickColor(c)}
              className={`size-5 rounded-full border border-border ${color === c ? 'ring-2 ring-primary ring-offset-1 ring-offset-background' : ''}`}
              style={{ background: c }}
            />
          ))}
        </div>
        <div className="mx-2 h-6 w-px bg-border" />
        <div className="flex items-center gap-0.5" role="radiogroup" aria-label="Thickness">
          {SIZES.map(({ step, label, dot }) => (
            <Button
              key={step}
              size="sm"
              variant={sizeStep === step ? 'secondary' : 'ghost'}
              className="size-8 p-0"
              role="radio"
              aria-checked={sizeStep === step}
              aria-label={label}
              title={label}
              onClick={() => pickSize(step)}
            >
              <span className="rounded-full bg-foreground" style={{ width: dot, height: dot }} />
            </Button>
          ))}
        </div>
        <div className="mx-2 h-6 w-px bg-border" />
        <Button
          size="sm"
          variant="ghost"
          className="size-8 p-0"
          title="Undo (⌘Z)"
          aria-label="Undo"
          disabled={history.past.length === 0}
          onClick={() => dispatch({ type: 'undo' })}
        >
          <Undo2 className="size-4" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="size-8 p-0"
          title="Redo (⇧⌘Z)"
          aria-label="Redo"
          disabled={history.future.length === 0}
          onClick={() => dispatch({ type: 'redo' })}
        >
          <Redo2 className="size-4" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="size-8 p-0"
          title="Delete selected (Delete)"
          aria-label="Delete selected"
          disabled={!selectedId}
          onClick={deleteSelected}
        >
          <Trash2 className="size-4" />
        </Button>
        {doc.crop && (
          <Button size="sm" variant="ghost" onClick={resetCrop} title="Undo the crop">
            <RotateCcw className="size-3.5" />
            Uncrop
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="ml-1 tabular-nums"
          title={zoom === 'fit' ? 'Actual size' : 'Fit to window'}
          onClick={() => setZoom(zoom === 'fit' ? 1 : 'fit')}
        >
          {zoom === 'fit' ? `${Math.round(scale * 100)}%` : '100%'}
        </Button>

        <div className="ml-auto flex items-center gap-1">
          {notice && (
            <span
              role="status"
              className={`mr-1 flex items-center gap-1 text-xs ${notice.kind === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}
            >
              {notice.kind === 'ok' ? (
                <Check className="size-3.5" />
              ) : (
                <AlertTriangle className="size-3.5" />
              )}
              {notice.text}
            </span>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void copy()}
            disabled={!image || !!busy}
            title="Copy image (⌘C)"
          >
            {busy === 'copy' ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Copy className="size-3.5" />
            )}
            Copy
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void download()}
            disabled={!image || !!busy}
            title="Download PNG"
          >
            {busy === 'download' ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Download className="size-3.5" />
            )}
            Download
          </Button>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                disabled={!image || !!busy}
                title="Open on the website"
              >
                {busy === 'web' ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Globe2 className="size-3.5" />
                )}
                Website
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-56 p-1">
              <WebItem label="Open in Files" onClick={() => void openWeb(fileWebUrl)} />
              <WebItem label="Full image editor" onClick={() => void openWeb(webImageEditorUrl)} />
              <WebItem label="Annotate on website" onClick={() => void openWeb(webAnnotateUrl)} />
              {dirty && (
                <p className="px-2 py-1 text-[11px] text-muted-foreground">
                  Saves your edits first
                </p>
              )}
            </PopoverContent>
          </Popover>
          <Button
            size="sm"
            onClick={() => void save()}
            disabled={!image || !!busy || !dirty}
            title="Save as a new screenshot (⌘S)"
          >
            {busy === 'save' ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Save className="size-3.5" />
            )}
            {saved && !dirty ? 'Saved' : 'Save'}
          </Button>
        </div>
      </header>

      <div ref={scrollerRef} className="relative min-h-0 flex-1 overflow-auto">
        {!image ? (
          <div
            className="flex h-full items-center justify-center text-muted-foreground"
            role="status"
          >
            <Loader2 className="mr-2 size-4 animate-spin" />
            Loading screenshot…
          </div>
        ) : (
          <div className="flex min-h-full min-w-fit items-start justify-center p-6">
            <div className="relative shadow-lg" style={{ width: displayW, height: displayH }}>
              <canvas
                ref={canvasRef}
                aria-label="Screenshot canvas"
                className="block touch-none select-none"
                style={{
                  width: displayW,
                  height: displayH,
                  cursor: tool === 'select' ? 'default' : tool === 'text' ? 'text' : 'crosshair',
                }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                onDoubleClick={onDoubleClick}
              />
              {textEdit && (
                <textarea
                  ref={textRef}
                  aria-label="Text"
                  value={textEdit.value}
                  onChange={(e) => setTextEdit({ ...textEdit, value: e.target.value })}
                  onBlur={commitText}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      commitText();
                    } else if (e.key === 'Escape') {
                      setTextEdit(null);
                    }
                  }}
                  rows={Math.max(1, textEdit.value.split('\n').length)}
                  className="absolute resize-none overflow-hidden border border-dashed border-primary bg-transparent p-0 font-semibold leading-[1.25] outline-none"
                  style={{
                    left: (textEdit.at.x - view.x) * scale,
                    top: (textEdit.at.y - view.y) * scale,
                    fontSize: fontSizeFor(textEdit.size) * scale,
                    color: textEdit.color,
                    minWidth: 120,
                    width: Math.max(
                      120,
                      (textEdit.value.length + 2) * fontSizeFor(textEdit.size) * 0.6 * scale,
                    ),
                  }}
                />
              )}
            </div>
          </div>
        )}
      </div>

      <footer className="flex shrink-0 items-center gap-3 border-t border-border bg-background px-3 py-1.5 text-[11px] text-muted-foreground">
        <span className="tabular-nums">
          {imgW > 0 ? `${Math.round(view.w)}×${Math.round(view.h)}` : ''}
        </span>
        {tool === 'crop' && <span>Drag to crop · Esc to cancel</span>}
        {tool !== 'crop' && original?.page_title && (
          <span className="truncate">{original.page_title}</span>
        )}
        {saved && (
          <button
            type="button"
            className="ml-auto flex items-center gap-1 underline-offset-2 hover:underline"
            onClick={() => openOnWebsite(fileWebUrl(webFileId))}
          >
            <ExternalLink className="size-3" />
            View saved copy
          </button>
        )}
      </footer>
    </div>
  );
}

function WebItem({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
    >
      <ExternalLink className="size-3.5 text-muted-foreground" />
      {label}
    </button>
  );
}
