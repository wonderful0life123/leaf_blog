import fs from 'node:fs';
import path from 'node:path';
import {digest} from './publication-content.mjs';
import {fromMarkdown} from 'mdast-util-from-markdown';

// Compare against the current published source, including legacy articles which
// have never been published through Studio. Directory-owned category is excluded.
export function contentComparison(postsRoot, bindings) {
  const imageHashes = new Map();
  const paths = new Map();
  for (const b of bindings) for (const p of [b.path, ...b.aliases]) paths.set(p, b);
  function reference(href, kind, article, base) {
    if (kind === 'image' || kind === 'definition') {
      const asset = article.assets?.[href] || href;
      const media = asset.match(/^\/studio-api\/media\/([a-f\d]{64})\/?$/);
      if (media) return 'image:' + media[1];
    }
    if (!href || href.startsWith('#') || /^(?:[a-z][\w+.-]*:|\/\/)/i.test(href)) return href;
    const cut = href.search(/[?#]/), raw = cut < 0 ? href : href.slice(0, cut), suffix = cut < 0 ? '' : href.slice(cut);
    let decoded;
    try { decoded = decodeURIComponent(raw); } catch { return href; }
    if (decoded.startsWith('/posts/')) {
      const route = decoded.slice(7).replace(/\/$/, '');
      const binding = bindings.find(b => b.route === route || b.aliases.some(p => p.replace(/\.md$/, '') === route));
      return binding ? 'article:' + binding.articleId + suffix : href;
    }
    if (decoded.startsWith('/')) return href;
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(base), decoded));
    if (resolved.startsWith('../')) return href;
    const binding = paths.get(resolved);
    if (binding) return 'article:' + binding.articleId + suffix;
    if (kind === 'image' || kind === 'definition') {
      if (!imageHashes.has(resolved)) {
        let hash = null;
        try {
          const root = fs.realpathSync(postsRoot), file = fs.realpathSync(path.join(root, resolved));
          if (file.startsWith(root + path.sep) && fs.statSync(file).size <= 10 * 1024 * 1024) hash = digest(fs.readFileSync(file));
        } catch { /* Missing assets must never make unlike content compare equal. */ }
        imageHashes.set(resolved, hash);
      }
      if (imageHashes.get(resolved)) return 'image:' + imageHashes.get(resolved) + suffix;
    }
    return 'path:' + resolved + suffix;
  }
  const tags = value => String(value || '').split(/[,，]/).map(t => t.trim()).filter(Boolean);
  function body(article, base) {
    const tree = fromMarkdown((article.body || '').replace(/\r\n/g, '\n').trim());
    const definitions = new Map();
    function collect(node) {
      if (node.type === 'definition' && !definitions.has(node.identifier)) definitions.set(node.identifier, node);
      for (const child of node.children || []) collect(child);
    }
    collect(tree);
    function canonical(node) {
      const definition = definitions.get(node.identifier);
      if (definition && ['imageReference', 'linkReference'].includes(node.type)) {
        node = node.type === 'imageReference'
          ? {type: 'image', alt: node.alt, title: definition.title, url: definition.url}
          : {type: 'link', children: node.children, title: definition.title, url: definition.url};
      }
      return Object.fromEntries(Object.keys(node).filter(key => key !== 'position').sort().map(key => [key,
        key === 'children' ? node.children.map(canonical)
          : key === 'url' ? reference(node.url, node.type, article, base) : node[key],
      ]));
    }
    return JSON.stringify(canonical(tree));
  }
  return (draft, published) => {
    if (draft.title.trim() !== published.title.trim() || JSON.stringify(tags(draft.tags)) !== JSON.stringify(tags(published.tags))) return true;
    try {
      return body(draft, draft.source?.referencePath || draft.source?.path || published.path) !== body(published, published.path);
    } catch { return true; }
  };
}
