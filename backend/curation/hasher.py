from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Union

import cv2
import numpy as np
from PIL import Image


def compute_sha256(file_path: Union[str, Path], chunk_size: int = 65536) -> str:
    """Compute cryptographic SHA-256 hash of a file efficiently using chunks."""
    h = hashlib.sha256()
    with open(file_path, "rb") as f:
        while chunk := f.read(chunk_size):
            h.update(chunk)
    return h.hexdigest()


def _to_grayscale_numpy(image: Union[Image.Image, np.ndarray]) -> np.ndarray:
    """Helper to convert PIL Image or numpy array to a grayscale uint8 numpy array."""
    if isinstance(image, Image.Image):
        if image.mode != "L":
            image = image.convert("L")
        return np.asarray(image, dtype=np.uint8)
    if isinstance(image, np.ndarray):
        if image.ndim == 3:
            if image.shape[2] == 4:
                return cv2.cvtColor(image, cv2.COLOR_BGRA2GRAY)
            return cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        return image.astype(np.uint8)
    raise TypeError(f"Unsupported image type: {type(image)}")


def compute_phash(image: Union[Image.Image, np.ndarray], hash_size: int = 8, highfreq_factor: int = 4) -> str:
    """
    Compute 64-bit Perceptual Hash (pHash) using Discrete Cosine Transform (DCT).
    Highly robust against minor color tweaks, compression, and scaling.
    """
    gray = _to_grayscale_numpy(image)
    img_size = hash_size * highfreq_factor  # default 32x32
    resized = cv2.resize(gray, (img_size, img_size), interpolation=cv2.INTER_AREA)

    # 2D DCT on float32
    dct = cv2.dct(resized.astype(np.float32))

    # Top-left 8x8 low frequency coefficients
    dct_low = dct[:hash_size, :hash_size]

    # Compute median excluding the DC term (0,0)
    flat = dct_low.flatten()
    median = np.median(flat[1:]) if len(flat) > 1 else flat[0]

    # 64-bit boolean mask
    bits = (dct_low > median).flatten()
    return _bits_to_hex(bits)


def compute_dhash(image: Union[Image.Image, np.ndarray], hash_size: int = 8) -> str:
    """
    Compute 64-bit Difference Hash (dHash) comparing adjacent pixels.
    Very fast and sensitive to relative intensity gradients.
    """
    gray = _to_grayscale_numpy(image)
    # Width = hash_size + 1 (9), Height = hash_size (8)
    resized = cv2.resize(gray, (hash_size + 1, hash_size), interpolation=cv2.INTER_AREA)

    # Difference between left and right neighbor
    diff = resized[:, 1:] > resized[:, :-1]
    return _bits_to_hex(diff.flatten())


def compute_ahash(image: Union[Image.Image, np.ndarray], hash_size: int = 8) -> str:
    """Compute 64-bit Average Hash (aHash) comparing against mean intensity."""
    gray = _to_grayscale_numpy(image)
    resized = cv2.resize(gray, (hash_size, hash_size), interpolation=cv2.INTER_AREA)
    avg = resized.mean()
    bits = (resized > avg).flatten()
    return _bits_to_hex(bits)


def _bits_to_hex(bits: np.ndarray) -> str:
    """Convert a 64-element boolean array into a 16-character hexadecimal string."""
    value = 0
    for b in bits:
        value = (value << 1) | int(bool(b))
    return f"{value:016x}"


def hamming_distance(hash1: str, hash2: str) -> int:
    """Compute Hamming distance between two 16-character hex hashes (0 to 64)."""
    try:
        val1 = int(hash1, 16)
        val2 = int(hash2, 16)
        return (val1 ^ val2).bit_count()
    except Exception:
        return 64
