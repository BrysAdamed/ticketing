import { computed, inject, Injectable, Injector } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { isHelpItemEnabled } from '../help/help-menu';
import { HelpMenuRegistry } from '../help/help-menu.registry';
import { TourAvailability } from './tour-availability';
import { tourCommandId } from './tours/tour-catalogue';
import { startFirstProjectWalkthrough } from './walkthrough/first-project.help';

const FIRST_PROJECT_COMMAND_ID = tourCommandId('first-project');

/// What the learn actions of empty states start (spec 14.7, D-143): a per-view tour, loaded on the
/// first start, or the "Your first project" walkthrough through its Help item, which is null while
/// the walkthrough is not registered or not available, so the page hides the action. Also the front
/// door of Show me on achievements (D-154, D-169), Help items and the regressions explainer included.
@Injectable({ providedIn: 'root' })
export class LearnActions {
  private readonly injector = inject(Injector);
  private readonly tours = inject(TourAvailability);
  private readonly help = inject(HelpMenuRegistry);
  private readonly dialog = inject(MatDialog);

  private readonly walkthrough = computed(() => {
    const item = this.help.find(FIRST_PROJECT_COMMAND_ID);
    return item && isHelpItemEnabled(item) ? item : null;
  });

  /// Whether the walkthrough can start now; reactive.
  readonly canStartWalkthrough = computed(() => this.walkthrough() !== null);

  /// Whether the tour of `viewId` can start now; reactive. A tour that opens a ticket, a board or a
  /// session first turns true only after `prepareTour` found one.
  canStartTour(viewId: string): boolean {
    return this.tours.canStart(viewId);
  }

  /// Looks up what the tour of `viewId` opens away from its view (D-169); call it when showing the
  /// action.
  prepareTour(viewId: string): void {
    this.tours.prepare(viewId);
  }

  /// Starts the tour of `viewId`, at the step `options.step` when the user may see it.
  async startTour(viewId: string, options: { readonly step?: string } = {}): Promise<void> {
    const { GuidedTours } = await import('./guided-tours');
    await this.injector.get(GuidedTours).start(viewId, options);
  }

  /// Opens "How regressions work", the explainer of the regressions list (D-169).
  async openRegressionsExplainer(): Promise<void> {
    const { RegressionsExplainerDialog } = await import('./dialogs/regressions-explainer.dialog');
    this.dialog.open(RegressionsExplainerDialog, {
      width: '480px',
      autoFocus: 'first-tabbable',
      ariaLabelledBy: 'regressions-explainer-title',
    });
  }

  /// Whether the Help item `id` (for example `help.connect-agent`) is registered and enabled now;
  /// reactive.
  canRunHelpItem(id: string): boolean {
    const item = this.help.find(id);
    return !!item && isHelpItemEnabled(item);
  }

  /// Runs the Help item `id` while it is registered and enabled; does nothing otherwise.
  runHelpItem(id: string): void {
    const item = this.help.find(id);
    if (item && isHelpItemEnabled(item)) item.run();
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
