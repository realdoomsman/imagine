"use client";

import { useState } from "react";

/** Copies `value` and says so for a moment. */
export function CopyButton({
  value,
  label = "Copy",
  className = "",
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1400);
        });
      }}
      className={`btn btn-ghost btn-sm ${className}`}
    >
      {copied ? "Copied" : label}
    </button>
  );
}
