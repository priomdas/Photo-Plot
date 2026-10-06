from __future__ import annotations

import json
import logging
import os
import re
import shutil
import subprocess
import time
from pathlib import Path
from typing import Any, Callable

logger = logging.getLogger("photopilot.video.ffmpeg")


def get_ffmpeg_path() -> str:
    """Find FFmpeg executable via imageio-ffmpeg or system PATH."""
    try:
        import imageio_ffmpeg
        exe = imageio_ffmpeg.get_ffmpeg_exe()
        if exe and os.path.exists(exe):
            return exe
    except Exception as exc:
        logger.debug("imageio_ffmpeg lookup failed: %s", exc)

    sys_ffmpeg = shutil.which("ffmpeg")
    if sys_ffmpeg:
        return sys_ffmpeg

    raise RuntimeError("FFmpeg executable not found. Please install imageio-ffmpeg or add ffmpeg to PATH.")


def get_ffprobe_path() -> str | None:
    """Find ffprobe executable via system PATH, sibling of ffmpeg, or custom bin dir."""
    sys_ffprobe = shutil.which("ffprobe")
    if sys_ffprobe:
        return sys_ffprobe

    try:
        ffmpeg = get_ffmpeg_path()
        for cand_name in ("ffprobe.exe", "ffprobe"):
            candidate = Path(ffmpeg).with_name(cand_name)
            if candidate.exists():
                return str(candidate)
    except Exception:
        pass

    # Check project workspace bin
    local_bin = Path(__file__).resolve().parents[2] / "bin"
    for cand_name in ("ffprobe.exe", "ffprobe"):
        candidate = local_bin / cand_name
        if candidate.exists():
            return str(candidate)

    return None


def _probe_media_ffprobe(path: Path, ffprobe_exe: str) -> dict[str, Any]:
    """Inspect media file using ffprobe and return parsed JSON details."""
    cmd = [
        ffprobe_exe,
        "-v", "quiet",
        "-print_format", "json",
        "-show_format",
        "-show_streams",
        str(path),
    ]
    proc = subprocess.run(
        cmd,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="ignore",
        timeout=15,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"ffprobe failed: {proc.stderr[:200]}")

    data = json.loads(proc.stdout)
    streams = data.get("streams", [])
    format_info = data.get("format", {})

    info: dict[str, Any] = {
        "filename": path.name,
        "path": str(path),
        "size_bytes": path.stat().st_size,
        "duration": 0.0,
        "width": 0,
        "height": 0,
        "fps": 30.0,
        "aspect_ratio": "original",
        "has_audio": False,
        "has_video": False,
        "video_codec": "",
        "audio_codec": "",
        "rotation": 0,
        "probed_by": "ffprobe",
    }

    # Format duration
    try:
        info["duration"] = round(float(format_info.get("duration", 0.0) or 0.0), 2)
    except (ValueError, TypeError):
        pass

    # Video stream inspection
    for s in streams:
        if s.get("codec_type") == "video" and not info["has_video"]:
            info["has_video"] = True
            info["video_codec"] = s.get("codec_name", "")
            w = int(s.get("width", 0) or 0)
            h = int(s.get("height", 0) or 0)

            # Check rotation tag and side data
            rotation = 0
            tags = s.get("tags") or {}
            if "rotate" in tags:
                try:
                    rotation = int(float(tags["rotate"]))
                except ValueError:
                    pass
            for sd in s.get("side_data_list", []):
                if "rotation" in sd:
                    try:
                        rotation = int(float(sd["rotation"]))
                    except ValueError:
                        pass

            info["rotation"] = rotation
            # If rotated 90 or 270 degrees, swap width and height for actual visual representation
            if abs(rotation) in (90, 270):
                w, h = h, w

            info["width"] = w
            info["height"] = h

            # FPS parsing (e.g. 30/1 or 60000/1001)
            r_fps = s.get("r_frame_rate", "") or s.get("avg_frame_rate", "")
            if "/" in r_fps:
                try:
                    num, den = r_fps.split("/")
                    if float(den) > 0:
                        info["fps"] = round(float(num) / float(den), 2)
                except Exception:
                    pass

            if not info["duration"]:
                try:
                    info["duration"] = round(float(s.get("duration", 0.0) or 0.0), 2)
                except (ValueError, TypeError):
                    pass

        elif s.get("codec_type") == "audio" and not info["has_audio"]:
            info["has_audio"] = True
            info["audio_codec"] = s.get("codec_name", "")

    # Calculate ratio tag
    w, h = info["width"], info["height"]
    if w > 0 and h > 0:
        ratio = w / h
        if abs(ratio - (9 / 16)) < 0.05:
            info["aspect_ratio"] = "9:16"
        elif abs(ratio - (16 / 9)) < 0.05:
            info["aspect_ratio"] = "16:9"
        elif abs(ratio - 1.0) < 0.05:
            info["aspect_ratio"] = "1:1"
        else:
            info["aspect_ratio"] = f"{w}:{h}"

    return info


