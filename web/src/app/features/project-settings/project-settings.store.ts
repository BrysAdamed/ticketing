import { computed, inject, Injectable, linkedSignal, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '@core/api/api-client';
import { toApiError } from '@core/api/api-error';
import { AuthService } from '@core/auth/auth.service';
import { ProjectContext, ProjectDetail, ProjectMember } from '@core/projects/project-context';
import { ProjectDirectory } from '@core/projects/project-directory';
import { ProjectRole, ProjectVisibility } from '@shared/domain/enums';
import { effectiveMemberRole, soleActiveOwnerId, sortMembers } from './member-roles';

export interface GeneralSettings {
  name: string;
  description: string;
  visibility: ProjectVisibility;
}

/// Item of `GET /api/v1/users?query=` (identity slice).
export interface UserLookup {
  id: string;
  email: string;
  displayName: string;
  isActive: boolean;
}

const USER_SEARCH_LIMIT = 10;

/// Project settings: general fields, members and lifecycle (archive, unarchive, delete). Reads
/// and updates the project held by ProjectContext so the header and every tab stay in sync.
@Injectable()
export class ProjectSettingsStore {
  private readonly api = inject(ApiClient);
  private readonly context = inject(ProjectContext);
  private readonly directory = inject(ProjectDirectory);
  private readonly auth = inject(AuthService);

  readonly project = this.context.project;
  readonly status = this.context.status;
  readonly isArchived = this.context.isArchived;
  readonly isAdmin = this.auth.isAdmin;
  /// Owners (Admins included) manage settings and members of non-archived projects (spec 5.3).
  readonly canManage = computed(() => this.context.isOwner() && !this.context.isArchived());
  readonly canArchive = this.context.isOwner;
  readonly canDelete = computed(() => this.auth.isAdmin() && this.context.isArchived());

  readonly members = linkedSignal<ProjectMember[]>(() => this.project()?.members ?? []);
  readonly soleOwnerId = computed(() => soleActiveOwnerId(this.members()));
  readonly savingGeneral = signal(false);
  readonly lifecycleBusy = signal(false);

  private get key(): string {
    return this.context.projectKey();
  }

  async saveGeneral(changes: Partial<GeneralSettings>): Promise<void> {
    const project = this.project();
    if (!project) return;
    this.savingGeneral.set(true);
    try {
      const body = {
        ...changes,
        ...(changes.description !== undefined
          ? { description: changes.description.trim() || null }
          : {}),
      };
      const updated = await firstValueFrom(
        this.api.patch<ProjectDetail>(`/projects/${this.key}`, body, {
          rowVersion: project.rowVersion,
        }),
      );
      this.context.apply(updated);
      if (changes.name !== undefined || changes.visibility !== undefined)
        void this.directory.reload();
    } catch (error) {
      if (toApiError(error).code === 'concurrency.conflict') await this.context.reload();
      throw error;
    } finally {
      this.savingGeneral.set(false);
    }
  }

  async searchUsers(query: string): Promise<UserLookup[]> {
    const users = await firstValueFrom(
      this.api.get<UserLookup[]>('/users', { query, limit: USER_SEARCH_LIMIT }),
    );
    const memberIds = new Set(this.members().map((m) => m.userId));
    return users.filter((u) => u.isActive && !memberIds.has(u.id));
  }

  async addMember(user: UserLookup, role: ProjectRole): Promise<ProjectMember> {
    const added = await firstValueFrom(
      this.api.post<ProjectMember>(`/projects/${this.key}/members`, { user: user.id, role }),
    );
    this.members.update((members) =>
      sortMembers([...members.filter((m) => m.userId !== added.userId), added]),
    );
    return added;
  }

  /// Optimistic: the row changes at once and rolls back when the server refuses.
  async changeRole(member: ProjectMember, role: ProjectRole): Promise<void> {
    if (member.role === role) return;
    const visibility = this.project()?.visibility ?? 'Private';
    const previous = this.members();
    this.replace({
      ...member,
      role,
      effectiveRole: effectiveMemberRole({ ...member, role }, visibility),
    });
    try {
      this.replace(
        await firstValueFrom(
          this.api.patch<ProjectMember>(`/projects/${this.key}/members/${member.userId}`, { role }),
        ),
      );
    } catch (error) {
      this.members.set(previous);
      throw error;
    }
    if (member.userId === this.auth.currentUser()?.id) await this.context.reload();
  }

  /// Optimistic: the row disappears at once and comes back when the server refuses.
  async removeMember(member: ProjectMember): Promise<void> {
    const previous = this.members();
    this.members.set(previous.filter((m) => m.userId !== member.userId));
    try {
      await firstValueFrom(this.api.delete(`/projects/${this.key}/members/${member.userId}`));
    } catch (error) {
      this.members.set(previous);
      throw error;
    }
    if (member.userId === this.auth.currentUser()?.id) {
      await Promise.all([this.context.reload(), this.directory.reload()]);
    }
  }

  async archive(): Promise<void> {
    await this.lifecycle('archive');
  }

  async unarchive(): Promise<void> {
    await this.lifecycle('unarchive');
  }

  async delete(confirmKey: string): Promise<void> {
    this.lifecycleBusy.set(true);
    try {
      await firstValueFrom(
        this.api.delete(`/projects/${this.key}?confirmKey=${encodeURIComponent(confirmKey)}`),
      );
      void this.directory.reload();
    } finally {
      this.lifecycleBusy.set(false);
    }
  }

  private async lifecycle(action: 'archive' | 'unarchive'): Promise<void> {
    this.lifecycleBusy.set(true);
    try {
      this.context.apply(
        await firstValueFrom(this.api.post<ProjectDetail>(`/projects/${this.key}/${action}`)),
      );
      void this.directory.reload();
    } finally {
      this.lifecycleBusy.set(false);
    }
  }

  private replace(member: ProjectMember): void {
    this.members.update((members) => members.map((m) => (m.userId === member.userId ? member : m)));
  }
}
