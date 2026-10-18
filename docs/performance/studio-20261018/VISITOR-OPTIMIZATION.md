# Visitor reading: responsive banner requests — 2026-10-18

## Finding and change

`MainGridLayout.astro` rendered desktop and mobile wallpaper images together with eager/high-priority loading. CSS hid one wrapper but both selected images downloaded. The local production browser reproduced this at desktop and mobile widths.

`ImageWrapper.astro` now accepts an optional media condition. For banner images, optimized picture sources carry the same 64rem breakpoint as the layout; the inactive fallback is an inline transparent pixel. The browser selects the active image, including after resizing, without a JavaScript loader. Existing callers without media keep their original image path. Both initial frames and carousel templates carry the condition; carousel/randomization code is unchanged.

## Measured result

Local static production artifact; 1440×900 desktop and 390×844 mobile, no-store local HTTP server. Values are file bytes for the browser-selected wallpaper resources, not total page transfer or latency.

| Viewport | Before | After | Saved |
| --- | ---: | ---: | ---: |
| Desktop | 468,478 B / 2 requests | 369,070 B / 1 request | 99,408 B / 21.2% |
| Mobile | 227,282 B / 2 requests | 40,360 B / 1 request | 186,922 B / 82.2% |

The visible before/after image SHA-256 is identical for each viewport. Quality, cropping and source image were not reduced. Native source selection and sizes are retained. Details: `visitor-banner-results.json`. This is not an LCP or network speed claim; actual CDN latency is unmeasured in this round.

## Verification

- Static production build: 19 pages, 6.78 seconds. Final runtime build also passed; runtime uses the same layout and ImageWrapper.
- Real browser: desktop/mobile cold navigation; inactive source resolves to inline data rather than a network image; visible image completes with nonzero natural width.
- Runtime service bound only to localhost with a separate temporary content snapshot; no Studio production data, GitHub push or real publishing.
- Desktop/mobile runtime images load; 1023/1024px breakpoint transitions select the correct side; desktop image completes after resize.
- Fullscreen wallpaper, solid background and banner controls work; home → CUDA article → back → forward navigation works.
- Screenshot evidence: `visitor-desktop.jpg`, `visitor-mobile.jpg`.
- ImageWrapper Biome check and git diff whitespace check passed. MainGridLayout has one pre-existing formatter discrepancy outside edited lines, left intact. Existing unrelated Svelte build warnings remain.
- Multiple-image carousel is not enabled by this site's current configuration, so no claim of live carousel acceptance. Its templates receive the same source condition; script logic is unchanged.

## Scope and remaining work

No commit, push or deployment. Existing four Studio performance rounds remain in the working tree. This round removes redundant banner requests; it does not fix every public-page bottleneck. Next measurements should separately attribute public-page scripts, runtime image transformation cold cost, and server/CDN TTFB before changing those paths. Search, font loading and page transitions remain inventory leads rather than established bottlenecks.
