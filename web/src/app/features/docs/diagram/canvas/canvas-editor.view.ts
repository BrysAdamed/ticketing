import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { ActivatedRoute, Router } from '@angular/router';
import { CANVAS_SOURCE_MAX_LENGTH, Doc } from '@core/docs/doc.models';
import { ConfirmService } from '@core/notify/confirm.service';
import { ToastService } from '@core/notify/toast.service';
import { ShortcutService } from '@core/shortcuts/shortcut.service';
import { ThemeService } from '@core/theme/theme.service';
import { CanvasEditorComponent } from '@shared/diagrams/canvas/canvas-editor.component';
import { KbdComponent } from '@shared/ui/kbd/kbd.component';
import { DocEditSession, EditConflict } from '../../editing/doc-edit-session';
import { DocEditStatusComponent } from '../../editing/doc-edit-status.component';
import { DocConflictComponent } from '../../page/editor/doc-conflict.component';
import { DiagramSource } from '../diagram-renderers';
import { CanvasPictureComponent } from './canvas-picture.component';
import { svgDataUrl } from './canvas-renderer';

/// The drawing is serialized into the draft this long after the last change; autosave follows.
const SERIALIZE_DELAY_MS = 400;
/// Performance entry measured from opening the editor until Excalidraw shows the scene.
export const CANVAS_OPEN_MEASURE = 'tk-canvas-open';

