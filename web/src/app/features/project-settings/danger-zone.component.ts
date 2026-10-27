import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltip } from '@angular/material/tooltip';
import { Router } from '@angular/router';
import { BOARDS_NOT_RELINKED } from '@core/projects/project-context';
import { ConfirmService } from '@core/notify/confirm.service';
import { ToastService } from '@core/notify/toast.service';
import { ProjectSettingsStore } from './project-settings.store';

@Component({
  selector: 'tk-danger-zone',
  imports: [MatButtonModule, MatTooltip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './settings-section.scss',
  host: { class: 'settings-section', 'data-testid': 'settings-danger-zone' },
  template: `
    <div class="section-head">
      <h2>Danger zone</h2>
    </div>
    <div class="zone">
      @if (store.canArchive()) {
        <div class="item">
          @if (store.isArchived()) {
            <div class="text">
              <strong>Unarchive this project</strong>
              <span>Make it writable again. Boards it was unlinked from are not linked again.</span>
            </div>
            <button
              mat-stroked-button
              type="button"
              data-testid="settings-unarchive"
              [disabled]="store.lifecycleBusy()"
              (click)="unarchive()"
            >
              Unarchive
            </button>
          } @else {
            <div class="text">
              <strong>Archive this project</strong>
              <span>
                It becomes read-only for everyone. Its tickets on boards go back to the backlog top
                and it is unlinked from every board.
              </span>
            </div>
            <button
              mat-stroked-button
              type="button"
              class="danger"
              data-testid="settings-archive"
              [disabled]="store.lifecycleBusy()"
              (click)="archive()"
            >
              Archive project
            </button>
          }
        </div>
      }
      @if (store.isAdmin()) {
        <div class="item">
          <div class="text">
            <strong>Delete this project</strong>
            <span>
              Removes it from every list, search and board. The key {{ key() }} stays reserved. Only
              archived projects can be deleted.
            </span>
          </div>
          <span [matTooltip]="store.canDelete() ? '' : 'Archive the project first'">
            <button
              mat-stroked-button
              type="button"
              class="danger"
              data-testid="settings-delete"
              [disabled]="!store.canDelete() || store.lifecycleBusy()"
              (click)="delete()"
            >
              Delete project
            </button>
          </span>
        </div>
      }
      @if (!store.canArchive() && !store.isAdmin()) {
        <p class="tk-subtle none">Only owners can archive this project.</p>
      }
    </div>
  `,
  styles: `
    .zone {
      border: 1px solid var(--tk-danger-border);
      border-radius: var(--tk-radius-lg);
    }
    .item {
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 12px 16px;
    }
    .item + .item {
      border-top: 1px solid var(--tk-border-subtle);
    }
    .text {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .text span {
      color: var(--tk-text-muted);
      font-size: var(--tk-text-sm);
    }
    .danger:not([disabled]) {
      --mat-button-outlined-label-text-color: var(--tk-danger-fg);
      --mat-button-outlined-outline-color: var(--tk-danger-border);
    }
    .none {
      margin: 0;
      padding: 12px 16px;
    }
  `,
})
export class DangerZoneComponent {
  protected readonly store = inject(ProjectSettingsStore);
  private readonly confirm = inject(ConfirmService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  protected key(): string {
    return this.store.project()?.key ?? '';
  }

  protected async archive(): Promise<void> {
    const confirmed = await this.confirm.confirm({
      title: `Archive ${this.store.project()?.name}?`,
      message:
        'The project becomes read-only for everyone. Its tickets on boards go back to the backlog and it is unlinked from every board. You can unarchive it later.',
      confirmLabel: 'Archive project',
      danger: true,
    });
    if (!confirmed) return;
    try {
      await this.store.archive();
      this.toast.success(`${this.key()} archived.`);
    } catch (error) {
      this.toast.error(error);
    }
  }

  protected async unarchive(): Promise<void> {
    try {
      await this.store.unarchive();
      this.toast.success(`${this.key()} unarchived. ${BOARDS_NOT_RELINKED}`);
    } catch (error) {
      this.toast.error(error);
    }
  }

  protected async delete(): Promise<void> {
    const key = this.key();
    const confirmed = await this.confirm.confirm({
      title: `Delete ${this.store.project()?.name}?`,
      message:
        'The project, its tickets, test cases and regressions disappear for everyone. This cannot be undone in the app.',
      confirmLabel: 'Delete project',
      danger: true,
      requireText: key,
    });
    if (!confirmed) return;
    try {
      await this.store.delete(key);
      this.toast.success(`${key} deleted.`);
      await this.router.navigate(['/projects']);
    } catch (error) {
      this.toast.error(error);
    }
  }
}
