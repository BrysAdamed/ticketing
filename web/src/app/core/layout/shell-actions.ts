import { DestroyRef, inject, Injectable } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';
import {
  REGRESSION_SESSION_KEY_PATTERN,
  TICKET_KEY_PATTERN,
  projectKeyOf,
} from '@shared/domain/keys';
import { AuthService } from '../auth/auth.service';
import { PaletteItem } from '../commands/command';
import { CommandPaletteService } from '../commands/command-palette.service';
import { CommandRegistry } from '../commands/command-registry';
import { matchScore } from '../commands/command';
import { ProjectDirectory } from '../projects/project-directory';
import { ShortcutHelpDialog } from '../shortcuts/shortcut-help.dialog';
import { ShortcutService } from '../shortcuts/shortcut.service';
import { ThemeService } from '../theme/theme.service';
import { LayoutState } from './layout-state';
import { NavigationContext } from './navigation-context';

const NAVIGATION = 'Navigation';
const PREFERENCES = 'Preferences';

/// Built-in shortcuts, commands and palette search providers of the app shell.
@Injectable({ providedIn: 'root' })
export class ShellActions {
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly theme = inject(ThemeService);
  private readonly layout = inject(LayoutState);
  private readonly context = inject(NavigationContext);
  private readonly palette = inject(CommandPaletteService);
  private readonly shortcuts = inject(ShortcutService);
  private readonly commands = inject(CommandRegistry);
  private readonly directory = inject(ProjectDirectory);

  showShortcuts(): void {
    if (this.dialog.getDialogById('tk-shortcut-help')) return;
    this.dialog.open(ShortcutHelpDialog, { id: 'tk-shortcut-help', autoFocus: 'first-tabbable' });
  }

