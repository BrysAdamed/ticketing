// Builds the PDF print bundle (D-111, ADR 0014): print.js (the SPA's markdown and Mermaid renderers,
// one classic script), print.css (tokens + markdown + print rules) and the Inter fonts, into
// dist/print (or the directory given as the first argument). Fails when Angular, Excalidraw or
// React end up in the bundle: it must stay framework-free and never run the Canvas editor.
import { build } from 'esbuild';
import { compile } from 'sass';
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(web, 'src', 'print');
const out = resolve(process.argv[2] ?? join(web, 'dist', 'print'));
const forbidden = [/node_modules[\\/]@angular[\\/]/, /node_modules[\\/]@excalidraw[\\/]/, /node_modules[\\/]react(-dom)?[\\/]/];

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const result = await build({
  entryPoints: [join(source, 'print-main.ts')],
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2022',
  platform: 'browser',
  tsconfig: join(web, 'tsconfig.app.json'),
  outfile: join(out, 'print.js'),
  legalComments: 'none',
  metafile: true,
  logLevel: 'warning',
  define: { 'process.env.NODE_ENV': '"production"' },
});

const offenders = Object.keys(result.metafile.inputs).filter((input) => forbidden.some((pattern) => pattern.test(input)));
if (offenders.length > 0) {
  console.error('The print bundle must not contain Angular, Excalidraw or React:');
  for (const input of offenders.slice(0, 20)) console.error(`  ${input}`);
  process.exit(1);
}

const css = compile(join(source, 'print.scss'), { loadPaths: [join(web, 'src')], style: 'compressed' });
writeFileSync(join(out, 'print.css'), css.css);
const fonts = join(web, 'node_modules', '@fontsource-variable', 'inter', 'files');
copyFileSync(join(fonts, 'inter-latin-wght-normal.woff2'), join(out, 'inter-latin.woff2'));
copyFileSync(join(fonts, 'inter-latin-ext-wght-normal.woff2'), join(out, 'inter-latin-ext.woff2'));

const bytes = Object.values(result.metafile.outputs).reduce((sum, output) => sum + output.bytes, 0);
console.log(`print bundle: ${out} (print.js ${(bytes / 1024 / 1024).toFixed(1)} MB)`);
