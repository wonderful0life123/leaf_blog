import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import {
	buildRuntimeRelease,
	closeRuntimeIndexer,
	validateRuntimePaths,
} from "../../scripts/runtime/release.mjs";
import { publicationConfig } from "../../scripts/studio/publications.mjs";
const repoDir = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../..",
);
const revision = "1".repeat(40),
	one = "11111111-1111-4111-8111-111111111111",
	two = "22222222-2222-4222-8222-222222222222";
function fixture(t) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "wonder-runtime-unit-")),
		posts = path.join(root, "source/src/content/posts");
	fs.mkdirSync(posts, { recursive: true });
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	const code = path.join(root, "code");
	fs.mkdirSync(path.join(code, "runtime-dist"), { recursive: true });
	fs.symlinkSync(
		path.join(repoDir, ".studio-preview"),
		path.join(code, ".studio-preview"),
	);
	fs.writeFileSync(
		path.join(code, "runtime-dist/runtime-build.json"),
		JSON.stringify({ format: 1, staticUrls: ["/archive/"] }),
	);
	return {
		root,
		posts,
		work: path.join(root, "source"),
		config: {
			repoDir: code,
			codeRevision: revision,
			liveLink: path.join(root, "current"),
		},
	};
}
const front =
	'---\ntitle: "Title & <tag>"\npublished: 2026-10-14\ndescription: "summary & <data>"\n---\n';
test("runtime is explicit, paths cannot use public roots; existing mode defaults to static", () => {
	assert.equal(
		publicationConfig({ WONDER_PUBLISH_REPO_DIR: "/tmp/repo" }).mode,
		"static",
	);
	assert.throws(
		() =>
			publicationConfig({
				WONDER_PUBLISH_REPO_DIR: "/tmp/repo",
				WONDER_PUBLISH_MODE: "typo",
			}),
		/mode/,
	);
	assert.throws(
		() =>
			validateRuntimePaths({
				repoDir: "/tmp/code",
				codeRevision: revision,
				releaseDir: "/var/www/runtime",
				liveLink: "/tmp/current",
			}),
		/outside/,
	);
});
test("full RSS, compiled sitemap inventory, schema validation, private drafts and immutable cached image reuse", async (t) => {
	const { root, posts, work, config } = fixture(t),
		output = path.join(root, "releases", one);
	fs.writeFileSync(path.join(posts, "pixel.png"), Buffer.from("test bytes"));
	const img = "![image](pixel.png)";
	fs.writeFileSync(
		path.join(posts, "post.md"),
		front + "Full body verification\n\n```md\n" + img + "\n```\n\n" + img,
	);
	fs.writeFileSync(
		path.join(posts, "draft.mdx"),
		"---\ndraft: true\n---\nPRIVATE_DRAFT",
	);
	try {
		await buildRuntimeRelease(work, output, { ...config, id: one });
		const first = JSON.parse(
			fs.readFileSync(path.join(output, "published.json")),
		);
		assert.equal(first.entries.length, 1);
		assert.ok(
			first.entries[0].rendered.html.includes("/published-media/" + one + "/"),
		);
		assert.ok(
			first.entries[0].rendered.html.includes("Full body verification"),
		);
		const rss = fs.readFileSync(path.join(output, "rss.xml"), "utf8");
		assert.ok(rss.includes("<content:encoded>"));
		assert.ok(rss.includes("Full body verification"));
		assert.ok(rss.includes("https://wonder-ai.info/published-media/"));
		assert.ok(rss.includes("Title &amp; &lt;tag&gt;"));
		assert.ok(!rss.includes("PRIVATE_DRAFT"));
		const sitemap = fs.readFileSync(path.join(output, "sitemap-0.xml"), "utf8");
		assert.ok(sitemap.includes("/archive/"));
		assert.ok(!sitemap.includes("/studio/"));
		fs.symlinkSync(output, config.liveLink);
		await buildRuntimeRelease(work, path.join(root, "candidate"), {
			...config,
			id: two,
		});
		const second = JSON.parse(
			fs.readFileSync(path.join(root, "candidate/published.json")),
		);
		assert.deepEqual(
			second.entries,
			first.entries,
			"unchanged body and images reuse exact rendered content",
		);
		fs.writeFileSync(
			path.join(posts, "bad.md"),
			"---\ntitle: bad\npublished: invalid\n---\nbody",
		);
		await assert.rejects(() =>
			buildRuntimeRelease(work, path.join(root, "bad"), { ...config, id: two }),
		);
		assert.equal(fs.realpathSync(config.liveLink), fs.realpathSync(output));
	} finally {
		await closeRuntimeIndexer();
	}
});
test("runtime refuses unsafe image paths and unsupported published formats before activation", async (t) => {
	const { root, posts, work, config } = fixture(t);
	fs.writeFileSync(path.join(root, "secret.png"), "secret");
	fs.symlinkSync(path.join(root, "secret.png"), path.join(posts, "leak.png"));
	fs.writeFileSync(path.join(posts, "post.md"), front + "![bad](leak.png)");
	await assert.rejects(
		() =>
			buildRuntimeRelease(work, path.join(root, "output"), {
				...config,
				id: one,
			}),
		/outside/,
	);
	fs.unlinkSync(path.join(posts, "post.md"));
	fs.writeFileSync(path.join(posts, "post.mdx"), front + "# MDX");
	await assert.rejects(
		() =>
			buildRuntimeRelease(work, path.join(root, "output"), {
				...config,
				id: one,
			}),
		/MDX/,
	);
});
