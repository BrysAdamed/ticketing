import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltip } from '@angular/material/tooltip';
import { provideIcons } from '@ng-icons/core';
import { tablerUserPlus } from '@ng-icons/tabler-icons';
import { toApiError } from '@core/api/api-error';
import { AuthService } from '@core/auth/auth.service';
import { ToastService } from '@core/notify/toast.service';
import { ProjectMember } from '@core/projects/project-context';
import { ProjectRole } from '@shared/domain/enums';
import { RelativeTimePipe } from '@shared/pipes/relative-time.pipe';
import { AvatarComponent } from '@shared/ui/domain/avatar.component';
import { BadgeComponent } from '@shared/ui/domain/badge.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { assignableRoles, memberRoleLabel } from './member-roles';
import { ProjectSettingsStore, UserLookup } from './project-settings.store';

const SEARCH_DEBOUNCE_MS = 150;

@Component({
  selector: 'tk-members-settings',
  imports: [
    MatAutocompleteModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatTooltip,
    AvatarComponent,
    BadgeComponent,
    IconComponent,
    RelativeTimePipe,
  ],
  viewProviders: [provideIcons({ tablerUserPlus })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './settings-section.scss',
  host: { class: 'settings-section', 'data-testid': 'settings-members' },
  template: `
    <div class="section-head">
      <h2>Members</h2>
      <span class="tk-page-count">{{ store.members().length }}</span>
    </div>
    @if (store.project()?.visibility === 'Public') {
      <p class="tk-subtle intro">
        This project is public: every signed-in user can already see and edit it. Membership decides
        who are Owners, and who keeps access if the project becomes private.
      </p>
    }

    @if (store.canManage()) {
      <div class="add" data-testid="member-add">
        <mat-form-field class="user-field">
          <tk-icon matPrefix name="tablerSearch" [size]="14" class="prefix" />
          <input
            matInput
            placeholder="Add people by name or email"
            aria-label="User to add"
            data-testid="member-add-user"
            autocomplete="off"
            [value]="query()"
            [matAutocomplete]="userList"
            (input)="onQuery($any($event.target).value)"
          />
          <mat-autocomplete
            #userList="matAutocomplete"
            [displayWith]="displayUser"
            (optionSelected)="selected.set($event.option.value)"
          >
            @for (user of results(); track user.id) {
              <mat-option [value]="user" [attr.data-testid]="'member-add-option-' + user.email">
                <span class="option">
                  <tk-avatar [userId]="user.id" [name]="user.displayName" />
                  <span>{{ user.displayName }}</span>
                  <span class="tk-subtle">{{ user.email }}</span>
                </span>
              </mat-option>
            }
            @if (searched() && results().length === 0) {
              <mat-option disabled>No matching active users who aren't members yet</mat-option>
            }
          </mat-autocomplete>
        </mat-form-field>
        <mat-form-field class="role-field">
          <mat-select
            aria-label="Role for the new member"
            data-testid="member-add-role"
            [value]="newRole()"
            (valueChange)="newRole.set($event)"
          >
            @for (role of roles(); track role) {
              <mat-option [value]="role">{{ role }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <button
          mat-stroked-button
          type="button"
          data-testid="member-add-submit"
          [disabled]="!selected() || adding()"
          (click)="add()"
        >
          <tk-icon matButtonIcon name="tablerUserPlus" [size]="16" />
          Add
        </button>
      </div>
    }

    <div class="table" role="table" aria-label="Members">
      <div class="head" role="row">
        <span role="columnheader">Name</span>
        <span role="columnheader">Email</span>
        <span role="columnheader">Role</span>
        <span role="columnheader">Added</span>
        <span role="columnheader"><span class="tk-sr-only">Actions</span></span>
      </div>
      @for (member of store.members(); track member.userId) {
        <div class="row" role="row" [attr.data-testid]="'member-row-' + member.email">
          <span class="name" role="cell">
            <tk-avatar [userId]="member.userId" [name]="member.displayName" />
            <span class="display-name" [class.inactive]="!member.isActive">{{
              member.displayName
            }}</span>
            @if (member.userId === me()) {
              <span class="tk-subtle">(you)</span>
            }
            @if (!member.isActive) {
              <tk-badge tone="muted">Deactivated</tk-badge>
            } @else if (member.globalRole === 'Admin') {
              <tk-badge tone="violet" matTooltip="Admins act as Owner on every project"
                >Admin</tk-badge
              >
            }
          </span>
          <span class="email" role="cell">{{ member.email }}</span>
          <span class="role" role="cell">
            @if (store.canManage()) {
              <mat-select
                class="role-select"
                [attr.aria-label]="'Role of ' + member.displayName"
                [attr.data-testid]="'member-role-' + member.email"
                [value]="member.role"
                [disabled]="member.userId === store.soleOwnerId()"
                [matTooltip]="
                  member.userId === store.soleOwnerId()
                    ? 'The last active owner keeps the Owner role'
                    : ''
                "
                (valueChange)="changeRole(member, $event)"
              >
                <mat-select-trigger>{{ roleLabel(member.role) }}</mat-select-trigger>
                @for (role of roles(); track role) {
                  <mat-option [value]="role">{{ role }}</mat-option>
                }
                @if (member.role === 'Viewer' && !roles().includes('Viewer')) {
                  <mat-option value="Viewer" disabled>{{ roleLabel('Viewer') }}</mat-option>
                }
              </mat-select>
            } @else {
              <span [attr.data-testid]="'member-role-' + member.email">{{
                roleLabel(member.role)
              }}</span>
            }
          </span>
          <span class="added tk-subtle tnum" role="cell">{{ member.addedAt | relativeTime }}</span>
          <span class="actions" role="cell">
            @if (store.canManage()) {
              <button
                type="button"
                class="tk-icon-btn"
                [attr.aria-label]="'Remove ' + member.displayName"
                [attr.data-testid]="'member-remove-' + member.email"
                [disabled]="member.userId === store.soleOwnerId()"
                [matTooltip]="
                  member.userId === store.soleOwnerId()
                    ? 'Add another owner first'
                    : 'Remove from project'
                "
                (click)="remove(member)"
              >
                <tk-icon name="tablerX" [size]="16" />
              </button>
            }
          </span>
        </div>
      }
    </div>
  `,
  styles: `
    .intro {
      margin: 0 0 12px;
      font-size: var(--tk-text-sm);
    }
    .add {
      display: flex;
      gap: 8px;
      align-items: flex-start;
      margin-bottom: 12px;
    }
    .user-field {
      flex: 1;
    }
    .role-field {
      width: 140px;
    }
    .prefix {
      margin: 0 4px 0 8px;
      color: var(--tk-text-subtle);
    }
    .option {
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }
    .table {
      border: 1px solid var(--tk-border);
      border-radius: var(--tk-radius-lg);
      overflow: hidden;
    }
    .head,
    .row {
      display: grid;
      grid-template-columns: minmax(0, 1.4fr) minmax(0, 1.2fr) 200px 88px 36px;
      align-items: center;
      column-gap: 12px;
      padding: 0 8px 0 12px;
    }
    .head {
      height: 32px;
      background: var(--tk-bg-subtle);
      border-bottom: 1px solid var(--tk-border);
      color: var(--tk-text-subtle);
      font-size: var(--tk-text-sm);
      font-weight: var(--tk-weight-medium);
    }
    .row {
      min-height: 40px;
      border-bottom: 1px solid var(--tk-border-subtle);
    }
    .row:last-child {
      border-bottom: 0;
    }
    .row:hover {
      background: var(--tk-bg-hover);
    }
    .name {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }
    .display-name {
      font-weight: var(--tk-weight-medium);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .display-name.inactive {
      color: var(--tk-text-subtle);
    }
    .email {
      color: var(--tk-text-muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .role-select {
      width: 190px;
      font-size: var(--tk-text-base);
    }
    .added {
      font-size: var(--tk-text-sm);
    }
    .actions {
      display: inline-flex;
      justify-content: flex-end;
    }
    .actions .tk-icon-btn:disabled {
      opacity: 0.35;
      cursor: default;
    }
  `,
})
export class MembersSettingsComponent {
  protected readonly store = inject(ProjectSettingsStore);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthService);

  protected readonly me = computed(() => this.auth.currentUser()?.id ?? null);
  protected readonly roles = computed(() =>
    assignableRoles(this.store.project()?.visibility ?? 'Private'),
  );
  protected readonly query = signal('');
  protected readonly results = signal<UserLookup[]>([]);
  protected readonly searched = signal(false);
  protected readonly selected = signal<UserLookup | null>(null);
  protected readonly newRole = signal<ProjectRole>('Member');
  protected readonly adding = signal(false);

  private searchTimer: ReturnType<typeof setTimeout> | undefined;
  private searchToken = 0;

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.searchTimer));
  }

  protected readonly displayUser = (user: UserLookup | string | null): string =>
    typeof user === 'string' ? user : user ? `${user.displayName} (${user.email})` : '';

  protected roleLabel(role: ProjectRole): string {
    return memberRoleLabel(role, this.store.project()?.visibility ?? 'Private');
  }

  protected onQuery(value: string): void {
    this.query.set(value);
    this.selected.set(null);
    clearTimeout(this.searchTimer);
    const query = value.trim();
    if (!query) {
      this.results.set([]);
      this.searched.set(false);
      return;
    }
    const token = ++this.searchToken;
    this.searchTimer = setTimeout(async () => {
      try {
        const users = await this.store.searchUsers(query);
        if (token !== this.searchToken) return;
        this.results.set(users);
        this.searched.set(true);
      } catch (error) {
        if (token === this.searchToken) this.toast.error(error);
      }
    }, SEARCH_DEBOUNCE_MS);
  }

  protected async add(): Promise<void> {
    const user = this.selected();
    if (!user) return;
    this.adding.set(true);
    try {
      await this.store.addMember(user, this.newRole());
      this.toast.success(`${user.displayName} added as ${this.newRole()}.`);
      this.query.set('');
      this.results.set([]);
      this.searched.set(false);
      this.selected.set(null);
    } catch (error) {
      this.toast.error(error);
    } finally {
      this.adding.set(false);
    }
  }

  protected async changeRole(member: ProjectMember, role: ProjectRole): Promise<void> {
    try {
      await this.store.changeRole(member, role);
    } catch (error) {
      this.toast.error(toApiError(error).title, {
        action: { label: 'Retry', run: () => void this.changeRole(member, role) },
      });
    }
  }

  protected async remove(member: ProjectMember): Promise<void> {
    try {
      await this.store.removeMember(member);
      this.toast.success(`${member.displayName} removed.`, {
        action: { label: 'Undo', run: () => void this.undoRemove(member) },
      });
    } catch (error) {
      this.toast.error(error);
    }
  }

  private async undoRemove(member: ProjectMember): Promise<void> {
    try {
      await this.store.addMember(
        {
          id: member.userId,
          email: member.email,
          displayName: member.displayName,
          isActive: member.isActive,
        },
        member.role,
      );
    } catch (error) {
      this.toast.error(error);
    }
  }
}
