import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { firstValueFrom } from 'rxjs';
import { Doc } from '@core/docs/doc.models';
import { DocsApi } from '@core/docs/docs.api';
import { ConfirmService } from '@core/notify/confirm.service';
import { ToastService } from '@core/notify/toast.service';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { DocStore } from './doc.store';

/// "You have unpublished changes from 10:42 · Continue editing · Discard" above a page or diagram
/// whose reader has a draft of it (spec 1.8). Discard deletes the draft after a confirmation.
@Component({
  selector: 'tk-doc-draft-banner',
  imports: [MatButtonModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'status', 'data-testid': 'doc-draft-banner' },
  template: `
    <tk-icon name="tablerPencil" [size]="16" />
    <span class="msg">You have unpublished changes from {{ time() }}</span>
    <button mat-button type="button" data-testid="doc-draft-continue" (click)="continue.emit()">
      Continue editing
    </button>
    <button mat-button type="button" data-testid="doc-draft-discard" (click)="discard()">
      Discard
    </button>
  `,
  styles: `
    :host {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: -12px 0 20px;
      padding: 4px 4px 4px 12px;
      border: 1px solid var(--tk-warning-border);
      border-radius: var(--tk-radius-lg);
      background: var(--tk-warning-bg);
      font-size: var(--tk-text-base);
    }
    tk-icon {
      color: var(--tk-warning-fg);
    }
    .msg {
      flex: 1;
      min-width: 0;
    }
  `,
})
export class DocDraftBannerComponent {
  private readonly api = inject(DocsApi);
  private readonly store = inject(DocStore);
  private readonly confirm = inject(ConfirmService);
  private readonly toast = inject(ToastService);

  readonly doc = input.required<Doc>();
  readonly continue = output<void>();

  protected readonly time = computed(() => {
    const updatedAt = this.doc().myDraft?.updatedAt;
    if (!updatedAt) return '';
    const date = new Date(updatedAt);
    return date.toDateString() === new Date().toDateString()
      ? date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
      : date.toLocaleString(undefined, {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        });
  });

  protected async discard(): Promise<void> {
    const doc = this.doc();
    const ok = await this.confirm.confirm({
      title: 'Discard your unpublished changes?',
      message: `Your draft of ${doc.title} is deleted. The published version stays as it is.`,
      confirmLabel: 'Discard',
      danger: true,
    });
    if (!ok) return;
    try {
      await firstValueFrom(this.api.discardDraft(doc.key));
      this.store.set({ ...doc, myDraft: null });
      this.toast.success('Draft discarded');
    } catch (error) {
      this.toast.error(error);
    }
  }
}
