import React, { useCallback, useEffect, useRef, useState } from "react";
import * as api from "../api";
import { Icon } from "./Icon";

const HASHTAG_CATEGORIES = [
  "photography", "nature", "portrait", "wedding",
  "food", "travel", "product", "event",
];

export function PostComposer({ isOpen, onClose, processedPhotos = [], initialTab = "compose", initialVideo = null }) {
  // ──── State ────
  const [activeTab, setActiveTab] = useState("compose"); // compose | drafts | pages | history
  const [mediaType, setMediaType] = useState("photo"); // photo | reel | video
  const [videoItem, setVideoItem] = useState(null);
  const [videoTitle, setVideoTitle] = useState("");
  const [photos, setPhotos] = useState([]);
  const [selectedPhotos, setSelectedPhotos] = useState(new Set());
  const [caption, setCaption] = useState("");
  const [hashtags, setHashtags] = useState([]);
  const [hashtagInput, setHashtagInput] = useState("");
  const [captionPrompt, setCaptionPrompt] = useState("");
  const [hashtagCategory, setHashtagCategory] = useState("photography");
  const [isGeneratingCaption, setIsGeneratingCaption] = useState(false);
  const [isGeneratingHashtags, setIsGeneratingHashtags] = useState(false);
  const [captionProvider, setCaptionProvider] = useState("rule-based");
  const [captionConfig, setCaptionConfig] = useState({
    provider: "gemini",
    api_key: "",
    model: "gemini-2.5-flash",
    base_url: "https://generativelanguage.googleapis.com/v1beta",
  });
  const [showCaptionSettings, setShowCaptionSettings] = useState(false);
  const [captionConnection, setCaptionConnection] = useState(null);
  const [pages, setPages] = useState([]);
  const [selectedPages, setSelectedPages] = useState([]);
  const [drafts, setDrafts] = useState([]);
  const [history, setHistory] = useState([]);
  const [hashtagSets, setHashtagSets] = useState([]);
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [tokenInput, setTokenInput] = useState("");
  const [connectMode, setConnectMode] = useState("page"); // page | user
  const [isConnecting, setIsConnecting] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishProgress, setPublishProgress] = useState(null);

  useEffect(() => {
    if (initialVideo) {
      setVideoItem(initialVideo);
      setMediaType(initialVideo.suggestedType || (initialVideo.aspectRatio === "9:16" ? "reel" : "video"));
      setVideoTitle(initialVideo.videoName?.replace(/\.[^/.]+$/, "") || "New Video");
      setCaptionPrompt(`Viral video for social media: ${initialVideo.videoName || ""}`);
      setActiveTab("compose");
    }
  }, [initialVideo]);

  useEffect(() => {
    if (isOpen) setActiveTab(initialTab);
  }, [isOpen, initialTab]);

  const formatEta = (seconds) => {
    if (seconds === null || seconds === undefined) return "Estimating time...";
    if (seconds < 60) return `about ${Math.max(1, Math.ceil(seconds))} sec left`;
    return `about ${Math.ceil(seconds / 60)} min left`;
  };
  const [publishMode, setPublishMode] = useState("now"); // now | schedule | draft
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleTime, setScheduleTime] = useState("");
  const [notification, setNotification] = useState(null);
  const [showHashtagSetSave, setShowHashtagSetSave] = useState(false);
  const [hashtagSetName, setHashtagSetName] = useState("");
  const [folderPath, setFolderPath] = useState("");
  const fileInputRef = useRef(null);
  const captionRef = useRef(null);
  const selectedPage = selectedPages[0] || null;

  // ──── Load data on open ────
  useEffect(() => {
    if (!isOpen) return;
    api.getFacebookPages().then(setPages).catch(() => {});
    api.getDrafts().then(setDrafts).catch(() => {});
    api.getHashtagSets().then(setHashtagSets).catch(() => {});
    api.getPublishHistory().then(setHistory).catch(() => {});
    api.getCaptionConfig().then((config) => {
      setCaptionConfig(config);
      setCaptionProvider(
        config.provider === "rule-based"
          ? "rule-based"
          : config.provider === "local-vlm"
            ? "local-vlm"
            : "online"
      );
    }).catch(() => {});

    // If processedPhotos are passed, auto-load them
    if (processedPhotos.length > 0) {
      setPhotos(processedPhotos.map((p, i) => ({
        id: `proc-${i}`,
        path: typeof p === "string" ? p : p.path || p.url || "",
        name: typeof p === "string" ? p.split(/[\\/]/).pop() : (p.name || `photo-${i + 1}`),
        thumb: typeof p === "string" ? api.getThumbnailUrl(p) : (p.thumb || p.url || ""),
      })));
    }
  }, [isOpen, processedPhotos]);

  // ──── Notification helper ────
  const notify = useCallback((msg, type = "info") => {
    setNotification({ msg, type });
    setTimeout(() => setNotification(null), 4000);
  }, []);

  // ──── Photo management ────
  const handleAddPhotosFromFolder = () => {
    if (!folderPath.trim()) return;
    // For folder-based photo loading, we construct paths
    // This would typically come from curation or processed output
    notify("Use 'Load from Processed' or drag photos", "info");
  };

  const handleFileSelect = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    // Show thumbnails immediately
    const tempPhotos = files.map((f, i) => ({
      id: `upload-${Date.now()}-${i}`,
      path: "",
      name: f.name,
      thumb: URL.createObjectURL(f),
      file: f,
      uploading: true,
    }));
    setPhotos((prev) => [...prev, ...tempPhotos]);

    // Upload to backend to get real paths
    try {
      const result = await api.uploadPhotosForPublish(files);
      setPhotos((prev) =>
        prev.map((p) => {
          if (!p.uploading) return p;
          const match = result.photos.find((r) => r.name === p.name);
          return match ? { ...p, path: match.path, uploading: false } : p;
        })
      );
      notify(`${result.count} photo(s) uploaded`, "success");
    } catch (err) {
      notify(`Upload failed: ${err.message}`, "error");
    }
  };

  const togglePhotoSelection = (id) => {
    setSelectedPhotos((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllPhotos = () => {
    if (selectedPhotos.size === photos.length) {
      setSelectedPhotos(new Set());
    } else {
      setSelectedPhotos(new Set(photos.map((p) => p.id)));
    }
  };

  const removeSelectedPhotos = () => {
    setPhotos((prev) => prev.filter((p) => !selectedPhotos.has(p.id)));
    setSelectedPhotos(new Set());
  };

  // ──── Caption generation ────
  const handleGenerateCaption = async () => {
    if (!captionPrompt.trim()) {
      notify("Write a prompt before generating a caption", "error");
      return;
    }
    setIsGeneratingCaption(true);
    try {
      const firstPhoto = photos.find((p) => selectedPhotos.has(p.id)) || photos[0];
      const result = await api.generateCaption({
        imagePath: firstPhoto?.path || "",
        prompt: captionPrompt,
        provider: captionProvider,
      });
      setCaption(result.caption);
      notify(`Caption generated (${result.model_name})`, "success");
    } catch (err) {
      notify(`Caption failed: ${err.message}`, "error");
    }
    setIsGeneratingCaption(false);
  };

  // ──── Hashtag generation ────
  const handleGenerateHashtags = async () => {
    setIsGeneratingHashtags(true);
    try {
      const firstPhoto = photos.find((p) => selectedPhotos.has(p.id)) || photos[0];
      const result = await api.generateHashtags({
        caption,
        imagePath: firstPhoto?.path || "",
        category: hashtagCategory,
        count: 15,
      });
      setHashtags(result.hashtags);
      notify(`${result.count} hashtags generated`, "success");
    } catch (err) {
      notify(`Hashtag generation failed: ${err.message}`, "error");
    }
    setIsGeneratingHashtags(false);
  };

  const addHashtag = () => {
    const tag = hashtagInput.trim().startsWith("#") ? hashtagInput.trim() : `#${hashtagInput.trim()}`;
    if (tag.length > 1 && !hashtags.includes(tag)) {
      setHashtags((prev) => [...prev, tag]);
      setHashtagInput("");
    }
  };

  const removeHashtag = (tag) => {
    setHashtags((prev) => prev.filter((t) => t !== tag));
  };

  const loadHashtagSet = (set) => {
    setHashtags(set.hashtags);
    notify(`Loaded "${set.name}" hashtag set`);
  };

  const handleSaveHashtagSet = async () => {
    if (!hashtagSetName.trim() || !hashtags.length) return;
    try {
      await api.saveHashtagSet(hashtagSetName.trim(), hashtags);
      setHashtagSets(await api.getHashtagSets());
      setShowHashtagSetSave(false);
      setHashtagSetName("");
      notify("Hashtag set saved!", "success");
    } catch (err) {
      notify(`Save failed: ${err.message}`, "error");
    }
  };

  const handleDeleteHashtagSet = async (setId) => {
    try {
      await api.deleteHashtagSet(setId);
      setHashtagSets(await api.getHashtagSets());
      notify("Hashtag set deleted");
    } catch (err) {
      notify(`Delete failed: ${err.message}`, "error");
    }
  };

  // ──── Facebook connection ────
  const handleConnectPage = async () => {
    if (!tokenInput.trim()) return;
    setIsConnecting(true);
    try {
      if (connectMode === "user") {
        const result = await api.connectFacebookPagesFromUser(tokenInput.trim());
        notify(`Connected ${result.count} page(s)!`, "success");
      } else {
        await api.connectFacebookPage(tokenInput.trim());
        notify("Page connected!", "success");
      }
      setPages(await api.getFacebookPages());
      setShowConnectModal(false);
      setTokenInput("");
    } catch (err) {
      notify(`Connection failed: ${err.message}`, "error");
    }
    setIsConnecting(false);
  };

  const handleDisconnectPage = async (pageId) => {
    try {
      await api.disconnectFacebookPage(pageId);
      setPages(await api.getFacebookPages());
      setSelectedPages((prev) => prev.filter((pg) => pg.page_id !== pageId));
      notify("Page disconnected");
    } catch (err) {
      notify(`Disconnect failed: ${err.message}`, "error");
    }
  };

  // ──── Publishing ────
  const handlePublish = async () => {
    let photoPaths = [];

    if (mediaType === "photo") {
      const targetPhotos = photos.filter(
        (p) => selectedPhotos.size === 0 || selectedPhotos.has(p.id)
      );

      if (!targetPhotos.length && publishMode !== "draft") {
        notify("Add at least one photo first", "error");
        return;
      }

      // Upload any photos that still have no server path
      const needUpload = targetPhotos.filter((p) => !p.path && p.file);
      if (needUpload.length > 0) {
        try {
          notify("Uploading photos to server...", "info");
          const result = await api.uploadPhotosForPublish(needUpload.map((p) => p.file));
          // Update paths in state
          setPhotos((prev) =>
            prev.map((p) => {
              const match = result.photos.find((r) => r.name === p.name);
              return match ? { ...p, path: match.path } : p;
            })
          );
          // Also update local references
          for (const tp of targetPhotos) {
            if (!tp.path) {
              const match = result.photos.find((r) => r.name === tp.name);
              if (match) tp.path = match.path;
            }
          }
        } catch (err) {
          notify(`Photo upload failed: ${err.message}`, "error");
          return;
        }
      }

      photoPaths = targetPhotos.map((p) => p.path).filter(Boolean);
      if (!photoPaths.length && publishMode !== "draft") {
        notify("Could not resolve photo paths. Try re-adding photos.", "error");
        return;
      }
    } else {
      // Reel or Standard Video
      if (!videoItem?.videoPath && publishMode !== "draft") {
        notify("Please export or select a video to publish", "error");
        return;
      }
    }

    if (publishMode === "draft") {
      // Save as draft
      try {
        await api.createDraft({
          caption,
          hashtags,
          photoPaths,
          pageId: selectedPage?.page_id || "",
        });
        setDrafts(await api.getDrafts());
        notify("Draft saved!", "success");
      } catch (err) {
        notify(`Draft save failed: ${err.message}`, "error");
      }
      return;
    }

    if (!selectedPages.length) {
      notify("Please connect and select at least one Facebook Page first", "error");
      return;
    }

    setIsPublishing(true);
    try {
      let scheduledTime = 0;
      if (publishMode === "schedule") {
        if (!scheduleDate || !scheduleTime) {
          notify("Please select a date and time for scheduling", "error");
          setIsPublishing(false);
          return;
        }
        scheduledTime = Math.floor(new Date(`${scheduleDate}T${scheduleTime}`).getTime() / 1000);
      }

      const { job_id } = await api.publishPost({
        pageId: selectedPages[0].page_id,
        pageIds: selectedPages.map((pg) => pg.page_id),
        caption,
        hashtags,
        photoPaths,
        videoPath: videoItem ? videoItem.videoPath : "",
        mediaType,
        videoTitle,
        scheduledPublishTime: scheduledTime,
      });
      const totalUnits = mediaType === "photo" ? Math.max(1, photoPaths.length) * selectedPages.length : selectedPages.length;
      setPublishProgress({
        completed: 0,
        total: totalUnits,
        percent: 0,
        status: "uploading",
      });
      await new Promise((resolve, reject) => {
        const started = Date.now();
        const poll = async () => {
          try {
            const progress = await api.getPublishProgress(job_id);
            setPublishProgress(progress);
            if (progress.status === "complete") {
              setHistory(await api.getPublishHistory());
                      const pageCount = selectedPages.length;
                      notify(
                        publishMode === "schedule"
                          ?                           `Post scheduled for ${pageCount} Page${pageCount > 1 ? "s" : ""}!`
                          : `Post published to ${pageCount} Page${pageCount > 1 ? "s" : ""}! 🎉`,
                        "success"
                      );
              resolve();
            } else if (progress.status === "failed") {
              reject(new Error(progress.error || "Publishing failed"));
            } else if (Date.now() - started > 15 * 60 * 1000) {
              reject(new Error("Publishing timed out. Check Facebook history."));
            } else {
              setTimeout(poll, 500);
            }
          } catch (error) {
            reject(error);
          }
        };
        poll();
      });
    } catch (err) {
      notify(`Publishing failed: ${err.message}`, "error");
    }
    setIsPublishing(false);
    setPublishProgress(null);
  };

  // ──── Load draft ────
  const loadDraft = (draft) => {
    setCaption(draft.caption || "");
    setHashtags(draft.hashtags || []);
    if (draft.photo_paths?.length) {
      setPhotos(draft.photo_paths.map((p, i) => ({
        id: `draft-${i}`,
        path: p,
        name: p.split(/[\\/]/).pop(),
        thumb: api.getThumbnailUrl(p),
      })));
    }
    setActiveTab("compose");
    notify("Draft loaded");
  };

  const handleDeleteDraft = async (draftId) => {
    try {
      await api.deleteDraft(draftId);
      setDrafts(await api.getDrafts());
      notify("Draft deleted");
    } catch (err) {
      notify(`Delete failed: ${err.message}`, "error");
    }
  };

  // ──── Computed ────
  const fullPostText = caption + (hashtags.length ? "\n\n" + hashtags.join(" ") : "");
  const charCount = fullPostText.length;
  const selectedCount = selectedPhotos.size || photos.length;

  if (!isOpen) return null;

  return (
    <div className="pc-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="pc-modal">
        {/* ──── Header ──── */}
        <header className="pc-header">
          <div className="pc-header__left">
            <span className="pc-header__icon"><Icon name="edit" size={18} /></span>
            <div>
              <h2 className="pc-header__title">Post Composer</h2>
              <p className="pc-header__sub">Create, preview & publish to Facebook Pages</p>
            </div>
          </div>
          <button className="pc-close" onClick={onClose} aria-label="Close">✕</button>
        </header>

        {/* ──── Tabs ──── */}
        <nav className="pc-tabs">
          {[
            { id: "compose", label: "Compose", icon: "edit" },
            { id: "drafts", label: "Drafts", icon: "layers", count: drafts.length },
            { id: "pages", label: "Pages", icon: "folder", count: pages.length },
            { id: "history", label: "History", icon: "clock", count: history.length },
          ].map((tab) => (
            <button
              key={tab.id}
              className={`pc-tab ${activeTab === tab.id ? "pc-tab--active" : ""}`}
              onClick={() => setActiveTab(tab.id)}
            >
              <Icon name={tab.icon} size={15} />
              <span>{tab.label}</span>
              {tab.count > 0 && <span className="pc-tab__badge">{tab.count}</span>}
            </button>
          ))}
        </nav>

        {/* ──── Notification ──── */}
        {notification && (
          <div className={`pc-notification pc-notification--${notification.type}`}>
            {notification.type === "success" ? "✓" : notification.type === "error" ? "✗" : "ℹ"}{" "}
            {notification.msg}
          </div>
        )}

        {/* ──── Tab Content ──── */}
        <div className="pc-body">
          {/* ═══════ COMPOSE TAB ═══════ */}
          {activeTab === "compose" && (
            <div className="pc-compose">
              <div className="pc-compose__grid">
                {/* Left column: Media Selection + Preview */}
                <div className="pc-compose__left">
                  {/* Media Type Switcher */}
                  <div className="pc-media-switcher">
                    <button
                      className={`pc-media-btn ${mediaType === "photo" ? "is-active" : ""}`}
                      onClick={() => setMediaType("photo")}
                    >
                      📸 Photo Post
                    </button>
                    <button
                      className={`pc-media-btn ${mediaType === "reel" ? "is-active" : ""}`}
                      onClick={() => setMediaType("reel")}
                    >
                      📱 Facebook Reel (9:16)
                    </button>
                    <button
                      className={`pc-media-btn ${mediaType === "video" ? "is-active" : ""}`}
                      onClick={() => setMediaType("video")}
                    >
                      🖥️ Standard Video (16:9)
                    </button>
                  </div>

                  {/* Video Selection */}
                  {mediaType !== "photo" ? (
                    <section className="pc-section">
                      <div className="pc-section__head">
                        <h3>
                          {mediaType === "reel" ? "📱 Facebook Reel Video" : "🖥️ Standard Facebook Video"}
                        </h3>
                        {videoItem && (
                          <button
                            className="pc-btn pc-btn--sm pc-btn--danger"
                            onClick={() => setVideoItem(null)}
                          >
                            Remove Video
                          </button>
                        )}
                      </div>
                      {videoItem ? (
                        <div className="pc-video-card">
                          <video
                            src={videoItem.streamUrl}
                            controls
                            className="pc-video-player"
                            style={{
                              width: "100%",
                              maxHeight: mediaType === "reel" ? "240px" : "180px",
                              borderRadius: "8px",
                              background: "#000",
                            }}
                          />
                          <div className="pc-video-card__meta" style={{ display: "flex", justifyContent: "space-between", marginTop: "8px" }}>
                            <span className="badge badge--success">
                              {mediaType === "reel" ? "9:16 Vertical Reel" : "Landscape/Standard Video"}
                            </span>
                            <span style={{ fontSize: "12px", opacity: 0.8 }}>Duration: {Math.round(videoItem.duration || 0)}s</span>
                          </div>
                          {mediaType === "video" && (
                            <div className="pc-field" style={{ marginTop: "10px" }}>
                              <label className="pc-label">Video Title (Required for Facebook Videos)</label>
                              <input
                                className="pc-input"
                                placeholder="Enter an eye-catching video title..."
                                value={videoTitle}
                                onChange={(e) => setVideoTitle(e.target.value)}
                              />
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="pc-empty-photos" onClick={() => fileInputRef.current?.click()}>
                          <span className="pc-empty-photos__icon">🎬</span>
                          <p>No video selected. Upload or export from <b>Video Studio</b>.</p>
                          <input
                            ref={fileInputRef}
                            type="file"
                            accept="video/*"
                            hidden
                            onChange={async (e) => {
                              const f = e.target.files?.[0];
                              if (!f) return;
                              try {
                                notify("Uploading video...", "info");
                                const meta = await api.uploadVideoClip(f);
                                setVideoItem({
                                  videoPath: meta.path,
                                  videoName: f.name,
                                  streamUrl: meta.stream_url,
                                  duration: meta.duration,
                                  aspectRatio: meta.aspect_ratio,
                                });
                                setVideoTitle(f.name.replace(/\.[^/.]+$/, ""));
                                notify("Video loaded for publishing!", "success");
                              } catch (err) {
                                notify(`Upload failed: ${err.message}`, "error");
                              }
                            }}
                          />
                        </div>
                      )}
                    </section>
                  ) : (
                    /* Photo Selection */
                    <section className="pc-section">
                      <div className="pc-section__head">
                        <h3>📸 Photos ({selectedCount} selected)</h3>
                        <div className="pc-section__actions">
                          <button className="pc-btn pc-btn--sm" onClick={() => fileInputRef.current?.click()}>
                            + Add
                          </button>
                          <input ref={fileInputRef} type="file" multiple accept="image/*" hidden onChange={handleFileSelect} />
                          {photos.length > 0 && (
                            <>
                              <button className="pc-btn pc-btn--sm pc-btn--ghost" onClick={selectAllPhotos}>
                                {selectedPhotos.size === photos.length ? "Deselect All" : "Select All"}
                              </button>
                              {selectedPhotos.size > 0 && (
                                <button className="pc-btn pc-btn--sm pc-btn--danger" onClick={removeSelectedPhotos}>
                                  Remove
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                      {photos.length === 0 ? (
                        <div className="pc-empty-photos" onClick={() => fileInputRef.current?.click()}>
                          <span className="pc-empty-photos__icon">🖼️</span>
                          <p>Click to add photos or load from processed output</p>
                        </div>
                      ) : (
                        <div className="pc-photo-grid">
                          {photos.map((photo) => (
                            <div
                              key={photo.id}
                              className={`pc-photo-thumb ${selectedPhotos.has(photo.id) ? "pc-photo-thumb--selected" : ""} ${photo.uploading ? "pc-photo-thumb--uploading" : ""}`}
                              onClick={() => togglePhotoSelection(photo.id)}
                            >
                              <img src={photo.thumb} alt={photo.name} loading="lazy" />
                              {photo.uploading && (
                                <div className="pc-photo-thumb__uploading">
                                  <span className="pc-spinner" />
                                </div>
                              )}
                              <div className="pc-photo-thumb__check">
                                {selectedPhotos.has(photo.id) ? "✓" : photo.path ? "✓" : ""}
                              </div>
                              <span className="pc-photo-thumb__name">{photo.name}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </section>
                  )}

                  {/* Post Preview */}
                  <section className="pc-section">
                    <h3>👁️ Post Preview</h3>
                    <div className="pc-preview">
                      <div className="pc-preview__header">
                        <div className="pc-preview__avatar">
                          {selectedPage?.picture_url ? (
                            <img src={selectedPage.picture_url} alt="" />
                          ) : (
                            <Icon name="folder" size={18} />
                          )}
                        </div>
                        <div>
                          <strong>{selectedPage?.page_name || "Your Page"}</strong>
                          <span className="pc-preview__meta">
                            Just now · 🌐 {mediaType === "reel" ? "· 📱 Reel" : mediaType === "video" ? "· 🎥 Video" : ""}
                          </span>
                        </div>
                      </div>
                      {fullPostText && (
                        <div className="pc-preview__text">
                          {fullPostText.split("\n").map((line, i) => (
                            <React.Fragment key={i}>
                              {line}
                              {i < fullPostText.split("\n").length - 1 && <br />}
                            </React.Fragment>
                          ))}
                        </div>
                      )}
                      {mediaType !== "photo" && videoItem ? (
                        <div className="pc-preview__video-wrap" style={{ textAlign: "center", margin: "10px 0" }}>
                          <video
                            src={videoItem.streamUrl}
                            controls
                            style={{
                              width: "100%",
                              maxHeight: mediaType === "reel" ? "320px" : "200px",
                              borderRadius: "6px",
                              background: "#000",
                            }}
                          />
                          {mediaType === "video" && videoTitle && (
                            <h4 style={{ margin: "8px 0 4px", fontSize: "14px", fontWeight: "600" }}>{videoTitle}</h4>
                          )}
                        </div>
                      ) : null}
                      {photos.length > 0 && (
                        <div className={`pc-preview__images pc-preview__images--${Math.min(photos.length, 4)}`}>
                          {photos.slice(0, 4).map((p, i) => (
                            <div key={p.id} className="pc-preview__img-wrap">
                              <img src={p.thumb} alt="" />
                              {i === 3 && photos.length > 4 && (
                                <div className="pc-preview__more">+{photos.length - 4}</div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="pc-preview__actions">
                        <span>👍 Like</span>
                        <span>💬 Comment</span>
                        <span>↗️ Share</span>
                      </div>
                    </div>
                  </section>
                </div>

                {/* Right column: Caption + Hashtags + Publish */}
                <div className="pc-compose__right">
                  {/* Caption */}
                  <section className="pc-section">
                    <div className="pc-section__head">
                      <h3><Icon name="edit" size={16} /> Caption</h3>
                      <button className="pc-btn pc-btn--sm pc-btn--ghost" onClick={() => setShowCaptionSettings((open) => !open)}>
                        AI settings
                      </button>
                      <span className="pc-char-count" data-warn={charCount > 60000}>{charCount.toLocaleString()}</span>
                    </div>

                    {showCaptionSettings && (
                      <div className="pc-ai-settings">
                        <div className="pc-ai-settings__row">
                          <label className="pc-label">Generator</label>
                          <select className="pc-select" value={captionProvider} onChange={(e) => setCaptionProvider(e.target.value)}>
                            <option value="rule-based">Local offline</option>
                            <option value="local-vlm">Local vision model</option>
                            <option value="online">Online text AI</option>
                          </select>
                        </div>
                        {captionProvider === "online" && (
                          <>
                            <div className="pc-ai-settings__row">
                              <label className="pc-label">Provider</label>
                              <select className="pc-select" value={captionConfig.provider} onChange={(e) => setCaptionConfig((c) => ({ ...c, provider: e.target.value }))}>
                                <option value="gemini">Google Gemini</option>
                                <option value="openai-compatible">OpenAI-compatible</option>
                              </select>
                            </div>
                            <input className="pc-input" placeholder="Model name" value={captionConfig.model} onChange={(e) => setCaptionConfig((c) => ({ ...c, model: e.target.value }))} />
                            <input className="pc-input" placeholder="API key (stored locally)" type="password" value={captionConfig.api_key} onChange={(e) => setCaptionConfig((c) => ({ ...c, api_key: e.target.value }))} />
                            <input className="pc-input" placeholder="API base URL" value={captionConfig.base_url} onChange={(e) => setCaptionConfig((c) => ({ ...c, base_url: e.target.value }))} />
                            <div className="pc-ai-settings__actions">
                              <button className="pc-btn pc-btn--sm pc-btn--accent" onClick={async () => {
                                try {
                                  await api.saveCaptionConfig(captionConfig);
                                  setCaptionConnection({ ok: true, message: "Saved locally" });
                                } catch (err) {
                                  setCaptionConnection({ ok: false, message: err.message });
                                }
                              }}>Save locally</button>
                              <button className="pc-btn pc-btn--sm pc-btn--ghost" onClick={async () => {
                                try {
                                  const result = await api.testCaptionConnection({
                                    ...captionConfig,
                                    provider: captionConfig.provider === "openai-compatible"
                                      ? "openai-compatible"
                                      : "gemini",
                                  });
                                  setCaptionConnection({ ok: true, message: `Connected: ${result.model_name}` });
                                } catch (err) {
                                  setCaptionConnection({ ok: false, message: err.message });
                                }
                              }}>Test connection</button>
                            </div>
                            {captionConnection && <small className={captionConnection.ok ? "pc-ai-status--ok" : "pc-ai-status--error"}>{captionConnection.message}</small>}
                          </>
                        )}
                      </div>
                    )}

                    <label className="pc-label" htmlFor="caption-prompt">Caption prompt</label>
                    <textarea
                      id="caption-prompt"
                      className="pc-textarea pc-caption-prompt"
                      placeholder="Tell the AI exactly what caption to write..."
                      value={captionPrompt}
                      onChange={(e) => setCaptionPrompt(e.target.value)}
                      rows={3}
                    />

                    <div className="pc-caption-area">
                      <textarea
                        ref={captionRef}
                        className="pc-textarea"
                        placeholder="Generated caption will appear here. You can edit it before posting."
                        value={caption}
                        onChange={(e) => setCaption(e.target.value)}
                        rows={5}
                      />
                      <button
                        className="pc-btn pc-btn--accent pc-btn--generate"
                        onClick={handleGenerateCaption}
                        disabled={isGeneratingCaption}
                      >
                        {isGeneratingCaption ? (
                          <><span className="pc-spinner" /> Generating...</>
                        ) : (
                          <><Icon name="sparkle" size={14} /> Generate Caption</>
                        )}
                      </button>
                    </div>
                  </section>

                  {/* Hashtags */}
                  <section className="pc-section">
                    <div className="pc-section__head">
                      <h3># Hashtags ({hashtags.length})</h3>
                      {hashtags.length > 0 && (
                        <div className="pc-section__actions">
                          <button
                            className="pc-btn pc-btn--sm pc-btn--ghost"
                            onClick={() => {
                              navigator.clipboard.writeText(hashtags.join(" "));
                              notify("Hashtags copied!");
                            }}
                          >
                            <><Icon name="layers" size={14} /> Copy</>
                          </button>
                          <button
                            className="pc-btn pc-btn--sm pc-btn--ghost"
                            onClick={() => setShowHashtagSetSave(true)}
                          >
                            💾 Save Set
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Category selector */}
                    <div className="pc-style-pills">
                      {HASHTAG_CATEGORIES.map((cat) => (
                        <button
                          key={cat}
                          className={`pc-pill ${hashtagCategory === cat ? "pc-pill--active" : ""}`}
                          onClick={() => setHashtagCategory(cat)}
                        >
                          {cat}
                        </button>
                      ))}
                    </div>

                    <div className="pc-hashtag-input-row">
                      <input
                        className="pc-input"
                        placeholder="Add hashtag..."
                        value={hashtagInput}
                        onChange={(e) => setHashtagInput(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && addHashtag()}
                      />
                      <button className="pc-btn pc-btn--sm" onClick={addHashtag}>Add</button>
                      <button
                        className="pc-btn pc-btn--accent pc-btn--sm"
                        onClick={handleGenerateHashtags}
                        disabled={isGeneratingHashtags}
                      >
                        {isGeneratingHashtags ? "..." : <><Icon name="sparkle" size={14} /> Generate</>}
                      </button>
                    </div>

                    {/* Hashtag tags */}
                    {hashtags.length > 0 && (
                      <div className="pc-hashtag-cloud">
                        {hashtags.map((tag) => (
                          <span key={tag} className="pc-hashtag-tag">
                            {tag}
                            <button onClick={() => removeHashtag(tag)}>✕</button>
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Saved sets */}
                    {hashtagSets.length > 0 && (
                      <div className="pc-hashtag-sets">
                        <small className="pc-label">Saved Sets:</small>
                        <div className="pc-hashtag-sets__list">
                          {hashtagSets.map((set) => (
                            <div key={set.id} className="pc-hashtag-set-item">
                              <button className="pc-btn pc-btn--sm pc-btn--ghost" onClick={() => loadHashtagSet(set)}>
                                {set.name} ({set.hashtags.length})
                              </button>
                              <button className="pc-btn pc-btn--sm pc-btn--icon" onClick={() => handleDeleteHashtagSet(set.id)}>
                                🗑️
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Save set modal */}
                    {showHashtagSetSave && (
                      <div className="pc-inline-form">
                        <input
                          className="pc-input"
                          placeholder="Set name..."
                          value={hashtagSetName}
                          onChange={(e) => setHashtagSetName(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && handleSaveHashtagSet()}
                          autoFocus
                        />
                        <button className="pc-btn pc-btn--sm pc-btn--accent" onClick={handleSaveHashtagSet}>Save</button>
                        <button className="pc-btn pc-btn--sm pc-btn--ghost" onClick={() => setShowHashtagSetSave(false)}>Cancel</button>
                      </div>
                    )}
                  </section>

                  {/* Publish Controls */}
                  <section className="pc-section pc-publish-section">
                    <h3><Icon name="upload" size={16} /> Publish</h3>

                    {/* Page selector */}
                    <div className="pc-page-selector">
                      <label className="pc-label">Publish to:</label>
                      {pages.length > 0 ? (
                        <details className="pc-page-dropdown">
                          <summary>
                            <span>
                              {selectedPages.length
                                ? `${selectedPages.length} Page${selectedPages.length > 1 ? "s" : ""} selected`
                                : "Select Pages..."}
                            </span>
                            <span className="pc-page-dropdown__chevron">⌄</span>
                          </summary>
                          <div className="pc-page-dropdown__menu">
                            {pages.map((pg) => {
                              const checked = selectedPages.some((selected) => selected.page_id === pg.page_id);
                              return (
                                <label key={pg.page_id} className="pc-page-checkbox">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => setSelectedPages((prev) =>
                                      checked
                                        ? prev.filter((selected) => selected.page_id !== pg.page_id)
                                        : [...prev, pg]
                                    )}
                                  />
                                  <span>{pg.page_name} ({pg.category || "Page"})</span>
                                </label>
                              );
                            })}
                          </div>
                        </details>
                      ) : (
                        <button
                          className="pc-btn pc-btn--accent pc-btn--sm"
                          onClick={() => setShowConnectModal(true)}
                        >
                          <><Icon name="folder" size={14} /> Connect Facebook Page</>
                        </button>
                      )}
                    </div>

                    {/* Publish mode */}
                    <div className="pc-publish-modes">
                      {[
                        { id: "now", label: "Publish Now", icon: "upload" },
                        { id: "schedule", label: "Schedule", icon: "clock" },
                        { id: "draft", label: "Save Draft", icon: "layers" },
                      ].map((m) => (
                        <button
                          key={m.id}
                          className={`pc-mode-btn ${publishMode === m.id ? "pc-mode-btn--active" : ""}`}
                          onClick={() => setPublishMode(m.id)}
                        >
                          <Icon name={m.icon} size={14} /> {m.label}
                        </button>
                      ))}
                    </div>

                    {/* Schedule inputs */}
                    {publishMode === "schedule" && (
                      <div className="pc-schedule-row">
                        <input
                          type="date"
                          className="pc-input pc-input--date"
                          value={scheduleDate}
                          onChange={(e) => setScheduleDate(e.target.value)}
                        />
                        <input
                          type="time"
                          className="pc-input pc-input--time"
                          value={scheduleTime}
                          onChange={(e) => setScheduleTime(e.target.value)}
                        />
                      </div>
                    )}

                    {/* Publish button */}
                    <button
                      className={`pc-btn pc-btn--publish ${publishMode === "draft" ? "pc-btn--secondary" : "pc-btn--accent"}`}
                      onClick={handlePublish}
                      disabled={
                        isPublishing ||
                        (publishMode !== "draft" && (
                          mediaType === "photo"
                            ? !photos.length
                            : !videoItem?.videoPath
                        )) ||
                        (publishMode !== "draft" && !selectedPages.length)
                      }
                    >
                      {isPublishing ? (
                        <><span className="pc-spinner" /> {publishProgress ? `Uploading ${publishProgress.completed}/${publishProgress.total} (${publishProgress.percent}%)` : "Starting publish..."}</>
                      ) : publishMode === "now" ? (
                        <><Icon name="upload" size={15} /> Publish Now</>
                      ) : publishMode === "schedule" ? (
                        <><Icon name="clock" size={15} /> Schedule Post</>
                      ) : (
                        "Save as Draft"
                      )}
                    </button>
                    {isPublishing && publishProgress && (
                      <div className="pc-publish-progress" aria-live="polite">
                        <div className="pc-publish-progress__bar">
                          <div style={{ width: `${publishProgress.percent}%` }} />
                        </div>
                        <div className="pc-publish-progress__summary">
                          <span>{publishProgress.percent}% uploaded · {formatEta(publishProgress.eta_seconds)}</span>
                          <span>{publishProgress.completed}/{publishProgress.total} photo uploads</span>
                        </div>
                        {publishProgress.pages && (
                          <div className="pc-page-progress-list">
                            {Object.values(publishProgress.pages).map((page) => (
                              <div className="pc-page-progress" key={page.page_id}>
                                <div className="pc-page-progress__head">
                                  <span>{page.page_name}</span>
                                  <span className={`pc-page-progress__status pc-page-progress__status--${page.status}`}>
                                    {page.status === "failed" ? "Failed" : page.status === "complete" || page.status === "published" || page.status === "scheduled" ? "Complete" : `${page.percent}%`}
                                  </span>
                                </div>
                                <div className="pc-page-progress__bar">
                                  <div className={`pc-page-progress__fill pc-page-progress__fill--${page.status}`} style={{ width: `${page.percent}%` }} />
                                </div>
                                <small>
                                  {page.status === "failed" ? page.error : `${page.completed}/${page.total} photos`}
                                </small>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </section>
                </div>
              </div>
            </div>
          )}

          {/* ═══════ DRAFTS TAB ═══════ */}
          {activeTab === "drafts" && (
            <div className="pc-drafts">
              {drafts.length === 0 ? (
                <div className="pc-empty-state">
                  <span className="pc-empty-state__icon"><Icon name="layers" size={24} /></span>
                  <p>No drafts yet</p>
                  <small>Saved drafts will appear here</small>
                </div>
              ) : (
                <div className="pc-draft-list">
                  {drafts.map((draft) => (
                    <div key={draft.id} className="pc-draft-card">
                      <div className="pc-draft-card__top">
                        <span className={`pc-status-badge pc-status-badge--${draft.status}`}>
                          {draft.status}
                        </span>
                        <span className="pc-draft-card__date">
                          {new Date(draft.updated_at * 1000).toLocaleDateString()}
                        </span>
                      </div>
                      <p className="pc-draft-card__caption">
                        {draft.caption ? draft.caption.slice(0, 120) + (draft.caption.length > 120 ? "…" : "") : "(No caption)"}
                      </p>
                      <div className="pc-draft-card__meta">
                        <span>📸 {draft.photo_paths?.length || 0} photos</span>
                        <span># {draft.hashtags?.length || 0} tags</span>
                      </div>
                      <div className="pc-draft-card__actions">
                        <button className="pc-btn pc-btn--sm pc-btn--accent" onClick={() => loadDraft(draft)}>
                          Load
                        </button>
                        <button className="pc-btn pc-btn--sm pc-btn--danger" onClick={() => handleDeleteDraft(draft.id)}>
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ═══════ PAGES TAB ═══════ */}
          {activeTab === "pages" && (
            <div className="pc-pages">
              <div className="pc-pages__header">
                <h3>Connected Facebook Pages</h3>
                <button className="pc-btn pc-btn--accent" onClick={() => setShowConnectModal(true)}>
                  + Connect Page
                </button>
              </div>

              {pages.length === 0 ? (
                <div className="pc-empty-state">
                  <span className="pc-empty-state__icon"><Icon name="folder" size={24} /></span>
                  <p>No pages connected</p>
                  <small>Connect a Facebook Page to start publishing</small>
                </div>
              ) : (
                <div className="pc-page-list">
                  {pages.map((pg) => (
                    <div key={pg.page_id} className="pc-page-card">
                      <div className="pc-page-card__avatar">
                        {pg.picture_url ? <img src={pg.picture_url} alt="" /> : <Icon name="folder" size={20} />}
                      </div>
                      <div className="pc-page-card__info">
                        <strong>{pg.page_name}</strong>
                        <span>{pg.category || "Page"}</span>
                        <small>Token: {pg.access_token}</small>
                      </div>
                      <button
                        className="pc-btn pc-btn--sm pc-btn--danger"
                        onClick={() => handleDisconnectPage(pg.page_id)}
                      >
                        Disconnect
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Connect Modal */}
              {showConnectModal && (
                <div className="pc-connect-overlay" onClick={(e) => e.target === e.currentTarget && setShowConnectModal(false)}>
                  <div className="pc-connect-modal">
                    <h3>Connect Facebook Page</h3>
                    <p className="pc-connect-desc">
                      Paste your Facebook Page Access Token or User Access Token to connect.
                    </p>

                    <div className="pc-connect-mode-switch">
                      <button
                        className={`pc-pill ${connectMode === "page" ? "pc-pill--active" : ""}`}
                        onClick={() => setConnectMode("page")}
                      >
                        Page Token
                      </button>
                      <button
                        className={`pc-pill ${connectMode === "user" ? "pc-pill--active" : ""}`}
                        onClick={() => setConnectMode("user")}
                      >
                        User Token (All Pages)
                      </button>
                    </div>

                    <textarea
                      className="pc-textarea"
                      placeholder={connectMode === "page"
                        ? "Paste Page Access Token here..."
                        : "Paste User Access Token here (will discover all your managed pages)..."}
                      value={tokenInput}
                      onChange={(e) => setTokenInput(e.target.value)}
                      rows={3}
                    />

                    <div className="pc-connect-actions">
                      <button
                        className="pc-btn pc-btn--accent"
                        onClick={handleConnectPage}
                        disabled={isConnecting || !tokenInput.trim()}
                      >
                        {isConnecting ? "Connecting..." : "Connect"}
                      </button>
                      <button className="pc-btn pc-btn--ghost" onClick={() => setShowConnectModal(false)}>
                        Cancel
                      </button>
                    </div>

                    <div className="pc-connect-help">
                      <details>
                        <summary>How to get an access token?</summary>
                        <ol>
                          <li>Go to <a href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noreferrer">Facebook Graph API Explorer</a></li>
                          <li>Select your app and generate a User Token</li>
                          <li>Grant <code>pages_manage_posts</code>, <code>pages_read_engagement</code> permissions</li>
                          <li>Copy the token and paste it above</li>
                          <li>For a long-lived token, exchange it via the API</li>
                        </ol>
                      </details>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ═══════ HISTORY TAB ═══════ */}
          {activeTab === "history" && (
            <div className="pc-history">
              {history.length === 0 ? (
                <div className="pc-empty-state">
                  <span className="pc-empty-state__icon"><Icon name="clock" size={24} /></span>
                  <p>No publishing history</p>
                  <small>Published and scheduled posts will appear here</small>
                </div>
              ) : (
                <div className="pc-history-list">
                  {history.map((post) => (
                    <div key={post.id} className="pc-history-card">
                      <div className="pc-history-card__top">
                        <span className={`pc-status-badge pc-status-badge--${post.status}`}>
                          {post.status}
                        </span>
                        <span>{post.page_name || "Unknown Page"}</span>
                        <span className="pc-history-card__date">
                          {new Date(post.published_at * 1000).toLocaleString()}
                        </span>
                      </div>
                      <p className="pc-history-card__caption">
                        {post.caption ? post.caption.slice(0, 200) : "(No caption)"}
                      </p>
                      <div className="pc-history-card__meta">
                        <span>📸 {post.photo_paths?.length || 0} photos</span>
                        <span># {post.hashtags?.length || 0} tags</span>
                        {post.error && <span className="pc-error-text">Error: {post.error}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
