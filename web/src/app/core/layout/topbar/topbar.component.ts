import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltip } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { AvatarComponent } from '@shared/ui/domain/avatar.component';
import { ProjectTileComponent } from '@shared/ui/domain/project-tile.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { KbdComponent } from '@shared/ui/kbd/kbd.component';
import { AuthService } from '../../auth/auth.service';
import { CommandPaletteService } from '../../commands/command-palette.service';
import { CommandRegistry } from '../../commands/command-registry';
import { ProjectDirectory } from '../../projects/project-directory';
import { ShortcutService } from '../../shortcuts/shortcut.service';
import { ThemeService } from '../../theme/theme.service';
import { Breadcrumbs } from '../breadcrumbs';
import { ShellActions } from '../shell-actions';

export const CREATE_TICKET_COMMAND = 'ticket.create';

@Component({
  selector: 'tk-topbar',
  imports: [
    RouterLink,
    MatMenuModule,
    MatTooltip,
    IconComponent,
    KbdComponent,
    AvatarComponent,
    ProjectTileComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './topbar.component.html',
  styleUrl: './topbar.component.scss',
  host: { role: 'banner', 'data-testid': 'topbar' },
})
export class TopbarComponent {
  protected readonly auth = inject(AuthService);
  protected readonly theme = inject(ThemeService);
  protected readonly palette = inject(CommandPaletteService);
  protected readonly actions = inject(ShellActions);
  private readonly breadcrumbs = inject(Breadcrumbs);
  private readonly directory = inject(ProjectDirectory);
  private readonly commands = inject(CommandRegistry);
  private readonly shortcuts = inject(ShortcutService);

  protected readonly themeOptions = [
    { value: 'light', label: 'Light', icon: 'tablerSun' },
    { value: 'dark', label: 'Dark', icon: 'tablerMoon' },
    { value: 'system', label: 'System', icon: 'tablerDeviceDesktop' },
  ] as const;
  protected readonly paletteKeys = this.shortcuts.format('mod+k').join(' ');
  protected readonly createTicket = computed(() =>
    this.commands.commands().some((c) => c.id === CREATE_TICKET_COMMAND),
  );
  protected readonly crumbs = computed(() =>
    this.breadcrumbs.trail().map((crumb) => ({
      ...crumb,
      label: crumb.projectKey
        ? (this.directory.byKey(crumb.projectKey)?.name ?? crumb.label)
        : crumb.label,
    })),
  );

  protected runCreateTicket(): void {
    this.commands.run(CREATE_TICKET_COMMAND);
  }
}
