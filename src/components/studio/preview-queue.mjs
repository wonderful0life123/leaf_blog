// Coalesce split-view work without delaying editor changes or starving the preview.
export function createPreviewQueue(commit) {
	let timer = null;
	let pending = null;
	function cancel() {
		clearTimeout(timer);
		timer = null;
		pending = null;
	}
	function flush() {
		const render = pending;
		cancel();
		if (render) commit(render());
	}
	return {
		update(render, immediate = false) {
			pending = render;
			if (immediate) flush();
			else if (timer === null) timer = setTimeout(flush, 120);
		},
		cancel,
	};
}
