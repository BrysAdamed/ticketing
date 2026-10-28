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
import { HELP_MENU_ORDER, TOUR_OF_PAGE_ID } from '../help/help-menu';
import { HelpMenuRegistry, provideHelpMenuItem } from '../help/help-menu.registry';
import { NavigationContext } from '../layout/navigation-context';
import { ProjectDirectory } from '../projects/project-directory';
import { pickTourProject } from './guided-tours.logic';
import { TOUR_CATALOGUE, TourCatalogueEntry, tourCommandId } from './tours/tour-catalogue';

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

  readonly entries = inject(TOURS);
  /// The tour of the view on screen, or null.
  readonly current = computed(() => this.entry(this.navigation.currentViewId()) ?? null);

  entry(viewId: string | null): TourCatalogueEntry | undefined {
    return this.entries.find((e) => e.viewId === viewId);
  }

  /// Whether the tour of `viewId` can start now: the user is on that view, or the view needs only
  /// a project and there is one to open.
  canStart(viewId: string): boolean {
    const entry = this.entry(viewId);
    if (!entry) return false;
    if (this.navigation.currentViewId() === viewId) return true;
    return !!entry.path && this.targetProject() !== null;
  }

  /// The project a tour started away from its view opens (`pickTourProject`).
  targetProject(): string | null {
    return pickTourProject(this.directory.projects(), this.navigation.projectKey());
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
