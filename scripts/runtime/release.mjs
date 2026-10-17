import fs from "node:fs";
import {readPublicInventory,rewriteReferences} from "../studio/article-changes.mjs";
import {articleGuid,postUrl,routeFromPath} from "../../src/lib/article-paths.mjs";
import {ARCHIVE_FILE,validateArchive,withArchivePath} from "../../src/lib/public-archive.mjs";
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import matter from "gray-matter";
import { marked } from "marked";
import { parse } from "node-html-parser";
import sanitizeHtml from "sanitize-html";
import * as pagefind from "pagefind";
import { gitPublisher } from "../studio/publication-git.mjs";
import { StoreError } from "../studio/store.mjs";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const xml = (value) =>
	String(value ?? "")
		.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
		.replace(
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
const check = (result) => {
	if (result.errors?.length) throw Error(result.errors.join("; "));
	return result;
};
const inside = (file, dir) => file.startsWith(dir + path.sep);
export function validateRuntimePaths(config) {
	if (!/^[a-f\d]{40}$/.test(config.codeRevision || ""))
		throw Error("Runtime publishing requires an exact code revision");
	if (!config.releaseDir || !config.liveLink)
		throw Error(
			"Runtime publishing requires private release and current paths",
		);
	const releases = path.resolve(config.releaseDir),
		live = path.resolve(config.liveLink),
		repo = path.resolve(config.repoDir);
	for (const value of [releases, live])
		if (
			value === "/var/www" ||
			value.startsWith("/var/www/") ||
			value === repo ||
			inside(value, repo)
		)
			throw Error(
				"Runtime content must be outside public web roots and source checkouts",
			);
	if (live === releases || inside(live, releases))
		throw Error("Runtime current link must be beside the releases directory");
}
export async function buildRuntimeRelease(
	work,
	output,
	{ repoDir, codeRevision, liveLink, id, step = (_name, task) => task() },
) {
	if (
		!/^(?:[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}|code-[a-f\d]{40})$/.test(id)
	)
		throw Error("Invalid release id");
	const renderer = path.join(repoDir, ".studio-preview/renderer.mjs");
	const {
		postSchema,
		runtimeSettings: settings,
		renderPublishedBody,
	} = await import(
		/* @vite-ignore */
		pathToFileURL(renderer).href + "?version=" + hash(fs.readFileSync(renderer))
	);
	const inventory = JSON.parse(
		fs.readFileSync(
			path.join(repoDir, "runtime-dist/runtime-build.json"),
			"utf8",
		),
	);
	if (settings.generateOgImages)
		throw new StoreError(
			422,
			"快速发布暂不支持自动生成 OG 图片，请保留静态发布模式或关闭该功能后重新部署。",
		);
	const site = new URL(settings.site).origin;
	const rendererHash = hash(fs.readFileSync(renderer));
	let previous;
	try {
		previous = JSON.parse(
			fs.readFileSync(path.join(liveLink, "published.json"), "utf8"),
		);
	} catch {}
	if (
		previous?.rendererHash !== rendererHash ||
		previous?.codeRevision !== codeRevision
	)
		previous = null;
	// Candidate is task-private. Never remove an active/past immutable release.
	if (fs.existsSync(output)) fs.rmSync(output, { recursive: true });
	fs.mkdirSync(output, { recursive: true, mode: 0o700 });
	const archiveFile=path.join(work,ARCHIVE_FILE);
	const archive=validateArchive(fs.existsSync(archiveFile)?JSON.parse(fs.readFileSync(archiveFile,"utf8")):{format:1,paths:{}});
	const inventoryPosts=readPublicInventory(work);
	const routes=inventoryPosts.routes;
	const posts = fs.realpathSync(path.join(work, "src/content/posts"));
	const entries = await step("snapshot", async () => {
		const entries = [];
		for (const file of fs.readdirSync(posts, { recursive: true }).sort()) {
			if (!/\.mdx?$/.test(file)) continue;
			const source = fs.realpathSync(path.join(posts, file));
			if (!inside(source, posts)) throw Error("Content outside posts");
			const raw = fs.readFileSync(source, "utf8"),
				{ data: front, content } = matter(raw);
			if (front.draft === true) continue;
			if (file.endsWith(".mdx") || front.password)
				throw new StoreError(
					422,
					"快速发布暂不支持已发布的 MDX 或加密文章，请保留静态发布模式。",
				);
			const identity=inventoryPosts.posts.find(p=>p.path===file);
			const route=identity.route;
			const data = postSchema.parse(front),
				assets = {},
				images = new Map();
			function media(href) {
				if (
					href === "api" ||
					/^https?:\/\//i.test(href) ||
					(href.startsWith("/") && !href.startsWith("//"))
				)
					return href;
				if (/^[a-z]+:|^\/\//i.test(href))
					throw Error("Unsupported image scheme");
				const image = fs.realpathSync(
					path.resolve(path.dirname(source), decodeURIComponent(href)),
				);
				if (!inside(image, posts))
					throw Error("Image outside published content");
				const ext = path.extname(image).toLowerCase();
				if (![".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif"].includes(ext))
					throw Error("Unsupported image type");
				const bytes = fs.readFileSync(image),
					name = hash(bytes) + ext;
				images.set(name, bytes);
				assets[href] = "/published-media/" + id + "/" + name;
				return assets[href];
			}
			const tokens = marked.lexer(content);
			marked.walkTokens(tokens, (token) => {
				if (token.type === "image") media(token.href);
			});
			if (data.image) media(data.image);
			const linkBody=rewriteReferences(content,(href,kind)=>{
        if(kind==='image'||/^(?:[a-z][\w+.-]*:|[\/#])/i.test(href))return href;
        const match=href.match(/^([^?#]+)(.*)$/);if(!match)return href;
        const dest=path.posix.normalize(path.posix.join(path.posix.dirname(file),decodeURIComponent(match[1])));
        const target=inventoryPosts.posts.find(p=>p.path===dest);return target?postUrl(target.route)+match[2]:href;
      });
      const sourceHash = hash(file+linkBody+raw + JSON.stringify([...images.keys()].sort()));
			const cached = previous?.entries.find(
				(entry) =>
					entry.id === route && entry.sourceHash === sourceHash,
			);
			if (cached) {
				entries.push(cached);
				continue;
			}
			for (const [name, bytes] of images) {
				fs.mkdirSync(path.join(output, "media"), { recursive: true });
				fs.writeFileSync(path.join(output, "media", name), bytes);
			}
			if (data.image && assets[data.image]) data.image = assets[data.image];
			const rendered = await renderPublishedBody(linkBody, data, assets);
			entries.push({
				id: route,
        articleId:identity.articleId,
        sourcePath:file,
				sourceHash,
				data: {
					...data,
          sourcePath:file,
					runtimeBody: content,
					runtimeRender: {
						headings: rendered.headings,
						remarkPluginFrontmatter: rendered.remarkPluginFrontmatter,
					},
				},
				rendered: { html: rendered.html },
			});
		}
		for(let i=0;i<entries.length;i++)entries[i]=withArchivePath(entries[i],archive);
		entries.sort(
			(a, b) =>
				Date.parse(b.data.published) - Date.parse(a.data.published) ||
				a.id.localeCompare(b.id),
		);
		fs.writeFileSync(
			path.join(output, "published.json"),
			JSON.stringify({ format: 1, codeRevision, rendererHash, routes, entries }),
		);
		return entries;
	});
	await step("feeds", async () => {
		const items = entries
			.map((entry) => {
				// Full content, same sanitization policy as the static feed; absolute image/link URLs.
				const doc = parse(entry.rendered.html);
				for (const node of doc.querySelectorAll("[src],[href]"))
					for (const key of ["src", "href"]) {
						const v = node.getAttribute(key);
						if (v && !/^[a-z]+:/i.test(v))
							node.setAttribute(
								key,
								new URL(v, site + postUrl(entry.id)).href,
							);
					}
				const body = sanitizeHtml(doc.toString(), {
					allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img"]),
				});
				const url = site + postUrl(entry.id);
        const routeEntry=routes.articles.find(a=>a.id===entry.articleId);
        const guid=articleGuid(routeEntry,site,entry.id);
				return `<item><title>${xml(entry.data.title)}</title><link>${xml(url)}</link><guid isPermaLink="${routeEntry?.guid?"false":"true"}">${xml(guid)}</guid><pubDate>${xml(new Date(entry.data.published).toUTCString())}</pubDate><description>${xml(entry.data.description)}</description><content:encoded>${xml(body)}</content:encoded></item>`;
			})
			.join("");
		fs.writeFileSync(
			path.join(output, "rss.xml"),
			`<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>${xml(settings.title)}</title><link>${xml(site)}</link><description>${xml(settings.description)}</description>${items}</channel></rss>`,
		);
		const urls = new Set([
			"/",
			...inventory.staticUrls,
			...entries.map((e) => postUrl(e.id)),
		]);
		for (let n = 2; n <= Math.ceil(entries.length / settings.postsPerPage); n++)
			urls.add("/" + n + "/");
		fs.writeFileSync(
			path.join(output, "sitemap-0.xml"),
			`<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${[
				...urls,
			]
				.sort()
				.map((url) => `<url><loc>${xml(site + url)}</loc></url>`)
				.join("")}</urlset>`,
		);
		fs.writeFileSync(
			path.join(output, "sitemap-index.xml"),
			`<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>${xml(site + "/sitemap-0.xml")}</loc></sitemap></sitemapindex>`,
		);
	});
	await step("search", async () => {
		const { index } = check(
			await pagefind.createIndex({
				forceLanguage: settings.lang.replace("_", "-").split("-")[0],
			}),
		);
		try {
			for (const entry of entries)
				check(
					await index.addHTMLFile({
						url: postUrl(entry.id),
						content: `<html lang="${xml(settings.lang.replace("_", "-"))}"><head><title>${xml(entry.data.title)}</title></head><body><article data-pagefind-body><h1 data-pagefind-meta="title">${xml(entry.data.title)}</h1>${entry.rendered.html}</article></body></html>`,
					}),
				);
			check(
				await index.writeFiles({ outputPath: path.join(output, "pagefind") }),
			);
		} finally {
			await index.deleteIndex();
		}
	});
	fs.writeFileSync(
		path.join(output, "manifest.json"),
		JSON.stringify({
			format: 1,
			id,
			codeRevision,
			search: "/runtime-search/" + id + "/pagefind.js",
			articleCount: entries.length,
			mediaReleases: [
				...new Set(
					entries.flatMap((e) =>
						[
							...(e.rendered.html + " " + (e.data.image || "")).matchAll(
								/\/published-media\/([^/]+)\//g,
							),
						].map((m) => m[1]),
					),
				),
			],
		}),
	);
	return output;
}
export function runtimePublisher(config) {
	validateRuntimePaths(config);
	const git = gitPublisher(config);
	return {
		...git,
		async build(work, _url, step) {
			try {
				return await buildRuntimeRelease(work, path.join(work, "dist"), {
					...config,
					id: path.basename(path.dirname(work)),
					step,
				});
			} catch (e) {
				if (e instanceof StoreError) throw e;
				fs.appendFileSync(
					path.join(path.dirname(work), "build.log"),
					String(e.stack) + "\n",
					{ mode: 0o600 },
				);
				throw new StoreError(
					503,
					"内容发布准备失败，原网站保持不变，请检查发布日志。",
				);
			}
		},
	};
}
export const closeRuntimeIndexer = () => pagefind.close();
