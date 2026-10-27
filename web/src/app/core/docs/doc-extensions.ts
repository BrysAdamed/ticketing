import {
  EnvironmentProviders,
  InjectionToken,
  Injector,
  makeEnvironmentProviders,
  Type,
} from '@angular/core';
import { Doc } from './doc.models';

/// Where a page section is rendered: below the page content (`footer`, full width of the body)
/// or in the right rail under "On this page" (`rail`, hidden below 1200 px).
export type DocPageSectionPlacement = 'footer' | 'rail';

/// A section other stories add to the page reader (attachments, backlinks, comments, …). The
/// component receives the input `doc` (`input.required<Doc>()`, the latest published page) and is
/// re-created when the doc key changes. Sections render in ascending `order`.
export interface DocPageSection {
  /// Stable id, also used as `data-testid="doc-section-<id>"`.
  readonly id: string;
  readonly order: number;
  readonly placement: DocPageSectionPlacement;
  readonly loadComponent: () => Promise<Type<unknown>>;
}

export const DOC_PAGE_SECTIONS = new InjectionToken<readonly DocPageSection[]>(
  'DOC_PAGE_SECTIONS',
  { factory: () => [] },
);

/// Registers a page section, e.g. in the `providers` of the docs routes.
export function provideDocPageSection(section: DocPageSection): EnvironmentProviders {
  return makeEnvironmentProviders([{ provide: DOC_PAGE_SECTIONS, useValue: section, multi: true }]);
}

/// What an enhancer knows about the markdown it post-processes.
export interface DocMarkdownContext {
  /// `view` in the page reader, `preview` in the editor's live preview (re-rendered while typing).
  readonly mode: 'view' | 'preview';
  readonly theme: 'light' | 'dark';
  /// The doc being shown, when there is one.
  readonly docKey: string | null;
  /// Aborted when the HTML is replaced (new source, theme change) or the view is destroyed.
  readonly signal: AbortSignal;
}

/// Post-processes the rendered markdown of a doc after its HTML is set (code highlighting,
/// Mermaid blocks, embeds, …). It may replace descendants of `host` but must not change `host`
/// itself; work that finishes after `signal` aborted must be dropped.
export interface DocMarkdownEnhancer {
  readonly id: string;
  /// Lower runs first.
  readonly order: number;
  enhance(host: HTMLElement, context: DocMarkdownContext): void | Promise<void>;
}

export const DOC_MARKDOWN_ENHANCERS = new InjectionToken<readonly DocMarkdownEnhancer[]>(
  'DOC_MARKDOWN_ENHANCERS',
  { factory: () => [] },
);

export function provideDocMarkdownEnhancer(enhancer: DocMarkdownEnhancer): EnvironmentProviders {
  return makeEnvironmentProviders([
    { provide: DOC_MARKDOWN_ENHANCERS, useValue: enhancer, multi: true },
  ]);
}

/// The page editor as seen by a plugin action (toolbar button or slash command).
export interface DocEditorCommandContext {
  readonly docKey: string;
  readonly projectKey: string;
  /// The editor's injector (the docs layout's stores included), for dialogs a plugin opens.
  readonly injector: Injector;
  /// The selected text (empty when the selection is a caret).
  selectedText(): string;
  /// Replaces the selection with `text`; the caret goes to its end, or selects `select` inside it.
  replaceSelection(text: string, select?: { from: number; to: number }): void;
  /// Inserts `text` as its own block (blank lines around it) after the caret's line; the caret
  /// goes to the offset `caret` in `text` (default its end).
  insertBlock(text: string, caret?: number): void;
  focus(): void;
}

export interface DocEditorAction {
  readonly id: string;
  readonly label: string;
  /// A registered ng-icons name (register extra icons with `provideIcons` next to the plugin).
  readonly icon: string;
  /// Shown next to slash commands and in the toolbar tooltip.
  readonly hint?: string;
  run(context: DocEditorCommandContext): void | Promise<void>;
}

/// Extends the page editor: toolbar buttons, slash commands and CodeMirror extensions (for
/// example `[[` doc-link completion or ticket-key completion). `extensions` is loaded with the
/// editor chunk and returns CodeMirror `Extension`s.
export interface DocEditorPlugin {
  readonly id: string;
  readonly order: number;
  readonly toolbar?: readonly DocEditorAction[];
  readonly slashCommands?: readonly DocEditorAction[];
  readonly extensions?: (context: { docKey: string; projectKey: string }) => Promise<unknown[]>;
}

export const DOC_EDITOR_PLUGINS = new InjectionToken<readonly DocEditorPlugin[]>(
  'DOC_EDITOR_PLUGINS',
  { factory: () => [] },
);

export function provideDocEditorPlugin(plugin: DocEditorPlugin): EnvironmentProviders {
  return makeEnvironmentProviders([{ provide: DOC_EDITOR_PLUGINS, useValue: plugin, multi: true }]);
}

/// Inputs a page section component may declare.
export interface DocPageSectionInputs {
  doc: Doc;
}
