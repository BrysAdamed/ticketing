import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { provideIcons } from '@ng-icons/core';
import { tablerCloud, tablerCloudCheck, tablerCloudOff } from '@ng-icons/tabler-icons';
import { DocEditor } from '@core/docs/doc.models';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { DocPresenceComponent } from '../page/doc-presence.component';
import { DocEditSession } from './doc-edit-session';

/// The left part of an editor bar (pages and diagrams): the draft status of the injected
/// `DocEditSession` with Retry, the version the edit is based on, a newer published version and
/// who else is editing.
@Component({
  selector: 'tk-doc-edit-status',
  imports: [IconComponent, DocPresenceComponent],
  viewProviders: [provideIcons({ tablerCloud, tablerCloudCheck, tablerCloudOff })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-testid': 'doc-editor-status' },
  template: `
    @switch (session.status()) {
      @case ('saving') {
        <tk-icon class="st" name="tablerCloud" [size]="16" />
        <span>Saving draft…</span>
      }
      @case ('saved') {
        <tk-icon class="st ok" name="tablerCloudCheck" [size]="16" />
        <span>Draft saved</span>
      }
      @case ('error') {
        <tk-icon class="st bad" name="tablerCloudOff" [size]="16" />
        <span class="bad">Couldn't save draft</span>
        <span class="sep">·</span>
        <button type="button" class="link" data-testid="doc-editor-retry" (click)="retry()">
          Retry
        </button>
      }
      @case ('publishing') {
        <tk-icon class="st" name="tablerCloud" [size]="16" />
        <span>Publishing…</span>
      }
      @case ('published') {
        <tk-icon class="st ok" name="tablerCheck" [size]="16" />
        <span>Published v{{ session.publishedVersion() }}</span>
      }
      @case ('pending') {
        <tk-icon class="st" name="tablerCloud" [size]="16" />
        <span>Unsaved changes</span>
      }
      @case ('conflict') {
        <tk-icon class="st bad" name="tablerAlertTriangle" [size]="16" />
        <span class="bad">Conflicting changes</span>
      }
      @default {
        <tk-icon class="st" name="tablerPencil" [size]="16" />
        <span>Editing</span>
      }
    }
    <span class="sep">·</span>
    <span class="tnum" data-testid="doc-editor-base">based on v{{ session.baseVersion() }}</span>
    @if (session.newerVersion(); as newer) {
      <span class="sep">·</span>
      <span class="newer" data-testid="doc-editor-newer"
        >{{ newer.updatedBy.displayName }} published v{{ newer.version }}</span
      >
    }
    <tk-doc-presence class="presence" [editors]="editors()" />
  `,
  styles: `
    :host {
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
      overflow: hidden;
      color: var(--tk-text-muted);
      font-size: var(--tk-text-sm);
      white-space: nowrap;
    }
    .st {
      flex: none;
      color: var(--tk-text-subtle);
    }
    .st.ok {
      color: var(--tk-success-fg);
    }
    .bad {
      color: var(--tk-danger-fg);
    }
    .sep {
      color: var(--tk-text-disabled);
    }
    .newer {
      color: var(--tk-warning-fg);
    }
    .presence {
      margin-left: 6px;
    }
    .link {
      padding: 0;
      border: 0;
      background: none;
      color: var(--tk-accent-fg);
      font: inherit;
      cursor: pointer;
    }
    .link:hover {
      text-decoration: underline;
    }
  `,
})
export class DocEditStatusComponent {
  protected readonly session = inject(DocEditSession);

  readonly editors = input<readonly DocEditor[]>([]);

  protected retry(): void {
    void this.session.flush();
  }
}
