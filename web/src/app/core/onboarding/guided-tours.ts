import {
  afterNextRender,
  effect,
  EffectRef,
  inject,
  Injectable,
  Injector,
  untracked,
} from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../auth/auth.service';
import { NavigationContext } from '../layout/navigation-context';
import { OpenProjectState } from '../projects/open-project';
import { TourAnchorRegistry } from './engine/tour-anchor.registry';
import { TourLauncher, TourResult } from './engine/tour-launcher';
import { fillRoute, isAllowed } from './engine/tour-logic';
import { TourAccess, TourDefinition } from './engine/tour.model';
import { storedTourState, tourAccess } from './guided-tours.logic';
import { OnboardingStateService } from './onboarding-state.service';
import { TourAvailability } from './tour-availability';
import { pathNeedsProject } from './tours/tour-catalogue';
import { ViewTourAccess } from './view-tour-access';

const VIEW_TIMEOUT_MS = 8000;
const ANCHOR_TIMEOUT_MS = 4000;

export interface GuidedTourOptions {
  /// Where focus goes when the tour ends. Defaults to the element focused when the first step
  /// opens, after the Help menu or the palette has closed and given focus back to its trigger.
  readonly returnFocusTo?: HTMLElement | null;
  /// Project to open when the tour starts away from its view (default: `pickTourProject`).
  readonly projectKey?: string;
}

/// Starts the tour of a view (spec 14.4): works out what the user may do there, opens the view
/// first when the tour was asked for elsewhere, and stores Completed or Dismissed in the
/// onboarding state at the tour's version. Entry points (Help menu, palette, welcome dialog,
/// empty states) import it lazily (`await import('@core/onboarding/guided-tours')`) and call
/// `start`, never `TourLauncher` directly; `TourAvailability` says whether a tour can start.
@Injectable({ providedIn: 'root' })
export class GuidedTours {
  private readonly injector = inject(Injector);
  private readonly router = inject(Router);
  private readonly navigation = inject(NavigationContext);
  private readonly openProject = inject(OpenProjectState);
  private readonly auth = inject(AuthService);
  private readonly onboarding = inject(OnboardingStateService);
  private readonly launcher = inject(TourLauncher);
  private readonly anchors = inject(TourAnchorRegistry);
  private readonly availability = inject(TourAvailability);
  private readonly viewAccess = inject(ViewTourAccess);

  /// Id of the running tour, or null.
  readonly running = this.launcher.running;

  /// Whether the user completed or dismissed this version of the tour (or a later one).
  isSeen(tour: TourDefinition): boolean {
    return this.onboarding.isSeen(tour.id, tour.version);
  }

  startCurrent(options: GuidedTourOptions = {}): Promise<TourResult | null> {
    const viewId = this.navigation.currentViewId();
    return viewId ? this.start(viewId, options) : Promise.resolve(null);
  }

  /// Runs the tour of `viewId` and resolves how it ended, or null when there is no such tour or
  /// its view could not be opened.
  async start(viewId: string, options: GuidedTourOptions = {}): Promise<TourResult | null> {
    const entry = this.availability.entry(viewId);
    if (!entry) return null;
    const definition = entry.load();
    const params: Record<string, string> = {};
    if (this.navigation.currentViewId() !== viewId) {
      if (!entry.path) return null;
      if (pathNeedsProject(entry.path)) {
        const projectKey = options.projectKey ?? this.availability.targetProject();
        if (!projectKey) return null;
        params['projectKey'] = projectKey;
      }
      if (!(await this.open(entry.path, params, viewId))) return null;
      await this.anchorsReady(await definition);
    }
    const tour = await definition;
    const result = await this.launcher.start(tour, {
      access: this.access(viewId),
      params,
      returnFocusTo: options.returnFocusTo,
    });
    const state = storedTourState(result);
    if (state === 'Completed') await this.onboarding.complete(tour.id, tour.version);
    else if (state === 'Dismissed') await this.onboarding.dismiss(tour.id, tour.version);
    return result;
  }

  /// The access the view reports (D-138), else the open project's role.
  private access(viewId: string): TourAccess {
    return (
      this.viewAccess.get(viewId) ?? tourAccess(this.openProject.project(), this.auth.isAdmin())
    );
  }

  private async open(
    path: string,
    params: Record<string, string>,
    viewId: string,
  ): Promise<boolean> {
    if (!(await this.router.navigateByUrl(fillRoute(path, params)))) return false;
    const key = params['projectKey']?.toUpperCase();
    return this.until(
      () =>
        this.navigation.currentViewId() === viewId &&
        (!key || this.openProject.project()?.key === key),
      VIEW_TIMEOUT_MS,
    );
  }

  /// After opening a view, waits until its first step the user may see has its anchor (the view
  /// loads its data first) and one more render for the others.
  private async anchorsReady(tour: TourDefinition): Promise<void> {
    const access = this.access(tour.viewId);
    const first = tour.steps.find((step) => isAllowed(step, access));
    if (!first) return;
    await this.anchors.whenAvailable(first.anchor, ANCHOR_TIMEOUT_MS);
    await new Promise<void>((resolve) =>
      afterNextRender(() => resolve(), { injector: this.injector }),
    );
  }

  private until(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      let watch: EffectRef | null = null;
      const finish = (value: boolean) => {
        clearTimeout(timer);
        watch?.destroy();
        resolve(value);
      };
      const timer = setTimeout(() => finish(false), timeoutMs);
      watch = effect(
        () => {
          if (predicate()) untracked(() => finish(true));
        },
        { injector: this.injector },
      );
    });
  }
}
