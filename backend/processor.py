from __future__ import annotations

from pathlib import Path
from typing import Any

from PIL import Image, ImageEnhance, ImageOps
from pillow_heif import register_heif_opener

register_heif_opener()


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
    x = int(bw * ox)
    y = int(bh * oy)
    if "right" in anchor:
        x = bw - lw - x
    if "center" in anchor:
        x = (bw - lw) // 2
    if "bottom" in anchor:
        y = bh - lh - y
    if anchor == "center":
        y = (bh - lh) // 2
    return max(0, x), max(0, y)


def _transfer_reference_color(image: Image.Image, reference: Image.Image) -> Image.Image:
    """Match luminance/chroma distribution using a lightweight LAB transfer."""
    import numpy as np
    import cv2

    source_rgb = np.asarray(image.convert("RGB"))
    reference_rgb = np.asarray(reference.convert("RGB"))
    source_lab = cv2.cvtColor(source_rgb, cv2.COLOR_RGB2LAB).astype(np.float32)
    reference_lab = cv2.cvtColor(reference_rgb, cv2.COLOR_RGB2LAB).astype(np.float32)
    for channel in range(3):
        source_mean, source_std = source_lab[:, :, channel].mean(), source_lab[:, :, channel].std()
        reference_mean, reference_std = reference_lab[:, :, channel].mean(), reference_lab[:, :, channel].std()
        source_lab[:, :, channel] = (source_lab[:, :, channel] - source_mean) * (reference_std / max(source_std, 1e-6)) + reference_mean
    transferred = cv2.cvtColor(np.clip(source_lab, 0, 255).astype(np.uint8), cv2.COLOR_LAB2RGB)
    return Image.fromarray(transferred).convert("RGBA")


def process_image(
    source: Path,
    output_dir: Path,
    preset: dict[str, Any],
    logo_path: Path | None = None,
    reference_path: Path | None = None,
) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    opened = _open_image(source)
    try:
        image = ImageOps.exif_transpose(opened).convert("RGBA")
        if reference_path and reference_path.exists():
            reference = _open_image(reference_path)
            try:
                image = _transfer_reference_color(image, ImageOps.exif_transpose(reference))
            finally:
                reference.close()
        max_width, max_height = preset.get("max_width"), preset.get("max_height")
        if max_width or max_height:
            image.thumbnail((max_width or image.width, max_height or image.height), Image.Resampling.LANCZOS)
        adjustments = preset.get("adjustments", {})
        image = ImageEnhance.Brightness(image).enhance(float(adjustments.get("brightness", 1.0)))
        image = ImageEnhance.Contrast(image).enhance(float(adjustments.get("contrast", 1.0)))
        image = ImageEnhance.Color(image).enhance(float(adjustments.get("saturation", 1.0)))
        image = ImageEnhance.Sharpness(image).enhance(float(adjustments.get("sharpness", 1.0)))
        if logo_path and logo_path.exists():
            with Image.open(logo_path) as logo:
                logo = logo.convert("RGBA")
                width_ratio = max(0.01, min(1.0, float(preset.get("logo_width_ratio", 0.20))))
                scale = min(image.width * width_ratio / logo.width, image.height * 0.8 / logo.height)
                logo = logo.resize((max(1, int(logo.width * scale)), max(1, int(logo.height * scale))), Image.Resampling.LANCZOS)
                opacity = max(0, min(100, int(preset.get("logo_opacity", 100)))) / 100
                if opacity < 1:
                    alpha = logo.getchannel("A").point(lambda value: int(value * opacity))
                    logo.putalpha(alpha)
                if preset.get("logo_position_x") is not None and preset.get("logo_position_y") is not None:
                    x = int(float(preset["logo_position_x"]) * image.width)
                    y = int(float(preset["logo_position_y"]) * image.height)
                    position = (max(0, min(image.width - logo.width, x)), max(0, min(image.height - logo.height, y)))
                else:
                    position = _anchor_position(image.size, logo.size, preset.get("anchor", "bottom-right"), float(preset.get("offset_x", .03)), float(preset.get("offset_y", .03)))
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
    return destination
