import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { provideIcons } from '@ng-icons/core';
import { ConfirmService } from '@core/notify/confirm.service';
import { ToastService } from '@core/notify/toast.service';
import { ProjectDirectory } from '@core/projects/project-directory';
import { ProjectTileComponent } from '@shared/ui/domain/project-tile.component';
import { UserDisplayComponent } from '@shared/ui/domain/user-display.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { BOARD_ICONS } from '../board-icons';
import { ArchiveBoardDialog } from './archive-board.dialog';
import { BoardStore } from './board.store';

export type BoardSettingsResult = 'deleted' | undefined;

const MAX_PROJECTS = 20;

/// Board settings (owner or Admin, spec 5.4): name and description, linked projects (unlinking sends
/// that project's cards back to its backlog, confirmed with the count), ownership, archive and delete.
@Component({
  selector: 'tk-board-settings-dialog',
  imports: [MatButtonModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatSelectModule, ProjectTileComponent, UserDisplayComponent, IconComponent],
  viewProviders: [provideIcons(BOARD_ICONS)],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-testid': 'board-settings-dialog' },
  template: `
    <h2 mat-dialog-title>Board settings</h2>
    <mat-dialog-content>
      @if (board(); as b) {
        @if (!b.archivedAt) {
          <section>
            <label class="tk-field-label" for="board-name">Name</label>
            <mat-form-field>
              <input matInput id="board-name" data-testid="settings-name" maxlength="100" [value]="name()" (input)="name.set($any($event.target).value)" />
            </mat-form-field>
            <label class="tk-field-label" for="board-description">Description</label>
            <mat-form-field>
              <textarea
                matInput
                id="board-description"
                rows="3"
                maxlength="2000"
                data-testid="settings-description"
                [value]="description()"
                (input)="description.set($any($event.target).value)"
              ></textarea>
            </mat-form-field>
            <div class="row-end">
              <button mat-stroked-button type="button" data-testid="settings-save" [disabled]="!dirty() || !name().trim() || busy()" (click)="save()">Save</button>
            </div>
          </section>

          <section>
            <h3>Projects</h3>
            <ul class="projects">
              @for (project of b.projects; track project.id) {
                <li [attr.data-testid]="'settings-project-' + project.key">
                  <tk-project-tile [projectKey]="project.key" />
                  <span class="pname">{{ project.name }}</span>
                  <span class="muted tnum">{{ project.cardCount }} {{ project.cardCount === 1 ? 'card' : 'cards' }}</span>
                  <button
                    type="button"
                    class="tk-icon-btn tk-icon-btn-sm"
                    [disabled]="b.projects.length === 1 || busy()"
                    [attr.aria-label]="'Unlink ' + project.name"
                    [attr.data-testid]="'settings-unlink-' + project.key"
                    (click)="unlink(project.key, project.name, project.cardCount)"
                  >
                    <tk-icon name="tablerX" [size]="14" />
                  </button>
                </li>
              }
            </ul>
            @if (linkable().length && b.projects.length < maxProjects) {
              <div class="add">
                <mat-form-field>
                  <mat-select placeholder="Link a project" data-testid="settings-link-project" [value]="toLink()" (valueChange)="toLink.set($event)">
                    @for (project of linkable(); track project.id) {
                      <mat-option [value]="project.key">{{ project.key }} · {{ project.name }}</mat-option>
                    }
                  </mat-select>
                </mat-form-field>
                <button mat-stroked-button type="button" data-testid="settings-link" [disabled]="!toLink() || busy()" (click)="link()">Link</button>
              </div>
            }
          </section>

          <section>
            <h3>Owner</h3>
            <div class="owner"><tk-user [user]="b.owner" /></div>
            <div class="add">
              <mat-form-field>
                <input matInput type="email" placeholder="New owner's email" data-testid="settings-owner" [value]="ownerEmail()" (input)="ownerEmail.set($any($event.target).value)" />
              </mat-form-field>
              <button mat-stroked-button type="button" data-testid="settings-transfer" [disabled]="!ownerEmail().trim() || busy()" (click)="transfer()">Transfer</button>
            </div>
          </section>
        }

        <section class="danger">
          <h3>{{ b.archivedAt ? 'Archived board' : 'Archive or delete' }}</h3>
          @if (b.archivedAt) {
            <div class="action">
              <div>
                <b>Unarchive</b>
                <p>Make the board writable again. Tickets carried over stay where they went.</p>
              </div>
              <button mat-stroked-button type="button" data-testid="settings-unarchive" (click)="unarchive()">
                <tk-icon name="tablerArchiveOff" [size]="14" />Unarchive
              </button>
            </div>
          } @else {
            <div class="action">
              <div>
                <b>Archive</b>
                <p>Make the board read-only. Done tickets stay; unfinished ones go to their backlogs or another board.</p>
              </div>
              <button mat-stroked-button type="button" data-testid="settings-archive" (click)="archive()">
                <tk-icon name="tablerArchive" [size]="14" />Archive…
              </button>
            </div>
          }
          <div class="action">
            <div>
              <b>Delete</b>
              <p>Every ticket on it, Done included, goes back to the top of its backlog.</p>
            </div>
            <button mat-stroked-button type="button" class="danger-btn" data-testid="settings-delete" (click)="remove()">
              <tk-icon name="tablerTrash" [size]="14" />Delete…
            </button>
          </div>
        </section>
      }
    </mat-dialog-content>
    <mat-dialog-actions>
      <button mat-button type="button" mat-dialog-close>Close</button>
    </mat-dialog-actions>
  `,
  styles: `
    .mat-mdc-button-base tk-icon {
      margin-right: 4px;
    }
    section {
      padding: 4px 0 16px;
      border-bottom: 1px solid var(--tk-border-subtle);
      margin-bottom: 12px;
    }
    section:last-child {
      border-bottom: 0;
    }
    h3 {
      margin: 0 0 8px;
      font-size: var(--tk-text-md);
      font-weight: var(--tk-weight-semibold);
    }
    mat-form-field {
      width: 100%;
    }
    .row-end {
      display: flex;
      justify-content: flex-end;
    }
    .projects {
      list-style: none;
      margin: 0 0 8px;
      padding: 0;
    }
    .projects li {
      height: 32px;
      display: flex;
      align-items: center;
      gap: 8px;
      border-bottom: 1px solid var(--tk-border-subtle);
    }
    .pname {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .muted {
      color: var(--tk-text-subtle);
      font-size: var(--tk-text-sm);
    }
    .add {
      display: flex;
      align-items: flex-start;
      gap: 8px;
    }
    .add mat-form-field {
      flex: 1;
    }
    .owner {
      margin-bottom: 8px;
    }
    .action {
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 8px 0;
    }
    .action > div {
      flex: 1;
    }
    .action p {
      margin: 2px 0 0;
      color: var(--tk-text-muted);
      font-size: var(--tk-text-sm);
    }
    .danger-btn {
      color: var(--tk-danger-fg, inherit);
    }
  `,
})
export class BoardSettingsDialog {
  private readonly store = inject<BoardStore>(MAT_DIALOG_DATA);
  private readonly ref = inject<MatDialogRef<BoardSettingsDialog, BoardSettingsResult>>(MatDialogRef);
  private readonly dialog = inject(MatDialog);
  private readonly confirm = inject(ConfirmService);
  private readonly toast = inject(ToastService);
  private readonly directory = inject(ProjectDirectory);

