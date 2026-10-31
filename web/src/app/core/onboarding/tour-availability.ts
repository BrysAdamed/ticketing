import {
  computed,
  DestroyRef,
  EnvironmentProviders,
  inject,
  Injectable,
  InjectionToken,
  Injector,
  makeEnvironmentProviders,
  provideEnvironmentInitializer,
} from '@angular/core';
import { AuthService } from '../auth/auth.service';
import { HELP_MENU_ORDER, TOUR_OF_PAGE_ID } from '../help/help-menu';
import { HelpMenuRegistry, provideHelpMenuItem } from '../help/help-menu.registry';
import { NavigationContext } from '../layout/navigation-context';
import { OpenProjectState } from '../projects/open-project';
import { ProjectDirectory } from '../projects/project-directory';
import { meetsRequirement } from './engine/tour-logic';
import { pickTourProject, tourAccess } from './guided-tours.logic';
import {
  pathNeedsProject,
  TOUR_CATALOGUE,
  TourCatalogueEntry,
  tourCommandId,
} from './tours/tour-catalogue';
import { TourTargets } from './tour-targets';
import { ViewTourAccess } from './view-tour-access';

/// The tours the app offers; tests replace it.
export const TOURS = new InjectionToken<readonly TourCatalogueEntry[]>('TOURS', {
  factory: () => TOUR_CATALOGUE,
});

/// Which tours can start right now. Eager and tiny, so the Help menu can enable its items; the
/// engine, the tour copy and `GuidedTours` load on the first start.
@Injectable({ providedIn: 'root' })
export class TourAvailability {
  private readonly navigation = inject(NavigationContext);
  private readonly directory = inject(ProjectDirectory);
  private readonly openProject = inject(OpenProjectState);
  private readonly auth = inject(AuthService);
  private readonly viewAccess = inject(ViewTourAccess);
  private readonly targets = inject(TourTargets);

  readonly entries = inject(TOURS);
  /// The tour of the view on screen when the user is in its audience, or null.
  readonly current = computed(() => {
    const entry = this.entry(this.navigation.currentViewId());
    return entry && this.isForUser(entry) ? entry : null;
  });

  entry(viewId: string | null): TourCatalogueEntry | undefined {
    return this.entries.find((e) => e.viewId === viewId);
  }

  /// Whether the tour of `viewId` can start now: the user is in its audience and on that view, or
  /// the view needs at most a project and there is one to open, or `prepare` found what it opens.
  canStart(viewId: string): boolean {
    const entry = this.entry(viewId);
    if (!entry || !this.isForUser(entry)) return false;
    if (this.navigation.currentViewId() === viewId) return true;
    if (entry.opens) return this.targets.get(entry.opens) !== null;
    if (!entry.path) return false;
    return !pathNeedsProject(entry.path) || this.targetProject() !== null;
  }

  /// Looks up what the tour of `viewId` opens when it has `opens` and the user is elsewhere, so
  /// `canStart` can turn true; does nothing for other tours.
  prepare(viewId: string): void {
    const entry = this.entry(viewId);
    if (entry?.opens && this.navigation.currentViewId() !== viewId) {
      void this.targets.prepare(entry.opens);
    }
  }

  /// The project a tour started away from its view opens (`pickTourProject`).
  targetProject(): string | null {
    return pickTourProject(this.directory.projects(), this.navigation.projectKey());
  }

  private isForUser(entry: TourCatalogueEntry): boolean {
    return meetsRequirement(
      entry.requires,
      this.viewAccess.get(entry.viewId) ??
        tourAccess(this.openProject.project(), this.auth.isAdmin()),
    );
  }
}

/// Registers the tour entries of the Help menu and the palette (spec 14.6): "Tour of this page",
/// enabled only on a view with a tour, and one palette command per tour, `help.tour.<viewId>`.
export function provideGuidedTours(): EnvironmentProviders {
  return makeEnvironmentProviders([
    provideHelpMenuItem(() => {
      const tours = inject(TourAvailability);
      const injector = inject(Injector);
      return {
        id: TOUR_OF_PAGE_ID,
        label: 'Tour of this page',
        icon: 'tablerCompass',
        order: HELP_MENU_ORDER.tourOfPage,
        keywords: ['tour', 'guide', 'onboarding', 'walkthrough'],
        disabled: () => tours.current() === null,
        hint: () => (tours.current() === null ? 'No tour here' : null),
        run: () => void startTour(injector, null),
      };
    }),
    provideEnvironmentInitializer(() => {
      const tours = inject(TourAvailability);
      const help = inject(HelpMenuRegistry);
      const injector = inject(Injector);
      const destroyRef = inject(DestroyRef);
      for (const entry of tours.entries) {
        help.register(
          {
            id: tourCommandId(entry.viewId),
            label: `${entry.title} tour`,
            icon: 'tablerCompass',
            order: HELP_MENU_ORDER.tourOfPage,
            keywords: ['tour', 'guide', 'onboarding'],
            menu: false,
            disabled: () => !tours.canStart(entry.viewId),
            run: () => void startTour(injector, entry.viewId),
          },
          destroyRef,
        );
      }
    }),
  ]);
}

async function startTour(injector: Injector, viewId: string | null): Promise<void> {
  const { GuidedTours } = await import('./guided-tours');
  const tours = injector.get(GuidedTours);
  await (viewId ? tours.start(viewId) : tours.startCurrent());
}
