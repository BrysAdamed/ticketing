import { computed, inject, Injectable } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRouteSnapshot, NavigationEnd, Router } from '@angular/router';
import { filter, map } from 'rxjs';
import { projectKeyOf, TICKET_KEY_PATTERN } from '@shared/domain/keys';
import { VIEW_ID_DATA_KEY } from '../views/view-registry';

/// Where the user is: current URL, the view on screen and the project in context (from
/// /projects/:key or a ticket key in /tickets/:key or ?peek=KEY).
@Injectable({ providedIn: 'root' })
export class NavigationContext {
  private readonly router = inject(Router);

  readonly url = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );

  /// View id of the page on screen (the deepest activated route built with `viewRoute`), or null.
  /// The peek panel is a query parameter, so it never changes the view id.
  readonly currentViewId = computed<string | null>(() => {
    this.url();
    return deepestViewId(this.router.routerState.snapshot.root);
  });

  readonly projectKey = computed<string | null>(() => {
    const tree = this.router.parseUrl(this.url());
    const segments = tree.root.children['primary']?.segments.map((s) => s.path) ?? [];
    if (segments[0] === 'projects' && segments[1]) return segments[1].toUpperCase();
    if (
      segments[0] === 'tickets' &&
      segments[1] &&
      TICKET_KEY_PATTERN.test(segments[1].toUpperCase())
    ) {
      return projectKeyOf(segments[1].toUpperCase());
    }
    return null;
  });

  projectUrl(view?: string): string | null {
    const key = this.projectKey();
    if (!key) return null;
    return view ? `/projects/${key}/${view}` : `/projects/${key}`;
  }
}

function deepestViewId(root: ActivatedRouteSnapshot): string | null {
  let viewId: string | null = null;
  for (let route: ActivatedRouteSnapshot | null = root; route; route = route.firstChild) {
    const id = route.routeConfig?.data?.[VIEW_ID_DATA_KEY];
    if (typeof id === 'string') viewId = id;
  }
  return viewId;
}
