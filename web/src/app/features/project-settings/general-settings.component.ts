import { ChangeDetectionStrategy, Component, computed, inject, linkedSignal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { toApiError } from '@core/api/api-error';
import { ToastService } from '@core/notify/toast.service';
import { TourAnchorDirective } from '@core/onboarding/engine/tour-anchor.directive';
import { ProjectVisibility } from '@shared/domain/enums';
import { MarkdownEditorComponent } from '@shared/markdown/markdown-editor.component';
import { MarkdownViewerComponent } from '@shared/markdown/markdown-viewer.component';
import { VisibilityCardsComponent } from '@shared/ui/domain/visibility-cards.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { GeneralSettings, ProjectSettingsStore } from './project-settings.store';

const NAME_MAX_LENGTH = 100;
const DESCRIPTION_MAX_LENGTH = 10_000;

@Component({
  selector: 'tk-general-settings',
  imports: [
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MarkdownEditorComponent,
    MarkdownViewerComponent,
    VisibilityCardsComponent,
    IconComponent,
    TourAnchorDirective,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './settings-section.scss',
  host: { class: 'settings-section', 'data-testid': 'settings-general' },
  template: `
    <div class="section-head">
      <h2>General</h2>
      @if (!store.canManage()) {
        <span class="tk-subtle">
          {{
            store.isArchived()
              ? 'Archived projects are read-only.'
              : 'Only owners can change these settings.'
          }}
        </span>
      }
    </div>
    <form class="form" novalidate (submit)="$event.preventDefault(); save()">
      <div class="field">
        <label class="tk-field-label" for="settings-name">Name</label>
        <mat-form-field>
          <input
            matInput
            id="settings-name"
            autocomplete="off"
            data-testid="settings-name"
            [attr.maxlength]="nameMax"
            [value]="name()"
            [disabled]="!store.canManage()"
            (input)="name.set($any($event.target).value)"
          />
        </mat-form-field>
        @if (nameError(); as message) {
          <div class="error" data-testid="settings-name-error">{{ message }}</div>
        }
      </div>
      <div class="field">
        <span class="tk-field-label">Description</span>
        @if (store.canManage()) {
          <tk-markdown-editor
            data-testid="settings-description"
            ariaLabel="Project description"
            placeholder="What is this project about? Markdown is supported."
            submitHint="to save"
            [maxLength]="descriptionMax"
            [(value)]="description"
            (submitted)="save()"
          />
        } @else {
          <div class="readonly-description">
            @if (store.project()?.description; as description) {
              <tk-markdown [source]="description" />
            } @else {
              <span class="tk-subtle">No description.</span>
            }
          </div>
        }
      </div>
      <div class="field" tkTourAnchor="project-settings.visibility">
        <span class="tk-field-label" id="settings-visibility">Visibility</span>
        <tk-visibility-cards
          labelledBy="settings-visibility"
          [disabled]="!store.canManage()"
          [value]="visibility()"
          (valueChange)="visibility.set($event)"
        />
        @if (visibility() !== store.project()?.visibility) {
          <div class="tk-callout tk-callout-warning note" data-testid="settings-visibility-warning">
            <tk-icon name="tablerAlertTriangle" [size]="16" />
            <span>
              @if (visibility() === 'Public') {
                Everyone signed in will be able to see this project and create or edit its tickets.
                Viewer memberships stop limiting access while the project is public.
              } @else {
                Only members will see this project. Its tickets disappear from shared boards for
                everyone else.
              }
            </span>
          </div>
        }
      </div>
      @if (store.canManage()) {
        <div class="actions">
          <button
            mat-button
            type="button"
            [disabled]="!dirty() || store.savingGeneral()"
            (click)="reset()"
          >
            Reset
          </button>
          <button
            mat-flat-button
            type="submit"
            data-testid="settings-save"
            [disabled]="!dirty() || !!nameError() || store.savingGeneral()"
          >
            {{ store.savingGeneral() ? 'Saving…' : 'Save changes' }}
          </button>
        </div>
      }
    </form>
  `,
  styles: `
    .form {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .field mat-form-field {
      width: 100%;
    }
    .error {
      margin-top: 4px;
      font-size: var(--tk-text-sm);
      color: var(--tk-danger-fg);
    }
    .note {
      margin-top: 8px;
    }
    .readonly-description {
      color: var(--tk-text-muted);
    }
    .actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }
  `,
})
export class GeneralSettingsComponent {
  protected readonly store = inject(ProjectSettingsStore);
  private readonly toast = inject(ToastService);

  protected readonly nameMax = NAME_MAX_LENGTH;
  protected readonly descriptionMax = DESCRIPTION_MAX_LENGTH;
  protected readonly name = linkedSignal(() => this.store.project()?.name ?? '');
  protected readonly description = linkedSignal(() => this.store.project()?.description ?? '');
  protected readonly visibility = linkedSignal<ProjectVisibility>(
    () => this.store.project()?.visibility ?? 'Private',
  );
  protected readonly serverNameError = linkedSignal<string, string | null>({
    source: this.name,
    computation: () => null,
  });

  protected readonly nameError = computed(() =>
    !this.name().trim() ? 'Enter a name.' : this.serverNameError(),
  );

  protected readonly changes = computed<Partial<GeneralSettings>>(() => {
    const project = this.store.project();
    if (!project) return {};
    const changes: Partial<GeneralSettings> = {};
    if (this.name().trim() !== project.name) changes.name = this.name().trim();
    if ((this.description().trim() || null) !== (project.description ?? null))
      changes.description = this.description();
    if (this.visibility() !== project.visibility) changes.visibility = this.visibility();
    return changes;
  });

  protected readonly dirty = computed(() => Object.keys(this.changes()).length > 0);

  protected reset(): void {
    const project = this.store.project();
    if (!project) return;
    this.name.set(project.name);
    this.description.set(project.description ?? '');
    this.visibility.set(project.visibility);
  }

  protected async save(): Promise<void> {
    if (!this.dirty() || this.nameError() || !this.store.canManage()) return;
    try {
      await this.store.saveGeneral(this.changes());
      this.toast.success('Settings saved.');
    } catch (e) {
      const error = toApiError(e);
      if (error.code === 'project.name.taken' || error.fieldError('name')) {
        this.serverNameError.set(error.fieldError('name') ?? error.title);
      } else if (error.code === 'concurrency.conflict') {
        this.toast.warning(
          'Someone else changed this project. The latest version is shown; apply your change again.',
        );
      } else {
        this.toast.error(error);
      }
    }
  }
}
