// Public content routes never expose Studio tasks, raw snapshots or directories.
import fs from "node:fs";
import path from "node:path";
import { defineMiddleware } from "astro:middleware";
import { releaseContext } from "./context";
import { currentRelease } from "./loader";
const mime = {
	".js": "text/javascript",
	".json": "application/json",
	".xml": "application/xml",
	".wasm": "application/wasm",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
	".gif": "image/gif",
	".avif": "image/avif",
};
const proxy = `let configured={};const modules=new Map();
export async function options(value){configured={...configured,...value};}
async function current(){const response=await fetch('/runtime-release.json',{cache:'no-store'});if(!response.ok)throw Error('Search unavailable');const manifest=await response.json();if(!modules.has(manifest.search))modules.set(manifest.search,import(manifest.search));const api=await modules.get(manifest.search);await api.options(configured);return api;}
export async function search(...args){return (await current()).search(...args);}
export async function filters(...args){return (await current()).filters(...args);}`;
export const runtimeRequest = defineMiddleware(async (context, next) => {
	const failure = (status: number, message: string) =>
		new Response(message, {
			status,
			headers: {
				"Cache-Control": "no-store",
				"X-Content-Type-Options": "nosniff",
			},
		});
	let release: string, releases: string;
	const pathname = context.url.pathname;
	try {
		release = fs.realpathSync(process.env.WONDER_RUNTIME_LIVE_LINK!);
		releases = fs.realpathSync(process.env.WONDER_RUNTIME_RELEASE_DIR!);
	} catch {
		return failure(503, "Unavailable");
	}
	if (!release.startsWith(releases + path.sep))
		return failure(503, "Unavailable");
	try {
		releaseContext.run(release, () => currentRelease());
	} catch {
		return new Response("Content/code mismatch", {
			status: 503,
			headers: { "Cache-Control": "no-store" },
		});
	}
	if (
		!/\.[a-zA-Z\d_]+$/.test(pathname) &&
		!pathname.endsWith("/") &&
		!pathname.startsWith("/api/")
	)
		return context.redirect(pathname + "/" + context.url.search, 301);
	let bytes: string | Buffer | undefined,
		contentType: string | undefined,
		immutable = false;
	if (pathname === "/pagefind/pagefind.js") {
		bytes = proxy;
		contentType = "text/javascript";
	} else if (pathname === "/runtime-release.json") {
		bytes = fs.readFileSync(path.join(release, "manifest.json"));
		contentType = "application/json";
	} else if (
		["/rss.xml", "/sitemap-0.xml", "/sitemap-index.xml"].includes(pathname)
	) {
		bytes = fs.readFileSync(path.join(release, pathname.slice(1)));
		contentType = "application/xml";
	} else if (
		pathname.startsWith("/runtime-search/") ||
		pathname.startsWith("/published-media/")
	) {
		const match = pathname.match(
			/^\/(runtime-search|published-media)\/([a-f\d-]{36}|code-[a-f\d]{40})\/(.+)$/,
		);
		if (
			!match ||
			match[3]
				.split("/")
				.some((p) => p === ".." || p === "." || !/^[a-zA-Z\d_.-]+$/.test(p))
		)
			return failure(404, "Not found");
		const base = path.join(
			releases,
			match[2],
			match[1] === "runtime-search" ? "pagefind" : "media",
		);
		try {
			const file = fs.realpathSync(path.join(base, match[3]));
			if (
				!fs.realpathSync(base).startsWith(releases + path.sep) ||
				!file.startsWith(fs.realpathSync(base) + path.sep)
			)
				throw Error();
			bytes = fs.readFileSync(file);
			contentType = mime[path.extname(file)] || "application/octet-stream";
			immutable = true;
		} catch {
			return failure(404, "Not found");
		}
	}
	const response =
		bytes !== undefined
			? new Response(
					typeof bytes === "string" ? bytes : new Uint8Array(bytes),
					{
						headers: {
							"Content-Type": contentType || "application/octet-stream",
						},
					},
				)
			: await releaseContext.run(release, () => next());
	response.headers.set(
		"Cache-Control",
		immutable ? "public, max-age=31536000, immutable" : "no-store",
	);
	response.headers.set("X-Content-Type-Options", "nosniff");
	response.headers.set("X-Content-Revision", path.basename(release));
	return response;
});
