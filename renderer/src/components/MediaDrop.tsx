import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Upload, Film, Image as ImageIcon, X } from "lucide-react";

interface Props {
  label: string;
  accept: "image" | "video" | "image-or-video";
  file: File | null;
  onChange: (f: File | null) => void;
  hint?: string;
}

function acceptString(accept: Props["accept"]): string {
  if (accept === "image") return "image/*";
  if (accept === "video") return "video/*";
  return "image/*,video/*";
}

export function MediaDrop({ label, accept, file, onChange, hint }: Props) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const previewUrl = useFileObjectUrl(file);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const f = e.dataTransfer.files?.[0];
      if (f) onChange(f);
    },
    [onChange],
  );

  const isImage = file && file.type.startsWith("image/");
  const isVideo = file && file.type.startsWith("video/");

  return (
    <div className="flex-1">
      <div className="label mb-2">{label}</div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={clsx(
          "cursor-pointer relative card overflow-hidden h-56 flex items-center justify-center transition-colors",
          dragOver && "border-accent-500/60 bg-accent-500/5",
        )}
      >
        {!file && (
          <div className="flex flex-col items-center gap-2 text-ink-300 text-sm pointer-events-none">
            <Upload size={20} />
            <div>Drop or click to upload</div>
            {hint && <div className="text-xs text-ink-400">{hint}</div>}
          </div>
        )}
        {isImage && previewUrl && (
          <img
            src={previewUrl}
            className="absolute inset-0 w-full h-full object-contain bg-canvas-900"
          />
        )}
        {isVideo && previewUrl && (
          <video
            src={previewUrl}
            className="absolute inset-0 w-full h-full object-contain bg-canvas-900"
            muted
            playsInline
            loop
            autoPlay
          />
        )}
        {file && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onChange(null);
            }}
            className="absolute top-2 right-2 h-7 w-7 rounded-full bg-black/60 hover:bg-black/80 text-ink-100 flex items-center justify-center"
            title="Remove"
          >
            <X size={14} />
          </button>
        )}
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          accept={acceptString(accept)}
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            onChange(f);
            e.target.value = "";
          }}
        />
      </div>
      {file && (
        <div className="mt-2 flex items-center gap-2 text-xs text-ink-400">
          {isImage ? <ImageIcon size={12} /> : <Film size={12} />}
          <span className="truncate">{file.name}</span>
          <span className="text-ink-500">· {(file.size / 1_000_000).toFixed(1)} MB</span>
        </div>
      )}
    </div>
  );
}

function useFileObjectUrl(file: File | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file) {
      setUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    // Revoke when the file changes AND on unmount. The previous render-time ref
    // approach never revoked on unmount, so navigating away from New Analysis
    // with a clip still selected leaked its blob URL (and backing media buffer)
    // for the lifetime of the renderer window.
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);
  return url;
}
