import {
  computed,
  effect,
  inject,
  Injectable,
  Injector,
  runInInjectionContext,
  signal,
} from '@angular/core';
import { Title } from '@angular/platform-browser';
import { ActivatedRouteSnapshot, RouterStateSnapshot, TitleStrategy } from '@angular/router';
import { ProjectDirectory } from '../projects/project-directory';
import { OpenProjectState } from '../projects/open-project';

export const APP_NAME = 'Ticketing';

/// Route data key for a page title that follows app state, e.g. a board's name. The function runs
/// in an injection context and may read signals; the title updates when they change.
export const PAGE_TITLE_DATA_KEY = 'pageTitle';

export type PageTitleFn = (route: ActivatedRouteSnapshot) => string | null;

/// The one document-title rule for every route: `<page> · <project> · Ticketing`. The page part is
/// the deepest route's `data.pageTitle` function or `title`; the project part is the name of the
/// `:projectKey` route's project. A page with a dynamic subject (a ticket) replaces the page part
/// with `setSubject`, cleared on the next navigation.
@Injectable({ providedIn: 'root' })
export class PageTitleStrategy extends TitleStrategy {
  private readonly title = inject(Title);
  private readonly injector = inject(Injector);
  private readonly directory = inject(ProjectDirectory);
  private readonly openProject = inject(OpenProjectState);
  private readonly page = signal<string | null>(null);
  private readonly pageFn = signal<{ fn: PageTitleFn; route: ActivatedRouteSnapshot } | null>(null);
  private readonly projectKey = signal<string | null>(null);
  private readonly subject = signal<string | null>(null);

  readonly current = computed(() => {
    const dynamic = this.pageFn();
    const page = dynamic
      ? runInInjectionContext(this.injector, () => dynamic.fn(dynamic.route))
      : this.page();
    const key = this.projectKey();
    const open = this.openProject.project();
    const project = !key
      ? null
      : open?.key === key
        ? open.name
        : (this.directory.byKey(key)?.name ?? key);
    return [this.subject() ?? page, project, APP_NAME]
      .filter((part): part is string => !!part)
      .join(' · ');
  });

  constructor() {
    super();
    effect(() => this.title.setTitle(this.current()));
  }

  override updateTitle(snapshot: RouterStateSnapshot): void {
    this.subject.set(null);
    this.page.set(this.buildTitle(snapshot) ?? null);
    this.pageFn.set(pageTitleFnOf(snapshot.root));
    this.projectKey.set(projectKeyOf(snapshot.root));
  }

  /// Replaces the page part until the next navigation, e.g. `PAY-12 Fix the login`.
  setSubject(subject: string | null): void {
    this.subject.set(subject);
  }
}

function pageTitleFnOf(
  root: ActivatedRouteSnapshot,
): { fn: PageTitleFn; route: ActivatedRouteSnapshot } | null {
  let found: { fn: PageTitleFn; route: ActivatedRouteSnapshot } | null = null;
  for (let route: ActivatedRouteSnapshot | null = root; route; route = route.firstChild) {
    const fn = route.routeConfig?.data?.[PAGE_TITLE_DATA_KEY] as PageTitleFn | undefined;
    if (fn) found = { fn, route };
    else if (route.routeConfig?.title) found = null;
  }
  return found;
}

function projectKeyOf(root: ActivatedRouteSnapshot): string | null {
  let key: string | null = null;
  for (let route: ActivatedRouteSnapshot | null = root; route; route = route.firstChild)
    key = route.paramMap.get('projectKey') ?? key;
  return key?.toUpperCase() ?? null;
}
