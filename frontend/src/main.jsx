import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

const initial = { name: "default", max_width: 2400, max_height: 2400, quality: 90, format: "JPEG", anchor: "bottom-right", offset_x: .03, offset_y: .03, logo_opacity: 100 };
function App() {
  const [files, setFiles] = useState([]), [logo, setLogo] = useState(null), [reference, setReference] = useState(null), [preset, setPreset] = useState(initial);
  const [job, setJob] = useState(null), [gpu, setGpu] = useState(null), [message, setMessage] = useState(""), [previewUrl, setPreviewUrl] = useState(""), [previewZoom, setPreviewZoom] = useState(1);
  const liveCanvas = useRef(null);
  const dragState = useRef(null);
  useEffect(() => { fetch("/api/gpu").then(r => r.json()).then(setGpu).catch(() => setGpu({ message: "Backend offline" })); }, []);
  const update = (key, value) => setPreset(p => ({ ...p, [key]: value }));
  useEffect(() => {
    const canvas = liveCanvas.current;
    const photo = files[0];
    if (!canvas || !photo) return;
    const image = new Image();
    const logoImage = logo ? new Image() : null;
    const photoUrl = URL.createObjectURL(photo);
    const logoUrl = logo ? URL.createObjectURL(logo) : "";
    image.onload = () => {
      const maxWidth = 900;
      const scale = Math.min(1, maxWidth / image.naturalWidth);
      canvas.width = Math.round(image.naturalWidth * scale);
      canvas.height = Math.round(image.naturalHeight * scale);
      const context = canvas.getContext("2d");
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      if (logoImage) {
        logoImage.onload = () => {
          const ratio = Math.max(0.01, Math.min(1, Number(preset.logo_width_ratio ?? 0.2)));
          const logoWidth = canvas.width * ratio;
          const logoHeight = logoWidth * logoImage.naturalHeight / logoImage.naturalWidth;
          const marginX = canvas.width * Number(preset.offset_x ?? 0.03);
          const marginY = canvas.height * Number(preset.offset_y ?? 0.03);
          let x = preset.logo_position_x == null ? marginX : Number(preset.logo_position_x) * canvas.width;
          let y = preset.logo_position_y == null ? marginY : Number(preset.logo_position_y) * canvas.height;
          if (preset.logo_position_x == null && preset.anchor.includes("right")) x = canvas.width - logoWidth - marginX;
          if (preset.logo_position_x == null && preset.anchor.includes("center")) x = (canvas.width - logoWidth) / 2;
          if (preset.logo_position_y == null && preset.anchor.includes("bottom")) y = canvas.height - logoHeight - marginY;
          if (preset.logo_position_y == null && preset.anchor === "center") y = (canvas.height - logoHeight) / 2;
          x = Math.max(0, Math.min(canvas.width - logoWidth, x));
          y = Math.max(0, Math.min(canvas.height - logoHeight, y));
          dragState.current = { x, y, width: logoWidth, height: logoHeight };
          context.globalAlpha = Math.max(0, Math.min(1, Number(preset.logo_opacity ?? 100) / 100));
          context.drawImage(logoImage, Math.max(0, x), Math.max(0, y), logoWidth, logoHeight);
          context.globalAlpha = 1;
        };
        logoImage.src = logoUrl;
      }
    };
    image.src = photoUrl;
    return () => {
      URL.revokeObjectURL(photoUrl);
      if (logoUrl) URL.revokeObjectURL(logoUrl);
    };
  }, [files, logo, preset.logo_width_ratio, preset.offset_x, preset.offset_y, preset.logo_opacity, preset.anchor, preset.logo_position_x, preset.logo_position_y]);
  function moveLogo(event) {
    const canvas = liveCanvas.current;
    const drag = dragState.current;
    if (!canvas || !drag) return;
    const bounds = canvas.getBoundingClientRect();
    const x = (event.clientX - bounds.left) * canvas.width / bounds.width - drag.width / 2;
    const y = (event.clientY - bounds.top) * canvas.height / bounds.height - drag.height / 2;
    update("logo_position_x", Math.max(0, Math.min(1 - drag.width / canvas.width, x / canvas.width)));
    update("logo_position_y", Math.max(0, Math.min(1 - drag.height / canvas.height, y / canvas.height)));
  }
  async function preview() {
    if (!files.length) return setMessage("Choose a sample image first.");
    const data = new FormData(); data.append("file", files[0]); if (logo) data.append("logo", logo); if (reference) data.append("reference", reference); data.append("preset_json", JSON.stringify(preset));
    const response = await fetch("/api/preview-upload", { method: "POST", body: data });
    if (!response.ok) return setMessage("Could not create preview.");
    setPreviewUrl(URL.createObjectURL(await response.blob())); setMessage("Preview ready.");
  }
  async function process() {
    if (!files.length) return setMessage("Choose at least one image.");
    const data = new FormData(); files.forEach(f => data.append("files", f)); if (logo) data.append("logo", logo); if (reference) data.append("reference", reference); data.append("preset_json", JSON.stringify(preset));
    setMessage("Processing…"); const response = await fetch("/api/process", { method: "POST", body: data });
    if (!response.ok) return setMessage("Could not start processing.");
    const { job_id } = await response.json(); const timer = setInterval(async () => { const progress = await (await fetch(`/api/progress/${job_id}`)).json(); setJob(progress); if (progress.status === "complete") { clearInterval(timer); setMessage("Finished. Errors are isolated per file."); } }, 250);
  }
  return <main><header><div><h1>PhotoPilot</h1><p>Local photo processing, no cloud required.</p></div><span className={gpu?.available ? "gpu on" : "gpu"}>GPU: {gpu?.available ? gpu.device : "CPU"}</span></header>
    <section className="card"><h2>1. Select photos</h2><input type="file" accept=".jpg,.jpeg,.png,.webp,.heic,.heif,.dng,image/jpeg,image/png,image/webp,image/heic,image/heif,image/x-adobe-dng" multiple onChange={e => setFiles([...e.target.files])}/>{files.length > 0 && <p>{files.length} file(s) selected</p>}<label>Optional logo <input type="file" accept=".png,.jpg,.jpeg,.webp,.heic,.heif,image/png,image/jpeg,image/webp,image/heic,image/heif" onChange={e => setLogo(e.target.files[0])}/></label><label>Reference style image <input type="file" accept=".jpg,.jpeg,.png,.webp,.heic,.heif,.dng,image/jpeg,image/png,image/webp,image/heic,image/heif,image/x-adobe-dng" onChange={e => setReference(e.target.files[0] || null)}/></label>{reference && <p>{reference.name} — color style will be matched</p>}</section>
    <section className="card"><h2>2. Preset</h2><div className="grid">{[["max_width","Max width"],["max_height","Max height"],["quality","Quality"],["offset_x","Horizontal margin"],["offset_y","Vertical margin"],["logo_opacity","Logo opacity %"]].map(([k, label]) => <label key={k}>{label}<input type="number" value={preset[k]} onChange={e => update(k, Number(e.target.value))}/></label>)}<label>Logo size: {Math.round((preset.logo_width_ratio ?? .2) * 100)}%<input type="range" min="1" max="60" step="1" value={Math.round((preset.logo_width_ratio ?? .2) * 100)} onChange={e => update("logo_width_ratio", Number(e.target.value) / 100)}/></label>{["brightness","contrast","saturation","sharpness"].map(k => <label key={k}>{k[0].toUpperCase() + k.slice(1)}<input type="number" step="0.05" value={preset.adjustments?.[k] ?? 1} onChange={e => update("adjustments", {...preset.adjustments, [k]: Number(e.target.value)})}/></label>)}<label>Format<select value={preset.format} onChange={e => update("format", e.target.value)}><option>JPEG</option><option>PNG</option><option>WEBP</option></select></label><label>Anchor<select value={preset.anchor} onChange={e => update("anchor", e.target.value)}><option>bottom-right</option><option>bottom-left</option><option>top-right</option><option>top-left</option><option>center</option></select></label></div></section>
    {files.length > 0 && <section className="card"><h2>Live logo placement</h2><p className="hint">Logo-র ওপর mouse চেপে ধরে টেনে আপনার পছন্দের জায়গায় রাখুন।</p><canvas ref={liveCanvas} className="live-canvas" onPointerDown={e => { const canvas = e.currentTarget, drag = dragState.current, bounds = canvas.getBoundingClientRect(); if (!drag) return; const x = (e.clientX - bounds.left) * canvas.width / bounds.width, y = (e.clientY - bounds.top) * canvas.height / bounds.height; if (x >= drag.x && x <= drag.x + drag.width && y >= drag.y && y <= drag.y + drag.height) { canvas.setPointerCapture(e.pointerId); } }} onPointerMove={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) moveLogo(e); }} onPointerUp={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }}/></section>}
    <button className="secondary" onClick={preview}>Preview first image</button><button onClick={process}>Process photos</button>{previewUrl && <section className="preview-card"><label>Preview zoom: {Math.round(previewZoom * 100)}%<input type="range" min="0.5" max="2.5" step="0.1" value={previewZoom} onChange={e => setPreviewZoom(Number(e.target.value))}/></label><div className="preview-frame"><img className="preview" style={{transform: `scale(${previewZoom})`}} src={previewUrl} alt="Processed preview"/></div><a href={previewUrl} target="_blank" rel="noreferrer">Open preview at full size</a></section>}{message && <p className="message">{message}</p>}{job && <section className="card"><h2>Progress {job.completed}/{job.total}</h2><progress value={job.completed} max={job.total}/>{job.files?.map(f => <a key={f.url} href={f.url} target="_blank">{f.name} preview</a>)}{job.errors?.map(e => <p className="error" key={e.name}>{e.name}: {e.error}</p>)}</section>}<button className="secondary" onClick={() => fetch("/api/open-folder", { method: "POST" })}>Open processed folder</button></main>;
}
createRoot(document.getElementById("root")).render(<App />);
