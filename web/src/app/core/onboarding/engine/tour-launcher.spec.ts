import { LiveAnnouncer } from '@angular/cdk/a11y';
import { createOverlayRef } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { Component, Injector, provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { PeekService } from '../../layout/peek/peek';
import { ShortcutService } from '../../shortcuts/shortcut.service';
import { TourAnchorDirective } from './tour-anchor.directive';
import { TourLauncher, TourResult } from './tour-launcher';
import { TourDefinition } from './tour.model';

@Component({
  imports: [TourAnchorDirective],
  template: `
    <button type="button" id="trigger">Help</button>
    <button type="button" tkTourAnchor="test.one">One</button>
    <span tkTourAnchor="test.two">Two</span>
  `,
})
class HostComponent {}

@Component({ template: 'menu' })
class OtherOverlayComponent {}

const TOUR: TourDefinition = {
  id: 'tour.test',
  version: 1,
  viewId: 'test.view',
  title: 'Test',
  steps: [
    { id: 'one', anchor: 'test.one', title: 'First title', body: 'First body' },
    { id: 'two', anchor: 'test.two', title: 'Second title', body: 'Second body' },
    { id: 'gone', anchor: 'test.gone', title: 'Missing', body: 'Missing' },
  ],
};

const member = { canWrite: true, isOwner: false, isAdmin: false };

const press = (key: string) =>
  (document.activeElement ?? document.body).dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
  );

describe('TourLauncher', () => {
  let fixture: ComponentFixture<HostComponent>;
  let launcher: TourLauncher;
  let announced: string[];
  let shortcutCalls: number;

  const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');

  async function settle(until: () => boolean = () => true): Promise<void> {
    for (let i = 0; i < 50; i++) {
      await fixture.whenStable();
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (until()) return;
    }
  }

  async function startTour(): Promise<{ result: Promise<TourResult> }> {
    document.querySelector<HTMLElement>('#trigger')!.focus();
    const result = launcher.start(TOUR, { access: member });
    await settle(() => dialog()?.textContent?.includes('First title') ?? false);
    return { result };
  }

  beforeEach(async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), provideRouter([])],
    });
    announced = [];
    vi.spyOn(TestBed.inject(LiveAnnouncer), 'announce').mockImplementation(async (message) => {
      announced.push(String(message));
    });
    shortcutCalls = 0;
    TestBed.inject(ShortcutService).register({
      keys: 'c',
      description: 'create',
      handler: () => shortcutCalls++,
    });
    launcher = TestBed.inject(TourLauncher);
    fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
  });

  afterEach(() => {
    launcher.stop();
    vi.restoreAllMocks();
  });

  it('opens a labelled modal dialog and announces the step', async () => {
    // Act
    await startTour();

    // Assert
    const card = dialog()!;
    expect(card.getAttribute('aria-modal')).toBe('true');
    expect(document.getElementById(card.getAttribute('aria-labelledby')!)?.textContent).toBe(
      'First title',
    );
    expect(document.getElementById(card.getAttribute('aria-describedby')!)?.textContent).toBe(
      'First body',
    );
    expect(card.contains(document.activeElement)).toBe(true);
    expect(announced).toEqual(['Step 1 of 2: First title']);
    expect(document.querySelector('[data-testid="tour-spotlight"]')).not.toBeNull();
  });

  it('suppresses global shortcuts while open and restores them and focus on Esc', async () => {
    // Arrange
    const { result } = await startTour();

    // Act
    press('c');
    press('Escape');

    // Assert
    expect(await result).toBe('dismissed');
    expect(shortcutCalls).toBe(0);
    expect(dialog()).toBeNull();
    expect(document.activeElement?.id).toBe('trigger');
    await settle();
    press('c');
    expect(shortcutCalls).toBe(1);
  });

  it('moves with the arrow keys and completes on the last available step', async () => {
    // Arrange
    const { result } = await startTour();

    // Act
    press('ArrowRight');
    await settle(() => announced.length === 2);
    press('ArrowLeft');
    await settle(() => announced.length === 3);
    press('ArrowRight');
    await settle(() => announced.length === 4);
    document.querySelector<HTMLElement>('[data-testid="tour-next"]')!.click();

    // Assert
    expect(announced).toEqual([
      'Step 1 of 2: First title',
      'Step 2 of 2: Second title',
      'Step 1 of 2: First title',
      'Step 2 of 2: Second title',
    ]);
    expect(await result).toBe('completed');
    expect(document.activeElement?.id).toBe('trigger');
  });

  it('falls back to the Help trigger when its trigger left the page during the tour', async () => {
    // Arrange
    const help = document.createElement('button');
    help.setAttribute('data-tour-return', '');
    help.id = 'help';
    document.body.appendChild(help);
    const { result } = await startTour();
    document.querySelector('#trigger')!.remove();

    // Act
    press('Escape');

    // Assert
    expect(await result).toBe('dismissed');
    expect(document.activeElement?.id).toBe('help');
    help.remove();
  });

  it('gives way to another modal overlay without taking focus back', async () => {
    // Arrange
    const { result } = await startTour();

    // Act
    const other = createOverlayRef(TestBed.inject(Injector), { hasBackdrop: true });
    other.attach(new ComponentPortal(OtherOverlayComponent));

    // Assert
    expect(await result).toBe('interrupted');
    expect(dialog()).toBeNull();
    other.dispose();
  });

  it('closes when the peek panel opens', async () => {
    // Arrange
    const { result } = await startTour();

    // Act
    TestBed.inject(PeekService).open('PAY-1');

    // Assert
    expect(await result).toBe('interrupted');
    expect(dialog()).toBeNull();
  });

  it('does not start when fewer than half of the anchors are on the page', async () => {
    // Act
    const result = await launcher.start(
      { ...TOUR, steps: [TOUR.steps[2], { ...TOUR.steps[2], id: 'gone-2' }, TOUR.steps[0]] },
      { access: member },
    );

    // Assert
    expect(result).toBe('aborted');
    expect(dialog()).toBeNull();
  });
});
