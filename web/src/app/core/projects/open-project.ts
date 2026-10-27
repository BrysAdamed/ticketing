import { Injectable, signal } from '@angular/core';

export interface OpenProject {
  key: string;
  name: string;
  archived: boolean;
}

/// The project open in the project frame (set by ProjectContext), so the breadcrumb, the document
/// title and the sidebar show its current name and keep it listed while the user is in it, even when
/// the readable-projects list leaves it out (archived, or beyond the list's first page).
@Injectable({ providedIn: 'root' })
export class OpenProjectState {
  readonly project = signal<OpenProject | null>(null);
}
