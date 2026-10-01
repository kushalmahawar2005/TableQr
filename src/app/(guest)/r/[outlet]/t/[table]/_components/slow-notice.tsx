"use client";

import { WifiOff01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useState } from "react";

/** Appears only if the table is still loading after 4 seconds (UI spec 8.3) */
export function SlowNotice({ text, afterMs = 4000 }: { text: string; afterMs?: number }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShow(true), afterMs);
    return () => clearTimeout(t);
  }, [afterMs]);

  return (
    <p role="status" className="min-h-5 text-center text-caption text-muted">
      {show && (
        <span className="inline-flex animate-fade items-center gap-1.5">
          <HugeiconsIcon icon={WifiOff01Icon} size={16} aria-hidden />
          {text}
        </span>
      )}
    </p>
  );
}
