import { build } from 'esbuild';
import { compile } from 'sass';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, '..');
const out = join(web, 'dist', 'print');
mkdirSync(out, { recursive: true });

const result = await build({
  entryPoints: [join(here, 'print-main.ts')],
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2022',
  tsconfig: join(web, 'tsconfig.app.json'),
  outfile: join(out, 'print.js'),
  legalComments: 'none',
  metafile: true,
  define: { 'process.env.NODE_ENV': '"production"' },
});
writeFileSync(join(out, 'meta.json'), JSON.stringify(result.metafile));

const css = compile(join(here, 'print.scss'), { loadPaths: [join(web, 'src')], style: 'compressed' });
writeFileSync(join(out, 'print.css'), css.css);
copyFileSync(
  join(web, 'node_modules', '@fontsource-variable', 'inter', 'files', 'inter-latin-wght-normal.woff2'),
  join(out, 'inter.woff2'),
);
console.log('print bundle written to', out);
