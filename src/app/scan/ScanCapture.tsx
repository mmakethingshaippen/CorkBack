"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CameraIcon, ImageIcon } from "@/components/icons";

/**
 * Scan capture: take or choose a photo of a paper flyer. The one dark-red main
 * action is "Capture & review". Nothing goes public here — the photo is sent to
 * server-side extraction and the result is carried into the review step.
 */
export function ScanCapture() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<string | null>(null);

  async function handleFile(file: File) {
    setStatus("Reading the flyer…");
    const form = new FormData();
    form.set("image", file);
    let res: Response;
    try {
      res = await fetch("/api/scan/extract", { method: "POST", body: form });
    } catch {
      setStatus("Could not reach the scan service. Check your connection and try again.");
      return;
    }
    let body;
    try {
      body = await res.json();
    } catch {
      setStatus(`The scan service returned an unreadable response (HTTP ${res.status}). Please try again shortly.`);
      return;
    }
    if (!res.ok) {
      setStatus(typeof body?.error === "string" ? body.error : `The scan service failed (HTTP ${res.status}). Please try again shortly.`);
      return;
    }
    if (!body?.extracted) {
      setStatus("The scan service returned no flyer data. Please try again.");
      return;
    }
    sessionStorage.setItem("corkback.extracted", JSON.stringify(body.extracted));
    router.push("/scan/review");
  }

  return (
    <div className="space-y-4">
      <div className="rounded-card border border-board bg-board/30 p-4 text-center text-ink/70">
        Fit the whole flyer inside the frame. Keep all four corners in view. You can check and edit every detail next.
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) handleFile(f);
        }}
      />

      {/* One dark-red main action per screen. */}
      <button
        onClick={() => fileRef.current?.click()}
        className="flex w-full items-center justify-center gap-2 rounded-control bg-dark-red px-5 py-3 font-bold text-white"
      >
        <CameraIcon /> Capture &amp; review
      </button>

      <button
        onClick={() => fileRef.current?.click()}
        className="flex w-full items-center justify-center gap-2 rounded-control border border-board px-5 py-3 font-bold text-ink"
      >
        <ImageIcon /> Choose from photos
      </button>

      <div className="rounded-card border border-board bg-board/20 p-4 text-sm text-ink/70">
        <p className="font-bold text-ink">Your permission, your pin</p>
        <p className="mt-1">
          Location is requested before publishing, so the flyer pins where you are — not at a venue read from the paper.
          Nothing goes public until you select Publish.
        </p>
      </div>

      {status ? <p className="text-sm text-ink/70">{status}</p> : null}
    </div>
  );
}
