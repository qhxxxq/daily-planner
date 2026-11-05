/**
 * 文件用途：发行资源清单一致性检查。
 * 核对网页与 Mac 打包使用的资源路径和清单，避免资源遗漏和误打包个人日程文件。
 */
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = dirname(fileURLToPath(import.meta.url));
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root = path.join(__dirname, '../..');
test('page and offline resources exist and are included in the Mac distribution manifest', () => {
  const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
  const html = read('index.html'),
    sw = read('sw.js'),
    build = read('macos/build-mac-app.sh');
  const assets = read('config/web-assets.txt').trim().split(/\r?\n/);
  const shell = [...sw.slice(0, sw.indexOf('worker.addEventListener')).matchAll(/"\.\/([^"]*)"/g)]
    .map((m) => m[1])
    .filter(Boolean);
  const links = [...html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((s) => !/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(s))
    .map((s) => s.split('?')[0]);
  const icons = JSON.parse(read('manifest.webmanifest')).icons.map((icon) => icon.src);
  assert.equal(new Set(assets).size, assets.length);
  for (const asset of assets) {
    assert.ok(!path.isAbsolute(asset) && !asset.split('/').includes('..'), asset);
    assert.ok(fs.statSync(path.join(root, asset)).isFile(), asset);
  }
  for (const resource of [...links, ...icons, ...shell, 'index.html', 'sw.js']) {
    assert.ok(assets.includes(resource), `not packaged: ${resource}`);
  }
  for (const resource of [...links, ...icons])
    assert.ok(shell.includes(resource), `not cached: ${resource}`);
  assert.ok(build.includes('$ROOT_DIR/config/web-assets.txt'));
  assert.ok(build.includes('cp "$ROOT_DIR/$resource" "$WEB_STAGE/$resource"'));
  assert.ok(!assets.includes('daily-planner-data.json'));
});
