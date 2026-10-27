import { NgComponentOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  Type,
  untracked,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltip } from '@angular/material/tooltip';
import { ActivatedRoute, Router } from '@angular/router';
import { provideIcons } from '@ng-icons/core';
import { tablerCopy } from '@ng-icons/tabler-icons';
import { map } from 'rxjs';
import { Doc } from '@core/docs/doc.models';
import { ToastService } from '@core/notify/toast.service';
import { ShortcutService } from '@core/shortcuts/shortcut.service';
import { ThemeService } from '@core/theme/theme.service';
import { ViewRegistry } from '@core/views/view-registry';
import { mermaidDiagramType } from '@shared/diagrams/mermaid/mermaid-renderer';
import { AbsoluteTimePipe, RelativeTimePipe } from '@shared/pipes/relative-time.pipe';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { KbdComponent } from '@shared/ui/kbd/kbd.component';
import { DocDraftBannerComponent } from '../doc/doc-draft-banner.component';
import { docIcon, DOCS_ICONS } from '../docs-icons';
import { DIAGRAM_EDIT_VIEWS, hasDocEditor } from '../docs.views';
import { DocPageSectionsComponent } from '../page/doc-page-sections.component';
import { DocPresenceComponent } from '../page/doc-presence.component';
import { DIAGRAM_RENDERERS } from './diagram-renderers';
import { DiagramViewportComponent, ViewportContent } from './diagram-viewport.component';

/// Performance entry measured for every diagram render in the diagram view (e2e budget: < 1 s).
export const DIAGRAM_RENDER_MEASURE = 'tk-diagram-render';

type RenderState =
  | { kind: 'empty' }
  | { kind: 'loading' }
  | { kind: 'unsupported' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; content: ViewportContent };

/// A diagram doc (`docs.diagram`), any format: title and meta line, the "unpublished changes"
/// banner, the rendered diagram (`DIAGRAM_RENDERERS` by format) in a zoomable viewport and the
/// footer page sections. With `?mode=edit` (writers, formats in `DIAGRAM_EDIT_VIEWS`) it renders
/// that format's editor, loaded lazily, instead. Zoom: `=` `-` `0` (fit) `1` (100 %).
@Component({
  selector: 'tk-doc-diagram-view',
  imports: [
    NgComponentOutlet,
    MatButtonModule,
    MatTooltip,
    IconComponent,
    KbdComponent,
    RelativeTimePipe,
    AbsoluteTimePipe,
    DocDraftBannerComponent,
    DocPageSectionsComponent,
    DocPresenceComponent,
    DiagramViewportComponent,
  ],
  viewProviders: [provideIcons({ ...DOCS_ICONS, tablerCopy })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-testid': 'view-docs.diagram', '[class.editing]': 'editing()' },
  templateUrl: './diagram.view.html',
  styleUrl: './diagram.view.scss',
})
export class DiagramView {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly registry = inject(ViewRegistry);
  private readonly toast = inject(ToastService);
  private readonly theme = inject(ThemeService).theme;
  private readonly viewport = viewChild(DiagramViewportComponent);

  readonly doc = input.required<Doc>();

  private readonly mode = toSignal(this.route.queryParamMap.pipe(map((q) => q.get('mode'))), {
    initialValue: null,
  });
  protected readonly editing = computed(
    () => this.mode() === 'edit' && this.doc().permissions.canEdit && hasDocEditor(this.doc()),
  );
  protected readonly editor = signal<Type<unknown> | null>(null);
  protected readonly state = signal<RenderState>({ kind: 'loading' });
  protected readonly lines = [96, 88, 62, 91, 74, 83, 58];

  protected readonly icon = computed(() => docIcon('Diagram', this.doc().diagramFormat));
  protected readonly label = computed(() => {
    const doc = this.doc();
    if (doc.diagramFormat !== 'Mermaid') return `${doc.diagramFormat ?? 'Unknown'} diagram`;
    const type = mermaidDiagramType(doc.content ?? '');
    return type ? `Mermaid · ${type}` : 'Mermaid';
  });

  private generation = 0;

  constructor() {
    effect(() => {
      const doc = this.doc();
      if (!this.editing() || !doc.diagramFormat) return;
      const definition = DIAGRAM_EDIT_VIEWS[doc.diagramFormat];
      if (!definition) return;
      untracked(() => {
        void this.registry.resolve(definition).then((component) => {
          this.editor.set(component);
          this.registry.reportExposure(definition.viewId);
        });
      });
    });

    effect(() => {
      const doc = this.doc();
      const theme = this.theme();
      if (this.editing()) return;
      const source = { key: doc.key, version: doc.version, content: doc.content };
      const format = doc.diagramFormat;
      untracked(() => void this.render(source, format, theme));
    });

    inject(ShortcutService).registerScoped([
      {
        keys: '=',
        description: 'Zoom in',
        section: 'Docs',
        handler: () => this.viewport()?.zoomIn(),
      },
      {
        keys: '-',
        description: 'Zoom out',
        section: 'Docs',
        handler: () => this.viewport()?.zoomOut(),
      },
      {
        keys: '0',
        description: 'Fit the diagram',
        section: 'Docs',
        handler: () => this.viewport()?.fit(),
      },
      {
        keys: '1',
        description: 'Diagram at 100 %',
        section: 'Docs',
        handler: () => this.viewport()?.actualSize(),
      },
    ]);
  }

  protected edit(): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { mode: 'edit' },
      queryParamsHandling: 'merge',
    });
  }

  protected copySource(): void {
    void navigator.clipboard
      .writeText(this.doc().content ?? '')
      .then(() => this.toast.success('Mermaid source copied'))
      .catch(() => this.toast.error("Couldn't copy the source"));
  }

  private async render(
    source: { key: string; version: number; content: string | null },
    format: Doc['diagramFormat'],
    theme: 'light' | 'dark',
  ): Promise<void> {
    const generation = ++this.generation;
    if (!source.content?.trim()) {
      this.state.set({ kind: 'empty' });
      return;
    }
    const renderer = format ? DIAGRAM_RENDERERS[format] : undefined;
    if (!renderer) {
      this.state.set({ kind: 'unsupported' });
      return;
    }
    if (this.state().kind !== 'ready') this.state.set({ kind: 'loading' });
    const started = performance.now();
    const rendered = await renderer(source, theme);
    if (generation !== this.generation) return;
    if ('error' in rendered) {
      this.state.set({ kind: 'error', message: rendered.error });
      return;
    }
    this.state.set({ kind: 'ready', content: rendered });
    performance.measure(DIAGRAM_RENDER_MEASURE, { start: started });
  }
}
