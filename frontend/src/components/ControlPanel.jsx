import React, { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";

function Slider({ label, value, min, max, step, onChange, format }) {
  const pct = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
  return (
    <label className="field">
      <span className="field__label">
        {label}
        <span className="field__value">{format ? format(value) : value}</span>
      </span>
      <input
        className="slider"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ "--pct": `${pct}%` }}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

function NumberField({ label, value, onChange, min, step = 1 }) {
  return (
    <label className="field field--inline">
      <span className="field__label">{label}</span>
      <input
        className="input"
        type="number"
        min={min}
        step={step}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
      />
    </label>
  );
}

function Section({ title, children, defaultOpen = true, className = "" }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`section ${className}`}>
      <button className="section__head" onClick={() => setOpen((o) => !o)}>
        <span>{title}</span>
        <span className={`section__chevron ${open ? "section__chevron--open" : ""}`}>›</span>
      </button>
      {open && <div className="section__body">{children}</div>}
    </section>
  );
}

const LOGO_ACCEPT = ".png,.jpg,.jpeg,.webp,.heic,.heif,image/png,image/jpeg,image/webp,image/heic,image/heif";
const PRESET_ACCEPT = ".dng,.xmp,.json,image/x-adobe-dng";

export function getPresetTheme(name = "") {
  const n = (name || "").toLowerCase().trim();
  if (n === "default") {
    return {
      gradient: "linear-gradient(135deg, #1e293b 0%, #0f172a 100%)",
      badge: "RAW",
      category: "Original",
      desc: "Neutral camera raw baseline with balanced natural tone",
    };
  }
  if (n.includes("teal") || n.includes("cinematic")) {
    return {
      gradient: "linear-gradient(135deg, #0d9488 0%, #0284c7 40%, #f59e0b 100%)",
      badge: "FILM",
      category: "Cinematic",
      desc: "Hollywood teal shadows with warm amber skin highlights",
    };
  }
  if (n.includes("vibrant") || n.includes("landscape")) {
    return {
      gradient: "linear-gradient(135deg, #0284c7 0%, #10b981 50%, #eab308 100%)",
      badge: "VIVID",
      category: "Nature",
      desc: "Punchy contrast, sky recovery and rich nature vibrance",
    };
  }
  if (n.includes("soft") || n.includes("portrait")) {
    return {
      gradient: "linear-gradient(135deg, #f43f5e 0%, #ec4899 40%, #fed7aa 100%)",
      badge: "GLOW",
      category: "Portrait",
      desc: "Flattering skin tones, gentle contrast and soft glow",
    };
  }
  if (n.includes("fine art") || n.includes("b&w") || n.includes("bw")) {
    return {
      gradient: "linear-gradient(135deg, #09090b 0%, #3f3f46 50%, #f4f4f5 100%)",
      badge: "B&W",
      category: "Monochrome",
      desc: "Fine art monochrome with deep velvety blacks and silver highlights",
    };
  }
  if (n.includes("golden") || n.includes("sunset")) {
    return {
      gradient: "linear-gradient(135deg, #dc2626 0%, #ea580c 50%, #facc15 100%)",
      badge: "WARM",
      category: "Sunset",
      desc: "Radiant golden hour warmth and warm evening twilight",
    };
  }
  if (n.includes("vintage") || n.includes("film") || n.includes("35mm")) {
    return {
      gradient: "linear-gradient(135deg, #78350f 0%, #b45309 50%, #fde68a 100%)",
      badge: "35MM",
      category: "Vintage",
      desc: "Authentic analog Kodak/Fuji film aesthetic with vintage grain",
    };
  }
  if (n.includes("moody") || n.includes("urban") || n.includes("dark")) {
    return {
      gradient: "linear-gradient(135deg, #020617 0%, #1e293b 50%, #06b6d4 100%)",
      badge: "DARK",
      category: "Urban",
      desc: "Moody street style with crushed deep shadows and cool tones",
    };
  }
  if (n.includes("clean") || n.includes("commercial") || n.includes("studio")) {
    return {
      gradient: "linear-gradient(135deg, #334155 0%, #64748b 50%, #f8fafc 100%)",
      badge: "PRO",
      category: "Studio",
      desc: "Clean commercial studio look with crisp clarity and pure whites",
    };
  }
  const hash = (name || "").split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return {
    gradient: `linear-gradient(135deg, hsl(${hash % 360}, 65%, 45%), hsl(${(hash + 50) % 360}, 75%, 55%))`,
    badge: "LUT",
    category: "Custom",
    desc: "Custom color grading preset",
  };
}

