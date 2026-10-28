import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  viewChild,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatMenuModule } from '@angular/material/menu';
import { MatTableModule } from '@angular/material/table';
import { MatTooltip } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';
import { toApiError } from '@core/api/api-error';
import { AuthService } from '@core/auth/auth.service';
import { ConfirmService } from '@core/notify/confirm.service';
import { ToastService } from '@core/notify/toast.service';
import { TourAnchorDirective } from '@core/onboarding/engine/tour-anchor.directive';
import { ShortcutService } from '@core/shortcuts/shortcut.service';
import { GLOBAL_ROLE_LABELS, GlobalRole } from '@shared/domain/enums';
import { AbsoluteTimePipe, RelativeTimePipe } from '@shared/pipes/relative-time.pipe';
import { AvatarComponent } from '@shared/ui/domain/avatar.component';
import { BadgeComponent } from '@shared/ui/domain/badge.component';
import { EmptyStateComponent } from '@shared/ui/empty-state/empty-state.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import {
  SegmentedControlComponent,
  SegmentOption,
} from '@shared/ui/segmented/segmented-control.component';
import { SkeletonRowsComponent } from '@shared/ui/skeleton/skeleton-rows.component';
import { AdminUser, CreateUserResult } from '../admin.models';
import { ActiveFilter, AdminUsersStore, RoleFilter, UserFormValue } from './admin-users.store';
import { SetPasswordLinkDialog, SetPasswordLinkDialogData } from './set-password-link.dialog';
import { describeUserRule } from './user-errors';
import { UserFormDialog, UserFormDialogData } from './user-form.dialog';
import { UserRuleDialog } from './user-rule.dialog';
import { USER_STATES, userState } from './user-state';
import { UserTokensDialog, UserTokensDialogData } from './user-tokens.dialog';

const SEARCH_DEBOUNCE_MS = 200;

@Component({
  selector: 'tk-admin-users-view',
  imports: [
    TourAnchorDirective,
    MatButtonModule,
    MatMenuModule,
    MatTableModule,
    MatTooltip,
    IconComponent,
    AvatarComponent,
    BadgeComponent,
    SegmentedControlComponent,
    SkeletonRowsComponent,
    EmptyStateComponent,
    RelativeTimePipe,
    AbsoluteTimePipe,
  ],
  providers: [AdminUsersStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'tk-page', 'data-testid': 'view-admin.users' },
  templateUrl: './admin-users.view.html',
  styleUrl: './admin-users.view.scss',
})
export class AdminUsersView {
  protected readonly store = inject(AdminUsersStore);
  private readonly auth = inject(AuthService);
  private readonly dialog = inject(MatDialog);
  private readonly confirm = inject(ConfirmService);
  private readonly toast = inject(ToastService);

  protected readonly columns = [
    'user',
    'email',
    'role',
    'status',
    'lastLogin',
    'tokens',
    'actions',
  ];
  protected readonly roleLabels = GLOBAL_ROLE_LABELS;
  protected readonly states = USER_STATES;
  protected readonly activeOptions: SegmentOption<ActiveFilter>[] = [
    { value: 'active', label: 'Active' },
    { value: 'deactivated', label: 'Deactivated' },
    { value: 'all', label: 'All' },
  ];
  protected readonly roleOptions: SegmentOption<RoleFilter>[] = [
    { value: 'all', label: 'All roles' },
    { value: 'Admin', label: 'Admins' },
    { value: 'User', label: 'Users' },
  ];
  protected readonly meId = computed(() => this.auth.currentUser()?.id);

