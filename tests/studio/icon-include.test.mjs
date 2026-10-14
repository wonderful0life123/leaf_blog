import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {iconIncludes} from '../../scripts/icon-include.mjs';

test('build icons follow template, config and MDX edits without bundling unused packs', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wonder-icons-'));
  t.after(() => fs.rmSync(root, {recursive:true, force:true}));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    dependencies: {'@iconify-json/mdi':'1', '@iconify-json/fa7-solid':'1'},
    devDependencies: {'@iconify-json/mingcute':'1'},
  }));
  fs.writeFileSync(path.join(root, 'src/nav.ts'), 'export const links = [{icon:"mdi:home"}];');
  fs.writeFileSync(path.join(root, 'src/page.astro'), '<Icon name="mdi:home"/><Icon name={links[0].icon}/>');
  fs.writeFileSync(path.join(root, 'src/article.mdx'), '<Icon name="fa7-solid:rocket"/>');
  assert.deepEqual(iconIncludes(root), {'mdi':['home'], 'fa7-solid':['rocket'], mingcute:[]});
  fs.writeFileSync(path.join(root, 'src/nav.ts'), 'export const links = [{icon:"mdi:pencil"}];');
  assert.deepEqual(iconIncludes(root).mdi, ['home','pencil']);
  fs.writeFileSync(path.join(root, 'src/dynamic.astro'), '<Icon name={`mdi:${name}`}/>');
  assert.deepEqual(iconIncludes(root).mdi, ['*']);
  assert.deepEqual(iconIncludes(root, {mingcute:['*']}).mingcute, ['*']);
});
