import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  signal,
} from '@angular/core';
import { MatProgressBar } from '@angular/material/progress-bar';
import {
  NavigationCancel,
  NavigationEnd,
  NavigationError,
  NavigationStart,
  Router,
  RouterOutlet,
} from '@angular/router';
import { SwrCache } from '../../api/swr-cache';
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
        @if (busy()) {
          <mat-progress-bar
            mode="indeterminate"
            aria-label="Loading"
            data-testid="top-progress"
          />
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
  private readonly revalidating = signal(false);
  /// The 2px top line: a slow navigation or a background refetch behind cached data (SwrCache).
  protected readonly busy = computed(() => this.navigating() || this.revalidating());

  constructor() {
    const destroyRef = inject(DestroyRef);
    const document = inject(DOCUMENT);
    inject(ShellActions).register(destroyRef);

    const cache = inject(SwrCache);
    let revalidateTimer: ReturnType<typeof setTimeout> | null = null;
    effect(() => {
      const pending = cache.revalidating();
      if (revalidateTimer) clearTimeout(revalidateTimer);
      revalidateTimer = null;
      if (!pending) this.revalidating.set(false);
      else revalidateTimer = setTimeout(() => this.revalidating.set(true), PROGRESS_DELAY_MS);
    });

    let timer: ReturnType<typeof setTimeout> | null = null;
    const subscription = inject(Router).events.subscribe((event) => {
      if (event instanceof NavigationStart) {
        const active = document.activeElement;
        if (active instanceof HTMLElement && active.matches('tk-topbar .mat-mdc-tooltip-trigger'))
          active.blur();
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
      if (revalidateTimer) clearTimeout(revalidateTimer);
    });
  }
}
