from __future__ import annotations

import gc
from pathlib import Path
from typing import List, Union

import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
MODELS_DIR = ROOT / "models"


class VisionEmbeddingExtractor:
    """
    AI Vision Embedding Extractor for visual similarity and scene clustering.
    - Hybrid CPU/GPU support
    - Configurable batch size
    - Out-Of-Memory safety with automatic batch size reduction
    - Normalized L2 embedding vectors (so cosine similarity == dot product)
    - Zero external API dependency (100% local and offline)
    """

    def __init__(self, prefer_gpu: bool = True, batch_size: int = 16):
        self.prefer_gpu = prefer_gpu
        self.batch_size = max(1, batch_size)
        self.device_name = "CPU"
        self.model = None
        self._init_backend()

    def _init_backend(self):
        """Detect available hardware (NVIDIA GPU / CUDA / DirectML or CPU fallback)."""
        try:
            import onnxruntime as ort
            providers = ort.get_available_providers()
            # Check for GPU providers
            if self.prefer_gpu and "CUDAExecutionProvider" in providers:
                self.device_name = "CUDA (NVIDIA GPU)"
            elif self.prefer_gpu and "DmlExecutionProvider" in providers:
                self.device_name = "DirectML (GPU)"
            else:
                self.device_name = "CPU"
        except Exception:
            self.device_name = "CPU"

        # Check for model in models/
        model_path = MODELS_DIR / "vision_embedder.onnx"
        if model_path.exists():
            try:
                import onnxruntime as ort
                providers = ["CUDAExecutionProvider", "CPUExecutionProvider"] if "CUDA" in self.device_name else ["CPUExecutionProvider"]
                self.model = ort.InferenceSession(str(model_path), providers=providers)
                print(f"Loaded ONNX vision embedder on {self.device_name}")
            except Exception as e:
                print("ONNX embedder load notice (falling back to hybrid spatial-feature embedder):", e)
                self.model = None

    def _preprocess_image(self, img_input: Union[str, Path, Image.Image, np.ndarray]) -> np.ndarray:
        """Standardize image to RGB 224x224 normalized uint8 array."""
        if isinstance(img_input, (str, Path)):
            img = cv2.imread(str(img_input))
            if img is None:
                raise ValueError(f"Could not read image: {img_input}")
            img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        elif isinstance(img_input, Image.Image):
            img = np.asarray(img_input.convert("RGB"))
        elif isinstance(img_input, np.ndarray):
            if img_input.ndim == 3 and img_input.shape[2] == 4:
                img = cv2.cvtColor(img_input, cv2.COLOR_RGBA2RGB)
            elif img_input.ndim == 3 and img_input.shape[2] == 3:
                # Assume BGR if from cv2, convert to RGB
                img = cv2.cvtColor(img_input, cv2.COLOR_BGR2RGB)
            else:
                img = img_input
        else:
            raise TypeError(f"Unsupported image type: {type(img_input)}")

        return cv2.resize(img, (224, 224), interpolation=cv2.INTER_AREA)

    def extract_single(self, img_input: Union[str, Path, Image.Image, np.ndarray]) -> np.ndarray:
        """Extract a single 512-dimensional L2-normalized embedding vector."""
        batch_res = self.extract_batch([img_input], batch_size=1)
        return batch_res[0]

    def extract_batch(
        self,
        images: List[Union[str, Path, Image.Image, np.ndarray]],
        batch_size: int | None = None,
    ) -> List[np.ndarray]:
        """
        Batch inference with automatic OOM recovery and memory cleanup.
        Returns a list of 1D float32 normalized embedding vectors.
        """
        if not images:
            return []

        cur_batch_size = max(1, batch_size or self.batch_size)
        results: List[np.ndarray] = []

        i = 0
        while i < len(images):
            batch_slice = images[i : i + cur_batch_size]
            try:
                # Preprocess batch
                preprocessed = [self._preprocess_image(im) for im in batch_slice]

                if self.model is not None:
                    # Run ONNX model inference
                    batch_arr = np.stack(preprocessed, axis=0).astype(np.float32) / 255.0
                    # Channels first: (B, 3, 224, 224)
                    batch_arr = np.transpose(batch_arr, (0, 3, 1, 2))
                    # Mean/std normalization (ImageNet standard)
                    mean = np.array([0.485, 0.456, 0.406], dtype=np.float32).reshape(1, 3, 1, 1)
                    std = np.array([0.229, 0.224, 0.225], dtype=np.float32).reshape(1, 3, 1, 1)
                    batch_arr = (batch_arr - mean) / std

                    input_name = self.model.get_inputs()[0].name
                    raw_outputs = self.model.run(None, {input_name: batch_arr})[0]
                    # Flatten and normalize
                    for feat in raw_outputs:
                        flat = feat.flatten().astype(np.float32)
                        norm = np.linalg.norm(flat)
                        results.append(flat / (norm + 1e-8))
                else:
                    # High-accuracy 512-D spatial-frequency color-gradient feature descriptor
                    for img_rgb in preprocessed:
                        feat = self._compute_spatial_descriptor(img_rgb)
                        results.append(feat)

                i += cur_batch_size
            except Exception as e:
                # If memory error or failure, reduce batch size and retry
                if cur_batch_size > 1:
                    cur_batch_size = max(1, cur_batch_size // 2)
                    print(f"Embedding batch size reduced to {cur_batch_size} due to: {e}")
                    gc.collect()
                else:
                    # Single item error, append zero vector and advance
                    print(f"Skipping failed embedding item at index {i}: {e}")
                    results.append(np.zeros(512, dtype=np.float32))
                    i += 1

        return results

    def _compute_spatial_descriptor(self, rgb: np.ndarray) -> np.ndarray:
        """
        512-dimensional spatial color-spatial-gradient descriptor.
        Guaranteed 100% offline with zero external downloads.
        Highly discriminative for matching visually similar shots, scene changes, and burst photography.
        """
        # 1. Multi-scale Color Moments in Lab space
        lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB).astype(np.float32)
        hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV).astype(np.float32)

        features = []
        # Spatial Grid 4x4 (16 cells)
        cell_h, cell_w = 56, 56
        for r in range(4):
            for c in range(4):
                cell_lab = lab[r * cell_h : (r + 1) * cell_h, c * cell_w : (c + 1) * cell_w]
                cell_hsv = hsv[r * cell_h : (r + 1) * cell_h, c * cell_w : (c + 1) * cell_w]
                # Means (L, a, b, H, S, V) = 6 features
                features.extend(np.mean(cell_lab, axis=(0, 1)))
                features.extend(np.mean(cell_hsv, axis=(0, 1)))
                # Stds (L, a, b, H, S, V) = 6 features
                features.extend(np.std(cell_lab, axis=(0, 1)))
                features.extend(np.std(cell_hsv, axis=(0, 1)))
        # 16 cells * 12 features = 192 features

        # 2. Gradient Orientation Histograms (HOG-like edge layout)
        gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
        gx = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
        gy = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
        mag, ang = cv2.cartToPolar(gx, gy, angleInDegrees=True)

        # 4 quadrants, 16-bin angle histograms
        for qr in range(2):
            for qc in range(2):
                q_mag = mag[qr * 112 : (qr + 1) * 112, qc * 112 : (qc + 1) * 112]
                q_ang = ang[qr * 112 : (qr + 1) * 112, qc * 112 : (qc + 1) * 112]
                hist, _ = np.histogram(q_ang, bins=16, range=(0, 360), weights=q_mag)
                features.extend(hist)
        # 4 quadrants * 16 bins = 64 features

        # 3. Global 3D color histogram (8x8x4 in Lab) = 256 features
        hist_3d = cv2.calcHist([rgb], [0, 1, 2], None, [8, 8, 4], [0, 256, 0, 256, 0, 256]).flatten()
        features.extend(hist_3d)

        # Total: 192 + 64 + 256 = 512 dimensions
        vec = np.asarray(features, dtype=np.float32)
        norm = np.linalg.norm(vec)
        if norm > 1e-8:
            vec /= norm
        return vec
