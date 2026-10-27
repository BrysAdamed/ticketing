import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { MarkdownEditorComponent, MarkdownUploadHandler } from './markdown-editor.component';

function setUp(handler: MarkdownUploadHandler | null, value = 'Before') {
  TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  const fixture = TestBed.createComponent(MarkdownEditorComponent);
  fixture.componentRef.setInput('uploadHandler', handler);
  fixture.componentInstance.value.set(value);
  fixture.detectChanges();
  const textarea = fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement;
  textarea.setSelectionRange(value.length, value.length);
  return { fixture, editor: fixture.componentInstance, textarea };
}

describe('MarkdownEditorComponent uploads', () => {
  it('replaces the upload placeholder with the markdown the handler returns', async () => {
    // Arrange
    let resolve!: (markdown: string) => void;
    const { editor } = setUp(() => new Promise((r) => (resolve = r)));
    const file = new File(['png'], 'shot.png', { type: 'image/png' });

    // Act
    const upload = editor.upload(file);
    const during = editor.value();
    resolve('![shot.png](/api/v1/attachments/1)');
    await upload;

    // Assert
    expect(during).toBe('Before\n![Uploading shot.png…]()\n');
    expect(editor.value()).toBe('Before\n![shot.png](/api/v1/attachments/1)\n');
  });

  it('removes the placeholder when the upload fails', async () => {
    // Arrange
    const { editor } = setUp(() => Promise.reject(new Error('nope')));

    // Act
    await editor.upload(new File(['x'], 'a.txt'));

    // Assert
    expect(editor.value()).toBe('Before\n\n');
  });

  it('ignores pasted files without a handler', () => {
    // Arrange
    const { editor, textarea } = setUp(null);
    const event = new Event('paste', { cancelable: true }) as ClipboardEvent;
    Object.defineProperty(event, 'clipboardData', { value: { files: [new File(['x'], 'a.png')] } });

    // Act
    textarea.dispatchEvent(event);

    // Assert
    expect(event.defaultPrevented).toBe(false);
    expect(editor.value()).toBe('Before');
  });
});