  /// Registers everything for the lifetime of the given scope (the shell component).
  register(destroyRef: DestroyRef): void {
    const go = (url: string) => () => void this.router.navigateByUrl(url);
    const goProject = (view: string) => () => {
      const url = this.context.projectUrl(view);
      if (url) void this.router.navigateByUrl(url);
    };

    this.shortcuts.registerScoped(
      [
        {
          keys: 'mod+k',
          description: 'Search or jump to…',
          handler: () => this.palette.toggle(),
          allowInInputs: true,
        },
        { keys: '/', description: 'Search or jump to…', handler: () => this.palette.open() },
        { keys: '?', description: 'Show keyboard shortcuts', handler: () => this.showShortcuts() },
        { keys: '[', description: 'Toggle sidebar', handler: () => this.layout.toggleSidebar() },
        {
          keys: 'c',
          description: 'Create ticket',
          handler: () => this.commands.run('ticket.create'),
        },
        { keys: 'g m', section: 'Go to', description: 'My work', handler: go('/my-work') },
        { keys: 'g p', section: 'Go to', description: 'Projects', handler: go('/projects') },
        { keys: 'g o', section: 'Go to', description: 'Boards', handler: go('/boards') },
        {
          keys: 'g d',
          section: 'Go to',
          description: 'Project dashboard',
          handler: goProject('dashboard'),
        },
        {
          keys: 'g b',
          section: 'Go to',
          description: 'Project backlog',
          handler: goProject('backlog'),
        },
        {
          keys: 'g t',
          section: 'Go to',
          description: 'Project test cases',
          handler: goProject('test-cases'),
        },
        {
          keys: 'g r',
          section: 'Go to',
          description: 'Project regressions',
          handler: goProject('regressions'),
        },
      ],
      destroyRef,
    );

    this.commands.registerCommands(
      [
        {
          id: 'nav.my-work',
          label: 'Go to My work',
          group: NAVIGATION,
          icon: 'tablerUserCircle',
          shortcut: 'g m',
          run: go('/my-work'),
        },
        {
          id: 'nav.projects',
          label: 'Go to Projects',
          group: NAVIGATION,
          icon: 'tablerFolders',
          shortcut: 'g p',
          run: go('/projects'),
        },
        {
          id: 'nav.boards',
          label: 'Go to Boards',
          group: NAVIGATION,
          icon: 'tablerLayoutKanban',
          shortcut: 'g o',
          run: go('/boards'),
        },
        {
          id: 'nav.search',
          label: 'Search tickets',
          group: NAVIGATION,
          icon: 'tablerSearch',
          run: go('/search'),
        },
        {
          id: 'nav.profile',
          label: 'Profile',
          group: NAVIGATION,
          icon: 'tablerUserCircle',
          run: go('/profile'),
        },
        {
          id: 'nav.tokens',
          label: 'Access tokens',
          group: NAVIGATION,
          icon: 'tablerKey',
          run: go('/profile/tokens'),
        },
        {
          id: 'nav.admin.users',
          label: 'Admin: Users',
          group: NAVIGATION,
          icon: 'tablerUsers',
          run: go('/admin/users'),
          available: () => this.auth.isAdmin(),
        },
        {
          id: 'nav.admin.flags',
          label: 'Admin: Feature flags',
          group: NAVIGATION,
          icon: 'tablerFlag',
          run: go('/admin/flags'),
          available: () => this.auth.isAdmin(),
        },
        {
          id: 'nav.admin.audit',
          label: 'Admin: Audit log',
          group: NAVIGATION,
          icon: 'tablerReport',
          run: go('/admin/audit'),
          available: () => this.auth.isAdmin(),
        },
        {
          id: 'pref.theme',
          label: 'Toggle light / dark theme',
          group: PREFERENCES,
          icon: 'tablerCircleHalf2',
          keywords: ['dark', 'light', 'theme'],
          run: () => this.theme.toggle(),
        },
        {
          id: 'pref.theme.system',
          label: 'Use system theme',
          group: PREFERENCES,
          icon: 'tablerDeviceDesktop',
          run: () => this.theme.setPreference('system'),
        },
        {
          id: 'pref.density',
          label: 'Toggle compact rows',
          group: PREFERENCES,
          icon: 'tablerList',
          keywords: ['density', 'compact'],
          run: () =>
            this.theme.setDensity(this.theme.density() === 'compact' ? 'comfortable' : 'compact'),
        },
        {
          id: 'pref.sidebar',
          label: 'Toggle sidebar',
          group: PREFERENCES,
          icon: 'tablerLayoutSidebar',
          shortcut: '[',
          run: () => this.layout.toggleSidebar(),
        },
        {
          id: 'help.shortcuts',
          label: 'Keyboard shortcuts',
          group: PREFERENCES,
          icon: 'tablerKeyboard',
          shortcut: '?',
          run: () => this.showShortcuts(),
        },
        {
          id: 'auth.logout',
          label: 'Sign out',
          group: PREFERENCES,
          icon: 'tablerLogout',
          run: () => void this.auth.logout(),
        },
      ],
      destroyRef,
    );

    this.commands.registerSearchProvider(
      { id: 'core.key-jump', search: (query) => this.keyJump(query) },
      destroyRef,
    );
    this.commands.registerSearchProvider(
      { id: 'core.projects', search: (query) => this.searchProjects(query) },
      destroyRef,
    );
  }

  private keyJump(query: string): PaletteItem[] {
    const key = query.trim().toUpperCase();
    if (TICKET_KEY_PATTERN.test(key)) {
      return [
        {
          id: `jump:${key}`,
          label: `Open ${key}`,
          group: 'Jump to',
          icon: 'tablerArrowRight',
          run: () => void this.router.navigate(['/tickets', key]),
        },
      ];
    }
    if (REGRESSION_SESSION_KEY_PATTERN.test(key)) {
      return [
        {
          id: `jump:${key}`,
          label: `Open regression ${key}`,
          group: 'Jump to',
          icon: 'tablerHistory',
          run: () =>
            void this.router.navigate(['/projects', projectKeyOf(key), 'regressions', key]),
        },
      ];
    }
    return [];
  }

  private searchProjects(query: string): PaletteItem[] {
    const q = query.trim();
    return this.directory
      .activeProjects()
      .map((project) => ({
        project,
        score: q ? Math.max(matchScore(q, project.name), matchScore(q, project.key)) : 1,
      }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, q ? 5 : 3)
      .map(({ project }) => ({
        id: `project:${project.key}`,
        label: project.name,
        hint: project.key,
        group: 'Projects',
        icon: 'tablerFolders',
        run: () => void this.router.navigate(['/projects', project.key]),
      }));
  }
}
