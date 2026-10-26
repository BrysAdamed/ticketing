import { computed, inject, Injectable, InjectionToken, Provider } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { map } from 'rxjs';
import { ViewDefinition } from '../../views/view-definition';

export const PEEK_QUERY_PARAM = 'peek';

/// The view rendered in the peek panel. Its component receives inputs
/// `ticketKey: string` and `presentation: 'peek'` (the full page gets `presentation: 'page'`).
export const PEEK_VIEW = new InjectionToken<ViewDefinition>('PEEK_VIEW');

export function providePeekView(view: ViewDefinition): Provider {
  return { provide: PEEK_VIEW, useValue: view };
}

/// Opens a ticket in the right-hand peek panel by setting `?peek=KEY` on the current URL, so
/// the list stays interactive and the state survives reloads and can be shared.
@Injectable({ providedIn: 'root' })
export class PeekService {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly ticketKey = toSignal(
    this.route.queryParamMap.pipe(
      map((params) => params.get(PEEK_QUERY_PARAM)?.toUpperCase() ?? null),
    ),
    { initialValue: null },
  );
  readonly isOpen = computed(() => this.ticketKey() !== null);

  open(ticketKey: string): void {
    this.setParam(ticketKey);
  }

  close(): void {
    this.setParam(null);
  }

  private setParam(value: string | null): void {
    const tree = this.router.parseUrl(this.router.url);
    const queryParams = { ...tree.queryParams };
    if (value) queryParams[PEEK_QUERY_PARAM] = value;
    else delete queryParams[PEEK_QUERY_PARAM];
    tree.queryParams = queryParams;
    void this.router.navigateByUrl(tree);
  }
}
