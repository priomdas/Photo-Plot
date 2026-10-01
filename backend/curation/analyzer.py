from __future__ import annotations

import math
from typing import Any

import cv2
import numpy as np


def analyze_sharpness(gray: np.ndarray) -> tuple[float, float]:
    """
    Calculate image sharpness using Laplacian variance.
    Returns (raw_variance, normalized_sharpness_0_to_100).
    A variance < 100 indicates blur, 300-800 is normal, 1000+ is pin-sharp.
    """
    # Downscale slightly for speed if image is huge, but keep at least 1200px
    h, w = gray.shape[:2]
    if max(h, w) > 1600:
        scale = 1600.0 / max(h, w)
        gray = cv2.resize(gray, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)

    laplacian = cv2.Laplacian(gray, cv2.CV_64F)
    variance = float(laplacian.var())

    # Map raw variance to 0-100 score using log-logistic response curve
    # 50 variance -> ~30 score
    # 250 variance -> ~65 score
    # 800 variance -> ~85 score
    # 2000+ variance -> ~98 score
    score = 100.0 / (1.0 + math.exp(-0.0035 * (variance - 220.0)))
    normalized = max(0.0, min(100.0, round(score, 1)))
    return round(variance, 2), normalized


def analyze_blur(gray: np.ndarray, threshold_variance: float = 120.0) -> tuple[float, bool]:
    """
    Determine if an image suffers from motion or defocus blur.
    Returns (blur_confidence_score_0_to_100, is_blurry).
    """
    raw_var, _ = analyze_sharpness(gray)
    is_blurry = raw_var < threshold_variance
    # Confidence that the image is blurred (100 = definitely blurry, 0 = sharp)
    blur_score = max(0.0, min(100.0, round((1.0 - min(1.0, raw_var / (threshold_variance * 2.5))) * 100.0, 1)))
    return blur_score, is_blurry


def analyze_exposure(bgr: np.ndarray) -> tuple[float, str]:
    """
    Analyze exposure using luminance histogram.
    Checks for clipped blacks (underexposure), clipped whites (blown highlights), and contrast.
    Returns (exposure_score_0_to_100, exposure_label).
    """
    # Convert to YCrCb to inspect luminance Y
    ycrcb = cv2.cvtColor(bgr, cv2.COLOR_BGR2YCrCb)
    y_channel = ycrcb[:, :, 0]
    total_pixels = y_channel.size

    hist = cv2.calcHist([y_channel], [0], None, [256], [0, 256]).flatten()

    # Fraction of clipped shadow/highlight pixels
    under_clipped = np.sum(hist[:8]) / total_pixels
    over_clipped = np.sum(hist[248:]) / total_pixels

    mean_luma = float(np.mean(y_channel))
    std_luma = float(np.std(y_channel))

    # Determine classification
    label = "Balanced"
    if under_clipped > 0.15 or mean_luma < 45.0:
        label = "Underexposed"
    elif over_clipped > 0.15 or mean_luma > 215.0:
        label = "Overexposed"
    elif std_luma < 25.0:
        label = "Low Contrast"

    # Score penalty based on clipping and deviation from ideal middle-gray (~115-140)
    penalty = (under_clipped * 80.0) + (over_clipped * 90.0)
    center_dist = abs(mean_luma - 128.0) / 128.0
    contrast_bonus = min(20.0, (std_luma / 55.0) * 20.0)

    score = 100.0 - (center_dist * 35.0) - penalty + contrast_bonus
    normalized = max(5.0, min(100.0, round(score, 1)))
    return normalized, label


def analyze_resolution(width: int, height: int) -> float:
    """
    Calculate resolution score (0 to 100) based on total megapixels.
    < 2MP (1080p): 40-70
    8MP (4K): 80-88
    24MP (DSLR): 95
    36MP+: 100
    """
    megapixels = (width * height) / 1_000_000.0
    if megapixels <= 0:
        return 0.0
    # Logarithmic progression
    score = 25.0 + 22.0 * math.log(max(1.0, megapixels) + 1.0)
    return max(10.0, min(100.0, round(score, 1)))


def analyze_noise(gray: np.ndarray) -> float:
    """
    Estimate image noise in homogeneous (smooth) regions using median absolute deviation.
    Returns noise quality score (0 to 100, where 100 is pristine / no noise, 0 is heavy noise).
    """
    # Downsample if needed
    h, w = gray.shape[:2]
    if max(h, w) > 800:
        scale = 800.0 / max(h, w)
        gray = cv2.resize(gray, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)

    # Immersed Laplacian kernel estimation
    h_kernel = np.array([[1, -2, 1], [-2, 4, -2], [1, -2, 1]], dtype=np.float32)
    filtered = cv2.filter2D(gray.astype(np.float32), -1, h_kernel)
    sigma = np.sum(np.abs(filtered)) * (math.sqrt(0.5 * math.pi) / (6 * (w - 2) * (h - 2)))

    # Sigma 0-2 -> pristine (90-100)
    # Sigma 5 -> moderate noise (~75)
    # Sigma 15+ -> heavy noise (< 50)
    score = 100.0 / (1.0 + (sigma / 8.0) ** 1.5)
    return max(0.0, min(100.0, round(score, 1)))


def analyze_photo_properties(bgr: np.ndarray) -> dict[str, Any]:
    """
    Perform complete baseline quality analysis on an image array.
    Runs fast on CPU in < 30ms per image.
    """
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    h, w = bgr.shape[:2]

    raw_var, sharpness_score = analyze_sharpness(gray)
    blur_score, is_blurry = analyze_blur(gray)
    exposure_score, exposure_label = analyze_exposure(bgr)
    resolution_score = analyze_resolution(w, h)
    noise_score = analyze_noise(gray)

    return {
        "width": w,
        "height": h,
        "sharpness_raw": raw_var,
        "sharpness_score": sharpness_score,
        "blur_score": blur_score,
        "is_blurry": is_blurry,
        "exposure_score": exposure_score,
        "exposure_label": exposure_label,
        "resolution_score": resolution_score,
        "noise_score": noise_score,
    }
