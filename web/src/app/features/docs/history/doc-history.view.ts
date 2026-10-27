import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { ActivatedRoute, Router } from '@angular/router';
import { provideIcons } from '@ng-icons/core';
import {
  tablerColumns2,
  tablerCursorText,
  tablerGitCompare,
  tablerHistory,
  tablerLayoutRows,
  tablerMessage,
  tablerPaperclip,
  tablerPlus,
  tablerRestore,
  tablerRobot,
  tablerX,
} from '@ng-icons/tabler-icons';
import { docUrl } from '@core/docs/doc-links';
import { DocHistoryItem } from '@core/docs/doc-history.api';
import { Doc, DocVersion } from '@core/docs/doc.models';
import { ToastService } from '@core/notify/toast.service';
import { ShortcutService } from '@core/shortcuts/shortcut.service';
import { RelativeTimePipe, AbsoluteTimePipe } from '@shared/pipes/relative-time.pipe';
import { AvatarComponent } from '@shared/ui/domain/avatar.component';
import { EmptyStateComponent } from '@shared/ui/empty-state/empty-state.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { KbdComponent } from '@shared/ui/kbd/kbd.component';
import {
  SegmentedControlComponent,
  SegmentOption,
} from '@shared/ui/segmented/segmented-control.component';
import { DOCS_ICONS } from '../docs-icons';
import { DiffFold, DiffLine, diffDocs, DocDiff, toSplitRows } from './doc-diff';
import { DocHistoryStore } from './doc-history.store';
import { DocRestoreAction } from './doc-restore';
import { DocVersionContentComponent } from './doc-version-content.component';
import {
  channelLabel,
  comparison,
  describeActivity,
  groupByDay,
  versionParam,
} from './history-items';

type HistoryMode = 'changes' | 'rendered';
type DiffLayout = 'unified' | 'split';

const LAYOUT_STORAGE_KEY = 'tk.docs.diffLayout';
/// Performance entry measured for every diff, read by the e2e budget check.
export const DOC_DIFF_MEASURE = 'tk-doc-diff';

