"""
Caption & Hashtag generation — abstraction layer.

Architecture:
  CaptionProvider (abstract)
    └─ LocalCaptionProvider    — runs a lightweight VLM locally (default)
    └─ RuleCaptionProvider     — simple rule-based fallback (no AI, always works)

The system defaults to RuleCaptionProvider for instant, offline-first operation.
LocalCaptionProvider can be enabled when a local VLM model is downloaded.
"""
from __future__ import annotations

import abc
import logging
import re
from pathlib import Path
from typing import Any

logger = logging.getLogger("photopilot.social.caption")


class CaptionResult:
    """Result of caption generation."""
    def __init__(self, caption: str = "", hashtags: list[str] | None = None,
                 confidence: float = 1.0, model_name: str = ""):
        self.caption = caption
        self.hashtags = hashtags or []
        self.confidence = confidence
        self.model_name = model_name

    def to_dict(self) -> dict[str, Any]:
        return {
            "caption": self.caption,
            "hashtags": self.hashtags,
            "confidence": self.confidence,
            "model_name": self.model_name,
        }


class CaptionProvider(abc.ABC):
    """Abstract caption/hashtag generation provider."""

    @abc.abstractmethod
    def generate_caption(self, image_path: str, style: str = "professional",
                         context: str = "") -> CaptionResult:
        ...

    @abc.abstractmethod
    def generate_hashtags(self, caption: str = "", image_path: str = "",
                          category: str = "photography", count: int = 15) -> list[str]:
        ...

    @abc.abstractmethod
    def is_available(self) -> bool:
        ...

    @abc.abstractmethod
    def provider_name(self) -> str:
        ...


# ─────────────────────────────────────────────
# Rule-based provider (always available, offline)
# ─────────────────────────────────────────────

# Curated hashtag pools by category
_HASHTAG_POOLS: dict[str, list[str]] = {
    "photography": [
        "#photography", "#photooftheday", "#photo", "#photographer",
        "#naturephotography", "#photographylovers", "#picoftheday",
        "#streetphotography", "#travelphotography", "#landscape",
        "#portrait", "#canon", "#nikon", "#sony", "#shotoniphone",
        "#goldenhour", "#sunset", "#sunrise", "#explore", "#beautiful",
        "#art", "#creative", "#composition", "#visualart", "#instaphoto",
        "#photoshoot", "#moments", "#capture", "#lens", "#focus",
    ],
    "nature": [
        "#nature", "#naturephotography", "#wildlife", "#outdoors",
        "#landscape", "#mountains", "#forest", "#river", "#ocean",
        "#flowers", "#trees", "#sky", "#clouds", "#sunset", "#sunrise",
        "#earth", "#environment", "#green", "#natural", "#adventure",
    ],
    "portrait": [
        "#portrait", "#portraitphotography", "#headshot", "#model",
        "#face", "#beauty", "#studio", "#lighting", "#posing",
        "#expression", "#eyes", "#closeup", "#candid", "#lifestyle",
        "#editorial", "#fashion", "#mood", "#emotion", "#dramatic",
    ],
    "wedding": [
        "#wedding", "#weddingphotography", "#bride", "#groom",
        "#weddingday", "#love", "#marriage", "#couple", "#weddingdress",
        "#weddingphotographer", "#engagement", "#ceremony", "#reception",
        "#bridal", "#forever", "#celebration", "#romance", "#vows",
    ],
    "food": [
        "#food", "#foodphotography", "#foodie", "#yummy", "#delicious",
        "#cooking", "#recipe", "#homemade", "#restaurant", "#chef",
        "#instafood", "#foodstagram", "#tasty", "#healthy", "#organic",
    ],
    "travel": [
        "#travel", "#travelphotography", "#wanderlust", "#explore",
        "#adventure", "#vacation", "#trip", "#destination", "#tourism",
        "#travelgram", "#instatravel", "#traveling", "#backpacking",
        "#roadtrip", "#journey", "#discovery", "#culture", "#world",
    ],
    "product": [
        "#product", "#productphotography", "#ecommerce", "#branding",
        "#marketing", "#business", "#design", "#minimal", "#flatlay",
        "#commercial", "#advertising", "#studio", "#lifestyle",
        "#packaging", "#brand", "#shop", "#store", "#quality",
    ],
    "event": [
        "#event", "#eventphotography", "#party", "#celebration",
        "#concert", "#festival", "#corporate", "#conference",
        "#birthday", "#livemusic", "#performance", "#show",
        "#entertainment", "#nightlife", "#gathering", "#social",
    ],
}

