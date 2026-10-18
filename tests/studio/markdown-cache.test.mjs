import assert from "node:assert/strict";
import test from "node:test";
import { createMarkdownCache } from "../../src/components/studio/markdown-cache.mjs";

test("重复阅读复用结果，正文和图片解析上下文变化时返回新结果", () => {
	let renders = 0;
	const render = createMarkdownCache(
		(body, article) =>
			`${++renders}:${body}:${article.path}:${article.assets?.image || ""}`,
	);
	const assets = {};
	const article = { root: "blog", path: "a/正文.md", assets: { image: "one" } };
	const first = render("正文", article, assets);
	assert.equal(
		render("正文", { ...article, title: "改标题", revision: 2 }, assets),
		first,
	);
	assert.notEqual(render("改正文", article, assets), first);
	assert.notEqual(
		render("正文", { ...article, path: "b/正文.md" }, assets),
		first,
	);
	article.assets.image = "two";
	assert.match(render("正文", article, assets), /:two$/);
	const changed = render("正文", article, assets);
	assert.notEqual(render("正文", article, {}), changed);
});

test("缓存按最近使用及总字符数回收，超大正文不挤占常用文章", () => {
	let renders = 0;
	const render = createMarkdownCache((body) => `${++renders}:${body}`, {
		maxEntries: 2,
		maxChars: 100,
	});
	const article = {};
	const assets = {};
	const a = render("a", article, assets);
	const b = render("b", article, assets);
	assert.equal(render("a", article, assets), a);
	render("c", article, assets);
	assert.equal(render("a", article, assets), a);
	assert.notEqual(render("b", article, assets), b);
	const recent = render("a", article, assets);
	render("x".repeat(101), article, assets);
	assert.equal(render("a", article, assets), recent);
	const small = createMarkdownCache((body) => `${++renders}:${body}`, {
		maxEntries: 8,
		maxChars: 80,
	});
	const old = small("a".repeat(15), article, assets);
	small("b".repeat(15), article, assets);
	assert.notEqual(small("a".repeat(15), article, assets), old);
});
