export function createMarkdownCache(
	render,
	{ maxEntries = 8, maxChars = 1_000_000 } = {},
) {
	const entries = new Map();
	let catalog;
	let chars = 0;
	return (body, article, assetMap) => {
		if (catalog !== assetMap) {
			entries.clear();
			chars = 0;
			catalog = assetMap;
		}
		const key = JSON.stringify([
			body,
			article.root,
			article.path,
			article.assets,
		]);
		const hit = entries.get(key);
		if (hit) {
			entries.delete(key);
			entries.set(key, hit);
			return hit.html;
		}
		const html = render(body, article);
		const size = key.length + html.length;
		if (size <= maxChars) {
			while (
				entries.size &&
				(entries.size >= maxEntries || chars + size > maxChars)
			) {
				const oldest = entries.keys().next().value;
				chars -= entries.get(oldest).size;
				entries.delete(oldest);
			}
			entries.set(key, { html, size });
			chars += size;
		}
		return html;
	};
}
