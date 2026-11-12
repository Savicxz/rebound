import React from "react";

/** Indeterminate activity only. The visible label belongs to the surrounding status. */
export default function ActivityIndicator({
  className = "",
}: {
  className?: string;
}) {
  return (
    <span aria-hidden="true" className={`activity-ring ${className}`}>
      <svg viewBox="0 0 24 24" fill="none">
        <circle
          cx="12"
          cy="12"
          r="9"
          stroke="currentColor"
          strokeWidth="1.5"
          opacity=".2"
        />
        <path
          d="M12 3a9 9 0 0 1 9 9"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}
