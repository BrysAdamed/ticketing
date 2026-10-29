import { computed, inject, Injectable, Injector } from '@angular/core';
import { isHelpItemEnabled } from '../help/help-menu';
import { HelpMenuRegistry } from '../help/help-menu.registry';
import { TourAvailability } from './tour-availability';
import { tourCommandId } from './tours/tour-catalogue';
import { startFirstProjectWalkthrough } from './walkthrough/first-project.help';

const FIRST_PROJECT_COMMAND_ID = tourCommandId('first-project');

/// What the learn actions of empty states start (spec 14.7, D-143): a per-view tour, loaded on the
/// first start, or the "Your first project" walkthrough through its Help item, which is null while
/// the walkthrough is not registered or not available, so the page hides the action.
@Injectable({ providedIn: 'root' })
export class LearnActions {
  private readonly injector = inject(Injector);
  private readonly tours = inject(TourAvailability);
  private readonly help = inject(HelpMenuRegistry);

  private readonly walkthrough = computed(() => {
    const item = this.help.find(FIRST_PROJECT_COMMAND_ID);
    return item && isHelpItemEnabled(item) ? item : null;
  });

  /// Whether the walkthrough can start now; reactive.
  readonly canStartWalkthrough = computed(() => this.walkthrough() !== null);

  /// Whether the tour of `viewId` can start now; reactive.
  canStartTour(viewId: string): boolean {
    return this.tours.canStart(viewId);
  }

  async startTour(viewId: string): Promise<void> {
    const { GuidedTours } = await import('./guided-tours');
    await this.injector.get(GuidedTours).start(viewId);
  }

  /// Starts the walkthrough; skipOptional passes over the optional status step, so the boards
  /// list resumes at Create a board for a user who already has a project and a ticket (D-142).
  startWalkthrough(options: { readonly skipOptional?: boolean } = {}): void {
    const item = this.walkthrough();
    if (!item) return;
    if (options.skipOptional) void startFirstProjectWalkthrough(this.injector, options);
    else item.run();
  }
}