export function ControlPanel({
  preset,
  onUpdate,
  onAdjust,
  onApplyToAll,
  logo,
  onLogo,
  presets,
  onLoadPreset,
  onSavePreset,
  onDeletePreset,
  onImportPreset,
  canUndo = false,
  canRedo = false,
  onUndo,
  onRedo,
}) {
  const [presetName, setPresetName] = useState(preset.name || "default");
  const [activeTab, setActiveTab] = useState("presets"); // presets | edit | export
  const [showPresetModal, setShowPresetModal] = useState(false);
  const [presetCategory, setPresetCategory] = useState("All");
  const [presetSearch, setPresetSearch] = useState("");
  const presetInputRef = useRef(null);
  const adj = preset.adjustments || {};

  useEffect(() => {
    if (preset.name) {
      setPresetName(preset.name);
    }
  }, [preset.name]);

  // Clean deduplicated preset list with Default always at position 0
  const allPresets = [
    { name: "default", adjustments: {} },
    ...presets.filter((p) => (p.name || "").toLowerCase() !== "default"),
  ];

  const isCurrentPreset = (p) => (preset.name || "").toLowerCase() === (p.name || "").toLowerCase();

  const currentLogoPct = Math.round((preset.logo_width_ratio ?? 0.2) * 100);

  const resetAdjGroup = (keys) => {
    const next = { ...adj };
    keys.forEach((k) => {
      next[k] = k === "sharpness" ? 25 : 0;
    });
    onUpdate("adjustments", next);
  };

  const resetAllAdjustments = () => {
    onUpdate("adjustments", {
      exposure: 0,
      contrast: 0,
      highlights: 0,
      shadows: 0,
      whites: 0,
      blacks: 0,
      temperature: 0,
      tint: 0,
      vibrance: 0,
      saturation: 0,
      clarity: 0,
      dehaze: 0,
      vignette: 0,
      grain: 0,
      sharpness: 25,
    });
  };

  const applyGroup = (keys) => onApplyToAll?.(keys);

  return (
    <div className="panel">
      {/* Tabbed Header */}
      <div className="panel__tabs">
        {[
          { id: "presets", icon: "brand", label: "Presets" },
          { id: "edit", icon: "edit", label: "Edit" },
          { id: "export", icon: "download", label: "Export" },
        ].map((tab) => (
          <button
            key={tab.id}
            className={`panel__tab ${activeTab === tab.id ? "panel__tab--active" : ""}`}
            onClick={() => setActiveTab(tab.id)}
          >
            <Icon name={tab.icon} size={14} />
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* ===== PRESETS TAB ===== */}
      {activeTab === "presets" && (
        <div className="panel__content">
          {/* Preset Visual Cards */}
          <Section title="Presets & Filters" defaultOpen={true} className="section--presets">
            <div className="panel__see-all">
              <span className="panel__section-title">Presets & Filters ({allPresets.length})</span>
              <button
                type="button"
                className="link"
                onClick={() => setShowPresetModal(true)}
                title="Browse full preset library"
              >
                See all ({allPresets.length})
              </button>
            </div>

            {/* Responsive 3-column Multi-Row Preset Grid */}
            <div className="preset-visual-grid">
              {allPresets.map((p) => {
                const theme = getPresetTheme(p.name);
                const active = isCurrentPreset(p);
                const displayName = p.name === "default" ? "Default" : p.name;
                return (
                  <div
                    key={p.name}
                    className={`preset-visual-card ${active ? "preset-visual-card--active" : ""}`}
                    onClick={() => onLoadPreset(p)}
                    title={`${displayName} (${theme.category}): ${theme.desc}`}
                  >
                    <div className="preset-visual-card__thumb" style={{ background: theme.gradient }}>
                      <span className="preset-visual-card__badge">{theme.badge}</span>
                      {active && <div className="preset-visual-card__check">✓</div>}
                    </div>
                    <span className="preset-card-title">{displayName}</span>
                  </div>
                );
              })}
            </div>

            {/* Upload DNG preset button */}
            <input
              ref={presetInputRef}
              type="file"
              accept={PRESET_ACCEPT}
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  onImportPreset(file);
                  e.target.value = "";
                }
              }}
            />
            <button
              className="btn btn--ghost btn--sm"
              style={{ width: "100%", justifyContent: "center", marginTop: "6px" }}
              onClick={() => presetInputRef.current?.click()}
            >
              <Icon name="upload" size={14} /> Import preset (DNG/XMP/JSON)
            </button>

            <div className="field-row" style={{ marginTop: "6px" }}>
              <input
                className="input"
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                placeholder="Save as preset name"
              />
              <button
                className="btn btn--ghost btn--sm"
                onClick={() => onSavePreset({ ...preset, name: presetName })}
                title="Save current develop settings"
              >
                Save
              </button>
            </div>
            {presets.some((p) => p.name === presetName) && presetName !== "default" && (
              <button className="link link--danger" onClick={() => onDeletePreset(presetName)}>
                Delete "{presetName}"
              </button>
            )}
          </Section>

          {/* AI Enhancements */}
          <div className="panel__ai-section">
            <span className="panel__section-title">AI Enhancements</span>

            {/* Auto Quality Boost */}
            <div className={`ai-toggle-row ${preset.auto_enhance ? "ai-toggle-row--active" : ""}`}>
              <div className="ai-toggle-row__icon">
                <Icon name="sparkle" size={16} />
              </div>
              <div className="ai-toggle-row__info">
                <span className="ai-toggle-row__title">Auto Quality Boost</span>
                <span className="ai-toggle-row__sub">Micro-contrast, texture recovery, smart sharpening</span>
              </div>
              <label className="toggle-switch" title="Toggle Auto Quality Boost">
                <input
                  type="checkbox"
                  checked={Boolean(preset.auto_enhance)}
                  onChange={(e) => onUpdate("auto_enhance", e.target.checked)}
                />
                <span className="toggle-switch__slider" />
              </label>
            </div>
            {Boolean(preset.auto_enhance) && (
              <div style={{ padding: "0 14px 8px" }}>
                <Slider
                  label="Boost strength"
                  value={preset.enhance_strength ?? 70}
                  min={20}
                  max={100}
                  step={5}
                  onChange={(v) => onUpdate("enhance_strength", v)}
                  format={(v) => `${v}%`}
                />
              </div>
            )}

            {/* Remove Noise */}
            <div className={`ai-toggle-row ${preset.remove_noise ? "ai-toggle-row--active" : ""}`}>
              <div className="ai-toggle-row__icon">
                <Icon name="sparkle" size={16} />
              </div>
              <div className="ai-toggle-row__info">
                <span className="ai-toggle-row__title">Remove Noise</span>
                <span className="ai-toggle-row__sub">Edge-preserving bilateral smoothing</span>
              </div>
              <label className="toggle-switch" title="Toggle Noise Reduction">
                <input
                  type="checkbox"
                  checked={Boolean(preset.remove_noise)}
                  onChange={(e) => onUpdate("remove_noise", e.target.checked)}
                />
                <span className="toggle-switch__slider" />
              </label>
            </div>
            {Boolean(preset.remove_noise) && (
              <div style={{ padding: "0 14px 8px" }}>
                <Slider
                  label="Denoise strength"
                  value={preset.denoise_strength ?? 50}
                  min={10}
                  max={100}
                  step={5}
                  onChange={(v) => onUpdate("denoise_strength", v)}
                  format={(v) => `${v}%`}
                />
              </div>
            )}

            {/* Auto Color Fix */}
            <div className={`ai-toggle-row ${preset.auto_color_fix ? "ai-toggle-row--active" : ""}`}>
              <div className="ai-toggle-row__icon">
                <Icon name="sparkle" size={16} />
              </div>
              <div className="ai-toggle-row__info">
                <span className="ai-toggle-row__title">Auto Color Fix</span>
                <span className="ai-toggle-row__sub">AI chromatic gray-world color balance</span>
              </div>
              <label className="toggle-switch" title="Toggle Auto Color Fix">
                <input
                  type="checkbox"
                  checked={Boolean(preset.auto_color_fix)}
                  onChange={(e) => onUpdate("auto_color_fix", e.target.checked)}
                />
                <span className="toggle-switch__slider" />
              </label>
            </div>
          </div>

          {/* Logo / Watermark Section */}
          <Section title="Logo / Watermark" defaultOpen={true} className="section--logo">
            <label className="uploader">
              <input type="file" accept={LOGO_ACCEPT} hidden onChange={(e) => onLogo(e.target.files?.[0] || null)} />
              <span>{logo ? logo.name : "Choose logo image"}</span>
            </label>
            {logo && (
              <>
                <div>
                  <Slider
                    label="Logo size"
                    value={currentLogoPct}
                    min={2}
                    max={85}
                    step={1}
                    onChange={(v) => onUpdate("logo_width_ratio", v / 100)}
                    format={(v) => `${v}%`}
                  />
                  <div className="size-chips">
                    {[10, 20, 35, 50].map((sz) => (
                      <button
                        key={sz}
                        type="button"
                        className={`size-chip ${currentLogoPct === sz ? "size-chip--active" : ""}`}
                        onClick={() => onUpdate("logo_width_ratio", sz / 100)}
                      >
                        {sz}%
                      </button>
                    ))}
                  </div>
                </div>

                <Slider
                  label="Opacity"
                  value={preset.logo_opacity ?? 100}
                  min={0}
                  max={100}
                  step={1}
                  onChange={(v) => onUpdate("logo_opacity", v)}
                  format={(v) => `${v}%`}
                />

                <label className="field">
                  <span className="field__label">Anchor</span>
                  <select
                    className="input"
                    value={preset.anchor || "bottom-right"}
                    onChange={(e) => {
                      onUpdate("anchor", e.target.value);
                      onUpdate("logo_position_x", null);
                      onUpdate("logo_position_y", null);
                    }}
                  >
                    <option value="bottom-right">Bottom right</option>
                    <option value="bottom-left">Bottom left</option>
                    <option value="top-right">Top right</option>
                    <option value="top-left">Top left</option>
                    <option value="center">Center</option>
                  </select>
                </label>

                {(preset.logo_position_x != null || preset.logo_position_y != null) && (
                  <button
                    className="btn btn--ghost btn--sm"
                    onClick={() => {
                      onUpdate("logo_position_x", null);
                      onUpdate("logo_position_y", null);
                    }}
                  >
                    Reset to anchor position
                  </button>
                )}
              </>
            )}
          </Section>
        </div>
      )}

      {/* ===== EDIT TAB ===== */}
      {activeTab === "edit" && (
        <div className="panel__content">
          {/* Undo / Redo Toolbar */}
          <div className="panel__edit-toolbar">
            <div className="history-bar">
              <button className="btn btn--ghost btn--sm" onClick={onUndo} disabled={!canUndo} title="Undo (Ctrl+Z)">
                <span>↺</span> Undo
              </button>
              <button className="btn btn--ghost btn--sm" onClick={onRedo} disabled={!canRedo} title="Redo (Ctrl+Y or Ctrl+Shift+Z)">
                <span>↻</span> Redo
              </button>
              <button
                className="link"
                style={{ marginLeft: "auto", fontSize: "0.75rem" }}
                onClick={resetAllAdjustments}
                title="Reset all sliders to zero"
              >
                Reset all
              </button>
            </div>
          </div>

          {/* Light Panel */}
          <Section title="Light" defaultOpen={true} className="section--light">
            <Slider label="Exposure" value={adj.exposure ?? 0} min={-100} max={100} step={1} onChange={(v) => onAdjust("exposure", v)} format={(v) => `${v > 0 ? "+" : ""}${(v / 50).toFixed(2)} EV`} />
            <Slider label="Contrast" value={adj.contrast ?? 0} min={-100} max={100} step={1} onChange={(v) => onAdjust("contrast", v)} format={(v) => `${v > 0 ? "+" : ""}${v}`} />
            <Slider label="Highlights" value={adj.highlights ?? 0} min={-100} max={100} step={1} onChange={(v) => onAdjust("highlights", v)} format={(v) => `${v > 0 ? "+" : ""}${v}`} />
            <Slider label="Shadows" value={adj.shadows ?? 0} min={-100} max={100} step={1} onChange={(v) => onAdjust("shadows", v)} format={(v) => `${v > 0 ? "+" : ""}${v}`} />
            <Slider label="Whites" value={adj.whites ?? 0} min={-100} max={100} step={1} onChange={(v) => onAdjust("whites", v)} format={(v) => `${v > 0 ? "+" : ""}${v}`} />
            <Slider label="Blacks" value={adj.blacks ?? 0} min={-100} max={100} step={1} onChange={(v) => onAdjust("blacks", v)} format={(v) => `${v > 0 ? "+" : ""}${v}`} />
            <div className="section__actions">
              <button className="btn btn--ghost btn--xs" onClick={() => applyGroup(["exposure", "contrast", "highlights", "shadows", "whites", "blacks"])}>Apply to all</button>
              <button className="link" onClick={() => resetAdjGroup(["exposure", "contrast", "highlights", "shadows", "whites", "blacks"])}>Reset Light</button>
            </div>
          </Section>

          {/* Color Panel */}
          <Section title="Color" defaultOpen={true} className="section--color">
            <Slider label="Temp" value={adj.temperature ?? 0} min={-100} max={100} step={1} onChange={(v) => onAdjust("temperature", v)} format={(v) => (v < 0 ? `Cool ${v}` : v > 0 ? `Warm +${v}` : "0")} />
            <Slider label="Tint" value={adj.tint ?? 0} min={-100} max={100} step={1} onChange={(v) => onAdjust("tint", v)} format={(v) => (v < 0 ? `Green ${v}` : v > 0 ? `Magenta +${v}` : "0")} />
            <Slider label="Vibrance" value={adj.vibrance ?? 0} min={-100} max={100} step={1} onChange={(v) => onAdjust("vibrance", v)} format={(v) => `${v > 0 ? "+" : ""}${v}`} />
            <Slider label="Saturation" value={adj.saturation ?? 0} min={-100} max={100} step={1} onChange={(v) => onAdjust("saturation", v)} format={(v) => `${v > 0 ? "+" : ""}${v}`} />
            <div className="section__actions">
              <button className="btn btn--ghost btn--xs" onClick={() => applyGroup(["temperature", "tint", "vibrance", "saturation"])}>Apply to all</button>
              <button className="link" onClick={() => resetAdjGroup(["temperature", "tint", "vibrance", "saturation"])}>Reset Color</button>
            </div>
          </Section>

          {/* Effects / Presence */}
          <Section title="Effects" defaultOpen={false} className="section--effects">
            <Slider label="Clarity" value={adj.clarity ?? 0} min={-100} max={100} step={1} onChange={(v) => onAdjust("clarity", v)} format={(v) => `${v > 0 ? "+" : ""}${v}`} />
            <Slider label="Dehaze" value={adj.dehaze ?? 0} min={-100} max={100} step={1} onChange={(v) => onAdjust("dehaze", v)} format={(v) => `${v > 0 ? "+" : ""}${v}`} />
            <Slider label="Vignette" value={adj.vignette ?? 0} min={-100} max={100} step={1} onChange={(v) => onAdjust("vignette", v)} format={(v) => `${v > 0 ? "+" : ""}${v}`} />
            <Slider label="Grain" value={adj.grain ?? 0} min={0} max={100} step={1} onChange={(v) => onAdjust("grain", v)} format={(v) => `${v}`} />
            <div className="section__actions">
              <button className="btn btn--ghost btn--xs" onClick={() => applyGroup(["clarity", "dehaze", "vignette", "grain"])}>Apply to all</button>
              <button className="link" onClick={() => resetAdjGroup(["clarity", "dehaze", "vignette", "grain"])}>Reset Effects</button>
            </div>
          </Section>

          {/* Detail / Sharpness */}
          <Section title="Detail" defaultOpen={false} className="section--detail">
            <Slider label="Sharpness" value={adj.sharpness ?? 25} min={0} max={150} step={1} onChange={(v) => onAdjust("sharpness", v)} format={(v) => `${v}`} />
            <div className="section__actions">
              <button className="btn btn--ghost btn--xs" onClick={() => applyGroup(["sharpness"])}>Apply to all</button>
              <button className="link" onClick={() => resetAdjGroup(["sharpness"])}>Reset Detail</button>
            </div>
          </Section>
        </div>
      )}

      {/* ===== EXPORT TAB ===== */}
      {activeTab === "export" && (
        <div className="panel__content">
          <div className="panel__export-section">
            <span className="panel__section-title">Export Settings</span>

            <label className="field">
              <span className="field__label">Format</span>
              <select className="input" value={preset.format} onChange={(e) => onUpdate("format", e.target.value)}>
                <option>JPEG</option>
                <option>PNG</option>
                <option>WEBP</option>
              </select>
            </label>

            {preset.format !== "PNG" && (
              <div className="export-quality-row">
                <span className="field__label">
                  Quality
                  <span className="field__value">{preset.quality ?? 90}</span>
                </span>
                <Slider
                  label=""
                  value={preset.quality ?? 90}
                  min={10}
                  max={100}
                  step={1}
                  onChange={(v) => onUpdate("quality", v)}
                />
              </div>
            )}

            <div className="field-row">
              <NumberField label="Max width" value={preset.max_width} min={0} onChange={(v) => onUpdate("max_width", v)} />
              <NumberField label="Max height" value={preset.max_height} min={0} onChange={(v) => onUpdate("max_height", v)} />
            </div>
          </div>
        </div>
      )}

      {/* Preset Library Browser Modal */}
      {showPresetModal && (
        <div
          className="preset-modal-backdrop"
          onClick={() => setShowPresetModal(false)}
        >
          <div
            className="preset-modal"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="preset-modal__head">
              <div className="preset-modal__title-group">
                <Icon name="brand" size={18} />
                <h2>Preset Library</h2>
                <span className="preset-modal__badge">{allPresets.length} Presets</span>
              </div>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setShowPresetModal(false)}
                title="Close preset library"
                style={{ fontSize: "18px", width: "32px", height: "32px" }}
              >
                ✕
              </button>
            </div>

            {/* Controls: Search & Category Filter */}
            <div className="preset-modal__controls">
              <div className="preset-modal__search">
                <span className="preset-modal__search-icon">🔍</span>
                <input
                  type="text"
                  placeholder="Search presets by name or style…"
                  value={presetSearch}
                  onChange={(e) => setPresetSearch(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="preset-modal__cats">
                {["All", "Cinematic", "Nature", "Portrait", "Monochrome", "Sunset", "Vintage", "Urban", "Studio"].map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    className={`preset-modal__cat-btn ${presetCategory === cat ? "preset-modal__cat-btn--active" : ""}`}
                    onClick={() => setPresetCategory(cat)}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            {/* Grid of Preset Cards */}
            <div className="preset-modal__grid">
              {allPresets
                .filter((p) => {
                  const theme = getPresetTheme(p.name);
                  const matchesCat =
                    presetCategory === "All" ||
                    theme.category.toLowerCase() === presetCategory.toLowerCase();
                  const matchesSearch =
                    !presetSearch.trim() ||
                    p.name.toLowerCase().includes(presetSearch.toLowerCase()) ||
                    theme.desc.toLowerCase().includes(presetSearch.toLowerCase()) ||
                    theme.category.toLowerCase().includes(presetSearch.toLowerCase());
                  return matchesCat && matchesSearch;
                })
                .map((p) => {
                  const theme = getPresetTheme(p.name);
                  const active = isCurrentPreset(p);
                  const displayName = p.name === "default" ? "Default" : p.name;
                  return (
                    <div
                      key={p.name}
                      className={`preset-modal-card ${active ? "preset-modal-card--active" : ""}`}
                      onClick={() => onLoadPreset(p)}
                    >
                      <div
                        className="preset-modal-card__thumb"
                        style={{ background: theme.gradient }}
                      >
                        <span className="preset-visual-card__badge">{theme.badge}</span>
                        {active && (
                          <div
                            style={{
                              background: "var(--accent)",
                              color: "#fff",
                              borderRadius: "999px",
                              padding: "2px 8px",
                              fontSize: "0.68rem",
                              fontWeight: 700,
                              display: "flex",
                              alignItems: "center",
                              gap: "4px",
                            }}
                          >
                            ✓ Active
                          </div>
                        )}
                      </div>
                      <div className="preset-modal-card__body">
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span className="preset-modal-card__name">{displayName}</span>
                          <span style={{ fontSize: "0.68rem", color: "var(--accent)", fontWeight: 600 }}>
                            {theme.category}
                          </span>
                        </div>
                        <p className="preset-modal-card__meta">{theme.desc}</p>
                        <button
                          type="button"
                          className="preset-modal-card__btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            onLoadPreset(p);
                            setShowPresetModal(false);
                          }}
                        >
                          {active ? "Applied" : "Apply Preset"}
                        </button>
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
