import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MarkdownEditorComponent, MarkdownUploadHandler } from './markdown-editor.component';
import { MentionCandidate, MentionSearch } from './mentions';

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

const ANN: MentionCandidate = {
  id: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
  displayName: 'Ann Lee',
  email: 'ann@example.com',
};
const BOB: MentionCandidate = {
  id: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c',
  displayName: 'Bob Stone',
  email: 'bob@example.com',
};

describe('MarkdownEditorComponent mentions', () => {
  let fixture: ComponentFixture<MarkdownEditorComponent>;
  let editor: MarkdownEditorComponent;
  let textarea: HTMLTextAreaElement;
  let search: ReturnType<typeof vi.fn<MentionSearch>>;
  let events: string[];

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
    fixture = TestBed.createComponent(MarkdownEditorComponent);
    editor = fixture.componentInstance;
    search = vi.fn<MentionSearch>(async (query) =>
      [ANN, BOB].filter((c) => c.displayName.toLowerCase().startsWith(query.toLowerCase())),
    );
    fixture.componentRef.setInput('mentionSearch', search);
    events = [];
    editor.submitted.subscribe((value) => events.push(`submitted:${value}`));
    editor.cancelled.subscribe(() => events.push('cancelled'));
    fixture.detectChanges();
    textarea = fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement;
  });

  afterEach(() => {
    fixture.destroy();
    vi.useRealTimers();
  });

  const picker = () => document.querySelector<HTMLElement>('[data-testid="mention-picker"]');
  const options = () => [...(picker()?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])];

  async function type(text: string): Promise<void> {
    textarea.value = text;
    textarea.setSelectionRange(text.length, text.length);
    textarea.dispatchEvent(new Event('input'));
    await vi.advanceTimersByTimeAsync(200);
    fixture.detectChanges();
    await fixture.whenStable();
  }

  function press(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key, cancelable: true, bubbles: true, ...init });
    textarea.dispatchEvent(event);
    fixture.detectChanges();
    return event;
  }

  it('opens a listbox of matching people when @ starts a word', async () => {
    // Act
    await type('Hi @');

    // Assert
    expect(search).toHaveBeenCalledWith('', expect.any(AbortSignal));
    expect(picker()).not.toBeNull();
    expect(picker()?.querySelector('[role="listbox"]')?.id).toBe(
      textarea.getAttribute('aria-controls'),
    );
    expect(options().map((o) => o.dataset['testid'])).toEqual([
      'mention-option-ann@example.com',
      'mention-option-bob@example.com',
    ]);
    expect(options()[0].getAttribute('aria-selected')).toBe('true');
    expect(textarea.getAttribute('aria-activedescendant')).toBe(options()[0].id);
  });

  it('debounces the search and aborts the previous one', async () => {
    // Arrange
    const signals: AbortSignal[] = [];
    search.mockImplementation((query, signal) => {
      signals.push(signal);
      return new Promise(() => undefined);
    });
    await type('@a');

    // Act
    textarea.value = '@an';
    textarea.setSelectionRange(3, 3);
    textarea.dispatchEvent(new Event('input'));
    textarea.value = '@ann';
    textarea.setSelectionRange(4, 4);
    textarea.dispatchEvent(new Event('input'));
    await vi.advanceTimersByTimeAsync(200);

    // Assert
    expect(search.mock.calls.map(([query]) => query)).toEqual(['a', 'ann']);
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
  });

  it('moves with the arrows and inserts the active person with Enter', async () => {
    // Arrange
    await type('Hi @');

    // Act
    press('ArrowDown');
    const down = options()[1].getAttribute('aria-selected');
    press('ArrowDown');
    const wrapped = options()[0].getAttribute('aria-selected');
    press('ArrowUp');
    const enter = press('Enter');
    await fixture.whenStable();

    // Assert
    expect(down).toBe('true');
    expect(wrapped).toBe('true');
    expect(enter.defaultPrevented).toBe(true);
    expect(editor.value()).toBe(`Hi @[Bob Stone](user:${BOB.id}) `);
    expect(textarea.selectionStart).toBe(editor.value().length);
    expect(picker()).toBeNull();
    expect(events).toEqual([]);
  });

  it('inserts with Tab and filters by the typed query', async () => {
    // Arrange
    await type('cc @bo');

    // Act
    const tab = press('Tab');

    // Assert
    expect(search).toHaveBeenLastCalledWith('bo', expect.any(AbortSignal));
    expect(tab.defaultPrevented).toBe(true);
    expect(editor.value()).toBe(`cc @[Bob Stone](user:${BOB.id}) `);
  });

  it('inserts the clicked person', async () => {
    // Arrange
    await type('@');

    // Act
    options()[0].click();

    // Assert
    expect(editor.value()).toBe(`@[Ann Lee](user:${ANN.id}) `);
  });

  it('closes only the picker on Escape, then Escape cancels the editor', async () => {
    // Arrange
    await type('@a');

    // Act
    const first = press('Escape');
    press('Escape');

    // Assert
    expect(first.defaultPrevented).toBe(true);
    expect(picker()).toBeNull();
    expect(events).toEqual(['cancelled']);
  });

  it('stays closed after Escape until a new @ is typed', async () => {
    // Arrange
    await type('@a');
    press('Escape');

    // Act
    await type('@an');
    const afterSameMention = picker();
    await type('@an @');

    // Assert
    expect(afterSameMention).toBeNull();
    expect(picker()).not.toBeNull();
  });

  it('shows "No one matches" and lets Enter through as a newline', async () => {
    // Arrange
    await type('@zed');

    // Act
    const text = picker()?.textContent?.trim();
    const enter = press('Enter');

    // Assert
    expect(text).toBe('No one matches');
    expect(enter.defaultPrevented).toBe(false);
    expect(picker()).toBeNull();
  });

  it('closes when a multi-word query finds no one', async () => {
    // Act
    await type('@ann and more');

    // Assert
    expect(picker()).toBeNull();
  });

  it('submits with Ctrl+Enter whether the picker is open or not', async () => {
    // Arrange
    await type('@a');

    // Act
    press('Enter', { ctrlKey: true });

    // Assert
    expect(events).toEqual(['submitted:@a']);
    expect(picker()).toBeNull();
  });

  it('does not open for an @ inside a word or without a search', async () => {
    // Act
    await type('mail me@');
    const insideWord = picker();
    fixture.componentRef.setInput('mentionSearch', null);
    fixture.detectChanges();
    await type('@');

    // Assert
    expect(insideWord).toBeNull();
    expect(picker()).toBeNull();
    expect(textarea.hasAttribute('aria-autocomplete')).toBe(false);
  });

  it('shows picked people as chips in Preview', async () => {
    // Arrange
    await type('@');
    press('Enter');

    // Act
    editor.mode.set('preview');
    fixture.detectChanges();

    // Assert
    const chip = fixture.nativeElement.querySelector(`[data-testid="mention-${ANN.id}"]`);
    expect(chip?.textContent).toContain('Ann Lee');
  });
});
