import React, { useCallback, useEffect, useRef, useState } from "react";
import * as api from "../../api";
import { Icon } from "../Icon";
import "./VideoStudio.css";

// ──── LUT & Filter Presets ────
const LUT_PRESETS = [
  { id: "none", label: "None", filter: "none", desc: "Original colors" },
  { id: "cinematic", label: "Cinematic", filter: "contrast(1.15) saturate(1.1) hue-rotate(-5deg)", desc: "Moody cinematic tone" },
  { id: "warm", label: "Warm Glow", filter: "sepia(0.2) saturate(1.2) brightness(1.05)", desc: "Golden hour sunset" },
  { id: "teal_orange", label: "Teal & Orange", filter: "contrast(1.2) saturate(1.25) hue-rotate(15deg)", desc: "Blockbuster Hollywood" },
  { id: "moody", label: "Moody Dark", filter: "contrast(1.3) brightness(0.9) saturate(0.85)", desc: "Dramatic shadows" },
  { id: "vibrant", label: "Vibrant Pop", filter: "saturate(1.5) contrast(1.1)", desc: "Punchy vivid colors" },
  { id: "black_white", label: "Monochrome", filter: "grayscale(1) contrast(1.2)", desc: "Classic timeless B&W" },
  { id: "vintage", label: "Vintage 90s", filter: "sepia(0.35) contrast(0.95) brightness(1.05)", desc: "Retro VHS aesthetic" },
];

// ──── CapCut-Style Transition Presets ────
const TRANSITION_PRESETS = [
  { id: "none", label: "Cut (None)", icon: "✂️", desc: "Direct hard cut between clips" },
  { id: "fade", label: "Cross Dissolve", icon: "✨", desc: "Smooth gradual crossfade" },
  { id: "smoothleft", label: "Smooth Left", icon: "⬅️", desc: "CapCut cinematic push left" },
  { id: "smoothright", label: "Smooth Right", icon: "➡️", desc: "CapCut cinematic push right" },
  { id: "smoothup", label: "Smooth Up", icon: "⬆️", desc: "Cinematic vertical push up" },
  { id: "smoothdown", label: "Smooth Down", icon: "⬇️", desc: "Cinematic vertical push down" },
  { id: "slideleft", label: "Slide Left", icon: "◀️", desc: "Fast dynamic slide left" },
  { id: "slideright", label: "Slide Right", icon: "▶️", desc: "Fast dynamic slide right" },
  { id: "wipeleft", label: "Wipe Left", icon: "🪟", desc: "Linear wipe from right to left" },
  { id: "wiperight", label: "Wipe Right", icon: "🪟", desc: "Linear wipe from left to right" },
  { id: "circlecrop", label: "Circle Iris", icon: "⚪", desc: "Circular opening mask reveal" },
  { id: "dissolve", label: "Film Dissolve", icon: "💫", desc: "Film grain dissolve" },
  { id: "fadeblack", label: "Dip to Black", icon: "🌑", desc: "Cinematic blackout & fade in" },
  { id: "fadewhite", label: "Dip to White", icon: "💡", desc: "Dramatic flash to white" },
  { id: "pixelize", label: "Pixelate", icon: "👾", desc: "Digital pixel mosaic transition" },
  { id: "zoomin", label: "Zoom Punch", icon: "🔍", desc: "High-energy zoom impact" },
  { id: "hblur", label: "Motion Blur", icon: "💨", desc: "Directional motion blur cut" },
];

// ──── Speed Ramping Presets ────
const SPEED_PRESETS = [
  { value: 0.25, label: "0.25x", tag: "Super Slow 🐌" },
  { value: 0.5, label: "0.5x", tag: "Slow Motion 🎬" },
  { value: 0.75, label: "0.75x", tag: "0.75x Subtle" },
  { value: 1.0, label: "1.0x", tag: "Normal Speed" },
  { value: 1.25, label: "1.25x", tag: "1.25x Brisk" },
  { value: 1.5, label: "1.5x", tag: "1.5x Fast" },
  { value: 2.0, label: "2.0x", tag: "2x Fast ⚡" },
  { value: 4.0, label: "4.0x", tag: "Timelapse 🚀" },
];

// ──── Stock BGM Library ────
const STOCK_BGM = [
  { id: "bgm_cinematic", name: "Cinematic Epic Horizon", genre: "Cinematic", duration: 25.0, icon: "🎬" },
  { id: "bgm_lofi", name: "Chill Lo-Fi Sunset", genre: "Lo-Fi", duration: 30.0, icon: "☕" },
  { id: "bgm_upbeat", name: "Upbeat Travel Vlog", genre: "Vlog Pop", duration: 20.0, icon: "✈️" },
  { id: "bgm_dramatic", name: "Dramatic Bass Swell", genre: "Trailer", duration: 15.0, icon: "⚡" },
];

// ──── Text Overlay Templates ────
const TEXT_PRESETS = [
  { id: "t_subscribe", text: "Double tap to subscribe ❤️", position: "bottom", color: "#ffffff", bgColor: "rgba(0,0,0,0.6)" },
  { id: "t_vlog", text: "TRAVEL VLOG 2026 🌴", position: "top", color: "#fbbf24", bgColor: "rgba(0,0,0,0.7)" },
  { id: "t_end", text: "Wait for the end... 😱", position: "center", color: "#f43f5e", bgColor: "rgba(0,0,0,0.8)" },
  { id: "t_title", text: "Cinematic Reel 🎬", position: "bottom", color: "#38bdf8", bgColor: "rgba(15,23,42,0.75)" },
];

