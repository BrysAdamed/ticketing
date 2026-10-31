import { computed, provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideIcons } from '@ng-icons/core';
import { Subject } from 'rxjs';
import { ApiClient } from '@core/api/api-client';
import { HelpMenuItem } from '@core/help/help-menu';
import { HelpMenuRegistry } from '@core/help/help-menu.registry';
import { GuideProgress, OnboardingChecklistItem } from '@core/onboarding/onboarding.models';
import {
  OnboardingStateService,
  OnboardingStatus,
} from '@core/onboarding/onboarding-state.service';
import { ProjectDirectory } from '@core/projects/project-directory';
import { TicketCreator } from '@core/tickets/create-ticket';
import { APP_ICONS } from '@shared/ui/icon/app-icons';
import { ChecklistCardComponent, WRITE_REFRESH_DEBOUNCE_MS } from './checklist-card.component';

function item(id: string, done = false, optional = false): OnboardingChecklistItem {
  return { id, done, optional };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve));

describe('ChecklistCardComponent', () => {
  const status = signal<OnboardingStatus>('ready');
  const checklist = signal<OnboardingChecklistItem[]>([]);
  const guides = signal<ReadonlyMap<string, GuideProgress>>(new Map());
  const helpItems = signal<HelpMenuItem[]>([]);
  let onboarding: Record<'complete' | 'dismiss' | 'forget' | 'load', ReturnType<typeof vi.fn>>;
  let creator: { open: ReturnType<typeof vi.fn> };
  let writes: Subject<void>;

  afterEach(() => vi.useRealTimers());

  async function render(): Promise<HTMLElement> {
    const fixture = TestBed.createComponent(ChecklistCardComponent);
    fixture.detectChanges();
    await flush();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const testId = (element: HTMLElement, id: string) =>
    element.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

  beforeEach(() => {
    status.set('ready');
    checklist.set([
      item('create-ticket'),
      item('move-work', true),
      item('join-conversation'),
      item('follow-ticket', true),
      item('invite-team'),
      item('agent-token', false, true),
      item('agent-connected', false, true),
    ]);
    guides.set(new Map());
    helpItems.set([]);
    onboarding = {
      complete: vi.fn().mockResolvedValue(true),
      dismiss: vi.fn().mockResolvedValue(true),
      forget: vi.fn().mockResolvedValue(true),
      load: vi.fn().mockResolvedValue(undefined),
    };
    creator = { open: vi.fn().mockResolvedValue(null) };
    writes = new Subject<void>();
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        provideIcons(APP_ICONS),
        {
          provide: OnboardingStateService,
          useValue: {
            ...onboarding,
            status,
            loaded: computed(() => status() === 'ready'),
            checklist,
            guides,
            isSeen: (id: string, version: number) => (guides().get(id)?.version ?? 0) >= version,
          },
        },
        {
          provide: ProjectDirectory,
          useValue: {
            load: vi.fn().mockResolvedValue(undefined),
            activeProjects: signal([{ id: '1', key: 'PAY', name: 'Payments', myRole: 'Owner' }]),
          },
        },
        { provide: TicketCreator, useValue: creator },
        { provide: ApiClient, useValue: { writes } },
        { provide: HelpMenuRegistry, useValue: { items: helpItems } },
      ],
    });
  });

  it('shows progress over required items, done marks, the next step and the optional group', async () => {
    // Act
    const element = await render();

    // Assert
    expect(testId(element, 'checklist-progress')?.textContent?.trim()).toBe('2 of 5');
    expect(testId(element, 'checklist-item-move-work')?.getAttribute('data-done')).toBe('true');
    const next = testId(element, 'checklist-item-create-ticket');
    expect(next?.classList).toContain('next');
    expect(next?.textContent).toContain('Press C');
    expect(element.textContent).toContain('Your projects');
    expect(element.textContent).toContain('Optional');
    expect(testId(element, 'checklist-read-only')).toBeNull();
    expect(onboarding.load).toHaveBeenCalled();
  });

  it('links each open item to where its action is done', async () => {
    // Act
    const element = await render();

    // Assert
    expect(testId(element, 'checklist-item-join-conversation')?.getAttribute('href')).toBe(
      '/projects/PAY/backlog',
    );
    expect(testId(element, 'checklist-item-invite-team')?.getAttribute('href')).toBe(
      '/projects/PAY/settings',
    );
    expect(testId(element, 'checklist-item-agent-token')?.getAttribute('href')).toBe(
      '/profile/tokens?guide=connect-agent',
    );
  });

  it('opens the create-ticket dialog for Create a ticket and dismisses with the close button', async () => {
    // Arrange
    const element = await render();

    // Act
    testId(element, 'checklist-item-create-ticket')?.click();
    testId(element, 'checklist-dismiss')?.click();

    // Assert
    expect(creator.open).toHaveBeenCalled();
    expect(onboarding.dismiss).toHaveBeenCalledWith('checklist', 1);
  });

  it('explains the missing write items to a user who cannot write anywhere', async () => {
    // Arrange
    checklist.set([item('follow-ticket'), item('agent-token', false, true)]);

    // Act
    const element = await render();

    // Assert
    expect(testId(element, 'checklist-read-only')).not.toBeNull();
    expect(testId(element, 'checklist-progress')?.textContent?.trim()).toBe('0 of 1');
  });

  it('shows the completed state and stores completion, optional items aside', async () => {
    // Arrange
    checklist.set([item('follow-ticket', true), item('agent-token', false, true)]);

    // Act
    const element = await render();

    // Assert
    expect(testId(element, 'checklist-completed')).not.toBeNull();
    expect(onboarding.complete).toHaveBeenCalledWith('checklist', 1);
  });

  it('shows a skeleton while loading and nothing once dismissed', async () => {
    // Arrange
    status.set('loading');

    // Act
    const loading = await render();

    // Assert
    expect(testId(loading, 'checklist-skeleton')).not.toBeNull();

    // Arrange
    status.set('ready');
    guides.set(
      new Map([
        ['checklist', { guideId: 'checklist', version: 1, state: 'Dismissed', updatedAt: '' }],
      ]),
    );

    // Act
    const hidden = await render();

    // Assert
    expect(testId(hidden, 'checklist-card')).toBeNull();
    expect(testId(hidden, 'checklist-skeleton')).toBeNull();
  });

  it('refreshes once after a burst of app writes settles while the card is visible', async () => {
    // Arrange
    await render();
    onboarding.load.mockClear();
    vi.useFakeTimers();

    // Act
    writes.next();
    vi.advanceTimersByTime(WRITE_REFRESH_DEBOUNCE_MS - 1);
    writes.next();
    vi.advanceTimersByTime(WRITE_REFRESH_DEBOUNCE_MS - 1);
    const beforeSettled = onboarding.load.mock.calls.length;
    vi.advanceTimersByTime(1);

    // Assert
    expect(beforeSettled).toBe(0);
    expect(onboarding.load).toHaveBeenCalledTimes(1);
  });

  it('does not refresh after writes while the card is hidden, and never without a write', async () => {
    // Arrange
    guides.set(
      new Map([
        ['checklist', { guideId: 'checklist', version: 1, state: 'Dismissed', updatedAt: '' }],
      ]),
    );
    await render();
    onboarding.load.mockClear();
    vi.useFakeTimers();

    // Act
    vi.advanceTimersByTime(WRITE_REFRESH_DEBOUNCE_MS * 10);
    writes.next();
    vi.advanceTimersByTime(WRITE_REFRESH_DEBOUNCE_MS);

    // Assert
    expect(onboarding.load).not.toHaveBeenCalled();
  });

  it('stops listening for writes once destroyed', async () => {
    // Arrange
    const fixture = TestBed.createComponent(ChecklistCardComponent);
    fixture.detectChanges();
    await flush();
    onboarding.load.mockClear();
    vi.useFakeTimers();

    // Act
    writes.next();
    fixture.destroy();
    vi.advanceTimersByTime(WRITE_REFRESH_DEBOUNCE_MS);

    // Assert
    expect(onboarding.load).not.toHaveBeenCalled();
  });

  it('offers the first-project walkthrough only when it is registered', async () => {
    // Arrange
    const run = vi.fn();
    const without = await render();
    const footerBefore = without.querySelector('.ck-foot');
    helpItems.set([
      { id: 'help.tour.first-project', label: 'Your first project', icon: 'x', order: 200, run },
    ]);

    // Act
    const element = await render();
    (element.querySelector('.ck-foot button') as HTMLElement).click();

    // Assert
    expect(footerBefore).toBeNull();
    expect(run).toHaveBeenCalled();
  });
});
