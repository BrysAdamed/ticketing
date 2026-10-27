import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { DocHistoryApi } from '@core/docs/doc-history.api';
import { Doc } from '@core/docs/doc.models';
import { ConfirmService } from '@core/notify/confirm.service';
import { ToastService } from '@core/notify/toast.service';
import { DocStore } from '../doc/doc.store';
import { DocTreeStore } from '../tree/doc-tree.store';

/// "Restore this version" (writers only): confirms, publishes the old title and content as a new
/// version and updates the open doc and the tree. Provided by the views that offer it.
@Injectable()
export class DocRestoreAction {
  private readonly api = inject(DocHistoryApi);
  private readonly store = inject(DocStore);
  private readonly tree = inject(DocTreeStore);
  private readonly confirm = inject(ConfirmService);
  private readonly toast = inject(ToastService);

  static canRestore(doc: Doc, number: number): boolean {
    return doc.permissions.canEdit && doc.kind !== 'Folder' && number < doc.version;
  }

  /// Resolves to the updated doc, or null when cancelled or failed (the error is toasted).
  async restore(doc: Doc, number: number): Promise<Doc | null> {
    const ok = await this.confirm.confirm({
      title: `Restore v${number}?`,
      message:
        `Its title and content become v${doc.version + 1}. v${doc.version} stays in the history.` +
        (doc.myDraft ? ' Your unpublished draft is kept.' : ''),
      confirmLabel: 'Restore',
    });
    if (!ok) return null;
    try {
      const restored = await firstValueFrom(this.api.restore(doc.key, number));
      this.store.set(restored);
      this.tree.patchFromDoc(restored);
      this.toast.success(
        restored.version > doc.version
          ? `Restored v${number} as v${restored.version}`
          : `v${number} already matches the latest version`,
      );
      return restored;
    } catch (error) {
      this.toast.error(error);
      return null;
    }
  }
}