export function VideoStudio({ onOpenComposer, notify, globalLogo = null }) {
  // ──── Tracks State (Multiple Timelines) ────
  const [tracks, setTracks] = useState([
    { id: "v1", type: "video", name: "V1 Video", locked: false, hidden: false, muted: false },
    { id: "t1", type: "text", name: "T1 Text", locked: false, hidden: false, muted: false },
    { id: "a1", type: "audio", name: "A1 Audio", locked: false, hidden: false, muted: false },
    { id: "a2", type: "audio", name: "A2 Music", locked: false, hidden: false, muted: false },
  ]);

  // ──── Media / Clips State ────
  const [clips, setClips] = useState([]);
  const [audioClips, setAudioClips] = useState([]);
  const [textOverlays, setTextOverlays] = useState([]);

  // ──── Selection State ────
  const [selectedClipIdx, setSelectedClipIdx] = useState(0);
  const [selectedAudioId, setSelectedAudioId] = useState("");
  const [selectedTextId, setSelectedTextId] = useState("");
  const [selectedTransitionCutIdx, setSelectedTransitionCutIdx] = useState(0);
  const [draggedClipIdx, setDraggedClipIdx] = useState(null);

  // ──── Studio Mode & Format ────
  const [aspectRatio, setAspectRatio] = useState("9:16"); // 9:16 | 16:9 | 1:1 | 4:5 | original
  const [targetResolution, setTargetResolution] = useState("1080p");
  const [leftTab, setLeftTab] = useState("media"); // media | audio | text | transitions | filters
  const [rightTab, setRightTab] = useState("clip"); // clip | speed | adjust | lut | transitions | audio | logo
  const [addTrackMenuOpen, setAddTrackMenuOpen] = useState(false);

  // ──── Player & Playhead State ────
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [timelineZoom, setTimelineZoom] = useState(1.0);
  const [isScrubbing, setIsScrubbing] = useState(false);

  // ──── Audio Levels ────
  const [muteOriginalAudio, setMuteOriginalAudio] = useState(false);
  const [origVolume, setOrigVolume] = useState(100);
  const [bgmVolume, setBgmVolume] = useState(100);

  // ──── Color Grading Adjustments ────
  const [adjustments, setAdjustments] = useState({
    brightness: 0,
    contrast: 0,
    saturation: 0,
    exposure: 0,
  });
  const [lutPreset, setLutPreset] = useState("none");

  // ──── Watermark / Logo ────
  const [logo, setLogo] = useState(globalLogo);
  const [logoPreviewUrl, setLogoPreviewUrl] = useState(null);
  const [logoPath, setLogoPath] = useState("");
  const [logoWidthRatio, setLogoWidthRatio] = useState(0.2);
  const [logoOpacity, setLogoOpacity] = useState(90);
  const [anchor, setAnchor] = useState("bottom-right");
  const [logoPos, setLogoPos] = useState({ x: null, y: null });
  const [isDraggingLogo, setIsDraggingLogo] = useState(false);

  // ──── Upload / Render State ────
  const [isUploadingClip, setIsUploadingClip] = useState(false);
  const [clipUploadProgress, setClipUploadProgress] = useState(null);
  const [isRendering, setIsRendering] = useState(false);
  const [renderProgress, setRenderProgress] = useState(null);
  const [lastRenderedVideo, setLastRenderedVideo] = useState(null);

  // ──── Refs ────
  const videoRef = useRef(null);
  const videoBoxRef = useRef(null);
  const timelineScrollRef = useRef(null);
  const fileInputClipsRef = useRef(null);
  const fileInputAudioRef = useRef(null);

  const activeClip = clips[selectedClipIdx] || null;

  // Safe notification helper
  const safeNotify = useCallback(
    (msg, tone = "info") => {
      if (typeof notify === "function") {
        try {
          notify(msg, tone);
        } catch {
          console.log(`[${tone}]`, msg);
        }
      } else {
        console.log(`[${tone}]`, msg);
      }
    },
    [notify]
  );

  // Sync playback rate with active clip speed
  useEffect(() => {
    if (videoRef.current && activeClip) {
      videoRef.current.playbackRate = activeClip.speed || 1.0;
    }
  }, [activeClip?.speed, selectedClipIdx]);

  // Sync logo preview URL
  useEffect(() => {
    if (logo) {
      if (typeof logo === "string") {
        setLogoPreviewUrl(logo);
      } else {
        const url = URL.createObjectURL(logo);
        setLogoPreviewUrl(url);
        return () => URL.revokeObjectURL(url);
      }
    } else {
      setLogoPreviewUrl(null);
    }
  }, [logo]);

  // Calculate total timeline duration across all video clips
  const totalTimelineDuration = clips.reduce((acc, c) => {
    const dur = (c.end_time - c.start_time) / (c.speed || 1.0);
    return acc + Math.max(0.5, dur);
  }, 0) || 10;

  const pxPerSec = Math.max(25, 75 * timelineZoom);

  // ──── Track Management ────
  const handleAddTrack = (type) => {
    const count = tracks.filter((t) => t.type === type).length + 1;
    const prefix = type === "video" ? "V" : type === "audio" ? "A" : "T";
    const label = type === "video" ? "Overlay" : type === "audio" ? "Track" : "Subtitles";
    const newTrack = {
      id: `${prefix.toLowerCase()}${count}`,
      type,
      name: `${prefix}${count} ${label}`,
      locked: false,
      hidden: false,
      muted: false,
    };
    setTracks((prev) => [...prev, newTrack]);
    setAddTrackMenuOpen(false);
    safeNotify(`Added track ${newTrack.name}`, "success");
  };

  const handleToggleTrack = (trackId, prop) => {
    setTracks((prev) =>
      prev.map((t) => (t.id === trackId ? { ...t, [prop]: !t[prop] } : t))
    );
  };

  const handleRemoveTrack = (trackId) => {
    if (tracks.length <= 2) {
      safeNotify("Must keep at least one video and one audio track", "warning");
      return;
    }
    setTracks((prev) => prev.filter((t) => t.id !== trackId));
    safeNotify("Track removed", "info");
  };

  // ──── Clip Reordering (Move Forward / Backward) ────
  const handleMoveClip = (idx, direction) => {
    const targetIdx = idx + direction;
    if (targetIdx < 0 || targetIdx >= clips.length) return;

    setClips((prev) => {
      const copy = [...prev];
      const [item] = copy.splice(idx, 1);
      copy.splice(targetIdx, 0, item);
      return copy;
    });
    setSelectedClipIdx(targetIdx);
    safeNotify(direction < 0 ? "Clip moved left ◀" : "Clip moved right ▶", "info");
  };

  // Drag & Drop Reordering
  const handleDragStart = (idx) => {
    setDraggedClipIdx(idx);
  };

  const handleDropOnClip = (targetIdx) => {
    if (draggedClipIdx === null || draggedClipIdx === targetIdx) return;
    setClips((prev) => {
      const copy = [...prev];
      const [item] = copy.splice(draggedClipIdx, 1);
      copy.splice(targetIdx, 0, item);
      return copy;
    });
    setSelectedClipIdx(targetIdx);
    setDraggedClipIdx(null);
    safeNotify("Clip reordered", "info");
  };

  // ──── Split Clip at Playhead ────
  const handleSplitClip = () => {
    if (!activeClip || !videoRef.current) return;
    const splitPoint = videoRef.current.currentTime;
    if (splitPoint <= activeClip.start_time + 0.3 || splitPoint >= activeClip.end_time - 0.3) {
      safeNotify("Cannot split too close to clip boundary", "warning");
      return;
    }

    const firstHalf = {
      ...activeClip,
      id: `clip-${Date.now()}-a`,
      end_time: Math.round(splitPoint * 100) / 100,
    };
    const secondHalf = {
      ...activeClip,
      id: `clip-${Date.now()}-b`,
      start_time: Math.round(splitPoint * 100) / 100,
      name: `${activeClip.name} (Part 2)`,
    };

    setClips((prev) => {
      const copy = [...prev];
      copy.splice(selectedClipIdx, 1, firstHalf, secondHalf);
      return copy;
    });
    safeNotify("Clip split at playhead ✂️", "success");
  };

  // ──── Duplicate Clip ────
  const handleDuplicateClip = (idx) => {
    const c = clips[idx];
    if (!c) return;
    const copy = {
      ...c,
      id: `clip-${Date.now()}-copy`,
      name: `${c.name} (Copy)`,
    };
    setClips((prev) => {
      const arr = [...prev];
      arr.splice(idx + 1, 0, copy);
      return arr;
    });
    safeNotify("Clip duplicated 📋", "info");
  };

  // ──── Remove Clip ────
  const handleRemoveClip = (idx) => {
    setClips((prev) => {
      const copy = prev.filter((_, i) => i !== idx);
      return copy;
    });
    setSelectedClipIdx((cur) => Math.max(0, cur - 1));
    safeNotify("Clip removed from timeline", "info");
  };

  // ──── Trim In/Out Update ────
  const handleTrimChange = (key, val) => {
    const num = parseFloat(val);
    if (isNaN(num)) return;
    setClips((prev) =>
      prev.map((c, i) => (i === selectedClipIdx ? { ...c, [key]: num } : c))
    );
  };

  // ──── Speed Control ────
  const handleSpeedChange = (speedVal) => {
    const s = parseFloat(speedVal);
    if (isNaN(s)) return;
    setClips((prev) =>
      prev.map((c, i) => (i === selectedClipIdx ? { ...c, speed: s } : c))
    );
    if (videoRef.current) {
      videoRef.current.playbackRate = s;
    }
  };

  // ──── Transition Selection ────
  const handleSetTransition = (transId) => {
    setClips((prev) =>
      prev.map((c, i) =>
        i === selectedTransitionCutIdx ? { ...c, transition_to_next: transId } : c
      )
    );
    safeNotify(`Transition set to ${transId}`, "info");
  };

  // ──── Audio Extraction from Video Clip ────
  const handleExtractAudio = async (clip) => {
    if (!clip) return;
    safeNotify("Extracting audio from video...", "info");
    try {
      let audioPath = clip.path;
      if (clip.path) {
        const res = await api.extractAudioFromClip(clip.path);
        if (res?.audio_path) audioPath = res.audio_path;
      }
      const newAudioItem = {
        id: `aud-${Date.now()}`,
        trackId: "a1",
        name: `Audio from ${clip.name}`,
        path: audioPath,
        stream_url: clip.stream_url,
        duration: clip.duration,
        start_time: clip.start_time,
        end_time: clip.end_time,
        volume: 1.0,
      };
      setAudioClips((prev) => [...prev, newAudioItem]);
      setMuteOriginalAudio(true);
      safeNotify("Audio detached onto A1 track! 🎵", "success");
    } catch {
      safeNotify("Extracted audio locally for timeline preview", "info");
      const newAudioItem = {
        id: `aud-${Date.now()}`,
        trackId: "a1",
        name: `Audio: ${clip.name}`,
        path: clip.path || "",
        stream_url: clip.stream_url,
        duration: clip.duration,
        start_time: clip.start_time,
        end_time: clip.end_time,
        volume: 1.0,
      };
      setAudioClips((prev) => [...prev, newAudioItem]);
      setMuteOriginalAudio(true);
    }
  };

  // ──── Add Stock BGM to Timeline ────
  const handleAddStockBgm = (bgm) => {
    const item = {
      id: `bgm-${Date.now()}`,
      trackId: "a2",
      name: bgm.name,
      path: "",
      stream_url: "",
      duration: bgm.duration,
      start_time: 0,
      end_time: bgm.duration,
      volume: 0.8,
    };
    setAudioClips((prev) => [...prev, item]);
    safeNotify(`Added "${bgm.name}" to Music track 🎵`, "success");
  };

  // ──── Add Text Overlay to Timeline ────
  const handleAddTextOverlay = (template) => {
    const item = {
      id: `text-${Date.now()}`,
      trackId: "t1",
      text: template.text,
      position: template.position,
      color: template.color,
      bgColor: template.bgColor,
      start_time: 0,
      end_time: Math.min(5, totalTimelineDuration),
    };
    setTextOverlays((prev) => [...prev, item]);
    setSelectedTextId(item.id);
    setRightTab("text");
    safeNotify("Text overlay added to timeline ✨", "success");
  };

  // ──── Process and Upload Video Files ────
  const handleUploadClips = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    setIsUploadingClip(true);
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const localUrl = URL.createObjectURL(f);
      const tempId = `clip-${Date.now()}-${i}`;

      let dur = 10.0;
      let w = 1080;
      let h = 1920;

      try {
        const v = document.createElement("video");
        v.preload = "metadata";
        v.src = localUrl;
        await new Promise((res) => {
          v.onloadedmetadata = () => {
            if (v.duration && !isNaN(v.duration)) dur = Math.round(v.duration * 100) / 100;
            if (v.videoWidth) w = v.videoWidth;
            if (v.videoHeight) h = v.videoHeight;
            res();
          };
          v.onerror = () => res();
          setTimeout(res, 600);
        });
      } catch {
        /* ignore */
      }

      const initialClip = {
        id: tempId,
        trackId: "v1",
        name: f.name,
        path: "",
        stream_url: localUrl,
        duration: dur,
        start_time: 0,
        end_time: dur,
        speed: 1.0,
        transition_to_next: "none",
        transition_duration: 0.5,
        width: w,
        height: h,
        isUploading: true,
      };

      setClips((prev) => [...prev, initialClip]);

      try {
        setClipUploadProgress({
          filename: f.name,
          percent: 10,
          loadedMb: "0.1",
          totalMb: (f.size / (1024 * 1024)).toFixed(1),
        });

        const uploadRes = await api.uploadVideoClip(f, (pct, loaded, total) => {
          setClipUploadProgress({
            filename: f.name,
            percent: pct,
            loadedMb: (loaded / (1024 * 1024)).toFixed(1),
            totalMb: (total / (1024 * 1024)).toFixed(1),
          });
        });

        if (uploadRes?.path) {
          setClips((prev) =>
            prev.map((c) =>
              c.id === tempId
                ? {
                    ...c,
                    path: uploadRes.path,
                    stream_url: uploadRes.stream_url || c.stream_url,
                    duration: uploadRes.duration || c.duration,
                    end_time: uploadRes.duration || c.end_time,
                    width: uploadRes.width || c.width,
                    height: uploadRes.height || c.height,
                    isUploading: false,
                  }
                : c
            )
          );
        }
      } catch {
        // Keep working with local object URL
        setClips((prev) =>
          prev.map((c) => (c.id === tempId ? { ...c, isUploading: false } : c))
        );
      }
    }
    setIsUploadingClip(false);
    setClipUploadProgress(null);
    safeNotify(`Imported ${files.length} video clip${files.length > 1 ? "s" : ""}!`, "success");
    e.target.value = "";
  };

  // ──── Playback Controls ────
  const togglePlay = () => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
      setIsPlaying(false);
    } else {
      videoRef.current.play().catch(() => {});
      setIsPlaying(true);
    }
  };

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
      setDuration(videoRef.current.duration || 0);
    }
  };

  const handleRulerClick = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickRatio = Math.max(0, Math.min(1, clickX / rect.width));
    const targetTime = clickRatio * totalTimelineDuration;
    setCurrentTime(targetTime);
    if (videoRef.current && activeClip) {
      const relative = Math.max(
        activeClip.start_time,
        Math.min(activeClip.end_time, activeClip.start_time + targetTime)
      );
      videoRef.current.currentTime = relative;
    }
  };

  // ──── Real-Time CSS Filter ────
  const getFilterStyle = () => {
    const b = 1 + (adjustments.brightness + adjustments.exposure * 0.5) / 100;
    const c = 1 + adjustments.contrast / 100;
    const s = 1 + adjustments.saturation / 100;

    let base = `brightness(${Math.max(0.1, b)}) contrast(${Math.max(0.1, c)}) saturate(${Math.max(0, s)})`;
    const lutObj = LUT_PRESETS.find((l) => l.id === lutPreset);
    if (lutObj && lutObj.filter !== "none") {
      base += ` ${lutObj.filter}`;
    }
    return base;
  };

  // ──── Export / Render ────
  const handleRender = async () => {
    if (!clips.length) {
      safeNotify("Please import video clips first", "warning");
      return;
    }

    setIsRendering(true);
    setRenderProgress({ percent: 5, message: "Initializing FFmpeg render..." });

    try {
      const renderClips = clips.map((c) => ({
        path: c.path || "",
        start_time: c.start_time,
        end_time: c.end_time,
        speed: c.speed || 1.0,
        transition: c.transition_to_next || "none",
        transition_duration: c.transition_duration || 0.5,
      }));

      const res = await api.renderVideoProject({
        clips: renderClips,
        aspectRatio,
        targetResolution,
        muteOriginalAudio,
        bgmVolume: bgmVolume / 100,
        originalAudioVolume: origVolume / 100,
        adjustments,
        lutPreset,
        logoPath: logoPath || "",
        logoSettings: {
          widthRatio: logoWidthRatio,
          opacity: logoOpacity / 100,
          anchor,
          customPos: logoPos,
        },
      });

      if (res?.job_id) {
        const jobId = res.job_id;
        const poll = setInterval(async () => {
          try {
            const p = await api.getRenderProgress(jobId);
            setRenderProgress(p);
            if (p.status === "complete") {
              clearInterval(poll);
              setIsRendering(false);
              setLastRenderedVideo(p);
              safeNotify("Video rendered successfully! 🎬", "success");
            } else if (p.status === "error") {
              clearInterval(poll);
              setIsRendering(false);
              safeNotify(`Render error: ${p.error || "Failed"}`, "error");
            }
          } catch {
            clearInterval(poll);
            setIsRendering(false);
          }
        }, 1000);
      }
    } catch (err) {
      setIsRendering(false);
      safeNotify(err.message || "Render failed", "error");
    }
  };

  // Send rendered video directly to Facebook Post Composer
  const handleSendToPostComposer = () => {
    if (!lastRenderedVideo) return;
    const videoData = {
      type: "video",
      videoUrl: lastRenderedVideo.download_url,
      path: lastRenderedVideo.output_path || lastRenderedVideo.download_url,
      aspectRatio,
      title: "Exported Video Reel",
    };
    if (typeof onOpenComposer === "function") {
      onOpenComposer(videoData);
    }
  };

  // Video aspect ratio framing helper
  const getContainerRatioStyle = () => {
    switch (aspectRatio) {
      case "9:16":
        return { aspectRatio: "9 / 16", maxHeight: "100%", width: "auto", height: "100%" };
      case "16:9":
        return { aspectRatio: "16 / 9", maxWidth: "100%", width: "100%", height: "auto" };
      case "1:1":
        return { aspectRatio: "1 / 1", maxHeight: "100%", width: "auto", height: "100%" };
      case "4:5":
        return { aspectRatio: "4 / 5", maxHeight: "100%", width: "auto", height: "100%" };
      default:
        return { maxWidth: "100%", maxHeight: "100%" };
    }
  };

  // Active text overlay
  const activeText = textOverlays.find((t) => t.id === selectedTextId) || textOverlays[0] || null;

  return (
    <div className="nle-root">
      {/* ============================================================
          LEFT PANEL – Media & Assets Library
          ============================================================ */}
      <aside className="nle-media-panel">
        {/* Navigation Tabs */}
        <div className="nle-media-nav">
          {[
            { id: "media", label: "Media", icon: "film" },
            { id: "audio", label: "Audio", icon: "music" },
            { id: "text", label: "Text", icon: "type" },
            { id: "transitions", label: "Transitions", icon: "sparkle" },
            { id: "filters", label: "Filters", icon: "sun" },
          ].map((tab) => (
            <button
              key={tab.id}
              className={`nle-media-nav-btn ${leftTab === tab.id ? "is-active" : ""}`}
              onClick={() => setLeftTab(tab.id)}
            >
              <Icon name={tab.icon} size={12} />
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        {/* ── Tab: Media ── */}
        {leftTab === "media" && (
          <>
            <div className="nle-upload-actions">
              <button
                type="button"
                className="nle-upload-btn nle-upload-btn--primary"
                onClick={() => fileInputClipsRef.current?.click()}
                disabled={isUploadingClip}
              >
                <Icon name="video" size={14} /> Import Video Clips
              </button>
              <input
                ref={fileInputClipsRef.current ? undefined : fileInputClipsRef}
                type="file"
                accept="video/*,.mp4,.mov,.mkv,.webm"
                multiple
                onChange={handleUploadClips}
                style={{ display: "none" }}
              />

              <button
                type="button"
                className="nle-upload-btn nle-upload-btn--secondary"
                onClick={() => fileInputAudioRef.current?.click()}
              >
                <Icon name="music" size={14} /> Import Audio File
              </button>
              <input
                ref={fileInputAudioRef}
                type="file"
                accept="audio/*,.mp3,.wav,.aac,.m4a"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) {
                    const localUrl = URL.createObjectURL(f);
                    const item = {
                      id: `aud-${Date.now()}`,
                      trackId: "a2",
                      name: f.name,
                      path: "",
                      stream_url: localUrl,
                      duration: 30,
                      start_time: 0,
                      end_time: 30,
                      volume: 1.0,
                    };
                    setAudioClips((prev) => [...prev, item]);
                    safeNotify(`Imported audio: ${f.name}`, "success");
                  }
                }}
                style={{ display: "none" }}
              />
            </div>

            {clipUploadProgress && (
              <div className="nle-upload-progress">
                <div className="nle-upload-progress__info">
                  <span className="nle-upload-progress__filename">{clipUploadProgress.filename}</span>
                  <span>{clipUploadProgress.percent}%</span>
                </div>
                <div className="nle-upload-progress__bar">
                  <div className="nle-upload-progress__fill" style={{ width: `${clipUploadProgress.percent}%` }} />
                </div>
              </div>
            )}

            <div className="nle-media-content">
              {clips.length === 0 ? (
                <div className="nle-empty-bin">
                  <Icon name="video" size={24} />
                  <p>No video clips yet.<br />Click Import Video to begin.</p>
                </div>
              ) : (
                clips.map((clip, idx) => (
                  <div
                    key={clip.id}
                    className={`nle-clip-card ${selectedClipIdx === idx ? "is-selected" : ""}`}
                    onClick={() => {
                      setSelectedClipIdx(idx);
                      setRightTab("clip");
                      if (videoRef.current) videoRef.current.currentTime = clip.start_time;
                    }}
                  >
                    <div className="nle-clip-card__thumb">
                      <Icon name="video" size={14} />
                    </div>
                    <div className="nle-clip-card__info">
                      <div className="nle-clip-card__name">{clip.name}</div>
                      <div className="nle-clip-card__meta">
                        {Math.round(clip.duration)}s • {clip.speed || 1.0}x
                      </div>
                    </div>
                    <div className="nle-clip-card__actions">
                      <button
                        className="nle-icon-btn-sm"
                        title="Extract audio"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleExtractAudio(clip);
                        }}
                      >
                        <Icon name="music" size={12} />
                      </button>
                      <button
                        className="nle-icon-btn-sm danger"
                        title="Delete"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemoveClip(idx);
                        }}
                      >
                        <Icon name="trash" size={12} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </>
        )}

        {/* ── Tab: Audio / BGM ── */}
        {leftTab === "audio" && (
          <div className="nle-media-content">
            <h4 style={{ fontSize: "0.76rem", margin: "4px 0 8px 0", color: "var(--vs-text-dim)" }}>
              🎵 Stock Music Presets
            </h4>
            {STOCK_BGM.map((bgm) => (
              <div key={bgm.id} className="nle-asset-item">
                <div className="nle-asset-info">
                  <span className="nle-asset-icon">{bgm.icon}</span>
                  <div>
                    <div className="nle-asset-name">{bgm.name}</div>
                    <div className="nle-asset-tag">{bgm.genre} • {bgm.duration}s</div>
                  </div>
                </div>
                <button className="nle-add-asset-btn" onClick={() => handleAddStockBgm(bgm)}>
                  + Add
                </button>
              </div>
            ))}
          </div>
        )}

        {/* ── Tab: Text & Subtitles ── */}
        {leftTab === "text" && (
          <div className="nle-media-content">
            <h4 style={{ fontSize: "0.76rem", margin: "4px 0 8px 0", color: "var(--vs-text-dim)" }}>
              🔤 Text & Subtitle Presets
            </h4>
            {TEXT_PRESETS.map((tmpl) => (
              <div key={tmpl.id} className="nle-asset-item">
                <div className="nle-asset-info">
                  <span className="nle-asset-icon">💬</span>
                  <div>
                    <div className="nle-asset-name">{tmpl.text}</div>
                    <div className="nle-asset-tag">Position: {tmpl.position}</div>
                  </div>
                </div>
                <button className="nle-add-asset-btn" onClick={() => handleAddTextOverlay(tmpl)}>
                  + Add
                </button>
              </div>
            ))}
          </div>
        )}

        {/* ── Tab: Transitions Preview ── */}
        {leftTab === "transitions" && (
          <div className="nle-media-content">
            <h4 style={{ fontSize: "0.76rem", margin: "4px 0 8px 0", color: "var(--vs-text-dim)" }}>
              ⚡ CapCut Transitions (17)
            </h4>
            {TRANSITION_PRESETS.map((t) => (
              <div
                key={t.id}
                className="nle-asset-item"
                style={{ cursor: "pointer" }}
                onClick={() => {
                  handleSetTransition(t.id);
                  setRightTab("transitions");
                }}
              >
                <div className="nle-asset-info">
                  <span className="nle-asset-icon">{t.icon}</span>
                  <div>
                    <div className="nle-asset-name">{t.label}</div>
                    <div className="nle-asset-tag">{t.desc}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Tab: Filters Preview ── */}
        {leftTab === "filters" && (
          <div className="nle-media-content">
            <h4 style={{ fontSize: "0.76rem", margin: "4px 0 8px 0", color: "var(--vs-text-dim)" }}>
              🎨 Cinematic Filters & LUTs
            </h4>
            <div className="nle-lut-grid">
              {LUT_PRESETS.map((preset) => (
                <div
                  key={preset.id}
                  className={`nle-lut-card ${lutPreset === preset.id ? "is-active" : ""}`}
                  onClick={() => {
                    setLutPreset(preset.id);
                    setRightTab("adjust");
                  }}
                >
                  <div className="nle-lut-swatch" style={{ filter: preset.filter }} />
                  <span className="nle-lut-label">{preset.label}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </aside>

      {/* ============================================================
          CENTER PANEL – Video Monitor & Playback Controls
          ============================================================ */}
      <main className="nle-center">
        {/* Top Monitor Toolbar */}
        <div className="nle-monitor-toolbar">
          <div className="nle-toolbar-left">
            {[
              { id: "9:16", label: "9:16", icon: "📱" },
              { id: "16:9", label: "16:9", icon: "🖥️" },
              { id: "1:1", label: "1:1", icon: "⏹️" },
              { id: "4:5", label: "4:5", icon: "📸" },
            ].map((r) => (
              <button
                key={r.id}
                className={`nle-ratio-pill ${aspectRatio === r.id ? "is-active" : ""}`}
                onClick={() => setAspectRatio(r.id)}
              >
                <span>{r.icon}</span>
                <span>{r.label}</span>
              </button>
            ))}
          </div>

          <div className="nle-toolbar-right">
            <span className="nle-badge-status">
              {aspectRatio === "9:16" ? "Reels / TikTok Mode" : "Standard Video"}
            </span>
          </div>
        </div>

        {/* Video Preview Canvas Stage */}
        <div className="nle-preview-stage">
          {activeClip ? (
            <div ref={videoBoxRef} className="nle-video-box" style={getContainerRatioStyle()}>
              <video
                ref={videoRef}
                src={activeClip.stream_url}
                className="nle-video-element"
                style={{ filter: getFilterStyle() }}
                onTimeUpdate={handleTimeUpdate}
                onClick={togglePlay}
                playsInline
              />

              {/* Watermark Logo Overlay */}
              {logoPreviewUrl && (
                <div
                  className={`nle-watermark-overlay ${isDraggingLogo ? "is-dragging" : ""}`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setIsDraggingLogo(true);
                  }}
                  style={{
                    width: `${Math.round(logoWidthRatio * 100)}%`,
                    opacity: logoOpacity / 100,
                    ...(logoPos.x !== null && logoPos.y !== null
                      ? {
                          left: `${logoPos.x * 100}%`,
                          top: `${logoPos.y * 100}%`,
                          transform: "translate(-50%, -50%)",
                        }
                      : anchor === "bottom-right"
                      ? { right: "16px", bottom: "16px" }
                      : anchor === "bottom-left"
                      ? { left: "16px", bottom: "16px" }
                      : anchor === "top-right"
                      ? { right: "16px", top: "16px" }
                      : anchor === "top-left"
                      ? { left: "16px", top: "16px" }
                      : { left: "50%", top: "50%", transform: "translate(-50%, -50%)" }),
                  }}
                  title="Drag to reposition watermark"
                >
                  <img src={logoPreviewUrl} alt="Watermark" />
                </div>
              )}

              {/* Real-Time Text Overlay */}
              {activeText && (
                <div
                  className="nle-text-overlay"
                  style={{
                    color: activeText.color,
                    background: activeText.bgColor,
                    ...(activeText.position === "top"
                      ? { top: "15%", left: "50%", transform: "translateX(-50%)" }
                      : activeText.position === "center"
                      ? { top: "50%", left: "50%", transform: "translate(-50%, -50%)" }
                      : { bottom: "15%", left: "50%", transform: "translateX(-50%)" }),
                  }}
                >
                  {activeText.text}
                </div>
              )}

              {/* Play Overlay Button */}
              {!isPlaying && (
                <div className="nle-play-center-overlay" onClick={togglePlay}>
                  <button className="nle-play-circle-btn" aria-label="Play">
                    <Icon name="play" size={26} />
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="nle-empty-stage">
              <div className="nle-empty-stage-icon">
                <Icon name="video" size={30} />
              </div>
              <h3>Video Studio Pro</h3>
              <p>CapCut & VN grade video editor with multi-track timeline, transitions & slow-motion.</p>
              <button
                className="nle-upload-btn nle-upload-btn--primary"
                onClick={() => fileInputClipsRef.current?.click()}
              >
                <Icon name="upload" size={15} /> Import Video Clips
              </button>
            </div>
          )}
        </div>

        {/* Playback Control Bar */}
        <div className="nle-monitor-controls">
          <div className="nle-ctrl-group">
            <button
              className="nle-btn-icon"
              title="Jump to start"
              onClick={() => {
                if (videoRef.current) videoRef.current.currentTime = 0;
              }}
            >
              ⏮
            </button>
            <button
              className="nle-btn-icon"
              title="Step back 1s"
              onClick={() => {
                if (videoRef.current) videoRef.current.currentTime -= 1;
              }}
            >
              ⏪
            </button>
            <button
              className="nle-btn-play-main"
              onClick={togglePlay}
              title={isPlaying ? "Pause" : "Play"}
            >
              <Icon name={isPlaying ? "pause" : "play"} size={16} />
            </button>
            <button
              className="nle-btn-icon"
              title="Step forward 1s"
              onClick={() => {
                if (videoRef.current) videoRef.current.currentTime += 1;
              }}
            >
              ⏩
            </button>
          </div>

          <div className="nle-timecode">
            {formatSec(currentTime)} <span className="dim">/</span> {formatSec(duration || totalTimelineDuration)}
          </div>

          <div className="nle-ctrl-group">
            <button
              className="nle-tl-action-btn"
              onClick={handleSplitClip}
              disabled={!activeClip}
              title="Split active clip at playhead"
            >
              <Icon name="scissors" size={13} /> Split
            </button>
          </div>
        </div>
      </main>

      {/* ============================================================
          RIGHT PANEL – Properties & Inspector
          ============================================================ */}
      <aside className="nle-props-panel">
        <div className="nle-props-tabs">
          {[
            { id: "clip", label: "Clip" },
            { id: "speed", label: "Speed" },
            { id: "adjust", label: "Color" },
            { id: "transitions", label: "Transitions" },
            { id: "text", label: "Text" },
            { id: "logo", label: "Logo" },
          ].map((tab) => (
            <button
              key={tab.id}
              className={`nle-props-tab-btn ${rightTab === tab.id ? "is-active" : ""}`}
              onClick={() => setRightTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="nle-props-body">
          {/* ── Tab: Clip Trim & Properties ── */}
          {rightTab === "clip" && (
            activeClip ? (
              <div className="nle-props-section">
                <div className="nle-props-header">
                  <h4>✂️ Trim & Duration</h4>
                </div>
                <p style={{ fontSize: "0.72rem", color: "var(--vs-text-faint)", margin: 0 }}>
                  Selected: <b>{activeClip.name}</b>
                </p>

                <div className="nle-slider-box">
                  <div className="nle-slider-header">
                    <span>Start (In Point)</span>
                    <span className="nle-slider-val">{activeClip.start_time.toFixed(1)}s</span>
                  </div>
                  <input
                    type="range"
                    className="nle-slider"
                    min="0"
                    max={Math.max(0, activeClip.end_time - 0.5)}
                    step="0.1"
                    value={activeClip.start_time}
                    onChange={(e) => handleTrimChange("start_time", e.target.value)}
                  />
                </div>

                <div className="nle-slider-box">
                  <div className="nle-slider-header">
                    <span>End (Out Point)</span>
                    <span className="nle-slider-val">{activeClip.end_time.toFixed(1)}s</span>
                  </div>
                  <input
                    type="range"
                    className="nle-slider"
                    min={activeClip.start_time + 0.5}
                    max={activeClip.duration || 30}
                    step="0.1"
                    value={activeClip.end_time}
                    onChange={(e) => handleTrimChange("end_time", e.target.value)}
                  />
                </div>

                <div style={{ display: "flex", gap: "6px", marginTop: "6px" }}>
                  <button
                    className="nle-tl-action-btn"
                    style={{ flex: 1 }}
                    onClick={() => handleExtractAudio(activeClip)}
                  >
                    <Icon name="music" size={13} /> Detach Audio
                  </button>
                  <button
                    className="nle-tl-action-btn"
                    style={{ flex: 1 }}
                    onClick={() => handleDuplicateClip(selectedClipIdx)}
                  >
                    <Icon name="copy" size={13} /> Duplicate
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ textAlign: "center", padding: "30px 10px", color: "var(--vs-text-faint)", fontSize: "0.76rem" }}>
                <Icon name="film" size={26} />
                <p style={{ marginTop: "10px" }}>Select or import a video clip to adjust trim, duration, and properties.</p>
              </div>
            )
          )}

          {/* ── Tab: Speed Control ── */}
          {rightTab === "speed" && (
            activeClip ? (
              <div className="nle-props-section">
                <div className="nle-props-header">
                  <h4>⚡ Speed Ramping</h4>
                  {activeClip.speed !== 1.0 && (
                    <button className="nle-btn-ghost" onClick={() => handleSpeedChange(1.0)}>
                      Reset 1x
                    </button>
                  )}
                </div>

                <div className="nle-speed-grid">
                  {SPEED_PRESETS.map((sp) => (
                    <button
                      key={sp.value}
                      className={`nle-speed-btn ${(activeClip.speed || 1.0) === sp.value ? "is-active" : ""}`}
                      onClick={() => handleSpeedChange(sp.value)}
                    >
                      {sp.label}
                    </button>
                  ))}
                </div>

                <div className="nle-slider-box" style={{ marginTop: "10px" }}>
                  <div className="nle-slider-header">
                    <span>Custom Speed</span>
                    <span className="nle-slider-val">{activeClip.speed || 1.0}x</span>
                  </div>
                  <input
                    type="range"
                    className="nle-slider"
                    min="0.25"
                    max="4.0"
                    step="0.05"
                    value={activeClip.speed || 1.0}
                    onChange={(e) => handleSpeedChange(e.target.value)}
                  />
                </div>
              </div>
            ) : (
              <div style={{ textAlign: "center", padding: "30px 10px", color: "var(--vs-text-faint)", fontSize: "0.76rem" }}>
                <span style={{ fontSize: "28px" }}>⚡</span>
                <p style={{ marginTop: "10px" }}>Select a video clip on the timeline to apply slow motion (0.25x / 0.5x) or fast forward (2x / 4x).</p>
              </div>
            )
          )}

          {/* ── Tab: Color Adjustments ── */}
          {rightTab === "adjust" && (
            <div className="nle-props-section">
              <div className="nle-props-header">
                <h4>🎨 Color & Exposure</h4>
                <button
                  className="nle-btn-ghost"
                  onClick={() => setAdjustments({ brightness: 0, contrast: 0, saturation: 0, exposure: 0 })}
                >
                  Reset
                </button>
              </div>

              {[
                { key: "brightness", label: "Brightness", min: -50, max: 50 },
                { key: "contrast", label: "Contrast", min: -50, max: 50 },
                { key: "saturation", label: "Saturation", min: -80, max: 80 },
                { key: "exposure", label: "Exposure", min: -50, max: 50 },
              ].map((s) => (
                <div key={s.key} className="nle-slider-box">
                  <div className="nle-slider-header">
                    <span>{s.label}</span>
                    <span className="nle-slider-val">{adjustments[s.key]}</span>
                  </div>
                  <input
                    type="range"
                    className="nle-slider"
                    min={s.min}
                    max={s.max}
                    value={adjustments[s.key]}
                    onChange={(e) => setAdjustments({ ...adjustments, [s.key]: Number(e.target.value) })}
                  />
                </div>
              ))}
            </div>
          )}

          {/* ── Tab: Transitions ── */}
          {rightTab === "transitions" && (
            <div className="nle-props-section">
              <div className="nle-props-header">
                <h4>⚡ Cut #{selectedTransitionCutIdx + 1} Transition</h4>
              </div>
              <div className="nle-trans-grid">
                {TRANSITION_PRESETS.map((t) => (
                  <div
                    key={t.id}
                    className={`nle-trans-card ${
                      (clips[selectedTransitionCutIdx]?.transition_to_next || "none") === t.id
                        ? "is-active"
                        : ""
                    }`}
                    onClick={() => handleSetTransition(t.id)}
                  >
                    <div className="nle-trans-card__top">
                      <span>{t.icon}</span> {t.label}
                    </div>
                    <div className="nle-trans-card__desc">{t.desc}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Tab: Text Editor ── */}
          {rightTab === "text" && activeText && (
            <div className="nle-props-section">
              <div className="nle-props-header">
                <h4>💬 Edit Text Overlay</h4>
              </div>
              <input
                type="text"
                className="nle-select-sm"
                value={activeText.text}
                onChange={(e) =>
                  setTextOverlays((prev) =>
                    prev.map((t) => (t.id === activeText.id ? { ...t, text: e.target.value } : t))
                  )
                }
                style={{ width: "100%", padding: "8px 10px", fontSize: "0.78rem" }}
              />

              <div style={{ display: "flex", gap: "6px" }}>
                {["top", "center", "bottom"].map((pos) => (
                  <button
                    key={pos}
                    className={`nle-speed-btn ${activeText.position === pos ? "is-active" : ""}`}
                    onClick={() =>
                      setTextOverlays((prev) =>
                        prev.map((t) => (t.id === activeText.id ? { ...t, position: pos } : t))
                      )
                    }
                    style={{ flex: 1, textTransform: "capitalize" }}
                  >
                    {pos}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── Tab: Watermark Logo ── */}
          {rightTab === "logo" && (
            <div className="nle-props-section">
              <div className="nle-props-header">
                <h4>🛡️ Watermark / Logo</h4>
              </div>
              <label className="nle-upload-btn nle-upload-btn--secondary" style={{ cursor: "pointer" }}>
                <Icon name="upload" size={14} /> Choose Logo Image
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) setLogo(f);
                  }}
                  style={{ display: "none" }}
                />
              </label>

              {logoPreviewUrl && (
                <>
                  <div className="nle-slider-box">
                    <div className="nle-slider-header">
                      <span>Size</span>
                      <span className="nle-slider-val">{Math.round(logoWidthRatio * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      className="nle-slider"
                      min="5"
                      max="50"
                      value={logoWidthRatio * 100}
                      onChange={(e) => setLogoWidthRatio(Number(e.target.value) / 100)}
                    />
                  </div>

                  <div className="nle-slider-box">
                    <div className="nle-slider-header">
                      <span>Opacity</span>
                      <span className="nle-slider-val">{logoOpacity}%</span>
                    </div>
                    <input
                      type="range"
                      className="nle-slider"
                      min="10"
                      max="100"
                      value={logoOpacity}
                      onChange={(e) => setLogoOpacity(Number(e.target.value))}
                    />
                  </div>

                  <div className="nle-anchor-grid">
                    {["top-left", "top-right", "bottom-left", "bottom-right", "center"].map((a) => (
                      <button
                        key={a}
                        className={`nle-anchor-btn ${anchor === a ? "is-active" : ""}`}
                        onClick={() => {
                          setAnchor(a);
                          setLogoPos({ x: null, y: null });
                        }}
                      >
                        {a.replace("-", " ")}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Export & Publish Panel */}
        <div className="nle-export-panel">
          <div className="nle-export-row">
            <span>Export Quality</span>
            <select
              className="nle-select-sm"
              value={targetResolution}
              onChange={(e) => setTargetResolution(e.target.value)}
            >
              <option value="1080p">1080p (Full HD)</option>
              <option value="720p">720p (Fast)</option>
            </select>
          </div>

          <button
            className="nle-btn-export"
            onClick={handleRender}
            disabled={isRendering || clips.length === 0}
          >
            <Icon name="sparkle" size={15} />
            {isRendering ? "Rendering..." : "Export Video Reel"}
          </button>

          {lastRenderedVideo && (
            <div className="nle-export-post-actions">
              <a
                href={lastRenderedVideo.download_url}
                download
                className="nle-post-action-btn nle-post-action-btn--download"
              >
                <Icon name="download" size={13} /> Download
              </a>
              <button
                className="nle-post-action-btn nle-post-action-btn--publish"
                onClick={handleSendToPostComposer}
              >
                <Icon name="edit" size={13} /> Post Composer 🚀
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* ============================================================
          BOTTOM AREA – Multi-Track Timeline (CapCut / VN Grade)
          ============================================================ */}
      <div className="nle-timeline-area">
        {/* Timeline Top Control Toolbar */}
        <div className="nle-timeline-toolbar">
          <div className="nle-tl-tools-left">
            {/* + Add Track Menu */}
            <div className="nle-add-track-dropdown">
              <button
                className="nle-add-track-btn"
                onClick={() => setAddTrackMenuOpen((o) => !o)}
                title="Add new track to timeline"
              >
                <Icon name="plus" size={13} /> Add Track
              </button>
              {addTrackMenuOpen && (
                <div className="nle-add-track-menu">
                  <button onClick={() => handleAddTrack("video")}>
                    <Icon name="video" size={13} /> + Video Track (Overlay)
                  </button>
                  <button onClick={() => handleAddTrack("audio")}>
                    <Icon name="music" size={13} /> + Audio Track (BGM)
                  </button>
                  <button onClick={() => handleAddTrack("text")}>
                    <Icon name="type" size={13} /> + Text / Subtitle Track
                  </button>
                </div>
              )}
            </div>

            {/* Reorder / Move Clip Buttons */}
            <button
              className="nle-tl-action-btn"
              onClick={() => handleMoveClip(selectedClipIdx, -1)}
              disabled={selectedClipIdx === 0}
              title="Move selected clip earlier on timeline"
            >
              <Icon name="arrowLeft" size={13} /> Move Left
            </button>
            <button
              className="nle-tl-action-btn"
              onClick={() => handleMoveClip(selectedClipIdx, 1)}
              disabled={selectedClipIdx >= clips.length - 1}
              title="Move selected clip later on timeline"
            >
              Move Right <Icon name="arrowRight" size={13} />
            </button>

            {/* Split */}
            <button
              className="nle-tl-action-btn"
              onClick={handleSplitClip}
              disabled={!activeClip}
              title="Split clip at playhead"
            >
              <Icon name="scissors" size={13} /> Split
            </button>

            {/* Duplicate */}
            <button
              className="nle-tl-action-btn"
              onClick={() => handleDuplicateClip(selectedClipIdx)}
              disabled={!activeClip}
              title="Duplicate selected clip"
            >
              <Icon name="copy" size={13} /> Duplicate
            </button>

            {/* Delete */}
            <button
              className="nle-tl-action-btn danger"
              onClick={() => handleRemoveClip(selectedClipIdx)}
              disabled={!activeClip}
              title="Delete clip from timeline"
            >
              <Icon name="trash" size={13} /> Delete
            </button>
          </div>

          <div className="nle-tl-tools-right">
            <button
              className="nle-btn-icon"
              onClick={() => setTimelineZoom((z) => Math.max(0.4, z - 0.2))}
              title="Zoom out timeline"
            >
              −
            </button>
            <span style={{ fontSize: "0.68rem", fontFamily: "JetBrains Mono", color: "var(--vs-text-faint)" }}>
              {Math.round(timelineZoom * 100)}%
            </span>
            <button
              className="nle-btn-icon"
              onClick={() => setTimelineZoom((z) => Math.min(2.5, z + 0.2))}
              title="Zoom in timeline"
            >
              +
            </button>
          </div>
        </div>

        {/* Scrollable Timeline Area */}
        <div className="nle-timeline-body" ref={timelineScrollRef}>
          {/* Global Playhead Needle */}
          <div
            className="nle-playhead-line"
            style={{
              left: `${175 + currentTime * pxPerSec}px`,
            }}
          >
            <div className="nle-playhead-head" />
          </div>

          {/* Time Ruler */}
          <div className="nle-time-ruler" onClick={handleRulerClick}>
            <div className="nle-ruler-gutter">Timecode</div>
            <div className="nle-ruler-track">
              {Array.from({ length: Math.ceil(totalTimelineDuration + 5) }).map((_, sec) => (
                <div
                  key={sec}
                  className="nle-ruler-tick"
                  style={{ left: `${sec * pxPerSec}px` }}
                >
                  <span className="nle-ruler-label">{formatSec(sec)}</span>
                  <div className="nle-ruler-mark" />
                </div>
              ))}
            </div>
          </div>

          {/* ── Render Tracks (Video, Text, Audio) ── */}
          {tracks.map((track) => (
            <div
              key={track.id}
              className={`nle-track-row ${track.locked ? "is-locked" : ""}`}
            >
              {/* Fixed Left Track Header */}
              <div className="nle-track-header">
                <div className="nle-track-header__info">
                  <span className={`nle-track-type-badge ${track.type}`}>
                    {track.type === "video" ? "V" : track.type === "audio" ? "A" : "T"}
                  </span>
                  <span className="nle-track-title">{track.name}</span>
                </div>

                <div className="nle-track-controls">
                  <button
                    className={`nle-track-ctrl-btn ${track.muted ? "muted" : ""}`}
                    onClick={() => handleToggleTrack(track.id, "muted")}
                    title={track.muted ? "Unmute track" : "Mute track"}
                  >
                    {track.muted ? "🔇" : "🔊"}
                  </button>
                  <button
                    className={`nle-track-ctrl-btn ${track.locked ? "active" : ""}`}
                    onClick={() => handleToggleTrack(track.id, "locked")}
                    title={track.locked ? "Unlock track" : "Lock track"}
                  >
                    <Icon name={track.locked ? "lock" : "unlock"} size={10} />
                  </button>
                  {tracks.length > 2 && (
                    <button
                      className="nle-track-ctrl-btn"
                      onClick={() => handleRemoveTrack(track.id)}
                      title="Remove track"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>

              {/* Scrollable Track Lane */}
              <div className="nle-track-lane">
                {/* Video Track Clips */}
                {track.type === "video" && (
                  <>
                    {clips.map((clip, idx) => {
                      const effectiveDur = (clip.end_time - clip.start_time) / (clip.speed || 1.0);
                      const widthPx = Math.max(60, effectiveDur * pxPerSec);

                      return (
                        <React.Fragment key={clip.id}>
                          <div
                            draggable
                            onDragStart={() => handleDragStart(idx)}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={() => handleDropOnClip(idx)}
                            className={`nle-tl-clip video-clip ${selectedClipIdx === idx ? "is-selected" : ""}`}
                            style={{ width: `${widthPx}px` }}
                            onClick={() => {
                              setSelectedClipIdx(idx);
                              setRightTab("clip");
                              if (videoRef.current) videoRef.current.currentTime = clip.start_time;
                            }}
                          >
                            <span className="nle-trim-handle left" />

                            <div className="nle-tl-clip__content">
                              <span className="nle-tl-clip__name">{clip.name}</span>
                              <span className="nle-tl-clip__dur">
                                {effectiveDur.toFixed(1)}s
                                {clip.speed !== 1.0 && ` (${clip.speed}x)`}
                              </span>
                            </div>

                            <div className="nle-clip-move-arrows">
                              <button
                                className="nle-move-arrow-btn"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleMoveClip(idx, -1);
                                }}
                                title="Move Earlier"
                              >
                                ◀
                              </button>
                              <button
                                className="nle-move-arrow-btn"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleMoveClip(idx, 1);
                                }}
                                title="Move Later"
                              >
                                ▶
                              </button>
                            </div>

                            <span className="nle-trim-handle right" />
                          </div>

                          {/* Transition Junction Badge Between Adjacent Clips */}
                          {idx < clips.length - 1 && (
                            <button
                              type="button"
                              className={`nle-junction-btn ${
                                clip.transition_to_next && clip.transition_to_next !== "none" ? "has-trans" : ""
                              }`}
                              title={`Transition: ${clip.transition_to_next || "Cut"}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedTransitionCutIdx(idx);
                                setRightTab("transitions");
                              }}
                            >
                              {clip.transition_to_next && clip.transition_to_next !== "none"
                                ? `⚡ ${clip.transition_to_next}`
                                : "⚡"}
                            </button>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </>
                )}

                {/* Text Track Clips */}
                {track.type === "text" && (
                  <>
                    {textOverlays.map((txt) => {
                      const dur = txt.end_time - txt.start_time;
                      const widthPx = Math.max(70, dur * pxPerSec);
                      return (
                        <div
                          key={txt.id}
                          className={`nle-tl-clip text-clip ${selectedTextId === txt.id ? "is-selected" : ""}`}
                          style={{ width: `${widthPx}px` }}
                          onClick={() => {
                            setSelectedTextId(txt.id);
                            setRightTab("text");
                          }}
                        >
                          <div className="nle-tl-clip__content">
                            <span className="nle-tl-clip__name">💬 {txt.text}</span>
                            <span className="nle-tl-clip__dur">{dur.toFixed(1)}s</span>
                          </div>
                        </div>
                      );
                    })}
                  </>
                )}

                {/* Audio Track Clips */}
                {track.type === "audio" && (
                  <>
                    {audioClips
                      .filter((a) => a.trackId === track.id)
                      .map((aud) => {
                        const dur = aud.end_time - aud.start_time;
                        const widthPx = Math.max(70, dur * pxPerSec);
                        return (
                          <div
                            key={aud.id}
                            className="nle-tl-clip audio-clip"
                            style={{ width: `${widthPx}px` }}
                          >
                            <div className="nle-tl-clip__content">
                              <span className="nle-tl-clip__name">🎵 {aud.name}</span>
                              <span className="nle-tl-clip__dur">{dur.toFixed(1)}s</span>
                            </div>
                          </div>
                        );
                      })}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Render Progress Modal */}
      {isRendering && (
        <div className="nle-render-backdrop">
          <div className="nle-render-modal">
            <h3>🎬 Rendering Video Reel</h3>
            <p>{renderProgress?.message || "Applying transitions, speed ramping & audio mixing..."}</p>
            <div className="nle-render-bar">
              <div className="nle-render-fill" style={{ width: `${renderProgress?.percent || 5}%` }} />
            </div>
            <div className="nle-render-pct">{Math.round(renderProgress?.percent || 0)}%</div>
          </div>
        </div>
      )}
    </div>
  );
}

function formatSec(seconds) {
  if (!seconds || isNaN(seconds)) return "00:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m < 10 ? "0" : ""}${m}:${s < 10 ? "0" : ""}${s}`;
}
