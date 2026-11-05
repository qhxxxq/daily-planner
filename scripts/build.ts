/**
 * 文件用途：网页与测试资源构建。
 * 使用 esbuild 生成浏览器与样式包；按资源内容计算离线缓存版本，仅在测试参数启用时生成测试入口。
 */
import { build } from 'esbuild';
import { mkdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

// 网页与离线 Mac 应用共用同一套构建产物，避免两端代码来源分叉。
await mkdir('build', { recursive: true });
const options = { bundle: true, platform: 'browser' as const, target: 'safari15' };
await build({
  ...options,
  entryPoints: ['src/app.ts'],
  outfile: 'build/app.js',
  format: 'iife',
  sourcemap: true,
});
await build({ ...options, entryPoints: ['src/ui/styles.css'], outfile: 'build/app.css' });
/** 缓存版本由资源清单、实际资源内容和 Service Worker 源码共同决定；文件内容变化后生成新的缓存名称。 */
const hash = createHash('sha256');
const manifest = await readFile('config/web-assets.txt', 'utf8');
const resources = manifest
  .split(/\r?\n/)
  .filter((file) => file && !file.startsWith('#') && file !== 'sw.js');
hash.update(manifest);
for (const file of [...resources, 'src/service-worker.ts']) {
  hash.update(file);
  hash.update(await readFile(file));
}

await build({
  ...options,
  entryPoints: ['src/service-worker.ts'],
  outfile: 'sw.js',
  format: 'iife',
  define: { __BUILD_VERSION__: JSON.stringify(hash.digest('hex').slice(0, 16)) },
});

// 仅独立测试包暴露内部函数；正常发行入口不包含这些测试接口。
if (process.argv.includes('--tests')) {
  await build({
    ...options,
    entryPoints: ['tests/helpers/browser.ts'],
    outfile: 'build/test-browser.js',
    format: 'iife',
  });
}
console.log(`Built browser and offline assets in ${resolve('build')}`);
