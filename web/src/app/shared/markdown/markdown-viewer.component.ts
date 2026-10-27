import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  input,
} from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { DIAGRAM_THEME } from '../diagrams/diagram-theme.token';
import { renderMermaidBlocks } from '../diagrams/mermaid/mermaid-blocks';
import { highlightCodeBlocks } from './highlight-code';
import { MentionUser } from './mentions';
import { INTERNAL_LINK_ATTR, renderMarkdown } from './render-markdown';

/// Renders markdown safely (see `renderMarkdown`). In-app links navigate with the router. Mention
/// tokens of the users in `mentions` show as chips, others as plain `@Name` text. Fenced code with
/// a known language is highlighted (highlight.js loads lazily, only when there is such a block);
/// ```` ```mermaid ```` blocks render as diagrams when they scroll into view (Mermaid loads lazily)
/// and re-render in the new theme.
@Component({
  selector: 'tk-markdown',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'tk-md', '[innerHTML]': 'html()', '(click)': 'onClick($event)' },
  template: '',
})
export class MarkdownViewerComponent {
  private readonly sanitizer = inject(DomSanitizer);
  private readonly router = inject(Router);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly theme = inject(DIAGRAM_THEME);
  private diagrams: AbortController | null = null;

  readonly source = input<string | null | undefined>('');
  readonly mentions = input<readonly MentionUser[] | null | undefined>(null);

  /// Re-created on a theme change when there is a Mermaid block, so the blocks render again.
  protected readonly html = computed(() => {
    const source = this.source();
    if (source?.includes('mermaid')) this.theme();
    return this.sanitizer.bypassSecurityTrustHtml(
      renderMarkdown(source, { mentions: this.mentions() }),
    );
  });

  constructor() {
    afterRenderEffect(() => {
      this.html();
      const host = this.host.nativeElement;
      void highlightCodeBlocks(host);
      this.diagrams?.abort();
      this.diagrams = new AbortController();
      void renderMermaidBlocks(host, this.theme(), { signal: this.diagrams.signal });
    });
    inject(DestroyRef).onDestroy(() => this.diagrams?.abort());
  }

  protected onClick(event: MouseEvent): void {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)
      return;
    const anchor = (event.target as Element | null)?.closest?.(`a[${INTERNAL_LINK_ATTR}]`);
    const href = anchor?.getAttribute('href');
    if (!href) return;
    event.preventDefault();
    void this.router.navigateByUrl(href);
  }
}
