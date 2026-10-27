import { ChangeDetectionStrategy, Component, computed, inject, linkedSignal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatRadioModule } from '@angular/material/radio';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { ProjectAgentSettingsPatch } from '@core/agent/project-agent-settings.client';
import { toApiError } from '@core/api/api-error';
import { ToastService } from '@core/notify/toast.service';
import { ProjectAgentSettings } from '@core/projects/project-context';
import {
  GIT_BRANCH_MAX_LENGTH,
  GIT_REMOTE_MAX_LENGTH,
  isValidGitBranch,
  normalizeGitRemote,
} from '@shared/domain/git';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { AgentSettingsStore } from './agent-settings.store';

type MergePolicy = ProjectAgentSettings['mergePolicy'];

const URL_ERRORS = new Set(['agent.project.repositoryRequired', 'project.repositoryUrl.invalid']);

/// Delegation setup: enable, repository URL (validated as you type, with the normalized form the
/// agent compares clones by), default branch, merge policy and what Delegate does to the ticket.
@Component({
  selector: 'tk-agent-setup-card',
  imports: [
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatInputModule,
    MatRadioModule,
    MatSlideToggleModule,
    IconComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../settings-section.scss',
  host: { class: 'settings-section', 'data-testid': 'agent-setup' },
  template: `
    <div class="section-head">
      <h2>Delegation</h2>
      @if (!store.canManage()) {
        <span class="tk-subtle" data-testid="agent-setup-readonly">
          {{
            store.isArchived()
              ? 'Archived projects are read-only.'
              : 'Only owners can change these settings.'
          }}
        </span>
      }
    </div>
    <form class="form" novalidate (submit)="$event.preventDefault(); save()">
      <div class="switch-row">
        <mat-slide-toggle
          data-testid="agent-enabled"
          aria-labelledby="agent-enabled-label"
          [checked]="enabled()"
          [disabled]="!store.canManage()"
          (change)="enabled.set($event.checked)"
        />
        <span id="agent-enabled-label">
          Let members delegate tickets of this project to Claude Code
        </span>
      </div>

      <div class="field">
        <label class="tk-field-label" for="agent-repository-url">Repository URL</label>
        <mat-form-field>
          <input
            matInput
            id="agent-repository-url"
            autocomplete="off"
            spellcheck="false"
            placeholder="https://git.example.com/team/repo.git"
            data-testid="agent-repository-url"
            [attr.maxlength]="urlMax"
            [attr.aria-invalid]="!!urlError()"
            [attr.aria-describedby]="'agent-repository-url-hint'"
            [value]="repositoryUrl()"
            [disabled]="!store.canManage()"
            (input)="repositoryUrl.set($any($event.target).value)"
          />
        </mat-form-field>
        <div id="agent-repository-url-hint">
          @if (urlError(); as message) {
            <div class="error" data-testid="agent-repository-url-error">{{ message }}</div>
          } @else if (normalizedUrl(); as normalized) {
            <div class="hint" data-testid="agent-repository-url-normalized">
              Matches clones of <code>{{ normalized }}</code>
            </div>
          } @else {
            <div class="hint">
              The agent checks that its working copy's <code>origin</code> is this repository.
            </div>
          }
        </div>
      </div>

      <div class="field branch">
        <label class="tk-field-label" for="agent-default-branch">Default branch</label>
        <mat-form-field>
          <input
            matInput
            id="agent-default-branch"
            autocomplete="off"
            spellcheck="false"
            data-testid="agent-default-branch"
            [attr.maxlength]="branchMax"
            [attr.aria-invalid]="!!branchError()"
            [value]="defaultBranch()"
            [disabled]="!store.canManage()"
            (input)="defaultBranch.set($any($event.target).value)"
          />
        </mat-form-field>
        @if (branchError(); as message) {
          <div class="error" data-testid="agent-default-branch-error">{{ message }}</div>
        }
      </div>

      <div class="field">
        <span class="tk-field-label" id="agent-merge-policy">When the work is done</span>
        <mat-radio-group
          class="radios"
          aria-labelledby="agent-merge-policy"
          [value]="mergePolicy()"
          [disabled]="!store.canManage()"
          (change)="mergePolicy.set($event.value)"
        >
          <mat-radio-button value="Review" data-testid="agent-merge-policy-Review">
            Push a branch and move the ticket to Review; a person merges
          </mat-radio-button>
          <mat-radio-button
            value="MergeWhenVerified"
            data-testid="agent-merge-policy-MergeWhenVerified"
          >
            Merge to {{ defaultBranch().trim() || 'the default branch' }} once verified
          </mat-radio-button>
        </mat-radio-group>
        @if (mergePolicy() === 'MergeWhenVerified') {
          <div class="tk-callout tk-callout-warning note" data-testid="agent-merge-policy-warning">
            <tk-icon name="tablerAlertTriangle" [size]="16" />
            <span>
              The agent merges its own work without a human review once the build and tests pass.
              Use this only for repositories where that is acceptable.
            </span>
          </div>
        }
      </div>

      <div class="field">
        <span class="tk-field-label">When someone delegates a ticket</span>
        <mat-checkbox
          data-testid="agent-assign-on-delegate"
          [checked]="assignOnDelegate()"
          [disabled]="!store.canManage()"
          (change)="assignOnDelegate.set($event.checked)"
        >
          Assign it to them if it is unassigned
        </mat-checkbox>
        <mat-checkbox
          data-testid="agent-start-progress-on-delegate"
          [checked]="startProgressOnDelegate()"
          [disabled]="!store.canManage()"
          (change)="startProgressOnDelegate.set($event.checked)"
        >
          Move it from To Do to In Progress
        </mat-checkbox>
      </div>

      @if (store.canManage()) {
        <div class="actions">
          <button
            mat-button
            type="button"
            [disabled]="!dirty() || store.saving()"
            (click)="reset()"
          >
            Reset
          </button>
          <button
            mat-flat-button
            type="submit"
            data-testid="agent-setup-save"
            [disabled]="!dirty() || invalid() || store.saving()"
          >
            {{ store.saving() ? 'Saving…' : 'Save changes' }}
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
    .switch-row {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .field {
      display: flex;
      flex-direction: column;
    }
    .field mat-form-field {
      width: 100%;
    }
    .branch {
      max-width: 320px;
    }
    .radios {
      display: flex;
      flex-direction: column;
    }
    .hint,
    .error {
      margin-top: 4px;
      font-size: var(--tk-text-sm);
    }
    .hint {
      color: var(--tk-text-muted);
    }
    .hint code {
      font-family: var(--tk-font-mono);
      color: var(--tk-text);
    }
    .error {
      color: var(--tk-danger-fg);
    }
    .note {
      margin-top: 8px;
    }
    .actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }
  `,
})
export class AgentSetupCardComponent {
  protected readonly store = inject(AgentSettingsStore);
  private readonly toast = inject(ToastService);

  protected readonly urlMax = GIT_REMOTE_MAX_LENGTH;
  protected readonly branchMax = GIT_BRANCH_MAX_LENGTH;
  private readonly saved = computed(() => this.store.settings());

  protected readonly enabled = linkedSignal(() => this.saved()?.enabled ?? false);
  protected readonly repositoryUrl = linkedSignal(() => this.saved()?.repositoryUrl ?? '');
  protected readonly defaultBranch = linkedSignal(() => this.saved()?.defaultBranch ?? 'main');
  protected readonly mergePolicy = linkedSignal<MergePolicy>(
    () => this.saved()?.mergePolicy ?? 'Review',
  );
  protected readonly assignOnDelegate = linkedSignal(() => this.saved()?.assignOnDelegate ?? true);
  protected readonly startProgressOnDelegate = linkedSignal(
    () => this.saved()?.startProgressOnDelegate ?? true,
  );

  private readonly serverUrlError = linkedSignal<unknown, string | null>({
    source: () => [this.repositoryUrl(), this.enabled()],
    computation: () => null,
  });
  private readonly serverBranchError = linkedSignal<string, string | null>({
    source: this.defaultBranch,
    computation: () => null,
  });

  protected readonly normalizedUrl = computed(() => normalizeGitRemote(this.repositoryUrl()));
  protected readonly urlError = computed(() => {
    const url = this.repositoryUrl().trim();
    if (url && !this.normalizedUrl())
      return 'Use an https, ssh or scp-style git remote, for example git@git.example.com:team/repo.git.';
    return this.serverUrlError();
  });
  protected readonly branchError = computed(() =>
    isValidGitBranch(this.defaultBranch())
      ? this.serverBranchError()
      : 'Use a git branch name such as main or develop.',
  );
  protected readonly invalid = computed(
    () =>
      (!!this.repositoryUrl().trim() && !this.normalizedUrl()) ||
      !isValidGitBranch(this.defaultBranch()),
  );

  protected readonly changes = computed<ProjectAgentSettingsPatch>(() => {
    const saved = this.saved();
    if (!saved) return {};
    const changes: ProjectAgentSettingsPatch = {};
    if (this.enabled() !== saved.enabled) changes.enabled = this.enabled();
    const url = this.repositoryUrl().trim() || null;
    if (url !== (saved.repositoryUrl ?? null)) changes.repositoryUrl = url;
    if (this.defaultBranch().trim() !== saved.defaultBranch)
      changes.defaultBranch = this.defaultBranch().trim();
    if (this.mergePolicy() !== saved.mergePolicy) changes.mergePolicy = this.mergePolicy();
    if (this.assignOnDelegate() !== saved.assignOnDelegate)
      changes.assignOnDelegate = this.assignOnDelegate();
    if (this.startProgressOnDelegate() !== saved.startProgressOnDelegate)
      changes.startProgressOnDelegate = this.startProgressOnDelegate();
    return changes;
  });
  protected readonly dirty = computed(() => Object.keys(this.changes()).length > 0);

  protected reset(): void {
    const saved = this.saved();
    if (!saved) return;
    this.enabled.set(saved.enabled);
    this.repositoryUrl.set(saved.repositoryUrl ?? '');
    this.defaultBranch.set(saved.defaultBranch);
    this.mergePolicy.set(saved.mergePolicy);
    this.assignOnDelegate.set(saved.assignOnDelegate);
    this.startProgressOnDelegate.set(saved.startProgressOnDelegate);
  }

  protected async save(): Promise<void> {
    if (!this.dirty() || this.invalid() || !this.store.canManage()) return;
    try {
      await this.store.save(this.changes());
      this.toast.success('Delegation settings saved.');
    } catch (e) {
      const error = toApiError(e);
      if (URL_ERRORS.has(error.code ?? '')) {
        this.serverUrlError.set(
          error.fieldError('repositoryUrl') ??
            error.fieldError('enabled') ??
            error.detail ??
            error.title,
        );
      } else if (error.code === 'project.defaultBranch.invalid') {
        this.serverBranchError.set(
          error.fieldError('defaultBranch') ?? error.detail ?? error.title,
        );
      } else if (error.code === 'concurrency.conflict') {
        this.toast.warning(
          'Someone else changed this project. The latest settings are shown; apply your change again.',
        );
      } else {
        this.toast.error(error);
      }
    }
  }
}
