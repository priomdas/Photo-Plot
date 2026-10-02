import React from "react";

const PATHS = {
  brand: "M4 12l4-8 4 4 8-4-4 8-8 4 4-4-4-4z",
  sun: "M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6L7 7m10 10 1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0z",
  moon: "M20 15.5A8 8 0 0 1 8.5 4 8 8 0 1 0 20 15.5z",
  settings: "M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-1.8 1.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5v.2h-2.6v-.2a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1-1.8-1.8.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H6.3v-2.6h.2a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1 1.8-1.8.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.5v-.2H15v.2a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1 1.8 1.8-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.5 1h.2V14h-.2a1.7 1.7 0 0 0-1.5 1z",
  sparkle: "M12 2l1.4 6.6L20 10l-6.6 1.4L12 18l-1.4-6.6L4 10l6.6-1.4L12 2z M19 16l.6 2.4L22 19l-2.4.6L19 22l-.6-2.4L16 19l2.4-.6L19 16z",
  edit: "M4 20h4L19 9l-4-4L4 16v4z M13.5 6.5l4 4",
  upload: "M12 16V4m0 0L7 9m5-5 5 5M4 15v4h16v-4",
  chevron: "M9 18l6-6-6-6",
  folder: "M3 6h7l2 2h9v10H3V6z",
  layers: "M12 3l9 5-9 5-9-5 9-5z M3 12l9 5 9-5 M3 16l9 5 9-5",
  clock: "M12 7v5l3 2 M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z",
};

export function Icon({ name, size = 16, strokeWidth = 1.8, className = "" }) {
  return (
    <svg
      className={`icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name] || PATHS.sparkle} />
    </svg>
  );
}
