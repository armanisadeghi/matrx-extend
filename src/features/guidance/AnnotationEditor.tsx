/**
 * Annotation editor — tldraw wrapped over a guidance screenshot.
 *
 * The user draws arrows / shapes / text on top of a saved screenshot;
 * we persist the tldraw document JSON inline on the guidance item AND
 * upload a flattened PNG so the agent has a single image (with markup)
 * to consume via vision tools.
 *
 * Lazy-loaded via Suspense in GuidancePreview so the tldraw bundle
 * isn't paid by the rest of the sidepanel.
 */

import { Button } from '@/components/ui/button';
import { uploadFile } from '@/lib/api/routes/files';
import { saveGuidanceItem } from '@/lib/guidance/storage';
import type { GuidanceScreenshot } from '@/lib/guidance/types';
import { Loader2, Save, X } from 'lucide-react';
import { useCallback, useState } from 'react';
import { exportToBlob, getSnapshot, loadSnapshot, type Editor, Tldraw } from 'tldraw';
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

  // Mount the screenshot as a background image asset on first ready.
  const handleMount = useCallback(
    (ed: Editor) => {
      setEditor(ed);
      // Restore previous annotation doc if present.
      if (item.annotation_doc) {
        try {
          loadSnapshot(ed.store, item.annotation_doc as ReturnType<typeof getSnapshot>);
          return;
        } catch {
          /* fall through and add the base image */
        }
      }
      const url = item.url;
      if (!url) return;
      const w = item.width ?? 800;
      const h = item.height ?? 600;
      // Add the screenshot as a locked, unselectable background image.
      ed.createAssets([
        {
          id: 'asset:guidance-bg',
          type: 'image',
          typeName: 'asset',
          props: {
            name: 'screenshot',
            src: url,
            w,
            h,
            mimeType: item.url?.includes('.png') ? 'image/png' : 'image/jpeg',
            isAnimated: false,
          },
          meta: {},
        },
      ]);
      ed.createShape({
        type: 'image',
        x: 0,
        y: 0,
        isLocked: true,
        props: { assetId: 'asset:guidance-bg', w, h },
      });
    },
    [item],
  );

  const handleSave = useCallback(async () => {
    if (!editor) return;
    setBusy(true);
    try {
      // 1. Snapshot the document JSON for round-trip editing.
      const snapshot = getSnapshot(editor.store);

      // 2. Flatten to PNG for agent vision consumption.
      const blob = await exportToBlob({
        editor,
        ids: Array.from(editor.getCurrentPageShapeIds()),
        format: 'png',
        opts: { background: true, padding: 0 },
      });

      const filename = `guidance-annotated-${Date.now()}.png`;
      const upload = await uploadFile(blob, filename, {
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
    } finally {
      setBusy(false);
    }
  }, [editor, item, onSaved]);

  return (
    <div className="flex h-[420px] flex-col rounded border border-border/60 bg-background">
      <div className="flex shrink-0 items-center justify-between border-b border-border/60 px-2 py-1">
        <span className="text-[11px] text-muted-foreground">Annotate · changes save together</span>
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
      <div className="flex-1 overflow-hidden">
        <Tldraw onMount={handleMount} hideUi={false} />
      </div>
    </div>
  );
}
