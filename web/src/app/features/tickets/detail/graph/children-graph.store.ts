import { computed, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { TicketGraph } from '@core/tickets/ticket.models';
import { TicketsApi } from '@core/tickets/tickets.api';
import { buildGraphModel } from './children-graph.model';
import { layoutGraph } from './children-graph.layout';

export type GraphLoadStatus = 'loading' | 'loaded' | 'error';

/// Loads the children graph of one ticket. A reload keeps the current graph on screen until the
/// fresh one arrives, and a stale response never overwrites a newer one.
@Injectable()
export class ChildrenGraphStore {
  private readonly api = inject(TicketsApi);
  private token = 0;

  readonly status = signal<GraphLoadStatus>('loading');
  readonly graph = signal<TicketGraph | null>(null);
  readonly model = computed(() => {
    const graph = this.graph();
    return graph ? buildGraphModel(graph) : null;
  });
  readonly layout = computed(() => {
    const model = this.model();
    return model ? layoutGraph(model) : null;
  });

  async load(key: string): Promise<void> {
    const token = ++this.token;
    if (this.graph()?.key !== key.toUpperCase()) {
      this.graph.set(null);
      this.status.set('loading');
    }
    try {
      const graph = await firstValueFrom(this.api.childrenGraph(key));
      if (token !== this.token) return;
      this.graph.set(graph);
      this.status.set('loaded');
    } catch {
      if (token !== this.token) return;
      if (!this.graph()) this.status.set('error');
    }
  }
}
