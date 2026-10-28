import { inject, Injectable, Injector } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { isHelpItemEnabled } from '../../help/help-menu';
import { HelpMenuRegistry } from '../../help/help-menu.registry';
import { ProjectDirectory } from '../../projects/project-directory';
import { dueWhatsNew, pickWritableProject } from '../auto-dialogs.logic';
import { GettingStartedService } from '../checklist/getting-started.service';
import { WELCOME_GUIDE } from '../guides/welcome';
import { WhatsNewEntry } from '../guides/whats-new';
import { OnboardingStateService } from '../onboarding-state.service';
import { tourCommandId } from '../tours/tour-catalogue';
import { WelcomeChoice, WelcomeDialog } from './welcome.dialog';
import { WhatsNewDialog, WhatsNewDialogData } from './whats-new.dialog';

export const WELCOME_DIALOG_ID = 'tk-welcome';
export const WHATS_NEW_DIALOG_ID = 'tk-whats-new';
const BACKLOG_VIEW_ID = 'backlog.list';
const FIRST_PROJECT_COMMAND_ID = tourCommandId('first-project');

/// Opens the welcome and What's new dialogs, records how they were closed and runs the chosen
/// action. Loaded on first use by `OnboardingDialogs`, never part of the initial bundle.
@Injectable({ providedIn: 'root' })
export class OnboardingDialogRunner {
  private readonly injector = inject(Injector);
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);
  private readonly onboarding = inject(OnboardingStateService);
  private readonly checklist = inject(GettingStartedService);
  private readonly directory = inject(ProjectDirectory);
  private readonly help = inject(HelpMenuRegistry);

  /// Take the tour and Show me the checklist store `welcome` Completed; Esc, × or the backdrop
  /// store it Dismissed.
  async openWelcome(): Promise<void> {
    if (this.dialog.getDialogById(WELCOME_DIALOG_ID)) return;
    const ref = this.dialog.open<WelcomeDialog, unknown, WelcomeChoice>(WelcomeDialog, {
      id: WELCOME_DIALOG_ID,
      width: '540px',
      autoFocus: 'first-tabbable',
      role: 'dialog',
      ariaModal: true,
    });
    const choice = await firstValueFrom(ref.afterClosed());
    const { id, version } = WELCOME_GUIDE;
    void (choice ? this.onboarding.complete(id, version) : this.onboarding.dismiss(id, version));
    if (choice === 'tour') await this.takeTour();
    else if (choice === 'checklist') await this.showChecklist();
  }

  /// Got it stores the entries the user had not seen as Completed, any other close as Dismissed.
  async openWhatsNew(entries: readonly WhatsNewEntry[]): Promise<void> {
    if (entries.length === 0 || this.dialog.getDialogById(WHATS_NEW_DIALOG_ID)) return;
    const ref = this.dialog.open<WhatsNewDialog, WhatsNewDialogData, boolean>(WhatsNewDialog, {
      id: WHATS_NEW_DIALOG_ID,
      width: '560px',
      autoFocus: 'first-tabbable',
      role: 'dialog',
      ariaModal: true,
      data: { entries },
    });
    const done = await firstValueFrom(ref.afterClosed());
    const isSeen = (guideId: string, v: number) => this.onboarding.isSeen(guideId, v);
    for (const { id, version } of dueWhatsNew(entries, isSeen, this.onboarding.createdAt()))
      void (done ? this.onboarding.complete(id, version) : this.onboarding.dismiss(id, version));
  }

  /// Coordinator decision 6: the backlog tour of the most recently updated writable project;
  /// without one, the "Your first project" walkthrough once it is registered, else the checklist.
  private async takeTour(): Promise<void> {
    if (this.directory.status() !== 'loaded') await this.directory.reload();
    const projectKey = pickWritableProject(this.directory.projects());
    if (projectKey) {
      const { GuidedTours } = await import('../guided-tours');
      const result = await this.injector.get(GuidedTours).start(BACKLOG_VIEW_ID, { projectKey });
      if (result === null) await this.showChecklist();
      return;
    }
    const walkthrough = this.help.find(FIRST_PROJECT_COMMAND_ID);
    if (walkthrough && isHelpItemEnabled(walkthrough)) walkthrough.run();
    else await this.showChecklist();
  }

  private async showChecklist(): Promise<void> {
    void this.checklist.restore();
    await this.router.navigateByUrl('/my-work');
  }
}
