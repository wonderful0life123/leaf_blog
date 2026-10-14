import nodeAdapter from "@astrojs/node";
import { runtimeIntegration } from "./scripts/runtime/integration.mjs";
import { expressiveOptions, markdownOptions } from "./src/markdown.config";
import { studioLocalPlugin } from './scripts/studio/plugin.mjs';
import sitemap from "@astrojs/sitemap";
import svelte from "@astrojs/svelte";
import tailwindcss from "@tailwindcss/vite";
import { setMaxListeners } from "node:events";
import swup from "@swup/astro";
import { defineConfig } from "astro/config";
import expressiveCode from "astro-expressive-code";
import icon from "astro-icon";
import { siteConfig, galleryConfig } from "./src/config";
import mdx from "@astrojs/mdx";
import { fileURLToPath } from "node:url";
import { iconIncludes } from "./scripts/icon-include.mjs";

if (process.env.NODE_ENV === "development") {
	setMaxListeners(20);
}

// https://astro.build/config
const runtime = process.env.WONDER_RUNTIME_BUILD === "1";
if(runtime && process.env.WONDER_STUDIO_BUILD === "1") throw Error("Runtime and Studio builds must be separate");
const iconOptions = {include: {}};
export default defineConfig({
  ...(runtime ? {adapter:nodeAdapter({mode:"standalone"}),outDir:"./runtime-dist"} : {}),
  ...(process.env.WONDER_STUDIO_BUILD === "1" ? {outDir: "./studio-dist", build: {assets: "studio-static"}} : {}),
	site: siteConfig.site_url,
	
	base: "/",
	trailingSlash: runtime ? "ignore" : "always",

	// 图像优化配置
	image: {
		// 全局响应式布局
		layout: "constrained",
	},

	experimental: {
		// Rust 编译器以提升构建性能（实验性），部分平台可能会导致构建失败，可以根据需要启用或禁用
		rustCompiler: false,
		// 队列渲染以优化性能（实验性）
		queuedRendering: { enabled: true },
	},

	integrations: [
    ...(runtime ? [runtimeIntegration(siteConfig,galleryConfig)] : []),
		{
			name: "wonder-build-icons",
			hooks: {
				"astro:config:setup": ({ command, config }) => {
					iconOptions.include = command === "build" ? iconIncludes(fileURLToPath(config.root)) : {};
				},
			},
		},
		{
			name: "wonder-studio-route",
			hooks: {
				"astro:config:setup": ({ command, injectRoute }) => {
					// Empty getStaticPaths does not stop Astro compiling a page's
					// editor imports. Do not register the private app in public builds.
					if (process.env.WONDER_STUDIO_BUILD === "1" ||
						(command === "dev" && process.env.WONDER_STUDIO_LOCAL === "1")) {
						injectRoute({ pattern: "/studio/[...entry]", entrypoint: "./src/components/studio/StudioPage.astro" });
					}
				},
			},
		},
		swup({
			theme: false,
			// Studio is built and deployed separately; do not retain either app's navigation or editor state across this boundary.
			ignore: (url) => {
				const target = new URL(url, window.location.href);
				return /^\/studio(?:\/|$)/.test(window.location.pathname)
					|| /^\/studio(?:\/|$)/.test(target.pathname)
					|| /^\/studio-auth(?:\/|$)/.test(target.pathname);
			},
			animationClass: "transition-swup-", // see https://swup.js.org/options/#animationselector
			// the default value `transition-` cause transition delay
			// when the Tailwind class `transition-all` is used
			containers: [
				"#banner-overlay-container",
				"#banner-dim-container",
				"#swup-container",
				"#left-sidebar-dynamic",
				"#right-sidebar-dynamic",
				"#floating-toc-wrapper",
			],
			smoothScrolling: false,
			cache: !runtime,
			preload: !runtime,
			accessibility: true,
			updateHead: true,
			updateBodyClass: false,
			globalInstance: true,
			// 滚动相关配置优化
			resolveUrl: (url) => url,
			animateHistoryBrowsing: false,
			skipPopStateHandling: (event) => {
				// 跳过锚点链接的处理，让浏览器原生处理
				return event.state?.url?.includes("#");
			},
		}),
		icon(iconOptions),
		expressiveCode(expressiveOptions),
		svelte(),
		...(!runtime ? [sitemap({
			filter: (page) => {
				// 根据页面开关配置过滤sitemap
				const url = new URL(page);
				const pathname = url.pathname;

				if (pathname === "/friends/" && !siteConfig.pages.friends) {
					return false;
				}
				if (pathname === "/sponsor/" && !siteConfig.pages.sponsor) {
					return false;
				}
				if (pathname === "/guestbook/" && !siteConfig.pages.guestbook) {
					return false;
				}
				if (pathname === "/bangumi/" && !siteConfig.pages.bangumi) {
					return false;
				}
				if (pathname === "/gallery/" && !siteConfig.pages.gallery) {
					return false;
				}

				return true;
			},
		})] : []),
		mdx(),
	],
	markdown: markdownOptions,
	vite: {
    define: {"import.meta.env.WONDER_RUNTIME_BUILD": JSON.stringify(runtime)},
		plugins: [tailwindcss(), studioLocalPlugin()],
		server: {
			watch: {
				ignored: ["**/package/**", "**/Firefly-docs/**"],
			},
		},
		resolve: {
			alias: {
				"@rehype-callouts-theme": `rehype-callouts/theme/${siteConfig.rehypeCallouts.theme}`,
			},
		},
		build: {
			minify: "esbuild",
			esbuildOptions: {
				minify: true,
				// 移除 console.log 和 debugger
				drop: ["console", "debugger"],
			},
			rollupOptions: {
				onwarn(warning, warn) {
					// temporarily suppress this warning
					if (
						warning.message.includes("is dynamically imported by") &&
						warning.message.includes("but also statically imported by")
					) {
						return;
					}
					warn(warning);
				},
			},
			// CSS 优化
			cssCodeSplit: true,
			cssMinify: "esbuild",
			assetsInlineLimit: 4096,
		},
	},
});
