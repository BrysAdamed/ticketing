import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  viewChildren,
} from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { ThemeService } from '@core/theme/theme.service';
import { CanvasEditorComponent } from '@shared/diagrams/canvas/canvas-editor.component';
import { loadExcalidraw } from '@shared/diagrams/canvas/excalidraw-loader';
import { exportCanvasSourceSvg } from '@shared/diagrams/canvas/canvas-export';
import { loadMermaid, renderMermaid } from '@shared/diagrams/mermaid/mermaid-renderer';
import { mermaidConfig } from '@shared/diagrams/mermaid/mermaid-config';
import {
  MERMAID_SECURITY_SAMPLES,
  unsafeSvgFindings,
} from '@shared/diagrams/mermaid/mermaid-security.samples';

const STORAGE_KEY = 'tk-spike-canvas';

const DIAGRAMS: Record<string, string> = {
  flowchart: [
    'flowchart LR',
    '  SPA[Angular SPA] -->|REST| API[Ticketing API]',
    '  API --> DB[(PostgreSQL)]',
    '  API -->|multipart| PDF[Gotenberg]',
    '  subgraph render [internal network]',
    '    PDF',
    '  end',
  ].join('\n'),
  sequence: [
    'sequenceDiagram',
    '  actor U as User',
    '  U->>SPA: Export PDF',
    '  SPA->>API: GET /docs/TKT-D-1/export.pdf',
    '  API->>Gotenberg: POST bundle',
    '  Gotenberg-->>API: application/pdf',
    '  API-->>U: download',
  ].join('\n'),
  er: ['erDiagram', '  PROJECT ||--o{ DOC_NODE : owns', '  DOC_NODE ||--o{ DOC_VERSION : has'].join(
    '\n',
  ),
};

interface MermaidCase {
  name: string;
  svg: SafeHtmlValue | null;
  error: string | null;
  findings: string[];
  rawFindings: string[];
  ms: number;
}

type SafeHtmlValue = ReturnType<DomSanitizer['bypassSecurityTrustHtml']>;

@Component({
  selector: 'tk-diagrams-spike',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CanvasEditorComponent],
  template: `
    <header>
      <h1>TKT-11 diagrams spike</h1>
      <button type="button" data-testid="toggle-theme" (click)="theme.toggle()">
        Theme: {{ theme.theme() }}
      </button>
      <button type="button" data-testid="render-flowchart" (click)="renderAll(['flowchart'])">
        Flowchart
      </button>
      <button type="button" data-testid="render-mermaid" (click)="renderAll()">
        Render Mermaid
      </button>
      <button type="button" data-testid="open-canvas" (click)="canvasOn.set(true)">
        Open canvas
      </button>
    </header>

    <section>
      <h2>Mermaid</h2>
      @for (item of mermaid(); track item.name) {
        <article [attr.data-testid]="'mermaid-' + item.name">
          <h3>
            {{ item.name }} · {{ item.ms }} ms · findings: {{ item.findings.length }} (raw
            {{ item.rawFindings.length }})
          </h3>
          @if (item.svg) {
            <div class="figure" [innerHTML]="item.svg"></div>
          }
          @if (item.error) {
            <pre class="error">{{ item.error }}</pre>
          }
          @if (item.rawFindings.length) {
            <pre class="raw">raw: {{ item.rawFindings.join(', ') }}</pre>
          }
        </article>
      }
    </section>

    @if (canvasOn()) {
      <section>
        <h2>Canvas</h2>
        <div class="toolbar">
          <button type="button" data-testid="canvas-sample" (click)="loadSample()">
            Load sample
          </button>
          <button type="button" data-testid="canvas-save" (click)="save()">Save</button>
          <button type="button" data-testid="canvas-load" (click)="loadSaved()">Load saved</button>
          <label
            ><input type="checkbox" [checked]="readOnly()" (change)="readOnly.set(!readOnly())" />
            read-only</label
          >
          <span data-testid="canvas-status">{{ status() }}</span>
        </div>
        <tk-canvas-editor
          class="editor"
          [source]="source()"
          [theme]="theme.theme()"
          [readOnly]="readOnly()"
          (changed)="changes.set(changes() + 1)"
        />
        <p>changes: {{ changes() }}</p>
        @if (snapshotUrl()) {
          <h3>Snapshot (img, light; CSS-inverted in dark)</h3>
          <img
            class="snapshot"
            [class.dark]="theme.theme() === 'dark'"
            [src]="snapshotUrl()"
            alt="Canvas snapshot"
            data-testid="canvas-snapshot"
          />
          <h3>Read-only island</h3>
          <tk-canvas-editor
            class="embed"
            [source]="savedSource()"
            [theme]="theme.theme()"
            [readOnly]="true"
          />
        }
        <textarea readonly data-testid="canvas-json">{{ savedSource() }}</textarea>
      </section>
    }
  `,
  styles: `
    :host {
      display: block;
      padding: 16px;
      background: var(--tk-bg);
      color: var(--tk-text);
      min-height: 100vh;
    }
    header,
    .toolbar {
      display: flex;
      gap: 8px;
      align-items: center;
    }
    article {
      border: 1px solid var(--tk-border);
      margin: 8px 0;
      padding: 8px;
    }
    .error {
      color: var(--tk-red-fg);
    }
    .editor {
      height: 520px;
      border: 1px solid var(--tk-border);
    }
    .embed {
      height: 300px;
      border: 1px solid var(--tk-border);
    }
    .snapshot {
      max-width: 100%;
      border: 1px solid var(--tk-border);
    }
    .snapshot.dark {
      filter: invert(93%) hue-rotate(180deg);
    }
    textarea {
      width: 100%;
      height: 120px;
    }
  `,
})
export class DiagramsSpikeView {
  private readonly sanitizer = inject(DomSanitizer);
  protected readonly theme = inject(ThemeService);
  private readonly editors = viewChildren(CanvasEditorComponent);
  private editor = () => this.editors()[0];

