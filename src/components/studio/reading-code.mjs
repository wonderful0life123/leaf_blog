import { tick } from "svelte";
import { codeSegments } from "./code-preview.mjs";

// Enhance only the sanitized reader DOM. Copy always uses the original text,
// never the decorated DOM (line numbers and controls are not part of the code).
export function readingCode(node) {
	let generation = 0;
	let cleanups = [];
	let observer;
	function clear() {
		observer?.disconnect();
		observer = null;
		for (const cleanup of cleanups) cleanup();
		cleanups = [];
	}
	async function render() {
		const current = ++generation;
		clear();
		await tick();
		if (current !== generation) return;
		const pending = new Map();
		if (typeof IntersectionObserver !== "undefined") {
			observer = new IntersectionObserver(
				(entries) => {
					if (current !== generation) return;
					for (const entry of entries) {
						if (!entry.isIntersecting) continue;
						observer.unobserve(entry.target);
						pending.get(entry.target)?.();
						pending.delete(entry.target);
					}
				},
				{ rootMargin: "300px" },
			);
		}
		for (const pre of node.querySelectorAll("pre")) {
			const code = pre.querySelector(":scope > code");
			if (!code) continue;
			const source = code.textContent || "";
			const language =
				[...code.classList]
					.find((name) => name.startsWith("language-"))
					?.slice(9) || "text";
			const frame = document.createElement("div");
			frame.className = "reader-code";
			const bar = document.createElement("div");
			bar.className = "reader-code-bar";
			const label = document.createElement("span");
			label.textContent = language === "text" ? "纯文本" : language;
			const button = document.createElement("button");
			button.type = "button";
			button.className = "reader-code-copy";
			button.textContent = "复制";
			button.setAttribute("aria-label", "复制代码");
			const feedback = document.createElement("span");
			feedback.className = "reader-code-feedback";
			feedback.setAttribute("role", "status");
			bar.append(label, feedback, button);
			pre.before(frame);
			frame.append(bar, pre);
			// A separate, non-selectable gutter leaves indentation and copied text intact.
			const gutter = document.createElement("span");
			gutter.className = "reader-code-gutter";
			gutter.setAttribute("aria-hidden", "true");
			const count = (
				source.endsWith("\n") ? source.slice(0, -1) : source
			).split("\n").length;
			gutter.textContent = Array.from({ length: count }, (_, i) => i + 1).join(
				"\n",
			);
			pre.prepend(gutter);
			let timer;
			const copy = async () => {
				button.disabled = true;
				try {
					await navigator.clipboard.writeText(source);
					if (current !== generation) return;
					button.textContent = "已复制";
					feedback.textContent = "代码已复制";
				} catch {
					if (current !== generation) return;
					button.textContent = "重试复制";
					feedback.textContent = "复制失败，请选中代码手动复制";
				} finally {
					button.disabled = false;
					clearTimeout(timer);
					if (current === generation)
						timer = setTimeout(() => {
							button.textContent = "复制";
							feedback.textContent = "";
						}, 2500);
				}
			};
			button.addEventListener("click", copy);
			cleanups.push(() => {
				clearTimeout(timer);
				button.removeEventListener("click", copy);
				gutter.remove();
				code.textContent = source;
				frame.replaceWith(pre);
			});
			const highlight = () =>
				codeSegments(source, language).then((segments) => {
					if (current !== generation || !frame.isConnected) return;
					const fragment = document.createDocumentFragment();
					for (const segment of segments) {
						const span = document.createElement("span");
						span.className = segment.classes;
						span.textContent = segment.text;
						fragment.append(span);
					}
					code.replaceChildren(fragment);
				});
			if (observer) {
				pending.set(frame, highlight);
				observer.observe(frame);
			} else highlight();
		}
	}
	render();
	return {
		update: render,
		destroy() {
			generation++;
			clear();
		},
	};
}
