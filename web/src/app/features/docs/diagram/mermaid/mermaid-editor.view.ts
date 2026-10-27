import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { ActivatedRoute, Router } from '@angular/router';
import { EditorView } from '@codemirror/view';
import { provideIcons } from '@ng-icons/core';
import { tablerBook2, tablerChevronDown, tablerEye, tablerTemplate } from '@ng-icons/tabler-icons';
import { Doc, MERMAID_SOURCE_MAX_LENGTH } from '@core/docs/doc.models';
import { ConfirmService } from '@core/notify/confirm.service';
import { ToastService } from '@core/notify/toast.service';
import { ShortcutService } from '@core/shortcuts/shortcut.service';
import { ThemeService } from '@core/theme/theme.service';
import { mermaidDiagramType, renderMermaid } from '@shared/diagrams/mermaid/mermaid-renderer';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { KbdComponent } from '@shared/ui/kbd/kbd.component';
import { createMermaidEditor } from '../../editing/codemirror-mermaid';
import { replaceDocument } from '../../editing/codemirror-shared';
import { DocEditSession } from '../../editing/doc-edit-session';
import { DocEditStatusComponent } from '../../editing/doc-edit-status.component';
import { DocConflictComponent } from '../../page/editor/doc-conflict.component';
import { svgRender } from '../diagram-renderers';
import { DiagramViewportComponent, ViewportContent } from '../diagram-viewport.component';
import { MERMAID_TEMPLATES, MermaidTemplate } from './mermaid-templates';

/// The preview re-renders this long after typing stops (design: 300 ms).
const PREVIEW_DELAY_MS = 300;
export const MERMAID_SYNTAX_URL = 'https://mermaid.js.org/intro/syntax-reference.html';