/// The Canvas editor (`docs.diagram.canvas.edit`, a lazy chunk; Excalidraw loads on top): the edit
/// bar with draft status, presence and Publish, the title and change note, and Excalidraw filling
/// the rest. Drafts and publishing go through `DocEditSession` like pages, without a text merge: a
/// concurrent publish opens the conflict view with both drawings (Overwrite with mine / Discard
/// mine). Publishing sends the source with its light SVG picture. `Mod-s` publishes, `Mod-Enter`
/// publishes and closes; every other key belongs to Excalidraw (`Esc` and the single-key tools),
/// so Close is a button only (the draft is kept).
@Component({
  selector: 'tk-canvas-editor-view',
  imports: [
    MatButtonModule,
    KbdComponent,
    CanvasEditorComponent,
    DocEditStatusComponent,
    DocConflictComponent,
    CanvasPictureComponent,
  ],
  providers: [DocEditSession],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    'data-testid': 'view-docs.diagram.canvas.edit',
    '(window:beforeunload)': 'onUnload($event)',
    '(document:visibilitychange)': 'onVisibilityChange()',
  },
  templateUrl: './canvas-editor.view.html',
  styleUrl: './canvas-editor.view.scss',
})
export class CanvasEditorView {
  protected readonly session = inject(DocEditSession);
  private readonly shortcuts = inject(ShortcutService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly confirm = inject(ConfirmService);
  private readonly toast = inject(ToastService);
  protected readonly theme = inject(ThemeService).theme;

  readonly doc = input.required<Doc>();

  private readonly editor = viewChild(CanvasEditorComponent);

  /// The scene loaded into Excalidraw: replaced only when the session replaces the content (open,
  /// discard), never by the editor's own output.
  protected readonly scene = signal<string | null>(null);
  protected readonly loadFailed = signal(false);
  protected readonly changeNote = signal('');
  protected readonly presence = computed(() => this.doc().editors);
  protected readonly minePicture = signal<DiagramSource | null>(null);
  protected readonly theirsPicture = computed<DiagramSource | null>(() => {
    const theirs = this.session.conflict()?.theirs;
    return theirs
      ? {
          key: theirs.key,
          version: theirs.version,
          content: theirs.content,
          snapshotUrl: theirs.snapshotUrl,
        }
      : null;
  });
  protected readonly canvasReady = computed(() => this.editor()?.ready() ?? false);

  private appliedRevision = -1;
  private serializeTimer: ReturnType<typeof setTimeout> | null = null;
  private unsynced = false;
  private readonly opened = performance.now();
  private measured = false;

  constructor() {
    this.session.configure({ textMerge: false, attach: () => this.snapshot() });

    effect(() => {
      const doc = this.doc();
      untracked(() => {
        if (this.session.key() !== doc.key) void this.session.open(doc);
      });
    });

    effect(() => {
      const revision = this.session.revision();
      if (!this.session.ready() || revision === this.appliedRevision) return;
      this.appliedRevision = revision;
      untracked(() => {
        this.unsynced = false;
        this.scene.set(this.session.content());
      });
    });

    effect(() => {
      if (!this.canvasReady() || this.measured) return;
      this.measured = true;
      performance.measure(CANVAS_OPEN_MEASURE, { start: this.opened });
    });

    effect(() => {
      const conflict = this.session.conflict();
      untracked(() => void this.drawMine(conflict));
    });

    this.shortcuts.registerScoped([
      {
        keys: 'mod+s',
        description: 'Publish',
        section: 'Canvas editor',
        allowInInputs: true,
        handler: () => void this.publish(false),
      },
      {
        keys: 'mod+enter',
        description: 'Publish and close',
        section: 'Canvas editor',
        allowInInputs: true,
        handler: () => void this.publish(true),
      },
    ]);

    inject(DestroyRef).onDestroy(() => {
      this.sync();
      void this.session.flush();
    });
  }

  protected shortcutKeys(keys: string): string[] {
    return this.shortcuts.format(keys);
  }

  protected onTitle(value: string): void {
    this.session.edit({ title: value });
  }

  /// Excalidraw reported a drawing change: serialize it into the draft shortly after.
  protected onChanged(): void {
    this.unsynced = true;
    if (this.serializeTimer) clearTimeout(this.serializeTimer);
    this.serializeTimer = setTimeout(() => this.sync(), SERIALIZE_DELAY_MS);
  }

  protected onImageRefused(): void {
    this.toast.warning(
      'Images go in pages: Canvas diagrams hold shapes, arrows, text and drawing.',
    );
  }

  protected async publish(close: boolean): Promise<void> {
    if (this.session.status() === 'publishing' || this.session.conflict()) return;
    this.sync();
    if (this.session.content().length > CANVAS_SOURCE_MAX_LENGTH) {
      this.toast.warning('This drawing is too large to publish; split it into several diagrams.');
      return;
    }
    const doc = await this.session.publish(this.changeNote());
    if (!doc) return;
    this.changeNote.set('');
    if (close) await this.leave();
  }

  protected async close(): Promise<void> {
    this.sync();
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
    if (!ok) return;
    this.clearTimer();
    this.unsynced = false;
    if (await this.session.discard()) await this.leave();
  }

  protected async overwriteWithMine(): Promise<void> {
    await this.session.overwriteWithMine(this.changeNote());
  }

  protected async discardMine(): Promise<void> {
    this.clearTimer();
    this.unsynced = false;
    if (await this.session.discard()) await this.leave();
  }

  protected onUnload(event: BeforeUnloadEvent): void {
    this.sync();
    this.session.saveOnUnload(event);
  }

  protected onVisibilityChange(): void {
    if (document.visibilityState !== 'hidden') return;
    this.sync();
    void this.session.flush();
  }

  /// Moves the drawing into the session (and so into the draft) if it changed since.
  private sync(): void {
    this.clearTimer();
    const editor = this.editor();
    if (!this.unsynced || !editor?.ready()) return;
    this.unsynced = false;
    try {
      const content = editor.serialize();
      if (content !== this.session.content()) this.session.edit({ content });
    } catch {
      this.unsynced = true;
    }
  }

  /// The light SVG picture of the drawing as it is in the editor, sent with every publish.
  private async snapshot(): Promise<{ snapshot?: string }> {
    const editor = this.editor();
    if (!editor?.ready()) return {};
    try {
      return { snapshot: await editor.exportSvg() };
    } catch {
      return {};
    }
  }

  /// My drawing as it is in the editor, exported once when the conflict view opens.
  private async drawMine(conflict: EditConflict | null): Promise<void> {
    this.minePicture.set(null);
    if (!conflict) return;
    const { snapshot } = await this.snapshot();
    if (this.session.conflict() !== conflict || !snapshot) return;
    this.minePicture.set({
      key: conflict.theirs.key,
      version: 0,
      content: null,
      snapshotUrl: svgDataUrl(snapshot),
    });
  }

  private clearTimer(): void {
    if (this.serializeTimer) clearTimeout(this.serializeTimer);
    this.serializeTimer = null;
  }

  private async leave(): Promise<void> {
    await this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { mode: null },
      queryParamsHandling: 'merge',
    });
  }
}
