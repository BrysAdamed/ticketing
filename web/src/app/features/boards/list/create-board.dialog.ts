import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { toApiError } from '@core/api/api-error';
import { Board, NewBoard } from '@core/boards/board.models';
import {
  MAX_LISTED_PROJECTS,
  ProjectDirectory,
  ProjectSummary,
} from '@core/projects/project-directory';
import { injectProjectSearch } from '@core/projects/project-search';
import { ProjectTileComponent } from '@shared/ui/domain/project-tile.component';
import { IconComponent } from '@shared/ui/icon/icon.component';

export interface CreateBoardDialogData {
  create: (board: NewBoard, idempotencyKey: string) => Promise<Board>;
  /// Suggested values (the "Your first project" walkthrough); the user can change them.
  name?: string;
  projectKeys?: readonly string[];
}

const MAX_PROJECTS = 20;

function canWrite(project: ProjectSummary): boolean {
  return !project.archivedAt && (project.myRole === 'Owner' || project.myRole === 'Member');
}

/// New board: a name, an optional description and 1..20 projects the user can write to.
@Component({
  selector: 'tk-create-board-dialog',
  imports: [
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    ProjectTileComponent,
    IconComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    'data-testid': 'create-board-dialog',
    '(keydown.control.enter)': 'submit()',
    '(keydown.meta.enter)': 'submit()',
  },
  template: `
    <h2 mat-dialog-title>New board</h2>
    <mat-dialog-content>
      <label class="tk-field-label" for="new-board-name">Name</label>
      <mat-form-field>
        <input
          matInput
          id="new-board-name"
          maxlength="100"
          placeholder="Sprint 42"
          data-testid="create-board-name"
          [value]="name()"
          (input)="name.set($any($event.target).value)"
        />
      </mat-form-field>
      <label class="tk-field-label" for="new-board-description">Description</label>
      <mat-form-field>
        <textarea
          matInput
          id="new-board-description"
          rows="2"
          maxlength="2000"
          placeholder="Goal, dates, team"
          data-testid="create-board-description"
          [value]="description()"
          (input)="description.set($any($event.target).value)"
        ></textarea>
      </mat-form-field>
      <span class="tk-field-label"
        >Projects <span class="muted tnum">{{ selected().size }} / {{ maxProjects }}</span></span
      >
      <input
        class="filter"
        type="search"
        placeholder="Filter projects"
        aria-label="Filter projects"
        data-testid="create-board-project-filter"
        [value]="filter()"
        (input)="filter.set($any($event.target).value)"
      />
      @if (capped() && !filter().trim()) {
        <div class="muted capped" data-testid="create-board-projects-capped">
          Showing the first {{ listedProjects }} projects, type to search
        </div>
      }
      <div class="projects" role="group" aria-label="Projects">
        @for (project of visibleProjects(); track project.id) {
          <button
            type="button"
            class="project"
            [class.on]="selected().has(project.key)"
            [attr.aria-pressed]="selected().has(project.key)"
            [attr.data-testid]="'create-board-project-' + project.key"
            [disabled]="!selected().has(project.key) && selected().size >= maxProjects"
            (click)="toggle(project)"
          >
            <span class="box" [class.on]="selected().has(project.key)">
              @if (selected().has(project.key)) {
                <tk-icon name="tablerCheck" [size]="12" />
              }
            </span>
            <tk-project-tile [projectKey]="project.key" />
            <span class="pname">{{ project.name }}</span>
            <span class="muted">{{ project.key }}</span>
          </button>
        } @empty {
          @if (filter().trim()) {
            <div class="muted empty">
              {{ search.searching() ? 'Searching…' : 'No projects match.' }}
            </div>
          } @else {
            <div class="muted empty">
              You need write access to at least one project to create a board.
            </div>
          }
        }
      </div>
      @if (error(); as message) {
        <div class="tk-callout tk-callout-danger" role="alert">{{ message }}</div>
      }
    </mat-dialog-content>
    <mat-dialog-actions>
      <button mat-button type="button" mat-dialog-close>Cancel</button>
      <button
        mat-flat-button
        type="button"
        data-testid="create-board-submit"
        [disabled]="!valid() || busy()"
        (click)="submit()"
      >
        Create board
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    mat-form-field {
      width: 100%;
    }
    .filter {
      width: 100%;
      height: 28px;
      margin-bottom: 6px;
      padding: 0 8px;
      border: 1px solid var(--tk-border-input);
      border-radius: var(--tk-radius-sm);
      background: var(--tk-bg);
      color: var(--tk-text);
      font: inherit;
    }
    .projects {
      max-height: 240px;
      overflow: auto;
      border: 1px solid var(--tk-border-subtle);
      border-radius: var(--tk-radius-md);
      margin-bottom: 12px;
    }
    .project {
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
    .project:hover:not(:disabled) {
      background: var(--tk-bg-hover);
    }
    .project.on {
      background: var(--tk-selection);
    }
    .project:disabled {
      opacity: 0.5;
      cursor: default;
    }
    .pname {
      flex: 1;
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
    .muted {
      color: var(--tk-text-subtle);
      font-weight: var(--tk-weight-regular);
    }
    .empty {
      padding: 12px;
    }
    .capped {
      margin-bottom: 6px;
      font-size: var(--tk-text-sm);
    }
  `,
})
export class CreateBoardDialog {
  private readonly data = inject<CreateBoardDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject<MatDialogRef<CreateBoardDialog, Board>>(MatDialogRef);
  private readonly directory = inject(ProjectDirectory);
  private readonly idempotencyKey = crypto.randomUUID();

