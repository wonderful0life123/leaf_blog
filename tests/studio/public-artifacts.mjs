import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Check the generated output, not the build configuration: an unused Studio
// route can still pull the entire editor into Astro's client compilation.
export function assertPublicArtifacts(dist) {
  const files = fs.readdirSync(dist, {recursive: true});
  assert.ok(!files.some(file => /(?:^|\/)(?:Studio|WritingEditor)[.]/.test(file)),
    'Public publishing must not compile or ship the private Studio editor');
  for (const name of ['studio', 'studio-static', '.studio-preview', 'publications']) {
    assert.ok(!fs.existsSync(path.join(dist, name)), `Private output leaked: ${name}`);
  }
  for (const name of ['index.html', 'archive/index.html', 'rss.xml', 'sitemap-index.xml', 'pagefind/pagefind.js']) {
    assert.ok(fs.existsSync(path.join(dist, name)), `Missing public output: ${name}`);
  }
}
