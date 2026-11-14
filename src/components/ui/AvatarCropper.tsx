"use client";
import { useEffect, useRef, useState } from "react";
import { MIN_CROP_SIZE, clampCrop, defaultCrop, type CropRect } from "@/lib/avatars/crop";

const VIEW = 240; // preview diameter in px; fits a 390 px screen with 24 px edges

const btn =
  "inline-flex min-h-[50px] items-center rounded-control border-2 border-deep-navy px-5 font-bold focus:outline-none focus-visible:ring-2 focus-visible:ring-deep-navy focus-visible:ring-offset-2 disabled:opacity-60";

/**
 * Preview and square-crop step. The circle shows exactly what other people will
 * see. The photo is only ever scaled uniformly (one scale for both axes), so it
 * is never stretched. Nothing is uploaded until the owner chooses "Save photo".
 * The browser's <img> applies EXIF orientation, which matches the server's
 * rotate(), so the crop fractions mean the same thing on both sides.
 */
export function AvatarCropper({
  file,
  disabled,
  onSave,
  onCancel,
  onUnreadable,
}: {
  file: File;
  disabled?: boolean;
  onSave: (crop: CropRect) => void;
  onCancel: () => void;
  onUnreadable: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [dim, setDim] = useState<{ w: number; h: number } | null>(null);
  const [crop, setCrop] = useState<CropRect>({ x: 0, y: 0, size: 1 });
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);

  useEffect(() => {
    const u = URL.createObjectURL(file);
    setUrl(u);
    setDim(null);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  const short = dim ? Math.min(dim.w, dim.h) : 1;
  const scale = dim ? VIEW / (crop.size * short) : 1; // screen px per source px

  function move(dxSrc: number, dySrc: number) {
    if (!dim) return;
    setCrop((c) => clampCrop({ ...c, x: c.x + dxSrc / dim.w, y: c.y + dySrc / dim.h }, dim.w, dim.h));
  }
  function zoomTo(size: number) {
    if (!dim) return;
    setCrop((c) => {
      const cx = c.x * dim.w + (c.size * short) / 2; // keep the centre fixed
      const cy = c.y * dim.h + (c.size * short) / 2;
      const s = Math.min(1, Math.max(MIN_CROP_SIZE, size));
      return clampCrop({ x: (cx - (s * short) / 2) / dim.w, y: (cy - (s * short) / 2) / dim.h, size: s }, dim.w, dim.h);
    });
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!dim || disabled) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
  }
  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    move(-(e.clientX - d.x) / scale, -(e.clientY - d.y) / scale);
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
  }
  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (drag.current?.id === e.pointerId) drag.current = null;
  }
  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (!dim || disabled) return;
    const step = crop.size * short * 0.05;
    const k = e.key;
    if (k === "ArrowLeft") move(-step, 0);
    else if (k === "ArrowRight") move(step, 0);
    else if (k === "ArrowUp") move(0, -step);
    else if (k === "ArrowDown") move(0, step);
    else if (k === "+" || k === "=") zoomTo(crop.size * 0.9);
    else if (k === "-") zoomTo(crop.size / 0.9);
    else return;
    e.preventDefault();
  }

  const zoom = 1 / crop.size; // 1 (whole short side) up to 1 / MIN_CROP_SIZE

  return (
    <div role="group" aria-label="Crop your photo" className="space-y-3 rounded-card border border-board bg-white p-4">
      <p className="text-sm text-ink">Drag the photo to move it, and use the slider to zoom. The circle is how your photo will look.</p>
      <div
        tabIndex={0}
        role="application"
        aria-label="Photo preview. Arrow keys move the photo. Plus and minus zoom."
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
        style={{ width: VIEW, height: VIEW, touchAction: "none" }}
        className="relative mx-auto max-w-full cursor-grab select-none overflow-hidden rounded-full border-2 border-deep-navy bg-board focus:outline-none focus-visible:ring-2 focus-visible:ring-deep-navy focus-visible:ring-offset-2 active:cursor-grabbing"
      >
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element -- local blob preview, not a remote image
          <img
            src={url}
            alt=""
            draggable={false}
            onLoad={(e) => {
              const i = e.currentTarget;
              if (!i.naturalWidth || !i.naturalHeight) return onUnreadable();
              setDim({ w: i.naturalWidth, h: i.naturalHeight });
              setCrop(defaultCrop(i.naturalWidth, i.naturalHeight));
            }}
            onError={onUnreadable}
            style={
              dim
                ? { position: "absolute", maxWidth: "none", width: dim.w * scale, height: dim.h * scale, left: -crop.x * dim.w * scale, top: -crop.y * dim.h * scale }
                : { position: "absolute", visibility: "hidden" }
            }
          />
        ) : null}
      </div>
      <label className="flex items-center gap-3 text-sm text-ink">
        <span className="shrink-0 font-bold">Zoom</span>
        <input
          type="range"
          min={1}
          max={1 / MIN_CROP_SIZE}
          step={0.01}
          value={zoom}
          disabled={!dim || disabled}
          onChange={(e) => zoomTo(1 / Number(e.target.value))}
          aria-label="Zoom"
          className="min-h-[44px] w-full accent-deep-navy"
        />
      </label>
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={!dim || disabled}
          onClick={() => onSave(crop)}
          className={`${btn} bg-deep-navy text-white`}
        >
          Save photo
        </button>
        <button type="button" disabled={disabled} onClick={onCancel} className={`${btn} bg-white text-deep-navy`}>
          Cancel
        </button>
      </div>
    </div>
  );
}
