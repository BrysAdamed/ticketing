import { EnvironmentProviders, inject, Injector, makeEnvironmentProviders } from '@angular/core';
import { HELP_MENU_ORDER } from '../../help/help-menu';
import { provideHelpMenuItem } from '../../help/help-menu.registry';
import { TourLauncher, TourResult } from '../engine/tour-launcher';
import { tourCommandId } from '../tours/tour-catalogue';
import type { FirstProjectStartOptions } from './first-project-walkthrough';

/// Help menu item and palette command of the walkthrough (`help.tour.first-project`).
export const FIRST_PROJECT_HELP_ID = tourCommandId('first-project');

/// Starts the "Your first project" walkthrough from any entry point (Help menu, palette, welcome
/// dialog, empty states): loads it lazily, so callers keep it out of their chunk. Continues it
/// when it is paused. Resolves how it ended, or null when the user cancelled the start choice.
export async function startFirstProjectWalkthrough(
  injector: Injector,
  options: FirstProjectStartOptions = {},
): Promise<TourResult | null> {
  const { FirstProjectWalkthrough } = await import('./first-project-walkthrough');
  return injector.get(FirstProjectWalkthrough).start(options);
}

/// Registers "Your first project" in the Help menu and the palette for every signed-in user: any
/// active user can create a project (D-18). While the walkthrough is paused it continues it.
export function provideFirstProjectWalkthrough(): EnvironmentProviders {
  return makeEnvironmentProviders([
    provideHelpMenuItem(() => {
      const injector = inject(Injector);
      const launcher = inject(TourLauncher);
      return {
        id: FIRST_PROJECT_HELP_ID,
        label: 'Your first project',
        icon: 'tablerRoute',
        order: HELP_MENU_ORDER.firstProject,
        keywords: ['walkthrough', 'tour', 'guide', 'onboarding', 'sandbox', 'project'],
        hint: () => (launcher.paused() ? 'Paused' : null),
        run: () => void startFirstProjectWalkthrough(injector),
      };
    }),
  ]);
}
