import { Injectable, provideZonelessChangeDetection, Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Route, Routes } from '@angular/router';
import { TOUR_CATALOGUE } from '@core/onboarding/tours/tour-catalogue';
import { ViewDefinition } from '@core/views/view-definition';
import { ViewRegistry } from '@core/views/view-registry';
import { routes } from './app.routes';

/// Registers views like the real registry, without loading their components.
@Injectable()
class RegisteringOnlyRegistry extends ViewRegistry {
  override resolve(definition: ViewDefinition): Promise<Type<unknown>> {
    this.register(definition);
    return Promise.resolve(Object as unknown as Type<unknown>);
  }
}

/// Walks the whole route tree (lazy children included) and activates every view route's loader,
/// which is how views reach the `ViewRegistry`.
async function registerAllViews(tree: Routes): Promise<void> {
  for (const route of tree) {
    if (route.loadComponent) await TestBed.runInInjectionContext(() => route.loadComponent!());
    if (route.children) await registerAllViews(route.children);
    if (route.loadChildren) await registerAllViews(await lazyChildren(route));
  }
}

async function lazyChildren(route: Route): Promise<Routes> {
  const loaded = (await route.loadChildren!()) as Routes | { default: Routes };
  return Array.isArray(loaded) ? loaded : loaded.default;
}

describe('tour views', { timeout: 30_000 }, () => {
  it('registers the view of every tour in the ViewRegistry through the app routes', async () => {
    // Arrange
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: ViewRegistry, useClass: RegisteringOnlyRegistry },
      ],
    });
    const registry = TestBed.inject(ViewRegistry);

    // Act
    await registerAllViews(routes);

    // Assert
    const missing = TOUR_CATALOGUE.map((e) => e.viewId).filter(
      (viewId) => !registry.viewIds.includes(viewId),
    );
    expect(missing).toEqual([]);
    expect(registry.viewIds).toContain('backlog.list');
  });
});
