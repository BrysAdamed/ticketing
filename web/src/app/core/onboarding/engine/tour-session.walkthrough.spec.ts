import { LiveAnnouncer } from '@angular/cdk/a11y';
import { createOverlayRef } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { Component, Injector, provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { vi } from 'vitest';
import { ShortcutService } from '../../shortcuts/shortcut.service';
import { TourAnchorDirective } from './tour-anchor.directive';
import { TourConditionResult, TourConditions } from './tour-conditions';
import { TourLauncher, TourResult } from './tour-launcher';
import { TourDefinition } from './tour.model';

@Component({
  imports: [TourAnchorDirective],
  template: `
    <button type="button" id="trigger">Help</button>
    <button type="button" tkTourAnchor="w.create" (click)="clicks = clicks + 1">Create</button>
    <span tkTourAnchor="w.read">Read</span>
  `,
})
class HostComponent {
  clicks = 0;
}

@Component({ template: '' })
class EmptyComponent {}

@Component({ template: 'dialog' })
class ForeignDialogComponent {}

const WALKTHROUGH: TourDefinition = {
  id: 'tour.walk',
  version: 1,
  viewId: 'walk',
  title: 'Walk',
  kind: 'walkthrough',
  steps: [
    {
      id: 'create',
      anchor: 'w.create',
      route: '/page',
      advanceWhen: { kind: 'condition', id: 'created' },
      action: { label: 'Create it', does: 'custom', id: 'create' },
      waiting: 'Waiting for {thing}',
      title: 'Create a thing',
      body: 'Create {thing}.',
    },
    {
      id: 'click',
      anchor: 'w.create',
      route: '/page',
      optional: true,
      advanceWhen: { kind: 'condition', id: 'clicked' },
      action: { label: 'Click it', does: 'click-anchor' },
      title: 'Click {made}',
      body: 'Click it.',
    },
    { id: 'read', anchor: 'w.read', route: '/page', title: 'Read', body: 'Read it.' },
  ],
};

const access = { canWrite: true, isOwner: true, isAdmin: false };

class FakeConditions implements TourConditions {
  readonly changes = new Subject<unknown>();
  readonly holds = new Set<string>();
  readonly checked: string[] = [];
  runResult: Record<string, string> | null = { made: 'T-1' };

  check(id: string): Promise<TourConditionResult> {
    this.checked.push(id);
    const result: TourConditionResult = this.holds.has(id)
      ? { holds: true, params: id === 'created' ? { made: 'T-1' } : {} }
      : { holds: false };
    return Promise.resolve(result);
  }

  run(): Promise<Record<string, string> | null> {
    this.holds.add('created');
    return Promise.resolve(this.runResult);
  }
}

describe('TourSession action-driven steps and pausing', () => {
  let fixture: ComponentFixture<HostComponent>;
  let launcher: TourLauncher;
  let router: Router;
  let conditions: FakeConditions;
  let shortcutCalls: number;

  const card = () => document.querySelector<HTMLElement>('[data-testid="tour-popover"]');
  const pill = () => document.querySelector<HTMLElement>('[data-testid="tour-pill"]');
  const button = (testId: string) =>
    document.querySelector<HTMLElement>(`[data-testid="${testId}"]`);

  async function settle(until: () => boolean = () => true): Promise<void> {
    for (let i = 0; i < 80; i++) {
      await fixture.whenStable();
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (until()) return;
    }
  }

  const showing = (stepId: string) => () =>
    card()?.getAttribute('data-step') === stepId && !card()!.classList.contains('pending');

  function start(resume?: { skipOptional?: boolean }): Promise<TourResult> {
    return launcher.start(WALKTHROUGH, {
      access,
      params: { thing: 'a thing' },
      conditions,
      resume,
    });
  }

  beforeEach(async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([
          { path: 'page', component: EmptyComponent },
          { path: 'other', component: EmptyComponent },
        ]),
      ],
    });
    vi.spyOn(TestBed.inject(LiveAnnouncer), 'announce').mockResolvedValue();
    shortcutCalls = 0;
    TestBed.inject(ShortcutService).register({
      keys: 'c',
      description: 'create',
      handler: () => shortcutCalls++,
    });
    conditions = new FakeConditions();
    launcher = TestBed.inject(TourLauncher);
    router = TestBed.inject(Router);
    await router.navigateByUrl('/page');
    fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
  });

  afterEach(() => {
    launcher.stop();
    vi.restoreAllMocks();
  });

  it('shows an action step as a non-modal card with live shortcuts and no Next', async () => {
    // Act
    void start();
    await settle(showing('create'));
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', bubbles: true }));

    // Assert
    expect(card()!.hasAttribute('aria-modal')).toBe(false);
    expect(button('tour-step-count')!.textContent).toBe('Walk · Step 1 of 3');
    expect(card()!.textContent).toContain('Create a thing.');
    expect(button('tour-waiting')!.textContent).toContain('Waiting for a thing');
    expect(button('tour-next')).toBeNull();
    expect(document.querySelector('.cdk-overlay-backdrop')).toBeNull();
    expect(shortcutCalls).toBe(1);
  });

  it('moves on only when the condition holds, however the action was done', async () => {
    // Arrange
    void start();
    await settle(showing('create'));

    // Act
    conditions.changes.next(null);
    await settle(() => conditions.checked.length >= 2);
    const stillFirst = card()!.getAttribute('data-step');
    conditions.holds.add('created');
    conditions.changes.next(null);
    await settle(showing('click'));

    // Assert
    expect(stillFirst).toBe('create');
    expect(card()!.querySelector('h2')!.textContent).toBe('Click T-1');
  });

  it('runs a custom action and the click-anchor action from the card', async () => {
    // Arrange
    void start();
    await settle(showing('create'));

    // Act
    button('tour-action')!.click();
    await settle(showing('click'));
    button('tour-action')!.click();

    // Assert
    expect(fixture.componentInstance.clicks).toBe(1);
  });

  it('skips an optional step and ends with Done on the last Next-driven step', async () => {
    // Arrange
    conditions.holds.add('created');
    const result = start();
    await settle(showing('click'));

    // Act
    button('tour-skip-step')!.click();
    await settle(showing('read'));
    const modal = card()!.getAttribute('aria-modal');
    button('tour-next')!.click();

    // Assert
    expect(modal).toBe('true');
    expect(await result).toBe('completed');
  });

  it('resumes at the first step whose condition does not hold', async () => {
    // Arrange
    conditions.holds.add('created');

    // Act
    void start({});
    await settle(showing('click'));

    // Assert
    expect(card()!.querySelector('h2')!.textContent).toBe('Click T-1');
  });

  it('passes over the optional step on resume when asked to', async () => {
    // Arrange
    conditions.holds.add('created');

    // Act
    void start({ skipOptional: true });
    await settle(showing('read'));

    // Assert
    expect(card()!.getAttribute('data-step')).toBe('read');
  });

  it('pauses on navigation elsewhere, shows the pill and continues on the step page', async () => {
    // Arrange
    void start();
    await settle(showing('create'));

    // Act
    await router.navigateByUrl('/other');
    await settle(() => pill() !== null);
    const paused = launcher.paused();
    const cardWhilePaused = card();
    button('tour-pill-continue')!.click();
    await settle(showing('create'));

    // Assert
    expect(paused).toBe(true);
    expect(cardWhilePaused).toBeNull();
    expect(pill()).toBeNull();
    expect(router.url).toBe('/page');
    expect(launcher.paused()).toBe(false);
  });

  it('continues at a later step when the action was done while paused', async () => {
    // Arrange
    void start();
    await settle(showing('create'));
    await router.navigateByUrl('/other');
    await settle(() => pill() !== null);

    // Act
    conditions.holds.add('created');
    expect(launcher.continue()).toBe(true);
    await settle(showing('click'));

    // Assert
    expect(card()!.getAttribute('data-step')).toBe('click');
  });

  it('ends as dismissed from the pill', async () => {
    // Arrange
    const result = start();
    await settle(showing('create'));
    await router.navigateByUrl('/other');
    await settle(() => pill() !== null);

    // Act
    button('tour-pill-close')!.click();

    // Assert
    expect(await result).toBe('dismissed');
    expect(pill()).toBeNull();
  });

  it('hides an action step under the user dialog and comes back when it closes', async () => {
    // Arrange
    void start();
    await settle(showing('create'));

    // Act
    const dialog = createOverlayRef(TestBed.inject(Injector), { hasBackdrop: true });
    dialog.attach(new ComponentPortal(ForeignDialogComponent));
    await settle(() => card()?.classList.contains('pending') ?? false);
    const hidden = card()!.classList.contains('pending');
    dialog.dispose();
    await settle(showing('create'));

    // Assert
    expect(hidden).toBe(true);
    expect(launcher.running()).toBe('tour.walk');
  });

  it('ends on Esc unless the user is typing in a field', async () => {
    // Arrange
    const result = start();
    await settle(showing('create'));
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();

    // Act
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle();
    const runningAfterField = launcher.running();
    input.remove();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    // Assert
    expect(runningAfterField).toBe('tour.walk');
    expect(await result).toBe('dismissed');
  });
});
