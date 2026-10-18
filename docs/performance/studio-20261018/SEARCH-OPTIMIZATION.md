# Search loading and result hydration — 2026-10-18

## Evidence and change

Navbar eagerly performed HEAD then import of /pagefind/pagefind.js on every page. search.astro contained a second initializer, with a different event target from the Svelte listeners. Dropdown search fetched every result's data even though only five results were shown.

Both search UIs now use one lazy client. Initialization starts with a nonempty query, is shared across concurrent callers, and configures excerpts once. Initialization failures propagate and release the pending promise instead of permanently installing an empty-results stub. Browser-native caching still applies to module imports; no cache-busting retries are introduced. Runtime search continues to read the current manifest for each query so publishing can change the search index.

The dropdown reads at most five result details while retaining the full result count for “查看更多”. The full search page reads all results. Input changes invalidate pending display updates, clear the debounce timer, and discard older responses. Component teardown also invalidates pending work. Clearing desktop input closes the panel; clearing mobile input keeps its input available. No new dependency or publishing/backend change.

## Local measurements

Same seven-article runtime snapshot, actual production-built UI through a localhost logging proxy. Separate origins (4344 before, 4346 after) avoid sharing browser cache. Same query: 的. Requests below include completed search-engine/manifest/index/detail responses, not general UI assets. Body bytes are server response bodies, not compressed CDN wire bytes.

| Workload | Before | After |
| --- | ---: | ---: |
| Idle homepage search endpoint requests | 2 (HEAD + GET) | 0 |
| Idle homepage search endpoint response body | 638 B | 0 |
| Homepage + first query search requests | 16 | 13 |
| Query detail fragment requests | 7 | 5 |
| Query detail fragment body bytes | 24,506 B | 23,662 B |
| Homepage + first query search response body bytes | 206,648 B | 205,804 B |

The new shared client itself is a 423 B production JS chunk loaded with the UI. Thus removing two search endpoint requests does not mean two fewer total page requests: one shared client request is added. The runtime search entry was already a small proxy; its index/worker/WASM were already deferred until querying. This round does not claim a large first-load bandwidth or LCP improvement. The first query now pays the deferred entry import latency, while irrelevant detail requests are avoided.

With 100 matching synthetic result handles, the deterministic test observes 5 detail reads for dropdown use, 100 for full-page use, with the correct total of 100. This is an operation-count check, not a server benchmark. Production improvements depend on actual article count and network conditions.

Raw counters: search-results.json. Logs and controlled proxy: /tmp/wonder-search-20261018/. The before/after cold comparison preceded fault injection. The later final change only preserves the mobile input on clear and adjusts formatting/Infinity spelling; it does not change the measured request policy.

## Verification

- Two focused Node tests pass: lazy initialization, concurrent deduplication, five-detail limit/accurate count, all-results mode, failure propagation and subsequent query recovery.
- Final runtime build: 6.35s. Final Studio build: 20 pages, 7.76s. New JS/test Biome checks and git diff --check pass.
- Desktop browser: same five results and “2 more”; full search page displays all seven; direct reload with q retains results. Mobile: CUDA query returns three articles and clicking opens the selected article.
- Controlled 2.5s response delay: an overlapping newer query completes first and remains visible after the old one finishes. Server log confirms starts at 1792301028845 and 1792301029456, newer response at 1792301029462 and old response at 1792301031354 (milliseconds).
- Clearing during a delayed query leaves no stale result links. A simulated manifest 503 closes the dropdown as before; the next query succeeds. Its expected console error is not counted as an unexpected product error.
- Final mobile clear/retype behavior checked separately. One click immediately after resizing had a transient locator failure; rereading the settled DOM and clicking the visible search button succeeded.
- Full tsc --noEmit --isolatedDeclarations remains failing: 49 diagnostics in existing configuration/runtime/utility TS files, none in this round's modified search files. Not counted as passed; this command is not a substitute for Svelte browser verification.

No commit, push, deployment, production data writes, or changes to the user's open Studio tab. Previous local optimization changes are retained. Next useful work is reviewing the accumulated changes together and measuring remaining page scripts/production response latency, rather than claiming the entire site's performance problem solved.
