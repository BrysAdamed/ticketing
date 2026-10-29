import {
  computed,
  DestroyRef,
  EnvironmentProviders,
  inject,
  Injectable,
  provideEnvironmentInitializer,
  signal,
} from '@angular/core';
import { Command } from '../commands/command';
import { CommandRegistry } from '../commands/command-registry';
import { ConfirmService } from '../notify/confirm.service';
import { ToastService } from '../notify/toast.service';
import { OnboardingStateService } from '../onboarding/onboarding-state.service';
import {
  HELP_GROUP,
  HelpMenuItem,
  isHelpItemEnabled,
  isHelpItemVisible,
  RESTART_GUIDES_ID,
} from './help-menu';

/// Items of the top-bar Help menu and the palette's Help group (spec 14.6). Features register
/// items here, so the menu never imports a feature; registrations made from route or component
/// injectors are removed when those are destroyed. Restart all guides is built in and always last.
@Injectable({ providedIn: 'root' })
export class HelpMenuRegistry {
  private readonly commands = inject(CommandRegistry);
  private readonly confirm = inject(ConfirmService);
  private readonly toast = inject(ToastService);
  private readonly onboarding = inject(OnboardingStateService);

  private readonly registered = signal<readonly HelpMenuItem[]>([]);
  private removeCommands: (() => void) | null = null;

  readonly restartGuides: HelpMenuItem = {
    id: RESTART_GUIDES_ID,
    label: 'Restart all guides…',
    icon: 'tablerRefresh',
    order: Number.POSITIVE_INFINITY,
    keywords: ['onboarding', 'tour', 'reset', 'welcome'],
    run: () => void this.restart(),
  };

  /// Visible registered menu items in menu order, without Restart all guides.
  readonly items = computed(() =>
    this.ordered().filter((item) => item.menu !== false && isHelpItemVisible(item)),
  );

  private readonly ordered = computed(() =>
    [...this.registered()].sort((a, b) => a.order - b.order),
  );

  constructor() {
    this.syncCommands();
  }

  register(item: HelpMenuItem, destroyRef?: DestroyRef): () => void {
    this.registered.update((list) => [...list.filter((i) => i.id !== item.id), item]);
    this.syncCommands();
    const remove = () => {
      if (!this.registered().includes(item)) return;
      this.registered.update((list) => list.filter((i) => i !== item));
      this.syncCommands();
    };
    destroyRef?.onDestroy(remove);
    return remove;
  }

  /// A registered item, palette-only ones included, or undefined while none has this id.
  find(id: string): HelpMenuItem | undefined {
    return this.registered().find((item) => item.id === id);
  }

  /// Asks for confirmation, forgets every guide the user completed or dismissed and confirms it
  /// with a toast. Resolves true when the guides were reset.
  async restart(): Promise<boolean> {
    const confirmed = await this.confirm.confirm({
      title: 'Restart all guides?',
      message:
        'The welcome, tours, hints, the getting-started checklist and What’s new will show again as if you were new here.',
      confirmLabel: 'Restart guides',
    });
    if (!confirmed || !(await this.onboarding.resetAll())) return false;
    this.toast.success('All guides restarted');
    return true;
  }

  private syncCommands(): void {
    this.removeCommands?.();
    this.removeCommands = this.commands.registerCommands(
      [...this.ordered(), this.restartGuides].map(toCommand),
    );
  }
}

/// Registers a Help menu item when the providing environment injector (app or lazy route) is
/// created. Pass a factory to inject services or build signals for `visible`, `disabled` or `hint`.
export function provideHelpMenuItem(
  item: HelpMenuItem | (() => HelpMenuItem),
): EnvironmentProviders {
  return provideEnvironmentInitializer(() => {
    inject(HelpMenuRegistry).register(
      typeof item === 'function' ? item() : item,
      inject(DestroyRef),
    );
  });
}

function toCommand(item: HelpMenuItem): Command {
  return {
    id: item.id,
    label: item.label.replace(/…$/, ''),
    group: HELP_GROUP,
    icon: item.icon,
    shortcut: item.shortcut,
    keywords: item.keywords,
    run: item.run,
    available: () => isHelpItemEnabled(item),
  };
}
