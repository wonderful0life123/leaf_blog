import assert from "node:assert/strict";
import test from "node:test";
import { createPreviewQueue } from "../../src/components/studio/preview-queue.mjs";

test("continuous typing renders the latest text at bounded intervals, then the final edit", (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const rendered = [];
	const committed = [];
	const queue = createPreviewQueue((html) => committed.push(html));
	const edit = (text) =>
		queue.update(() => {
			rendered.push(text);
			return `<p>${text}</p>`;
		});
	edit("a");
	t.mock.timers.tick(60);
	edit("ab");
	t.mock.timers.tick(59);
	assert.deepEqual(rendered, []);
	t.mock.timers.tick(1);
	assert.deepEqual(rendered, ["ab"]);
	edit("abc");
	t.mock.timers.tick(60);
	edit("abcd");
	t.mock.timers.tick(60);
	edit("abcde");
	t.mock.timers.tick(120);
	assert.deepEqual(committed, ["<p>ab</p>", "<p>abcd</p>", "<p>abcde</p>"]);
});

test("opening preview flushes the newest content; hiding or destroying cancels obsolete work", (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const committed = [];
	const queue = createPreviewQueue((html) => committed.push(html));
	queue.update(() => {
		throw new Error("obsolete render");
	});
	queue.update(() => "latest", true);
	assert.deepEqual(committed, ["latest"]);
	t.mock.timers.tick(120);
	assert.deepEqual(committed, ["latest"]);
	queue.update(() => {
		throw new Error("render after close");
	});
	queue.cancel();
	t.mock.timers.tick(120);
	queue.update(() => "another article", true);
	assert.deepEqual(committed, ["latest", "another article"]);
});
