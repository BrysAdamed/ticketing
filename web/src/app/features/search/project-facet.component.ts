import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { MatMenuModule } from '@angular/material/menu';
import { ProjectDirectory, ProjectSummary } from '@core/projects/project-directory';
import {
  CAPPED_PROJECTS_HINT,
  injectProjectSearch,
  pickerProjects,
} from '@core/projects/project-search';
import { ProjectTileComponent } from '@shared/ui/domain/project-tile.component';
import { IconComponent } from '@shared/ui/icon/icon.component';

/// The Project filter chip of the ticket and doc search: a menu of checkable projects with a
/// filter box that asks the server once the directory is capped (D-168). Selected projects stay
/// listed even when they are not in the directory.
@Component({
  selector: 'tk-project-facet',
  imports: [MatMenuModule, ProjectTileComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  styleUrl: './filter-chips.scss',
  template: `
    <button
      type="button"
      class="fchip"
      [class.on]="selected().length"
      [matMenuTriggerFor]="projectMenu"
      [attr.data-testid]="testId()"
      (menuOpened)="focusInput(filterInput)"
    >
      @if (selected().length) {
        Project: <b>{{ summary() }}</b>
      } @else {
        <tk-icon name="tablerPlus" [size]="14" />Project
      }
    </button>
    <mat-menu #projectMenu="matMenu" class="tk-filter-menu">
      <div class="minput">
        <input
          #filterInput
          placeholder="Find a project…"
          aria-label="Find a project"
          [attr.data-testid]="testId() + '-input'"
          [value]="term()"
          (click)="$event.stopPropagation()"
          (keydown)="$event.stopPropagation()"
          (input)="term.set(filterInput.value)"
        />
      </div>
      @if (capped() && !term().trim()) {
        <div class="mnote" [attr.data-testid]="testId() + '-capped'">{{ cappedHint }}</div>
      }
      @for (project of options(); track project.key) {
        <button
          mat-menu-item
          type="button"
          [attr.data-testid]="testId() + '-' + project.key"
          (click)="$event.stopPropagation(); toggle(project)"
        >
          <span class="opt"
            ><span class="box" [class.on]="selected().includes(project.key)"></span
            ><tk-project-tile [projectKey]="project.key" />{{ project.name }}</span
          >
        </button>
      } @empty {
        <div class="empty">
          {{
            search.searching() ? 'Searching…' : term().trim() ? 'No projects match' : 'No projects'
          }}
        </div>
      }
    </mat-menu>
  `,
})
export class ProjectFacetComponent {
  private readonly directory = inject(ProjectDirectory);

  /// Selected project keys.
  readonly selected = input.required<readonly string[]>();
  /// Test id of the chip; the menu items use it as their prefix.
  readonly testId = input.required<string>();
  readonly toggled = output<string>();

  protected readonly term = signal('');
  protected readonly search = injectProjectSearch(() => this.term());
  protected readonly capped = this.directory.capped;
  protected readonly cappedHint = CAPPED_PROJECTS_HINT;
  private readonly known = signal<ReadonlyMap<string, ProjectSummary>>(new Map());

  private readonly chosen = computed(() =>
    this.selected().map(
      (key) =>
        this.directory.byKey(key) ??
        this.known().get(key.toUpperCase()) ?? {
          id: key,
          key,
          name: key,
          visibility: 'Public' as const,
          myRole: null,
        },
    ),
  );
  protected readonly options = computed(() =>
    pickerProjects(this.directory.projects(), this.term(), this.search.results(), this.chosen()),
  );
  protected readonly summary = computed(() => {
    const values = this.selected();
    return values.length <= 2 ? values.join(', ') : `${values.length}`;
  });

  constructor() {
    void this.directory.load();
  }

  protected toggle(project: ProjectSummary): void {
    this.known.update((map) => new Map(map).set(project.key, project));
    this.toggled.emit(project.key);
  }

  protected focusInput(input: HTMLInputElement): void {
    setTimeout(() => input.focus());
  }
}
