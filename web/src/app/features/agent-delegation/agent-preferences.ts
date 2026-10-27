import { DOCUMENT } from '@angular/common';
import { inject, Injectable, signal } from '@angular/core';
import { ClaudeApp } from '@core/agent/claude-deep-link';

const FOLDERS_KEY = 'tk-agent-folders';
const APP_KEY = 'tk-agent-app';

/// What this browser remembers for Delegate to agent (refinement §6): the absolute path of the local
/// clone per project and the Claude app to open. Both stay in `localStorage`; the server never sees a path.
@Injectable({ providedIn: 'root' })
export class AgentPreferences {
  private readonly storage = inject(DOCUMENT).defaultView?.localStorage;
  private readonly folders = signal<Readonly<Record<string, string>>>(this.readFolders());

  readonly app = signal<ClaudeApp>(
    this.read(APP_KEY) === 'ClaudeDesktop' ? 'ClaudeDesktop' : 'ClaudeCode',
  );

  folder(projectKey: string): string | null {
    return this.folders()[projectKey.toUpperCase()] ?? null;
  }

  setFolder(projectKey: string, path: string): void {
    const next = { ...this.folders(), [projectKey.toUpperCase()]: path };
    this.folders.set(next);
    this.write(FOLDERS_KEY, JSON.stringify(next));
  }

  setApp(app: ClaudeApp): void {
    this.app.set(app);
    this.write(APP_KEY, app);
  }

  private readFolders(): Record<string, string> {
    try {
      const parsed: unknown = JSON.parse(this.read(FOLDERS_KEY) ?? '{}');
      if (!parsed || typeof parsed !== 'object') return {};
      return Object.fromEntries(
        Object.entries(parsed).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        ),
      );
    } catch {
      return {};
    }
  }

  private read(key: string): string | null {
    try {
      return this.storage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }

  private write(key: string, value: string): void {
    try {
      this.storage?.setItem(key, value);
    } catch {
      // Storage full or blocked: the choice lasts for this page only.
    }
  }
}
