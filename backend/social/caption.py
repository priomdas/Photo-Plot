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
import json
import logging
import re
from pathlib import Path
from typing import Any

import httpx

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


CONFIG_PATH = Path(__file__).resolve().parents[2] / "logs" / "caption_ai.json"


def _caption_config() -> dict[str, str]:
    if CONFIG_PATH.exists():
        try:
            config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
            # Gemini 2.0 Flash has been retired; migrate the old app default.
            if config.get("model") == "gemini-2.0-flash":
                config["model"] = "gemini-2.5-flash"
            return config
        except (OSError, ValueError):
            logger.warning("Could not read caption AI configuration")
    return {"provider": "rule-based", "api_key": "", "model": "gemini-2.5-flash", "base_url": "https://generativelanguage.googleapis.com/v1beta"}


def get_caption_config(mask_key: bool = True) -> dict[str, str]:
    config = _caption_config()
    if mask_key and config.get("api_key"):
        config["api_key"] = f"{config['api_key'][:4]}••••{config['api_key'][-4:]}"
    return config


def save_caption_config(config: dict[str, str]) -> dict[str, str]:
    current = _caption_config()
    for key in ("provider", "model", "base_url"):
        if key in config:
            current[key] = str(config[key]).strip()
    if config.get("api_key") and "••••" not in config["api_key"]:
        current["api_key"] = config["api_key"].strip()
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    CONFIG_PATH.write_text(json.dumps(current, indent=2), encoding="utf-8")
    return get_caption_config()


class OnlineCaptionProvider(CaptionProvider):
    """Text-only online generation using Gemini or an OpenAI-compatible API."""

    def __init__(self, config: dict[str, str] | None = None):
        self.config = config or _caption_config()

    def generate_caption(self, image_path: str, style: str = "professional",
                         context: str = "") -> CaptionResult:
        if not self.is_available():
            raise RuntimeError("Online caption provider is not configured")
        prompt = (
            f"Write one polished social media caption in a {style} style. "
            "Return only the caption and do not invent visual details. "
            f"User description: {context or 'Create a versatile photography caption.'}"
        )
        provider = self.config["provider"]
        try:
            if provider == "gemini":
                base = self.config.get("base_url", "https://generativelanguage.googleapis.com/v1beta").rstrip("/")
                response = httpx.post(
                    f"{base}/models/{self.config['model']}:generateContent",
                    params={"key": self.config["api_key"]},
                    json={"contents": [{"parts": [{"text": prompt}]}]},
                    timeout=45,
                )
                data = response.json()
                response.raise_for_status()
                text = data["candidates"][0]["content"]["parts"][0]["text"]
            else:
                base = self.config.get("base_url", "https://api.openai.com/v1").rstrip("/")
                response = httpx.post(
                    f"{base}/chat/completions",
                    headers={"Authorization": f"Bearer {self.config['api_key']}"},
                    json={"model": self.config["model"], "messages": [{"role": "user", "content": prompt}], "temperature": 0.8},
                    timeout=45,
                )
                data = response.json()
                response.raise_for_status()
                text = data["choices"][0]["message"]["content"]
            return CaptionResult(text.strip(), [], 0.9, f"{provider}:{self.config['model']}")
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code == 404 and provider == "gemini":
                raise RuntimeError(
                    f"Gemini model '{self.config['model']}' was not found. "
                    "Use a currently available model such as gemini-2.5-flash."
                ) from exc
            raise RuntimeError(f"Online caption request failed: {exc}") from exc
        except (httpx.HTTPError, KeyError, IndexError, TypeError) as exc:
            raise RuntimeError(f"Online caption request failed: {exc}") from exc

    def generate_hashtags(self, caption: str = "", image_path: str = "",
                          category: str = "photography", count: int = 15) -> list[str]:
        return RuleCaptionProvider().generate_hashtags(caption, image_path, category, count)

    def is_available(self) -> bool:
        return self.config.get("provider") in {"gemini", "openai-compatible"} and bool(self.config.get("api_key") and self.config.get("model"))

    def provider_name(self) -> str:
        return f"Online ({self.config.get('provider', 'not configured')})"


def test_caption_config(config: dict[str, str]) -> dict[str, Any]:
    merged = {**_caption_config(), **config}
    if "••••" in merged.get("api_key", ""):
        merged["api_key"] = _caption_config().get("api_key", "")
    result = OnlineCaptionProvider(merged).generate_caption("", "professional", "Write a short test caption about photography.")
    return {"ok": True, "model_name": result.model_name}


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
    configured = OnlineCaptionProvider()
    if configured.is_available():
        return configured
    if _active_provider is None:
        _active_provider = RuleCaptionProvider()
    return _active_provider


def list_providers() -> list[dict[str, Any]]:
    """List all available providers and their status."""
    rule = RuleCaptionProvider()
    local = LocalCaptionProvider()
    online = OnlineCaptionProvider()
    return [
        {
            "id": "rule-based",
            "name": rule.provider_name(),
            "available": rule.is_available(),
            "description": "Template-based captions and curated hashtag pools. Always available offline.",
        },
        {
            "id": "online",
            "name": online.provider_name(),
            "available": online.is_available(),
            "description": "Text-only online captions using Gemini or an OpenAI-compatible endpoint.",
        },
        {
            "id": "local-vlm",
            "name": local.provider_name(),
            "available": local.is_available(),
            "description": "AI-powered captions using a local vision-language model. Requires ~2GB download.",
        },
    ]
