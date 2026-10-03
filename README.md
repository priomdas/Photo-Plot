# PhotoPilot

PhotoPilot is a local React + FastAPI photo studio for batch editing, RAW/DNG preset workflows, AI-assisted photo curation, and Facebook Page post composition.

## Features

- Batch photo processing with resizing, quality controls, JPEG/PNG/WebP export, EXIF orientation correction, and logo/watermark placement.
- Lightroom-style adjustments including exposure, contrast, highlights, shadows, color, clarity, dehaze, vignette, grain, and sharpness.
- Preset save/load plus Lightroom DNG/XMP/JSON preset import.
- CPU/GPU device selection with automatic hardware detection.
- Undo/redo for editing changes.
- AI curation for duplicate detection, similar-scene grouping, quality ranking, face/blur/exposure analysis, and “Select Best N”.
- Folder curation through the in-app **Browse Folder** picker, or direct browser file upload.
- Facebook Post Composer with captions, hashtags, saved hashtag sets, drafts, multiple Page connections, multi-Page publishing, scheduling, publishing history, and upload progress/ETA.
- Caption AI settings with offline generation plus optional text-only Gemini or OpenAI-compatible providers, connection testing, and local API-key storage.

All image processing runs locally. Facebook publishing is the only feature that sends data to Facebook's Graph API.

## PC requirements

PhotoPilot is designed for **Windows 10 or Windows 11 (64-bit)**.

Required:

- Python **3.10 or newer** (64-bit; Python 3.13 is supported).
- Node.js **18 or newer** (npm is included with Node.js).
- A modern web browser such as Chrome, Edge, or Firefox.
- At least **8 GB RAM** recommended; more is helpful when processing many RAW photos.
- Enough free disk space for the original photos, the virtual environment, `node_modules`, and generated files in `processed/`.
- Internet access only for the initial package installation and Facebook Graph API publishing. Photo processing and curation run locally.

Optional:

- Git, only if you are cloning or updating the project from GitHub.
- An NVIDIA/CUDA-compatible GPU and a matching PyTorch installation. CPU mode works without a GPU.
- A Facebook Page and valid Page/User Access Token, only if Facebook publishing is needed.

## Windows setup

1. Install the required software listed above.
2. In PowerShell, from the project folder:

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
cd frontend
npm install
```

## Run

The easiest option on Windows is to double-click `start_photopilot.bat`. It opens the backend, frontend, and browser automatically. Keep the two opened terminal windows running while using PhotoPilot; close them when finished.

Use two PowerShell windows from the project folder:

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --reload
cd frontend
npm run dev
```

Open http://localhost:5173. Processed files are written to `processed/`, logs to `logs/`, and presets to `presets/`. The API also exposes `/api/progress/{job_id}`, previews, GPU detection (`torch` is optional), and a Windows-only open-folder endpoint.

## Using the main features

### Process photos

1. Add photos from the left upload tray.
2. Choose adjustments, output settings, and an optional logo.
3. Click **Process photos**.
4. When processing finishes, click **Open processed photos in Post Composer** to use the outputs directly without adding them again.

### Curate a folder

1. Click **AI Curate**.
2. Click **Browse Folder** and select a folder.
3. Photo previews appear while analysis runs.
4. Review groups, recommendations, and unique photos.
5. Select photos and apply them to the workspace.

### Publish to Facebook

1. Open **Post Composer**.
2. Add processed photos or upload photos directly.
3. Connect a Facebook Page using a valid Page Access Token or User Access Token.
4. Write/generate a caption and hashtags.
5. Choose **Publish Now**, **Schedule**, or **Save Draft**.
6. Select one or more connected Pages. During publishing, the composer shows total Page/photo progress, percentage, and estimated remaining time.

Facebook tokens are stored only in the local ignored database. A new computer must connect its Facebook Page again.

### Caption AI providers

Open **Post Composer → AI settings** to choose the offline generator, local vision model, or an online text-only provider. Online mode supports Google Gemini and OpenAI-compatible endpoints. Enter the model, API key, and endpoint, then click **Test connection** and **Save locally**. The key is stored in the ignored `logs/caption_ai.json` file and is never sent to the frontend or committed to GitHub. Online mode uses the written context/prompt; it does not upload the selected photo.

## Checks

```powershell
python -m compileall backend
cd frontend
npm run build
```

Optional GPU status: install a matching PyTorch build (`pip install torch`) if your machine supports it. PhotoPilot remains functional on CPU and does not call cloud APIs.

## Local data and GitHub

Generated jobs, processed images, logs, SQLite databases, and sample image folders are intentionally ignored by Git. Do not commit Facebook tokens, personal photos, or local databases. Copy `.env.example` only if environment configuration is added in the future.

## Reference style image

In the UI, choose one **Reference style image** before processing. PhotoPilot matches the reference image's overall brightness, contrast distribution, and color balance in LAB color space. This is a lightweight local color-transfer effect, not a full cinematic LUT or AI style-transfer model; it preserves each target photo's composition and details.

## RAW and DNG support

PhotoPilot can decode many camera RAW files, including DNG, CR3/CRX, and other formats supported by `rawpy`/LibRaw. RAW files are developed locally to an RGB image first, then the preset adjustments, reference color transfer, and logo are applied. The current MVP exports JPEG, PNG, or WEBP; it does not write edited DNG files or Lightroom-compatible XMP sidecars.

This is not a Lightroom replacement yet. It does not currently provide camera-profile selection, lens corrections, highlight/shadow recovery controls, demosaicing controls, masks, brushes, catalogs, non-destructive edit history, or RAW-preserving export. For best results, use the camera's original DNG/RAW and choose a suitable reference image.
