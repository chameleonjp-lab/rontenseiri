import { useState, type ReactNode } from "react";

interface LazyDetailsProps {
  summary: ReactNode;
  children: () => ReactNode;
  className?: string;
}

/**
 * Keeps native <details> interaction while deferring its subtree until first
 * open. Once opened, the subtree stays mounted so form drafts survive closes.
 */
export default function LazyDetails({
  summary,
  children,
  className,
}: LazyDetailsProps) {
  const [hasOpened, setHasOpened] = useState(false);

  return (
    <details
      className={className}
      onToggle={(event) => {
        if (event.currentTarget.open) setHasOpened(true);
      }}
    >
      <summary>{summary}</summary>
      {hasOpened ? children() : null}
    </details>
  );
}
