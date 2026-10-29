"use client";

import { useEffect, useRef, useState } from "react";

const SIZE = 320;

export function LogoCropDialog({ file, onCancel, onSave }: { file: File; onCancel: () => void; onSave: (cropped: File) => void }) {
  const stage = useRef<HTMLDivElement>(null);
  const [image, setImage] = useState<{ url: string; width: number; height: number } | null>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [drag, setDrag] = useState<{ id: number; x: number; y: number; ox: number; oy: number } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    const img = new window.Image();
    img.onload = () => setImage({ url, width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => setError("This image could not be opened. Choose another one.");
    img.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const base = image ? Math.max(SIZE / image.width, SIZE / image.height) : 1;
  const width = image ? image.width * base * zoom : SIZE;
  const height = image ? image.height * base * zoom : SIZE;
  const x = (SIZE - width) / 2 + offset.x;
  const y = (SIZE - height) / 2 + offset.y;

  async function save() {
    if (!image) return;
    setBusy(true);
    setError("");
    try {
      const source = await createImageBitmap(file, { imageOrientation: "from-image" });
      const canvas = document.createElement("canvas");
      canvas.width = 512;
      canvas.height = 512;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Could not prepare the logo.");
      ctx.beginPath();
      ctx.arc(256, 256, 256, 0, Math.PI * 2);
      ctx.clip();
      const ratio = 512 / SIZE;
      ctx.drawImage(source, x * ratio, y * ratio, width * ratio, height * ratio);
      source.close();
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("Could not crop the logo.")), "image/png"));
      onSave(new File([blob], `${file.name.replace(/\.[^.]+$/, "")}-circle.png`, { type: "image/png" }));
    } catch {
      setError("Could not crop this image. Try a different file.");
      setBusy(false);
    }
  }

  return <div className="fixed inset-0 z-[100] grid place-items-center bg-black/60 p-4" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onCancel(); }}>
    <section role="dialog" aria-modal="true" aria-labelledby="logo-crop-title" className="w-full max-w-sm rounded-3xl bg-surface p-5 text-ink shadow-2xl">
      <h2 id="logo-crop-title" className="text-xl font-bold">Crop restaurant logo</h2>
      <p className="mt-1 text-sm text-muted">Drag to position it. Zoom in if needed.</p>
      <div ref={stage} className="relative mx-auto mt-5 aspect-square w-full max-w-[320px] touch-none overflow-hidden rounded-full bg-paper" onPointerDown={event => { if (!image) return; event.currentTarget.setPointerCapture(event.pointerId); setDrag({ id: event.pointerId, x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y }); }} onPointerMove={event => { if (drag?.id !== event.pointerId) return; const rect = stage.current?.getBoundingClientRect(); if (!rect) return; const scale = SIZE / rect.width; const maxX = Math.max(0, (width - SIZE) / 2); const maxY = Math.max(0, (height - SIZE) / 2); setOffset({ x: Math.max(-maxX, Math.min(maxX, drag.ox + (event.clientX - drag.x) * scale)), y: Math.max(-maxY, Math.min(maxY, drag.oy + (event.clientY - drag.y) * scale)) }); }} onPointerUp={() => setDrag(null)} onPointerCancel={() => setDrag(null)}>
        {image && <img src={image.url} alt="Logo crop preview" draggable={false} className="pointer-events-none absolute max-w-none select-none" style={{ left: `${50 + offset.x / SIZE * 100}%`, top: `${50 + offset.y / SIZE * 100}%`, width: `${width / SIZE * 100}%`, height: `${height / SIZE * 100}%`, transform: "translate(-50%, -50%)" }} />}
      </div>
      <label className="mt-5 block text-sm font-semibold">Zoom<input aria-label="Zoom logo" type="range" min="1" max="3" step="0.01" value={zoom} onChange={event => { const next = Number(event.target.value); setZoom(next); if (image) { const w = image.width * base * next; const h = image.height * base * next; setOffset(current => ({ x: Math.max(-(w - SIZE) / 2, Math.min((w - SIZE) / 2, current.x)), y: Math.max(-(h - SIZE) / 2, Math.min((h - SIZE) / 2, current.y)) })); } }} className="mt-2 w-full accent-brand" /></label>
      <p className="text-xs text-muted">The saved logo will be circular.</p>
      {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
      <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={onCancel} disabled={busy} className="min-h-11 rounded-xl px-4 font-semibold text-muted">Cancel</button><button type="button" onClick={() => void save()} disabled={!image || busy} className="min-h-11 rounded-xl bg-brand px-4 font-semibold text-brand-on disabled:opacity-50">{busy ? "Preparing…" : "Use this crop"}</button></div>
    </section>
  </div>;
}
