import { slug as githubSlug } from "github-slugger";
export const ROUTES_FILE = "src/data/article-routes.json";
export function nameSegment(value) {
	const name = typeof value === "string" ? value.normalize("NFC") : "";
	if (
		!name ||
		name.length > 120 ||
		// biome-ignore lint/suspicious/noControlCharactersInRegex: Reject control characters in filesystem names and URLs.
		/[\\/<>:"|?*%#\u0000-\u001f\u007f]/.test(name) ||
		/[. ]$/.test(name) ||
		/^\s/.test(name) ||
		[".", ".."].includes(name) ||
		/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)
	)
		throw Error("名称不能包含路径分隔符、保留字符、保留文件名或首尾空格。");
	return name;
}
export function normalizeArticlePath(value) {
	if (typeof value !== "string" || value.length > 500 || !value.endsWith(".md"))
		throw Error("文章路径必须是内容目录内的 .md 文件。");
	const parts = value.split("/").map(nameSegment);
	nameSegment(parts.at(-1).slice(0, -3));
	return parts.join("/");
}
export const pathKey = (value) =>
	value.normalize("NFC").toLocaleLowerCase("en-US");
export const routeFromPath = (value) => value.replace(/\.mdx?$/, "");
export const legacyArticleRoute = (file, data = {}) =>
	String(
		data.slug ||
			routeFromPath(file)
				.split("/")
				.map(githubSlug)
				.join("/")
				.replace(/\/index$/, ""),
	);
export const postUrl = (route) =>
	"/posts/" + route.split("/").map(encodeURIComponent).join("/") + "/";
export const articleIdentity = (source, data = {}) =>
	data.articleId || "legacy:" + source;
export function decodeRoute(value) {
	return value
		.split("/")
		.map((part) => {
			const raw = decodeURIComponent(part);
			if (
				!raw ||
				raw === "." ||
				raw === ".." ||
				// biome-ignore lint/suspicious/noControlCharactersInRegex: Reject control characters in filesystem names and URLs.
				/[\\/\u0000-\u001f\u007f]/.test(raw)
			)
				throw Error("无效的网址");
			return raw.normalize("NFC");
		})
		.join("/");
}
export function validateRoutes(value) {
	if (value?.format !== 1 || !Array.isArray(value.articles))
		throw Error("文章路由清单格式无效");
	const ids = new Set();
	const paths = new Set();
	const routes = new Map();
	for (const a of value.articles) {
		if (
			typeof a.id !== "string" ||
			!a.id ||
			ids.has(a.id) ||
			typeof a.path !== "string" ||
			!Array.isArray(a.aliases)
		)
			throw Error("文章身份重复或无效");
		ids.add(a.id);
		if (
			a.path.startsWith("/") ||
			a.path
				.split("/")
				.some((p) => !p || p === "." || p === ".." || p.includes("\\"))
		)
			throw Error("文章路径无效");
		if (paths.has(pathKey(a.path))) throw Error("文章路径冲突");
		paths.add(pathKey(a.path));
		for (const route of [a.route, ...a.aliases]) {
			if (
				typeof route !== "string" ||
				!route ||
				route.startsWith("/") ||
				route.split("/").some(
					(p) =>
						// biome-ignore lint/suspicious/noControlCharactersInRegex: Reject control characters in filesystem names and URLs.
						!p || p === "." || p === ".." || /[\\%?#\u0000-\u001f]/.test(p),
				)
			)
				throw Error("文章路由无效");
			const key = pathKey(route);
			const owner = routes.get(key);
			if (owner && owner !== a.id) throw Error("文章网址与历史网址冲突");
			routes.set(key, a.id);
		}
	}
	return value;
}
export function redirectTarget(manifest, route) {
	const a = manifest?.articles?.find((a) => a.aliases.includes(route));
	return a && a.route !== route ? postUrl(a.route) : null;
}
export function suggestedFilename(title) {
	const cleaned =
		String(title || "未命名文章")
			.normalize("NFC")
			// biome-ignore lint/suspicious/noControlCharactersInRegex: Reject control characters in filesystem names and URLs.
			.replace(/[\\/<>:"|?*%#\u0000-\u001f\u007f]/g, "-")
			.trim()
			.replace(/[. ]+$/, "")
			.slice(0, 100) || "未命名文章";
	try {
		return nameSegment(cleaned) + ".md";
	} catch {
		return "文章-" + cleaned + ".md";
	}
}

export function articleGuid(entry, site, route) {
	return (
		entry?.guid ||
		String(site).replace(/\/$/, "") +
			"/posts/" +
			(entry?.guidRoute || route) +
			"/"
	);
}
export function rssGuidXml(entry, site, route) {
	const guid = articleGuid(entry, site, route);
	const escaped = guid.replace(
		/[&<>"']/g,
		(c) =>
			({
				"&": "&amp;",
				"<": "&lt;",
				">": "&gt;",
				'"': "&quot;",
				"'": "&apos;",
			})[c],
	);
	return `<guid isPermaLink="${!entry?.guid}">${escaped}</guid>`;
}
