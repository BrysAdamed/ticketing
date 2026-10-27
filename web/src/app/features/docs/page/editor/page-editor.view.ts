import { DOCUMENT } from '@angular/common';
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
import { MatTooltip } from '@angular/material/tooltip';
import { ActivatedRoute, Router } from '@angular/router';
import { EditorView } from '@codemirror/view';
import { provideIcons } from '@ng-icons/core';
import {
  tablerBold,
  tablerCloud,
  tablerCloudCheck,
  tablerCloudOff,
  tablerCode,
  tablerEye,
  tablerH1,
  tablerH2,
  tablerH3,
  tablerHeading,
  tablerInfoSquareRounded,
  tablerItalic,
  tablerLayoutColumns,
  tablerLink,
  tablerListNumbers,
  tablerPhoto,
  tablerQuote,
  tablerSeparatorHorizontal,
  tablerSourceCode,
  tablerTable,
} from '@ng-icons/tabler-icons';
import { Extension } from '@codemirror/state';
import { DocAttachmentsApi } from '@core/docs/doc-attachments.api';
import {
  DOC_EDITOR_PLUGINS,
  DocEditorAction,
  DocEditorCommandContext,
} from '@core/docs/doc-extensions';
import { Doc, PAGE_CONTENT_MAX_LENGTH } from '@core/docs/doc.models';
import { ConfirmService } from '@core/notify/confirm.service';
import { ToastService } from '@core/notify/toast.service';
import { ShortcutService } from '@core/shortcuts/shortcut.service';
import { MAX_ATTACHMENT_BYTES } from '@core/tickets/ticket-attachments';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { KbdComponent } from '@shared/ui/kbd/kbd.component';
import {
  createMarkdownEditor,
  insertBlock,
  replaceDocument,
  replaceSelection,
  SlashCommand,
  topLine,
} from '../../editing/codemirror-markdown';
import { DocEditSession } from '../../editing/doc-edit-session';
import { DocMarkdownComponent } from '../doc-markdown.component';
import { DocPresenceComponent } from '../doc-presence.component';
import { headingLines, syncedScrollTop } from '../page-outline';
import { DocConflictComponent } from './doc-conflict.component';
import { EDITOR_ACTIONS } from './editor-actions';

export type EditorLayout = 'write' | 'split' | 'preview';

const LAYOUTS: readonly EditorLayout[] = ['write', 'split', 'preview'];
const LAYOUT_KEY = 'tk-docs-editor-layout';
const PREVIEW_DELAY_MS = 150;

interface ToolbarItem {
  id: string;
  label: string;
  icon: string;
  tooltip: string;
  run(): void;
}

