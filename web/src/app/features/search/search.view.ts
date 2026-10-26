import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { PagePlaceholderComponent } from '@shared/ui/page-placeholder/page-placeholder.component';
import { SearchStore } from './search.store';

@Component({
  selector: 'tk-search-view',
  imports: [PagePlaceholderComponent],
  providers: [SearchStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'tk-page', 'data-testid': 'view-search.results' },
  template: `
    <header class="tk-page-header">
      <h1>Search</h1>
    </header>
    <tk-page-placeholder
      icon="tablerSearch"
      title="Search"
      viewId="search.results"
      description="Find tickets across projects with structured filters."
    />
  `,
})
export class SearchView {
  protected readonly store = inject(SearchStore);

  constructor() {
    this.store.load();
  }
}
