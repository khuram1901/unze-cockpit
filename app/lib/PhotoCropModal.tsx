"use client";
import { useState, useRef, useEffect } from "react";

// ── Constants ────────────────────────────────────────────────────────────────
const CONTAINER = 280;           // outer drag area (px)
const CROP_OFF  = 10;            // gap between container edge and crop circle
const CROP_DISP = 260;           // crop circle display diameter
const CROP_R    = CROP_DISP / 2; // 130px
const OUT_PX    = 300;           // output canvas size

interface Props {
  file:     File;
  maxKb:    number;
  onDone:   (blob: Blob, preview: string) => void;
  onCancel: () => void;
}

export default function PhotoCropModal({ file, maxKb, onDone, onCancel }: Props) {
  const [imgEl,   setImgEl]   = useState<HTMLImageElement | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [offset,  setOffset]  = useState({ x: 0, y: 0 });
  const [zoom,    setZoom]    = useState(1);
  const [minZoom, setMinZoom] = useState(0.1);
  const [maxZoom, setMaxZoom] = useState(3);
  const [error,   setError]   = useState<string | null>(null);

  const dragging  = useRef(false);
  const dragStart = useRef({ x: 0, y: 0, ox: 0, oy: 0 });
  const zoomRef   = useRef(1);

  // ── Load image from file ──────────────────────────────────────────────────
  useEffect(() => {
    const url = URL.createObjectURL(file);
    setBlobUrl(url);
    const img = new Image();
    img.onload = () => {
      setImgEl(img);

      // Base scale: shorter dimension fills the crop circle at zoom=1
      const base = CROP_DISP / Math.min(img.naturalWidth, img.naturalHeight);

      // coverZoom: minimum zoom so BOTH dimensions cover the crop circle
      const coverZoom = Math.max(
        CROP_DISP / (img.naturalWidth  * base),
        CROP_DISP / (img.naturalHeight * base),
      );

      // fitZoom: zoom out until the ENTIRE image fits inside the container
      // This lets users see their full photo and pick the right crop area
      const fitZoom = Math.min(
        CONTAINER / (img.naturalWidth  * base),
        CONTAINER / (img.naturalHeight * base),
      );

      // Start at coverZoom × 1.3 so there is room to drag in all directions
      const initialZoom = coverZoom * 1.3;

      setMinZoom(fitZoom);           // can zoom all the way out to see full image
      setMaxZoom(coverZoom * 3);     // can zoom in to 3× the cover minimum
      setZoom(initialZoom);
      zoomRef.current = initialZoom;

      // Centre image inside the container
      const dw = img.naturalWidth  * base * initialZoom;
      const dh = img.naturalHeight * base * initialZoom;
      setOffset({ x: (CONTAINER - dw) / 2, y: (CONTAINER - dh) / 2 });
    };
    img.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // ── Display size helpers ──────────────────────────────────────────────────
  function getDisplayW(z: number) {
    if (!imgEl) return CROP_DISP;
    const base = CROP_DISP / Math.min(imgEl.naturalWidth, imgEl.naturalHeight);
    return imgEl.naturalWidth * base * z;
  }
  function getDisplayH(dw: number) {
    if (!imgEl) return CROP_DISP;
    return dw * (imgEl.naturalHeight / imgEl.naturalWidth);
  }

  // ── Clamp offset ──────────────────────────────────────────────────────────
  // When image is smaller than the crop circle (zoomed out), centre it.
  // When image covers the circle, constrain so the circle is always filled.
  function clampOffset(ox: number, oy: number, z?: number) {
    const dw = getDisplayW(z ?? zoomRef.current);
    const dh = getDisplayH(dw);

    // Image is smaller than crop circle: just keep it centred
    if (dw < CROP_DISP || dh < CROP_DISP) {
      return {
        x: (CONTAINER - dw) / 2,
        y: (CONTAINER - dh) / 2,
      };
    }

    // Image covers the circle: keep the circle fully filled
    const cropRight  = CROP_OFF + CROP_DISP;
    const cropBottom = CROP_OFF + CROP_DISP;
    return {
      x: Math.min(CROP_OFF, Math.max(cropRight  - dw, ox)),
      y: Math.min(CROP_OFF, Math.max(cropBottom - dh, oy)),
    };
  }

  // ── Mouse drag ───────────────────────────────────────────────────────────
  function onMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    dragging.current = true;
    dragStart.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
  }
  function onMouseMove(e: React.MouseEvent) {
    if (!dragging.current) return;
    const { x, y, ox, oy } = dragStart.current;
    setOffset(clampOffset(ox + e.clientX - x, oy + e.clientY - y));
  }
  function onPointerUp() { dragging.current = false; }

  // ── Touch drag ───────────────────────────────────────────────────────────
  function onTouchStart(e: React.TouchEvent) {
    const t = e.touches[0];
    dragStart.current = { x: t.clientX, y: t.clientY, ox: offset.x, oy: offset.y };
  }
  function onTouchMove(e: React.TouchEvent) {
    const t = e.touches[0];
    const { x, y, ox, oy } = dragStart.current;
    setOffset(clampOffset(ox + t.clientX - x, oy + t.clientY - y));
  }

  // ── Zoom ─────────────────────────────────────────────────────────────────
  function handleZoom(z: number) {
    zoomRef.current = z;
    setZoom(z);
    setOffset(prev => clampOffset(prev.x, prev.y, z));
  }

  // ── Apply crop ───────────────────────────────────────────────────────────
  function apply() {
    if (!imgEl) return;
    setError(null);

    const dw = getDisplayW(zoom);
    const dh = getDisplayH(dw);

    const canvas  = document.createElement("canvas");
    canvas.width  = OUT_PX;
    canvas.height = OUT_PX;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, OUT_PX, OUT_PX);

    // Map the crop circle's bounding box back to source image coordinates
    const cropX = (CROP_OFF - offset.x) / dw * imgEl.naturalWidth;
    const cropY = (CROP_OFF - offset.y) / dh * imgEl.naturalHeight;
    const cropW = CROP_DISP / dw * imgEl.naturalWidth;
    const cropH = CROP_DISP / dh * imgEl.naturalHeight;
    ctx.drawImage(imgEl, cropX, cropY, cropW, cropH, 0, 0, OUT_PX, OUT_PX);

    let quality = 0.9;
    const tryBlob = () => {
      canvas.toBlob((blob) => {
        if (!blob) { setError("Could not process image."); return; }
        if (blob.size > maxKb * 1000 && quality > 0.5) {
          quality -= 0.1;
          tryBlob();
          return;
        }
        if (blob.size > maxKb * 1000) {
          setError(`Still too large (${Math.round(blob.size / 1000)} KB). Try a simpler photo.`);
          return;
        }
        onDone(blob, canvas.toDataURL("image/jpeg", 0.9));
      }, "image/jpeg", quality);
    };
    tryBlob();
  }

  const dw = getDisplayW(zoom);
  const dh = getDisplayH(dw);

  return (
    <div style={{
      position:   "fixed", inset: 0, zIndex: 9999,
      background: "rgba(0,0,0,0.72)",
      display:    "flex", alignItems: "center", justifyContent: "center",
      padding:    "16px",
    }}>
      <div style={{
        background:    "#ffffff",
        borderRadius:  "16px",
        padding:       "24px",
        width:         "320px",
        display:       "flex",
        flexDirection: "column",
        gap:           "16px",
        boxShadow:     "0 24px 64px rgba(0,0,0,0.45)",
      }}>
        {/* Header */}
        <div>
          <div style={{ fontSize: "16px", fontWeight: 700, color: "#0F1720", marginBottom: "4px" }}>
            Position your photo
          </div>
          <div style={{ fontSize: "12px", color: "#64748B" }}>
            Drag to reposition · slide left to zoom out
          </div>
        </div>

        {/* ── Drag area ────────────────────────────────────────────────── */}
        <div
          style={{
            width:        CONTAINER,
            height:       CONTAINER,
            position:     "relative",
            background:   "#111827",
            borderRadius: "8px",
            overflow:     "hidden",
            cursor:       "grab",
            alignSelf:    "center",
            flexShrink:   0,
            userSelect:   "none",
          }}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onPointerUp}
          onMouseLeave={onPointerUp}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onPointerUp}
        >
          {blobUrl && imgEl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={blobUrl}
              alt=""
              draggable={false}
              style={{
                position:      "absolute",
                left:          offset.x,
                top:           offset.y,
                width:         dw,
                pointerEvents: "none",
                display:       "block",
              }}
            />
          )}

          {/* Dark overlay with circular cutout */}
          <div style={{
            position:      "absolute",
            inset:         0,
            pointerEvents: "none",
            background:    `radial-gradient(circle at ${CONTAINER / 2}px ${CONTAINER / 2}px, transparent ${CROP_R}px, rgba(0,0,0,0.58) ${CROP_R}px)`,
          }} />

          {/* Circle guide ring */}
          <div style={{
            position:     "absolute",
            left:         CROP_OFF,
            top:          CROP_OFF,
            width:        CROP_DISP,
            height:       CROP_DISP,
            borderRadius: "50%",
            border:       "2px solid rgba(255,255,255,0.8)",
            pointerEvents:"none",
            boxSizing:    "border-box",
          }} />
        </div>

        {/* Zoom slider */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span style={{ fontSize: "12px", color: "#64748B", flexShrink: 0 }}>−</span>
          <input
            type="range"
            min={minZoom}
            max={maxZoom}
            step={0.01}
            value={zoom}
            onChange={(e) => handleZoom(parseFloat(e.target.value))}
            style={{ flex: 1, accentColor: "#0F7B5F" }}
          />
          <span style={{ fontSize: "12px", color: "#64748B", flexShrink: 0 }}>+</span>
        </div>

        {error && (
          <div style={{ fontSize: "12px", color: "#B3261E", background: "#FFF0F0", padding: "8px 10px", borderRadius: "6px" }}>
            {error}
          </div>
        )}

        {/* Buttons */}
        <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
          <button
            onClick={onCancel}
            style={{
              padding: "8px 20px", borderRadius: "8px",
              border: "1px solid #EEF0F3", background: "#fff",
              cursor: "pointer", fontSize: "13px", fontWeight: 500, color: "#0F1720",
            }}
          >
            Cancel
          </button>
          <button
            onClick={apply}
            style={{
              padding: "8px 20px", borderRadius: "8px",
              border: "none", background: "#0F7B5F", color: "#fff",
              cursor: "pointer", fontSize: "13px", fontWeight: 600,
            }}
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
