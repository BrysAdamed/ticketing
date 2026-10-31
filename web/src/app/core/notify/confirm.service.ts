import { inject, Injectable } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { ConfirmChoice, ConfirmDialog, ConfirmOptions } from './confirm.dialog';

/// Confirmation dialogs for destructive actions. Resolves true only when the user confirms.
@Injectable({ providedIn: 'root' })
export class ConfirmService {
  private readonly dialog = inject(MatDialog);

  async confirm(options: ConfirmOptions): Promise<boolean> {
    return (await this.choose(options)) === 'confirm';
  }

  /// Like `confirm`, with an optional third button (`alternativeLabel`). Resolves 'confirm',
  /// 'alternative' or 'cancel' (Cancel, Esc or a click outside). The confirm button has the initial
  /// focus unless `requireText` is set, so Enter picks it.
  async choose(options: ConfirmOptions): Promise<ConfirmChoice | 'cancel'> {
    const ref = this.dialog.open<ConfirmDialog, ConfirmOptions, ConfirmChoice>(ConfirmDialog, {
      data: options,
      width: options.alternativeLabel ? '520px' : '440px',
      autoFocus: 'first-tabbable',
      role: 'alertdialog',
    });
    return (await firstValueFrom(ref.afterClosed())) ?? 'cancel';
  }
}