  protected readonly board = this.store.board;
  protected readonly maxProjects = MAX_PROJECTS;
  protected readonly name = signal(this.board()?.name ?? '');
  protected readonly description = signal(this.board()?.description ?? '');
  protected readonly toLink = signal<string | null>(null);
  protected readonly ownerEmail = signal('');
  protected readonly busy = signal(false);

  protected readonly dirty = computed(() => {
    const b = this.board();
    return !!b && (this.name().trim() !== b.name || (this.description().trim() || null) !== (b.description ?? null));
  });
  protected readonly linkable = computed(() => {
    const linked = new Set(this.board()?.projects.map((p) => p.key));
    return this.directory
      .activeProjects()
      .filter((p) => !linked.has(p.key) && (p.myRole === 'Owner' || p.myRole === 'Member'));
  });

  constructor() {
    void this.directory.load();
  }

  protected async save(): Promise<void> {
    await this.run(() => this.store.update({ name: this.name().trim(), description: this.description().trim() || null }), 'Board saved');
  }

  protected async link(): Promise<void> {
    const key = this.toLink();
    if (!key) return;
    if (await this.run(() => this.store.update({ addProjectKeys: [key] }), `${key} linked`)) this.toLink.set(null);
  }

  protected async unlink(key: string, name: string, cardCount: number): Promise<void> {
    const confirmed = await this.confirm.confirm({
      title: `Unlink ${name}?`,
      message: cardCount
        ? `${cardCount} ${cardCount === 1 ? 'card goes' : 'cards go'} back to the top of the ${key} backlog, keeping their order.`
        : `No ${key} cards are on this board.`,
      confirmLabel: 'Unlink',
      danger: cardCount > 0,
    });
    if (confirmed) await this.run(() => this.store.update({ removeProjectKeys: [key] }), `${key} unlinked`);
  }

  protected async transfer(): Promise<void> {
    const owner = this.ownerEmail().trim();
    const confirmed = await this.confirm.confirm({
      title: 'Transfer ownership?',
      message: `${owner} becomes the owner. Unless you are an admin, you can no longer change this board.`,
      confirmLabel: 'Transfer',
    });
    if (!confirmed) return;
    if (await this.run(() => this.store.update({ owner }), 'Ownership transferred')) {
      this.ownerEmail.set('');
      if (!this.store.canManage()) this.ref.close();
    }
  }

  protected archive(): void {
    const ref = this.dialog.open(ArchiveBoardDialog, { data: this.store, width: '480px', autoFocus: 'first-tabbable' });
    ref.afterClosed().subscribe((archived) => {
      if (archived) this.ref.close();
    });
  }

  protected async unarchive(): Promise<void> {
    await this.store.unarchive();
  }

  protected async remove(): Promise<void> {
    const b = this.board();
    if (!b) return;
    const confirmed = await this.confirm.confirm({
      title: `Delete ${b.name}?`,
      message: 'Every ticket on this board, Done included, goes back to the top of its project backlog. This cannot be undone.',
      confirmLabel: 'Delete board',
      danger: true,
      requireText: b.name,
    });
    if (confirmed && (await this.store.delete())) {
      this.toast.success(`${b.name} deleted`);
      this.ref.close('deleted');
    }
  }

  private async run(action: () => Promise<boolean>, success: string): Promise<boolean> {
    this.busy.set(true);
    try {
      const ok = await action();
      if (ok) this.toast.success(success);
      return ok;
    } finally {
      this.busy.set(false);
    }
  }
}
