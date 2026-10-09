import type { ReactNode } from 'react';

// Longer text folds away behind a [+] so pages stay short; nothing inside is removed.
export function More({ children }: { children: ReactNode }) {
  return (
    <details className="more">
      <summary aria-label="More" />
      {children}
    </details>
  );
}
