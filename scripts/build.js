'use strict';

const esbuild = require('esbuild');
const path = require('path');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');
// --test 只打包单元测试，产物在 test/dist/，不进发布包
const test = process.argv.includes('--test');

const common = {
  absWorkingDir: path.join(__dirname, '..'),
  bundle: true,
  sourcemap: !production,
  minify: production,
  // 第三方许可证统一由 THIRD_PARTY_NOTICES.md 提供
  legalComments: 'none',
  logLevel: 'info',
};

// esbuild 只转译不做类型检查，类型检查由 pnpm run typecheck 完成
const targets = [
  {
    ...common,
    entryPoints: ['src/extension.ts'],
    outfile: 'dist/extension.js',
    platform: 'node',
    format: 'cjs',
    target: 'node16',
    external: ['vscode'],
  },
  {
    ...common,
    entryPoints: ['webview/main.ts'],
    outfile: 'dist/webview.js',
    platform: 'browser',
    format: 'iife',
    target: 'es2020',
  },
];

const testTarget = {
  ...common,
  entryPoints: ['test/run.ts'],
  outfile: 'test/dist/run.js',
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  logLevel: 'warning',
};

async function main() {
  const selected = test ? [testTarget] : targets;
  if (!watch) {
    await Promise.all(selected.map((t) => esbuild.build(t)));
    return;
  }
  for (const t of selected) {
    const ctx = await esbuild.context(t);
    await ctx.watch();
  }
}

main().catch(() => process.exit(1));
