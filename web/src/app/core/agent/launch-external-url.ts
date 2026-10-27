import { DOCUMENT } from '@angular/common';
import { inject, Injectable } from '@angular/core';

/// Opens an app URL such as `claude-cli://…` by a top-level navigation from a temporary anchor
/// (ADR 0013): the page stays, a hidden iframe would be blocked by our CSP and `window.open` would
/// leave an empty tab. Call it synchronously in the click handler, before any `await`, so the
/// browser still sees the user gesture. E2E tests stub the anchor click to capture the URL.
@Injectable({ providedIn: 'root' })
export class ExternalUrlLauncher {
  private readonly document = inject(DOCUMENT);

  launch(url: string): void {
    const anchor = this.document.createElement('a');
    anchor.href = url;
    anchor.rel = 'noopener noreferrer';
    anchor.style.display = 'none';
    this.document.body.appendChild(anchor);
    try {
      anchor.click();
    } finally {
      anchor.remove();
    }
  }
}
