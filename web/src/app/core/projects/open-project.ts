import { Injectable, signal } from '@angular/core';
import { ProjectRole } from '@shared/domain/enums';

export interface OpenProject {
  key: string;
  name: string;
  archived: boolean;
  /// The caller's effective role (Admins are Owner everywhere), or null.
  role: ProjectRole | null;
}

/// The project open in the project frame (set by ProjectContext), so the breadcrumb, the document
/// title and the sidebar show its current name and keep it listed while the user is in it, even when
/// the readable-projects list leaves it out (archived, or beyond the list's first page). Guided
/// tours read the role from it to hide write steps.
@Injectable({ providedIn: 'root' })
export class OpenProjectState {
  readonly project = signal<OpenProject | null>(null);
}
