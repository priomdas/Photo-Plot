"""Placeholder interface for future local object/face detection."""

from typing import Protocol

from PIL.Image import Image


class ImageDetector(Protocol):
    def detect(self, image: Image) -> list[dict[str, object]]:
        """Return detected regions once an offline model is added."""
