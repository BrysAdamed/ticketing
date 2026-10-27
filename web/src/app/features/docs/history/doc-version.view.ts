import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { provideIcons } from '@ng-icons/core';
import { tablerGitCompare, tablerHistory, tablerRestore } from '@ng-icons/tabler-icons';
import { firstValueFrom, map } from 'rxjs';
import { ApiError, toApiError } from '@core/api/api-error';
import { Doc, DocVersion } from '@core/docs/doc.models';
import { DocsApi } from '@core/docs/docs.api';
import { AbsoluteTimePipe, RelativeTimePipe } from '@shared/pipes/relative-time.pipe';
import { EmptyStateComponent } from '@shared/ui/empty-state/empty-state.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { DocRestoreAction } from './doc-restore';
import { DocVersionContentComponent } from './doc-version-content.component';
import { channelLabel } from './history-items';

/// One older version rendered (`?v=n`, `docs.version`): the banner "You are viewing v3 of 7 ·
/// Back to latest" with Compare and Restore (writers), the version's author, time and note, and
/// its content read-only.
@Component({
  selector: 'tk-doc-version-view',
  imports: [
    RouterLink,
    MatButtonModule,
    IconComponent,
    EmptyStateComponent,
    RelativeTimePipe,
    AbsoluteTimePipe,
    DocVersionContentComponent,
  ],
  providers: [DocRestoreAction],
  viewProviders: [provideIcons({ tablerGitCompare, tablerHistory, tablerRestore })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-testid': 'view-docs.version' },
  template: `
    @let page = doc();
    <article class="pbody">
      <div class="banner" role="status" data-testid="doc-version-banner">
        <tk-icon name="tablerHistory" [size]="16" />
        <span class="msg"
          >You are viewing <b>v{{ number() }}</b> of {{ page.version }}<span class="dot">·</span
          ><a [routerLink]="[]" [queryParams]="{ v: null }" queryParamsHandling="merge"
            >Back to latest</a
          ></span
        >
        <a
          mat-button
          [routerLink]="[]"
          [queryParams]="{ v: null, history: number() }"
          queryParamsHandling="merge"
          data-testid="doc-version-compare"
          ><tk-icon name="tablerGitCompare" [size]="16" />Compare with current</a
        >
        @if (canRestore()) {
          <button
            mat-stroked-button
            type="button"
            data-testid="doc-version-restore"
            [disabled]="restoring()"
            (click)="restore()"
          >
            <tk-icon name="tablerRestore" [size]="16" />Restore this version
          </button>
        }
      </div>
      @if (version(); as shown) {
        <div class="vmeta" data-testid="doc-version-meta">
          <span class="tnum">v{{ shown.number }}</span>
          <span class="dot">·</span>
          <span [title]="shown.createdAt | absoluteTime"
            >{{ shown.author.displayName }}, {{ shown.createdAt | relativeTime }}</span
          >
          @if (channel(shown); as via) {
            <span class="dot">·</span><span>{{ via }}</span>
          }
          @if (shown.restoredFrom) {
            <span class="dot">·</span><span>Restored from v{{ shown.restoredFrom }}</span>
          }
          @if (shown.changeNote) {
            <span class="dot">·</span><span class="note">{{ shown.changeNote }}</span>
          }
        </div>
        <tk-doc-version-content [doc]="page" [version]="shown" />
      } @else if (error(); as failure) {
        <tk-empty-state
          icon="tablerHistory"
          [title]="failure.isNotFound ? 'This version does not exist' : loadErrorTitle"
          [description]="failure.isNotFound ? null : failure.title"
          data-testid="doc-version-error"
        >
          <a
            mat-stroked-button
            [routerLink]="[]"
            [queryParams]="{ v: null }"
            queryParamsHandling="merge"
            >Back to latest</a
          >
        </tk-empty-state>
      } @else {
        <div class="skeleton" role="status" aria-label="Loading the version">
          <span class="sk sk-title"></span>
          @for (width of lines; track $index) {
            <span class="sk" [style.width.%]="width"></span>
          }
        </div>
      }
    </article>
  `,
  styleUrl: './doc-version.view.scss',
})
export class DocVersionView {
  private readonly api = inject(DocsApi);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly restorer = inject(DocRestoreAction);

  readonly doc = input.required<Doc>();

  private readonly param = toSignal(this.route.queryParamMap.pipe(map((q) => q.get('v'))), {
    initialValue: null,
  });
  protected readonly number = computed(() => Number(this.param()) || 0);
  protected readonly version = signal<DocVersion | null>(null);
  protected readonly error = signal<ApiError | null>(null);
  protected readonly restoring = signal(false);
  protected readonly lines = [96, 88, 62, 91, 74];
  protected readonly loadErrorTitle = "Couldn't load this version";
  protected readonly canRestore = computed(() =>
    DocRestoreAction.canRestore(this.doc(), this.number()),
  );
  protected readonly channel = (version: DocVersion) => channelLabel(version.channel);

  constructor() {
    effect(() => {
      const key = this.doc().key;
      const number = this.number();
      untracked(() => void this.load(key, number));
    });
  }

  protected async restore(): Promise<void> {
    this.restoring.set(true);
    const restored = await this.restorer.restore(this.doc(), this.number());
    this.restoring.set(false);
    if (restored)
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { v: null },
        queryParamsHandling: 'merge',
      });
  }

  private async load(key: string, number: number): Promise<void> {
    if (this.version()?.docKey === key && this.version()?.number === number) return;
    this.version.set(null);
    this.error.set(null);
    try {
      const version = await firstValueFrom(this.api.version(key, number));
      if (this.number() === number) this.version.set(version);
    } catch (error) {
      if (this.number() === number) this.error.set(toApiError(error));
    }
  }
}
