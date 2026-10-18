// Shared by navbar and sidebar players; each widget keeps independent UI state.
const mounted = new WeakSet();

export function mountMusicPlayer(widget, cfg) {
	const mgr = window.__fireflyMusic;
	if (!mgr || !widget.isConnected || mounted.has(widget)) return;
	mounted.add(widget);

	// ── UI element refs ──────────────────────────────────────
	const ui = {
		widget: widget,
		loading: widget.querySelector(".music-loading"),
		cover: widget.querySelector(".music-cover"),
		title: widget.querySelector(".music-title"),
		artist: widget.querySelector(".music-artist"),
		progressBar: widget.querySelector(".progress-bar"),
		progressThumb: widget.querySelector(".progress-thumb"),
		progressContainer: widget.querySelector(".progress-container"),
		currentTime: widget.querySelector(".current-time"),
		totalTime: widget.querySelector(".total-time"),
		btnPlay: widget.querySelector(".btn-play"),
		iconPlay: widget.querySelector(".icon-play"),
		iconPause: widget.querySelector(".icon-pause"),
		btnPrev: widget.querySelector(".btn-prev"),
		btnNext: widget.querySelector(".btn-next"),
		btnRepeat: widget.querySelector(".btn-repeat"),
		iconRepeat: widget.querySelector(".icon-repeat"),
		iconRepeatOne: widget.querySelector(".icon-repeat-one"),
		iconShuffle: widget.querySelector(".icon-shuffle"),
		btnMute: widget.querySelector(".btn-mute"),
		iconVolHigh: widget.querySelector(".icon-vol-high"),
		iconVolMute: widget.querySelector(".icon-vol-mute"),
		volContainer: widget.querySelector(".vol-container"),
		volBar: widget.querySelector(".vol-bar"),
		btnLrc: widget.querySelector(".btn-lrc-toggle"),
		iconLrcOn: widget.querySelector(".icon-lrc-on"),
		iconLrcOff: widget.querySelector(".icon-lrc-off"),
		lrcDrawer: widget.querySelector(".lrc-drawer"),
		lrcContainer: widget.querySelector(".lrc-container"),
		btnDrawer: widget.querySelector(".btn-drawer-toggle"),
		playlistDrawer: widget.querySelector(".playlist-drawer"),
		playlistContainer: widget.querySelector(".playlist-container"),
		searchInput: widget.querySelector(".music-search-input"),
		btnSearch: widget.querySelector(".btn-search"),
		btnSearchReset: widget.querySelector(".btn-search-reset"),
		searchStatus: widget.querySelector(".music-search-status"),
		itemTemplate: document.getElementById(
			"playlist-item-template-" + widget.id,
		),
	};

	// Verify critical elements
	const _critical = [
		ui.btnPlay,
		ui.btnRepeat,
		ui.btnMute,
		ui.volContainer,
		ui.btnDrawer,
		ui.btnLrc,
		ui.lrcDrawer,
		ui.lrcContainer,
		ui.progressContainer,
		ui.btnNext,
		ui.btnPrev,
		ui.loading,
		ui.cover,
		ui.title,
		ui.artist,
		ui.playlistContainer,
		ui.itemTemplate,
		ui.searchInput,
		ui.btnSearch,
		ui.btnSearchReset,
		ui.searchStatus,
	];
	if (_critical.some((el) => !el)) return;

	// ── Local state (drawers, user scrolling) ────────────────
	const local = {
		playlistDirty: true,
		isUserScrolling: false,
		scrollTimeout: null,
		currentLrcIndex: -1,
	};

	// ── UI update functions ──────────────────────────────────
	function setLoading(bool) {
		if (bool) {
			ui.loading.classList.remove("opacity-0", "pointer-events-none");
		} else {
			ui.loading.classList.add("opacity-0", "pointer-events-none");
		}
	}

	function updatePlayStateUI(isPlaying) {
		if (isPlaying) {
			ui.btnPlay.classList.add(
				"bg-(--primary)",
				"text-white",
				"hover:brightness-110",
			);
			ui.btnPlay.classList.remove(
				"bg-(--btn-regular-bg)",
				"hover:bg-(--btn-regular-bg-hover)",
				"active:bg-(--btn-regular-bg-active)",
				"text-(--primary)",
			);
			ui.iconPlay.classList.add("hidden");
			ui.iconPause.classList.remove("hidden");
			ui.cover.style.animationPlayState = "running";
			ui.btnPlay.setAttribute("aria-label", cfg.i18n.pause);
			ui.btnPlay.title = cfg.i18n.pause;
		} else {
			ui.btnPlay.classList.remove(
				"bg-(--primary)",
				"text-white",
				"hover:brightness-110",
			);
			ui.btnPlay.classList.add(
				"bg-(--btn-regular-bg)",
				"hover:bg-(--btn-regular-bg-hover)",
				"active:bg-(--btn-regular-bg-active)",
				"text-(--primary)",
			);
			ui.iconPlay.classList.remove("hidden");
			ui.iconPause.classList.add("hidden");
			ui.cover.style.animationPlayState = "paused";
			ui.btnPlay.setAttribute("aria-label", cfg.i18n.play);
			ui.btnPlay.title = cfg.i18n.play;
		}
	}

	function updateModeUI(playMode) {
		const primaryColor = "text-(--primary)";
		if (playMode === 0) {
			ui.btnRepeat.className =
				"p-2 active:scale-95 transition-colors text-neutral-300 dark:text-neutral-600 hover:text-[var(--primary)]";
			ui.iconRepeat.classList.remove("hidden");
			ui.iconRepeatOne.classList.add("hidden");
			ui.iconShuffle.classList.add("hidden");
		} else if (playMode === 1) {
			ui.btnRepeat.className =
				"p-2 active:scale-95 transition-colors " + primaryColor;
			ui.iconRepeat.classList.add("hidden");
			ui.iconRepeatOne.classList.remove("hidden");
			ui.iconShuffle.classList.add("hidden");
		} else {
			ui.btnRepeat.className =
				"p-2 active:scale-95 transition-colors " + primaryColor;
			ui.iconRepeat.classList.add("hidden");
			ui.iconRepeatOne.classList.add("hidden");
			ui.iconShuffle.classList.remove("hidden");
		}
	}

	function updateVolumeUI(volume, isMuted) {
		const pct = isMuted ? 0 : volume * 100;
		ui.volBar.style.width = pct + "%";
		ui.volContainer.setAttribute("aria-valuenow", Math.round(pct).toString());
		if (isMuted || volume === 0) {
			ui.iconVolHigh.classList.add("hidden");
			ui.iconVolMute.classList.remove("hidden");
		} else {
			ui.iconVolHigh.classList.remove("hidden");
			ui.iconVolMute.classList.add("hidden");
		}
	}

	function updateTrackUI(track) {
		if (!track) return;
		ui.title.innerText = track.name;
		ui.title.title = track.name;
		ui.artist.innerText = track.artist;
		ui.artist.title = track.artist;

		if (track.pic) {
			ui.cover.classList.add("opacity-0");
			ui.cover.src = track.pic;
			ui.cover.alt = track.name + " - " + track.artist;
		} else {
			ui.cover.src = "";
			ui.cover.classList.add("opacity-0");
			ui.cover.alt = cfg.i18n.noCover;
		}

		// Reset cover rotation
		ui.cover.classList.remove("animate-spin-slow");
		void ui.cover.offsetWidth;
		ui.cover.classList.add("animate-spin-slow");
		ui.cover.style.animationPlayState = "paused";

		// Reset progress
		ui.progressBar.style.width = "0%";
		ui.progressThumb.style.left = "0%";
		ui.progressContainer.setAttribute("aria-valuenow", "0");
		ui.currentTime.innerText = "0:00";
		ui.totalTime.innerText = "0:00";
	}

	function renderPlaylist(playlist, currentIndex) {
		local.playlistDirty = true;
		if (ui.playlistDrawer.style.gridTemplateRows !== "1fr") return;
		ui.playlistContainer.querySelectorAll(".playlist-item").forEach((item) => {
			item.remove();
		});
		const fragment = document.createDocumentFragment();
		playlist.forEach((track, idx) => {
			const clone = ui.itemTemplate.content.cloneNode(true);
			const itemEl = clone.querySelector(".playlist-item");
			const img = clone.querySelector(".item-cover");
			const title = clone.querySelector(".item-title");
			const artist = clone.querySelector(".item-artist");

			img.src = track.pic || "";
			img.alt = track.name + " - " + track.artist;
			title.innerText = track.name;
			artist.innerText = track.artist;

			itemEl.dataset.index = idx;
			itemEl.setAttribute("role", "option");
			itemEl.setAttribute("aria-label", track.name + " - " + track.artist);
			itemEl.onclick = () => {
				mgr.playTrackByIndex(idx);
			};
			fragment.appendChild(clone);
		});
		ui.playlistContainer.appendChild(fragment);
		local.playlistDirty = false;
		updatePlaylistActiveUI(currentIndex);
	}

	function updateSearchStatus(text, visible) {
		ui.searchStatus.innerText = text || "";
		ui.searchStatus.classList.toggle("hidden", !visible);
	}

	function updatePlaylistActiveUI(currentIndex) {
		if (ui.playlistDrawer.style.gridTemplateRows !== "1fr") return;
		const items = ui.playlistContainer.querySelectorAll(".playlist-item");
		items.forEach((el) => {
			const idx = Number.parseInt(el.dataset.index);
			const overlay = el.querySelector(".item-active-overlay");
			const title = el.querySelector(".item-title");
			if (idx === currentIndex) {
				el.classList.add("bg-neutral-100", "dark:bg-white/10");
				el.setAttribute("aria-current", "true");
				overlay.classList.remove("hidden");
				overlay.classList.add("flex");
				title.classList.add("text-(--primary)");
			} else {
				el.classList.remove("bg-neutral-100", "dark:bg-white/10");
				el.removeAttribute("aria-current");
				overlay.classList.add("hidden");
				overlay.classList.remove("flex");
				title.classList.remove("text-(--primary)");
			}
		});
	}

	function renderLyricsUI(lyrics, status) {
		local.currentLrcIndex = -1;
		ui.lrcContainer.innerHTML = "";
		if (status === "loading") {
			ui.lrcContainer.innerHTML =
				'<div class="text-neutral-400 text-sm py-10">' +
				cfg.i18n.loadingLyrics +
				"</div>";
			return;
		}
		if (status === "failed") {
			ui.lrcContainer.innerHTML =
				'<div class="text-neutral-400 text-sm py-10">' +
				cfg.i18n.failedLyrics +
				"</div>";
			return;
		}
		if (!lyrics || lyrics.length === 0) {
			ui.lrcContainer.innerHTML =
				'<div class="text-neutral-400 text-sm py-10" role="option">' +
				cfg.i18n.noLyrics +
				"</div>";
			return;
		}
		lyrics.forEach((line, index) => {
			const lineEl = document.createElement("div");
			lineEl.className =
				"lrc-line transition-all duration-300 text-sm text-neutral-400 py-1 cursor-pointer hover:text-(--primary)";
			lineEl.innerText = line.text;
			lineEl.dataset.index = index;
			lineEl.setAttribute("role", "option");
			lineEl.setAttribute("aria-label", line.text);
			lineEl.onclick = () => {
				mgr.seekToTime(line.time);
			};
			ui.lrcContainer.appendChild(lineEl);
		});
	}

	function updateLrcHighlight(index) {
		if (index === local.currentLrcIndex) return;
		local.currentLrcIndex = index;

		const lines = ui.lrcContainer.querySelectorAll(".lrc-line");
		lines.forEach((line, i) => {
			if (i === index) {
				line.classList.add("text-(--primary)", "font-bold", "text-base");
				line.classList.remove("text-neutral-400", "text-sm");
			} else {
				line.classList.remove("text-(--primary)", "font-bold", "text-base");
				line.classList.add("text-neutral-400", "text-sm");
			}
		});

		// Auto-scroll unless user is scrolling
		if (index !== -1 && !local.isUserScrolling) {
			const line = ui.lrcContainer.querySelector(
				'.lrc-line[data-index="' + index + '"]',
			);
			if (line) {
				const containerHeight = ui.lrcContainer.clientHeight;
				const lineOffset = line.offsetTop;
				const lineHeight = line.offsetHeight;
				const targetScroll = lineOffset - containerHeight / 2 + lineHeight / 2;
				ui.lrcContainer.scrollTo({ top: targetScroll, behavior: "smooth" });
			}
		}
	}

	// ── Full sync from manager state (for late-mount) ────────
	function syncAll() {
		const s = mgr.getState();
		if (!s.initialized) return;

		// Loading off
		setLoading(false);

		if (s.playlist.length === 0) {
			ui.title.innerText = s.error || cfg.i18n.noSongs;
			return;
		}

		renderPlaylist(s.playlist, s.currentIndex);
		if (s.track) updateTrackUI(s.track);
		updatePlayStateUI(s.isPlaying);
		updateModeUI(s.playMode);
		updateVolumeUI(s.volume, s.isMuted);

		// Progress
		if (s.duration > 0) {
			ui.progressBar.style.width = s.progress + "%";
			ui.progressThumb.style.left = s.progress + "%";
			ui.progressContainer.setAttribute(
				"aria-valuenow",
				Math.round(s.progress).toString(),
			);
			ui.currentTime.innerText = s.currentTimeStr;
			ui.totalTime.innerText = s.durationStr;
		}

		// Lyrics
		renderLyricsUI(s.lyrics, s.lyrics.length > 0 ? "loaded" : "none");
		if (s.currentLrcIndex >= 0) updateLrcHighlight(s.currentLrcIndex);

		// Cover image: if already set, show it
		if (
			s.track &&
			s.track.pic &&
			ui.cover.src &&
			ui.cover.complete &&
			ui.cover.naturalWidth > 0
		) {
			ui.cover.classList.remove("opacity-0");
		}
		// Update cover animation state to match play state
		ui.cover.style.animationPlayState = s.isPlaying ? "running" : "paused";
	}

	// ── Event listeners (fm:* from manager) ──────────────────
	const handlers = {};

	function on(name, fn) {
		handlers[name] = fn;
		window.addEventListener(name, fn);
	}

	on("fm:init", (e) => {
		const d = e.detail;
		setLoading(false);
		renderPlaylist(d.playlist, 0);
		if (d.playlist.length > 0) {
			updateModeUI(d.playMode);
			updateVolumeUI(d.volume, d.isMuted);
		} else {
			ui.title.innerText = cfg.i18n.noSongs;
		}
	});

	on("fm:track", (e) => {
		const d = e.detail;
		updateTrackUI(d.track);
		updatePlaylistActiveUI(d.index);
	});

	on("fm:play-state", (e) => {
		updatePlayStateUI(e.detail.isPlaying);
	});

	on("fm:time", (e) => {
		const d = e.detail;
		ui.progressBar.style.width = d.progress + "%";
		ui.progressThumb.style.left = d.progress + "%";
		ui.progressContainer.setAttribute(
			"aria-valuenow",
			Math.round(d.progress).toString(),
		);
		ui.currentTime.innerText = d.currentTimeStr;
		ui.totalTime.innerText = d.durationStr;
	});

	on("fm:volume", (e) => {
		updateVolumeUI(e.detail.volume, e.detail.isMuted);
	});

	on("fm:mode", (e) => {
		updateModeUI(e.detail.playMode);
	});

	on("fm:lyrics", (e) => {
		renderLyricsUI(e.detail.lyrics, e.detail.status);
	});

	on("fm:lrc-index", (e) => {
		updateLrcHighlight(e.detail.index);
	});

	on("fm:error", (e) => {
		ui.title.innerText = e.detail.message || cfg.i18n.error;
	});

	on("fm:search-state", (e) => {
		const d = e.detail || {};
		ui.btnSearch.disabled = d.status === "loading";
		ui.btnSearch.classList.toggle("opacity-60", d.status === "loading");
		if (d.status === "loading") {
			updateSearchStatus('正在搜索 "' + d.query + '"...', true);
		} else if (d.status === "done") {
			updateSearchStatus("搜索结果：" + (d.count || 0) + " 首", true);
		} else if (d.status === "empty") {
			updateSearchStatus("没有找到相关歌曲", true);
		} else if (d.status === "error") {
			updateSearchStatus("搜索失败，请稍后重试", true);
		} else {
			updateSearchStatus("", false);
		}
	});

	// ── Button click delegates ───────────────────────────────
	ui.btnPlay.addEventListener("click", () => {
		mgr.togglePlay();
	});
	ui.btnNext.addEventListener("click", () => {
		mgr.playNext();
	});
	ui.btnPrev.addEventListener("click", () => {
		mgr.playPrev();
	});
	ui.btnRepeat.addEventListener("click", () => {
		mgr.cyclePlayMode();
	});
	ui.btnMute.addEventListener("click", () => {
		mgr.toggleMute();
	});

	function runSearch() {
		const query = ui.searchInput.value.trim();
		if (!query) return;
		mgr.search(query);
	}

	ui.btnSearch.addEventListener("click", runSearch);
	ui.searchInput.addEventListener("keydown", (e) => {
		if (e.key === "Enter") runSearch();
	});
	ui.btnSearchReset.addEventListener("click", () => {
		ui.searchInput.value = "";
		mgr.resetPlaylist();
	});

	ui.volContainer.addEventListener("click", (e) => {
		const rect = ui.volContainer.getBoundingClientRect();
		const x = e.clientX - rect.left;
		const val = Math.max(0, Math.min(1, x / rect.width));
		mgr.setVolume(val);
	});

	ui.progressContainer.addEventListener("click", (e) => {
		const rect = ui.progressContainer.getBoundingClientRect();
		const clickX = e.clientX - rect.left;
		const percent = Math.min(Math.max(clickX / rect.width, 0), 1);
		mgr.seek(percent);
	});

	// ── Drawer logic (local state) ───────────────────────────
	ui.btnLrc.addEventListener("click", () => {
		const isOpen = ui.lrcDrawer.style.gridTemplateRows === "1fr";
		if (isOpen) {
			ui.lrcDrawer.style.gridTemplateRows = "0fr";
			ui.lrcDrawer.classList.remove("opacity-100");
			ui.lrcDrawer.classList.add("opacity-0");
			ui.btnLrc.classList.remove("text-(--primary)");
			ui.btnLrc.classList.add("text-neutral-400");
			ui.iconLrcOn.classList.add("hidden");
			ui.iconLrcOff.classList.remove("hidden");
		} else {
			// Close playlist if open
			ui.playlistDrawer.style.gridTemplateRows = "0fr";
			ui.playlistDrawer.classList.remove("opacity-100");
			ui.playlistDrawer.classList.add("opacity-0");
			ui.btnDrawer.classList.remove("text-(--primary)");
			ui.btnDrawer.classList.add("text-neutral-400");

			ui.lrcDrawer.style.gridTemplateRows = "1fr";
			ui.lrcDrawer.classList.add("opacity-100");
			ui.lrcDrawer.classList.remove("opacity-0");
			ui.btnLrc.classList.add("text-(--primary)");
			ui.btnLrc.classList.remove("text-neutral-400");
			ui.iconLrcOn.classList.remove("hidden");
			ui.iconLrcOff.classList.add("hidden");
		}
	});

	ui.btnDrawer.addEventListener("click", () => {
		const isOpen = ui.playlistDrawer.style.gridTemplateRows === "1fr";
		if (isOpen) {
			ui.playlistDrawer.style.gridTemplateRows = "0fr";
			ui.playlistDrawer.classList.remove("opacity-100");
			ui.playlistDrawer.classList.add("opacity-0");
			ui.btnDrawer.classList.add("text-neutral-400");
			ui.btnDrawer.classList.remove("text-(--primary)");
		} else {
			// Close lyrics if open
			ui.lrcDrawer.style.gridTemplateRows = "0fr";
			ui.lrcDrawer.classList.remove("opacity-100");
			ui.lrcDrawer.classList.add("opacity-0");
			ui.btnLrc.classList.remove("text-(--primary)");
			ui.btnLrc.classList.add("text-neutral-400");

			ui.playlistDrawer.style.gridTemplateRows = "1fr";
			ui.playlistDrawer.classList.add("opacity-100");
			ui.playlistDrawer.classList.remove("opacity-0");
			ui.btnDrawer.classList.remove("text-neutral-400");
			ui.btnDrawer.classList.add("text-(--primary)");
			const s = mgr.getState();
			if (local.playlistDirty) renderPlaylist(s.playlist, s.currentIndex);
			else updatePlaylistActiveUI(s.currentIndex);
		}
	});

	// ── Lyrics user scroll detection ─────────────────────────
	function resetScrollTimeout() {
		clearTimeout(local.scrollTimeout);
		local.scrollTimeout = setTimeout(() => {
			local.isUserScrolling = false;
			// Snap back to current lyric
			const s = mgr.getState();
			if (s.currentLrcIndex >= 0) {
				const line = ui.lrcContainer.querySelector(
					'.lrc-line[data-index="' + s.currentLrcIndex + '"]',
				);
				if (line) {
					const containerHeight = ui.lrcContainer.clientHeight;
					const lineOffset = line.offsetTop;
					const lineHeight = line.offsetHeight;
					const targetScroll =
						lineOffset - containerHeight / 2 + lineHeight / 2;
					ui.lrcContainer.scrollTo({ top: targetScroll, behavior: "auto" });
				}
			}
		}, 3000);
	}

	ui.lrcContainer.addEventListener("wheel", () => {
		local.isUserScrolling = true;
		resetScrollTimeout();
	});
	ui.lrcContainer.addEventListener("touchstart", () => {
		local.isUserScrolling = true;
		resetScrollTimeout();
	});

	// ── Cover image events ───────────────────────────────────
	ui.cover.addEventListener("load", () => {
		ui.cover.classList.remove("opacity-0");
	});
	ui.cover.addEventListener("error", () => {
		ui.cover.classList.add("opacity-0");
	});

	// ── Cleanup on DOM removal ───────────────────────────────
	const observer = new MutationObserver((mutations) => {
		for (let i = 0; i < mutations.length; i++) {
			const removed = mutations[i].removedNodes;
			for (let j = 0; j < removed.length; j++) {
				if (
					removed[j] === widget ||
					(removed[j].contains && removed[j].contains(widget))
				) {
					// Widget removed from DOM – clean up event listeners
					Object.keys(handlers).forEach((name) => {
						window.removeEventListener(name, handlers[name]);
					});
					observer.disconnect();
					clearTimeout(local.scrollTimeout);
					return;
				}
			}
		}
	});
	if (widget.parentNode) {
		observer.observe(widget.parentNode, { childList: true });
	}

	// ── Init: either sync existing state or trigger init ─────
	const currentState = mgr.getState();
	if (currentState.initialized) {
		// Manager already initialized (late mount) – sync all UI
		syncAll();
	} else {
		// First widget to mount – show loading and trigger init
		setLoading(true);
		mgr.init();
	}
}