/// The Mermaid diagram editor (`docs.diagram.mermaid.edit`, a lazy chunk with CodeMirror): the edit
/// bar with draft status, presence and Publish; templates for the supported diagram types; the
/// source with line numbers next to a live, zoomable preview that keeps the last good render
/// while the source has a syntax error (shown in a strip below). Drafts, publishing and conflicts
/// go through `DocEditSession` like pages. `Mod-s` publishes, `Mod-Enter` publishes and closes,
/// `Esc` closes (the draft is kept); invalid source is published only after a confirmation.
@Component({
  selector: 'tk-mermaid-editor-view',
  imports: [
    MatButtonModule,
    MatMenuModule,
    IconComponent,
    KbdComponent,
    DocEditStatusComponent,
    DocConflictComponent,
    DiagramViewportComponent,
  ],
  providers: [DocEditSession],
  viewProviders: [provideIcons({ tablerBook2, tablerChevronDown, tablerEye, tablerTemplate })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    'data-testid': 'view-docs.diagram.mermaid.edit',
    '(window:beforeunload)': 'session.saveOnUnload()',
    '(document:visibilitychange)': 'onVisibilityChange()',
  },
  templateUrl: './mermaid-editor.view.html',
  styleUrl: './mermaid-editor.view.scss',
})
export class MermaidEditorView {
  protected readonly session = inject(DocEditSession);
  private readonly shortcuts = inject(ShortcutService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly confirm = inject(ConfirmService);
  private readonly toast = inject(ToastService);
  private readonly theme = inject(ThemeService).theme;

  readonly doc = input.required<Doc>();

  protected readonly sourceHost = viewChild.required<ElementRef<HTMLElement>>('source');

  protected readonly templates = MERMAID_TEMPLATES;
  protected readonly syntaxUrl = MERMAID_SYNTAX_URL;
  protected readonly maxLength = MERMAID_SOURCE_MAX_LENGTH;
  protected readonly changeNote = signal('');
  /// The last good render of the source, kept while the current source has an error.
  protected readonly preview = signal<ViewportContent | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly empty = computed(() => !this.session.content().trim());
  protected readonly tooLong = computed(
    () => this.session.content().length > MERMAID_SOURCE_MAX_LENGTH,
  );
  protected readonly typeLabel = computed(() => mermaidDiagramType(this.session.content()));
  protected readonly presence = computed(() => this.doc().editors);

  private view: EditorView | null = null;
  private appliedRevision = -1;
  private previewTimer: ReturnType<typeof setTimeout> | null = null;
  private rendered: Promise<void> = Promise.resolve();
  private renderGeneration = 0;

  constructor() {
    effect(() => {
      const doc = this.doc();
      untracked(() => {
        if (this.session.key() !== doc.key) void this.session.open(doc);
      });
    });

    afterNextRender(() => this.mountEditor());

    effect(() => {
      const revision = this.session.revision();
      const ready = this.session.ready();
      if (!ready || !this.view || revision === this.appliedRevision) return;
      this.appliedRevision = revision;
      untracked(() => replaceDocument(this.view!, this.session.content()));
    });

    effect(() => {
      const content = this.session.content();
      const theme = this.theme();
      if (!this.session.ready()) return;
      untracked(() => {
        if (this.previewTimer) clearTimeout(this.previewTimer);
        const delay = this.preview() || this.error() ? PREVIEW_DELAY_MS : 0;
        this.previewTimer = setTimeout(() => {
          this.previewTimer = null;
          this.rendered = this.renderPreview(content, theme);
        }, delay);
      });
    });

    this.shortcuts.registerScoped([
      {
        keys: 'mod+s',
        description: 'Publish',
        section: 'Diagram editor',
        allowInInputs: true,
        handler: () => void this.publish(false),
      },
      {
        keys: 'mod+enter',
        description: 'Publish and close',
        section: 'Diagram editor',
        allowInInputs: true,
        handler: () => void this.publish(true),
      },
      {
        keys: 'escape',
        description: 'Close the editor (the draft is kept)',
        section: 'Diagram editor',
        allowInInputs: true,
        handler: () => {
          if (!this.session.conflict()) void this.close();
        },
      },
    ]);

    inject(DestroyRef).onDestroy(() => {
      if (this.previewTimer) clearTimeout(this.previewTimer);
      void this.session.flush();
      this.view?.destroy();
    });
  }

  protected shortcutKeys(keys: string): string[] {
    return this.shortcuts.format(keys);
  }

  protected onTitle(value: string): void {
    this.session.edit({ title: value });
  }

  protected async useTemplate(template: MermaidTemplate): Promise<void> {
    const view = this.view;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current.trim() && current !== template.source) {
      const ok = await this.confirm.confirm({
        title: `Replace the source with the ${template.label.toLowerCase()} template?`,
        message: 'The current source is replaced. Undo (Ctrl+Z) brings it back.',
        confirmLabel: 'Replace',
      });
      if (!ok) return;
    }
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: template.source },
      userEvent: 'input',
    });
    view.focus();
  }

  protected async publish(close: boolean): Promise<void> {
    if (this.session.status() === 'publishing' || this.session.conflict()) return;
    if (this.tooLong()) {
      this.toast.warning(
        `Mermaid diagrams hold at most ${MERMAID_SOURCE_MAX_LENGTH.toLocaleString()} characters.`,
      );
      return;
    }
    await this.settlePreview();
    if (this.error()) {
      const ok = await this.confirm.confirm({
        title: 'Publish a diagram with a syntax error?',
        message: 'Readers see the error and the source instead of the diagram until it is fixed.',
        confirmLabel: 'Publish anyway',
        danger: true,
      });
      if (!ok) return;
    }
    const doc = await this.session.publish(this.changeNote());
    if (!doc) return;
    this.changeNote.set('');
    if (close) await this.leave();
  }

  protected async close(): Promise<void> {
    await this.session.flush();
    await this.leave();
  }

  protected async discard(): Promise<void> {
    const ok = await this.confirm.confirm({
      title: 'Discard your unpublished changes?',
      message: 'Your draft is deleted and the editor closes. The published diagram stays as it is.',
      confirmLabel: 'Discard',
      danger: true,
    });
    if (ok && (await this.session.discard())) await this.leave();
  }

  protected keepEditingOnLatest(): void {
    this.session.keepEditingOnLatest();
  }

  protected async overwriteWithMine(): Promise<void> {
    await this.session.overwriteWithMine(this.changeNote());
  }

  protected async discardMine(): Promise<void> {
    if (await this.session.discard()) await this.leave();
  }

  protected onVisibilityChange(): void {
    if (document.visibilityState === 'hidden') void this.session.flush();
  }

  private mountEditor(): void {
    this.view = createMermaidEditor({
      parent: this.sourceHost().nativeElement,
      doc: this.session.ready() ? this.session.content() : '',
      placeholder: 'Write Mermaid, for example: flowchart LR  A --> B. Or pick a template.',
      onChange: (text) => {
        if (text !== this.session.content()) this.session.edit({ content: text });
      },
      onBlur: () => void this.session.flush(),
    });
    this.view.contentDOM.setAttribute('data-testid', 'doc-editor-source');
    this.view.contentDOM.setAttribute('aria-label', 'Mermaid source');
    this.appliedRevision = this.session.ready() ? this.session.revision() : -1;
    this.view.focus();
  }

  /// Renders any preview still waiting for its debounce, so Publish judges the current source.
  private async settlePreview(): Promise<void> {
    if (this.previewTimer) {
      clearTimeout(this.previewTimer);
      this.previewTimer = null;
      this.rendered = this.renderPreview(this.session.content(), this.theme());
    }
    await this.rendered;
  }

  private async renderPreview(content: string, theme: 'light' | 'dark'): Promise<void> {
    const generation = ++this.renderGeneration;
    if (!content.trim()) {
      this.preview.set(null);
      this.error.set(null);
      return;
    }
    const rendered = await renderMermaid(content, theme);
    if (generation !== this.renderGeneration) return;
    if (rendered.svg === undefined) {
      this.error.set(rendered.error);
      return;
    }
    const result = svgRender(rendered.svg);
    if ('error' in result) {
      this.error.set(result.error);
      return;
    }
    this.preview.set(result);
    this.error.set(null);
  }

  private async leave(): Promise<void> {
    await this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { mode: null },
      queryParamsHandling: 'merge',
    });
  }
}
