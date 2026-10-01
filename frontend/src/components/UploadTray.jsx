import React, { useEffect, useRef, useState } from "react";

const ACCEPT =
  ".jpg,.jpeg,.png,.webp,.heic,.heif,.dng,image/jpeg,image/png,image/webp,image/heic,image/heif,image/x-adobe-dng";

// Renders a small live thumbnail for a File, cleaning up its object URL.
function Thumb({ file, active, index, onSelect, onRemove }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);
  const isImage = /\.(jpe?g|png|webp)$/i.test(file.name);
  return (
    <div className={`thumb ${active ? "thumb--active" : ""}`} onClick={() => onSelect(index)} title={file.name}>
      {isImage ? <img src={url} alt={file.name} loading="lazy" /> : <div className="thumb__raw">RAW</div>}
      <button
        className="thumb__remove"
        onClick={(e) => {
          e.stopPropagation();
          onRemove(index);
        }}
        aria-label={`Remove ${file.name}`}
      >
        ×
      </button>
      <span className="thumb__name">{file.name}</span>
    </div>
  );
}

export function UploadTray({ files, selected, onFiles, onSelect, onRemove }) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef(null);

  const addFiles = (list) => {
    const incoming = [...list].filter((f) => f && f.name);
    if (incoming.length) onFiles(incoming);
  };

  return (
    <div className="tray">
      <div
        className={`dropzone ${dragOver ? "dropzone--over" : ""}`}
        onClick={() => inputRef.current?.click()}
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
        <div className="dropzone__icon">⬆</div>
        <p className="dropzone__title">Drop photos here</p>
        <p className="dropzone__hint">or click to browse · JPG, PNG, WebP, HEIC, RAW/DNG</p>
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
      </div>

      {files.length > 0 && (
        <>
          <div className="tray__meta">
            <span>{files.length} photo{files.length > 1 ? "s" : ""}</span>
          </div>
          <div className="thumb-grid">
            {files.map((file, i) => (
              <Thumb
                key={`${file.name}-${i}`}
                file={file}
                index={i}
                active={i === selected}
                onSelect={onSelect}
                onRemove={onRemove}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
