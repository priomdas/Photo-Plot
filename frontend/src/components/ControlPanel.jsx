import React, { useEffect, useRef, useState } from "react";

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

function Section({ title, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="section">
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

export function ControlPanel({
  preset,
  onUpdate,
  onAdjust,
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
  const presetInputRef = useRef(null);
  const adj = preset.adjustments || {};

  useEffect(() => {
    if (preset.name) {
      setPresetName(preset.name);
    }
  }, [preset.name]);

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

  return (
    <div className="panel">
      {/* Undo / Redo Toolbar */}
      <div style={{ padding: "12px 16px 0 16px" }}>
        <div className="history-bar">
          <button
            className="btn btn--ghost btn--sm"
            onClick={onUndo}
            disabled={!canUndo}
            title="Undo (Ctrl+Z)"
          >
            <span>↺</span> Undo
          </button>
          <button
            className="btn btn--ghost btn--sm"
            onClick={onRedo}
            disabled={!canRedo}
            title="Redo (Ctrl+Y or Ctrl+Shift+Z)"
          >
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

      {/* Presets (with DNG / XMP / JSON import) */}
      <Section title="Presets (Lightroom DNG / XMP)" defaultOpen={true}>
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
          className="btn btn--primary btn--sm"
          style={{ width: "100%", justifyContent: "center" }}
          onClick={() => presetInputRef.current?.click()}
        >
          📂 Upload Preset (.DNG / .XMP / .JSON)
        </button>

        {presets.length > 0 && (
          <div className="preset-chips" style={{ marginTop: "6px" }}>
            {presets.map((p) => {
              const isActive = preset.name === p.name;
              return (
                <button
                  key={p.name}
                  type="button"
                  className={`preset-chip ${isActive ? "preset-chip--active" : ""}`}
                  onClick={() => onLoadPreset(p)}
                  title={`Apply ${p.name}`}
                >
                  {isActive && "✓ "}
                  {p.name}
                </button>
              );
            })}
          </div>
        )}

        <div className="field-row">
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

      {/* Auto Quality Boost Feature */}
      <div className={`card-feature-toggle ${preset.auto_enhance ? "card-feature-toggle--active" : ""}`}>
        <div className="card-feature-toggle__head">
          <div className="card-feature-toggle__info">
            <div className="card-feature-toggle__title">
              <span>✨</span> Auto Quality Boost
            </div>
            <div className="card-feature-toggle__sub">
              Micro-contrast, texture recovery & smart sharpening
            </div>
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
          <div style={{ marginTop: "12px", paddingTop: "8px", borderTop: "1px solid var(--border)" }}>
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
      </div>

      {/* Light Panel */}
      <Section title="Light" defaultOpen={true}>
        <Slider
          label="Exposure"
          value={adj.exposure ?? 0}
          min={-100}
          max={100}
          step={1}
          onChange={(v) => onAdjust("exposure", v)}
          format={(v) => `${v > 0 ? "+" : ""}${(v / 50).toFixed(2)} EV`}
        />
        <Slider
          label="Contrast"
          value={adj.contrast ?? 0}
          min={-100}
          max={100}
          step={1}
          onChange={(v) => onAdjust("contrast", v)}
          format={(v) => `${v > 0 ? "+" : ""}${v}`}
        />
        <Slider
          label="Highlights"
          value={adj.highlights ?? 0}
          min={-100}
          max={100}
          step={1}
          onChange={(v) => onAdjust("highlights", v)}
          format={(v) => `${v > 0 ? "+" : ""}${v}`}
        />
        <Slider
          label="Shadows"
          value={adj.shadows ?? 0}
          min={-100}
          max={100}
          step={1}
          onChange={(v) => onAdjust("shadows", v)}
          format={(v) => `${v > 0 ? "+" : ""}${v}`}
        />
        <Slider
          label="Whites"
          value={adj.whites ?? 0}
          min={-100}
          max={100}
          step={1}
          onChange={(v) => onAdjust("whites", v)}
          format={(v) => `${v > 0 ? "+" : ""}${v}`}
        />
        <Slider
          label="Blacks"
          value={adj.blacks ?? 0}
          min={-100}
          max={100}
          step={1}
          onChange={(v) => onAdjust("blacks", v)}
          format={(v) => `${v > 0 ? "+" : ""}${v}`}
        />
        <button
          className="link"
          style={{ alignSelf: "flex-start" }}
          onClick={() => resetAdjGroup(["exposure", "contrast", "highlights", "shadows", "whites", "blacks"])}
        >
          Reset Light
        </button>
      </Section>

      {/* Color Panel */}
      <Section title="Color" defaultOpen={true}>
        <Slider
          label="Temp"
          value={adj.temperature ?? 0}
          min={-100}
          max={100}
          step={1}
          onChange={(v) => onAdjust("temperature", v)}
          format={(v) => (v < 0 ? `Cool ${v}` : v > 0 ? `Warm +${v}` : "0")}
        />
        <Slider
          label="Tint"
          value={adj.tint ?? 0}
          min={-100}
          max={100}
          step={1}
          onChange={(v) => onAdjust("tint", v)}
          format={(v) => (v < 0 ? `Green ${v}` : v > 0 ? `Magenta +${v}` : "0")}
        />
        <Slider
          label="Vibrance"
          value={adj.vibrance ?? 0}
          min={-100}
          max={100}
          step={1}
          onChange={(v) => onAdjust("vibrance", v)}
          format={(v) => `${v > 0 ? "+" : ""}${v}`}
        />
        <Slider
          label="Saturation"
          value={adj.saturation ?? 0}
          min={-100}
          max={100}
          step={1}
          onChange={(v) => onAdjust("saturation", v)}
          format={(v) => `${v > 0 ? "+" : ""}${v}`}
        />
        <button
          className="link"
          style={{ alignSelf: "flex-start" }}
          onClick={() => resetAdjGroup(["temperature", "tint", "vibrance", "saturation"])}
        >
          Reset Color
        </button>
      </Section>

      {/* Effects / Presence */}
      <Section title="Effects" defaultOpen={false}>
        <Slider
          label="Clarity"
          value={adj.clarity ?? 0}
          min={-100}
          max={100}
          step={1}
          onChange={(v) => onAdjust("clarity", v)}
          format={(v) => `${v > 0 ? "+" : ""}${v}`}
        />
        <Slider
          label="Dehaze"
          value={adj.dehaze ?? 0}
          min={-100}
          max={100}
          step={1}
          onChange={(v) => onAdjust("dehaze", v)}
          format={(v) => `${v > 0 ? "+" : ""}${v}`}
        />
        <Slider
          label="Vignette"
          value={adj.vignette ?? 0}
          min={-100}
          max={100}
          step={1}
          onChange={(v) => onAdjust("vignette", v)}
          format={(v) => `${v > 0 ? "+" : ""}${v}`}
        />
        <Slider
          label="Grain"
          value={adj.grain ?? 0}
          min={0}
          max={100}
          step={1}
          onChange={(v) => onAdjust("grain", v)}
          format={(v) => `${v}`}
        />
        <button
          className="link"
          style={{ alignSelf: "flex-start" }}
          onClick={() => resetAdjGroup(["clarity", "dehaze", "vignette", "grain"])}
        >
          Reset Effects
        </button>
      </Section>

      {/* Detail / Sharpness */}
      <Section title="Detail" defaultOpen={false}>
        <Slider
          label="Sharpness"
          value={adj.sharpness ?? 25}
          min={0}
          max={150}
          step={1}
          onChange={(v) => onAdjust("sharpness", v)}
          format={(v) => `${v}`}
        />
        <button
          className="link"
          style={{ alignSelf: "flex-start" }}
          onClick={() => resetAdjGroup(["sharpness"])}
        >
          Reset Detail
        </button>
      </Section>

      {/* Logo / Watermark Section */}
      <Section title="Logo / Watermark" defaultOpen={false}>
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

      {/* Output Section */}
      <Section title="Output format & size" defaultOpen={false}>
        <label className="field">
          <span className="field__label">Format</span>
          <select className="input" value={preset.format} onChange={(e) => onUpdate("format", e.target.value)}>
            <option>JPEG</option>
            <option>PNG</option>
            <option>WEBP</option>
          </select>
        </label>
        {preset.format !== "PNG" && (
          <Slider
            label="Quality"
            value={preset.quality ?? 90}
            min={10}
            max={100}
            step={1}
            onChange={(v) => onUpdate("quality", v)}
            format={(v) => `${v}`}
          />
        )}
        <div className="field-row">
          <NumberField label="Max width" value={preset.max_width} min={0} onChange={(v) => onUpdate("max_width", v)} />
          <NumberField label="Max height" value={preset.max_height} min={0} onChange={(v) => onUpdate("max_height", v)} />
        </div>
      </Section>
    </div>
  );
}
