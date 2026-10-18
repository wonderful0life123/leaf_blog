import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
	contentComparison,
	createContentParser,
} from "../../scripts/studio/article-status.mjs";
import { openPublications } from "../../scripts/studio/publications.mjs";
import { openStore } from "../../scripts/studio/store.mjs";

test("syntax reuse stays bounded by entries and characters; oversized bodies are not retained", () => {
	const parse = createContentParser({ maxEntries: 2, maxChars: 1000 });
	const a = parse("a");
	const b = parse("b");
	assert.equal(parse("a"), a);
	assert.equal(a.children[0].position, undefined);
	parse("c");
	assert.notEqual(parse("b"), b, "least recently used syntax is evicted");
	const current = parse("b");
	assert.notEqual(parse("x".repeat(1000)), parse("x".repeat(1000)));
	assert.equal(
		parse("b"),
		current,
		"oversized bodies do not evict useful entries",
	);
	const size = "a".length + JSON.stringify(a).length;
	const limited = createContentParser({ maxChars: size + 1 });
	const first = limited("a");
	limited("b");
	assert.notEqual(
		limited("a"),
		first,
		"character budget also limits the cache",
	);
});

test("cached syntax retains Markdown semantics and resolves reference definitions in each article context", () => {
	const parse = createContentParser();
	const hash = "a".repeat(64);
	const draft = {
		title: "文章",
		tags: "测试",
		source: { path: "旧/文章.md" },
		body: "![图][asset]\n\n[asset]: 图.png\n\n[下一篇](../旧/下篇.md)",
		assets: { "图.png": `/studio-api/media/${hash}/` },
	};
	const published = {
		title: "文章",
		tags: "测试",
		path: "新/文章.md",
		body: `![图](/studio-api/media/${hash}/)\n\n[asset]: /studio-api/media/${hash}/\n\n[下一篇](下篇.md)`,
	};
	const bindings = [
		{
			articleId: "next",
			path: "新/下篇.md",
			route: "新/下篇",
			aliases: ["旧/下篇.md"],
		},
	];
	assert.equal(
		contentComparison("/unused", bindings, parse)(draft, published),
		false,
	);
	assert.equal(
		contentComparison("/unused", [], parse)(draft, published),
		true,
		"binding changes cannot reuse resolved links",
	);
	assert.equal(
		contentComparison(
			"/unused",
			bindings,
			parse,
		)(
			{
				...draft,
				assets: { "图.png": `/studio-api/media/${"b".repeat(64)}/` },
			},
			published,
		),
		true,
	);
	assert.equal(
		contentComparison("/unused", bindings, parse)(draft, published),
		false,
	);
});

test("warm status responds to source edits, same-path image replacement and source-root switches", (t) => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "wonder-status-cache-"));
	const posts = path.join(root, "posts");
	const other = path.join(root, "other");
	const dataDir = path.join(root, "data");
	fs.mkdirSync(posts);
	fs.mkdirSync(other);
	const png = Buffer.from(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV8sAAAAASUVORK5CYII=",
		"base64",
	);
	const body = "正文\n\n![图](图.png)";
	const source = `---\ntitle: 文章\ntags: [测试]\n---\n\n${body}`;
	for (const dir of [posts, other]) {
		fs.writeFileSync(path.join(dir, "文章.md"), source);
		fs.writeFileSync(path.join(dir, "图.png"), png);
	}
	const sourceRoots = { blog: posts };
	const store = openStore({ dataDir, sourceRoots });
	t.after(() => {
		store.close();
		fs.rmSync(root, { recursive: true, force: true });
	});
	const manager = openPublications({
		dataDir,
		sourceRoots,
		store,
		config: null,
	});
	const draft = store.create({
		title: "文章",
		body,
		category: "",
		tags: "测试",
		source: { root: "blog", path: "文章.md" },
	});
	const changed = () =>
		manager.decorate([store.get(draft.id)])[0].hasUnpublishedChanges;
	assert.equal(changed(), false);
	assert.equal(changed(), false);
	fs.writeFileSync(path.join(posts, "文章.md"), `${source}\n新版`);
	assert.equal(changed(), true);
	fs.writeFileSync(path.join(posts, "文章.md"), source);
	assert.equal(changed(), false);
	const image = path.join(posts, "图.png");
	const stat = fs.statSync(image);
	const replacement = Buffer.from(png);
	replacement[replacement.length - 1] ^= 1;
	fs.writeFileSync(image, replacement);
	fs.utimesSync(image, stat.atime, stat.mtime);
	assert.equal(
		changed(),
		true,
		"same size and timestamp must not hide changed image bytes",
	);
	fs.unlinkSync(image);
	assert.equal(
		changed(),
		true,
		"a missing image cannot match the draft snapshot",
	);
	fs.writeFileSync(image, png);
	assert.equal(changed(), false);
	sourceRoots.blog = other;
	fs.writeFileSync(path.join(other, "文章.md"), `${source}\n新来源`);
	assert.equal(changed(), true);
	fs.writeFileSync(path.join(other, "文章.md"), source);
	assert.equal(changed(), false);
});