/// The page editor (`docs.page.edit`, a lazy chunk with CodeMirror): edit bar with the draft
/// status, presence and Publish; toolbar; inline title; markdown source next to a live preview
/// with approximate scroll sync; `/` commands; paste or drop of images; the conflict view.
/// `Mod-s` publishes, `Mod-Enter` publishes and closes, `Esc` closes (the draft is kept).
@Component({
  selector: 'tk-page-editor-view',
  imports: [
    MatButtonModule,
    MatTooltip,
    IconComponent,
    KbdComponent,
    DocMarkdownComponent,
    DocPresenceComponent,
    DocConflictComponent,
  ],
  providers: [DocEditSession],
  viewProviders: [
    provideIcons({
      tablerBold,
      tablerCloud,
      tablerCloudCheck,
      tablerCloudOff,
      tablerCode,
      tablerEye,
      tablerH1,
      tablerH2,
      tablerH3,
      tablerHeading,
      tablerInfoSquareRounded,
      tablerItalic,
      tablerLayoutColumns,
      tablerLink,
      tablerListNumbers,
      tablerPhoto,
      tablerQuote,
      tablerSeparatorHorizontal,
      tablerSourceCode,
      tablerTable,
    }),
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    'data-testid': 'view-docs.page.edit',
    '(window:beforeunload)': 'session.saveOnUnload()',
    '(document:visibilitychange)': 'onVisibilityChange()',
  },
  templateUrl: './page-editor.view.html',
  styleUrl: './page-editor.view.scss',
})
export class PageEditorView {
  protected readonly session = inject(DocEditSession);
  private readonly attachments = inject(DocAttachmentsApi);
  private readonly shortcuts = inject(ShortcutService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly confirm = inject(ConfirmService);
  private readonly toast = inject(ToastService);
  private readonly document = inject(DOCUMENT);
  private readonly plugins = [...inject(DOC_EDITOR_PLUGINS)].sort((a, b) => a.order - b.order);

  readonly doc = input.required<Doc>();

  protected readonly sourceHost = viewChild.required<ElementRef<HTMLElement>>('source');
  protected readonly previewPane = viewChild<ElementRef<HTMLElement>>('preview');
  protected readonly fileInput = viewChild.required<ElementRef<HTMLInputElement>>('files');

  protected readonly layout = signal<EditorLayout>(this.readLayout());
  protected readonly layouts = LAYOUTS;
  protected readonly changeNote = signal('');
  protected readonly uploading = signal(0);
  protected readonly previewSource = signal('');
  protected readonly maxLength = PAGE_CONTENT_MAX_LENGTH;
  protected readonly tooLong = computed(
    () => this.session.content().length > PAGE_CONTENT_MAX_LENGTH,
  );
  protected readonly presence = computed(() => this.doc().editors);

  protected readonly toolbar: ToolbarItem[];
  private readonly slashCommands: SlashCommand[];

  private view: EditorView | null = null;
  private appliedRevision = -1;
  private previewTimer: ReturnType<typeof setTimeout> | null = null;
  private syncing = false;

  constructor() {
    const pluginActions = (pick: 'toolbar' | 'slashCommands') =>
      this.plugins.flatMap((plugin) => plugin[pick] ?? []);
    this.toolbar = [
      ...EDITOR_ACTIONS.filter((a) => a.toolbar).map((a) => ({
        id: a.id,
        label: a.label,
        icon: a.icon,
        tooltip: a.keys ? `${a.label} (${this.shortcuts.format(a.keys).join(' ')})` : a.label,
        run: () => this.withView((view) => a.run(view)),
      })),
      {
        id: 'image',
        label: 'Image',
        icon: 'tablerPhoto',
        tooltip: 'Image (or paste / drop one)',
        run: () => this.fileInput().nativeElement.click(),
      },
      ...pluginActions('toolbar').map((a) => ({
        id: a.id,
        label: a.label,
        icon: a.icon,
        tooltip: a.hint ? `${a.label} (${a.hint})` : a.label,
        run: () => void this.runPlugin(a),
      })),
    ];
    this.slashCommands = [
      ...EDITOR_ACTIONS.filter((a) => a.slash).map((a) => ({
        id: a.id,
        label: a.label,
        hint: a.hint,
        run: (view: EditorView) => a.run(view),
      })),
      {
        id: 'image',
        label: 'Image',
        hint: 'upload',
        run: () => this.fileInput().nativeElement.click(),
      },
      ...pluginActions('slashCommands').map((a) => ({
        id: a.id,
        label: a.label,
        hint: a.hint,
        run: () => void this.runPlugin(a),
      })),
    ];

    effect(() => {
      const doc = this.doc();
      untracked(() => {
        if (this.session.key() !== doc.key) void this.session.open(doc);
      });
    });

    afterNextRender(() => void this.mountEditor());

    effect(() => {
      const revision = this.session.revision();
      const ready = this.session.ready();
      if (!ready || !this.view || revision === this.appliedRevision) return;
      this.appliedRevision = revision;
      untracked(() => replaceDocument(this.view!, this.session.content()));
    });

    effect(() => {
      const content = this.session.content();
      if (!this.session.ready()) return;
      untracked(() => {
        if (this.previewTimer) clearTimeout(this.previewTimer);
        if (!this.previewSource()) {
          this.previewSource.set(content);
          return;
        }
        this.previewTimer = setTimeout(() => this.previewSource.set(content), PREVIEW_DELAY_MS);
      });
    });

    this.shortcuts.registerScoped([
      {
        keys: 'mod+s',
        description: 'Publish',
        section: 'Docs editor',
        allowInInputs: true,
        handler: () => void this.publish(false),
      },
      {
        keys: 'mod+enter',
        description: 'Publish and close',
        section: 'Docs editor',
        allowInInputs: true,
        handler: () => void this.publish(true),
      },
      {
        keys: 'escape',
        description: 'Close the editor (the draft is kept)',
        section: 'Docs editor',
        allowInInputs: true,
        handler: () => {
          if (!this.session.conflict()) void this.close();
        },
      },
      {
        keys: 'mod+shift+p',
        description: 'Cycle Write / Split / Preview',
        section: 'Docs editor',
        allowInInputs: true,
        handler: () => this.cycleLayout(),
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

  protected shortcutLabel(keys: string): string {
    return this.shortcuts.format(keys).join(' ');
  }

  protected onTitle(value: string): void {
    this.session.edit({ title: value });
  }

  protected setLayout(layout: EditorLayout): void {
    this.layout.set(layout);
    try {
      this.document.defaultView?.localStorage.setItem(LAYOUT_KEY, layout);
    } catch {
      return;
    }
  }

  protected cycleLayout(): void {
    this.setLayout(LAYOUTS[(LAYOUTS.indexOf(this.layout()) + 1) % LAYOUTS.length]);
  }

  protected async publish(close: boolean): Promise<void> {
    if (this.session.status() === 'publishing' || this.session.conflict()) return;
    if (this.tooLong()) {
      this.toast.warning(
        `Pages hold at most ${PAGE_CONTENT_MAX_LENGTH.toLocaleString()} characters.`,
      );
      return;
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
      message: 'Your draft is deleted and the editor closes. The published page stays as it is.',
      confirmLabel: 'Discard',
      danger: true,
    });
    if (ok && (await this.session.discard())) await this.leave();
  }

  protected async keepEditingOnLatest(): Promise<void> {
    this.session.keepEditingOnLatest();
  }

  protected async overwriteWithMine(): Promise<void> {
    await this.session.overwriteWithMine(this.changeNote());
  }

  protected async discardMine(): Promise<void> {
    if (await this.session.discard()) await this.leave();
  }

  protected retrySave(): void {
    void this.session.flush();
  }

  protected copyReference(): void {
    const text = this.session.reference()?.content ?? '';
    void navigator.clipboard
      .writeText(text)
      .then(() => this.toast.success('Your text was copied'))
      .catch(() => this.toast.error("Couldn't copy the text"));
  }

  protected onFilesPicked(input: HTMLInputElement): void {
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (this.view) this.upload(files, this.view.state.selection.main.head);
  }

  protected onVisibilityChange(): void {
    if (this.document.visibilityState === 'hidden') void this.session.flush();
  }

  private async mountEditor(): Promise<void> {
    const extensions = (
      await Promise.all(
        this.plugins.map((plugin) =>
          plugin.extensions
            ? plugin.extensions({ docKey: this.doc().key, projectKey: this.doc().projectKey })
            : Promise.resolve([]),
        ),
      )
    ).flat() as Extension[];
    this.view = createMarkdownEditor({
      parent: this.sourceHost().nativeElement,
      doc: this.session.ready() ? this.session.content() : '',
      placeholder: 'Write markdown. Type / for blocks, paste or drop images.',
      slashCommands: () => this.slashCommands,
      extraExtensions: extensions,
      onChange: (text) => {
        if (text !== this.session.content()) this.session.edit({ content: text });
      },
      onBlur: () => void this.session.flush(),
      onScroll: (view) => this.syncPreview(view),
      onFiles: (files, position) => this.upload(files, position),
    });
    this.view.contentDOM.setAttribute('data-testid', 'doc-editor-source');
    this.view.contentDOM.setAttribute('aria-label', 'Markdown source');
    this.appliedRevision = this.session.ready() ? this.session.revision() : -1;
    if (this.session.ready()) replaceDocument(this.view, this.session.content());
    this.view.focus();
  }

  private withView(run: (view: EditorView) => void): void {
    if (this.view) run(this.view);
  }

  private async runPlugin(action: DocEditorAction): Promise<void> {
    const view = this.view;
    if (!view) return;
    const doc = this.doc();
    const context: DocEditorCommandContext = {
      docKey: doc.key,
      projectKey: doc.projectKey,
      selectedText: () =>
        view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to),
      replaceSelection: (text, select) => replaceSelection(view, text, select),
      insertBlock: (text, caret) => insertBlock(view, text, caret),
      focus: () => view.focus(),
    };
    try {
      await action.run(context);
    } catch (error) {
      this.toast.error(error);
    }
  }

  /// Uploads pasted, dropped or picked files to the page; each gets a placeholder at `position`
  /// that becomes its markdown (or disappears when the upload fails).
  private upload(files: File[], position: number): boolean {
    const view = this.view;
    if (!view || files.length === 0) return false;
    const tooBig = files.filter((f) => f.size > MAX_ATTACHMENT_BYTES);
    if (tooBig.length)
      this.toast.warning(
        `${tooBig.map((f) => f.name).join(', ')} ${tooBig.length === 1 ? 'is' : 'are'} larger than 10 MB.`,
      );
    const accepted = files.filter((f) => f.size <= MAX_ATTACHMENT_BYTES);
    const placeholders = accepted.map(
      (file) => `![Uploading ${file.name.replace(/[[\]]/g, '')}…]()`,
    );
    if (placeholders.length === 0) return true;
    view.dispatch({
      changes: { from: position, insert: placeholders.join('\n') },
      userEvent: 'input',
    });
    accepted.forEach((file, i) => void this.uploadOne(file, placeholders[i]));
    return true;
  }

  private async uploadOne(file: File, placeholder: string): Promise<void> {
    this.uploading.update((n) => n + 1);
    let markdown = '';
    try {
      markdown = this.attachments.markdownFor(await this.attachments.upload(this.doc().key, file));
    } catch (error) {
      this.toast.error(error instanceof Error && !('status' in error) ? error.message : error);
    } finally {
      this.uploading.update((n) => n - 1);
    }
    const view = this.view;
    if (!view) return;
    const at = view.state.doc.toString().indexOf(placeholder);
    if (at < 0) return;
    view.dispatch({ changes: { from: at, to: at + placeholder.length, insert: markdown } });
  }

  private syncPreview(view: EditorView): void {
    const pane = this.previewPane()?.nativeElement;
    if (!pane || this.layout() !== 'split' || this.syncing) return;
    this.syncing = true;
    requestAnimationFrame(() => {
      this.syncing = false;
      const headings = Array.from(
        pane.querySelectorAll<HTMLElement>('tk-doc-markdown > :is(h1,h2,h3,h4,h5,h6)'),
      );
      const paneTop = pane.getBoundingClientRect().top - pane.scrollTop;
      const anchors = headings.map((h) => h.getBoundingClientRect().top - paneTop - 16);
      pane.scrollTop = syncedScrollTop(
        topLine(view),
        headingLines(view.state.doc.toString()),
        anchors,
        view.state.doc.lines,
        pane.scrollHeight - pane.clientHeight,
      );
    });
  }

  private async leave(): Promise<void> {
    await this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { mode: null },
      queryParamsHandling: 'merge',
    });
  }

  private readLayout(): EditorLayout {
    try {
      const stored = inject(DOCUMENT).defaultView?.localStorage.getItem(LAYOUT_KEY);
      if (stored && (LAYOUTS as readonly string[]).includes(stored)) return stored as EditorLayout;
    } catch {
      return 'split';
    }
    return 'split';
  }
}
