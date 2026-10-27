import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { provideIcons } from '@ng-icons/core';
import {
  tablerFocusCentered,
  tablerLock,
  tablerZoomIn,
  tablerZoomOut,
} from '@ng-icons/tabler-icons';
import { debounceTime, filter } from 'rxjs';
import { TicketEvents } from '@core/tickets/ticket-events';
import { TICKET_STATUS_LABELS } from '@shared/domain/enums';
import { AvatarComponent } from '@shared/ui/domain/avatar.component';
import { StatusIconComponent } from '@shared/ui/domain/status-icon.component';
import { TypeIconComponent } from '@shared/ui/domain/type-icon.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { SkeletonRowsComponent } from '@shared/ui/skeleton/skeleton-rows.component';
import { GraphNode, neighbourhood } from './children-graph.model';
import { NODE_HEIGHT, NODE_WIDTH, Point } from './children-graph.layout';
import { ChildrenGraphStore } from './children-graph.store';

const MAX_HEIGHT = 520;
const MIN_HEIGHT = 140;
const MIN_INITIAL_SCALE = 0.6;
const MIN_SCALE = 0.2;
const MAX_SCALE = 2;
const ZOOM_STEP = 1.25;
const PAD = 16;

type Direction = 'up' | 'down' | 'left' | 'right';
const ARROWS: Record<string, Direction> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
};

let nextId = 0;

