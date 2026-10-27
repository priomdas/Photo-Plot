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
  const [activeJobId, setActiveJobId] = useState(null);
  const cancelRequestedRef = useRef(false);

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
      setActiveJobId(job_id);
      cancelRequestedRef.current = false;
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
          if (cancelRequestedRef.current) {
            reject(new Error("Publishing was cancelled by user"));
            return;
          }
          try {
            const progress = await api.getPublishProgress(job_id);
            if (cancelRequestedRef.current || progress.status === "cancelled") {
              reject(new Error("Publishing was cancelled by user"));
              return;
            }
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
      if (!cancelRequestedRef.current) {
        notify(`Publishing failed: ${err.message}`, "error");
      }
    }
    setIsPublishing(false);
    setPublishProgress(null);
    setActiveJobId(null);
    cancelRequestedRef.current = false;
  };

  const handleCancelPublish = async () => {
    cancelRequestedRef.current = true;
    if (activeJobId) {
      try {
        await api.cancelPublish(activeJobId);
      } catch (err) {
        // ignore error
      }
    }
    notify("Upload cancelled", "info");
    setIsPublishing(false);
    setPublishProgress(null);
    setActiveJobId(null);
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
  const activePhotos = selectedPhotos.size > 0
    ? photos.filter((p) => selectedPhotos.has(p.id))
    : photos;

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
              <div className="pc-compose__3col">
                {/* Column 1: Post Type Navigation */}
                <aside className="pc-type-sidebar">
                  <h3 className="pc-type-sidebar__title">
                    <Icon name="layers" size={16} /> Create Post
                  </h3>
                  <div className="pc-type-nav">
                    {[
                      { id: "photo", label: "Photo Post", icon: "brand", desc: "Single or multi-photo" },
                      { id: "reel", label: "Facebook Reel", icon: "film", desc: "9:16 vertical short video" },
                      { id: "video", label: "Standard Video", icon: "film", desc: "16:9 widescreen video" },
                      { id: "story", label: "Story (9:16)", icon: "sparkle", desc: "24-hour vertical story" },
                    ].map((type) => {
                      const isActive = mediaType === type.id || (type.id === "reel" && mediaType === "reel");
                      return (
                        <button
                          key={type.id}
                          className={`pc-type-card ${isActive ? "pc-type-card--active" : ""}`}
                          onClick={() => setMediaType(type.id === "story" ? "reel" : type.id)}
                        >
                          <div className="pc-type-card__icon">
                            <Icon name={type.icon} size={18} />
                          </div>
                          <div className="pc-type-card__text">
                            <span className="pc-type-card__name">{type.label}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </aside>

                {/* Column 2: Center Editor */}
                <main className="pc-editor-col">
                  {/* Editor Header */}
                  <div className="pc-editor-head">
                    <h2>
                      Create {mediaType === "reel" ? "Facebook Reel" : mediaType === "video" ? "Standard Video" : "Photo Post"}
                    </h2>
                    {pages.length > 0 && (
                      <details className="pc-page-dropdown">
                        <summary className="pc-platform-btn">
                          <span>🌐 Change Platform ▾</span>
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
                                <span>{pg.page_name}</span>
                              </label>
                            );
                          })}
                        </div>
                      </details>
                    )}
                  </div>

                  {/* Media Drop & Selector Card */}
                  {mediaType !== "photo" ? (
                    <div className="pc-media-box">
                      {!videoItem ? (
                        <div className="pc-dropcard" onClick={() => fileInputRef.current?.click()}>
                          <div className="pc-dropcard__icon-wrap">
                            <Icon name="film" size={32} />
                          </div>
                          <h4>Upload video or select from Video Studio</h4>
                          <p>MP4, MOV, WebM (max 1GB)</p>
                          <button className="btn btn--primary pc-dropcard__btn">
                            Select Video
                          </button>
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
                      ) : (
                        <div className="pc-loaded-media-strip">
                          <div className="pc-loaded-media-thumb">
                            <video src={videoItem.streamUrl} />
                            <span className="pc-play-icon">▶</span>
                          </div>
                          <div className="pc-loaded-media-info">
                            <span className="pc-loaded-media-title">{videoTitle || videoItem.videoName}</span>
                            <span className="pc-loaded-media-meta">Duration: {Math.round(videoItem.duration || 0)}s</span>
                          </div>
                          <button className="icon-btn" onClick={() => setVideoItem(null)} title="Remove video">✕</button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="pc-media-box">
                      {photos.length === 0 ? (
                        <div className="pc-dropcard" onClick={() => fileInputRef.current?.click()}>
                          <div className="pc-dropcard__icon-wrap">
                            <Icon name="brand" size={32} />
                          </div>
                          <h4>Upload photos or select from workspace</h4>
                          <p>JPG, PNG, WebP (up to 50 photos)</p>
                          <button className="btn btn--primary pc-dropcard__btn">
                            Select Photos
                          </button>
                          <input ref={fileInputRef} type="file" multiple accept="image/*" hidden onChange={handleFileSelect} />
                        </div>
                      ) : (
                        <div className="pc-photo-grid">
                          {photos.map((photo) => (
                            <div
                              key={photo.id}
                              className={`pc-photo-thumb ${selectedPhotos.has(photo.id) ? "pc-photo-thumb--selected" : ""}`}
                              onClick={() => togglePhotoSelection(photo.id)}
                            >
                              <img src={photo.thumb} alt={photo.name} loading="lazy" />
                              <div className="pc-photo-thumb__check">
                                {selectedPhotos.has(photo.id) ? "✓" : "✓"}
                              </div>
                              <span className="pc-photo-thumb__name">{photo.name}</span>
                            </div>
                          ))}
                          <div className="pc-photo-add-more" onClick={() => fileInputRef.current?.click()}>
                            + Add more
                          </div>
                          <input ref={fileInputRef} type="file" multiple accept="image/*" hidden onChange={handleFileSelect} />
                        </div>
                      )}
                    </div>
                  )}

                  {/* Caption Section */}
                  <div className="pc-card-section">
                    <div className="pc-card-head">
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <span className="pc-card-title">Caption</span>
                        <span className="pc-ai-badge">AI</span>
                      </div>
                      <span className="pc-char-count">{charCount} / 5000</span>
                    </div>

                    <textarea
                      ref={captionRef}
                      className="pc-textarea pc-textarea--caption"
                      placeholder="Write your caption here..."
                      value={caption}
                      onChange={(e) => setCaption(e.target.value)}
                      rows={4}
                    />

                    <div className="pc-caption-toolbar">
                      <div className="pc-caption-tools">
                        <button className="pc-tool-btn" title="Emoji">😊</button>
                        <button className="pc-tool-btn" title="Mention">@</button>
                        <button className="pc-tool-btn" title="Hashtag">#</button>
                        <button className="link" onClick={() => setShowCaptionSettings((open) => !open)} style={{ fontSize: "0.75rem" }}>
                          AI Prompt
                        </button>
                      </div>

                      <button
                        className="btn btn--primary btn--sm pc-generate-btn"
                        onClick={handleGenerateCaption}
                        disabled={isGeneratingCaption}
                      >
                        {isGeneratingCaption ? (
                          <><span className="pc-spinner" /> Generating...</>
                        ) : (
                          <><Icon name="sparkle" size={14} /> Generate with AI</>
                        )}
                      </button>
                    </div>

                    {showCaptionSettings && (
                      <div className="pc-ai-settings" style={{ marginTop: "10px" }}>
                        <textarea
                          id="caption-prompt"
                          className="pc-textarea pc-caption-prompt"
                          placeholder="Tell AI what to write about..."
                          value={captionPrompt}
                          onChange={(e) => setCaptionPrompt(e.target.value)}
                          rows={2}
                        />
                      </div>
                    )}
                  </div>

                  {/* Hashtags Section */}
                  <div className="pc-card-section">
                    <div className="pc-card-head">
                      <span className="pc-card-title"># Hashtags</span>
                      {hashtags.length > 0 && (
                        <button
                          className="link"
                          onClick={() => {
                            navigator.clipboard.writeText(hashtags.join(" "));
                            notify("Hashtags copied!");
                          }}
                        >
                          Copy
                        </button>
                      )}
                    </div>

                    <div className="pc-hashtag-chips">
                      {["Photography", "Nature", "Travel", "Temple", "Event"].map((tag) => (
                        <button
                          key={tag}
                          className="pc-tag-chip"
                          onClick={() => {
                            if (!hashtags.includes(`#${tag}`)) setHashtags([...hashtags, `#${tag}`]);
                          }}
                        >
                          #{tag}
                        </button>
                      ))}
                      {hashtags.map((tag) => (
                        <span key={tag} className="pc-tag-chip pc-tag-chip--active">
                          {tag}
                          <button onClick={() => removeHashtag(tag)}>✕</button>
                        </span>
                      ))}
                      <button className="pc-tag-chip pc-tag-chip--add" onClick={() => {
                        const custom = prompt("Add hashtag:");
                        if (custom) addHashtag(custom.startsWith("#") ? custom : `#${custom}`);
                      }}>
                        + Add
                      </button>
                    </div>
                  </div>
                </main>

                {/* Column 3: Live Preview & Publish */}
                <aside className="pc-preview-col">
                  <div className="pc-preview-head">
                    <div className="pc-preview-title-wrap">
                      <h3>Preview</h3>
                      <span className="pc-preview-badge">
                        {mediaType === "reel" ? "Facebook Reel" : mediaType === "video" ? "Facebook Video" : mediaType === "story" ? "Facebook Story" : "Facebook Photo Post"}
                      </span>
                    </div>
                    <button className="icon-btn" onClick={onClose} title="Close">✕</button>
                  </div>

                  {/* Dynamic Preview Container */}
                  <div className="pc-preview-scroll-area">
                    {/* CASE 1: Photo Post (Authentic Facebook Feed Card) */}
                    {mediaType === "photo" && (
                      <div className="pc-fb-card">
                        <div className="pc-fb-head">
                          <div className="pc-fb-author">
                            <div className="pc-fb-avatar">
                              {selectedPage?.picture_url ? (
                                <img src={selectedPage.picture_url} alt="" />
                              ) : (
                                <Icon name="brand" size={16} />
                              )}
                            </div>
                            <div className="pc-fb-author-info">
                              <span className="pc-fb-name">{selectedPage?.page_name || "PhotoPilot Creator"}</span>
                              <span className="pc-fb-meta">Just now · 🌍 Public</span>
                            </div>
                          </div>
                          <div className="pc-fb-more">•••</div>
                        </div>

                        {/* Post Caption Text */}
                        <div className="pc-fb-text">
                          {fullPostText ? (
                            <span>{fullPostText}</span>
                          ) : (
                            <span className="pc-fb-placeholder-text">Write your caption to preview how it looks on Facebook...</span>
                          )}
                        </div>

                        {/* Photo Collage Layout */}
                        <div className="pc-fb-media">
                          {activePhotos.length === 0 ? (
                            <div className="pc-fb-empty">
                              <Icon name="brand" size={32} />
                              <span>No photos selected yet</span>
                              <small>Select photos from workspace or upload</small>
                            </div>
                          ) : activePhotos.length === 1 ? (
                            <div className="pc-fb-grid pc-fb-grid--1">
                              <img src={activePhotos[0].thumb} alt="Preview 1" className="pc-fb-img" />
                            </div>
                          ) : activePhotos.length === 2 ? (
                            <div className="pc-fb-grid pc-fb-grid--2">
                              <img src={activePhotos[0].thumb} alt="Preview 1" className="pc-fb-img" />
                              <img src={activePhotos[1].thumb} alt="Preview 2" className="pc-fb-img" />
                            </div>
                          ) : activePhotos.length === 3 ? (
                            <div className="pc-fb-grid pc-fb-grid--3">
                              <div className="pc-fb-grid__top">
                                <img src={activePhotos[0].thumb} alt="Preview 1" className="pc-fb-img" />
                              </div>
                              <div className="pc-fb-grid__row">
                                <img src={activePhotos[1].thumb} alt="Preview 2" className="pc-fb-img" />
                                <img src={activePhotos[2].thumb} alt="Preview 3" className="pc-fb-img" />
                              </div>
                            </div>
                          ) : (
                            <div className="pc-fb-grid pc-fb-grid--4">
                              <div className="pc-fb-grid__item"><img src={activePhotos[0].thumb} alt="1" className="pc-fb-img" /></div>
                              <div className="pc-fb-grid__item"><img src={activePhotos[1].thumb} alt="2" className="pc-fb-img" /></div>
                              <div className="pc-fb-grid__item"><img src={activePhotos[2].thumb} alt="3" className="pc-fb-img" /></div>
                              <div className="pc-fb-grid__item pc-fb-grid__item--more">
                                <img src={activePhotos[3].thumb} alt="4" className="pc-fb-img" />
                                {activePhotos.length > 4 && (
                                  <div className="pc-fb-more-overlay">
                                    +{activePhotos.length - 3}
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Engagement Stats Bar */}
                        <div className="pc-fb-stats">
                          <div className="pc-fb-reactions">
                            <span className="pc-fb-reaction-bubble pc-fb-reaction-bubble--like">👍</span>
                            <span className="pc-fb-reaction-bubble pc-fb-reaction-bubble--love">❤️</span>
                            <span className="pc-fb-reaction-count">{Math.max(12, activePhotos.length * 8)}</span>
                          </div>
                          <div className="pc-fb-counts">
                            <span>{Math.max(2, activePhotos.length)} comments</span> · <span>1 share</span>
                          </div>
                        </div>

                        {/* Action Buttons */}
                        <div className="pc-fb-actions">
                          <button className="pc-fb-action-btn"><span>👍</span> Like</button>
                          <button className="pc-fb-action-btn"><span>💬</span> Comment</button>
                          <button className="pc-fb-action-btn"><span>↗</span> Share</button>
                        </div>
                      </div>
                    )}

                    {/* CASE 2: Video Post (Facebook Feed Video Card) */}
                    {mediaType === "video" && (
                      <div className="pc-fb-card">
                        <div className="pc-fb-head">
                          <div className="pc-fb-author">
                            <div className="pc-fb-avatar">
                              {selectedPage?.picture_url ? (
                                <img src={selectedPage.picture_url} alt="" />
                              ) : (
                                <Icon name="brand" size={16} />
                              )}
                            </div>
                            <div className="pc-fb-author-info">
                              <span className="pc-fb-name">{selectedPage?.page_name || "PhotoPilot Creator"}</span>
                              <span className="pc-fb-meta">Just now · 🌍 Public</span>
                            </div>
                          </div>
                          <div className="pc-fb-more">•••</div>
                        </div>

                        <div className="pc-fb-text">
                          {fullPostText ? (
                            <span>{fullPostText}</span>
                          ) : (
                            <span className="pc-fb-placeholder-text">Write your caption to preview how it looks on Facebook...</span>
                          )}
                        </div>

                        <div className="pc-fb-video-wrap">
                          {videoItem ? (
                            <video
                              src={videoItem.streamUrl}
                              controls
                              className="pc-fb-video-player"
                            />
                          ) : (
                            <div className="pc-fb-empty pc-fb-empty--video">
                              <Icon name="film" size={40} />
                              <span>No video selected</span>
                              <small>Select or upload an MP4/MOV video</small>
                            </div>
                          )}
                        </div>

                        <div className="pc-fb-stats">
                          <div className="pc-fb-reactions">
                            <span className="pc-fb-reaction-bubble pc-fb-reaction-bubble--like">👍</span>
                            <span className="pc-fb-reaction-bubble pc-fb-reaction-bubble--love">❤️</span>
                            <span className="pc-fb-reaction-count">86</span>
                          </div>
                          <div className="pc-fb-counts">
                            <span>14 comments</span> · <span>8 shares</span>
                          </div>
                        </div>

                        <div className="pc-fb-actions">
                          <button className="pc-fb-action-btn"><span>👍</span> Like</button>
                          <button className="pc-fb-action-btn"><span>💬</span> Comment</button>
                          <button className="pc-fb-action-btn"><span>↗</span> Share</button>
                        </div>
                      </div>
                    )}

                    {/* CASE 3: Reel & Story (Vertical 9:16 Phone Mockup) */}
                    {(mediaType === "reel" || mediaType === "story") && (
                      <div className="pc-phone">
                        <div className="pc-phone__speaker" />
                        <div className="pc-phone__screen">
                          {/* Story Progress Indicators */}
                          {mediaType === "story" && (
                            <div className="pc-story-bars">
                              <div className="pc-story-bar pc-story-bar--filled" />
                              <div className="pc-story-bar pc-story-bar--active" />
                              <div className="pc-story-bar" />
                            </div>
                          )}

                          {/* Media view inside phone */}
                          {videoItem ? (
                            <video
                              src={videoItem.streamUrl}
                              controls
                              className="pc-phone__video"
                              autoPlay
                              muted
                              loop
                            />
                          ) : activePhotos.length > 0 ? (
                            <img src={activePhotos[0].thumb} alt="Preview" className="pc-phone__img" />
                          ) : (
                            <div className="pc-phone__placeholder">
                              <Icon name="film" size={40} />
                              <span>{mediaType === "reel" ? "No reel video selected" : "No story image selected"}</span>
                            </div>
                          )}

                          {/* Overlays */}
                          {mediaType === "reel" ? (
                            <div className="pc-phone__overlay">
                              <div className="pc-phone__side-actions">
                                <div className="pc-phone__action"><span className="pc-phone__emoji">❤️</span><small>Like</small></div>
                                <div className="pc-phone__action"><span className="pc-phone__emoji">💬</span><small>Comment</small></div>
                                <div className="pc-phone__action"><span className="pc-phone__emoji">↗</span><small>Share</small></div>
                              </div>

                              <div className="pc-phone__bottom">
                                <div className="pc-phone__author">
                                  <div className="pc-phone__avatar">
                                    {selectedPage?.picture_url ? (
                                      <img src={selectedPage.picture_url} alt="" />
                                    ) : (
                                      <Icon name="brand" size={14} />
                                    )}
                                  </div>
                                  <span className="pc-phone__author-name">{selectedPage?.page_name || "PhotoPilot Creator"}</span>
                                </div>
                                <p className="pc-phone__caption">
                                  {fullPostText ? fullPostText.slice(0, 110) + (fullPostText.length > 110 ? "..." : "") : "Write a caption to see it here..."}
                                </p>
                              </div>
                            </div>
                          ) : (
                            /* Story Overlay */
                            <div className="pc-phone__story-overlay">
                              <div className="pc-phone__story-head">
                                <div className="pc-phone__avatar">
                                  {selectedPage?.picture_url ? (
                                    <img src={selectedPage.picture_url} alt="" />
                                  ) : (
                                    <Icon name="brand" size={14} />
                                  )}
                                </div>
                                <span className="pc-phone__author-name">{selectedPage?.page_name || "PhotoPilot"}</span>
                                <span className="pc-story-time">Just now</span>
                              </div>
                              <div className="pc-story-foot">
                                <div className="pc-story-reply">Reply to {selectedPage?.page_name || "creator"}...</div>
                                <span className="pc-story-react">❤️</span>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Publishing Progress Card - Dedicated Full-Width */}
                  {isPublishing && publishProgress && (
                    <div className="pc-publish-card" aria-live="polite">
                      <div className="pc-publish-card__header">
                        <div className="pc-publish-card__title">
                          <span className="pc-pulse-dot" />
                          <span>
                            {publishProgress.status === "complete"
                              ? "Upload finished! Finalizing..."
                              : "Publishing to Facebook..."}
                          </span>
                        </div>
                        <div className="pc-publish-card__actions">
                          <span className="pc-publish-card__percent">{publishProgress.percent}%</span>
                          <button
                            type="button"
                            className="pc-publish-card__cancel-btn"
                            onClick={handleCancelPublish}
                            title="Cancel uploading to Facebook"
                          >
                            ✕ Cancel
                          </button>
                        </div>
                      </div>

                      <div className="pc-publish-card__bar-wrap">
                        <div
                          className="pc-publish-card__bar-fill"
                          style={{ width: `${Math.min(100, Math.max(0, publishProgress.percent))}%` }}
                        />
                      </div>

                      <div className="pc-publish-card__meta">
                        <span className="pc-publish-card__count">
                          📸 <strong>{publishProgress.completed}</strong> of <strong>{publishProgress.total}</strong> uploaded
                        </span>
                        {publishProgress.eta_seconds != null && publishProgress.eta_seconds > 0 && (
                          <span className="pc-publish-card__eta">
                            ⏱ ~{formatEta(publishProgress.eta_seconds)}
                          </span>
                        )}
                      </div>

                      {publishProgress.pages && Object.keys(publishProgress.pages).length > 1 && (
                        <div className="pc-publish-card__pages">
                          {Object.entries(publishProgress.pages).map(([pid, pinfo]) => (
                            <div key={pid} className="pc-publish-card__page-row">
                              <span className="pc-publish-card__page-name">📄 {pinfo.page_name}</span>
                              <span className="pc-publish-card__page-stat">
                                {pinfo.completed}/{pinfo.total} ({pinfo.percent}%)
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Bottom Action Buttons */}
                  <div className="pc-preview-foot">
                    <button
                      className="btn btn--secondary pc-btn-draft"
                      onClick={() => {
                        setPublishMode("draft");
                        handlePublish();
                      }}
                      disabled={isPublishing}
                    >
                      Save Draft
                    </button>
                    <button
                      className="btn btn--primary pc-publish-now-btn"
                      onClick={handlePublish}
                      disabled={isPublishing || (publishMode !== "draft" && !selectedPages.length && pages.length > 0)}
                    >
                      <span>
                        {isPublishing
                          ? `Publishing (${publishProgress?.percent || 0}%)...`
                          : "Publish Now"}
                      </span>
                      {!isPublishing && <span className="pc-publish-split">▾</span>}
                    </button>
                  </div>
                </aside>
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
