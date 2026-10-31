import { Component, provideZonelessChangeDetection, Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { FeatureFlagService } from '../flags/feature-flag.service';
import { ACHIEVEMENTS_FLAG, AGENT_FLAG, SUBTICKETS_GRAPH_FLAG } from '../flags/flag-keys';
import { defineView, ViewExposure } from './view-definition';
import { provideViewExposure, VIEW_ID_DATA_KEY, viewRoute, ViewRegistry } from './view-registry';

@Component({ selector: 'tk-default-variant', template: 'default' })
class DefaultVariantComponent {}

@Component({ selector: 'tk-on-variant', template: 'on' })
class OnVariantComponent {}

class FakeFlags {
  values: Record<string, string> = {};
  variant(key: string): string {
    return this.values[key] ?? 'off';
  }
}

describe('ViewRegistry', () => {
  let flags: FakeFlags;
  let exposures: ViewExposure[];

  beforeEach(() => {
    flags = new FakeFlags();
    exposures = [];
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: FeatureFlagService, useValue: flags },
        provideViewExposure((exposure) => exposures.push(exposure)),
      ],
    });
  });

  const registry = () => TestBed.inject(ViewRegistry);

  it('resolves the default variant when the view has no flag', async () => {
    // Arrange
    const view = defineView({
      viewId: 'test.plain',
      variants: { default: () => Promise.resolve(DefaultVariantComponent) },
    });

    // Act
    const component = await registry().resolve(view);

    // Assert
    expect(component).toBe(DefaultVariantComponent);
  });

  it('resolves the variant matching the flag value', async () => {
    // Arrange
    flags.values[SUBTICKETS_GRAPH_FLAG] = 'on';
    const view = defineView({
      viewId: 'test.flagged',
      flag: SUBTICKETS_GRAPH_FLAG,
      variants: {
        default: () => Promise.resolve(DefaultVariantComponent),
        on: () => Promise.resolve({ default: OnVariantComponent }),
      },
    });

    // Act
    const component = await registry().resolve(view);

    // Assert
    expect(component).toBe(OnVariantComponent);
  });

  it('falls back to default when the flag variant has no registered component', async () => {
    // Arrange
    flags.values[SUBTICKETS_GRAPH_FLAG] = 'b';
    const view = defineView({
      viewId: 'test.fallback',
      flag: SUBTICKETS_GRAPH_FLAG,
      variants: { default: () => Promise.resolve(DefaultVariantComponent) },
    });

    // Act
    const component = await registry().resolve(view);

    // Assert
    expect(component).toBe(DefaultVariantComponent);
  });

  it('falls back to default when the variant fails to load', async () => {
    // Arrange
    flags.values[AGENT_FLAG] = 'on';
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const view = defineView({
      viewId: 'test.broken',
      flag: AGENT_FLAG,
      variants: {
        default: () => Promise.resolve(DefaultVariantComponent),
        on: () => Promise.reject(new Error('chunk failed')),
      },
    });

    // Act
    const component = await registry().resolve(view);

    // Assert
    expect(component).toBe(DefaultVariantComponent);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('reports exposure with the rendered variant when a view route activates', async () => {
    // Arrange
    flags.values[ACHIEVEMENTS_FLAG] = 'on';
    const view = defineView({
      viewId: 'test.exposed',
      flag: ACHIEVEMENTS_FLAG,
      variants: {
        default: () => Promise.resolve(DefaultVariantComponent),
        on: () => Promise.resolve(OnVariantComponent),
      },
    });
    const router = TestBed.inject(Router);
    router.resetConfig([viewRoute(view, { path: 'exposed' })]);

    // Act
    await router.navigateByUrl('/exposed');

    // Assert
    expect(exposures).toEqual([{ viewId: 'test.exposed', variant: 'on', flag: ACHIEVEMENTS_FLAG }]);
  });

  it('builds routes that carry the view id and resolve lazily', () => {
    // Arrange
    const view = defineView({
      viewId: 'test.route',
      variants: { default: () => Promise.resolve(DefaultVariantComponent as Type<unknown>) },
    });

    // Act
    const route = viewRoute(view, { path: 'x', data: { breadcrumb: 'X' } });

    // Assert
    expect(route.path).toBe('x');
    expect(route.data).toEqual({ breadcrumb: 'X', [VIEW_ID_DATA_KEY]: 'test.route' });
    expect(route.loadComponent).toBeTypeOf('function');
  });

  it('rejects malformed view ids', () => {
    expect(() =>
      defineView({
        viewId: 'Backlog',
        variants: { default: () => Promise.resolve(DefaultVariantComponent) },
      }),
    ).toThrow(/View id/);
  });
});