/// Dependency graph of a ticket's children (D-94): `Blocks` links laid out top to bottom, blocked
/// and ready tickets, the critical path, hover/focus highlighting of everything up- and downstream,
/// zoom, pan and fit. Loaded lazily (`@defer`) together with dagre.
@Component({
  selector: 'tk-children-graph',
  imports: [
    RouterLink,
    AvatarComponent,
    StatusIconComponent,
    TypeIconComponent,
    IconComponent,
    SkeletonRowsComponent,
  ],
  providers: [ChildrenGraphStore],
  viewProviders: [provideIcons({ tablerFocusCentered, tablerLock, tablerZoomIn, tablerZoomOut })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-testid': 'children-graph' },
  templateUrl: './children-graph.component.html',
  styleUrl: './children-graph.component.scss',
})
export class ChildrenGraphComponent {
  protected readonly store = inject(ChildrenGraphStore);
  private readonly events = inject(TicketEvents);

  readonly ticketKey = input.required<string>();
  /// Changes whenever the parent's children change (keys, statuses), so the graph reloads.
  readonly revision = input('');

  protected readonly uid = `g${nextId++}`;
  protected readonly nodeWidth = NODE_WIDTH;
  protected readonly nodeHeight = NODE_HEIGHT;
  protected readonly statusLabels = TICKET_STATUS_LABELS;

  private readonly viewport = viewChild<ElementRef<HTMLElement>>('viewport');
  private readonly viewportWidth = signal(0);
  protected readonly scale = signal(1);
  protected readonly tx = signal(0);
  protected readonly ty = signal(0);
  protected readonly panning = signal(false);
  private fitted = false;
  private pan: { id: number; x: number; y: number; tx: number; ty: number } | null = null;

  protected readonly hovered = signal<string | null>(null);
  protected readonly focused = signal<string | null>(null);
  protected readonly active = signal<string | null>(null);

  protected readonly model = this.store.model;
  protected readonly layout = this.store.layout;
  protected readonly placed = computed(() => {
    const model = this.model();
    const layout = this.layout();
    if (!model || !layout) return [];
    return model.nodes.map((node) => ({ node, at: layout.nodes.get(node.key)! }));
  });
  protected readonly around = computed(() => {
    const model = this.model();
    const key = this.hovered() ?? this.focused();
    return model && key ? neighbourhood(model, key) : null;
  });
  protected readonly tabStop = computed(() => {
    const model = this.model();
    if (!model || model.nodes.length === 0) return null;
    const active = this.active();
    if (active && model.nodes.some((n) => n.key === active)) return active;
    return (
      model.criticalPath[0] ??
      model.nodes.find((n) => n.state === 'ready')?.key ??
      model.nodes[0].key
    );
  });
  protected readonly height = computed(() => {
    const layout = this.layout();
    if (!layout) return MIN_HEIGHT;
    return Math.round(
      Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, layout.height * this.initialScale())),
    );
  });
  protected readonly transform = computed(
    () => `translate(${this.tx()}px, ${this.ty()}px) scale(${this.scale()})`,
  );
  protected readonly criticalTitle = computed(() => this.model()?.criticalPath.join(' → ') ?? '');

  constructor() {
    effect(() => {
      const key = this.ticketKey();
      this.revision();
      untracked(() => void this.store.load(key));
    });
    effect(() => {
      const layout = this.layout();
      const width = this.viewportWidth();
      if (!layout || width === 0 || this.fitted) return;
      this.fitted = true;
      untracked(() => this.fit(this.initialScale()));
    });

    this.events.events
      .pipe(
        filter(
          (e) =>
            e.kind !== 'created' &&
            !!this.model()?.nodes.some(
              (n) => n.key === (e.kind === 'deleted' ? e.key : e.ticket.key),
            ),
        ),
        debounceTime(300),
        takeUntilDestroyed(),
      )
      .subscribe(() => void this.store.load(this.ticketKey()));

    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const element = this.viewport()?.nativeElement;
      if (!element || typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver(([entry]) =>
        this.viewportWidth.set(entry.contentRect.width),
      );
      observer.observe(element);
      destroyRef.onDestroy(() => observer.disconnect());
    });
  }

  protected nodeLabel(node: GraphNode): string {
    const parts = [`${node.key} ${node.title}`, this.statusLabels[node.status]];
    if (node.state === 'blocked') parts.push(`Blocked by ${node.blockedBy.join(', ')}`);
    else if (node.state === 'ready') parts.push('Ready to start');
    if (node.critical) parts.push('On the critical path');
    if (node.external) parts.push('Outside this ticket');
    if (node.assignee) parts.push(`Assigned to ${node.assignee.displayName}`);
    return parts.join('. ');
  }

  protected zoomBy(factor: number, origin?: Point): void {
    const width = this.viewportWidth();
    const at = origin ?? { x: width / 2, y: this.height() / 2 };
    const current = this.scale();
    const next = clamp(current * factor, MIN_SCALE, MAX_SCALE);
    this.tx.set(at.x - ((at.x - this.tx()) * next) / current);
    this.ty.set(at.y - ((at.y - this.ty()) * next) / current);
    this.scale.set(next);
  }

  /// Scales the whole graph into the viewport (never above 100%), centred horizontally.
  protected fit(minimum = MIN_SCALE): void {
    const layout = this.layout();
    const width = this.viewportWidth();
    if (!layout || width === 0) return;
    const scale = clamp(this.fitScale(), minimum, 1);
    this.scale.set(scale);
    this.tx.set(Math.max(0, (width - layout.width * scale) / 2));
    this.ty.set(Math.max(0, (this.height() - layout.height * scale) / 2));
  }

  protected onWheel(event: WheelEvent): void {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.zoomBy(event.deltaY < 0 ? 1.1 : 1 / 1.1, {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    });
  }

  protected onPointerDown(event: PointerEvent): void {
    if (event.button !== 0 || (event.target as HTMLElement).closest('.gnode')) return;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    this.pan = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      tx: this.tx(),
      ty: this.ty(),
    };
    this.panning.set(true);
  }

  protected onPointerMove(event: PointerEvent): void {
    if (this.pan?.id !== event.pointerId) return;
    this.tx.set(this.pan.tx + event.clientX - this.pan.x);
    this.ty.set(this.pan.ty + event.clientY - this.pan.y);
  }

  protected onPointerUp(event: PointerEvent): void {
    if (this.pan?.id !== event.pointerId) return;
    this.pan = null;
    this.panning.set(false);
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === '+' || event.key === '=') this.zoomBy(ZOOM_STEP);
    else if (event.key === '-') this.zoomBy(1 / ZOOM_STEP);
    else if (event.key === '0') this.fit();
    else if (ARROWS[event.key] && this.focused())
      this.moveFocus(this.focused()!, ARROWS[event.key]);
    else return;
    event.preventDefault();
  }

  protected onNodeFocus(key: string): void {
    this.focused.set(key);
    this.active.set(key);
    this.resetScroll();
    this.reveal(key);
  }

  protected onNodeBlur(key: string): void {
    if (this.focused() === key) this.focused.set(null);
  }

  /// Focus moving into the viewport scrolls it natively; panning is done with the transform only.
  protected resetScroll(): void {
    const element = this.viewport()?.nativeElement;
    if (element && (element.scrollLeft || element.scrollTop)) {
      element.scrollLeft = 0;
      element.scrollTop = 0;
    }
  }

  private moveFocus(from: string, direction: Direction): void {
    const layout = this.layout();
    const start = layout?.nodes.get(from);
    if (!layout || !start) return;
    let best: string | null = null;
    let bestScore = Infinity;
    for (const [key, at] of layout.nodes) {
      const dx = at.x - start.x;
      const dy = at.y - start.y;
      const [along, across] =
        direction === 'up'
          ? [-dy, dx]
          : direction === 'down'
            ? [dy, dx]
            : direction === 'left'
              ? [-dx, dy]
              : [dx, dy];
      if (along <= 1) continue;
      const score = along + 2 * Math.abs(across);
      if (score < bestScore) {
        bestScore = score;
        best = key;
      }
    }
    if (!best) return;
    this.active.set(best);
    this.viewport()
      ?.nativeElement.querySelector<HTMLElement>(`[data-key="${best}"]`)
      ?.focus({ preventScroll: true });
  }

  private reveal(key: string): void {
    const at = this.layout()?.nodes.get(key);
    const width = this.viewportWidth();
    if (!at || width === 0) return;
    const k = this.scale();
    const left = at.x * k + this.tx();
    const top = at.y * k + this.ty();
    const right = left + NODE_WIDTH * k;
    const bottom = top + NODE_HEIGHT * k;
    if (left < PAD) this.tx.update((t) => t + PAD - left);
    else if (right > width - PAD) this.tx.update((t) => t - (right - (width - PAD)));
    if (top < PAD) this.ty.update((t) => t + PAD - top);
    else if (bottom > this.height() - PAD)
      this.ty.update((t) => t - (bottom - (this.height() - PAD)));
  }

  private fitScale(): number {
    const layout = this.layout();
    const width = this.viewportWidth();
    if (!layout || width === 0) return 1;
    return Math.min(1, width / layout.width, MAX_HEIGHT / layout.height);
  }

  private initialScale(): number {
    return clamp(this.fitScale(), MIN_INITIAL_SCALE, 1);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
