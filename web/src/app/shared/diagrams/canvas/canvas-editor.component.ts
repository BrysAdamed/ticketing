import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  Injector,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';
import type { ExcalidrawImperativeAPI, ExcalidrawProps } from '@excalidraw/excalidraw/types';
import type { Root } from 'react-dom/client';
import { DiagramTheme } from '../diagram-theme';
import { CanvasSource, parseCanvasSource } from './canvas-source';
import { ExcalidrawRuntime, loadExcalidraw } from './excalidraw-loader';
import { exportSceneSvg } from './canvas-export';

type InitialData = NonNullable<ExcalidrawProps['initialData']>;
type ClipboardData = Parameters<NonNullable<ExcalidrawProps['onPaste']>>[0];

/// The Canvas editor: Excalidraw mounted as a lazily loaded React island (ADR 0014). `source` is
/// the scene to load; setting a different value reloads the editor (load a version, discard), so
/// do not feed the editor's own output back into it. `changed` fires when the drawing changes;
/// read the result with `serialize()` and the light SVG snapshot with `exportSvg()`. Images are
/// not allowed in v1: pasting or dropping one is refused and reported by `imageRefused`. App
/// shortcuts stay quiet while focus is inside (Excalidraw owns single-key tools).
@Component({
  selector: 'tk-canvas-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div #host class="host" data-testid="canvas-editor"></div>`,
  styles: `
    :host {
      display: block;
      position: relative;
      min-height: 320px;
    }
    .host {
      position: absolute;
      inset: 0;
    }
  `,
  host: {
    '[attr.aria-busy]': '!ready()',
    'data-own-keys': '',
  },
})
export class CanvasEditorComponent {
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  private readonly host = viewChild.required<ElementRef<HTMLElement>>('host');

  readonly source = input<string | null>(null);
  readonly theme = input<DiagramTheme>('light');
  readonly readOnly = input(false);
  readonly changed = output<void>();
  readonly loadFailed = output<unknown>();
  readonly imageRefused = output<void>();

  readonly ready = signal(false);

  private runtime?: ExcalidrawRuntime;
  private root?: Root;
  private api?: ExcalidrawImperativeAPI;
  private destroyed = false;
  private sceneKey = 0;
  private loadedSource?: string | null;
  private initialData?: InitialData;
  private lastSignature?: string;

  constructor() {
    afterNextRender(() => void this.mount());
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      this.root?.unmount();
    });
  }

  /// The current scene in the stored source format.
  serialize(): string {
    const { api, runtime } = this.requireApi();
    return runtime.excalidraw.serializeAsJSON(
      api.getSceneElements(),
      api.getAppState(),
      api.getFiles(),
      'database',
    );
  }

  /// The current scene as a light, self-contained SVG (fonts inlined) for embeds and PDF.
  exportSvg(): Promise<string> {
    const { api } = this.requireApi();
    return exportSceneSvg({
      elements: api.getSceneElements() as unknown as CanvasSource['elements'],
      appState: api.getAppState() as unknown as Record<string, unknown>,
      files: api.getFiles() as unknown as Record<string, unknown>,
    });
  }

  private refuseFileDrop(event: DragEvent): void {
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    event.stopPropagation();
    this.imageRefused.emit();
  }

  private refusePaste(data: ClipboardData, event: ClipboardEvent | null): boolean {
    const files = event?.clipboardData?.files.length ?? 0;
    const pastedFiles = Object.keys(data.files ?? {}).length;
    const images = (data.elements ?? []).some((element) => element.type === 'image');
    if (files === 0 && pastedFiles === 0 && !images) return true;
    this.imageRefused.emit();
    return false;
  }

  private async mount(): Promise<void> {
    this.host().nativeElement.addEventListener('drop', (event) => this.refuseFileDrop(event), {
      capture: true,
    });
    try {
      this.runtime = await loadExcalidraw(this.document);
      if (this.destroyed) return;
      this.root = this.runtime.createRoot(this.host().nativeElement);
    } catch (error) {
      this.loadFailed.emit(error);
      return;
    }
    effect(() => this.render(this.source(), this.theme(), this.readOnly()), {
      injector: this.injector,
    });
  }

  private render(source: string | null, theme: DiagramTheme, readOnly: boolean): void {
    const runtime = this.runtime;
    if (!runtime || !this.root) return;
    if (this.initialData === undefined || source !== this.loadedSource) {
      const scene = untracked(() => parseCanvasSource(source));
      this.loadedSource = source;
      this.sceneKey++;
      this.lastSignature = undefined;
      this.initialData = {
        elements: scene.elements,
        appState: scene.appState,
        files: scene.files,
        scrollToContent: true,
      } as unknown as InitialData;
    }
    const { react, excalidraw } = runtime;
    const { MainMenu } = excalidraw;
    const props: ExcalidrawProps = {
      initialData: this.initialData,
      theme,
      viewModeEnabled: readOnly,
      aiEnabled: false,
      validateEmbeddable: () => false,
      onPaste: (data, event) => this.refusePaste(data, event),
      UIOptions: {
        canvasActions: {
          loadScene: false,
          saveToActiveFile: false,
          saveAsImage: false,
          export: false,
          toggleTheme: null,
        },
        tools: { image: false },
      },
      excalidrawAPI: (api) => {
        this.api = api;
        this.ready.set(true);
      },
      onChange: (elements, appState) => {
        const signature = `${runtime.excalidraw.getSceneVersion(elements)}|${appState.viewBackgroundColor}`;
        const previous = this.lastSignature;
        this.lastSignature = signature;
        if (previous !== undefined && previous !== signature) this.changed.emit();
      },
    };
    this.root.render(
      react.createElement(
        excalidraw.Excalidraw,
        { key: this.sceneKey, ...props },
        react.createElement(
          MainMenu,
          null,
          react.createElement(MainMenu.DefaultItems.ChangeCanvasBackground),
          react.createElement(MainMenu.DefaultItems.ClearCanvas),
          react.createElement(MainMenu.DefaultItems.Help),
        ),
      ),
    );
  }

  private requireApi(): { api: ExcalidrawImperativeAPI; runtime: ExcalidrawRuntime } {
    if (!this.api || !this.runtime) throw new Error('The canvas editor is not ready yet.');
    return { api: this.api, runtime: this.runtime };
  }
}
