import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { AgentInstanceStatus } from '@core/agent/agent-prompt.models';
import { IconComponent } from '@shared/ui/icon/icon.component';

/// The status line for `TICKETING_PUBLIC_URL`: the configured origin, or why delegation is off.
@Component({
  selector: 'tk-public-url-status',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-testid': 'agent-public-url-status' },
  template: `
    @if (status().publicUrl; as url) {
      <div class="line" data-testid="agent-public-url-set">
        <tk-icon name="tablerCircleCheck" [size]="16" class="ok" />
        <code>{{ status().publicUrlVariable }}</code>
        <a class="url" [href]="url" target="_blank" rel="noopener">{{ url }}</a>
        <span class="tk-subtle">· Ticket and instance links in prompts point here.</span>
      </div>
    } @else {
      <div
        class="tk-callout tk-callout-warning"
        role="status"
        data-testid="agent-public-url-missing"
      >
        <tk-icon name="tablerAlertTriangle" [size]="16" />
        <span>
          <strong
            ><code>{{ status().publicUrlVariable }}</code> is not set — delegation is
            disabled.</strong
          >
          Nobody sees Delegate to agent or Copy prompt, and the prompts below can't be edited. Set
          it to this instance's public address (for example <code>http://localhost:8090</code>) and
          restart the API.
        </span>
      </div>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .line {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 6px;
      font-size: var(--tk-text-sm);
    }
    .ok {
      color: var(--tk-success-fg);
    }
    code {
      font-family: var(--tk-font-mono);
      font-size: var(--tk-text-sm);
    }
    .url {
      font-family: var(--tk-font-mono);
      color: var(--tk-accent-fg);
      overflow-wrap: anywhere;
    }
    strong {
      font-weight: var(--tk-weight-semibold);
    }
  `,
})
export class PublicUrlStatusComponent {
  readonly status = input.required<AgentInstanceStatus>();
}
