import React, { useCallback, useEffect, useRef, useState } from "react";
import * as api from "./api";
import { useToasts } from "./hooks/useToasts";
import { Toasts } from "./components/Toasts";
import { UploadTray } from "./components/UploadTray";
import { CanvasStage } from "./components/CanvasStage";
import { ControlPanel } from "./components/ControlPanel";
import { CurationModal } from "./components/CurationModal";
import { PostComposer } from "./components/PostComposer";
import { VideoStudio } from "./components/video/VideoStudio";
import { Icon } from "./components/Icon";

const INITIAL_PRESET = {
  name: "default",
  max_width: 2400,
  max_height: 2400,
  quality: 90,
  format: "JPEG",
  anchor: "bottom-right",
  offset_x: 0.03,
  offset_y: 0.03,
  logo_opacity: 100,
  logo_width_ratio: 0.2,
  logo_position_x: null,
  logo_position_y: null,
  auto_enhance: false,
  enhance_strength: 70,
  adjustments: {
    exposure: 0,
    contrast: 0,
    highlights: 0,
    shadows: 0,
    whites: 0,
    blacks: 0,
    temperature: 0,
    tint: 0,
    vibrance: 0,
    saturation: 0,
    clarity: 0,
    dehaze: 0,
    vignette: 0,
    grain: 0,
    sharpness: 25,
  },
};

