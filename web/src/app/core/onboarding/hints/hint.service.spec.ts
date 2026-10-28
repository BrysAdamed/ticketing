import { computed, provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TourLauncher } from '../engine/tour-launcher';
import { hintById } from '../guides/hints';
import { OnboardingStateService } from '../onboarding-state.service';
import { HintService } from './hint.service';

const FREE = hintById('hint.free-transitions');
const BACKLOG = hintById('hint.backlog-vs-boards');

const flush = () => new Promise<void>((resolve) => setTimeout(resolve));

describe('HintService', () => {
  const loaded = signal(true);
  const seen = signal<ReadonlyMap<string, number>>(new Map());
  const running = signal<string | null>(null);
  let dismiss: ReturnType<typeof vi.fn>;
  let service: HintService;

  function place(): HTMLElement {
    return document.body.appendChild(document.createElement('div'));
  }

  beforeEach(() => {
    loaded.set(true);
    seen.set(new Map());
    running.set(null);
    dismiss = vi.fn((id: string, version: number) => {
      seen.update((map) => new Map(map).set(id, version));
      return Promise.resolve(true);
    });
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        {
          provide: OnboardingStateService,
          useValue: {
            loaded: computed(() => loaded()),
            isSeen: (id: string, version: number) => (seen().get(id) ?? 0) >= version,
            dismiss,
          },
        },
        { provide: TourLauncher, useValue: { running } },
      ],
    });
    service = TestBed.inject(HintService);
  });

  afterEach(() => (document.body.innerHTML = ''));

  it('shows the first registered hint and, once it is dismissed, the next one', async () => {
    // Arrange
    const first = service.register(BACKLOG, place(), () => true);
    const second = service.register(FREE, place(), () => true);
    expect(service.visible()).toBe(first.token);

    // Act
    await service.dismiss(BACKLOG);

    // Assert
    expect(dismiss).toHaveBeenCalledWith('hint.backlog-vs-boards', 1);
    expect(service.visible()).toBe(second.token);
  });

  it('brings a dismissed hint back when every guide is restarted', async () => {
    // Arrange
    const slot = service.register(BACKLOG, place(), () => true);
    await service.dismiss(BACKLOG);
    expect(service.visible()).toBeNull();

    // Act
    seen.set(new Map());

    // Assert
    expect(service.visible()).toBe(slot.token);
  });

  it('waits for the onboarding state', () => {
    // Arrange
    loaded.set(false);
    const slot = service.register(BACKLOG, place(), () => true);
    expect(service.visible()).toBeNull();

    // Act
    loaded.set(true);

    // Assert
    expect(service.visible()).toBe(slot.token);
  });

  it('hides hints while a tour runs', () => {
    // Arrange
    const slot = service.register(BACKLOG, place(), () => true);

    // Act
    running.set('tour.backlog.list');

    // Assert
    expect(service.visible()).toBeNull();
    running.set(null);
    expect(service.visible()).toBe(slot.token);
  });

  it('hides a write hint from a Viewer and follows the permission as it changes', () => {
    // Arrange
    const canWrite = signal(false);
    const slot = service.register(FREE, place(), () => canWrite());
    expect(service.visible()).toBeNull();

    // Act
    canWrite.set(true);

    // Assert
    expect(service.visible()).toBe(slot.token);
  });

  it('hides a page hint while a dialog backdrop is open', async () => {
    // Arrange
    const slot = service.register(BACKLOG, place(), () => true);
    const backdrop = document.createElement('div');
    backdrop.className = 'cdk-overlay-backdrop';

    // Act
    document.body.appendChild(backdrop);
    await flush();

    // Assert
    expect(service.visible()).toBeNull();
    backdrop.remove();
    await flush();
    expect(service.visible()).toBe(slot.token);
  });

  it('forgets a hint that was unregistered', () => {
    // Arrange
    const first = service.register(BACKLOG, place(), () => true);
    const second = service.register(FREE, place(), () => true);

    // Act
    first.unregister();

    // Assert
    expect(service.visible()).toBe(second.token);
  });
});
