import React, { useEffect, useRef, useState } from "react";
import * as api from "../api";

export function CurationModal({ isOpen, onClose, onApplySelected, currentFiles = [] }) {
  const [stage, setStage] = useState("idle"); // "idle", "analyzing", "review"
  const [folderPath, setFolderPath] = useState("");
  const [uploadFiles, setUploadFiles] = useState([]);
  const [uploadPreviewUrls, setUploadPreviewUrls] = useState([]);
  const [jobId, setJobId] = useState(null);
  const [progress, setProgress] = useState({ stage: "Initializing", pct: 0, analyzed: 0, total: 0 });
  const [results, setResults] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [activeTab, setActiveTab] = useState("all"); // "all", "duplicates", "similar", "unique"
  const [bestNCount, setBestNCount] = useState(30);
  const [showConfig, setShowConfig] = useState(false);
  const [config, setConfig] = useState(null);
  const [hardwareInfo, setHardwareInfo] = useState("Checking...");
  const pollTimerRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    const urls = uploadFiles.map((file) => URL.createObjectURL(file));
    setUploadPreviewUrls(urls);
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, [uploadFiles]);
  const folderInputRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      api.getCurationConfig().then(setConfig).catch(() => {});
      api.getGpu().then((gpu) => {
        setHardwareInfo(gpu.available ? `GPU: ${gpu.device}` : "CPU");
      }).catch(() => setHardwareInfo("CPU"));
    } else {
      clearInterval(pollTimerRef.current);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleStartWithExisting = () => {
    if (!currentFiles.length) return;
    setUploadFiles(currentFiles);
    launchCuration(currentFiles, "");
  };

  const launchCuration = async (filesToCurate, folder) => {
    setStage("analyzing");
    setProgress({ stage: "Starting analysis…", pct: 0, analyzed: 0, total: filesToCurate.length || 1 });
    try {
      const { job_id } = await api.startCuration(filesToCurate, folder);
      setJobId(job_id);

      pollTimerRef.current = setInterval(async () => {
        try {
          const job = await api.getCurationProgress(job_id);
          setProgress({
            stage: job.stage || "Analyzing…",
            pct: job.progress_pct || 0,
            analyzed: job.analyzed || 0,
            total: job.total || 0,
          });

          if (job.status === "complete") {
            clearInterval(pollTimerRef.current);
            setResults(job.result);
            setStage("review");

            // Initialize selection with all recommended photos
            const recSet = new Set();
            (job.result?.groups || []).forEach((g) => {
              if (g.recommended_id) recSet.add(g.recommended_id);
            });
            (job.result?.standalone || []).forEach((s) => recSet.add(s.id));
            setSelectedIds(recSet);
          } else if (job.status === "failed") {
            clearInterval(pollTimerRef.current);
            alert(`Analysis failed: ${job.error || "Unknown error"}`);
            setStage("idle");
          }
        } catch {
          /* ignore polling transient errors */
        }
      }, 400);
    } catch (err) {
      alert(`Could not start curation: ${err.message}`);
      setStage("idle");
    }
  };

  const toggleSelectPhoto = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectGroupOnlyRecommended = (group) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      (group.photos || []).forEach((p) => next.delete(p.id));
      if (group.recommended_id) next.add(group.recommended_id);
      return next;
    });
  };

  const selectGroupAll = (group) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      (group.photos || []).forEach((p) => next.add(p.id));
      return next;
    });
  };

  const deselectGroup = (group) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      (group.photos || []).forEach((p) => next.delete(p.id));
      return next;
    });
  };

  const selectAllRecommended = () => {
    if (!results) return;
    const recSet = new Set();
    (results.groups || []).forEach((g) => {
      if (g.recommended_id) recSet.add(g.recommended_id);
    });
    (results.standalone || []).forEach((s) => recSet.add(s.id));
    setSelectedIds(recSet);
  };

  const selectAllPhotos = () => {
    if (!results) return;
    const all = new Set();
    (results.groups || []).forEach((g) => {
      (g.photos || []).forEach((p) => all.add(p.id));
    });
    (results.standalone || []).forEach((s) => all.add(s.id));
    setSelectedIds(all);
  };

  const deselectAllPhotos = () => {
    setSelectedIds(new Set());
  };

  const handleSelectBestN = async () => {
    if (!results) return;
    try {
      const count = parseInt(bestNCount, 10) || 30;
      const res = await api.selectBestN(results.groups || [], results.standalone || [], count);
      setSelectedIds(new Set(res.selected_ids || []));
    } catch (e) {
      alert(`Could not select best photos: ${e.message}`);
    }
  };

  const handleApplyToWorkspace = async () => {
    if (!results) return;
    // Map selected IDs to actual file objects
    const allPhotos = [
      ...(results.groups || []).flatMap((g) => g.photos || []),
      ...(results.standalone || []),
    ];
    const chosenPhotos = allPhotos.filter((p) => selectedIds.has(p.id));

    // Convert to browser Files via fetching our local thumbnail/preview or directly
    const loadedFiles = [];
    for (const p of chosenPhotos) {
      try {
        const resp = await fetch(`/api/curation/thumbnail?path=${encodeURIComponent(p.path)}&max_size=3000`);
        const blob = await resp.blob();
        const file = new File([blob], p.name, { type: blob.type, lastModified: Date.now() });
        loadedFiles.push(file);
      } catch {
        /* fallback */
      }
    }

    if (loadedFiles.length) {
      onApplySelected(loadedFiles);
      onClose();
    } else {
      alert("No photos were selected.");
    }
  };

  const groups = results?.groups || [];
  const standalone = results?.standalone || [];
  const summary = results?.summary || {};

  const filteredGroups = groups.filter((g) => {
    if (activeTab === "duplicates") return g.group_type === "Exact Duplicate";
    if (activeTab === "similar") return g.group_type !== "Exact Duplicate";
    if (activeTab === "unique") return false;
    return true;
  });

  return (
    <div className="curation-modal-overlay">
      <div className="curation-modal">
        {/* Header */}
        <div className="curation-modal__head">
          <div className="curation-modal__title-area">
            <span className="curation-modal__icon">✨</span>
            <div>
              <h2 className="curation-modal__title">AI Photo Curation & Duplicate Detector</h2>
              <p className="curation-modal__subtitle">
                Exact duplicates · Similar bursts · Smart quality analysis · Diversity selection
              </p>
            </div>
          </div>

          <div className="curation-modal__head-actions">
            <span className="badge badge--pill">
              ⚡ {hardwareInfo}
            </span>
            <button className="icon-btn" onClick={onClose} title="Close">✕</button>
          </div>
        </div>

        {/* BODY */}
        <div className="curation-modal__body">
          {stage === "idle" && (
            <div className="curation-setup">
              <div className="curation-setup__grid">
                {/* Method 1: Local Folder Scanner */}
                <div className="curation-card">
                  <div className="curation-card__head">
                    <span className="curation-card__icon">📁</span>
                    <h3>Scan Local PC Folder</h3>
                  </div>
                  <p className="curation-card__desc">
                    Select a folder on your computer with hundreds of photos (RAW, JPG, PNG).
                  </p>
                  <div className="input-group" style={{ marginTop: "12px", alignItems: "center" }}>
                    <input
                      ref={folderInputRef}
                      type="file"
                      webkitdirectory=""
                      directory=""
                      multiple
                      hidden
                      onChange={(e) => {
                        const selectedFiles = Array.from(e.target.files || []);
                        e.target.value = "";
                        const supported = selectedFiles.filter((file) =>
                          /\.(jpe?g|png|webp|bmp|tiff?|dng|cr2|cr3|nef|arw|heic|heif)$/i.test(file.name)
                        );
                        if (supported.length) {
                          setUploadFiles(supported);
                          setFolderPath(selectedFiles[0].webkitRelativePath?.split("/")[0] || "Selected folder");
                          launchCuration(supported, "");
                        } else if (selectedFiles.length) {
                          alert("No supported image files found in the selected folder.");
                        }
                      }}
                    />
                    <input
                      type="text"
                      className="input"
                      placeholder="Selected folder name"
                      value={folderPath}
                      readOnly
                    />
                    <button
                      className="btn btn--primary"
                      onClick={() => folderInputRef.current?.click()}
                    >
                      Browse Folder
                    </button>
                  </div>
                  <p className="curation-card__desc" style={{ marginTop: "8px", fontSize: "0.72rem" }}>
                    The selected folder is uploaded securely for local analysis; your original files are not changed.
                  </p>
                </div>

                {/* Method 2: Batch Upload / Current Workspace */}
                <div className="curation-card">
                  <div className="curation-card__head">
                    <span className="curation-card__icon">📥</span>
                    <h3>Curate Uploaded Photos</h3>
                  </div>
                  <p className="curation-card__desc">
                    Analyze the photos currently in PhotoPilot, or select a new batch from your browser.
                  </p>
                  <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
                    <input
                      type="file"
                      multiple
                      accept="image/*,.dng,.cr2,.cr3,.nef,.arw,.heic"
                      ref={fileInputRef}
                      hidden
                      onChange={(e) => {
                        const sel = Array.from(e.target.files || []);
                        if (sel.length) {
                          setUploadFiles(sel);
                          launchCuration(sel, "");
                        }
                      }}
                    />
                    <button
                      className="btn btn--secondary"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      Upload Files
                    </button>
                    {currentFiles.length > 0 && (
                      <button
                        className="btn btn--primary"
                        onClick={handleStartWithExisting}
                      >
                        Curate {currentFiles.length} Current Photos
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Threshold Settings Accordion */}
              <div style={{ marginTop: "16px" }}>
                <button
                  className="link"
                  onClick={() => setShowConfig((c) => !c)}
                  style={{ fontSize: "0.8rem" }}
                >
                  {showConfig ? "▾ Hide Curation Settings" : "▸ Advanced Threshold & Weight Settings"}
                </button>
                {showConfig && config && (
                  <div className="curation-config-panel">
                    <div className="curation-config-grid">
                      <div>
                        <label className="field-label">pHash Threshold (Hamming dist)</label>
                        <input
                          type="number"
                          className="input"
                          min="1"
                          max="20"
                          value={config.phash_threshold}
                          onChange={(e) => setConfig({ ...config, phash_threshold: parseInt(e.target.value, 10) })}
                        />
                      </div>
                      <div>
                        <label className="field-label">AI Embedding Similarity (0.50 - 0.99)</label>
                        <input
                          type="number"
                          step="0.02"
                          className="input"
                          min="0.5"
                          max="0.99"
                          value={config.embedding_similarity_threshold}
                          onChange={(e) => setConfig({ ...config, embedding_similarity_threshold: parseFloat(e.target.value) })}
                        />
                      </div>
                      <div>
                        <label className="field-label">Sharpness Weight</label>
                        <input
                          type="number"
                          step="0.05"
                          className="input"
                          value={config.weights?.sharpness ?? 0.35}
                          onChange={(e) => setConfig({
                            ...config,
                            weights: { ...config.weights, sharpness: parseFloat(e.target.value) },
                          })}
                        />
                      </div>
                      <div>
                        <label className="field-label">Face Quality Weight</label>
                        <input
                          type="number"
                          step="0.05"
                          className="input"
                          value={config.weights?.face_quality ?? 0.25}
                          onChange={(e) => setConfig({
                            ...config,
                            weights: { ...config.weights, face_quality: parseFloat(e.target.value) },
                          })}
                        />
                      </div>
                    </div>
                    <button
                      className="btn btn--ghost btn--sm"
                      style={{ marginTop: "10px" }}
                      onClick={() => {
                        api.saveCurationConfig(config);
                        alert("Settings saved!");
                      }}
                    >
                      Save Settings
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {stage === "analyzing" && (
            <div className="curation-analyzing">
              <div className="curation-analyzing__spinner">🌀</div>
              <h3>Analyzing Photos with AI Engine</h3>
              <p className="curation-analyzing__stage">{progress.stage}</p>

              <div className="curation-progressbar">
                <div
                  className="curation-progressbar__fill"
                  style={{ width: `${progress.pct}%` }}
                />
              </div>

              <div className="curation-analyzing__meta">
                <span>{progress.analyzed} / {progress.total} photos</span>
                <span>{Math.round(progress.pct)}%</span>
              </div>
              {uploadPreviewUrls.length > 0 && (
                <div className="curation-upload-preview">
                  {uploadPreviewUrls.slice(0, 12).map((url, index) => (
                    <img
                      key={url}
                      src={url}
                      alt={uploadFiles[index]?.name || "Selected photo"}
                      title={uploadFiles[index]?.name}
                      loading="lazy"
                    />
                  ))}
                  {uploadPreviewUrls.length > 12 && (
                    <span>+{uploadPreviewUrls.length - 12} more photos</span>
                  )}
                </div>
              )}
            </div>
          )}

          {stage === "review" && results && (
            <div className="curation-review">
              {/* Summary Stats Cards */}
              <div className="curation-stats-bar">
                <div className="stat-card">
                  <div className="stat-card__val">{summary.total}</div>
                  <div className="stat-card__lbl">Total Photos</div>
                </div>
                <div className="stat-card">
                  <div className="stat-card__val">{summary.exact_duplicate_groups}</div>
                  <div className="stat-card__lbl">Exact Duplicate Groups</div>
                </div>
                <div className="stat-card">
                  <div className="stat-card__val">{summary.similar_groups}</div>
                  <div className="stat-card__lbl">Similar Scene Groups</div>
                </div>
                <div className="stat-card">
                  <div className="stat-card__val">{summary.standalone_count}</div>
                  <div className="stat-card__lbl">Unique Photos</div>
                </div>
                <div className="stat-card stat-card--accent">
                  <div className="stat-card__val">{selectedIds.size}</div>
                  <div className="stat-card__lbl">Selected to Keep</div>
                </div>
              </div>

              {/* Review Controls & Filter Tabs */}
              <div className="curation-controls-bar">
                <div className="filter-chips">
                  {[
                    { id: "all", label: `All Groups (${groups.length})` },
                    { id: "duplicates", label: `Exact Duplicates (${summary.exact_duplicate_groups})` },
                    { id: "similar", label: `Burst & Similar (${summary.similar_groups})` },
                    { id: "unique", label: `Unique Standalones (${standalone.length})` },
                  ].map((tab) => (
                    <button
                      key={tab.id}
                      className={`filter-chip ${activeTab === tab.id ? "filter-chip--active" : ""}`}
                      onClick={() => setActiveTab(tab.id)}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                {/* Quick Selection Shortcuts */}
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <button
                    className="btn btn--secondary btn--xs"
                    onClick={selectAllRecommended}
                    title="Select the best photo from each group + all unique photos"
                  >
                    🏆 Keep Recommended ({summary.recommended_count || groups.length + standalone.length})
                  </button>
                  <button
                    className="btn btn--ghost btn--xs"
                    onClick={selectAllPhotos}
                    title="Select all photos"
                  >
                    Select All
                  </button>
                  <button
                    className="btn btn--ghost btn--xs"
                    onClick={deselectAllPhotos}
                    title="Clear current selection"
                  >
                    Clear
                  </button>
                </div>

                {/* Diversity-Aware "Select Best N" */}
                <div className="diversity-selector">
                  <span style={{ fontSize: "0.75rem", color: "var(--text-dim)" }}>Diversity:</span>
                  <input
                    type="number"
                    min="1"
                    max={summary.total || 500}
                    value={bestNCount}
                    className="input input--sm"
                    style={{ width: "65px", textAlign: "center" }}
                    onChange={(e) => setBestNCount(e.target.value)}
                  />
                  <button
                    className="btn btn--primary btn--sm"
                    onClick={handleSelectBestN}
                    title="Select top diverse photos avoiding repetitions"
                  >
                    Select Best {bestNCount}
                  </button>
                </div>
              </div>

              {/* Groups Listing */}
              <div className="curation-groups-list">
                {activeTab !== "unique" && filteredGroups.map((g) => (
                  <div key={g.group_id} className="curation-group-card">
                    <div className="curation-group-card__header">
                      <div className="curation-group-card__meta">
                        <span className="badge badge--accent">{g.group_id}</span>
                        <span className={`badge ${g.group_type === "Exact Duplicate" ? "badge--danger" : "badge--neutral"}`}>
                          {g.group_type}
                        </span>
                        <span className="curation-group-card__count">
                          {g.photos.length} photos
                        </span>
                      </div>

                      <div className="curation-group-card__actions">
                        <button
                          className="btn btn--ghost btn--xs"
                          onClick={() => selectGroupOnlyRecommended(g)}
                        >
                          Keep Recommended 🏆
                        </button>
                        <button
                          className="btn btn--ghost btn--xs"
                          onClick={() => selectGroupAll(g)}
                        >
                          Keep All
                        </button>
                        <button
                          className="btn btn--ghost btn--xs"
                          onClick={() => deselectGroup(g)}
                        >
                          Deselect
                        </button>
                      </div>
                    </div>

                    <div className="curation-photo-grid">
                      {g.photos.map((p) => {
                        const isSelected = selectedIds.has(p.id);
                        return (
                          <div
                            key={p.id}
                            className={`curation-photo-item ${isSelected ? "curation-photo-item--selected" : ""} ${p.is_recommended ? "curation-photo-item--recommended" : ""}`}
                            onClick={() => toggleSelectPhoto(p.id)}
                          >
                            <div className="curation-photo-item__thumb-wrap">
                              <img
                                src={api.getThumbnailUrl(p.path, 320)}
                                alt={p.name}
                                className="curation-photo-item__thumb"
                                loading="lazy"
                              />
                              {p.is_recommended && (
                                <span className="trophy-badge" title="AI Recommended Best Photo">
                                  🏆 Best
                                </span>
                              )}
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) => {
                                  e.stopPropagation();
                                  toggleSelectPhoto(p.id);
                                }}
                                className="curation-photo-item__checkbox"
                              />
                            </div>

                            <div className="curation-photo-item__meta">
                              <div className="curation-photo-item__name" title={p.name}>
                                {p.name}
                              </div>
                              <div className="curation-photo-item__tags">
                                <span className="score-pill" title="Overall Quality Score">
                                  ★ {Math.round(p.quality_score)}
                                </span>
                                {p.is_blurry && (
                                  <span className="tag-pill tag-pill--warn">Blurry</span>
                                )}
                                {p.exposure_label !== "Balanced" && (
                                  <span className="tag-pill tag-pill--warn">{p.exposure_label}</span>
                                )}
                                {p.face_count > 0 && (
                                  <span className="tag-pill">👤 {p.face_count}</span>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}

                {/* Unique / Standalone Photos Tab */}
                {(activeTab === "unique" || (activeTab === "all" && standalone.length > 0)) && (
                  <div className="curation-group-card">
                    <div className="curation-group-card__header">
                      <div className="curation-group-card__meta">
                        <span className="badge badge--neutral">Unique Distinct Photos</span>
                        <span className="curation-group-card__count">{standalone.length} photos</span>
                      </div>
                    </div>
                    <div className="curation-photo-grid">
                      {standalone.map((p) => {
                        const isSelected = selectedIds.has(p.id);
                        return (
                          <div
                            key={p.id}
                            className={`curation-photo-item ${isSelected ? "curation-photo-item--selected" : ""}`}
                            onClick={() => toggleSelectPhoto(p.id)}
                          >
                            <div className="curation-photo-item__thumb-wrap">
                              <img
                                src={api.getThumbnailUrl(p.path, 320)}
                                alt={p.name}
                                className="curation-photo-item__thumb"
                                loading="lazy"
                              />
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) => {
                                  e.stopPropagation();
                                  toggleSelectPhoto(p.id);
                                }}
                                className="curation-photo-item__checkbox"
                              />
                            </div>
                            <div className="curation-photo-item__meta">
                              <div className="curation-photo-item__name" title={p.name}>{p.name}</div>
                              <div className="curation-photo-item__tags">
                                <span className="score-pill">★ {Math.round(p.quality_score)}</span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="curation-modal__foot">
          <div className="curation-modal__foot-meta">
            {stage === "review" && (
              <span>
                Selected <strong>{selectedIds.size}</strong> of {summary.total} photos (Original files remain untouched).
              </span>
            )}
          </div>

          <div style={{ display: "flex", gap: "10px" }}>
            <button className="btn btn--ghost" onClick={onClose}>
              Cancel
            </button>
            {stage === "review" && (
              <button
                className="btn btn--primary"
                onClick={handleApplyToWorkspace}
                disabled={selectedIds.size === 0}
              >
                ✓ Edit {selectedIds.size} Curated Photos in PhotoPilot
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