  protected readonly maxProjects = MAX_PROJECTS;
  protected readonly name = signal(this.data.name ?? '');
  protected readonly description = signal('');
  protected readonly selected = signal<ReadonlySet<string>>(new Set(this.data.projectKeys ?? []));
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly filter = signal('');
  protected readonly search = injectProjectSearch(() => this.filter());
  protected readonly capped = this.directory.capped;
  protected readonly listedProjects = MAX_LISTED_PROJECTS;
  private readonly picked = signal<ReadonlyMap<string, ProjectSummary>>(new Map());
  protected readonly projects = computed(() => this.directory.activeProjects().filter(canWrite));
  protected readonly visibleProjects = computed(() => {
    const term = this.filter().trim().toLowerCase();
    const selected = this.selected();
    const source = term ? (this.search.results() ?? this.projects()) : this.projects();
    const shown = term
      ? source.filter(
          (p) =>
            canWrite(p) &&
            (selected.has(p.key) ||
              p.key.toLowerCase().includes(term) ||
              p.name.toLowerCase().includes(term)),
        )
      : source;
    const keys = new Set(shown.map((p) => p.key));
    const extra = [...this.picked().values()].filter(
      (p) => selected.has(p.key) && !keys.has(p.key),
    );
    return [...extra, ...shown];
  });
  protected readonly valid = computed(
    () => this.name().trim().length > 0 && this.selected().size > 0,
  );

  constructor() {
    void this.directory.load().then(() => this.resolveSuggestedProjects());
  }

  protected toggle(project: ProjectSummary): void {
    const on = !this.selected().has(project.key);
    this.selected.update((set) => {
      const next = new Set(set);
      if (on) next.add(project.key);
      else next.delete(project.key);
      return next;
    });
    this.picked.update((map) => {
      const next = new Map(map);
      if (on) next.set(project.key, project);
      else next.delete(project.key);
      return next;
    });
  }

  private async resolveSuggestedProjects(): Promise<void> {
    const missing = [...this.selected()].filter((key) => !this.directory.byKey(key));
    if (!missing.length || !this.directory.capped()) return;
    const found = await Promise.all(
      missing.map((key) =>
        this.directory
          .search(key)
          .then((items) => items.find((p) => p.key === key))
          .catch(() => undefined),
      ),
    );
    this.picked.update((map) => {
      const next = new Map(map);
      for (const project of found) if (project) next.set(project.key, project);
      return next;
    });
  }

  protected async submit(): Promise<void> {
    if (!this.valid() || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const board = await this.data.create(
        {
          name: this.name().trim(),
          description: this.description().trim() || null,
          projectKeys: [...this.selected()],
        },
        this.idempotencyKey,
      );
      this.ref.close(board);
    } catch (error) {
      const apiError = toApiError(error);
      this.error.set(
        apiError.fieldError('name') ?? apiError.fieldError('projectKeys') ?? apiError.title,
      );
    } finally {
      this.busy.set(false);
    }
  }
}
