# Disabled feature scripts — 2026-10-18

## Change and attribution

The current site disables Spine and Live2D and supplies one banner image per breakpoint. MainGridLayout nevertheless emitted Spine's inline setup (including event listeners), its shared message module, random banner selection and carousel setup. The banner scripts returned early only after being delivered and parsed.

MainGridLayout now renders Spine only when configured on, consistent with the existing Live2D guard. Random selection is emitted only when either breakpoint has multiple images. Carousel script and Ken Burns style are emitted only when multiple images exist and carousel is enabled or user-switchable. A disabled-by-default but switchable carousel remains supported. Wallpaper mode switching and all existing feature implementations are unchanged.

## Same-snapshot local runtime comparison

Seven public articles in an isolated immutable runtime snapshot; same routes before and after. No production data or network configuration changed. Bytes are UTF-8 HTML. Gzip is Node zlib's default compression of those responses, not measured CDN transfer. Random widget IDs can slightly vary gzip sizes.

| Route | HTML before | HTML after | Gzip before | Gzip after |
| --- | ---: | ---: | ---: | ---: |
| Home | 335,184 | 309,674 | 72,728 | 65,966 |
| CUDA global indexing | 451,572 | 426,062 | 94,229 | 87,462 |
| Archive | 304,979 | 279,469 | 69,756 | 63,008 |

Each response loses 25,510 bytes of HTML, including 24,934 bytes of inline JavaScript (Spine 15,209; randomizer 2,343; carousel 7,382). Homepage HTML is 7.61% smaller and estimated gzip HTML is 9.30% smaller. The message module script reference also disappears from actual runtime responses. Its resource bytes are not included in the table. It may still exist in build output; this result concerns what these pages request.

These numbers are a payload improvement, not a measured LCP, input-latency or server-throughput improvement. Earlier rounds' savings should not be summed as percentages.

## Verification

- Current-config runtime build passed (5.86s); three routes return 200 and exclude all three disabled scripts.
- Studio build passed (20 pages, 7.89s); Studio HTML excludes the same scripts.
- An independent source copy under /tmp enabled Spine and configured two public-path images per breakpoint with carousel enabled. Runtime build passed (5.86s). Actual HTTP HTML includes the model container, shared message module, randomizer, carousel and both image templates. The real config was never changed. This verifies inclusion, not full external Spine runtime/model execution.
- Actual browser against current-config production runtime: 1440px desktop wallpaper overlay/none/banner switching, home → CUDA article → back; 390px mobile image loaded, menu → archive → back. No console errors in the run. Local music fixture avoided unrelated external music API traffic.
- git diff --check passed. Only MainGridLayout changed this round; earlier uncommitted work is retained. No commit, push, deployment, real publishing, or user draft writes.
- Raw sizes: disabled-scripts-results.json. Before/after HTML and fixture build logs: /tmp/wonder-disabled-scripts-20261018/. The initially guessed article path returned 404 and was replaced with the actual link from the homepage before comparison; the failed response was excluded.

## Next measurement

Inspect search loading and remaining initial-page JavaScript. Production CDN/origin response latency needs separate measurement; local payload tests cannot settle it. Build/deployment cost remains a separate workstream from interactive latency.