# Caption templates by style
_CAPTION_TEMPLATES: dict[str, list[str]] = {
    "professional": [
        "Captured in the perfect light.",
        "Every frame tells a story.",
        "Where vision meets precision.",
        "The art of seeing what others overlook.",
        "Moments preserved in time.",
    ],
    "casual": [
        "Just another beautiful day! ✨",
        "Life through my lens 📸",
        "Can't stop, won't stop shooting 🎯",
        "This light though... 🌅",
        "Vibes ✌️",
    ],
    "storytelling": [
        "Behind every photograph lies a story waiting to be told...",
        "Some moments are too beautiful to let pass unnoticed.",
        "In the silence between seconds, beauty speaks volumes.",
        "A single frame can hold a thousand emotions.",
        "The world pauses, if only for a shutter's breath.",
    ],
    "minimal": [
        "·",
        "—",
        "◈",
        "▪",
        "●",
    ],
    "engaging": [
        "What story do you see in this frame? 👇",
        "Rate this shot 1-10! Let me know below ⬇️",
        "Double tap if this caught your eye! ❤️",
        "Which edit style do you prefer? Comment below!",
        "Tag someone who'd love this view 🏷️",
    ],
}


class RuleCaptionProvider(CaptionProvider):
    """
    Simple rule-based caption & hashtag generator.
    Always available, works completely offline.
    Uses curated templates and hashtag pools.
    """

    def generate_caption(self, image_path: str, style: str = "professional",
                         context: str = "") -> CaptionResult:
        import hashlib
        # Use the image filename + style to deterministically pick a template
        seed = hashlib.md5(f"{image_path}{style}".encode()).hexdigest()
        templates = _CAPTION_TEMPLATES.get(style, _CAPTION_TEMPLATES["professional"])
        idx = int(seed[:8], 16) % len(templates)
        caption = templates[idx]

        if context:
            caption = f"{context}\n\n{caption}"

        return CaptionResult(
            caption=caption,
            hashtags=[],
            confidence=0.5,
            model_name="rule-based",
        )

    def generate_hashtags(self, caption: str = "", image_path: str = "",
                          category: str = "photography", count: int = 15) -> list[str]:
        import hashlib
        pool = _HASHTAG_POOLS.get(category, _HASHTAG_POOLS["photography"])
        # Always include the base category tag + deterministic selection
        seed = hashlib.md5(f"{caption}{image_path}{category}".encode()).hexdigest()
        seed_int = int(seed[:8], 16)

        # Shuffle deterministically using seed
        indexed = list(enumerate(pool))
        indexed.sort(key=lambda x: (seed_int + x[0] * 2654435761) % len(pool))
        selected = [tag for _, tag in indexed[:count]]
        return selected

    def is_available(self) -> bool:
        return True

    def provider_name(self) -> str:
        return "Rule-Based (Offline)"


# ─────────────────────────────────────────────
# Local VLM provider (optional, requires model)
# ─────────────────────────────────────────────

