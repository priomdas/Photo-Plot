from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from PIL import Image, ImageStat


DEFAULT_ADJUSTMENTS: dict[str, float] = {
    # Light
    "exposure": 0.0,      # -100 to +100 (maps to -2.0 to +2.0 EV)
    "contrast": 0.0,      # -100 to +100
    "highlights": 0.0,    # -100 to +100
    "shadows": 0.0,       # -100 to +100
    "whites": 0.0,        # -100 to +100
    "blacks": 0.0,        # -100 to +100
    # Color
    "temperature": 0.0,   # -100 (Cool) to +100 (Warm)
    "tint": 0.0,          # -100 (Green) to +100 (Magenta)
    "vibrance": 0.0,      # -100 to +100
    "saturation": 0.0,    # -100 to +100
    # Presence & Effects
    "clarity": 0.0,       # -100 to +100
    "dehaze": 0.0,        # -100 to +100
    "vignette": 0.0,      # -100 to +100
    "grain": 0.0,         # 0 to 100
    # Detail
    "sharpness": 25.0,    # 0 to 150 (default 25 in Lightroom)
}


def _extract_xmp_text(data: bytes) -> str | None:
    """Find and extract the XMP metadata XML string from binary data."""
    start_tag = b"<x:xmpmeta"
    start_idx = data.find(start_tag)
    if start_idx == -1:
        start_tag = b"<rdf:RDF"
        start_idx = data.find(start_tag)
    if start_idx == -1:
        return None

    end_idx = data.find(b"</x:xmpmeta>", start_idx)
    if end_idx != -1:
        end_idx += len(b"</x:xmpmeta>")
    else:
        end_idx = data.find(b"</rdf:RDF>", start_idx)
        if end_idx != -1:
            end_idx += len(b"</rdf:RDF>")
        else:
            end_idx = min(len(data), start_idx + 65536)

    try:
        return data[start_idx:end_idx].decode("utf-8", errors="ignore")
    except Exception:
        return None


def parse_xmp_settings(xmp_str: str) -> dict[str, float]:
    """Parse Lightroom / Camera Raw settings from an XMP string."""
    adjustments = dict(DEFAULT_ADJUSTMENTS)
    found_any = False

    def find_num(tag_name: str) -> float | None:
        # Match attribute: crs:Exposure2012="+0.50" or tag: <crs:Exposure2012>+0.50</crs:Exposure2012>
        attr_pattern = rf"crs:{tag_name}\s*=\s*[\"']([+-]?\d+(?:\.\d+)?)[\"']"
        m = re.search(attr_pattern, xmp_str, re.IGNORECASE)
        if m:
            return float(m.group(1))

        tag_pattern = rf"<crs:{tag_name}[^>]*>\s*([+-]?\d+(?:\.\d+)?)\s*</crs:{tag_name}>"
        m2 = re.search(tag_pattern, xmp_str, re.IGNORECASE)
        if m2:
            return float(m2.group(1))

        return None

    # Exposure: Lightroom saves as EV offset (e.g. +0.5, -1.2). We convert to -100..100 scale.
    exp = find_num("Exposure2012")
    if exp is None:
        exp = find_num("Exposure")
    if exp is not None:
        adjustments["exposure"] = max(-100.0, min(100.0, round(exp * 50.0, 1)))
        found_any = True

    contrast = find_num("Contrast2012") or find_num("Contrast")
    if contrast is not None:
        adjustments["contrast"] = max(-100.0, min(100.0, round(contrast, 1)))
        found_any = True

    highlights = find_num("Highlights2012") or find_num("Highlights")
    if highlights is not None:
        adjustments["highlights"] = max(-100.0, min(100.0, round(highlights, 1)))
        found_any = True

    shadows = find_num("Shadows2012") or find_num("Shadows")
    if shadows is not None:
        adjustments["shadows"] = max(-100.0, min(100.0, round(shadows, 1)))
        found_any = True

    whites = find_num("Whites2012") or find_num("Whites")
    if whites is not None:
        adjustments["whites"] = max(-100.0, min(100.0, round(whites, 1)))
        found_any = True

    blacks = find_num("Blacks2012") or find_num("Blacks")
    if blacks is not None:
        adjustments["blacks"] = max(-100.0, min(100.0, round(blacks, 1)))
        found_any = True

    # Temperature: Can be in Kelvin (e.g. 5500) or offset (-100 to +100)
    temp = find_num("Temperature")
    if temp is not None:
        if temp > 1000:
            # Baseline daylight is 5500K
            temp_offset = (temp - 5500.0) / 45.0
            adjustments["temperature"] = max(-100.0, min(100.0, round(temp_offset, 1)))
        else:
            adjustments["temperature"] = max(-100.0, min(100.0, round(temp, 1)))
        found_any = True

    tint = find_num("Tint")
    if tint is not None:
        adjustments["tint"] = max(-100.0, min(100.0, round(tint, 1)))
        found_any = True

    vibrance = find_num("Vibrance")
    if vibrance is not None:
        adjustments["vibrance"] = max(-100.0, min(100.0, round(vibrance, 1)))
        found_any = True

    sat = find_num("Saturation")
    if sat is not None:
        adjustments["saturation"] = max(-100.0, min(100.0, round(sat, 1)))
        found_any = True

    clarity = find_num("Clarity2012") or find_num("Clarity")
    if clarity is not None:
        adjustments["clarity"] = max(-100.0, min(100.0, round(clarity, 1)))
        found_any = True

    dehaze = find_num("Dehaze")
    if dehaze is not None:
        adjustments["dehaze"] = max(-100.0, min(100.0, round(dehaze, 1)))
        found_any = True

    sharp = find_num("Sharpness")
    if sharp is not None:
        adjustments["sharpness"] = max(0.0, min(150.0, round(sharp, 1)))
        found_any = True

    vignette = find_num("PostCropVignetteAmount") or find_num("VignetteAmount")
    if vignette is not None:
        adjustments["vignette"] = max(-100.0, min(100.0, round(vignette, 1)))
        found_any = True

    grain = find_num("GrainAmount")
    if grain is not None:
        adjustments["grain"] = max(0.0, min(100.0, round(grain, 1)))
        found_any = True

    return adjustments if found_any else {}


