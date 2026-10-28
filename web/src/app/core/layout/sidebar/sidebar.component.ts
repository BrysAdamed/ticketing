import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatTooltip } from '@angular/material/tooltip';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { ProjectTileComponent } from '@shared/ui/domain/project-tile.component';
import { AGENT_FLAG } from '../../agent/agent-prompt.models';
import { AuthService } from '../../auth/auth.service';
import { BoardDirectory } from '../../boards/board-directory';
import { FeatureFlagService } from '../../flags/feature-flag.service';
import { OpenProjectState } from '../../projects/open-project';
import { ProjectDirectory } from '../../projects/project-directory';
import { LayoutState } from '../layout-state';
import { NavigationContext } from '../navigation-context';
import { TourAnchorDirective } from '../../onboarding/engine/tour-anchor.directive';

interface NavLink {
  label: string;
  path: string;
  icon: string;
  testId: string;
  /// Shown only while this feature flag is on for the user.
  flag?: string;
}

export const PROJECT_NAV: readonly NavLink[] = [
  {
    label: 'Dashboard',
    path: 'dashboard',
    icon: 'tablerChartBar',
    testId: 'nav-project-dashboard',
  },
  { label: 'Backlog', path: 'backlog', icon: 'tablerList', testId: 'nav-project-backlog' },
  {
    label: 'Test cases',
    path: 'test-cases',
    icon: 'tablerChecklist',
    testId: 'nav-project-test-cases',
  },
  {
    label: 'Regressions',
    path: 'regressions',
    icon: 'tablerHistory',
    testId: 'nav-project-regressions',
  },
  { label: 'Docs', path: 'docs', icon: 'tablerBook', testId: 'nav-project-docs' },
  {
    label: 'Settings',
    path: 'settings',
    icon: 'tablerAdjustmentsHorizontal',
    testId: 'nav-project-settings',
  },
];

const ADMIN_NAV: readonly NavLink[] = [
  { label: 'Users', path: '/admin/users', icon: 'tablerUsers', testId: 'nav-admin-users' },
  { label: 'Feature flags', path: '/admin/flags', icon: 'tablerFlag', testId: 'nav-admin-flags' },
  {
    label: 'Agent prompts',
    path: '/admin/agent-prompts',
    icon: 'tablerRobot',
    testId: 'nav-admin-agent-prompts',
    flag: AGENT_FLAG,
  },
  { label: 'Audit log', path: '/admin/audit', icon: 'tablerReport', testId: 'nav-admin-audit' },
];

const MAX_PROJECTS = 8;

interface NavProject {
  id: string;
  key: string;
  name: string;
  archived?: boolean;
}

@Component({
  selector: 'tk-sidebar',
  imports: [
    RouterLink,
    RouterLinkActive,
    IconComponent,
    ProjectTileComponent,
    MatTooltip,
    TourAnchorDirective,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.rail]': 'layout.sidebarCollapsed()', 'data-testid': 'sidebar' },
  templateUrl: './sidebar.component.html',
  styleUrl: './sidebar.component.scss',
})
export class SidebarComponent {
  protected readonly layout = inject(LayoutState);
  protected readonly auth = inject(AuthService);
  protected readonly directory = inject(ProjectDirectory);
  protected readonly boardDirectory = inject(BoardDirectory);
  private readonly context = inject(NavigationContext);
  private readonly openProject = inject(OpenProjectState);

  protected readonly projectNav = PROJECT_NAV;
  private readonly flags = inject(FeatureFlagService);
  protected readonly adminNav = computed(() =>
    ADMIN_NAV.filter((item) => !item.flag || this.flags.isOn(item.flag)),
  );
  protected readonly collapsedSections = signal<ReadonlySet<string>>(new Set());
  private readonly toggledProjects = signal<ReadonlySet<string>>(new Set());

  protected readonly currentProjectKey = this.context.projectKey;
  protected readonly projects = computed(() => {
    const open = this.openProject.project();
    const listed = this.directory.activeProjects();
    const all: readonly NavProject[] =
      open && open.key === this.currentProjectKey() && !listed.some((p) => p.key === open.key)
        ? [...listed, { id: open.key, ...open }]
        : listed;
    const current = this.currentProjectKey();
    const shown = all.slice(0, MAX_PROJECTS);
    const active = all.find((p) => p.key === current);
    return active && !shown.includes(active)
      ? [...shown.slice(0, MAX_PROJECTS - 1), active]
      : shown;
  });
  protected readonly hasMoreProjects = computed(
    () => this.directory.activeProjects().length > this.projects().length,
  );

  constructor() {
    void this.directory.load();
    void this.boardDirectory.load();
  }

  protected isExpanded(key: string): boolean {
    const toggled = this.toggledProjects().has(key);
    return key === this.currentProjectKey() ? !toggled : toggled;
  }

  protected toggleProject(key: string, event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this.toggledProjects.update((set) => toggle(set, key));
  }

  protected isSectionCollapsed(name: string): boolean {
    return this.collapsedSections().has(name);
  }

  protected toggleSection(name: string): void {
    this.collapsedSections.update((set) => toggle(set, name));
  }
}

function toggle(set: ReadonlySet<string>, value: string): ReadonlySet<string> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}
