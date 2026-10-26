import { ActivatedRouteSnapshot, Routes } from '@angular/router';
import { CrumbInput } from '@core/layout/breadcrumbs';
import { viewRoute } from '@core/views/view-registry';
import { projectKeyOf } from '@shared/domain/keys';
import { TICKET_DETAIL_VIEW } from './tickets.views';

const ticketCrumb = (route: ActivatedRouteSnapshot): CrumbInput => {
  const key = (route.paramMap.get('ticketKey') ?? '').toUpperCase();
  return { label: key, projectKey: projectKeyOf(key) };
};

export default [
  { path: '', pathMatch: 'full', redirectTo: '/search' },
  viewRoute(TICKET_DETAIL_VIEW, {
    path: ':ticketKey',
    title: (route) => `${(route.paramMap.get('ticketKey') ?? '').toUpperCase()} · Ticketing`,
    data: { breadcrumb: ticketCrumb, presentation: 'page' },
  }),
] satisfies Routes;
