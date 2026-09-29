# PhotoPilot MVP

PhotoPilot is a beginner-friendly, local-only React + FastAPI photo processor. It applies EXIF orientation correction, optional resizing, reference-image color matching, JPEG/PNG/WebP output, and a logo positioned using relative anchor offsets. Every file is isolated so one bad image does not stop a batch.

## Windows setup

1. Install Python 3.10+ and Node.js 18+.
2. In PowerShell:

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
cd frontend
npm install
```

## Run

The easiest option on Windows is to double-click `start_photopilot.bat`. It opens the backend, frontend, and browser automatically. Keep the two opened terminal windows running while using PhotoPilot; close them when finished.

Use two PowerShell windows from `E:\Photo project`:

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --reload
cd frontend
npm run dev
```

Open http://localhost:5173. Processed files are written to `processed/`, logs to `logs/`, and presets to `presets/`. The API also exposes `/api/progress/{job_id}`, previews, GPU detection (`torch` is optional), and a Windows-only open-folder endpoint.

## Checks

```powershell
python -m compileall backend
cd frontend
npm run build
```

Optional GPU status: install a matching PyTorch build (`pip install torch`) if your machine supports it. PhotoPilot remains functional on CPU and does not call cloud APIs.

## Reference style image

In the UI, choose one **Reference style image** before processing. PhotoPilot matches the reference image's overall brightness, contrast distribution, and color balance in LAB color space. This is a lightweight local color-transfer effect, not a full cinematic LUT or AI style-transfer model; it preserves each target photo's composition and details.

## RAW and DNG support

PhotoPilot can decode many camera RAW files, including DNG, CR3/CRX, and other formats supported by `rawpy`/LibRaw. RAW files are developed locally to an RGB image first, then the preset adjustments, reference color transfer, and logo are applied. The current MVP exports JPEG, PNG, or WEBP; it does not write edited DNG files or Lightroom-compatible XMP sidecars.

This is not a Lightroom replacement yet. It does not currently provide camera-profile selection, lens corrections, highlight/shadow recovery controls, demosaicing controls, masks, brushes, catalogs, non-destructive edit history, or RAW-preserving export. For best results, use the camera's original DNG/RAW and choose a suitable reference image.
