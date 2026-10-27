import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { toApiError } from '@core/api/api-error';
import { BoardProject } from '@core/boards/board.models';
import { BacklogItem, UserRef } from '@core/tickets/ticket.models';
import { TicketsApi } from '@core/tickets/tickets.api';
import { AvatarComponent } from '@shared/ui/domain/avatar.component';
import { PriorityIconComponent } from '@shared/ui/domain/priority-icon.component';
import { ProjectTileComponent } from '@shared/ui/domain/project-tile.component';
import { StatusIconComponent } from '@shared/ui/domain/status-icon.component';
import { TypeIconComponent } from '@shared/ui/domain/type-icon.component';
import { IconComponent } from '@shared/ui/icon/icon.component';

export interface AddTicketsDialogData {
  boardName: string;
  projects: BoardProject[];
  /// Moves the picked tickets onto the board (`childCounts` per key, from the backlog rows); the
  /// dialog closes when it resolves true.
  add: (keys: string[], childCounts: number[]) => Promise<boolean>;
}

const SEARCH_DEBOUNCE_MS = 200;
const MAX_SHOWN = 200;

/// "Add tickets from backlog": search a linked project's backlog, pick several tickets (also across
/// projects) and move them onto the board in one call, in backlog order.
@Component({
  selector: 'tk-add-tickets-dialog',
  imports: [
    MatButtonModule,
    MatDialogModule,
    AvatarComponent,
    PriorityIconComponent,
    ProjectTileComponent,
    StatusIconComponent,
    TypeIconComponent,
    IconComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-testid': 'add-tickets-dialog' },
  template: `
    <h2 mat-dialog-title>Add tickets to {{ data.boardName }}</h2>
    <mat-dialog-content>
      @if (data.projects.length > 1) {
        <div class="projects" role="tablist" aria-label="Project">
          @for (project of data.projects; track project.id) {
            <button
              type="button"
              role="tab"
              class="ptab"
              [class.on]="project.key === projectKey()"
              [attr.aria-selected]="project.key === projectKey()"
              [attr.data-testid]="'add-tickets-project-' + project.key"
              (click)="projectKey.set(project.key)"
            >
              <tk-project-tile [projectKey]="project.key" />{{ project.name }}
            </button>
          }
        </div>
      }
      <label class="search">
        <tk-icon name="tablerSearch" [size]="14" />
        <input
          type="search"
          placeholder="Search the backlog by title or key"
          aria-label="Search the backlog"
          data-testid="add-tickets-search"
          [value]="text()"
          (input)="onSearch($any($event.target).value)"
        />
      </label>
      <div class="list" role="listbox" aria-multiselectable="true" aria-label="Backlog tickets">
        @if (status() === 'loading' && items().length === 0) {
          @for (i of [0, 1, 2, 3, 4]; track i) {
            <div class="row sk"><span class="bar"></span></div>
          }
        } @else if (status() === 'error') {
          <div class="note danger">{{ error() }}</div>
        } @else {
          @for (item of shown(); track item.id) {
            <button
              type="button"
              role="option"
              class="row"
              [class.on]="selected().has(item.key)"
              [attr.aria-selected]="selected().has(item.key)"
              [attr.data-testid]="'add-tickets-row-' + item.key"
              (click)="toggle(item.key)"
            >
              <span class="box" [class.on]="selected().has(item.key)">
                @if (selected().has(item.key)) {
                  <tk-icon name="tablerCheck" [size]="12" />
                }
              </span>
              <tk-priority-icon [priority]="item.priority" />
              <span class="key tnum">{{ item.key }}</span>
              <tk-type-icon [type]="item.type" [size]="14" />
              <tk-status-icon [status]="item.status" />
              <span class="title">{{ item.title }}</span>
              @if (item.assigneeId && users().get(item.assigneeId); as user) {
                <tk-avatar [userId]="user.id" [name]="user.displayName" />
              }
            </button>
          } @empty {
            <div class="note">
              {{ text() ? 'No backlog tickets match.' : 'This backlog is empty.' }}
            </div>
          }
          @if (items().length > shown().length) {
            <div class="note">
              Showing the first {{ shown().length }} of {{ items().length }}. Search to narrow down.
            </div>
          }
        }
      </div>
    </mat-dialog-content>
    <mat-dialog-actions>
      <span class="count tnum">{{ selected().size }} selected</span>
      <button mat-button type="button" mat-dialog-close>Cancel</button>
      <button
        mat-flat-button
        type="button"
        data-testid="add-tickets-submit"
        [disabled]="selected().size === 0 || busy()"
        (click)="submit()"
      >
        Add {{ selected().size || '' }} {{ selected().size === 1 ? 'ticket' : 'tickets' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .projects {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-bottom: 8px;
    }
    .ptab {
      height: 26px;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 0 10px 0 6px;
      border: 1px solid var(--tk-border);
      border-radius: var(--tk-radius-full);
      background: none;
      color: var(--tk-text-muted);
      font: inherit;
      font-size: var(--tk-text-sm);
      cursor: pointer;
    }
    .ptab.on {
      border-color: var(--tk-accent-border);
      background: var(--tk-accent-subtle);
      color: var(--tk-accent-fg);
    }
    .search {
      height: 32px;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 0 10px;
      border: 1px solid var(--tk-border-input);
      border-radius: var(--tk-radius-md);
      color: var(--tk-text-subtle);
      background: var(--tk-surface);
    }
    .search:focus-within {
      border-color: var(--tk-accent);
    }
    .search input {
      flex: 1;
      border: 0;
      outline: 0;
      background: none;
      color: var(--tk-text);
      font: inherit;
    }
    .list {
      margin-top: 8px;
      height: 360px;
      overflow: auto;
      border: 1px solid var(--tk-border-subtle);
      border-radius: var(--tk-radius-md);
    }
    .row {
      width: 100%;
      height: 32px;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 0 10px;
      border: 0;
      border-bottom: 1px solid var(--tk-border-subtle);
      background: none;
      color: var(--tk-text);
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    .row:hover {
      background: var(--tk-bg-hover);
    }
    .row.on {
      background: var(--tk-selection);
    }
    .row.sk .bar {
      height: 10px;
      width: 60%;
      border-radius: var(--tk-radius-sm);
      background: var(--tk-bg-muted);
    }
    .key {
      width: 64px;
      color: var(--tk-text-muted);
      font-size: var(--tk-text-sm);
      flex: none;
    }
    .title {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .box {
      width: 14px;
      height: 14px;
      display: grid;
      place-items: center;
      flex: none;
      border: 1px solid var(--tk-border-input-hover);
      border-radius: var(--tk-radius-xs);
      color: #fff;
    }
    .box.on {
      background: var(--tk-accent);
      border-color: var(--tk-accent);
    }
    .note {
      padding: 12px;
      color: var(--tk-text-subtle);
    }
    .note.danger {
      color: var(--tk-danger-fg, var(--tk-text));
    }
    .count {
      margin-right: auto;
      color: var(--tk-text-muted);
      font-size: var(--tk-text-sm);
    }
  `,
})
export class AddTicketsDialog {
  protected readonly data = inject<AddTicketsDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject<MatDialogRef<AddTicketsDialog, string[]>>(MatDialogRef);
  private readonly tickets = inject(TicketsApi);

  protected readonly projectKey = signal(this.data.projects[0]?.key ?? '');
  protected readonly text = signal('');
  protected readonly items = signal<readonly BacklogItem[]>([]);
  protected readonly users = signal<ReadonlyMap<string, UserRef>>(new Map());
  protected readonly status = signal<'loading' | 'loaded' | 'error'>('loading');
  protected readonly error = signal<string | null>(null);
  protected readonly selected = signal<ReadonlySet<string>>(new Set());
  protected readonly busy = signal(false);
  protected readonly shown = computed(() => this.items().slice(0, MAX_SHOWN));

  private readonly order = new Map<string, number>();
  private readonly childCounts = new Map<string, number>();
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private loadToken = 0;

  constructor() {
    effect(() => {
      const projectKey = this.projectKey();
      const text = this.text();
      untracked(() => void this.load(projectKey, text));
    });
    inject(DestroyRef).onDestroy(() => {
      if (this.searchTimer) clearTimeout(this.searchTimer);
    });
  }

  protected onSearch(value: string): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.text.set(value.trim()), SEARCH_DEBOUNCE_MS);
  }

  protected toggle(key: string): void {
    this.selected.update((set) => {
      const next = new Set(set);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  protected async submit(): Promise<void> {
    const keys = [...this.selected()].sort(
      (a, b) => (this.order.get(a) ?? 0) - (this.order.get(b) ?? 0),
    );
    this.busy.set(true);
    const childCounts = keys.map((key) => this.childCounts.get(key) ?? 0);
    const added = await this.data.add(keys, childCounts);
    this.busy.set(false);
    if (added) this.ref.close(keys);
  }

  private async load(projectKey: string, text: string): Promise<void> {
    if (!projectKey) return;
    const token = ++this.loadToken;
    this.status.set('loading');
    try {
      const backlog = await firstValueFrom(
        this.tickets.backlog(projectKey, { text: text || null }),
      );
      if (token !== this.loadToken) return;
      backlog.items.forEach((item, index) => {
        this.order.set(item.key, index);
        this.childCounts.set(item.key, item.childCount);
      });
      this.items.set(backlog.items);
      this.users.set(new Map(backlog.users.map((u) => [u.id, u])));
      this.status.set('loaded');
    } catch (error) {
      if (token !== this.loadToken) return;
      this.error.set(toApiError(error).title);
      this.status.set('error');
    }
  }
}
