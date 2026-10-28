import { computed, inject, Injectable, signal } from '@angular/core';
import { AuthService } from '@core/auth/auth.service';
import { TourLauncher, TourResult } from '@core/onboarding/engine/tour-launcher';
import { ConfirmService } from '@core/notify/confirm.service';
import { ProjectDirectory } from '@core/projects/project-directory';
import { ToastService } from '@core/notify/toast.service';
import {
  PRIORITIES,
  Priority,
  REGRESSION_ITEM_STATUSES,
  SEVERITIES,
  TEST_CASE_STATUSES,
  TICKET_STATUSES,
  TICKET_TYPES,
  TicketStatus,
} from '@shared/domain/enums';
import { SegmentOption } from '@shared/ui/segmented/segmented-control.component';
import { PROTOTYPE_BACKLOG_TOUR, PROTOTYPE_UI_KIT_TOUR } from './tour-prototype';

type Segment = 'all' | 'mine' | 'public';

@Injectable()
export class UiKitStore {
  private readonly toast = inject(ToastService);
  private readonly confirmService = inject(ConfirmService);
  private readonly tours = inject(TourLauncher);
  private readonly projects = inject(ProjectDirectory);
  private readonly auth = inject(AuthService);

  constructor() {
    void this.projects.load();
  }

  readonly types = TICKET_TYPES;
  readonly statuses = TICKET_STATUSES;
  readonly priorities = PRIORITIES;
  readonly severities = SEVERITIES;
  readonly testCaseStatuses = TEST_CASE_STATUSES;
  readonly regressionStatuses = REGRESSION_ITEM_STATUSES;
  readonly labels = ['backend', 'frontend', 'security', 'checkout', 'regression', 'tech-debt'];
  readonly users = [
    { id: '0190f5e2-0000-7000-8000-000000000001', displayName: 'Anna Kowalska' },
    { id: '0190f5e2-0000-7000-8000-000000000002', displayName: 'Marek Wiśniewski' },
    { id: '0190f5e2-0000-7000-8000-000000000003', displayName: 'Jan Nowak', isActive: false },
  ];
  readonly updatedAt = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();

  readonly status = signal<TicketStatus>('InProgress');
  readonly priority = signal<Priority>('High');
  readonly segment = signal<Segment>('all');
  readonly segments: SegmentOption<Segment>[] = [
    { value: 'all', label: 'All', count: 12 },
    { value: 'mine', label: 'Mine', count: 4 },
    { value: 'public', label: 'Public' },
  ];
  readonly markdown = signal(
    '### Steps\n1. Open **checkout**\n2. Pay with a 3-D Secure card\n\nBlocked by PAY-128, see `WEB-TC-7`.\n\n- [x] Reproduced\n- [ ] Fixed\n\n<b>raw html is shown as text</b>',
  );

  /// The first project the user can write to (else the first readable one), for the backlog demo.
  readonly tourProject = computed(() => {
    const projects = this.projects.activeProjects();
    return (
      projects.find((p) => p.myRole === 'Owner' || p.myRole === 'Member') ?? projects[0] ?? null
    );
  });
  readonly tourResult = signal<TourResult | null>(null);

  async startBacklogTour(): Promise<void> {
    const project = this.tourProject();
    if (!project) return;
    const role = project.myRole;
    this.tourResult.set(
      await this.tours.start(PROTOTYPE_BACKLOG_TOUR, {
        access: {
          canWrite: role === 'Owner' || role === 'Member',
          isOwner: role === 'Owner',
          isAdmin: this.auth.isAdmin(),
        },
        params: { projectKey: project.key },
      }),
    );
  }

  async startUiKitTour(): Promise<void> {
    this.tourResult.set(
      await this.tours.start(PROTOTYPE_UI_KIT_TOUR, {
        access: { canWrite: true, isOwner: true, isAdmin: this.auth.isAdmin() },
      }),
    );
  }

  showToast(): void {
    this.toast.success('board.swimlanes turned on', {
      action: { label: 'Undo', run: () => undefined },
    });
  }

  async confirm(): Promise<void> {
    const ok = await this.confirmService.confirm({
      title: 'Delete project PAY?',
      message: 'This cannot be undone.',
      confirmLabel: 'Delete',
      danger: true,
      requireText: 'PAY',
    });
    this.toast.show(ok ? 'Confirmed' : 'Cancelled');
  }
}
