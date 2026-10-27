import React, { useCallback, useEffect, useRef, useState } from "react";
import * as api from "./api";
import { useToasts } from "./hooks/useToasts";
import { Toasts } from "./components/Toasts";
import { UploadTray } from "./components/UploadTray";
import { CanvasStage } from "./components/CanvasStage";
import { ControlPanel } from "./components/ControlPanel";
import { CurationModal } from "./components/CurationModal";
import { PostComposer } from "./components/PostComposer";
import { ConcatVideoStudio } from "./components/video/ConcatVideoStudio";
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
  remove_noise: false,
  denoise_strength: 50,
  auto_color_fix: false,
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterView, setFilterView] = useState("all"); // all | favorites | edited | trash
  const [viewMode, setViewMode] = useState("grid"); // grid | list
  const [sortBy, setSortBy] = useState("date");
  const [fabOpen, setFabOpen] = useState(false);
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
    setFiles((prev) => {
      const next = prev.filter((_, i) => i !== index);
      setSelected((s) => {
        if (next.length === 0) return 0;
        if (index < s) return s - 1;
        return Math.min(s, next.length - 1);
      });
      return next;
    });
    setFilePresets((prev) => prev.filter((_, i) => i !== index));
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

  const fileInputRef = useRef(null);

  // --- Sidebar nav items ---
  const sidebarNav = [
    { id: "photos", icon: "brand", label: "Photos Studio", onClick: () => setAppMode("photos") },
    { id: "videos", icon: "film", label: "Video Studio", onClick: () => setAppMode("videos") },
    { id: "curate", icon: "sparkle", label: "AI Curate", badge: "New", onClick: () => { setCurationOpen(true); } },
    { id: "composer", icon: "edit", label: "Post Composer", onClick: () => openComposer() },
    { id: "drafts", icon: "layers", label: "Drafts", onClick: () => openComposer("drafts") },
    { id: "pages", icon: "folder", label: "Connected Pages", onClick: () => openComposer("pages") },
    { id: "history", icon: "clock", label: "Publish History", onClick: () => openComposer("history") },
  ];

  const activeNav = appMode === "videos" ? "videos" : "photos";

  return (
    <div className="app">
      {/* ===== LEFT SIDEBAR ===== */}
      <aside className={`sidebar ${sidebarCollapsed ? "sidebar--collapsed" : ""}`}>
        <div className="sidebar__brand">
          <span className="sidebar__brand-mark"><Icon name="brand" size={20} /></span>
          {!sidebarCollapsed && (
            <div className="sidebar__brand-text">
              <span className="sidebar__brand-name">PhotoPilot</span>
              <span className="sidebar__brand-tag">Local · Fast · Smart</span>
            </div>
          )}
        </div>

        <nav className="sidebar__nav">
          {sidebarNav.map((item) => (
            <button
              key={item.id}
              className={`sidebar__nav-item ${activeNav === item.id ? "sidebar__nav-item--active" : ""}`}
              onClick={item.onClick}
              title={item.label}
            >
              <Icon name={item.icon} size={18} />
              {!sidebarCollapsed && <span>{item.label}</span>}
              {!sidebarCollapsed && item.badge && <span className="sidebar__nav-badge">{item.badge}</span>}
            </button>
          ))}
        </nav>

        <div className="sidebar__bottom">
          <button
            className="sidebar__nav-item"
            onClick={() => setSettingsOpen((v) => !v)}
            title="Settings"
          >
            <Icon name="settings" size={18} />
            {!sidebarCollapsed && <span>Settings</span>}
          </button>
        </div>
      </aside>

      {/* ===== MAIN AREA ===== */}
      <div className="main-area">
        {/* ===== TOP BAR ===== */}
        <header className="topbar">
          <div className="topbar__search">
            <Icon name="eye" size={15} />
            <input
              type="text"
              className="topbar__search-input"
              placeholder="Search photos, folders, or filter..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div className="topbar__filters">
            {["all", "favorites", "edited", "trash"].map((f) => (
              <button
                key={f}
                className={`topbar__filter-pill ${filterView === f ? "topbar__filter-pill--active" : ""}`}
                onClick={() => setFilterView(f)}
              >
                {f === "all" && <Icon name="brand" size={13} />}
                {f === "favorites" && "⭐"}
                {f === "edited" && <Icon name="edit" size={13} />}
                {f === "trash" && <Icon name="trash" size={13} />}
                <span>{f.charAt(0).toUpperCase() + f.slice(1)}{f === "all" ? " Photos" : ""}</span>
              </button>
            ))}
          </div>

          <div className="topbar__center-controls">
            <div className="topbar__view-toggle">
              <button
                className={`topbar__view-btn ${viewMode === "grid" ? "topbar__view-btn--active" : ""}`}
                onClick={() => setViewMode("grid")}
                title="Grid view"
              >
                <Icon name="brand" size={13} />
              </button>
              <button
                className={`topbar__view-btn ${viewMode === "list" ? "topbar__view-btn--active" : ""}`}
                onClick={() => setViewMode("list")}
                title="List view"
              >
                <Icon name="layers" size={13} />
              </button>
            </div>

            <div className="topbar__sort">
              <span className="topbar__sort-label">Sort:</span>
              <select className="topbar__sort-select" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                <option value="date">Date</option>
                <option value="name">Name</option>
                <option value="size">Size</option>
              </select>
            </div>
          </div>

          <div className="topbar__actions">
            {/* GPU Badge */}
            <div className={`topbar__gpu-badge ${isGpuActive ? "topbar__gpu-badge--active" : ""}`}>
              <span className="topbar__gpu-label">{isGpuActive ? "GPU" : "CPU"}</span>
              <Icon name="sparkle" size={12} />
              <select
                className="topbar__gpu-select"
                value={deviceMode}
                onChange={(e) => setDeviceMode(e.target.value)}
                title={gpu?.details || "Hardware device preference"}
              >
                <option value="auto">
                  {gpu?.available ? `${gpu.device}` : "CPU"}
                </option>
                <option value="gpu" disabled={!gpu?.available}>
                  GPU {gpu?.available ? `(${gpu.device})` : "(N/A)"}
                </option>
                <option value="cpu">CPU (Standard)</option>
              </select>
            </div>

            <button
              className="icon-btn"
              onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
              aria-label="Toggle theme"
            >
              <Icon name={theme === "dark" ? "sun" : "moon"} size={16} />
            </button>

            <button className="icon-btn" title="Settings" onClick={() => setSettingsOpen((v) => !v)}>
              <Icon name="settings" size={16} />
            </button>

            {/* Profile Avatar Placeholder */}
            <div className="topbar__avatar">
              <Icon name="brand" size={16} />
            </div>

            {/* Import Photos Button */}
            <button
              className="topbar__import-btn"
              onClick={() => fileInputRef.current?.click()}
            >
              <Icon name="plus" size={15} />
              <span>Import Photos</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".jpg,.jpeg,.png,.webp,.heic,.heif,.dng,image/jpeg,image/png,image/webp,image/heic,image/heif,image/x-adobe-dng"
              multiple
              hidden
              onChange={(e) => {
                const incoming = [...e.target.files].filter((f) => f && f.name);
                if (incoming.length) addFiles(incoming);
                e.target.value = "";
              }}
            />
          </div>
        </header>

        {/* ===== CONTENT ===== */}
        {appMode === "photos" ? (
          <div className="workspace">
            <main className="workspace__center">
              {files[selected] ? (
                <CanvasStage
                  file={files[selected]}
                  logo={logo}
                  preset={currentPreset}
                  onUpdate={update}
                />
              ) : (
                <UploadTray
                  files={files}
                  selected={selected}
                  onFiles={addFiles}
                  onSelect={setSelected}
                  onRemove={removeFile}
                />
              )}

              {/* Horizontal Thumbnail Strip */}
              {files.length > 0 ? (
                <div className="thumb-strip">
                  <div className="thumb-strip__scroll">
                    {files.map((file, i) => (
                      <ThumbItem
                        key={`${file.name}-${i}`}
                        file={file}
                        index={i}
                        active={i === selected}
                        onSelect={setSelected}
                        onRemove={removeFile}
                      />
                    ))}
                  </div>
                </div>
              ) : (
                <div className="thumb-strip thumb-strip--samples">
                  <div className="thumb-strip__scroll">
                    {[
                      { title: "Coastal Horizon", bg: "linear-gradient(135deg, #1e3a8a 0%, #38bdf8 100%)" },
                      { title: "Ancient Temple", bg: "linear-gradient(135deg, #78350f 0%, #d97706 100%)" },
                      { title: "Sunset Ridge", bg: "linear-gradient(135deg, #831843 0%, #f43f5e 50%, #fb923c 100%)" },
                      { title: "Mystic Valley", bg: "linear-gradient(135deg, #064e3b 0%, #10b981 100%)" },
                      { title: "Alpine Peaks", bg: "linear-gradient(135deg, #1e293b 0%, #64748b 100%)" },
                      { title: "Emerald Bay", bg: "linear-gradient(135deg, #134e4a 0%, #2dd4bf 100%)" },
                      { title: "Golden Bloom", bg: "linear-gradient(135deg, #713f12 0%, #eab308 100%)" },
                    ].map((sample, idx) => (
                      <div key={idx} className="thumb-strip__item thumb-strip__item--sample" title={`Sample: ${sample.title}`}>
                        <div className="thumb-strip__sample-bg" style={{ background: sample.bg }} />
                        <span className="thumb-strip__sample-lbl">{sample.title}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Action Bar */}
              {files.length > 0 && (
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
              )}

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

            {/* ===== RIGHT SIDEBAR ===== */}
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
          <ConcatVideoStudio notify={(msg, tone) => toasts.show(msg, tone)} />
        )}
      </div>

      {/* ===== FAB MENU ===== */}
      <div className="fab-container">
        <button className={`fab ${fabOpen ? "fab--open" : ""}`} onClick={() => setFabOpen((v) => !v)}>
          <Icon name="plus" size={22} />
        </button>
        {fabOpen && (
          <div className="fab-menu" onClick={() => setFabOpen(false)}>
            <button onClick={() => fileInputRef.current?.click()}>
              <Icon name="upload" size={16} /> Import Photos
            </button>
            <button onClick={() => setCurationOpen(true)}>
              <Icon name="sparkle" size={16} /> AI Curate
            </button>
            <button onClick={() => openComposer()}>
              <Icon name="edit" size={16} /> Post Composer
            </button>
            <button onClick={() => openComposer("drafts")}>
              <Icon name="layers" size={16} /> Drafts
            </button>
            <button onClick={() => openComposer("pages")}>
              <Icon name="folder" size={16} /> Connected Pages
            </button>
            <button onClick={() => openComposer("history")}>
              <Icon name="clock" size={16} /> Publish History
            </button>
            <div className="fab-menu__divider" />
            <button onClick={() => setSettingsOpen((v) => !v)}>
              <Icon name="settings" size={16} /> Settings
            </button>
          </div>
        )}
      </div>

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

// Inline thumbnail component for the horizontal strip
function ThumbItem({ file, active, index, onSelect, onRemove }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);
  const isImage = /\.(jpe?g|png|webp)$/i.test(file.name);
  return (
    <div className={`thumb-strip__item ${active ? "thumb-strip__item--active" : ""}`} onClick={() => onSelect(index)} title={file.name}>
      {isImage ? <img src={url} alt={file.name} loading="lazy" /> : <div className="thumb-strip__raw">RAW</div>}
      <button
        className="thumb-strip__remove"
        onClick={(e) => {
          e.stopPropagation();
          onRemove(index);
        }}
        aria-label={`Remove ${file.name}`}
      >
        ×
      </button>
    </div>
  );
}