def probe_media(file_path: str | Path) -> dict[str, Any]:
    """
    Probe a video or audio file and extract duration, resolution, fps, rotation, and audio details.
    Uses ffprobe if available for full structured JSON & rotation accuracy;
    otherwise falls back to ffmpeg banner inspection.
    """
    path = Path(file_path)
    if not path.exists():
        raise FileNotFoundError(f"Media file not found: {path}")

    # 1. Try ffprobe first
    ffprobe = get_ffprobe_path()
    if ffprobe:
        try:
            return _probe_media_ffprobe(path, ffprobe)
        except Exception as exc:
            logger.debug("ffprobe probe failed, falling back to ffmpeg: %s", exc)

    # 2. Fallback to ffmpeg banner inspection
    ffmpeg = get_ffmpeg_path()
    cmd = [ffmpeg, "-nostdin", "-hide_banner", "-i", str(path)]
    try:
        proc = subprocess.run(
            cmd,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="ignore",
            timeout=15,
        )
        output = proc.stderr or proc.stdout
    except Exception as exc:
        raise RuntimeError(f"Failed to inspect media file: {exc}") from exc

    info: dict[str, Any] = {
        "filename": path.name,
        "path": str(path),
        "size_bytes": path.stat().st_size,
        "duration": 0.0,
        "width": 0,
        "height": 0,
        "fps": 30.0,
        "aspect_ratio": "original",
        "has_audio": False,
        "has_video": False,
        "video_codec": "",
        "audio_codec": "",
        "rotation": 0,
        "probed_by": "ffmpeg_banner",
    }

    # Extract Duration: 00:01:23.45
    dur_match = re.search(r"Duration:\s*(\d+):(\d+):([\d\.]+)", output)
    if dur_match:
        hours = int(dur_match.group(1))
        mins = int(dur_match.group(2))
        secs = float(dur_match.group(3))
        info["duration"] = round(hours * 3600 + mins * 60 + secs, 2)

    # Check for rotation in stderr (e.g. displaymatrix: rotation of -90.00 degrees or rotate : 90)
    rot_match = re.search(r"(?:displaymatrix:\s*rotation of\s*(-?\d+(?:\.\d+)?)\s*degrees|rotate\s*:\s*(-?\d+))", output, re.IGNORECASE)
    rotation = 0
    if rot_match:
        try:
            val_str = rot_match.group(1) or rot_match.group(2)
            rotation = int(float(val_str))
            info["rotation"] = rotation
        except ValueError:
            pass

    # Extract Video Stream: Stream #0:0: Video: h264, yuv420p, 1920x1080 [SAR 1:1 DAR 16:9], 30 fps
    video_match = re.search(r"Stream\s*#\d+:\d+.*Video:\s*(\w+)[^,]*,\s*[^,]+,\s*(\d+)x(\d+)", output)
    if video_match:
        info["has_video"] = True
        info["video_codec"] = video_match.group(1)
        w = int(video_match.group(2))
        h = int(video_match.group(3))

        if abs(rotation) in (90, 270):
            w, h = h, w

        info["width"] = w
        info["height"] = h

        # Calculate ratio tag
        if w > 0 and h > 0:
            ratio = w / h
            if abs(ratio - (9 / 16)) < 0.05:
                info["aspect_ratio"] = "9:16"
            elif abs(ratio - (16 / 9)) < 0.05:
                info["aspect_ratio"] = "16:9"
            elif abs(ratio - 1.0) < 0.05:
                info["aspect_ratio"] = "1:1"
            else:
                info["aspect_ratio"] = f"{w}:{h}"

        fps_match = re.search(r"(\d+(?:\.\d+)?)\s*fps", output)
        if fps_match:
            try:
                info["fps"] = float(fps_match.group(1))
            except ValueError:
                pass

    # Extract Audio Stream: Stream #0:1: Audio: aac (LC), 44100 Hz, stereo, fltp, 128 kb/s
    audio_match = re.search(r"Stream\s*#\d+:\d+.*Audio:\s*(\w+)", output)
    if audio_match:
        info["has_audio"] = True
        info["audio_codec"] = audio_match.group(1)

    return info


