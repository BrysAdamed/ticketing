import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  input,
} from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { highlightCodeBlocks } from './highlight-code';
import { MentionUser } from './mentions';
import { INTERNAL_LINK_ATTR, renderMarkdown } from './render-markdown';

/// Renders markdown safely (see `renderMarkdown`). In-app links navigate with the router. Mention
/// tokens of the users in `mentions` show as chips, others as plain `@Name` text. Fenced code with
/// a known language is highlighted (highlight.js loads lazily, only when there is such a block).
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

  readonly source = input<string | null | undefined>('');
  readonly mentions = input<readonly MentionUser[] | null | undefined>(null);

  protected readonly html = computed(() =>
    this.sanitizer.bypassSecurityTrustHtml(
      renderMarkdown(this.source(), { mentions: this.mentions() }),
    ),
  );

  constructor() {
    afterRenderEffect(() => {
      this.html();
      void highlightCodeBlocks(this.host.nativeElement);
    });
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