/// Version history (`?history=n[&with=m]`, `docs.history`, a lazy chunk with the diff library):
/// the comparison of two versions as a unified or side-by-side line diff with word highlights
/// (Canvas: both versions rendered side by side) or the selected version rendered, and the history
/// panel merging versions with activity. Click selects a version, Shift+click picks the second
/// one, `Esc` or `H` closes. Writers restore an older version.
@Component({
  selector: 'tk-doc-history-view',
  imports: [
    NgTemplateOutlet,
    MatButtonModule,
    IconComponent,
    AvatarComponent,
    EmptyStateComponent,
    KbdComponent,
    RelativeTimePipe,
    AbsoluteTimePipe,
    SegmentedControlComponent,
    DocVersionContentComponent,
  ],
  providers: [DocHistoryStore, DocRestoreAction],
  viewProviders: [
    provideIcons({
      ...DOCS_ICONS,
      tablerColumns2,
      tablerCursorText,
      tablerGitCompare,
      tablerHistory,
      tablerLayoutRows,
      tablerMessage,
      tablerPaperclip,
      tablerPlus,
      tablerRestore,
      tablerRobot,
      tablerX,
    }),
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-testid': 'view-docs.history' },
  templateUrl: './doc-history.view.html',
  styleUrl: './doc-history.view.scss',
})
export class DocHistoryView {
  protected readonly store = inject(DocHistoryStore);
  private readonly restorer = inject(DocRestoreAction);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  readonly doc = input.required<Doc>();

  private readonly query = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  protected readonly selected = computed(
    () => versionParam(this.query().get('history'), this.doc().version) ?? this.doc().version,
  );
  protected readonly other = computed(() =>
    versionParam(this.query().get('with'), this.doc().version),
  );
  protected readonly compared = computed(() =>
    comparison(this.selected(), this.doc().version, this.other()),
  );
  protected readonly isCanvas = computed(() => this.doc().diagramFormat === 'Canvas');
  private readonly latestVersion = computed(() => this.doc().version);

  protected readonly mode = signal<HistoryMode>('changes');
  protected readonly layout = signal<DiffLayout>(readLayout());
  protected readonly modes: readonly SegmentOption<HistoryMode>[] = [
    { value: 'changes', label: 'Changes' },
    { value: 'rendered', label: 'Rendered' },
  ];
  protected readonly layouts: readonly SegmentOption<DiffLayout>[] = [
    { value: 'unified', icon: 'tablerLayoutRows', ariaLabel: 'Unified diff' },
    { value: 'split', icon: 'tablerColumns2', ariaLabel: 'Side-by-side diff' },
  ];

  protected readonly from = signal<DocVersion | null>(null);
  protected readonly to = signal<DocVersion | null>(null);
  protected readonly selectedVersion = computed(() => {
    const number = this.selected();
    return [this.to(), this.from()].find((v) => v?.number === number) ?? this.to();
  });
  protected readonly versionError = signal(false);
  protected readonly restoring = signal(false);
  protected readonly expanded = signal<ReadonlySet<DiffFold>>(new Set());

  protected readonly diff = computed<DocDiff | null>(() => {
    const to = this.to();
    const from = this.from();
    const { from: fromNumber } = this.compared();
    if (!to || this.isCanvas() || (fromNumber !== null && !from)) return null;
    const start = performance.now();
    const diff = diffDocs(from?.content ?? '', to.content ?? '');
    performance.measure(DOC_DIFF_MEASURE, { start });
    return diff;
  });
  protected readonly splitRows = computed(() => {
    const diff = this.diff();
    return diff && this.layout() === 'split' ? toSplitRows(diff.rows) : [];
  });
  protected readonly titleChange = computed(() => {
    const from = this.from();
    const to = this.to();
    return from && to && from.title !== to.title ? { from: from.title, to: to.title } : null;
  });
  protected readonly canRestore = computed(() =>
    DocRestoreAction.canRestore(this.doc(), this.selected()),
  );

  protected readonly days = computed(() => groupByDay(this.store.items()));
  protected readonly describe = describeActivity;
  protected readonly via = channelLabel;

  constructor() {
    inject(ShortcutService).registerScoped([
      {
        keys: 'escape',
        description: 'Close the history',
        section: 'Docs',
        handler: () => this.close(),
      },
    ]);

    effect(() => {
      const key = this.doc().key;
      this.latestVersion();
      untracked(() => void this.store.load(key));
    });

    effect(() => {
      const key = this.doc().key;
      const { from, to } = this.compared();
      untracked(() => void this.loadVersions(key, from, to));
    });

    effect(() => {
      this.diff();
      untracked(() => this.expanded.set(new Set()));
    });

    effect(() => {
      const layout = this.layout();
      try {
        localStorage.setItem(LAYOUT_STORAGE_KEY, layout);
      } catch {
        return;
      }
    });
  }

  protected isSelected(item: DocHistoryItem): boolean {
    return item.version === this.selected();
  }

  protected isCompared(item: DocHistoryItem): boolean {
    const { from, to } = this.compared();
    return item.version !== this.selected() && (item.version === from || item.version === to);
  }

  protected pick(event: MouseEvent | KeyboardEvent, item: DocHistoryItem): void {
    if (item.version === null) return;
    if (event.shiftKey && item.version !== this.selected())
      this.navigate({ history: this.selected(), with: item.version });
    else this.navigate({ history: item.version, with: null });
  }

  protected onListKeydown(event: KeyboardEvent): void {
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (!step) return;
    const rows = [...this.host.querySelectorAll<HTMLButtonElement>('button.hv')];
    const index = rows.indexOf(document.activeElement as HTMLButtonElement);
    const next = rows[Math.min(Math.max(index + step, 0), rows.length - 1)];
    if (!next) return;
    event.preventDefault();
    next.focus();
    next.click();
  }

  protected expand(fold: DiffFold): void {
    this.expanded.update((set) => new Set([...set, fold]));
  }

  protected lineNo(line: DiffLine): number | null {
    return line.kind === 'del' ? line.oldNo : line.newNo;
  }

  protected async restore(): Promise<void> {
    this.restoring.set(true);
    const restored = await this.restorer.restore(this.doc(), this.selected());
    this.restoring.set(false);
    if (restored) this.navigate({ history: restored.version, with: null });
  }

  protected copyLink(): void {
    const doc = this.doc();
    const url = `${location.origin}${docUrl(doc.key, doc.title)}?v=${this.selected()}`;
    void navigator.clipboard
      .writeText(url)
      .then(() => this.toast.success(`Link to v${this.selected()} copied`))
      .catch(() => this.toast.error("Couldn't copy the link"));
  }

  protected close(): void {
    this.navigate({ history: null, with: null });
  }

  private navigate(params: { history: number | null; with: number | null }): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: params,
      queryParamsHandling: 'merge',
      replaceUrl: params.history !== null,
    });
  }

  private async loadVersions(key: string, from: number | null, to: number): Promise<void> {
    this.versionError.set(false);
    if (this.to()?.number !== to || this.to()?.docKey !== key) this.to.set(null);
    if (this.from()?.number !== from || this.from()?.docKey !== key) this.from.set(null);
    try {
      const [fromVersion, toVersion] = await Promise.all([
        from === null ? Promise.resolve(null) : this.store.version(key, from),
        this.store.version(key, to),
      ]);
      const current = this.compared();
      if (this.doc().key !== key || current.from !== from || current.to !== to) return;
      this.from.set(fromVersion);
      this.to.set(toVersion);
    } catch {
      this.versionError.set(true);
    }
  }
}

function readLayout(): DiffLayout {
  try {
    return localStorage.getItem(LAYOUT_STORAGE_KEY) === 'split' ? 'split' : 'unified';
  } catch {
    return 'unified';
  }
}