def analyze_image_for_preset(img: Image.Image) -> dict[str, float]:
    """
    If a DNG has no XMP develop tags, analyze its visual properties to extract
    matching Lightroom sliders (exposure, contrast, highlights, shadows, temp, tint, vibrance).
    """
    thumb = img.copy().convert("RGB")
    thumb.thumbnail((400, 400), Image.Resampling.BILINEAR)

    stats = ImageStat.Stat(thumb)
    means = stats.mean  # [R, G, B]
    stds = stats.stddev

    r, g, b = means[0], means[1], means[2]
    lum = 0.299 * r + 0.587 * g + 0.114 * b

    # Target midtone is ~128
    exp = max(-80.0, min(80.0, round((lum - 128.0) * 0.8, 1)))

    # Contrast from standard deviation (typical avg stddev ~55)
    avg_std = sum(stds) / 3.0
    contrast = max(-60.0, min(80.0, round((avg_std - 55.0) * 1.5, 1)))

    # Temperature from Red vs Blue
    temp = max(-70.0, min(70.0, round((r - b) * 1.2, 1)))

    # Tint from Green vs (Red + Blue) / 2
    rb_avg = (r + b) / 2.0
    tint = max(-60.0, min(60.0, round((rb_avg - g) * 1.2, 1)))

    # Saturation from channel spread
    max_c = max(r, g, b)
    min_c = min(r, g, b)
    spread = max_c - min_c
    sat = max(-50.0, min(50.0, round((spread - 30.0) * 0.8, 1)))

    return {
        "exposure": exp,
        "contrast": contrast,
        "highlights": -10.0 if lum > 140 else 10.0,
        "shadows": 15.0 if lum < 110 else 0.0,
        "whites": 5.0,
        "blacks": -5.0,
        "temperature": temp,
        "tint": tint,
        "vibrance": round(sat * 0.8, 1),
        "saturation": round(sat * 0.5, 1),
        "clarity": 10.0,
        "dehaze": 5.0,
        "vignette": 0.0,
        "grain": 0.0,
        "sharpness": 30.0,
    }


def load_preset_file(file_path: Path) -> tuple[str, dict[str, Any]]:
    """
    Inspects a preset file (.dng, .xmp, .json) and returns (preset_name, preset_dict).
    """
    name = file_path.stem.replace("_", " ").title()
    data = file_path.read_bytes()

    # 1. If it's a JSON preset
    if file_path.suffix.lower() == ".json":
        try:
            parsed = json.loads(data.decode("utf-8"))
            if "adjustments" in parsed:
                return parsed.get("name", name), parsed
        except Exception:
            pass

    # 2. Check for embedded XMP data (DNG, XMP, TIFF, XML)
    xmp_text = _extract_xmp_text(data)
    if xmp_text:
        extracted = parse_xmp_settings(xmp_text)
        if extracted:
            return name, {
                "name": name,
                "adjustments": extracted,
                "source": "xmp_dng",
            }

    # 3. Fallback: If DNG image without XMP, open and analyze its visual look
    try:
        from .processor import _open_image
        with _open_image(file_path) as img:
            analyzed = analyze_image_for_preset(img)
            return name, {
                "name": name,
                "adjustments": analyzed,
                "source": "analyzed_dng",
            }
    except Exception:
        pass

    # Default fallback
    return name, {
        "name": name,
        "adjustments": dict(DEFAULT_ADJUSTMENTS),
        "source": "default",
    }
