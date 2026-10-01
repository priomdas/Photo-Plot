from __future__ import annotations

from pathlib import Path
from typing import Any

import cv2
import numpy as np
from PIL import Image, ImageOps
from pillow_heif import register_heif_opener

register_heif_opener()


def resolve_device(requested_device: str = "auto") -> tuple[bool, str]:
    req = (requested_device or "auto").lower()
    if req == "cpu":
        return False, "CPU"

    gpu_available = False
    dev_name = "GPU"
    try:
        if cv2.ocl.haveOpenCL():
            cv2.ocl.setUseOpenCL(True)
            dev = cv2.ocl.Device.getDefault()
            if dev and dev.available():
                gpu_available = True
                dev_name = dev.name()
    except Exception:
        pass

    if req == "gpu":
        if gpu_available:
            return True, f"GPU ({dev_name})"
        return False, "CPU (GPU requested but unavailable)"


    if gpu_available:
        return True, f"GPU ({dev_name})"
    return False, "CPU"


def _open_image(path: Path) -> Image.Image:
    try:
        return Image.open(path)
    except Exception as pillow_error:
        try:
            import rawpy
        except ImportError:
            raise pillow_error
        try:
            with rawpy.imread(str(path)) as raw:
                rgb = raw.postprocess(use_camera_wb=True, output_bps=8)
            return Image.fromarray(rgb)
        except Exception:
            raise pillow_error


def _anchor_position(base: tuple[int, int], logo: tuple[int, int], anchor: str, ox: float, oy: float) -> tuple[int, int]:
    bw, bh = base
    lw, lh = logo
    base_dim = min(bw, bh)
    x = int(base_dim * ox)
    y = int(base_dim * oy)
    if "right" in anchor:
        x = bw - lw - x
    if "center" in anchor:
        x = (bw - lw) // 2
    if "bottom" in anchor:
        y = bh - lh - y
    if anchor == "center":
        y = (bh - lh) // 2
    return max(0, min(bw - lw, x)), max(0, min(bh - lh, y))


def _get_adj(adj: dict[str, float], key: str, default: float = 0.0, scale: float = 100.0) -> float:
    return float(adj.get(key, default)) / scale


# (key, scale, gain, mask_fn)
_TONAL_CURVES: list[tuple[str, float, float, Any]] = [
    ("highlights", 100.0, 0.35, lambda x: np.clip((x - 0.5) * 2.0, 0.0, 1.0)),
    ("shadows",    100.0, 0.35, lambda x: np.clip((0.5 - x) * 2.0, 0.0, 1.0)),
    ("whites",     100.0, 0.25, lambda x: np.clip((x - 0.7) * 3.33, 0.0, 1.0)),
    ("blacks",     100.0, 0.25, lambda x: np.clip((0.3 - x) * 3.33, 0.0, 1.0)),
]


def _build_tonal_lut(adj: dict[str, float]) -> np.ndarray:
    x = np.arange(256, dtype=np.float32) / 255.0


    exp = _get_adj(adj, "exposure", scale=50.0)
    if exp != 0:
        x *= 2.0 ** exp


    contrast = _get_adj(adj, "contrast")
    if contrast != 0:
        x = (x - 0.5) * (1.0 + contrast) + 0.5


    for key, scale, gain, mask_fn in _TONAL_CURVES:
        value = _get_adj(adj, key, scale=scale)
        if value != 0:
            x += value * gain * mask_fn(x)

    return np.clip(x * 255.0, 0, 255).astype(np.uint8)


def _build_color_matrix(adj: dict[str, float]) -> np.ndarray:
    temp = _get_adj(adj, "temperature")
    tint = _get_adj(adj, "tint")
    sat  = _get_adj(adj, "saturation")
    vib  = _get_adj(adj, "vibrance")

    s = 1.0 + sat + vib * 0.5
    m_b, m_g, m_r = (1.0 - s) * 0.114, (1.0 - s) * 0.587, (1.0 - s) * 0.299

    mat = np.array([
        [m_b + s, m_g,     m_r    ],
        [m_b,     m_g + s, m_r    ],
        [m_b,     m_g,     m_r + s],
    ], dtype=np.float32)

    if temp != 0 or tint != 0:
        mat[0, 0] += -temp * 0.12 + tint * 0.05
        mat[1, 1] += -tint * 0.12
        mat[2, 2] +=  temp * 0.12 + tint * 0.05

    return mat


