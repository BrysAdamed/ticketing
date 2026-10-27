import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ApiClient } from '@core/api/api-client';
import { TicketSummary } from '@core/tickets/ticket.models';
import { MyRegressionItem, MyWork, MyWorkStore, WATCHING_GROUP } from './my-work.store';

const summary = (key: string) => ({ id: key, key }) as TicketSummary;

describe('MyWorkStore', () => {
  let store: MyWorkStore;

  beforeEach(async () => {
    const work: MyWork = {
      projects: [{ projectKey: 'WEB', projectName: 'Web', tickets: [summary('WEB-1')] }],
      ticketCount: 1,
      truncated: false,
      regressionItems: [{ itemId: 'i1' } as MyRegressionItem],
      watching: [summary('API-7'), summary('WEB-9')],
    };
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        MyWorkStore,
        { provide: ApiClient, useValue: { get: vi.fn(() => of(work)) } },
      ],
    });
    store = TestBed.inject(MyWorkStore);
    await store.load();
  });

  it('lists watched tickets after my tickets and regression items, and skips them when collapsed', () => {
    // Act
    const keys = () =>
      store.entries().map((e) => (e.kind === 'ticket' ? e.ticket.key : e.item.itemId));
    const expanded = keys();
    store.toggle(WATCHING_GROUP);

    // Assert
    expect(expanded).toEqual(['WEB-1', 'i1', 'API-7', 'WEB-9']);
    expect(keys()).toEqual(['WEB-1', 'i1']);
  });

  it('is not empty when only watched tickets are left', () => {
    // Act
    store.work.update((w) => w && { ...w, projects: [], regressionItems: [] });

    // Assert
    expect(store.isEmpty()).toBe(false);
  });
});