class LocalCaptionProvider(CaptionProvider):
    """
    Uses a local Vision Language Model for caption generation.
    Requires downloading the model first. Falls back to rules if unavailable.
    """

    def __init__(self, model_path: str = ""):
        self._model_path = model_path or str(Path(__file__).resolve().parents[2] / "models" / "caption_model")
        self._model = None
        self._processor = None
        self._device = "cpu"

    def _load_model(self) -> bool:
        if self._model is not None:
            return True
        try:
            from transformers import AutoModelForCausalLM, AutoProcessor  # type: ignore
            import torch  # type: ignore

            model_id = self._model_path
            if not Path(model_id).exists():
                model_id = "vikhyatk/moondream2"

            self._device = "cuda" if torch.cuda.is_available() else "cpu"
            self._processor = AutoProcessor.from_pretrained(model_id, trust_remote_code=True)
            self._model = AutoModelForCausalLM.from_pretrained(
                model_id, trust_remote_code=True,
                torch_dtype=torch.float16 if self._device == "cuda" else torch.float32,
            ).to(self._device)
            logger.info("Loaded caption model: %s on %s", model_id, self._device)
            return True
        except Exception as exc:
            logger.warning("Could not load local VLM: %s", exc)
            return False

    def generate_caption(self, image_path: str, style: str = "professional",
                         context: str = "") -> CaptionResult:
        if not self._load_model():
            return RuleCaptionProvider().generate_caption(image_path, style, context)

        try:
            from PIL import Image  # type: ignore
            img = Image.open(image_path).convert("RGB")

            prompt_map = {
                "professional": "Describe this photograph professionally for a social media post. Be concise and elegant.",
                "casual": "Write a fun, casual Instagram caption for this photo. Keep it short and add an emoji.",
                "storytelling": "Write a poetic, storytelling caption for this photo. Make it evocative.",
                "minimal": "Write a very short, minimal caption for this photo. One line only.",
                "engaging": "Write an engaging social media caption for this photo that encourages comments.",
            }
            prompt = prompt_map.get(style, prompt_map["professional"])
            if context:
                prompt += f" Context: {context}"

            enc_image = self._processor(img, return_tensors="pt").to(self._device)
            caption_text = self._model.generate(
                **enc_image,
                max_new_tokens=120,
                do_sample=True,
                temperature=0.7,
            )
            caption = self._processor.decode(caption_text[0], skip_special_tokens=True)

            return CaptionResult(
                caption=caption.strip(),
                hashtags=[],
                confidence=0.85,
                model_name="moondream2-local",
            )
        except Exception as exc:
            logger.warning("VLM generation failed, falling back: %s", exc)
            return RuleCaptionProvider().generate_caption(image_path, style, context)

    def generate_hashtags(self, caption: str = "", image_path: str = "",
                          category: str = "photography", count: int = 15) -> list[str]:
        # For hashtags, rule-based is actually more reliable than VLM
        return RuleCaptionProvider().generate_hashtags(caption, image_path, category, count)

    def is_available(self) -> bool:
        try:
            import transformers  # type: ignore  # noqa: F401
            return True
        except ImportError:
            return False

    def provider_name(self) -> str:
        return "Local VLM (Moondream2)" if self.is_available() else "Local VLM (Not Installed)"


# ─────────────────────────────────────────────
# Provider Factory
# ─────────────────────────────────────────────

_active_provider: CaptionProvider | None = None


def get_caption_provider(prefer_local_vlm: bool = False) -> CaptionProvider:
    """Get the active caption provider. Defaults to rule-based unless VLM is requested."""
    global _active_provider
    if prefer_local_vlm:
        provider = LocalCaptionProvider()
        if provider.is_available():
            _active_provider = provider
            return provider
    if _active_provider is None:
        _active_provider = RuleCaptionProvider()
    return _active_provider


def list_providers() -> list[dict[str, Any]]:
    """List all available providers and their status."""
    rule = RuleCaptionProvider()
    local = LocalCaptionProvider()
    return [
        {
            "id": "rule-based",
            "name": rule.provider_name(),
            "available": rule.is_available(),
            "description": "Template-based captions and curated hashtag pools. Always available offline.",
        },
        {
            "id": "local-vlm",
            "name": local.provider_name(),
            "available": local.is_available(),
            "description": "AI-powered captions using a local vision-language model. Requires ~2GB download.",
        },
    ]
