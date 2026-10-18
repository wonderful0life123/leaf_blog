# Public page script deduplication — 2026-10-18

## Attribution

A local runtime homepage response contained 404,865 uncompressed bytes. Three MusicPlayer instances embedded the same view logic: 72,018 bytes of inline JavaScript. MusicManager remains a separate shared manager. The earlier lazy-playlist improvement remains in the extracted view code.

The view logic now lives in `music-player-view.js`, referenced through Astro/Vite's content-hashed URL. Each widget has a small inline bootstrap carrying its own configuration and ID. Native module import shares the download and module evaluation. A WeakSet prevents duplicate mounting of the same DOM element, and disconnected widgets are not initialized after the asynchronous load. Each mounted widget still owns its event handlers, drawer state and existing cleanup logic. No dependency was added.

## Payload result

Same seven-article isolated snapshot. Values below exclude other page subresources. Gzip sizes use Node zlib defaults; they are an estimate of compression, not a measurement of production CDN transfer.

| Item | Before | After |
| --- | ---: | ---: |
| Homepage HTML | 404,865 B | 335,184 B |
| Inline player JS | 72,018 B | 2,337 B |
| New shared JS module | none | 20,467 B |
| Gzipped homepage HTML | 86,711 B | 72,723 B |
| Gzipped shared module | none | 4,909 B |

HTML alone is 17.2% smaller. Including the new module, first-page raw HTML + this module is 49,214 bytes smaller (12.2%). Gzipped HTML + this module is 9,079 bytes smaller (10.5%). After the module is cached, subsequent pages no longer transfer three copies of its implementation in HTML. Local adapter serves the hashed module with `public, max-age=31536000, immutable`; production CDN behavior was not changed or measured.

The final browser proxy log recorded exactly one GET for the shared module across three players and home/article/back navigation. Native dynamic imports also add an asynchronous request before player initialization, so this is not a claim that the very first click is faster on every network.

## Response measurement

`public-response-benchmark.mjs`: real localhost HTTP GET, same immutable snapshot, homepage / CUDA article / archive; 23 requests per route, discard first three, take the upper middle of 20 remaining samples. Raw samples are in `public-response-before.json` and `public-response-after.json`. No concurrent build or CPU profiler in these final samples. The before build uses a separate local port and a symlink to existing dependencies.

Local warm responses remain around single-digit milliseconds. This round does not establish a meaningful server-response speedup, and local timings cannot predict production CPU contention/CDN TTFB. Keep the change for less repeated script/HTML, not as a server-performance fix.

## Verification

- Runtime build passed. Studio build passed: 20 pages, 8.09 seconds; its bootstrap references an existing `/studio-static/music-player-view.*.js` asset.
- Browser with local 300-song fixture and silent 60-second audio: three players initialize; zero playlist rows while drawers are closed, 300 only in the opened widget; selecting a song, next, pause/play and shared titles work.
- Final version desktop and 390px mobile: lyrics/playlist switching, empty search and restoring playlist, home → article → back, and single-step next-track action after navigation passed.
- Final module requested once during that browser run; no browser console errors reported.
- `node --check` and `git diff --check` passed. New JS Biome check has no errors, with two warnings and sixteen style suggestions inherited from moved logic. Safe formatter/fixes were applied without changing behavior.
- No commit, push, deployment, real publishing, or production data writes. Temporary services and test tab closed; user's Studio tab preserved.

## Measurement repairs / limits

An initial attempt to copy the runtime build into /tmp could not resolve @iconify/utils. It was stopped, the existing node_modules path linked, and the final comparison rerun successfully. An initial Studio command explicitly set WONDER_RUNTIME_BUILD=0 and selected the wrong content path; rerunning the normal Studio command with that variable unset succeeded. These failed runs are not included in the measurements.

The temporary audio fixture initially omitted Content-Length, causing an infinite duration display; the fixture was corrected and final UI verification showed 1:00. One click immediately after an animated drawer expansion selected an adjacent row; a fresh DOM check and a settled click selected the requested row, and subsequent one-step next behavior passed. No production playback implementation was changed to mask these test issues.

## Remaining leads

Disabled Spine-model initialization code is still emitted in page HTML. Search initialization and other inline scripts may also warrant their own measured rounds. They were not changed here. Actual production runtime/CDN latency remains a separate measurement task.
