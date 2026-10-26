import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { MatProgressBar } from '@angular/material/progress-bar';
import {
  NavigationCancel,
  NavigationEnd,
  NavigationError,
  NavigationStart,
  Router,
  RouterOutlet,
} from '@angular/router';
import { LayoutState } from '../layout-state';
import { PeekPanelComponent } from '../peek/peek-panel.component';
import { PeekService } from '../peek/peek';
import { ShellActions } from '../shell-actions';
import { SidebarComponent } from '../sidebar/sidebar.component';
import { TopbarComponent } from '../topbar/topbar.component';

const PROGRESS_DELAY_MS = 150;

/// Authenticated app frame: sidebar, top bar, routed content and the ticket peek panel.
@Component({
  selector: 'tk-shell',
  imports: [RouterOutlet, SidebarComponent, TopbarComponent, PeekPanelComponent, MatProgressBar],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.rail]': 'layout.sidebarCollapsed()', 'data-testid': 'app-shell' },
  template: `
    <tk-sidebar />
    <div class="main">
      <tk-topbar />
      <div class="progress">
        @if (navigating()) {
          <mat-progress-bar mode="indeterminate" aria-label="Loading page" />
        }
      </div>
      <div class="body">
        <main class="content" id="main-content">
          <router-outlet />
        </main>
        @if (peek.isOpen()) {
          <tk-peek-panel class="peek" />
        }
      </div>
    </div>
  `,
  styles: `
    :host {
      display: grid;
      grid-template-columns: var(--tk-sidebar-w) minmax(0, 1fr);
      height: 100vh;
      min-width: 1100px;
    }
    :host(.rail) {
      grid-template-columns: var(--tk-sidebar-w-collapsed) minmax(0, 1fr);
    }
    .main {
      display: flex;
      flex-direction: column;
      min-width: 0;
      min-height: 0;
    }
    .progress {
      height: 0;
      position: relative;
      z-index: var(--tk-z-sticky);
    }
    .progress mat-progress-bar {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
    }
    .body {
      flex: 1;
      min-height: 0;
      display: flex;
      position: relative;
    }
    .content {
      flex: 1;
      min-width: 0;
      overflow: auto;
      position: relative;
    }
    .peek {
      flex: none;
      z-index: var(--tk-z-peek);
    }
    @media (max-width: 1439px) {
      .peek {
        position: absolute;
        top: 0;
        right: 0;
        bottom: 0;
      }
    }
  `,
})
export class ShellComponent {
  protected readonly layout = inject(LayoutState);
  protected readonly peek = inject(PeekService);
  protected readonly navigating = signal(false);

  constructor() {
    const destroyRef = inject(DestroyRef);
    inject(ShellActions).register(destroyRef);

    let timer: ReturnType<typeof setTimeout> | null = null;
    const subscription = inject(Router).events.subscribe((event) => {
      if (event instanceof NavigationStart) {
        timer ??= setTimeout(() => this.navigating.set(true), PROGRESS_DELAY_MS);
      } else if (
        event instanceof NavigationEnd ||
        event instanceof NavigationCancel ||
        event instanceof NavigationError
      ) {
        if (timer) clearTimeout(timer);
        timer = null;
        this.navigating.set(false);
      }
    });
    destroyRef.onDestroy(() => {
      subscription.unsubscribe();
      if (timer) clearTimeout(timer);
    });
  }
}
