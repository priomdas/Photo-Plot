import React, { useCallback, useEffect, useRef, useState } from "react";
import { renderAdjustedPhoto } from "../utils/imageEngine";
import * as api from "../api";

const MAX_CANVAS_DIM = 1600;

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("load failed"));
    };
    img.src = url;
  });
}

async function loadPhoto(file, preset, logo) {
  try {
    return await loadImage(file);
  } catch (err) {
    try {
      const blob = await api.previewUpload(file, preset, logo);
      return await loadImage(blob);
    } catch {
      throw err;
    }
  }
}

export function CanvasStage({ file, logo, preset, onUpdate }) {
  const canvasRef = useRef(null);
  const photoRef = useRef(null);
  const logoImgRef = useRef(null);
  const logoRectRef = useRef(null);
  const draggingLogo = useRef(false);
  const wrapRef = useRef(null);
  const roRef = useRef(null);

  const [ready, setReady] = useState(0);
  const [compare, setCompare] = useState(false);
  const [divider, setDivider] = useState(0.5);
  const [hoveringLogo, setHoveringLogo] = useState(false);
  const [containerSize, setContainerSize] = useState(null);

  // Zoom & Pan state
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef({ startX: 0, startY: 0, startPanX: 0, startPanY: 0 });

  // Maximize / Fullscreen preview state
  const [isMaximized, setIsMaximized] = useState(false);

  // Robust callback ref for container measurement — reliably fires on mount even if file is selected later
  const wrapCallbackRef = useCallback((el) => {
    if (roRef.current) {
      roRef.current.disconnect();
      roRef.current = null;
    }
    wrapRef.current = el;
    if (el) {
      const updateSize = () => {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          setContainerSize({
            w: Math.max(0, rect.width - 24),
            h: Math.max(0, rect.height - 24),
          });
        }
      };
      updateSize();
      const ro = new ResizeObserver(([entry]) => {
        if (entry && entry.contentRect && entry.contentRect.width > 0) {
          setContainerSize({
            w: Math.max(0, entry.contentRect.width),
            h: Math.max(0, entry.contentRect.height),
          });
        } else {
          updateSize();
        }
      });
      ro.observe(el);
      roRef.current = ro;
    }
  }, []);

  // Window resize fallback
  useEffect(() => {
    const handleResize = () => {
      const el = wrapRef.current;
      if (el) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          setContainerSize({
            w: Math.max(0, rect.width - 24),
            h: Math.max(0, rect.height - 24),
          });
        }
      }
    };
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      if (roRef.current) {
        roRef.current.disconnect();
        roRef.current = null;
      }
    };
  }, []);

  // Load the photo whenever the selection changes.
  useEffect(() => {
    let live = true;
    photoRef.current = null;
    setZoom(1);
    setPan({ x: 0, y: 0 });

    if (!file) {
      setReady((n) => n + 1);
      return;
    }
    let cleanup;
    loadPhoto(file, preset, logo)
      .then(({ img, url }) => {
        if (!live) return URL.revokeObjectURL(url);
        photoRef.current = img;
        cleanup = () => URL.revokeObjectURL(url);
        setReady((n) => n + 1);
      })
      .catch((err) => {
        console.error("Failed to load photo preview:", err);
        setReady((n) => n + 1);
      });
    return () => {
      live = false;
      cleanup?.();
    };
  }, [file]);

  // Load the logo whenever it changes.
  useEffect(() => {
    let live = true;
    logoImgRef.current = null;
    if (!logo) {
      setReady((n) => n + 1);
      return;
    }
    let cleanup;
    loadImage(logo)
      .then(({ img, url }) => {
        if (!live) return URL.revokeObjectURL(url);
        logoImgRef.current = img;
        cleanup = () => URL.revokeObjectURL(url);
        setReady((n) => n + 1);
      })
      .catch(() => setReady((n) => n + 1));
    return () => {
      live = false;
      cleanup?.();
    };
  }, [logo]);

  // Keyboard shortcut: 'F' toggles maximize, 'Escape' exits maximize
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.tagName === "SELECT") {
        return;
      }
      if (e.key.toLowerCase() === "f") {
        e.preventDefault();
        setIsMaximized((m) => !m);
      } else if (e.key === "Escape" && isMaximized) {
        e.preventDefault();
        setIsMaximized(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isMaximized]);



  const adj = preset.adjustments || {};

  // Redraw whenever inputs change
  useEffect(() => {
    const canvas = canvasRef.current;
    const photo = photoRef.current;
    if (!canvas || !photo) return;

    // Scale bounding both width AND height so full image fits cleanly and crisply
    const maxDim = Math.max(photo.naturalWidth, photo.naturalHeight);
    const scale = Math.min(1, MAX_CANVAS_DIM / maxDim);
    const w = Math.round(photo.naturalWidth * scale);
    const h = Math.round(photo.naturalHeight * scale);

    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }

    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, w, h);

    // 1. Render photo with exact Lightroom mathematical develop engine (WebGL / 2D fallback)
    const adjustedCanvas = renderAdjustedPhoto(
      photo,
      w,
      h,
      adj,
      preset.auto_enhance,
      preset.enhance_strength
    );
    ctx.drawImage(adjustedCanvas, 0, 0, w, h);

    // 2. Compare: reveal original unedited photo on left
    if (compare) {
      const cut = Math.round(w * divider);
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, cut, h);
      ctx.clip();
      ctx.drawImage(photo, 0, 0, w, h);
      ctx.restore();

      ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
      ctx.fillRect(cut - 1, 0, 2, h);
    }

    // 3. Logo / Watermark
    const logoImg = logoImgRef.current;
    if (logoImg) {
      const ratio = Math.max(0.01, Math.min(1.0, Number(preset.logo_width_ratio ?? 0.2)));
      const baseDim = Math.min(w, h);
      const targetW = baseDim * ratio;
      const logoScale = Math.min(
        targetW / logoImg.naturalWidth,
        (w * 0.95) / logoImg.naturalWidth,
        (h * 0.95) / logoImg.naturalHeight
      );
      const lw = Math.max(1, Math.round(logoImg.naturalWidth * logoScale));
      const lh = Math.max(1, Math.round(logoImg.naturalHeight * logoScale));

      const marginX = baseDim * Number(preset.offset_x ?? 0.03);
      const marginY = baseDim * Number(preset.offset_y ?? 0.03);
      let x = preset.logo_position_x == null ? marginX : Number(preset.logo_position_x) * w;
      let y = preset.logo_position_y == null ? marginY : Number(preset.logo_position_y) * h;
      const anchor = preset.anchor || "bottom-right";

      if (preset.logo_position_x == null && anchor.includes("right")) x = w - lw - marginX;
      if (preset.logo_position_x == null && anchor.includes("center")) x = (w - lw) / 2;
      if (preset.logo_position_y == null && anchor.includes("bottom")) y = h - lh - marginY;
      if (preset.logo_position_y == null && anchor === "center") y = (h - lh) / 2;

      x = Math.max(0, Math.min(w - lw, x));
      y = Math.max(0, Math.min(h - lh, y));
      logoRectRef.current = { x, y, width: lw, height: lh };

      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, Number(preset.logo_opacity ?? 100) / 100));
      ctx.drawImage(logoImg, x, y, lw, lh);
      ctx.restore();

      // Draw dashed outline when dragging or hovering
      if (draggingLogo.current || hoveringLogo) {
        ctx.save();
        ctx.strokeStyle = "rgba(109, 139, 255, 0.9)";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(x - 1, y - 1, lw + 2, lh + 2);
        ctx.restore();
      }
    } else {
      logoRectRef.current = null;
    }
  }, [
    ready,
    adj.exposure,
    adj.contrast,
    adj.highlights,
    adj.shadows,
    adj.whites,
    adj.blacks,
    adj.temperature,
    adj.tint,
    adj.vibrance,
    adj.saturation,
    adj.clarity,
    adj.dehaze,
    adj.vignette,
    adj.grain,
    adj.sharpness,
    compare,
    divider,
    preset.logo_width_ratio,
    preset.offset_x,
    preset.offset_y,
    preset.logo_opacity,
    preset.anchor,
    preset.logo_position_x,
    preset.logo_position_y,
    preset.auto_enhance,
    preset.enhance_strength,
    hoveringLogo,
  ]);

  // Zoom controls
  const zoomIn = () => setZoom((z) => Math.min(4, Math.round((z + 0.25) * 100) / 100));
  const zoomOut = () => setZoom((z) => Math.max(0.5, Math.round((z - 0.25) * 100) / 100));
  const resetZoom = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  // Pointer interactions for logo dragging and stage panning
  const onCanvasPointerDown = (e) => {
    if (compare) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = logoRectRef.current;
    const bounds = canvas.getBoundingClientRect();
    const x = ((e.clientX - bounds.left) * canvas.width) / bounds.width;
    const y = ((e.clientY - bounds.top) * canvas.height) / bounds.height;

    // Check if clicked inside logo
    if (rect && x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height) {
      draggingLogo.current = true;
      setHoveringLogo(true);
      canvas.setPointerCapture(e.pointerId);
      return;
    }

    // If zoomed in, initiate pan dragging
    if (zoom > 1) {
      setIsPanning(true);
      panStartRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        startPanX: pan.x,
        startPanY: pan.y,
      };
      canvas.setPointerCapture(e.pointerId);
    }
  };

  const onCanvasPointerMove = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = logoRectRef.current;
    const bounds = canvas.getBoundingClientRect();
    const curX = ((e.clientX - bounds.left) * canvas.width) / bounds.width;
    const curY = ((e.clientY - bounds.top) * canvas.height) / bounds.height;

    // Update hover state
    if (rect) {
      const isInside = curX >= rect.x && curX <= rect.x + rect.width && curY >= rect.y && curY <= rect.y + rect.height;
      if (!draggingLogo.current && !isPanning && isInside !== hoveringLogo) {
        setHoveringLogo(isInside);
      }
    }

    // Logo drag
    if (draggingLogo.current && rect) {
      const x = curX - rect.width / 2;
      const y = curY - rect.height / 2;
      const clampedX = Math.max(0, Math.min(canvas.width - rect.width, x));
      const clampedY = Math.max(0, Math.min(canvas.height - rect.height, y));
      onUpdate("logo_position_x", clampedX / canvas.width);
      onUpdate("logo_position_y", clampedY / canvas.height);
      return;
    }

    // Stage pan drag
    if (isPanning) {
      const dx = e.clientX - panStartRef.current.startX;
      const dy = e.clientY - panStartRef.current.startY;
      setPan({
        x: panStartRef.current.startPanX + dx,
        y: panStartRef.current.startPanY + dy,
      });
    }
  };

  const endDrag = (e) => {
    if (draggingLogo.current) {
      draggingLogo.current = false;
      canvasRef.current?.releasePointerCapture(e.pointerId);
      setHoveringLogo(false);
    }
    if (isPanning) {
      setIsPanning(false);
      canvasRef.current?.releasePointerCapture(e.pointerId);
    }
  };

  // Mouse wheel: resize logo if over logo, otherwise zoom in/out
  const onWrapWheel = (e) => {
    if (compare) return;
    if (hoveringLogo && logoImgRef.current && logoRectRef.current) {
      e.preventDefault();
      const currentRatio = Number(preset.logo_width_ratio ?? 0.2);
      const delta = e.deltaY < 0 ? 0.02 : -0.02;
      const nextRatio = Math.max(0.02, Math.min(0.9, parseFloat((currentRatio + delta).toFixed(2))));
      onUpdate("logo_width_ratio", nextRatio);
      return;
    }

    // Canvas zoom with wheel
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 0.85;
    setZoom((prevZoom) => {
      const nextZoom = Math.max(0.5, Math.min(4.0, Math.round(prevZoom * factor * 100) / 100));
      if (nextZoom === 1) {
        setPan({ x: 0, y: 0 });
      }
      return nextZoom;
    });
  };

  // Double click canvas to toggle zoom
  const onCanvasDoubleClick = (e) => {
    if (compare) return;
    if (hoveringLogo) return;
    if (zoom > 1) {
      resetZoom();
    } else {
      setZoom(2);
    }
  };

  const startDividerDrag = useCallback((e) => {
    const box = e.currentTarget.parentElement;
    const move = (ev) => {
      const b = box.getBoundingClientRect();
      setDivider(Math.max(0.01, Math.min(0.99, (ev.clientX - b.left) / b.width)));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }, []);

  // Compute fitted display size based on actual container measurement
  const photo = photoRef.current;
  let fitW = 0, fitH = 0;
  if (photo && containerSize && containerSize.w > 0 && containerSize.h > 0) {
    const fitScale = Math.min(
      containerSize.w / photo.naturalWidth,
      containerSize.h / photo.naturalHeight
    );
    fitW = Math.round(photo.naturalWidth * fitScale);
    fitH = Math.round(photo.naturalHeight * fitScale);
  }

  const boxStyle = fitW > 0 && fitH > 0
    ? { width: fitW, height: fitH }
    : photo
    ? {
        maxWidth: "100%",
        maxHeight: "100%",
        aspectRatio: `${photo.naturalWidth} / ${photo.naturalHeight}`,
      }
    : {};

  if (!file) {
    return (
      <div className="stage stage--empty">
        <div className="stage__placeholder">
          <div className="stage__placeholder-icon">🖼</div>
          <p>Select a photo to start editing</p>
        </div>
      </div>
    );
  }

  const canvasCursor = hoveringLogo
    ? "grab"
    : draggingLogo.current
    ? "grabbing"
    : zoom > 1
    ? isPanning
      ? "grabbing"
      : "grab"
    : "default";

  return (
    <div className={`stage ${isMaximized ? "stage--maximized" : ""}`}>
      <div className="stage__toolbar">
        <button
          className={`btn btn--ghost btn--sm ${compare ? "btn--active" : ""}`}
          onClick={() => setCompare((c) => !c)}
          title="Compare original vs edited"
        >
          {compare ? "Exit compare" : "Before / After"}
        </button>

        <span className="stage__info">
          {photoRef.current ? `${photoRef.current.naturalWidth} × ${photoRef.current.naturalHeight}` : file ? "Loading photo…" : "Photo"}
        </span>

        {/* Zoom Controls */}
        <div className="stage__zoom-controls">
          <button
            className="icon-btn-stage"
            onClick={zoomOut}
            disabled={zoom <= 0.5}
            title="Zoom out"
          >
            −
          </button>
          <button
            className="stage__zoom-badge"
            onClick={resetZoom}
            title="Click to reset zoom (Fit)"
          >
            {zoom === 1 ? "Fit" : `${Math.round(zoom * 100)}%`}
          </button>
          <button
            className="icon-btn-stage"
            onClick={zoomIn}
            disabled={zoom >= 4.0}
            title="Zoom in"
          >
            +
          </button>
          {zoom !== 1 && (
            <button className="btn btn--ghost btn--sm stage__btn-fit" onClick={resetZoom} title="Fit to view">
              Reset
            </button>
          )}
        </div>

        {/* Maximize / Fullscreen Preview Toggle */}
        <button
          className={`btn btn--ghost btn--sm stage__btn-maximize ${isMaximized ? "btn--active" : ""}`}
          onClick={() => {
            setIsMaximized((m) => !m);
            setZoom(1);
            setPan({ x: 0, y: 0 });
          }}
          title={isMaximized ? "Exit large preview (Esc or F)" : "Expand preview to fullscreen (F)"}
        >
          {isMaximized ? "⤓ Exit Fullscreen" : "⛶ Maximize"}
        </button>

        {logo && !compare && (
          <span className="stage__hint">
            Drag logo to move · Wheel on logo to resize ({Math.round((preset.logo_width_ratio ?? 0.2) * 100)}%)
          </span>
        )}
      </div>

      <div className="stage__canvas-wrap" ref={wrapCallbackRef} onWheel={onWrapWheel}>
        <div
          className="stage__canvas-viewport"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: "center center",
            transition: isPanning ? "none" : "transform 0.15s cubic-bezier(0.2, 0, 0, 1)",
          }}
        >
          {photo ? (
            <div className="stage__canvas-box" style={boxStyle}>
              <canvas
                ref={canvasRef}
                style={{ cursor: canvasCursor }}
                className="stage__canvas"
                onPointerDown={onCanvasPointerDown}
                onPointerMove={onCanvasPointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                onDoubleClick={onCanvasDoubleClick}
              />
              {compare && (
                <div className="stage__divider" style={{ left: `${divider * 100}%` }} onPointerDown={startDividerDrag}>
                  <span className="stage__divider-knob">⇔</span>
                </div>
              )}
            </div>
          ) : (
            <div className="stage__placeholder">
              <div className="stage__placeholder-icon">⏳</div>
              <p>Loading preview…</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
