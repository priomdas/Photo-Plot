import { useCallback, useRef, useState } from "react";

// Small toast queue. Each toast auto-dismisses; callers get push helpers.
export function useToasts() {
  const [toasts, setToasts] = useState([]);
  const counter = useRef(0);

  const dismiss = useCallback((id) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (message, tone = "info", ttl = 4000) => {
      const id = ++counter.current;
      setToasts((list) => [...list, { id, message, tone }]);
      if (ttl) setTimeout(() => dismiss(id), ttl);
      return id;
    },
    [dismiss]
  );

  return {
    toasts,
    dismiss,
    show: (m, tone = "info", ttl) => push(m, tone, ttl),
    info: (m, ttl) => push(m, "info", ttl),
    success: (m, ttl) => push(m, "success", ttl),
    error: (m, ttl) => push(m, "error", ttl ?? 6000),
  };
}
