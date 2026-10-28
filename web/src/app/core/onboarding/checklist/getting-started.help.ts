import { EnvironmentProviders, inject } from '@angular/core';
import { Router } from '@angular/router';
import { HELP_MENU_ORDER } from '../../help/help-menu';
import { provideHelpMenuItem } from '../../help/help-menu.registry';
import { GettingStartedService } from './getting-started.service';

export const GETTING_STARTED_HELP_ID = 'help.getting-started';

/// Help → Getting started (spec 14.6): opens My work with the checklist card, also after it was
/// dismissed or completed. The trailing hint shows the progress, for example "3 of 8".
export function provideGettingStartedHelp(): EnvironmentProviders {
  return provideHelpMenuItem(() => {
    const checklist = inject(GettingStartedService);
    const router = inject(Router);
    return {
      id: GETTING_STARTED_HELP_ID,
      label: 'Getting started',
      icon: 'tablerChecks',
      order: HELP_MENU_ORDER.gettingStarted,
      keywords: ['checklist', 'onboarding', 'first steps'],
      visible: () => checklist.loaded(),
      hint: () => {
        const { done, total } = checklist.progress();
        return total > 0 ? `${done} of ${total}` : null;
      },
      run: () => {
        void checklist.restore();
        void router.navigateByUrl('/my-work');
      },
    };
  });
}
