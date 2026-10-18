import assert from "node:assert/strict";
import test from "node:test";
import { Marked } from "marked";
import {
	createGithubLoader,
	githubCardHtml,
	githubDirective,
	githubExtension,
} from "../../src/components/studio/github-card.mjs";
import { GithubCardComponent } from "../../src/plugins/rehype-component-github-card.mjs";

test("阅读预览识别 GitHub 指令但不改写代码、转义和不合法仓库", () => {
	const markdown = new Marked({ extensions: [githubExtension] });
	const source =
		"::github{repo=\"CuteLeaf/Firefly\"}\n\n::github{repo='saicaca/fuwari'}";
	const html = markdown.parse(source);
	assert.equal((html.match(/class="card-github no-styling"/g) || []).length, 2);
	assert.ok(html.includes("https://github.com/CuteLeaf/Firefly"));
	for (const doc of [
		`\`\`\`md\n${source}\n\`\`\``,
		'`::github{repo="CuteLeaf/Firefly"}`',
		'\\::github{repo="CuteLeaf/Firefly"}',
		'::github{repo="../../secrets"}',
		'::github{repo="owner/repo" onclick="alert(1)"}',
	])
		assert.ok(!markdown.parse(doc).includes('class="card-github no-styling"'));
	assert.equal(githubDirective('::github{repo="owner/repo"}'), "owner/repo");
	assert.equal(githubCardHtml("owner/<script>"), "");
	assert.equal(githubCardHtml("owner/.."), "");
});
test("GitHub 信息请求合并并缓存，失败保留卡片且短暂缓存，不携带凭据", async () => {
	let calls = 0;
	let time = 0;
	const load = createGithubLoader(
		async (url, options) => {
			calls++;
			assert.equal(url, "https://api.github.com/repos/CuteLeaf/Firefly");
			assert.equal(options.credentials, "omit");
			assert.equal(options.referrerPolicy, "no-referrer");
			return {
				ok: true,
				json: async () => ({
					description: "博客主题",
					stargazers_count: 123,
					forks_count: 4,
					language: "Astro",
				}),
			};
		},
		() => time,
	);
	const [a, b] = await Promise.all([
		load("CuteLeaf/Firefly"),
		load("CuteLeaf/Firefly"),
	]);
	assert.deepEqual(a, b);
	assert.equal(calls, 1);
	assert.equal(a.stars, 123);
	await load("CuteLeaf/Firefly");
	assert.equal(calls, 1);
	time = 300001;
	await load("CuteLeaf/Firefly");
	assert.equal(calls, 2);
	let failures = 0;
	const failed = createGithubLoader(
		async () => {
			failures++;
			throw Error("offline");
		},
		() => time,
	);
	assert.equal(await failed("owner/repo"), null);
	assert.equal(await failed("owner/repo"), null);
	assert.equal(failures, 1);
	time += 30001;
	await failed("owner/repo");
	assert.equal(failures, 2);
	await failed("../../bad");
	assert.equal(failures, 2);
});

test("博客和写作空间共用仓库卡片结构，私密预览不依赖执行脚本", () => {
	const card = GithubCardComponent({ repo: "CuteLeaf/Firefly" }, []);
	assert.equal(card.properties.href, "https://github.com/CuteLeaf/Firefly");
	assert.ok(!card.properties.className.includes("fetch-waiting"));
	const text = (node) =>
		node.type === "text"
			? node.value
			: (node.children || [])
					.filter((n) => n.tagName !== "script")
					.map(text)
					.join("");
	assert.ok(text(card).includes("查看 GitHub 仓库"));
	assert.ok(githubCardHtml("CuteLeaf/Firefly").includes("gc-titlebar"));
	const invalid = GithubCardComponent({ repo: "owner/repo');alert(1)//" }, []);
	assert.notEqual(invalid.tagName, "a");
});
