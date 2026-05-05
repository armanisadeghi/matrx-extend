/**
 * Annotation editor — tldraw layered over a guidance screenshot.
 *
 * Strategy: render the screenshot as a plain <img> behind a transparent
 * tldraw canvas. The user draws shapes / arrows / text on the canvas;
 * tldraw never sees the image. On save we serialize the tldraw store
 * for round-trip editing AND composite the markup over the screenshot
 * via a 2D canvas — uploading the flattened PNG so agent vision tools
 * see the marked-up image as a single artifact.
 *
 * Lazy-loaded via Suspense so the tldraw bundle isn't paid by the rest
 * of the sidepanel.
 */

import { Button } from '@/components/ui/button';
import { uploadFile } from '@/lib/api/routes/files';
import { saveGuidanceItem } from '@/lib/guidance/storage';
import type { GuidanceScreenshot } from '@/lib/guidance/types';
import { Loader2, Save, X } from 'lucide-react';
import { useCallback, useState } from 'react';
import { type Editor, getSnapshot, loadSnapshot, Tldraw } from 'tldraw';
import 'tldraw/tldraw.css';

export function AnnotationEditor({
  item,
  onClose,
  onSaved,
}: {
  item: GuidanceScreenshot;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleMount = useCallback(
    (ed: Editor) => {
      setEditor(ed);
      // Restore previous annotations if present.
      if (item.annotation_doc) {
        try {
          loadSnapshot(ed.store, item.annotation_doc as Parameters<typeof loadSnapshot>[1]);
        } catch {
          /* corrupt snapshot — start fresh */
        }
      }
    },
    [item.annotation_doc],
  );

  const handleSave = useCallback(async () => {
    if (!editor) return;
    setBusy(true);
    setError(null);
    try {
      // 1. Persist tldraw doc for round-trip editing.
      const snapshot = getSnapshot(editor.store);

      // 2. Render markup as a transparent PNG (just the shapes, no bg).
      const shapeIds = Array.from(editor.getCurrentPageShapeIds());
      let markupBlob: Blob | null = null;
      if (shapeIds.length > 0) {
        const exported = await editor.toImage(shapeIds, {
          format: 'png',
          background: false,
          padding: 0,
        });
        markupBlob = exported.blob;
      }

      // 3. Composite over the screenshot.
      const flattenedBlob = await composite(item.url ?? '', markupBlob);

      // 4. Upload the flattened image.
      const filename = `guidance-annotated-${Date.now()}.png`;
      const upload = await uploadFile(flattenedBlob, filename, {
        path: `browser-agent/guidance/screenshots/${filename}`,
        metadata: {
          domain: item.domain,
          kind: 'guidance_screenshot_annotated',
          base_file_id: item.file_id,
        },
      });

      await saveGuidanceItem({
        ...item,
        annotation_doc: snapshot,
        annotated_file_id: upload.file_id,
        annotated_url: upload.url ?? upload.cdn_url ?? null,
        updated_at: Date.now(),
      });
      await onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, [editor, item, onSaved]);

  return (
    <div className="flex h-[420px] flex-col rounded border border-border/60 bg-background">
      <div className="flex shrink-0 items-center justify-between border-b border-border/60 px-2 py-1">
        <span className="text-[11px] text-muted-foreground">
          Draw arrows, shapes, and labels — saved together with the screenshot.
        </span>
        <div className="flex gap-1">
          <Button
            size="sm"
            variant="default"
            className="h-7 gap-1 px-2 text-xs"
            onClick={handleSave}
            disabled={busy || !editor}
          >
            {busy ? <Loader2 className="size-3 animate-spin" /> : <Save className="size-3" />}
            Save
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={onClose}
            disabled={busy}
          >
            <X className="size-3" />
          </Button>
        </div>
      </div>
      {error && (
        <div className="shrink-0 border-b border-destructive/30 bg-destructive/10 px-2 py-1 text-xs text-destructive">
          {error}
        </div>
      )}
      <div className="relative flex-1 overflow-hidden">
        {/* Screenshot background. Pointer events disabled so tldraw gets every gesture. */}
        {item.url && (
          <img
            src={item.url}
            alt="screenshot"
            className="absolute inset-0 size-full object-contain"
            style={{ pointerEvents: 'none' }}
          />
        )}
        <div className="absolute inset-0">
          <Tldraw onMount={handleMount} hideUi={false} />
        </div>
      </div>
    </div>
  );
}

/**
 * Composite the (transparent) markup PNG over the (opaque) screenshot
 * onto a single canvas; return as a PNG blob. Falls back to either side
 * if the other is missing.
 */
async function composite(
  screenshotUrl: string,
  markupBlob: Blob | null,
): Promise<Blob> {
  if (!screenshotUrl) {
    if (!markupBlob) throw new Error('Nothing to save — no screenshot URL and no markup.');
    return markupBlob;
  }
  const screenshotImg = await loadImage(screenshotUrl);
  const w = screenshotImg.naturalWidth || 1280;
  const h = screenshotImg.naturalHeight || 720;
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('OffscreenCanvas 2d context unavailable');
  ctx.drawImage(screenshotImg, 0, 0, w, h);
  if (markupBlob) {
    const markupImg = await loadImageFromBlob(markupBlob);
    ctx.drawImage(markupImg, 0, 0, w, h);
  }
  return canvas.convertToBlob({ type: 'image/png' });
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load ${url}`));
    img.src = url;
  });
}

async function loadImageFromBlob(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  try {
    return await loadImage(url);
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
