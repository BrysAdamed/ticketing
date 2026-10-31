import { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { MentionCandidate } from '@shared/markdown/mentions';
import { DocMentionCompletionDeps, mentionSource } from './doc-mention-completions';

const ANA: MentionCandidate = {
  id: '0190a3f2-6f1e-7c3a-9b1d-2e4f5a6b7c8d',
  email: 'ana@x.test',
  displayName: 'Ana Lee',
};

function setup(text: string) {
  const parent = document.createElement('div');
  const view = new EditorView({
    parent,
    state: EditorState.create({ doc: text, selection: { anchor: text.length } }),
  });
  const search = vi.fn(async () => [ANA]);
  const picked = vi.fn();
  const deps: DocMentionCompletionDeps = { search, picked };
  const context = new CompletionContext(view.state, text.length, false, view);
  return { view, search, picked, deps, context };
}

function apply(view: EditorView, result: CompletionResult, option: Completion): void {
  (option.apply as (v: EditorView, c: Completion, from: number, to: number) => void)(
    view,
    option,
    result.from,
    view.state.selection.main.head,
  );
}

describe('doc mention completions', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('searches the typed name and inserts the stored token with a trailing space', async () => {
    // Arrange
    const { view, search, picked, deps, context } = setup('Owner: @an');

    // Act
    const pending = mentionSource(context, deps);
    await vi.runAllTimersAsync();
    const result = (await pending)!;
    apply(view, result, result.options[0]);

    // Assert
    expect(search).toHaveBeenCalledWith('an', expect.any(AbortSignal));
    expect(result.options.map((o) => [o.label, o.detail])).toEqual([['Ana Lee', 'ana@x.test']]);
    expect(view.state.doc.toString()).toBe(`Owner: @[Ana Lee](user:${ANA.id}) `);
    expect(view.state.selection.main.head).toBe(view.state.doc.length);
    expect(picked).toHaveBeenCalledWith(ANA);
  });

  it('ignores an @ inside code and inside an email address', async () => {
    // Arrange
    const inCode = setup('```\nmail @an');
    const inEmail = setup('write to ana@x');

    // Act
    const results = [
      await mentionSource(inCode.context, inCode.deps),
      await mentionSource(inEmail.context, inEmail.deps),
    ];

    // Assert
    expect(results).toEqual([null, null]);
    expect(inCode.search).not.toHaveBeenCalled();
    expect(inEmail.search).not.toHaveBeenCalled();
  });

  it('says so when nobody matches', async () => {
    // Arrange
    const { search, deps, context } = setup('@zz');
    search.mockResolvedValue([]);

    // Act
    const pending = mentionSource(context, deps);
    await vi.runAllTimersAsync();
    const result = (await pending)!;

    // Assert
    expect(result.options.map((o) => o.label)).toEqual(['Nobody matches “zz”']);
  });
});