def extract_audio(video_path: str | Path, output_path: str | Path | None = None) -> Path:
    """
    Extract audio track from video file as high-quality MP3.
    """
    v_path = Path(video_path)
    if not v_path.exists():
        raise FileNotFoundError(f"Video file not found: {v_path}")

    if output_path is None:
        output_path = v_path.with_suffix(".mp3")
    else:
        output_path = Path(output_path)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    ffmpeg = get_ffmpeg_path()

    cmd = [
        ffmpeg,
        "-y",
        "-i", str(v_path),
        "-vn",
        "-acodec", "libmp3lame",
        "-q:a", "2",
        str(output_path),
    ]

    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8", errors="ignore")
    if proc.returncode != 0 or not output_path.exists():
        raise RuntimeError(f"Audio extraction failed: {proc.stderr[:300]}")

    return output_path


def build_atempo_filter(speed: float) -> str:
    """
    Build chained FFmpeg atempo filters for audio speed scaling.
    atempo only accepts values between 0.5 and 2.0, so chaining handles slow-mo and timelapse.
    """
    factors = []
    s = float(speed)
    if s <= 0.05:
        s = 1.0
    while s > 2.0:
        factors.append("atempo=2.0")
        s /= 2.0
    while s < 0.5:
        factors.append("atempo=0.5")
        s /= 0.5
    factors.append(f"atempo={s:.4f}")
    return ",".join(factors)


