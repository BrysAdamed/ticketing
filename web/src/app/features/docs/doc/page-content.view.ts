import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { Doc } from '@core/docs/doc.models';
import { AbsoluteTimePipe } from '@shared/pipes/relative-time.pipe';
import { MarkdownViewerComponent } from '@shared/markdown/markdown-viewer.component';

/// A page's content (`docs.page`): title, meta line and the rendered markdown of the latest
/// version. The full reader (outline rail, anchors) and the editor replace it (TKT-14).
@Component({
  selector: 'tk-doc-page-content',
  imports: [MarkdownViewerComponent, AbsoluteTimePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-testid': 'view-docs.page' },
  template: `
    <article class="pbody">
      <h1 class="ptitle" data-testid="doc-title">{{ doc().title }}</h1>
      <div class="pmeta">
        <span>{{ doc().createdBy.displayName }}</span>
        <span class="dot">·</span>
        <span>Updated {{ doc().updatedAt | absoluteTime }}</span>
      </div>
      @if (doc().content) {
        <tk-markdown class="prose" [source]="doc().content" />
      } @else {
        <p class="empty" data-testid="doc-page-empty">This page is empty.</p>
      }
    </article>
  `,
  styles: `
    :host {
      display: block;
    }
    .pbody {
      max-width: 808px;
      margin: 0 auto;
      padding: 32px 48px 64px;
    }
    .ptitle {
      margin: 0 0 8px;
      font-size: var(--tk-text-2xl);
      line-height: var(--tk-leading-2xl);
      font-weight: var(--tk-weight-semibold);
      letter-spacing: var(--tk-tracking-tight);
      overflow-wrap: anywhere;
    }
    .pmeta {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 24px;
      color: var(--tk-text-muted);
      font-size: var(--tk-text-sm);
    }
    .dot {
      color: var(--tk-text-disabled);
    }
    .prose {
      display: block;
      max-width: 72ch;
    }
    .empty {
      color: var(--tk-text-muted);
    }
  `,
})
export class PageContentView {
  readonly doc = input.required<Doc>();
}
