import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
export function runtimeIntegration(siteConfig, galleryConfig) {
	let routes = siteConfig.pages.gallery
		? galleryConfig.albums.map((a) => "/gallery/" + a.id + "/")
		: [];
	const allowed = (url) => {
		if (
			!url ||
			/^\/(?:(?:studio|admin-prototype|api|og|404|pagefind|published-media)(?:[/.]|$)|runtime-)/.test(
				url,
			) ||
			/\.[a-z\d]+\/?$/i.test(url)
		)
			return false;
		const name = url.split("/")[1];
		return !(name in siteConfig.pages && siteConfig.pages[name] === false);
	};
	return {
		name: "wonder-runtime",
		hooks: {
			"astro:config:setup": ({ injectRoute }) => {
				for (const pattern of [
					"/runtime-release.json",
					"/pagefind/[...asset]",
					"/runtime-search/[...asset]",
					"/published-media/[...asset]",
					"/sitemap-index.xml",
					"/sitemap-0.xml",
				])
					injectRoute({
						pattern,
						entrypoint: "./src/runtime/endpoint.ts",
						prerender: false,
					});
			},
			"astro:route:setup": ({ route }) => {
				if (
					route.component.endsWith(".astro") &&
					!/studio|admin-prototype/.test(route.component)
				)
					route.prerender = false;
				if (/(?:rss\.xml|allPostMeta\.json)\.ts$/.test(route.component))
					route.prerender = false;
			},
			"astro:routes:resolved": ({ routes: resolved }) => {
				routes.push(
					...resolved
						.filter((r) => r.type === "page" && r.pathname)
						.map((r) => r.pathname),
				);
			},
			"astro:build:done": ({ pages, dir }) => {
				const urls = [
					...new Set(
						[
							...routes,
							...pages.map((p) => "/" + p.pathname.replace(/^\//, "")),
						]
							.filter(allowed)
							.map((p) => (p.endsWith("/") ? p : p + "/")),
					),
				];
				const out = fileURLToPath(dir);
				const root = path.basename(out) === "client" ? path.dirname(out) : out;
				fs.writeFileSync(
					path.join(root, "runtime-build.json"),
					JSON.stringify({ format: 1, staticUrls: urls }),
				);
			},
		},
	};
}
