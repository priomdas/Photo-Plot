from __future__ import annotations

import math
from pathlib import Path
from typing import Any

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
MODELS_DIR = ROOT / "models"


class FaceQualityAnalyzer:
    """
    Analyzes detected faces in images:
    - Face counts & size proportions
    - Face-specific sharpness (critical for portrait photography)
    - Face exposure
    - Eye openness / blink detection
    """

    def __init__(self, use_gpu: bool = True):
        self.use_gpu = use_gpu
        self.face_cascade = None
        self.eye_cascade = None
        self._init_detectors()

    def _init_detectors(self):
        try:
            # OpenCV built-in frontal face & eye Haar cascades
            cascade_path = cv2.data.haarcascades
            face_xml = cascade_path + "haarcascade_frontalface_default.xml"
            eye_xml = cascade_path + "haarcascade_eye.xml"

            if Path(face_xml).exists():
                self.face_cascade = cv2.CascadeClassifier(face_xml)
            if Path(eye_xml).exists():
                self.eye_cascade = cv2.CascadeClassifier(eye_xml)
        except Exception as e:
            print("Face detector cascade initialization warning:", e)

    def analyze(self, bgr: np.ndarray) -> dict[str, Any] | None:
        """
        Analyze faces in image.
        Returns a dict of face metrics if faces are found, or None if no faces exist.
        """
        if self.face_cascade is None:
            return None

        h, w = bgr.shape[:2]
        # Downsample for fast detection if photo is huge
        max_dim = 1600
        scale = 1.0
        if max(h, w) > max_dim:
            scale = max_dim / max(h, w)
            proc_bgr = cv2.resize(bgr, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
        else:
            proc_bgr = bgr

        gray = cv2.cvtColor(proc_bgr, cv2.COLOR_BGR2GRAY)
        gray = cv2.equalizeHist(gray)

        # Detect multi-scale faces
        faces = self.face_cascade.detectMultiScale(
            gray,
            scaleFactor=1.15,
            minNeighbors=5,
            minSize=(int(30 * scale), int(30 * scale)),
            flags=cv2.CASCADE_SCALE_IMAGE,
        )

        if len(faces) == 0:
            return None

        face_count = len(faces)
        total_pixels = h * w
        face_sharpnesses = []
        face_exposures = []
        eyes_open_count = 0
        total_eyes_detected = 0

        for (fx, fy, fw, fh) in faces:
            # Rescale to original coordinates
            orig_x = int(fx / scale)
            orig_y = int(fy / scale)
            orig_w = int(fw / scale)
            orig_h = int(fh / scale)

            orig_x = max(0, min(w - 1, orig_x))
            orig_y = max(0, min(h - 1, orig_y))
            orig_w = max(1, min(w - orig_x, orig_w))
            orig_h = max(1, min(h - orig_y, orig_h))

            face_patch_bgr = bgr[orig_y : orig_y + orig_h, orig_x : orig_x + orig_w]
            if face_patch_bgr.size == 0:
                continue

            face_patch_gray = cv2.cvtColor(face_patch_bgr, cv2.COLOR_BGR2GRAY)

            # 1. Face sharpness (Laplacian variance inside face crop)
            f_var = cv2.Laplacian(face_patch_gray, cv2.CV_64F).var()
            f_sharp = 100.0 / (1.0 + math.exp(-0.005 * (f_var - 150.0)))
            face_sharpnesses.append(f_sharp)

            # 2. Face exposure (mean luminance of face)
            f_luma = float(np.mean(face_patch_gray))
            # Ideal face luminance ~ 125-155
            f_exp = 100.0 - (abs(f_luma - 140.0) / 140.0) * 50.0
            face_exposures.append(max(0.0, min(100.0, f_exp)))

            # 3. Eye detection for blink detection
            if self.eye_cascade is not None:
                # Upper half of face usually contains the eyes
                eye_region = face_patch_gray[: int(face_patch_gray.shape[0] * 0.6), :]
                eyes = self.eye_cascade.detectMultiScale(
                    eye_region,
                    scaleFactor=1.1,
                    minNeighbors=4,
                    minSize=(int(face_patch_gray.shape[1] * 0.12), int(face_patch_gray.shape[0] * 0.12)),
                )
                eyes_detected = len(eyes)
                total_eyes_detected += eyes_detected
                if eyes_detected >= 1:
                    eyes_open_count += 1

        if not face_sharpnesses:
            return None

        avg_face_sharpness = float(np.mean(face_sharpnesses))
        avg_face_exposure = float(np.mean(face_exposures))

        # Blink penalty / score
        eyes_score = 100.0
        if face_count <= 4 and self.eye_cascade is not None:
            # If no eyes detected in clear faces, slight penalty
            if eyes_open_count < face_count and avg_face_sharpness > 60.0:
                eyes_score = max(50.0, (eyes_open_count / max(1, face_count)) * 100.0)

        # Composite face quality score (0-100)
        composite_face_score = (
            avg_face_sharpness * 0.50 +
            avg_face_exposure * 0.30 +
            eyes_score * 0.20
        )

        return {
            "face_count": face_count,
            "face_sharpness": round(avg_face_sharpness, 1),
            "face_exposure": round(avg_face_exposure, 1),
            "eyes_open_score": round(eyes_score, 1),
            "face_score": round(max(0.0, min(100.0, composite_face_score)), 1),
        }