def build_filter_complex(
    clip_count: int,
    target_width: int,
    target_height: int,
    clip_durations: list[float],
    clip_speeds: list[float] | None = None,
    transitions: list[dict[str, Any]] | None = None,
    adjustments: dict[str, float] | None = None,
    lut_preset: str = "none",
    has_logo: bool = False,
    logo_settings: dict[str, Any] | None = None,
) -> tuple[str, str, float]:
    """
    Build FFmpeg complex filter chain for:
    - Scaling / Cropping to target aspect ratio (e.g. 9:16 or 16:9)
    - Clip speed factor (slowmotion / fast-forward via setpts)
    - Transitions between clips via xfade (fade, wipe, slide, smooth, circlecrop, dissolve, etc.)
    - Brightness, Contrast, Saturation adjustments
    - Cinematic LUT / color tone filters
    - Watermark logo overlay
    Returns: (filter_str, final_video_label, total_rendered_duration)
    """
    filters: list[str] = []
    video_labels: list[str] = []
    speeds = clip_speeds or [1.0] * clip_count

    # Calculate effective clip durations after speed factor
    effective_durations = []
    for i in range(clip_count):
        spd = max(0.1, speeds[i] if i < len(speeds) else 1.0)
        orig_dur = clip_durations[i] if i < len(clip_durations) else 2.0
        effective_durations.append(orig_dur / spd)

    # 1. Process each video clip input (scale, pad, ensure unified timebase & fps, apply speed)
    for i in range(clip_count):
        label_in = f"{i}:v"
        label_out = f"v{i}_scaled"
        spd = max(0.1, speeds[i] if i < len(speeds) else 1.0)

        # Scale + pad + apply speed (setpts) + normalize to CFR (fps=30,settb=AVTB,format=yuv420p)
        filter_parts = [
            f"scale={target_width}:{target_height}:force_original_aspect_ratio=decrease",
            f"pad={target_width}:{target_height}:(ow-iw)/2:(oh-ih)/2:black",
        ]
        if abs(spd - 1.0) > 0.01:
            pts_factor = 1.0 / spd
            filter_parts.append(f"setpts={pts_factor:.4f}*PTS")
        filter_parts.extend(["fps=30", "settb=AVTB", "format=yuv420p"])

        clip_filter = f"[{label_in}]{','.join(filter_parts)}[{label_out}]"
        filters.append(clip_filter)
        video_labels.append(label_out)

    # 2. Transition or Concat clips
    total_duration = 0.0
    active_transitions = transitions or []
    has_any_transition = any(
        (t.get("name") or "none") not in ("none", "cut")
        for t in active_transitions
    )

    if clip_count > 1 and has_any_transition:
        # Chain clips using xfade
        current_v = video_labels[0]
        current_cum_dur = effective_durations[0]

        for i in range(1, clip_count):
            t_info = active_transitions[i - 1] if i - 1 < len(active_transitions) else {}
            t_name = t_info.get("name", "none")
            req_dur = float(t_info.get("duration", 0.5) or 0.5)

            # Cap transition duration so it cannot exceed 45% of either clip
            max_t_dur = min(effective_durations[i - 1], effective_durations[i]) * 0.45
            t_dur = min(req_dur, max_t_dur)

            next_lbl = f"v_xfade_{i}" if i < clip_count - 1 else "v_merged"

            if t_name not in ("none", "cut") and t_dur >= 0.08:
                offset = max(0.01, current_cum_dur - t_dur)
                xfade_filter = (
                    f"[{current_v}][{video_labels[i]}]xfade=transition={t_name}:"
                    f"duration={t_dur:.3f}:offset={offset:.3f}[{next_lbl}]"
                )
                filters.append(xfade_filter)
                current_cum_dur += effective_durations[i] - t_dur
            else:
                # Fast cut within xfade chain (1 frame ~0.033s cut)
                offset = max(0.01, current_cum_dur - 0.033)
                xfade_filter = (
                    f"[{current_v}][{video_labels[i]}]xfade=transition=fade:"
                    f"duration=0.033:offset={offset:.3f}[{next_lbl}]"
                )
                filters.append(xfade_filter)
                current_cum_dur += effective_durations[i] - 0.033

            current_v = next_lbl

        total_duration = current_cum_dur
    elif clip_count > 1:
        # Standard clean concat when no transition is selected
        concat_inputs = "".join(f"[{lbl}]" for lbl in video_labels)
        concat_filter = f"{concat_inputs}concat=n={clip_count}:v=1:a=0[v_merged]"
        filters.append(concat_filter)
        current_v = "v_merged"
        total_duration = sum(effective_durations)
    else:
        current_v = video_labels[0]
        total_duration = effective_durations[0]

    # 3. Adjustments: Brightness, Contrast, Saturation, Exposure
    adj = adjustments or {}
    brightness = adj.get("brightness", 0.0) / 100.0  # -1.0 to 1.0
    contrast = 1.0 + (adj.get("contrast", 0.0) / 100.0)
    saturation = 1.0 + (adj.get("saturation", 0.0) / 100.0)
    exposure = adj.get("exposure", 0.0) / 100.0
    total_brightness = max(-1.0, min(1.0, brightness + exposure * 0.5))

    eq_parts = []
    if abs(total_brightness) > 0.01:
        eq_parts.append(f"brightness={total_brightness:.2f}")
    if abs(contrast - 1.0) > 0.01:
        eq_parts.append(f"contrast={max(0.1, contrast):.2f}")
    if abs(saturation - 1.0) > 0.01:
        eq_parts.append(f"saturation={max(0.0, saturation):.2f}")

    if eq_parts:
        eq_filter = f"[{current_v}]eq={':'.join(eq_parts)}[v_adj]"
        filters.append(eq_filter)
        current_v = "v_adj"

    # 4. Built-in LUT / Color grading filters
    lut_map = {
        "cinematic": "curves=all='0/0 0.25/0.20 0.75/0.85 1/1':red='0/0 1/1':green='0/0 1/1':blue='0/0.05 0.5/0.48 1/0.95'",
        "warm": "colorbalance=rs=0.15:gs=0.05:bs=-0.1:rm=0.12:gm=0.03:bm=-0.08",
        "teal_orange": "colorbalance=rs=0.15:bs=-0.1:rh=-0.1:gh=0.05:bh=0.15",
        "moody": "curves=all='0/0 0.5/0.4 1/0.95',eq=saturation=0.85:contrast=1.15",
        "vibrant": "eq=saturation=1.45:contrast=1.08",
        "black_white": "hue=s=0",
        "vintage": "curves=vintage,colorbalance=rs=0.08:gs=0.04:bs=-0.08",
    }
    if lut_preset in lut_map:
        lut_filter = f"[{current_v}]{lut_map[lut_preset]}[v_lut]"
        filters.append(lut_filter)
        current_v = "v_lut"

    # 5. Logo watermark overlay
    if has_logo and logo_settings:
        logo_input_idx = clip_count
        logo_w_ratio = logo_settings.get("logo_width_ratio", 0.2)
        logo_opacity = logo_settings.get("logo_opacity", 100) / 100.0
        anchor = logo_settings.get("anchor", "bottom-right")
        pos_x = logo_settings.get("logo_position_x")
        pos_y = logo_settings.get("logo_position_y")

        calc_logo_w = max(40, int(target_width * logo_w_ratio))
        scale_logo = f"[{logo_input_idx}:v]scale={calc_logo_w}:-1"
        if logo_opacity < 0.99:
            scale_logo += f",format=rgba,colorchannelmixer=aa={logo_opacity:.2f}"
        scale_logo += "[logo_ready]"
        filters.append(scale_logo)

        padding = max(16, int(target_width * 0.03))
        if pos_x is not None and pos_y is not None:
            x_expr = f"{int(pos_x * target_width)}"
            y_expr = f"{int(pos_y * target_height)}"
        else:
            if anchor == "bottom-right":
                x_expr = f"W-w-{padding}"
                y_expr = f"H-h-{padding}"
            elif anchor == "bottom-left":
                x_expr = f"{padding}"
                y_expr = f"H-h-{padding}"
            elif anchor == "top-right":
                x_expr = f"W-w-{padding}"
                y_expr = f"{padding}"
            elif anchor == "top-left":
                x_expr = f"{padding}"
                y_expr = f"{padding}"
            elif anchor == "center":
                x_expr = "(W-w)/2"
                y_expr = "(H-h)/2"
            else:
                x_expr = f"W-w-{padding}"
                y_expr = f"H-h-{padding}"

        overlay_filter = f"[{current_v}][logo_ready]overlay=x={x_expr}:y={y_expr}[v_final]"
        filters.append(overlay_filter)
        current_v = "v_final"

    return ";".join(filters), current_v, total_duration


