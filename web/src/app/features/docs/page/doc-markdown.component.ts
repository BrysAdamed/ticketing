import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  output,
  untracked,
} from '@angular/core';
import { Router } from '@angular/router';
import { DOC_MARKDOWN_ENHANCERS, DocMarkdownContext } from '@core/docs/doc-extensions';
import { DocEmbed, DocReferences } from '@core/docs/doc.models';
import { ToastService } from '@core/notify/toast.service';
import { ThemeService } from '@core/theme/theme.service';
import { codeLanguage, highlightCodeBlocks } from '@shared/markdown/highlight-code';
import { MentionUser } from '@shared/markdown/mentions';
import { INTERNAL_LINK_ATTR, renderMarkdown } from '@shared/markdown/render-markdown';

/// Performance entry measured for every render (markdown to DOM), read by the e2e budget check.
export const DOC_RENDER_MEASURE = 'tk-doc-markdown';

/// The rendered markdown of a doc (reader and editor preview): heading anchors, callouts, code
/// blocks with a language header, Copy and syntax highlighting, then every registered
/// `DocMarkdownEnhancer` (Mermaid, embeds, …). It re-renders when the source or the theme
/// changes and emits `rendered` with its host once the DOM is in place.
@Component({
  selector: 'tk-doc-markdown',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'tk-md tk-doc-prose', '(click)': 'onClick($event)' },
  template: '',
})
export class DocMarkdownComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly theme = inject(ThemeService).theme;
  private readonly enhancers = [...inject(DOC_MARKDOWN_ENHANCERS)].sort(
    (a, b) => a.order - b.order,
  );
  private controller: AbortController | null = null;

  readonly source = input<string | null>('');
  readonly mode = input<DocMarkdownContext['mode']>('view');
  readonly docKey = input<string | null>(null);
  /// What the reader may see of the keys the source names (the doc's references); null renders
  /// every key as a plain link.
  readonly references = input<DocReferences | null>(null);
  readonly embeds = input<readonly DocEmbed[]>([]);
  /// Users the source mentions that the reader may see; their tokens render as chips, others as text.
  readonly mentions = input<readonly MentionUser[] | null | undefined>(null);

  private readonly links = computed(
    () => ({ references: this.references(), embeds: this.embeds(), mentions: this.mentions() }),
    { equal: (a, b) => JSON.stringify(a) === JSON.stringify(b) },
  );

  readonly rendered = output<HTMLElement>();

  constructor() {
    effect(() => {
      const source = this.source();
      const theme = this.theme();
      this.links();
      untracked(() => this.render(source, theme));
    });
    inject(DestroyRef).onDestroy(() => this.controller?.abort());
  }

  private render(source: string | null, theme: 'light' | 'dark'): void {
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    const started = performance.now();
    const { references, embeds, mentions } = this.links();
    const mode = this.mode();
    this.host.innerHTML = renderMarkdown(source, {
      headingAnchors: true,
      mentions,
      references: references && {
        tickets: references.tickets,
        docs: references.docs,
        embeds,
        unresolved: mode === 'preview' ? 'link' : 'text',
      },
    });
    decorateCodeBlocks(this.host);
    performance.measure(DOC_RENDER_MEASURE, { start: started });
    this.rendered.emit(this.host);
    const context: DocMarkdownContext = {
      mode,
      theme,
      docKey: this.docKey(),
      embeds,
      signal: controller.signal,
    };
    void highlightCodeBlocks(this.host);
    void this.enhance(context);
  }

  private async enhance(context: DocMarkdownContext): Promise<void> {
    for (const enhancer of this.enhancers) {
      if (context.signal.aborted) return;
      try {
        await enhancer.enhance(this.host, context);
      } catch (error) {
        console.error(`Doc markdown enhancer ${enhancer.id} failed`, error);
      }
    }
  }

  protected onClick(event: MouseEvent): void {
    const target = event.target as Element | null;
    const copy = target?.closest?.('.tk-code-copy');
    if (copy) {
      const code = copy.closest('.tk-code')?.querySelector('pre code')?.textContent ?? '';
      void navigator.clipboard
        .writeText(code)
        .then(() => this.toast.success('Code copied'))
        .catch(() => this.toast.error("Couldn't copy the code"));
      return;
    }
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)
      return;
    const anchor = target?.closest?.('a[href]');
    const href = anchor?.getAttribute('href');
    if (!anchor || !href) return;
    if (href.startsWith('#')) {
      event.preventDefault();
      this.goToHeading(href.slice(1), anchor.classList.contains('tk-anchor'));
    } else if (anchor.hasAttribute(INTERNAL_LINK_ATTR)) {
      event.preventDefault();
      void this.router.navigateByUrl(href);
    }
  }

  private goToHeading(id: string, copyLink: boolean): void {
    const heading = this.host.querySelector(`[id="${CSS.escape(decodeURIComponent(id))}"]`);
    if (!heading) return;
    heading.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    if (this.mode() !== 'view') return;
    const url = `${location.pathname}${location.search}#${heading.id}`;
    history.replaceState(history.state, '', url);
    if (!copyLink) return;
    void navigator.clipboard
      .writeText(`${location.origin}${url}`)
      .then(() => this.toast.success('Link to this section copied'))
      .catch(() => undefined);
  }
}

/// Wraps each fenced code block in a frame with a header: the language and a Copy button.
function decorateCodeBlocks(root: HTMLElement): void {
  const doc = root.ownerDocument;
  for (const pre of Array.from(root.querySelectorAll(':scope > pre, :scope > * > pre'))) {
    const code = pre.querySelector('code');
    if (!code || pre.parentElement?.classList.contains('tk-code')) continue;
    const language = codeLanguage(code);
    if (language === 'mermaid') continue;
    const frame = doc.createElement('div');
    frame.className = 'tk-code';
    const header = doc.createElement('div');
    header.className = 'tk-code-h';
    const label = doc.createElement('span');
    label.textContent = language ?? 'text';
    const copy = doc.createElement('button');
    copy.type = 'button';
    copy.className = 'tk-code-copy';
    copy.textContent = 'Copy';
    header.append(label, copy);
    pre.replaceWith(frame);
    frame.append(header, pre);
  }
}

function prefersReducedMotion(): boolean {
  return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}
