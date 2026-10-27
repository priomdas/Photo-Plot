import React, { useRef, useState } from "react";
import { Icon } from "./Icon";

const ACCEPT =
  ".jpg,.jpeg,.png,.webp,.heic,.heif,.dng,image/jpeg,image/png,image/webp,image/heic,image/heif,image/x-adobe-dng";

export function UploadTray({ files, selected, onFiles, onSelect, onRemove }) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef(null);
  const folderInputRef = useRef(null);

  const addFiles = (list) => {
    const incoming = [...list].filter((f) => f && f.name);
    if (incoming.length) onFiles(incoming);
  };

  return (
    <div className="drop-hero">
      <div
        className={`drop-hero__zone ${dragOver ? "drop-hero__zone--over" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          addFiles(e.dataTransfer.files);
        }}
      >
        <div className="drop-hero__illustration">
          <svg width="90" height="74" viewBox="0 0 100 84" fill="none">
            {/* Back photo card */}
            <g transform="rotate(-8 35 45)">
              <rect x="15" y="12" width="54" height="44" rx="6" fill="#cbd5e1" stroke="#94a3b8" strokeWidth="1.5" />
              <rect x="18" y="15" width="48" height="38" rx="4" fill="#93c5fd" />
              <circle cx="27" cy="24" r="4.5" fill="#fde047" />
              <path d="M18 45L29 34L39 43L46 37L66 53H18V45Z" fill="#3b82f6" />
            </g>
            {/* Front photo card */}
            <g transform="rotate(7 55 45)">
              <rect x="34" y="16" width="56" height="46" rx="6" fill="#f8fafc" stroke="#e2e8f0" strokeWidth="2" style={{ filter: "drop-shadow(0 8px 16px rgba(0,0,0,0.4))" }} />
              <rect x="38" y="20" width="48" height="38" rx="4" fill="#60a5fa" />
              <circle cx="74" cy="30" r="5" fill="#fbbf24" />
              <path d="M38 52L52 38L65 49L72 43L86 58H38V52Z" fill="#1d4ed8" />
            </g>
          </svg>
        </div>
        <h2 className="drop-hero__title">Drop photos here</h2>
        <p className="drop-hero__hint">or click to browse · JPG, PNG, WebP, HEIC, RAW/DNG</p>
        <div className="drop-hero__buttons">
          <button className="btn btn--primary drop-hero__btn" onClick={() => inputRef.current?.click()}>
            <Icon name="upload" size={16} /> Browse Photos
          </button>
          <button className="btn btn--ghost drop-hero__btn" onClick={() => folderInputRef.current?.click()}>
            <Icon name="folder" size={16} /> Open Folder
          </button>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          hidden
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <input
          ref={folderInputRef}
          type="file"
          accept={ACCEPT}
          multiple
          hidden
          webkitdirectory=""
          directory=""
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
    </div>
  );
}