def _apply_spatial(frame, adj: dict[str, float], w: int, h: int):
    clarity = _get_adj(adj, "clarity")
    if clarity != 0:
        sigma = max(3, int(min(w, h) * 0.015))
        blurred = cv2.GaussianBlur(frame, (0, 0), sigmaX=sigma)
        frame = cv2.addWeighted(frame, 1.0 + clarity * 0.7, blurred, -clarity * 0.7, 0)

    sharpness = float(adj.get("sharpness", 25.0))
    if sharpness > 25.0:
        k = ((sharpness - 25.0) / 50.0) * 0.5
        blurred = cv2.GaussianBlur(frame, (0, 0), sigmaX=1.2)
        frame = cv2.addWeighted(frame, 1.0 + k, blurred, -k, 0)

    return frame


def _apply_auto_enhance(bgr: np.ndarray, strength: float = 70.0) -> np.ndarray:
    strength_factor = max(0.0, min(1.0, float(strength) / 100.0))
    if strength_factor <= 0.0:
        return bgr

    lab = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB)
    L, A, B = cv2.split(lab)

    # 1. Local Contrast Enhancement via CLAHE on Luminance channel
    clahe = cv2.createCLAHE(clipLimit=1.6, tileGridSize=(8, 8))
    l_clahe = clahe.apply(L)

    # 2. High-frequency micro-contrast and texture edge enhancement
    blurred_l = cv2.GaussianBlur(l_clahe, (0, 0), sigmaX=1.2)
    detail = cv2.subtract(l_clahe, blurred_l)
    l_sharp = cv2.addWeighted(l_clahe, 1.0, detail, 1.0, 0)

    # 3. Dynamic range expansion: blend enhanced luminance with original
    l_out = cv2.addWeighted(L, 1.0 - strength_factor, l_sharp, strength_factor, 0)

    # 4. Adaptive vibrance boost on chrominance (A & B channels)
    a_centered = A.astype(np.float32) - 128.0
    b_centered = B.astype(np.float32) - 128.0
    sat_boost = 1.0 + 0.08 * strength_factor
    A_out = np.clip(a_centered * sat_boost + 128.0, 0, 255).astype(np.uint8)
    B_out = np.clip(b_centered * sat_boost + 128.0, 0, 255).astype(np.uint8)

    enhanced_lab = cv2.merge([l_out, A_out, B_out])
    return cv2.cvtColor(enhanced_lab, cv2.COLOR_LAB2BGR)


def apply_lightroom_adjustments(
    image: Image.Image,
    adj: dict[str, float],
    use_gpu: bool = False,
    auto_enhance: bool = False,
    enhance_strength: float = 70.0,
) -> Image.Image:
    bgr = cv2.cvtColor(np.asarray(image.convert("RGB")), cv2.COLOR_RGB2BGR)
    h, w, _ = bgr.shape
    cv2.ocl.setUseOpenCL(use_gpu)

    if auto_enhance:
        bgr = _apply_auto_enhance(bgr, enhance_strength)

    lut = _build_tonal_lut(adj)
    color_mat = _build_color_matrix(adj)


    if use_gpu:
        try:
            u = cv2.LUT(cv2.UMat(bgr), lut)
            u = cv2.transform(u, color_mat)
            res_bgr = _apply_spatial(u, adj, w, h).get()
        except Exception:
            use_gpu = False

    if not use_gpu:
        res_bgr = cv2.transform(cv2.LUT(bgr, lut), color_mat)
        res_bgr = _apply_spatial(res_bgr, adj, w, h)


    vignette = _get_adj(adj, "vignette")
    if vignette != 0:
        yi, xi = np.indices((h, w), dtype=np.float32)
        radius = np.sqrt(((xi - w / 2.0) / (w / 2.0)) ** 2 +
                         ((yi - h / 2.0) / (h / 2.0)) ** 2) / 1.414
        mask = np.clip(1.0 + vignette * (radius ** 1.5), 0.0, 2.0)[:, :, None]
        res_bgr = np.clip(res_bgr.astype(np.float32) * mask, 0, 255).astype(np.uint8)


    grain = float(adj.get("grain", 0.0))
    if grain > 0:
        noise = np.random.normal(0, grain * 0.35, res_bgr.shape).astype(np.float32)
        res_bgr = np.clip(res_bgr.astype(np.float32) + noise, 0, 255).astype(np.uint8)

    return Image.fromarray(cv2.cvtColor(res_bgr, cv2.COLOR_BGR2RGBA))


