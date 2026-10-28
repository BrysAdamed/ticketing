import {
  createEnvironmentInjector,
  EnvironmentInjector,
  provideZonelessChangeDetection,
  signal,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CommandRegistry } from '../commands/command-registry';
import { ConfirmService } from '../notify/confirm.service';
import { ToastService } from '../notify/toast.service';
import { OnboardingStateService } from '../onboarding/onboarding-state.service';
import { HELP_GROUP, HelpMenuItem, RESTART_GUIDES_ID } from './help-menu';
import { HelpMenuRegistry, provideHelpMenuItem } from './help-menu.registry';

function item(id: string, order: number, extra: Partial<HelpMenuItem> = {}): HelpMenuItem {
  return { id, label: id, icon: 'tablerHelp', order, run: vi.fn(), ...extra };
}

describe('HelpMenuRegistry', () => {
  let confirm: { confirm: ReturnType<typeof vi.fn> };
  let toast: { success: ReturnType<typeof vi.fn> };
  let onboarding: { resetAll: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    confirm = { confirm: vi.fn().mockResolvedValue(true) };
    toast = { success: vi.fn() };
    onboarding = { resetAll: vi.fn().mockResolvedValue(true) };
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: ConfirmService, useValue: confirm },
        { provide: ToastService, useValue: toast },
        { provide: OnboardingStateService, useValue: onboarding },
      ],
    });
  });

  const ids = (items: readonly HelpMenuItem[]) => items.map((i) => i.id);
  const helpCommands = () =>
    TestBed.inject(CommandRegistry)
      .commands()
      .filter((c) => c.group === HELP_GROUP);

  describe('ordering', () => {
    it('lists items by order whatever the registration order', () => {
      // Arrange
      const registry = TestBed.inject(HelpMenuRegistry);

      // Act
      registry.register(item('help.whats-new', 400));
      registry.register(item('help.shortcuts', 0));
      registry.register(item('help.tour.first-project', 200));

      // Assert
      expect(ids(registry.items())).toEqual([
        'help.shortcuts',
        'help.tour.first-project',
        'help.whats-new',
      ]);
    });

    it('keeps registration order for equal orders', () => {
      // Arrange
      const registry = TestBed.inject(HelpMenuRegistry);

      // Act
      registry.register(item('help.b', 10));
      registry.register(item('help.a', 10));

      // Assert
      expect(ids(registry.items())).toEqual(['help.b', 'help.a']);
    });

    it('replaces an item registered again with the same id', () => {
      // Arrange
      const registry = TestBed.inject(HelpMenuRegistry);
      registry.register(item('help.shortcuts', 0, { label: 'Old' }));

      // Act
      registry.register(item('help.shortcuts', 0, { label: 'New' }));

      // Assert
      expect(registry.items().map((i) => i.label)).toEqual(['New']);
    });

    it('offers the items in the palette Help group in menu order with Restart all guides last', () => {
      // Arrange
      const registry = TestBed.inject(HelpMenuRegistry);

      // Act
      registry.register(item('help.connect-agent', 500));
      registry.register(item('help.shortcuts', 0, { shortcut: '?' }));

      // Assert
      expect(helpCommands().map((c) => c.id)).toEqual([
        'help.shortcuts',
        'help.connect-agent',
        RESTART_GUIDES_ID,
      ]);
      expect(helpCommands()[0].shortcut).toBe('?');
      expect(helpCommands()[2].label).toBe('Restart all guides');
    });

    it('moves the Help group after commands registered before it', () => {
      // Arrange
      const registry = TestBed.inject(HelpMenuRegistry);
      const commands = TestBed.inject(CommandRegistry);
      commands.registerCommands([{ id: 'nav.my-work', label: 'My work', run: vi.fn() }]);

      // Act
      registry.register(item('help.shortcuts', 0));

      // Assert
      expect(commands.commands().map((c) => c.id)).toEqual([
        'nav.my-work',
        'help.shortcuts',
        RESTART_GUIDES_ID,
      ]);
    });
  });

  describe('visibility', () => {
    it('follows a visible signal in the menu and the palette', () => {
      // Arrange
      const registry = TestBed.inject(HelpMenuRegistry);
      const hasTour = signal(false);
      registry.register(item('help.tour.page', 100, { visible: hasTour }));
      const commands = TestBed.inject(CommandRegistry);

      // Act
      const before = ids(registry.items());
      const findBefore = commands.find('help.tour.page');
      hasTour.set(true);

      // Assert
      expect(before).toEqual([]);
      expect(findBefore).toBeUndefined();
      expect(ids(registry.items())).toEqual(['help.tour.page']);
      expect(commands.find('help.tour.page')).toBeDefined();
    });

    it('keeps a disabled item in the menu but leaves it out of the palette', () => {
      // Arrange
      const registry = TestBed.inject(HelpMenuRegistry);
      registry.register(item('help.tour.page', 100, { disabled: () => true }));

      // Act
      const menu = ids(registry.items());
      const command = TestBed.inject(CommandRegistry).find('help.tour.page');

      // Assert
      expect(menu).toEqual(['help.tour.page']);
      expect(command).toBeUndefined();
    });

    it('offers an item with menu false in the palette only', () => {
      // Arrange
      const registry = TestBed.inject(HelpMenuRegistry);
      registry.register(item('help.tour.backlog.list', 100, { menu: false }));

      // Act
      const menu = ids(registry.items());
      const command = TestBed.inject(CommandRegistry).find('help.tour.backlog.list');

      // Assert
      expect(menu).toEqual([]);
      expect(command).toBeDefined();
    });

    it('removes an item and its command when its scope is destroyed', () => {
      // Arrange
      const parent = TestBed.inject(EnvironmentInjector);
      const scope = createEnvironmentInjector(
        [provideHelpMenuItem(() => item('help.whats-new', 400))],
        parent,
      );
      const registry = TestBed.inject(HelpMenuRegistry);
      const registered = ids(registry.items());

      // Act
      scope.destroy();

      // Assert
      expect(registered).toEqual(['help.whats-new']);
      expect(ids(registry.items())).toEqual([]);
      expect(helpCommands().map((c) => c.id)).toEqual([RESTART_GUIDES_ID]);
    });
  });

  describe('restart all guides', () => {
    it('resets the guides and shows a toast after the user confirms', async () => {
      // Arrange
      const registry = TestBed.inject(HelpMenuRegistry);

      // Act
      const result = await registry.restart();

      // Assert
      expect(result).toBe(true);
      expect(confirm.confirm).toHaveBeenCalledOnce();
      expect(onboarding.resetAll).toHaveBeenCalledOnce();
      expect(toast.success).toHaveBeenCalledWith('All guides restarted');
    });

    it('does nothing when the user cancels', async () => {
      // Arrange
      confirm.confirm.mockResolvedValue(false);
      const registry = TestBed.inject(HelpMenuRegistry);

      // Act
      const result = await registry.restart();

      // Assert
      expect(result).toBe(false);
      expect(onboarding.resetAll).not.toHaveBeenCalled();
      expect(toast.success).not.toHaveBeenCalled();
    });

    it('shows no success toast when the reset fails', async () => {
      // Arrange
      onboarding.resetAll.mockResolvedValue(false);
      const registry = TestBed.inject(HelpMenuRegistry);

      // Act
      const result = await registry.restart();

      // Assert
      expect(result).toBe(false);
      expect(toast.success).not.toHaveBeenCalled();
    });
  });
});
