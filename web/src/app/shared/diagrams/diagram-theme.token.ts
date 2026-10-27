import { InjectionToken, Signal, signal } from '@angular/core';
import { DiagramTheme } from './diagram-theme';

/// The theme diagrams render in on screen. `shared/` cannot reach the app's ThemeService, so the
/// app config provides it; the default is light.
export const DIAGRAM_THEME = new InjectionToken<Signal<DiagramTheme>>('DIAGRAM_THEME', {
  factory: () => signal<DiagramTheme>('light').asReadonly(),
});
