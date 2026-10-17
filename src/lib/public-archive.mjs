export const ARCHIVE_FILE = "src/data/public-archive.json";
// This manifest contains only public post ids and the ancestor names they need.
export function archiveManifest(organization, posts) {
	const folders = new Map(organization.folders.map((f) => [f.id, f]));
	const paths = Object.create(null);
	for (const post of posts) {
		const key = "blog:" + post.path;
		if (!Object.hasOwn(organization.placements, key)) continue;
		let id = organization.placements[key];
		const segments = [];
		const seen = new Set();
		while (id !== null) {
			const folder = folders.get(id);
			if (!folder || seen.has(id))
				throw Error("目录结构无效，请刷新工作台后重试。");
			seen.add(id);
			segments.unshift(folder.name);
			id = folder.parent;
		}
		paths[post.path.replace(/\.mdx?$/, "")] = segments;
	}
	return { format: 1, paths };
}
export function validateArchive(value) {
	if (
		value?.format !== 1 ||
		!value.paths ||
		typeof value.paths !== "object" ||
		Array.isArray(value.paths)
	)
		throw Error("公开目录文件格式无效");
	for (const [id, segments] of Object.entries(value.paths)) {
		if (
			!id ||
			id.startsWith("/") ||
			id.split("/").some((s) => !s || s === "." || s === "..") ||
			!Array.isArray(segments) ||
			segments.some(
				(s) =>
					typeof s !== "string" ||
					!s.trim() ||
					// biome-ignore lint/suspicious/noControlCharactersInRegex: Reject control characters in filesystem names and URLs.
					/[\\/\u0000-\u001f\u007f]/.test(s),
			)
		)
			throw Error("公开目录条目无效");
	}
	return value;
}
export function withArchivePath(entry, manifest) {
	const data = { ...entry.data };
	delete data.archivePath;
	if (entry.data.articleId)
		data.archivePath = entry.id.split("/").slice(0, -1).join("/");
	if (Object.hasOwn(manifest.paths, entry.id))
		data.archivePath = manifest.paths[entry.id].join("/");
	return { ...entry, data };
}