  protected readonly mermaid = signal<MermaidCase[]>([]);
  protected readonly source = signal<string | null>(null);
  protected readonly savedSource = signal<string | null>(null);
  protected readonly snapshot = signal<string | null>(null);
  protected readonly readOnly = signal(false);
  protected readonly canvasOn = signal(false);
  protected readonly changes = signal(0);
  protected readonly status = signal('');
  protected readonly snapshotUrl = computed(() => {
    const svg = this.snapshot();
    return svg ? this.sanitizer.bypassSecurityTrustUrl(svgDataUrl(svg)) : null;
  });

  constructor() {
    (window as unknown as Record<string, unknown>)['tkSpike'] = this;
  }

  async renderAll(only?: string[]): Promise<void> {
    const theme = this.theme.theme();
    const cases: MermaidCase[] = [];
    const all = { ...DIAGRAMS, ...MERMAID_SECURITY_SAMPLES };
    for (const [name, source] of Object.entries(all).filter(([n]) => !only || only.includes(n))) {
      const started = performance.now();
      const result = await renderMermaid(source, theme);
      const ms = Math.round(performance.now() - started);
      cases.push({
        name,
        ms,
        svg: result.svg ? this.sanitizer.bypassSecurityTrustHtml(result.svg) : null,
        error: result.error ?? null,
        findings: result.svg ? unsafeSvgFindings(result.svg) : [],
        rawFindings: await rawFindings(source, theme),
      });
    }
    this.mermaid.set(cases);
  }

  async loadSample(): Promise<void> {
    this.source.set(await sampleScene());
  }

  async save(): Promise<void> {
    const started = performance.now();
    const json = this.editor().serialize();
    const svg = await this.editor().exportSvg();
    const ms = Math.round(performance.now() - started);
    localStorage.setItem(STORAGE_KEY, json);
    this.savedSource.set(json);
    this.snapshot.set(svg);
    this.status.set(`saved: json ${json.length} B, svg ${svg.length} B, ${ms} ms`);
  }

  loadSaved(): void {
    this.source.set(localStorage.getItem(STORAGE_KEY));
  }

  exportStored(source: string): Promise<string> {
    return exportCanvasSourceSvg(source);
  }
}

async function rawFindings(source: string, theme: 'light' | 'dark'): Promise<string[]> {
  const mermaid = await loadMermaid();
  mermaid.initialize(mermaidConfig(theme));
  try {
    const { svg } = await mermaid.render(`raw-${Math.random().toString(36).slice(2)}`, source);
    return unsafeSvgFindings(svg);
  } catch {
    return [];
  }
}

function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

async function sampleScene(): Promise<string> {
  const { excalidraw } = await loadExcalidraw();
  const elements = excalidraw.convertToExcalidrawElements([
    {
      type: 'rectangle',
      id: 'api',
      x: 0,
      y: 0,
      width: 180,
      height: 80,
      label: { text: 'API' },
    },
    {
      type: 'ellipse',
      id: 'db',
      x: 360,
      y: 0,
      width: 180,
      height: 80,
      label: { text: 'DB' },
    },
    {
      type: 'diamond',
      id: 'pdf',
      x: 180,
      y: 200,
      width: 180,
      height: 100,
      label: { text: 'Gotenberg' },
    },
    {
      type: 'arrow',
      x: 180,
      y: 40,
      width: 180,
      height: 0,
      start: { id: 'api' },
      end: { id: 'db' },
      label: { text: 'SQL' },
    },
    {
      type: 'arrow',
      x: 90,
      y: 80,
      width: 120,
      height: 120,
      start: { id: 'api' },
      end: { id: 'pdf' },
    },
    { type: 'text', x: 0, y: 340, text: 'Free note: renderer has no egress' },
  ] as never);
  const freedraw = {
    type: 'freedraw',
    id: 'scribble',
    x: 420,
    y: 220,
    width: 120,
    height: 60,
    angle: 0,
    strokeColor: '#e03131',
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: 2,
    strokeStyle: 'solid',
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: 1,
    version: 1,
    versionNonce: 1,
    isDeleted: false,
    boundElements: null,
    updated: 1,
    link: null,
    locked: false,
    points: [
      [0, 0],
      [20, 30],
      [40, 10],
      [60, 50],
      [80, 0],
      [100, 40],
      [120, 20],
    ],
    pressures: [],
    simulatePressure: true,
    lastCommittedPoint: null,
  };
  return excalidraw.serializeAsJSON(
    [...elements, freedraw] as never,
    { viewBackgroundColor: '#ffffff' },
    {},
    'database',
  );
}
