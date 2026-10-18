# Preview startup and runtime workspace optimization — 2026-10-18

## Scope and target

Goal: ordinary article previews within **3 seconds after the preview service is ready**; include version lookup, workspace, content validation and rendering. Keep private access, draft revisions, publication concurrency checks and original output semantics. No database migration or dependency changes.

This branch changes the Studio backend and local dev startup only. It does not change the renderer, frontend, public runtime, article content or lockfile. No production data was used and no real article was published.

## Changes

1. One preview Worker per publisher is initialized at service startup. It loads the existing compiled renderer and exercises Python/shell/JavaScript highlighting plus math once. Real requests share the same in-progress startup and serialize through that worker. Idle workers are unref'd; shutdown terminates them. A failed worker is discarded and the next request may start a replacement. No timer-driven warmups or worker pool.
2. Runtime task workspaces archive only `src/content/posts`, `src/data` and `pnpm-lock.yaml` from the exact Git base. Static mode still archives the full repository. All original articles/media/route data remain available to validation. Commits still read the **complete base tree** into an isolated Git index and stage only the approved content files, preserving omitted application files.
3. Load, initialization, render, exit and timeout failures have distinct messages. Logs retain phase, a validated error code and exit code; never raw Markdown, arbitrary error messages or credentials. The 30-second render budget remains unchanged. The original 10-second cold-preview test is retained; a separate service-ready test requires 3 seconds.

## Measurements

Same Mac, Node v22.23.2, sequential runs, isolated clone of the full repository, Python code, formula, table and uploaded image. Test data is temporary. Startup/warmup is separate from first-click timing. `measurements.json` includes raw stage timings.

| Scenario | Before, median of 3 | Final, median of 3 |
| --- | ---: | ---: |
| First click | 622 ms (lazy startup) | 188 ms (service warmed) |
| Body/summary changes, slower of the two | 277 ms | 152 ms |
| Identical content reuse | 272 ms | 150 ms |

First-click reduction: 434 ms / 69.8%. This is **not a 69.8% reduction in renderer initialization time**: startup is moved earlier. Final startup warmup took 347–424 ms; a separately measured request without prewarming took 700 ms. Warm-worker-only first-click median was 335 ms; full-repo workspace before narrowing was about 170 ms, final content-only workspace about 50 ms.

These are backend task completion timings (10 ms test polling), not browser click-to-iframe-paint timings. They exclude GitHub network and CDN traffic. The server's 18-second cold-start result is not comparable to this local baseline. Server acceptance remains pending; do not claim the production 3-second goal has passed. On the server, measure warmup separately, then at least 3 ordinary articles and body changes, with GitHub fetch/polling/HTML/CSS/image delivery included in user-perceived latency. Do not run parallel builds during the measurement.

Reproduce (use an isolated service account checkout on the server):

```sh
node docs/performance/preview-20261018/benchmark.mjs --warm --runtime
node docs/performance/preview-20261018/benchmark.mjs --runtime
node --test tests/studio/preview-client.test.mjs tests/studio/publication-workspace.test.mjs tests/studio/publication-preview.test.mjs tests/studio/publications.test.mjs tests/studio/server.test.mjs
```

The benchmark clones local Git and creates disposable drafts, never uses production SQLite, never connects GitHub, and cleans its own temporary directory. It does not emulate actual remote fetch latency.

## Validation

- Studio suite: **148/148 passed**, with loopback ports allowed for server tests.
- New coverage: shared startup and concurrent request isolation; missing dependency/recovery; rendering exception; worker exit/recovery; close during startup; real service startup warms without an authenticated request; anonymous requests remain rejected and no publication task is created by warmup.
- Runtime workspace regression: Chinese paths/images/metadata preserved, unarchived source/public files remain byte-identical in Git commit, static path unaffected, changed lockfile rejected.
- Real isolated runtime smoke: passed all 13 checks, local bare Git only, real HTTP preview/confirm and runtime renderer. Covers content updates, Chinese directory moves, old URLs, images, private draft isolation, rejected push, activation failure/retry, and concurrent remote changes. Existing compiled renderer hash unchanged. No full frontend/runtime build was required.
- No frontend UI change; authenticated production browser/CDN acceptance is not performed here.

## Incremental deployment handoff

Read the current actual service configuration and back it up. Preserve the user's current publishing flag; do not enable publishing as part of this change. Wait for active tasks to finish before a Studio restart.

Update these backend files **together** from the optimization commit in the actual installed Studio service source:

- `scripts/studio/preview-client.mjs` (new)
- `scripts/studio/preview-worker.mjs`
- `scripts/studio/publication-preview.mjs`
- `scripts/studio/publication-git.mjs`
- `scripts/studio/publications.mjs`
- `scripts/studio/server.mjs`

`plugin.mjs` is local development integration, not the production service entrypoint. Deploy tests/benchmark separately to the isolated acceptance checkout.

Keep the existing verified `.studio-preview` **entity directory** and matching dependencies in the clean publisher workspace. There is no renderer change and no need to install dependencies or rebuild Studio/static/runtime bundles for these backend-only files. Do not reintroduce the historical-directory symlink that broke ESM package resolution.

**Version boundaries:** record the new Studio backend source SHA separately. This backend-only update does not change the public rendering code. Preserve the currently aligned public-runtime/snapshot/`WONDER_PUBLISH_CODE_REVISION` baseline and current content branch. Do not automatically merge the optimization branch into the content branch: `gitPublisher.head()` intentionally rejects content-branch code changes after the deployed rendering baseline. A future whole-code release needs its normal baseline alignment; do not relabel existing artifacts as a new rendering build.

Restart Studio once. Expect `[studio-preview] Ready` with `loadMs` and `warmupMs`; this marker, not merely HTTP listening, establishes rendering readiness. Missing components should produce a distinct load/init error in the service log. The login shell may be available while startup is in progress; an early preview waits for the shared initialization and may still be slow. Warmup now holds the same single-worker memory that was previously allocated on first preview, earlier in service lifetime; record memory under normal server load.

Then measure an isolated first/body/summary/reuse preview through the installed backend and actual repo path, including warmup duration separately. Record source/workspace/content/render, RSS, available memory and CPU steal. If GitHub source lookup alone exceeds the budget, report it separately; no stale source cache or weakened confirm/push check was added here.

Before restoring any user-requested publishing flag, complete the normal authenticated-then-anonymous same-path checks for the actual private HTML/CSS/image/task URLs. Do not create test articles in production. Rollback restores the six backend files as a set and restarts Studio; no database restore or article rollback is involved.

## Remaining work

Module bundling could reduce cold startup itself; it was not changed in this round. Remote source lookup remains uncached and can exceed 3 seconds on a slow GitHub connection. Optimize those only from fresh measurements if the service-ready production goal is still missed. Heavy documents and new code languages may require more rendering work than this ordinary-article fixture.
