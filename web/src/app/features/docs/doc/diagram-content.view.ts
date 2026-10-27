import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { provideIcons } from '@ng-icons/core';
import { Doc } from '@core/docs/doc.models';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { docIcon, DOCS_ICONS } from '../docs-icons';

/// A diagram's content (`docs.diagram`): its title and, for Mermaid, the source as text. The
/// rendered Mermaid view and the Canvas editor replace it (TKT-17, TKT-18).
@Component({
  selector: 'tk-doc-diagram-content',
  imports: [IconComponent],
  viewProviders: [provideIcons(DOCS_ICONS)],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-testid': 'view-docs.diagram' },
  template: `
    <article class="pbody">
      <h1 class="ptitle" data-testid="doc-title">{{ doc().title }}</h1>
      <div class="figure">
        <div class="fig-h">
          <tk-icon [name]="icon()" [size]="16" />
          {{ label() }}
        </div>
        @if (doc().diagramFormat === 'Mermaid' && doc().content) {
          <pre class="source" data-testid="doc-diagram-source">{{ doc().content }}</pre>
        } @else {
          <p class="empty">
            {{ doc().content ? 'The canvas view is not available yet.' : 'This diagram is empty.' }}
          </p>
        }
      </div>
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
      margin: 0 0 24px;
      font-size: var(--tk-text-2xl);
      line-height: var(--tk-leading-2xl);
      font-weight: var(--tk-weight-semibold);
      letter-spacing: var(--tk-tracking-tight);
      overflow-wrap: anywhere;
    }
    .figure {
      border: 1px solid var(--tk-border);
      border-radius: var(--tk-radius-lg);
      overflow: hidden;
      background: var(--tk-surface);
    }
    .fig-h {
      height: 36px;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 0 12px;
      border-bottom: 1px solid var(--tk-border-subtle);
      color: var(--tk-text-muted);
      font-size: var(--tk-text-sm);
    }
    .source {
      margin: 0;
      padding: 12px 16px;
      overflow: auto;
      background: var(--tk-bg-subtle);
      font-family: var(--tk-font-mono);
      font-size: var(--tk-text-sm);
    }
    .empty {
      margin: 0;
      padding: 24px 16px;
      color: var(--tk-text-muted);
    }
  `,
})
export class DiagramContentView {
  readonly doc = input.required<Doc>();

  protected readonly icon = computed(() => docIcon('Diagram', this.doc().diagramFormat));
  protected readonly label = computed(() =>
    this.doc().diagramFormat === 'Canvas' ? 'Canvas diagram' : 'Mermaid diagram',
  );
}