export default function App() {
  const [files, setFiles] = useState([]);
  const [selected, setSelected] = useState(0);
  const [logo, setLogo] = useState(null);
  const [filePresets, setFilePresets] = useState([]);
  const [presets, setPresets] = useState([]);
  const [gpu, setGpu] = useState(null);
  const [deviceMode, setDeviceMode] = useState(() => localStorage.getItem("pp-device-mode") || "auto");
  const [job, setJob] = useState(null);
  const [processedPhotos, setProcessedPhotos] = useState([]);
  const [busy, setBusy] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem("pp-theme") || "dark");
  const [curationOpen, setCurationOpen] = useState(false);
  const [appMode, setAppMode] = useState("photos"); // photos | videos
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerTab, setComposerTab] = useState("compose");
  const [composerVideo, setComposerVideo] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const toasts = useToasts();
  const pollRef = useRef(null);

  // Undo / Redo history state
  const [history, setHistory] = useState([[]]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const historyTimerRef = useRef(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("pp-theme", theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem("pp-device-mode", deviceMode);
  }, [deviceMode]);

  useEffect(() => {
    api.getGpu()
      .then((info) => {
        setGpu(info);
      })
      .catch(() => setGpu({ available: false, message: "Backend offline" }));

    api.listPresets().then(setPresets).catch(() => {});
    return () => clearInterval(pollRef.current);
  }, []);

  // Push new state to history (debounced for continuous slider/drag interactions)
  const pushHistory = useCallback((nextFilePresets, immediate = false) => {
    if (immediate) {
      clearTimeout(historyTimerRef.current);
      setHistory((prev) => {
        const truncated = prev.slice(0, historyIndex + 1);
        return [...truncated, nextFilePresets];
      });
      setHistoryIndex((prev) => prev + 1);
    } else {
      clearTimeout(historyTimerRef.current);
      historyTimerRef.current = setTimeout(() => {
        setHistory((prev) => {
          const truncated = prev.slice(0, historyIndex + 1);
          return [...truncated, nextFilePresets];
        });
        setHistoryIndex((prev) => prev + 1);
      }, 350);
    }
  }, [historyIndex]);

const LOGO_AND_GLOBAL_KEYS = new Set([
  "logo_width_ratio",
  "logo_opacity",
  "anchor",
  "offset_x",
  "offset_y",
  "logo_position_x",
  "logo_position_y",
  "auto_enhance",
  "enhance_strength",
  "format",
  "quality",
  "max_width",
  "max_height",
]);

  const update = (key, value) => {
    setFilePresets((prev) => {
      if (!prev.length) return prev;
      const isGlobal = LOGO_AND_GLOBAL_KEYS.has(key);
      const next = prev.map((item, idx) => {
        if (isGlobal || idx === selected) {
          return { ...item, [key]: value };
        }
        return item;
      });
      pushHistory(next, false);
      return next;
    });
  };

  const adjust = (key, value) => {
    setFilePresets((prev) => {
      if (!prev.length) return prev;
      const next = [...prev];
      next[selected] = { ...next[selected], adjustments: { ...next[selected].adjustments, [key]: value } };
      pushHistory(next, false);
      return next;
    });
  };

  const applyAdjustmentGroupToAll = (keys) => {
    setFilePresets((prev) => {
      if (!prev.length || !prev[selected]) return prev;
      const source = prev[selected].adjustments || {};
      const next = prev.map((item) => ({
        ...item,
        adjustments: {
          ...(item.adjustments || {}),
          ...Object.fromEntries(keys.map((key) => [key, source[key]])),
        },
      }));
      pushHistory(next, true);
      return next;
    });
    toasts.success("Adjustment group applied to all photos");
  };

  // Undo action
  const undo = useCallback(() => {
    if (historyIndex > 0) {
      const newIdx = historyIndex - 1;
      setHistoryIndex(newIdx);
      setFilePresets(history[newIdx]);
      toasts.info("Undid last change");
    }
  }, [historyIndex, history, toasts]);

  // Redo action
  const redo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      const newIdx = historyIndex + 1;
      setHistoryIndex(newIdx);
      setFilePresets(history[newIdx]);
      toasts.info("Redid change");
    }
  }, [historyIndex, history, toasts]);

  // Global keyboard shortcuts for Undo (Ctrl+Z) and Redo (Ctrl+Y, Ctrl+Shift+Z)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        if (e.shiftKey) {
          e.preventDefault();
          redo();
        } else {
          e.preventDefault();
          undo();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [undo, redo]);

  const addFiles = (incoming) => {
    setFiles((prev) => [...prev, ...incoming]);
    setFilePresets((prev) => {
      const newPresets = incoming.map(() => prev.length > 0 ? { ...prev[selected] } : { ...INITIAL_PRESET });
      const nextFilePresets = [...prev, ...newPresets];
      pushHistory(nextFilePresets, true);
      return nextFilePresets;
    });
  };

  const removeFile = (index) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
    setFilePresets((prev) => prev.filter((_, i) => i !== index));
    setSelected((s) => (index < s ? s - 1 : Math.min(s, files.length - 2)));
  };

  // Instant preset loading
  const handleLoadPreset = (p) => {
    setFilePresets((prev) => {
      const active = prev[selected] || prev[0];
      const logoSettings = active ? {
        logo_width_ratio: active.logo_width_ratio,
        logo_opacity: active.logo_opacity,
        anchor: active.anchor,
        offset_x: active.offset_x,
        offset_y: active.offset_y,
        logo_position_x: active.logo_position_x,
        logo_position_y: active.logo_position_y,
        auto_enhance: active.auto_enhance,
        enhance_strength: active.enhance_strength,
      } : {};
      const nextPreset = {
        ...INITIAL_PRESET,
        ...logoSettings,
        ...p,
        adjustments: {
          ...INITIAL_PRESET.adjustments,
          ...(p.adjustments || {}),
        },
      };
      const next = prev.map(() => nextPreset);
      pushHistory(next, true);
      return next;
    });
    toasts.success(`Preset "${p.name}" applied`);
  };

  // Import DNG / XMP / JSON preset
  const handleImportPreset = async (file) => {
    try {
      toasts.info(`Importing "${file.name}"…`);
      const imported = await api.importPreset(file);
      const list = await api.listPresets();
      setPresets(list);
      handleLoadPreset(imported);
      toasts.success(`Imported & applied preset "${imported.name}"!`);
    } catch (err) {
      toasts.error(`Preset import failed: ${err.message}`);
    }
  };

  async function process() {
    if (!files.length) return toasts.error("Add at least one photo.");
    setBusy(true);
    setJob(null);
    try {
      const { job_id } = await api.startProcess(files, filePresets, logo, deviceMode);
      toasts.info(`Processing ${files.length} photo${files.length > 1 ? "s" : ""}…`);
      pollRef.current = setInterval(async () => {
        try {
          const progress = await api.getProgress(job_id);
          setJob(progress);
          if (progress.status === "complete") {
            clearInterval(pollRef.current);
            setBusy(false);
            setProcessedPhotos(progress.files || []);
            const failed = progress.errors?.length || 0;
            if (failed) toasts.error(`Done with ${failed} error${failed > 1 ? "s" : ""}.`);
            else toasts.success(`All photos processed! ${progress.device_used ? `[${progress.device_used}]` : ""}`);
          }
        } catch {
          clearInterval(pollRef.current);
          setBusy(false);
          toasts.error("Lost contact with the job.");
        }
      }, 300);
    } catch (e) {
      setBusy(false);
      toasts.error(e.message);
    }
  }

  async function saveThePreset(p) {
    try {
      await api.savePreset(p);
      setPresets(await api.listPresets());
      toasts.success(`Saved preset "${p.name}".`);
    } catch (e) {
      toasts.error(e.message);
    }
  }

  async function deleteThePreset(name) {
    try {
      await api.deletePreset(name);
      setPresets(await api.listPresets());
      toasts.info(`Deleted preset "${name}".`);
    } catch (e) {
      toasts.error(e.message);
    }
  }

  const isGpuActive = deviceMode === "gpu" || (deviceMode === "auto" && gpu?.available);
  const currentPreset = filePresets[selected] || INITIAL_PRESET;
  const openComposer = (tab = "compose", videoData = null) => {
    setComposerTab(tab);
    if (videoData) {
      setComposerVideo(videoData);
    }
    setComposerOpen(true);
    setSettingsOpen(false);
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand__mark"><Icon name="brand" size={19} /></span>
          <div>
            <h1 className="brand__name">PhotoPilot</h1>
            <p className="brand__tag">Lightroom-grade photo studio · local & fast</p>
          </div>
        </div>

        {/* Studio Mode Switcher (Photos vs Videos & Reels) */}
        <div className="topbar__mode-switch">
          <button
            className={`topbar__mode-tab ${appMode === "photos" ? "topbar__mode-tab--active" : ""}`}
            onClick={() => setAppMode("photos")}
            title="Batch photo editing, raw presets & watermark"
          >
            <span>📷</span>
            <span>Photos Studio</span>
          </button>
          <button
            className={`topbar__mode-tab ${appMode === "videos" ? "topbar__mode-tab--active" : ""}`}
            onClick={() => setAppMode("videos")}
            title="CapCut-style video trimmer, merger, filters, audio mixer & Facebook Reels"
          >
            <span>🎬</span>
            <span>Videos & Reels</span>
          </button>
        </div>

        <div className="topbar__actions">
          {/* Hardware acceleration / GPU & CPU Selector */}
          <div className={`device-select-wrapper ${isGpuActive ? "device-select-wrapper--gpu" : ""}`}>
            <span className="device-select__icon">{isGpuActive ? "GPU" : "CPU"}</span>
            <select
              className="device-select"
              value={deviceMode}
              onChange={(e) => setDeviceMode(e.target.value)}
              title={gpu?.details || "Hardware device preference"}
            >
              <option value="auto">
                Auto {gpu?.available ? `(GPU: ${gpu.device})` : "(CPU)"}
              </option>
              <option value="gpu" disabled={!gpu?.available}>
                GPU {gpu?.available ? `(${gpu.device})` : "(Not Available)"}
              </option>
              <option value="cpu">CPU (Standard)</option>
            </select>
          </div>

          {/* AI Curation & Duplicate Detector */}
          <button
            className="btn btn--primary btn--sm"
            onClick={() => setCurationOpen(true)}
            title="AI Photo Curation: Detect duplicates, find best shots, and cluster similar photos"
            style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
          >
            <Icon name="sparkle" size={15} />
            <span>AI Curate</span>
          </button>

          {/* Post Composer */}
          <button
            className="btn btn--primary btn--sm"
            onClick={() => openComposer()}
            title="Post Composer: Create captions, hashtags & publish to Facebook Pages"
            style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
          >
            <Icon name="edit" size={15} />
            <span>Post Composer</span>
          </button>

          <button
            className="icon-btn"
            onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
            aria-label="Toggle theme"
          >
            <Icon name={theme === "dark" ? "sun" : "moon"} size={16} />
          </button>
          <div className="settings-menu-wrap">
            <button
             className={`icon-btn ${settingsOpen ? "icon-btn--active" : ""}`}
             onClick={() => setSettingsOpen((value) => !value)}
             aria-label="Open workspace settings"
             title="Workspace settings"
            >
             <Icon name="settings" size={17} />
            </button>
            {settingsOpen && (
             <div className="settings-menu">
               <div className="settings-menu__title">Workspace</div>
               <button onClick={() => openComposer("drafts")}><Icon name="layers" size={15} /> Drafts</button>
               <button onClick={() => openComposer("pages")}><Icon name="folder" size={15} /> Connected Pages</button>
               <button onClick={() => openComposer("history")}><Icon name="clock" size={15} /> Publish history</button>
             </div>
            )}
          </div>
        </div>
      </header>

      {appMode === "photos" ? (
        <div className="workspace">
          <aside className="workspace__left">
            <UploadTray
              files={files}
              selected={selected}
              onFiles={addFiles}
              onSelect={setSelected}
              onRemove={removeFile}
            />
          </aside>

          <main className="workspace__center">
            <CanvasStage
              file={files[selected]}
              logo={logo}
              preset={currentPreset}
              onUpdate={update}
            />

            <div className="actionbar">
              <button
                className="btn btn--primary"
                onClick={process}
                disabled={busy || !files.length}
              >
                {busy && job
                  ? `Processing ${job.completed}/${job.total}…`
                  : `Process ${files.length || ""} photo${files.length === 1 ? "" : "s"}`}
              </button>
              <button
                className="btn btn--ghost"
                onClick={() => api.openFolder().catch(() => toasts.error("Windows only."))}
              >
                Open output folder
              </button>
            </div>

            {job && (
              <section className="progress-card">
                <div className="progress-card__head">
                  <span>
                    {job.status === "complete" ? "Complete" : "Working"} · {job.completed}/{job.total}
                    {job.device_used && ` · Device: ${job.device_used}`}
                  </span>
                </div>
                <div className="progressbar">
                  <div
                    className="progressbar__fill"
                    style={{ width: `${job.total ? (job.completed / job.total) * 100 : 0}%` }}
                  />
                </div>
                {job.files?.length > 0 && (
                  <div className="result-links">
                    {job.files.map((f) => (
                      <a key={f.url} href={f.url} target="_blank" rel="noreferrer">
                        {f.name}
                      </a>
                    ))}
                  </div>
                )}
                {job.status === "complete" && job.files?.length > 0 && (
                  <button
                    className="btn btn--secondary btn--sm"
                    onClick={() => openComposer("compose")}
                  >
                    <Icon name="edit" size={14} /> Open processed photos in Post Composer
                  </button>
                )}
                {job.errors?.map((e) => (
                  <p className="progress-card__error" key={e.name}>
                    {e.name}: {e.error}
                  </p>
                ))}
              </section>
            )}
          </main>

          <aside className="workspace__right">
            <ControlPanel
              preset={currentPreset}
              onUpdate={update}
              onAdjust={adjust}
              onApplyToAll={applyAdjustmentGroupToAll}
              logo={logo}
              onLogo={setLogo}
              presets={presets}
              onLoadPreset={handleLoadPreset}
              onSavePreset={saveThePreset}
              onDeletePreset={deleteThePreset}
              onImportPreset={handleImportPreset}
              canUndo={historyIndex > 0}
              canRedo={historyIndex < history.length - 1}
              onUndo={undo}
              onRedo={redo}
            />
          </aside>
        </div>
      ) : (
        <VideoStudio
          onOpenComposer={(videoData) => openComposer("compose", videoData)}
          notify={(msg, tone) => toasts.show(msg, tone)}
          globalLogo={logo}
        />
      )}

      <Toasts toasts={toasts.toasts} onDismiss={toasts.dismiss} />

      <CurationModal
        isOpen={curationOpen}
        onClose={() => setCurationOpen(false)}
        onApplySelected={(selectedFiles) => {
          addFiles(selectedFiles);
          toasts.success(`Loaded ${selectedFiles.length} curated photo${selectedFiles.length > 1 ? "s" : ""} into PhotoPilot!`);
        }}
        currentFiles={files}
      />

      <PostComposer
        isOpen={composerOpen}
        onClose={() => setComposerOpen(false)}
        processedPhotos={processedPhotos}
        initialTab={composerTab}
        initialVideo={composerVideo}
      />
    </div>
  );
}