  private readonly search = viewChild<ElementRef<HTMLInputElement>>('search');
  private searchTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    void this.store.load();
    inject(ShortcutService).registerScoped([
      {
        keys: '/',
        description: 'Filter users',
        section: 'Users',
        handler: () => this.search()?.nativeElement.focus(),
      },
      { keys: 'n', description: 'New user', section: 'Users', handler: () => void this.create() },
    ]);
    inject(DestroyRef).onDestroy(() => clearTimeout(this.searchTimer));
  }

  protected stateOf(user: AdminUser) {
    return this.states[userState(user)];
  }

  protected roleLabel(role: GlobalRole): string {
    return this.roleLabels[role];
  }

  protected onSearch(value: string): void {
    this.store.query.set(value);
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => void this.store.load(), SEARCH_DEBOUNCE_MS);
  }

  protected setActiveFilter(value: ActiveFilter): void {
    this.store.activeFilter.set(value);
    void this.store.load();
  }

  protected setRoleFilter(value: RoleFilter): void {
    this.store.roleFilter.set(value);
    void this.store.load();
  }

  protected clearFilters(): void {
    this.store.query.set('');
    this.store.activeFilter.set('active');
    this.store.roleFilter.set('all');
    void this.store.load();
  }

  protected async create(): Promise<void> {
    const result = await this.openForm({ submit: (value) => this.store.create(value) });
    if (!result) return;
    const created = result as CreateUserResult;
    this.showLink({
      displayName: created.user.displayName,
      email: created.user.email,
      link: created.setPasswordLink,
      isNewUser: true,
    });
  }

  protected async edit(user: AdminUser): Promise<void> {
    const updated = await this.openForm({
      user,
      isSelf: user.id === this.meId(),
      submit: (value: UserFormValue) => {
        const changes: Partial<UserFormValue> = {};
        if (value.displayName !== user.displayName) changes.displayName = value.displayName;
        if (value.globalRole !== user.globalRole) changes.globalRole = value.globalRole;
        return Object.keys(changes).length === 0
          ? Promise.resolve(user)
          : this.ruleAware(user, () => this.store.update(user, changes));
      },
    });
    if (updated) {
      this.toast.success(`${(updated as AdminUser).displayName} saved.`);
      if (user.id === this.meId()) void this.auth.refreshUser();
    }
  }

  protected async issueLink(user: AdminUser): Promise<void> {
    if (user.hasPassword) {
      const confirmed = await this.confirm.confirm({
        title: `New set-password link for ${user.displayName}?`,
        message:
          'Earlier links stop working. Their current password keeps working until the new link is used.',
        confirmLabel: 'Issue link',
      });
      if (!confirmed) return;
    }
    try {
      const link = await this.store.issueSetPasswordLink(user);
      this.showLink({
        displayName: user.displayName,
        email: user.email,
        link,
        isNewUser: !user.hasPassword,
      });
    } catch (error) {
      this.explain(user, error);
    }
  }

  protected async deactivate(user: AdminUser): Promise<void> {
    const confirmed = await this.confirm.confirm({
      title: `Deactivate ${user.displayName}?`,
      message: `They are signed out at once, can't sign in, and their ${user.activeTokenCount} active access token(s) are revoked for good. Their name stays on tickets and history.`,
      confirmLabel: 'Deactivate',
      danger: true,
    });
    if (!confirmed) return;
    try {
      await this.store.deactivate(user);
      this.toast.success(`${user.displayName} deactivated.`, {
        action: { label: 'Undo', run: () => void this.reactivate(user) },
      });
    } catch (error) {
      this.explain(user, error);
    }
  }

  protected async reactivate(user: AdminUser): Promise<void> {
    try {
      await this.store.reactivate(user);
      this.toast.success(`${user.displayName} reactivated. Revoked tokens stay revoked.`);
    } catch (error) {
      this.explain(user, error);
    }
  }

  protected showTokens(user: AdminUser): void {
    const ref = this.dialog.open<UserTokensDialog, UserTokensDialogData>(UserTokensDialog, {
      width: '560px',
      data: {
        user,
        load: () => this.store.tokensOf(user),
        revoke: (token) => this.store.revokeToken(token),
      },
    });
    ref.afterClosed().subscribe(() => void this.store.refreshUser(user.id));
  }

  private async openForm(data: UserFormDialogData): Promise<unknown> {
    return firstValueFrom(this.dialog.open(UserFormDialog, { width: '480px', data }).afterClosed());
  }

  private showLink(data: SetPasswordLinkDialogData): void {
    this.dialog.open(SetPasswordLinkDialog, { width: '560px', data, autoFocus: 'first-tabbable' });
  }

  /// Runs an edit; a refused rule closes nothing and is explained in its own dialog.
  private async ruleAware<T>(user: AdminUser, action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      const problem = describeUserRule(toApiError(error), user.displayName);
      if (problem) this.dialog.open(UserRuleDialog, { width: '440px', data: problem });
      throw error;
    }
  }

  private explain(user: AdminUser, error: unknown): void {
    const apiError = toApiError(error);
    const problem = describeUserRule(apiError, user.displayName);
    if (problem) this.dialog.open(UserRuleDialog, { width: '440px', data: problem });
    else this.toast.error(apiError);
  }
}
