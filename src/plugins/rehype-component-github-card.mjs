/// <reference types="mdast" />
import {githubRepo,githubCard} from "../lib/github-card.mjs";
import { h } from "hastscript";

/**
 * Creates a GitHub Card component.
 *
 * @param {Object} properties - The properties of the component.
 * @param {string} properties.repo - The GitHub repository in the format "owner/repo".
 * @param {import('mdast').RootContent[]} children - The children elements of the component.
 * @returns {import('mdast').Parent} The created GitHub Card component.
 */
export function GithubCardComponent(properties, children) {
	if (Array.isArray(children) && children.length !== 0)
		return h("div", { class: "hidden" }, [
			'Invalid directive. ("github" directive must be leaf type "::github{repo="owner/repo"}")',
		]);

	if (!githubRepo(properties.repo))
		return h(
			"div",
			{ class: "hidden" },
			'Invalid repository. ("repo" attributte must be in the format "owner/repo")',
		);

	const repo = properties.repo;
	const cardUuid = `GC${Math.random().toString(36).slice(-6)}`; // Collisions are not important

	const nScript = h(
		`script#${cardUuid}-script`,
		{ type: "text/javascript", defer: true },
		`
      fetch('https://api.github.com/repos/${repo}', { referrerPolicy: "no-referrer", credentials: "omit", signal: AbortSignal.timeout(8000) }).then(response => { if (!response.ok) throw Error('Repository unavailable'); return response.json(); }).then(data => {
        document.getElementById('${cardUuid}-description').innerText = data.description?.replace(/:[a-zA-Z0-9_]+:/g, '') || "Description not set";
        document.getElementById('${cardUuid}-language').innerText = data.language;
        document.getElementById('${cardUuid}-forks').innerText = Intl.NumberFormat('en-us', { notation: "compact", maximumFractionDigits: 1 }).format(data.forks).replaceAll("\u202f", '');
        document.getElementById('${cardUuid}-stars').innerText = Intl.NumberFormat('en-us', { notation: "compact", maximumFractionDigits: 1 }).format(data.stargazers_count).replaceAll("\u202f", '');
        const avatarEl = document.getElementById('${cardUuid}-avatar');
        avatarEl.style.backgroundImage = 'url(' + data.owner.avatar_url + '&s=32' + ')';
        avatarEl.style.backgroundColor = 'transparent';
        document.getElementById('${cardUuid}-license').innerText = data.license?.spdx_id || "no-license";
        document.getElementById('${cardUuid}-card').classList.remove("fetch-waiting");
        console.log("[GITHUB-CARD] Loaded card for ${repo} | ${cardUuid}.")
      }).catch(err => {
        const c = document.getElementById('${cardUuid}-card');
        c?.classList.add("fetch-error");
        const description = c?.querySelector('.gc-description');
        if (description) description.textContent = '暂时无法获取仓库信息 · 仍可打开 GitHub';
        console.warn("[GITHUB-CARD] (Error) Loading card for ${repo} | ${cardUuid}.")
      })
    `,
	);

	const card=githubCard(repo,h,cardUuid);
	card.children.push(nScript);
	return card;
}
