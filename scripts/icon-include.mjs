import fs from 'node:fs';
import path from 'node:path';

// Astro Icon otherwise embeds every installed collection in a virtual module
// (over 20 MB). Scan literals in templates, configuration and MDX, including
// icons passed through component props. Local SVG icons remain managed by Astro.
export function iconIncludes(root, extra = {}) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const packs = Object.keys({...pkg.dependencies, ...pkg.devDependencies})
    .filter(name => name.startsWith('@iconify-json/')).map(name => name.slice(14));
  const names = new Map(packs.map(pack => [pack, new Set(extra[pack] || [])]));
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
      if (entry.name.startsWith('.')) continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile() && /\.(?:astro|svelte|[cm]?[jt]sx?|mdx?|json|ya?ml)$/.test(entry.name)) {
        const source = fs.readFileSync(file, 'utf8');
        for (const [, , pack, name] of source.matchAll(/(["'`])([a-z0-9-]+):([^"'`\r\n]*)\1/g)) {
          const selected = names.get(pack);
          if (!selected) continue;
          // A known prefix with a computed name needs its whole collection.
          selected.add(/^[a-z0-9-]+$/.test(name) ? name : '*');
        }
      }
    }
  }
  walk(path.join(root, 'src'));
  // Include even unused installed packs as []: omitted packs default to '*'.
  return Object.fromEntries([...names].map(([pack, selected]) =>
    [pack, selected.has('*') ? ['*'] : [...selected].sort()]));
}