def process_image(
    source: Path,
    output_dir: Path,
    preset: dict[str, Any],
    logo_path: Path | None = None,
    device: str = "auto",
) -> tuple[Path, str]:
    output_dir.mkdir(parents=True, exist_ok=True)
    use_gpu, device_used = resolve_device(device)

    opened = _open_image(source)
    try:
        image = ImageOps.exif_transpose(opened).convert("RGBA")


        max_width, max_height = preset.get("max_width"), preset.get("max_height")
        if max_width or max_height:
            target_w = max_width or image.width
            target_h = max_height or image.height
            image.thumbnail((target_w, target_h), Image.Resampling.LANCZOS)


        adjustments = preset.get("adjustments", {})
        auto_enhance = bool(preset.get("auto_enhance", False))
        enhance_strength = float(preset.get("enhance_strength", 70.0))
        image = apply_lightroom_adjustments(
            image,
            adjustments,
            use_gpu=use_gpu,
            auto_enhance=auto_enhance,
            enhance_strength=enhance_strength,
        )


        if logo_path and logo_path.exists():
            with Image.open(logo_path) as logo:
                logo = logo.convert("RGBA")
                width_ratio = max(0.01, min(1.0, float(preset.get("logo_width_ratio", 0.20))))
                base_dim = min(image.width, image.height)
                target_w = base_dim * width_ratio
                scale = min(
                    target_w / max(1, logo.width),
                    (image.width * 0.95) / max(1, logo.width),
                    (image.height * 0.95) / max(1, logo.height),
                )
                logo_w = max(1, int(round(logo.width * scale)))
                logo_h = max(1, int(round(logo.height * scale)))
                logo = logo.resize((logo_w, logo_h), Image.Resampling.LANCZOS)

                opacity = max(0, min(100, int(preset.get("logo_opacity", 100)))) / 100.0
                if opacity < 1.0:
                    alpha = logo.getchannel("A").point(lambda value: int(value * opacity))
                    logo.putalpha(alpha)

                if preset.get("logo_position_x") is not None and preset.get("logo_position_y") is not None:
                    raw_x = int(float(preset["logo_position_x"]) * image.width)
                    raw_y = int(float(preset["logo_position_y"]) * image.height)
                    position = (max(0, min(image.width - logo_w, raw_x)), max(0, min(image.height - logo_h, raw_y)))
                else:
                    position = _anchor_position(
                        (image.width, image.height),
                        (logo_w, logo_h),
                        str(preset.get("anchor", "bottom-right")),
                        float(preset.get("offset_x", 0.03)),
                        float(preset.get("offset_y", 0.03)),
                    )
                image.alpha_composite(logo, position)

        fmt = str(preset.get("format", "JPEG")).upper()
        suffix = ".png" if fmt == "PNG" else ".webp" if fmt == "WEBP" else ".jpg"
        destination = output_dir / f"{source.stem}_processed{suffix}"
        counter = 2
        while destination.exists():
            destination = output_dir / f"{source.stem}_processed_{counter}{suffix}"
            counter += 1

        save_image = image if fmt == "PNG" else image.convert("RGB")
        options: dict[str, Any] = {"format": fmt, "optimize": True}
        if fmt != "PNG":
            options["quality"] = int(preset.get("quality", 90))
        save_image.save(destination, **options)
    finally:
        opened.close()

    return destination, device_used