def render_project(
    clips: list[dict[str, Any]],
    output_path: str | Path,
    aspect_ratio: str = "9:16",  # "9:16", "16:9", "1:1", or "original"
    target_resolution: str = "1080p",  # "1080p", "720p"
    transitions: list[dict[str, Any]] | None = None,
    mute_original_audio: bool = False,
    bgm_audio_path: str | Path | None = None,
    bgm_volume: float = 1.0,
    original_audio_volume: float = 1.0,
    adjustments: dict[str, float] | None = None,
    lut_preset: str = "none",
    logo_path: str | Path | None = None,
    logo_settings: dict[str, Any] | None = None,
    progress_callback: Callable[[float, str], None] | None = None,
) -> Path:
    """
    Renders video clips, speed effects, transitions, audio tracks, adjustments, LUT,
    and watermark into a final MP4 video.
    """
    if not clips:
        raise ValueError("At least one video clip is required to render.")

    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    ffmpeg = get_ffmpeg_path()

    # Determine resolution dimensions
    res_map = {
        "9:16": {"1080p": (1080, 1920), "720p": (720, 1280)},
        "16:9": {"1080p": (1920, 1080), "720p": (1280, 720)},
        "1:1": {"1080p": (1080, 1080), "720p": (720, 720)},
    }

    if aspect_ratio in res_map:
        target_w, target_h = res_map[aspect_ratio].get(target_resolution, (1080, 1920))
    else:
        first_probe = probe_media(clips[0]["path"])
        w = first_probe.get("width", 1080)
        h = first_probe.get("height", 1920)
        target_w = w if w % 2 == 0 else w - 1
        target_h = h if h % 2 == 0 else h - 1

    input_args: list[str] = []
    clip_durations: list[float] = []
    clip_speeds: list[float] = []

    # 1. Add video clip inputs (with trimming if specified)
    for c in clips:
        c_path = str(c["path"])
        if not os.path.exists(c_path):
            raise FileNotFoundError(f"Clip not found: {c_path}")

        start_time = float(c.get("start_time", 0.0) or 0.0)
        end_time = float(c.get("end_time", 0.0) or 0.0)
        speed = float(c.get("speed", 1.0) or 1.0)
        clip_speeds.append(max(0.1, speed))

        clip_args = []
        if start_time > 0:
            clip_args.extend(["-ss", f"{start_time:.3f}"])
        if end_time > start_time:
            clip_args.extend(["-to", f"{end_time:.3f}"])
            clip_durations.append(end_time - start_time)
        else:
            p = probe_media(c_path)
            dur = max(0.1, p.get("duration", 5.0) - start_time)
            clip_durations.append(dur)

        clip_args.extend(["-i", c_path])
        input_args.extend(clip_args)

    # 2. Add Logo input if present
    has_logo = False
    if logo_path and os.path.exists(str(logo_path)):
        has_logo = True
        input_args.extend(["-i", str(logo_path)])

    # 3. Add BGM audio input if provided
    has_bgm = False
    bgm_input_index = None
    if bgm_audio_path and os.path.exists(str(bgm_audio_path)):
        has_bgm = True
        bgm_input_index = len(clips) + (1 if has_logo else 0)
        input_args.extend(["-i", str(bgm_audio_path)])

    # 4. Build video filter chain (with speeds and transitions)
    filter_complex_str, final_v_label, total_rendered_duration = build_filter_complex(
        clip_count=len(clips),
        target_width=target_w,
        target_height=target_h,
        clip_durations=clip_durations,
        clip_speeds=clip_speeds,
        transitions=transitions,
        adjustments=adjustments,
        lut_preset=lut_preset,
        has_logo=has_logo,
        logo_settings=logo_settings,
    )

    # 5. Build audio filter chain
    audio_filters: list[str] = []
    final_a_label = ""
    orig_a = ""

    if not mute_original_audio:
        clip_audio_labels: list[str] = []
        for i in range(len(clips)):
            p = probe_media(clips[i]["path"])
            eff_dur = clip_durations[i] / clip_speeds[i]
            if p.get("has_audio"):
                orig_clip_a = f"{i}:a"
                spd = clip_speeds[i]
                if abs(spd - 1.0) > 0.01:
                    spd_lbl = f"a{i}_spd"
                    audio_filters.append(f"[{orig_clip_a}]{build_atempo_filter(spd)}[{spd_lbl}]")
                    clip_audio_labels.append(spd_lbl)
                else:
                    clip_audio_labels.append(orig_clip_a)
            else:
                silence_lbl = f"silence_{i}"
                audio_filters.append(f"anullsrc=r=44100:cl=stereo:d={eff_dur:.3f}[{silence_lbl}]")
                clip_audio_labels.append(silence_lbl)

        # Crossfade audio across transitions if active, or concat
        active_trans = transitions or []
        has_any_trans = any(t.get("name", "none") not in ("none", "cut") for t in active_trans)

        if len(clip_audio_labels) > 1 and has_any_trans:
            current_a = clip_audio_labels[0]
            for i in range(1, len(clip_audio_labels)):
                t_info = active_trans[i - 1] if i - 1 < len(active_trans) else {}
                t_name = t_info.get("name", "none")
                req_dur = float(t_info.get("duration", 0.5) or 0.5)
                max_t_dur = min(clip_durations[i - 1] / clip_speeds[i - 1], clip_durations[i] / clip_speeds[i]) * 0.45
                t_dur = min(req_dur, max_t_dur)

                next_a = f"a_xfade_{i}" if i < len(clip_audio_labels) - 1 else "a_orig_merged"
                if t_name not in ("none", "cut") and t_dur >= 0.08:
                    audio_filters.append(f"[{current_a}][{clip_audio_labels[i]}]acrossfade=d={t_dur:.3f}[{next_a}]")
                else:
                    audio_filters.append(f"[{current_a}][{clip_audio_labels[i]}]acrossfade=d=0.033[{next_a}]")
                current_a = next_a
            orig_a = current_a
        elif len(clip_audio_labels) > 1:
            concat_a_inputs = "".join(f"[{lbl}]" for lbl in clip_audio_labels)
            audio_filters.append(f"{concat_a_inputs}concat=n={len(clip_audio_labels)}:v=0:a=1[a_orig_merged]")
            orig_a = "a_orig_merged"
        elif clip_audio_labels:
            orig_a = clip_audio_labels[0]

        if orig_a and original_audio_volume != 1.0:
            audio_filters.append(f"[{orig_a}]volume={max(0.0, original_audio_volume):.2f}[a_orig]")
            orig_a = "a_orig"

    # Mix with BGM or use BGM alone
    if has_bgm and bgm_input_index is not None:
        bgm_label = f"{bgm_input_index}:a"
        if bgm_volume != 1.0:
            audio_filters.append(f"[{bgm_label}]volume={max(0.0, bgm_volume):.2f}[bgm_vol]")
            bgm_label = "bgm_vol"

        if orig_a:
            audio_filters.append(f"[{orig_a}][{bgm_label}]amix=inputs=2:duration=first:dropout_transition=2[a_final]")
            final_a_label = "a_final"
        else:
            audio_filters.append(f"[{bgm_label}]atrim=0:{total_rendered_duration:.3f}[a_final]")
            final_a_label = "a_final"
    elif orig_a:
        final_a_label = orig_a

    # Combine filters
    all_filters = []
    if filter_complex_str:
        all_filters.append(filter_complex_str)
    if audio_filters:
        all_filters.append(";".join(audio_filters))

    combined_filter_graph = ";".join(all_filters)

    cmd = [ffmpeg, "-y", "-nostats", "-loglevel", "error"]
    cmd.extend(input_args)
    if combined_filter_graph:
        cmd.extend(["-filter_complex", combined_filter_graph])

    cmd.extend(["-map", f"[{final_v_label}]"])
    if final_a_label:
        cmd.extend(["-map", f"[{final_a_label}]", "-c:a", "aac", "-b:a", "192k"])
    else:
        cmd.extend(["-an"])

    # Output encoding: fast H.264 profile high for maximum social media compatibility
    cmd.extend([
        "-c:v", "libx264",
        "-preset", "faster",
        "-crf", "22",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        "-t", f"{total_rendered_duration:.3f}",
        str(out),
    ])

    logger.info("Executing render command: %s", " ".join(cmd))
    start_ts = time.time()

    process = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="ignore",
    )

    # Poll process and update progress
    while process.poll() is None:
        elapsed = time.time() - start_ts
        if total_rendered_duration > 0:
            pct = min(95.0, (elapsed / max(total_rendered_duration * 0.8, 1.0)) * 100.0)
            if progress_callback:
                progress_callback(round(pct, 1), f"Rendering video: {round(pct)}%")
        time.sleep(0.4)

    stdout, stderr = process.communicate()
    if process.returncode != 0:
        logger.error("FFmpeg render failed: %s", stderr)
        raise RuntimeError(f"Render failed: {stderr[-500:]}")

    if progress_callback:
        progress_callback(100.0, "Render complete!")

    return out
