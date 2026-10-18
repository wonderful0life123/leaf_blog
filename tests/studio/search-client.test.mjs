import assert from "node:assert/strict";
import test from "node:test";
import { createSearchClient } from "../../src/utils/search-client.mjs";

test("search is lazy, shares initialization, and reads only visible details with an accurate total", async () => {
	let loads = 0;
	let options = 0;
	let reads = [];
	const search = createSearchClient(async () => {
		loads++;
		return {
			options: async (value) => {
				options++;
				assert.equal(value.excerptLength, 20);
			},
			search: async () => ({
				results: Array.from({ length: 100 }, (_, i) => ({
					data: async () => {
						reads.push(i);
						return { id: i };
					},
				})),
			}),
		};
	});
	assert.deepEqual(await search("   ", 5), { results: [], total: 0 });
	assert.equal(loads, 0);
	const [a, b] = await Promise.all([search("CUDA", 5), search("GPU", 5)]);
	assert.equal(loads, 1);
	assert.equal(options, 1);
	assert.equal(a.total, 100);
	assert.equal(b.total, 100);
	assert.equal(reads.length, 10);
	assert.ok(reads.every((i) => i < 5));
	reads = [];
	assert.equal((await search("all")).results.length, 100);
	assert.equal(reads.length, 100);
	assert.equal(loads, 1);
});

test("initialization and query failures propagate without permanently replacing search with empty results", async () => {
	let loads = 0;
	let failQuery = true;
	const search = createSearchClient(async () => {
		if (++loads === 1) throw Error("offline");
		return {
			options: async () => {},
			search: async () => {
				if (failQuery) throw Error("network");
				return { results: [] };
			},
		};
	});
	await assert.rejects(search("a", 5), /offline/);
	await assert.rejects(search("a", 5), /network/);
	failQuery = false;
	assert.deepEqual(await search("a", 5), { results: [], total: 0 });
	assert.equal(loads, 2);
});
