import { Clipboard } from '@angular/cdk/clipboard';
import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { AbsoluteTimePipe } from '@shared/pipes/relative-time.pipe';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { SetPasswordLink } from '../admin.models';

export interface SetPasswordLinkDialogData {
  displayName: string;
  email: string;
  link: SetPasswordLink;
  isNewUser: boolean;
}

/// The one-time set-password link after creating a user or issuing a reset. No email is sent in
/// v1 (D-38), so the Admin copies it and hands it over.
@Component({
  selector: 'tk-set-password-link-dialog',
  imports: [MatDialogModule, MatButtonModule, IconComponent, AbsoluteTimePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title class="title">
      <tk-icon name="tablerCircleCheck" [size]="20" class="ok" />
      {{ data.isNewUser ? data.displayName + ' was created' : 'New set-password link' }}
    </h2>
    <mat-dialog-content class="content">
      <p class="lead">
        Send this link to <strong>{{ data.displayName }}</strong> ({{ data.email }}). It works once
        and expires {{ data.link.expiresAt | absoluteTime }}.
        @if (!data.isNewUser) {
          Their current password keeps working until they use it.
        }
      </p>
      <div class="link">
        <input
          class="mono"
          readonly
          aria-label="Set-password link"
          data-testid="set-password-link"
          [value]="url"
          (focus)="$any($event.target).select()"
        />
        <button
          mat-stroked-button
          type="button"
          data-testid="set-password-link-copy"
          (click)="copy()"
        >
          <tk-icon [name]="copied() ? 'tablerCheck' : 'tablerCopy'" [size]="14" />
          {{ copied() ? 'Copied' : 'Copy' }}
        </button>
      </div>
      <p class="tk-subtle note">
        Only a hash of the link is stored. If it gets lost, issue a new one from the user's menu.
      </p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-flat-button type="button" mat-dialog-close data-testid="set-password-link-done">
        Done
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .title {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .ok {
      color: var(--tk-success);
    }
    .content {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .lead {
      margin: 0;
      color: var(--tk-text-muted);
    }
    .lead strong {
      color: var(--tk-text);
      font-weight: var(--tk-weight-medium);
    }
    .link {
      display: flex;
      gap: 8px;
    }
    .link input {
      flex: 1;
      min-width: 0;
      height: 36px;
      padding: 0 10px;
      border: 1px solid var(--tk-border-input);
      border-radius: var(--tk-radius-md);
      background: var(--tk-bg-subtle);
      color: var(--tk-text);
      font-family: var(--tk-font-mono);
      font-size: var(--tk-text-sm);
    }
    .link input:focus {
      outline: none;
      border-color: var(--tk-accent);
      box-shadow: 0 0 0 3px var(--tk-accent-subtle);
    }
    .link button {
      height: 36px;
    }
    .note {
      margin: 0;
      font-size: var(--tk-text-sm);
    }
  `,
})
export class SetPasswordLinkDialog {
  protected readonly data = inject<SetPasswordLinkDialogData>(MAT_DIALOG_DATA);
  private readonly clipboard = inject(Clipboard);
  protected readonly url = inject(DOCUMENT).location.origin + this.data.link.path;
  protected readonly copied = signal(false);
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.timer));
  }

  protected copy(): void {
    if (!this.clipboard.copy(this.url)) return;
    this.copied.set(true);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.copied.set(false), 2000);
  }
}
