import { inject, Injectable } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { suggestProjectKey } from '@shared/domain/project-key';
import { ApiClient } from '../../api/api-client';
import { AuthService } from '../../auth/auth.service';
import { TourLauncher, TourResult } from '../engine/tour-launcher';
import { storedTourState } from '../guided-tours.logic';
import { OnboardingStateService } from '../onboarding-state.service';
import {
  FirstProjectChoice,
  FirstProjectChoiceData,
  FirstProjectChoiceDialog,
} from './first-project-choice.dialog';
import { FirstProjectConditions } from './first-project-conditions';
import { pickWalkthroughProject, sandboxName } from './first-project.logic';
import { FIRST_PROJECT_TOUR } from './first-project.tour';

/// How an entry point starts the walkthrough.
export interface FirstProjectStartOptions {
  /// Use this project without asking, when the user owns it.
  readonly projectKey?: string;
  /// Pass over the optional status step (the boards list resumes at "Create a board").
  readonly skipOptional?: boolean;
  readonly returnFocusTo?: HTMLElement | null;
}

/// Starts, resumes or continues the "Your first project" walkthrough (spec 14.4, D-142): asks which
/// project to use when the user already owns one, suggests a free sandbox name and key, resumes at
/// the first step whose condition does not hold, and stores Completed or Dismissed. Lazy: entry
/// points call `startFirstProjectWalkthrough` (first-project.help.ts).
@Injectable({ providedIn: 'root' })
export class FirstProjectWalkthrough {
  private readonly api = inject(ApiClient);
  private readonly auth = inject(AuthService);
  private readonly dialog = inject(MatDialog);
  private readonly launcher = inject(TourLauncher);
  private readonly onboarding = inject(OnboardingStateService);
  private readonly conditions = inject(FirstProjectConditions);

  /// Resolves how the walkthrough ended, or null when the user cancelled the start choice. A paused
  /// walkthrough is continued instead of started again.
  async start(options: FirstProjectStartOptions = {}): Promise<TourResult | null> {
    if (this.launcher.running() === FIRST_PROJECT_TOUR.id && this.launcher.continue()) return null;
    const owned = await this.conditions.owned().catch(() => []);
    const params: Record<string, string> = {};
    const chosen = owned.find((p) => p.key === options.projectKey?.toUpperCase());
    const offered = chosen ?? pickWalkthroughProject(owned, this.conditions.rememberedProject());
    let choice: FirstProjectChoice | null = offered ? 'use' : 'create';
    if (offered && !chosen) choice = await this.choose(offered.name);
    if (!choice) return null;
    if (choice === 'use' && offered) {
      params['projectKey'] = offered.key;
    } else {
      params['ownedBefore'] = owned.map((p) => p.key).join(',');
      Object.assign(params, await this.suggestion());
    }
    const user = this.auth.currentUser();
    const result = await this.launcher.start(FIRST_PROJECT_TOUR, {
      access: { canWrite: true, isOwner: true, isAdmin: user?.globalRole === 'Admin' },
      params,
      conditions: this.conditions,
      resume: { skipOptional: options.skipOptional },
      returnFocusTo: options.returnFocusTo,
    });
    const state = storedTourState(result);
    if (state === 'Completed')
      await this.onboarding.complete(FIRST_PROJECT_TOUR.id, FIRST_PROJECT_TOUR.version);
    else if (state === 'Dismissed')
      await this.onboarding.dismiss(FIRST_PROJECT_TOUR.id, FIRST_PROJECT_TOUR.version);
    return result;
  }

  private async choose(projectName: string): Promise<FirstProjectChoice | null> {
    const ref = this.dialog.open<
      FirstProjectChoiceDialog,
      FirstProjectChoiceData,
      FirstProjectChoice
    >(FirstProjectChoiceDialog, {
      data: { projectName },
      width: '480px',
      autoFocus: 'first-tabbable',
    });
    return (await firstValueFrom(ref.afterClosed())) ?? null;
  }

  /// "<display name>'s sandbox" and its derived key, with a suffix when another project, readable or
  /// not, already uses them (`GET /projects/suggested-identity`).
  private async suggestion(): Promise<{ suggestedName: string; suggestedKey: string }> {
    const name = sandboxName(this.auth.currentUser()?.displayName ?? '');
    const key = suggestProjectKey(name) || 'SANDBOX';
    try {
      const free = await firstValueFrom(
        this.api.get<{ name: string; key: string }>('/projects/suggested-identity', { name, key }),
      );
      return { suggestedName: free.name, suggestedKey: free.key };
    } catch {
      return { suggestedName: name, suggestedKey: key };
    }
  }
}
