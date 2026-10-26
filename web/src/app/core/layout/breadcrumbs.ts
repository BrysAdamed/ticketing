import { computed, inject, Injectable, signal } from '@angular/core';
import { ActivatedRouteSnapshot, NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';

export interface Crumb {
  label: string;
  url: string | null;
  projectKey?: string;
}

export type CrumbInput = Omit<Crumb, 'url'> & { url?: string | null };

/// Static crumb label, or a function of the route snapshot (e.g. the `:projectKey` param).
/// The crumb links to the route's URL unless `url` is given.
export type BreadcrumbData = string | ((route: ActivatedRouteSnapshot) => string | CrumbInput);

export const BREADCRUMB_DATA_KEY = 'breadcrumb';

/// Breadcrumb trail for the top bar. Built from `data.breadcrumb` on the activated routes;
/// a page can append dynamic crumbs (e.g. a ticket title) with `setTail`, cleared on navigation.
@Injectable({ providedIn: 'root' })
export class Breadcrumbs {
  private readonly router = inject(Router);
  private readonly fromRoutes = signal<readonly Crumb[]>([]);
  private readonly tail = signal<readonly Crumb[]>([]);

  readonly trail = computed(() => [...this.fromRoutes(), ...this.tail()]);

  constructor() {
    const rebuild = () => this.fromRoutes.set(this.build(this.router.routerState.snapshot.root));
    this.router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe(() => {
      this.tail.set([]);
      rebuild();
    });
    if (this.router.navigated) rebuild();
  }

  setTail(crumbs: readonly Crumb[]): void {
    this.tail.set(crumbs);
  }

  private build(root: ActivatedRouteSnapshot): Crumb[] {
    const crumbs: Crumb[] = [];
    const segments: string[] = [];
    for (let route: ActivatedRouteSnapshot | null = root; route; route = route.firstChild) {
      segments.push(...route.url.map((s) => s.path));
      const data = route.routeConfig?.data?.[BREADCRUMB_DATA_KEY] as BreadcrumbData | undefined;
      if (!data) continue;
      const url = `/${segments.join('/')}`;
      const value = typeof data === 'function' ? data(route) : data;
      const crumb: Crumb =
        typeof value === 'string'
          ? { label: value, url }
          : { ...value, url: value.url === undefined ? url : value.url };
      if (crumbs.at(-1)?.url !== crumb.url) crumbs.push(crumb);
      else crumbs[crumbs.length - 1] = crumb;
    }
    return crumbs;
  }
}
