import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { RegressionsExplainerDialog } from './dialogs/regressions-explainer.dialog';
import { HelpMenuItem } from '../help/help-menu';
import { HelpMenuRegistry } from '../help/help-menu.registry';
import { GuidedTours } from './guided-tours';
import { LearnActions } from './learn-actions';
import { TourAvailability } from './tour-availability';

function walkthroughItem(overrides: Partial<HelpMenuItem> = {}): HelpMenuItem {
  return {
    id: 'help.tour.first-project',
    label: 'Your first project',
    icon: 'tablerRoute',
    order: 200,
    run: vi.fn(),
    ...overrides,
  };
}

describe('LearnActions', () => {
  let registered: ReturnType<typeof signal<readonly HelpMenuItem[]>>;
  let start: ReturnType<typeof vi.fn>;
  let prepare: ReturnType<typeof vi.fn>;
  let dialogOpen: ReturnType<typeof vi.fn>;

  function setup(startable: readonly string[] = []): LearnActions {
    registered = signal<readonly HelpMenuItem[]>([]);
    start = vi.fn().mockResolvedValue('completed');
    prepare = vi.fn();
    dialogOpen = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        {
          provide: HelpMenuRegistry,
          useValue: { find: (id: string) => registered().find((item) => item.id === id) },
        },
        {
          provide: TourAvailability,
          useValue: { canStart: (viewId: string) => startable.includes(viewId), prepare },
        },
        { provide: GuidedTours, useValue: { start } },
        { provide: MatDialog, useValue: { open: dialogOpen } },
      ],
    });
    return TestBed.inject(LearnActions);
  }

  it('offers a tour only when it can start', () => {
    // Arrange
    const learn = setup(['backlog.list']);

    // Act / Assert
    expect(learn.canStartTour('backlog.list')).toBe(true);
    expect(learn.canStartTour('testcases.list')).toBe(false);
  });

  it('starts the tour through the lazily loaded GuidedTours', async () => {
    // Arrange
    const learn = setup(['project.dashboard']);

    // Act
    await learn.startTour('project.dashboard');
    await learn.startTour('ticket.detail', { step: 'links' });

    // Assert
    expect(start).toHaveBeenCalledWith('project.dashboard', {});
    expect(start).toHaveBeenCalledWith('ticket.detail', { step: 'links' });
  });

  it('prepares a tour through TourAvailability', () => {
    // Arrange
    const learn = setup();

    // Act
    learn.prepareTour('board.kanban');

    // Assert
    expect(prepare).toHaveBeenCalledWith('board.kanban');
  });

  it('opens the regressions explainer as a labelled dialog', async () => {
    // Arrange
    const learn = setup();

    // Act
    await learn.openRegressionsExplainer();

    // Assert
    expect(dialogOpen).toHaveBeenCalledWith(
      RegressionsExplainerDialog,
      expect.objectContaining({ ariaLabelledBy: 'regressions-explainer-title' }),
    );
  });

  it('has no walkthrough while the first-project item is not registered', () => {
    // Arrange
    const learn = setup();

    // Act
    learn.startWalkthrough();

    // Assert
    expect(learn.canStartWalkthrough()).toBe(false);
  });

  it('follows the first-project item as it is registered and enabled', () => {
    // Arrange
    const learn = setup();
    const disabled = signal(true);
    const item = walkthroughItem({ disabled });

    // Act / Assert
    registered.set([item]);
    expect(learn.canStartWalkthrough()).toBe(false);

    disabled.set(false);
    expect(learn.canStartWalkthrough()).toBe(true);

    learn.startWalkthrough();
    expect(item.run).toHaveBeenCalledTimes(1);
  });

  it('runs any Help item only while it is registered and enabled', () => {
    // Arrange
    const learn = setup();
    const disabled = signal(true);
    const item = walkthroughItem({ id: 'help.connect-agent', disabled });

    // Act / Assert
    expect(learn.canRunHelpItem('help.connect-agent')).toBe(false);
    registered.set([item]);
    expect(learn.canRunHelpItem('help.connect-agent')).toBe(false);
    learn.runHelpItem('help.connect-agent');
    expect(item.run).not.toHaveBeenCalled();

    disabled.set(false);
    expect(learn.canRunHelpItem('help.connect-agent')).toBe(true);
    learn.runHelpItem('help.connect-agent');
    expect(item.run).toHaveBeenCalledTimes(1);
  });

  it('does not run a hidden walkthrough', () => {
    // Arrange
    const learn = setup();
    const item = walkthroughItem({ visible: () => false });
    registered.set([item]);

    // Act
    learn.startWalkthrough();

    // Assert
    expect(learn.canStartWalkthrough()).toBe(false);
    expect(item.run).not.toHaveBeenCalled();
  });
});
