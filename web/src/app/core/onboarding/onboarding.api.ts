import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../api/api-client';
import { GuideProgress, GuideState, Onboarding } from './onboarding.models';

const BASE = '/me/onboarding';

/// The signed-in user's onboarding state (`/me/onboarding`). Writes need the web session.
@Injectable({ providedIn: 'root' })
export class OnboardingApi {
  private readonly api = inject(ApiClient);

  get(): Observable<Onboarding> {
    return this.api.get<Onboarding>(BASE);
  }

  setGuide(guideId: string, version: number, state: GuideState): Observable<GuideProgress> {
    return this.api.put<GuideProgress>(`${BASE}/guides/${encodeURIComponent(guideId)}`, {
      version,
      state,
    });
  }

  forgetGuide(guideId: string): Observable<void> {
    return this.api.delete<void>(`${BASE}/guides/${encodeURIComponent(guideId)}`);
  }

  resetGuides(): Observable<void> {
    return this.api.delete<void>(`${BASE}/guides`);
  }
}
