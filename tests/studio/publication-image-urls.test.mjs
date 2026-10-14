import test from "node:test";
import assert from "node:assert/strict";
import { parse } from "node-html-parser";
import {
	renderPublishedBody,
	renderArticle,
} from "../../.studio-preview/renderer.mjs";
const data = { title: "图片路径", published: new Date("2026-10-15") };
test("真实 Markdown 渲染后的中文、编码、空格及百分号图片地址映射到已验证资源", async () => {
	const sources = [
		"assets/全局位置计算/图.webp",
		"assets/%E5%85%A8%E5%B1%80/%E5%9B%BE.webp",
		"assets/中文/space%20image.webp",
		"assets/中文/space image.webp",
		"assets/图😀/%25-image.webp",
		"assets/中文/[图].webp",
	];
	for (const [i, source] of sources.entries()) {
		const target = "/published-media/test/image-" + i + ".webp",
			body =
				"![test](<" +
				source +
				">)\n\n```md\n![sample](<" +
				source +
				">)\n```\n\n![remote](https://example.com/图.webp)";
		const result = await renderPublishedBody(body, data, { [source]: target }),
			doc = parse(result.html);
		assert.equal(
			doc.querySelector('img[alt="test"]').getAttribute("src"),
			target,
			source,
		);
		assert.ok(
			doc
				.querySelector('img[alt="remote"]')
				.getAttribute("src")
				.startsWith("https://example.com/"),
		);
		assert.ok(
			!doc.querySelector("pre").textContent.includes(target),
			"code examples must not be rewritten",
		);
		const privateTarget = "/preview-assets/image-" + i + ".webp";
		const preview = await renderArticle(
			"---\ntitle: test\npublished: 2026-10-15\n---\n![test](<" + source + ">)",
			{ [source]: privateTarget },
		);
		assert.equal(
			parse(preview).querySelector("img").getAttribute("src"),
			privateTarget,
		);
	}
});
