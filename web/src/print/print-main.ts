import { PRINT_DATA_ID, PrintData } from './print-data';
import { buildPrint, drawDiagrams } from './print-document';

declare global {
  interface Window {
    __printReady?: boolean;
  }
}

/// Entry of the PDF print bundle (D-111): reads the export data the API embedded, renders it with
/// the SPA's own markdown and Mermaid renderers, then flags readiness for Chromium. A failure is
/// rethrown as an uncaught error, so the renderer refuses the export instead of printing half of it.
async function main(): Promise<void> {
  const data = JSON.parse(document.getElementById(PRINT_DATA_ID)!.textContent!) as PrintData;
  document.body.classList.add(`mode-${data.mode}`);

  const root = document.querySelector('main')!;
  root.append(...buildPrint(document, data));
  await drawDiagrams(root, data);
  await document.fonts.ready;
  await Promise.all(Array.from(document.images).map((img) => img.decode().catch(() => undefined)));
}

main()
  .catch((error: unknown) =>
    setTimeout(() => {
      throw error;
    }),
  )
  .finally(() =>
    setTimeout(() => {
      window.__printReady = true;
    }),
  );
