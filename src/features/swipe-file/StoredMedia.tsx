import { type SocialPostMedia, readPostMediaBlob } from '@/lib/api/routes/social';
import { Button } from '@ai-matrx/design-system';
import { useEffect, useState } from 'react';

/** Authenticated files are fetched on demand, never by leaking a token into a URL. */
export function StoredMedia({
  media,
  postId,
  organizationId,
}: { media: SocialPostMedia; postId: string; organizationId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );
  async function load() {
    setLoading(true);
    setError(null);
    setPreviewFailed(false);
    try {
      setUrl(URL.createObjectURL(await readPostMediaBlob(postId, media.file_id, organizationId)));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'File could not be opened.');
    } finally {
      setLoading(false);
    }
  }
  return (
    <div className="overflow-hidden rounded-lg border bg-background p-2 space-y-2">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span>{media.role.replaceAll('_', ' ')}</span>
        <span className="text-muted-foreground">
          {media.mime_type ?? 'File'}
          {media.size_bytes !== null ? ` · ${(media.size_bytes / 1024 / 1024).toFixed(1)} MB` : ''}
        </span>
      </div>
      {!url && (
        <Button size="sm" variant="outline" disabled={loading} onClick={() => void load()}>
          {loading ? 'Opening…' : 'Open stored file'}
        </Button>
      )}
      {url &&
        !previewFailed &&
        (media.mime_type?.startsWith('image/') ? (
          <img
            onError={() => setPreviewFailed(true)}
            src={url}
            alt={media.role}
            className="w-full rounded object-contain"
          />
        ) : media.mime_type?.startsWith('video/') ? (
          <video
            onError={() => setPreviewFailed(true)}
            src={url}
            controls
            preload="metadata"
            className="w-full rounded"
          >
            <track kind="captions" />
          </video>
        ) : media.mime_type?.startsWith('audio/') ? (
          <audio onError={() => setPreviewFailed(true)} src={url} controls>
            <track kind="captions" />
          </audio>
        ) : (
          <a href={url} download={media.file_id} className="text-primary underline text-xs">
            Download file
          </a>
        ))}
      {url && previewFailed && (
        <div className="space-y-2">
          <p role="alert" className="text-xs text-amber-600">
            Preview unavailable. Download the stored file.
          </p>
          <a
            href={url}
            download={`${media.file_id}${media.mime_type === 'image/heic' ? '.heic' : ''}`}
            className="text-primary underline text-xs"
          >
            Download stored file
          </a>
        </div>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
