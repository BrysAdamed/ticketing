import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, '..', 'dist', 'print');
const [, , target, countArg, svgPath, hostile] = process.argv;
const count = Number(countArg ?? 1);

const rows = Array.from({ length: 40 }, (_, i) => `| TKT-${i + 1} | Row ${i + 1} | ${i % 3 === 0 ? 'Done' : 'Open'} |`);
const markdown = (n) => `## Overview

This page is document ${n}. It mentions TKT-12 and links to [the spec](https://example.com/spec).

> [!NOTE]
> Rendering happens inside the PDF sidecar with no network.

\`\`\`mermaid
flowchart LR
  SPA[Angular SPA] -->|REST| API[Ticketing API]
  API --> DB[(PostgreSQL)]
  API -->|bundle| PDF[Gotenberg]
\`\`\`

## Sequence

\`\`\`mermaid
sequenceDiagram
  actor U as User
  U->>API: GET export.pdf
  API->>Gotenberg: POST bundle
  Gotenberg-->>API: PDF
\`\`\`

## Canvas

![Architecture sketch](TKT-D-7)

## Table

| Key | Title | Status |
| --- | --- | --- |
${rows.join('\n')}

## Code

\`\`\`csharp
public sealed class GotenbergPdfRenderer(HttpClient http) : IPdfRenderer
{
    public async Task<Stream> RenderAsync(PdfBundle bundle, CancellationToken cancellationToken)
    {
        using var form = new MultipartFormDataContent();
        var response = await http.PostAsync("/forms/chromium/convert/html", form, cancellationToken);
        return await response.Content.ReadAsStreamAsync(cancellationToken);
    }
}
\`\`\`
${hostile ? '\n![public](http://example.com/a.png) ![private](http://172.17.0.1:8111/favicon.svg) ![meta](http://169.254.169.254/latest/meta-data/)\n' : ''}`;

const documents = Array.from({ length: count }, (_, i) => ({
  key: `TKT-D-${100 + i}`,
  title: `Architecture note ${i + 1}`,
  version: 3,
  path: 'Architecture / Notes',
  updatedBy: 'Jane Doe',
  updatedAt: '2026-10-27',
  markdown: markdown(i + 1),
}));

const data = {
  project: 'Ticketing (TKT)',
  exportedBy: 'Jane Doe',
  exportedAt: '2026-10-27 16:40',
  folder: count > 1 ? 'Architecture / Notes' : null,
  documents,
  diagrams: { 'TKT-D-7': 'canvas-TKT-D-7.svg' },
};

const json = JSON.stringify(data).replace(/</g, '\\u003c');
const index = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${count > 1 ? data.folder : documents[0].title}</title>
<link rel="stylesheet" href="print.css"></head>
<body><main></main>
<script type="application/json" id="tk-print-data">${json}</script>
<script src="print.js"></script></body></html>`;

const band = (content) => `<!doctype html><html><head><style>
body { font-family: 'DejaVu Sans', sans-serif; font-size: 8px; color: #62656e; margin: 0 18mm; width: 100%;
  display: flex; justify-content: space-between; -webkit-print-color-adjust: exact; }
</style></head><body>${content}</body></html>`;

mkdirSync(target, { recursive: true });
writeFileSync(join(target, 'index.html'), index);
writeFileSync(join(target, 'header.html'), band(`<span>TKT · <span class="title"></span></span><span>Architecture / Notes</span>`));
writeFileSync(
  join(target, 'footer.html'),
  band(`<span>Exported 2026-10-27 16:40 by Jane Doe</span><span>${documents[0].key} v3</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>`),
);
for (const file of ['print.js', 'print.css', 'inter.woff2']) copyFileSync(join(dist, file), join(target, file));
copyFileSync(svgPath, join(target, 'canvas-TKT-D-7.svg'));
console.log(`${count} document(s) in ${target}`);
