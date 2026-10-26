import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ApiClient } from '@core/api/api-client';
import { ApiError, toApiError } from '@core/api/api-error';
import { FieldHints } from '@core/tickets/field-hints';
import { TicketEvents } from '@core/tickets/ticket-events';
import { debounceTime, firstValueFrom } from 'rxjs';
import { DashboardLinks } from './dashboard-links';
import { ProjectDashboard } from './dashboard.model';

const SKELETON_DELAY_MS = 120;
const SKELETON_MIN_MS = 250;
const REFRESH_AFTER_EDIT_MS = 800;

/// What the page shows: nothing yet (first 120 ms), skeleton tiles, the data, or an error panel.
export type DashboardPhase = 'blank' | 'skeleton' | 'ready' | 'error';

/// State of the project dashboard: one request for all widgets (spec §7), version filter,
/// stale-while-revalidate refetches, and a quiet refresh after ticket edits elsewhere in the app.
@Injectable()
export class DashboardStore {
  private readonly api = inject(ApiClient);
  private readonly hints = inject(FieldHints);

  readonly projectKey = signal('');
  readonly version = signal<string | null>(null);
  readonly data = signal<ProjectDashboard | null>(null);
  readonly phase = signal<DashboardPhase>('blank');
  readonly refreshing = signal(false);
  readonly error = signal<ApiError | null>(null);
  readonly versions = signal<string[]>([]);

  readonly links = computed(() => new DashboardLinks(this.projectKey(), this.version()));
  readonly isEmpty = computed(() => {
    const data = this.data();
    return (
      data !== null &&
      data.version === null &&
      data.totals.openTickets + data.totals.doneTickets === 0 &&
      data.testCases.total === 0 &&
      data.regressions.latest === null
    );
  });

  private request = 0;

  constructor() {
    inject(TicketEvents)
      .events.pipe(debounceTime(REFRESH_AFTER_EDIT_MS), takeUntilDestroyed(inject(DestroyRef)))
      .subscribe(() => {
        if (this.projectKey()) void this.fetch();
      });
  }

  load(projectKey: string, version: string | null): void {
    const key = projectKey.toUpperCase();
    const projectChanged = key !== this.projectKey();
    if (!projectChanged && version === this.version() && this.phase() !== 'error') return;
    this.projectKey.set(key);
    this.version.set(version);
    if (projectChanged) {
      this.data.set(null);
      void this.loadVersions(key);
    }
    void this.fetch();
  }

  retry(): void {
    void this.fetch();
  }

  private async fetch(): Promise<void> {
    const request = ++this.request;
    const firstLoad = this.data() === null;
    let skeletonShownAt: number | null = null;
    const timer = firstLoad
      ? setTimeout(() => {
          if (request !== this.request) return;
          skeletonShownAt = performance.now();
          this.phase.set('skeleton');
        }, SKELETON_DELAY_MS)
      : undefined;
    if (firstLoad && this.phase() !== 'skeleton') this.phase.set('blank');
    this.refreshing.set(!firstLoad);
    this.error.set(null);

    try {
      const data = await firstValueFrom(
        this.api.get<ProjectDashboard>(`/projects/${this.projectKey()}/dashboard`, {
          version: this.version(),
        }),
      );
      clearTimeout(timer);
      if (skeletonShownAt !== null) {
        const shownFor = performance.now() - skeletonShownAt;
        if (shownFor < SKELETON_MIN_MS) await delay(SKELETON_MIN_MS - shownFor);
      }
      if (request !== this.request) return;
      this.data.set(data);
      this.phase.set('ready');
    } catch (error) {
      clearTimeout(timer);
      if (request !== this.request) return;
      this.error.set(toApiError(error));
      if (this.data() === null) this.phase.set('error');
    } finally {
      if (request === this.request) this.refreshing.set(false);
    }
  }

  private async loadVersions(projectKey: string): Promise<void> {
    const versions = await this.hints.get(projectKey, 'version');
    if (projectKey === this.projectKey()) this.versions.set(versions);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
