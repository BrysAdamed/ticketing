export const EXCALIDRAW_ASSET_PATH = 'excalidraw/';
export const EXCALIDRAW_STYLESHEET = `${EXCALIDRAW_ASSET_PATH}index.css`;

type ExcalidrawModule = typeof import('@excalidraw/excalidraw');

/// The lazily loaded pieces of the Canvas editor: React, react-dom and Excalidraw.
export interface ExcalidrawRuntime {
  react: typeof import('react');
  createRoot: (typeof import('react-dom/client'))['createRoot'];
  excalidraw: ExcalidrawModule;
}

let runtime: Promise<ExcalidrawRuntime> | undefined;

/// Loads React and Excalidraw on first use and points Excalidraw at the self-hosted fonts and
/// stylesheet that angular.json copies to /excalidraw/ (ADR 0014): no request leaves our origin.
export function loadExcalidraw(doc: Document = document): Promise<ExcalidrawRuntime> {
  runtime ??= (async () => {
    const view = doc.defaultView as (Window & { EXCALIDRAW_ASSET_PATH?: string }) | null;
    if (view) view.EXCALIDRAW_ASSET_PATH = new URL(EXCALIDRAW_ASSET_PATH, doc.baseURI).href;
    const [react, client, excalidraw] = await Promise.all([
      import('react'),
      import('react-dom/client'),
      import('@excalidraw/excalidraw'),
      ensureStylesheet(doc, new URL(EXCALIDRAW_STYLESHEET, doc.baseURI).href),
    ]);
    return { react: commonJs(react), createRoot: commonJs(client).createRoot, excalidraw };
  })();
  runtime.catch(() => (runtime = undefined));
  return runtime;
}

function commonJs<T extends object>(module: T): T {
  return (module as T & { default?: T }).default ?? module;
}

function ensureStylesheet(doc: Document, href: string): Promise<void> {
  if (doc.querySelector(`link[rel="stylesheet"][href="${href}"]`)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const link = doc.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.onload = () => resolve();
    link.onerror = () => reject(new Error(`Could not load ${href}`));
    doc.head.appendChild(link);
  });
}
