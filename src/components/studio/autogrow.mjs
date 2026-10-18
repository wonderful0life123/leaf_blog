export function autogrow(node) {
	let frame;
	function resize() {
		node.style.height = "auto";
		node.style.height = `${node.scrollHeight + node.offsetHeight - node.clientHeight}px`;
	}
	function schedule() {
		cancelAnimationFrame(frame);
		frame = requestAnimationFrame(resize);
	}
	const observer = new ResizeObserver((entries) => {
		const nextWidth = entries[0]?.contentRect.width;
		if (nextWidth !== width) {
			width = nextWidth;
			schedule();
		}
	});
	let width;
	observer.observe(node);
	node.addEventListener("input", schedule);
	schedule();
	return {
		update: schedule,
		destroy() {
			cancelAnimationFrame(frame);
			observer.disconnect();
			node.removeEventListener("input", schedule);
		},
	};
}
