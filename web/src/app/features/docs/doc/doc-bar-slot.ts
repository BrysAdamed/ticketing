import { Injectable, signal, TemplateRef } from '@angular/core';

/// Lets the content view of the open doc put its own actions at the start of the page bar's right
/// side (the page reader's "On this page" button). Provided by the `docs.doc` frame.
@Injectable()
export class DocBarSlot {
  private readonly template = signal<TemplateRef<unknown> | null>(null);

  readonly actions = this.template.asReadonly();

  /// Shows the template in the page bar; the returned function removes it again.
  set(template: TemplateRef<unknown>): () => void {
    this.template.set(template);
    return () => {
      if (this.template() === template) this.template.set(null);
    };
  }
}
