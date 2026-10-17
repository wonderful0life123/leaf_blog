// Integration exercise: real Studio HTTP handler + store + publication manager,
// real Git commits/pushes to a disposable local bare remote, real Node renderer.
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { parse } from "node-html-parser";
import { openStore } from "../../scripts/studio/store.mjs";
import { openPublications } from "../../scripts/studio/publications.mjs";
import { createHandler } from "../../scripts/studio/http.mjs";
import {
	runtimePublisher,
	buildRuntimeRelease,
	closeRuntimeIndexer,
} from "../../scripts/runtime/release.mjs";
const pause = () => new Promise((r) => setTimeout(r, 20));
const source = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../..",
);
const root = fs.mkdtempSync(path.join(os.tmpdir(), "wonder-runtime-publish-"));
console.log("Isolated runtime diagnostics: " + root);
async function runPipeline() {
	const repo = path.join(root, "publisher"),
		remote = path.join(root, "remote.git");
	const git = (args, cwd = repo) =>
		execFileSync("git", args, {
			cwd,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		}).trim();
	git(["clone", "--shared", "--no-hardlinks", source, repo], root);
	git(["init", "--bare", remote], root);
	git(["config", "receive.shallowUpdate", "true"], remote);
	git(["remote", "set-url", "origin", remote]);
	git(["checkout", "-b", "feat/runtime-test"]);
	const patch = execFileSync("git", ["diff", "--binary", "HEAD"], {
		cwd: source,
	});
	if (patch.length)
		execFileSync("git", ["apply", "--binary", "-"], {
			cwd: repo,
			input: patch,
		});
	const added = execFileSync(
		"git",
		["ls-files", "--others", "--exclude-standard", "-z"],
		{ cwd: source, encoding: "utf8" },
	)
		.split("\0")
		.filter(Boolean);
	for (const file of added) {
		fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
		fs.copyFileSync(path.join(source, file), path.join(repo, file));
	}
	git(["add", "-A"]);
	if (git(["diff", "--cached", "--name-only"]))
		git([
			"-c",
			"user.name=Runtime test",
			"-c",
			"user.email=test@example.invalid",
			"commit",
			"-m",
			"Isolated source snapshot",
		]);
	git(["push", "origin", "feat/runtime-test"]);
	assert.equal(
		git(["remote", "get-url", "origin"]),
		remote,
		"Only local bare Git is allowed",
	);
	fs.symlinkSync(
		path.join(source, "node_modules"),
		path.join(repo, "node_modules"),
	);
	fs.symlinkSync(
		path.join(source, ".studio-preview"),
		path.join(repo, ".studio-preview"),
	);
	fs.appendFileSync(
		path.join(repo, ".git/info/exclude"),
		"\nnode_modules\n.studio-preview\n",
	);
	const config = {
		mode: "runtime",
		repoDir: repo,
		enabled: true,
		branch: "feat/runtime-test",
		codeRevision: git(["rev-parse", "HEAD"]),
		releaseDir: path.join(root, "releases"),
		liveLink: path.join(root, "current"),
	};
	fs.cpSync(
		path.join(source, "runtime-dist"),
		path.join(repo, "runtime-dist"),
		{ recursive: true },
	);
	const buildMs = Number(process.env.WONDER_TEST_BUILD_MS || 0);
	const initial = "code-" + config.codeRevision;
	await buildRuntimeRelease(repo, path.join(config.releaseDir, initial), {
		...config,
		id: initial,
	});
	fs.symlinkSync(path.join(config.releaseDir, initial), config.liveLink);
	function fingerprint() {
		const dist = path.join(repo, "runtime-dist"),
			hash = createHash("sha256");
		for (const file of fs.readdirSync(dist, { recursive: true }).sort())
			if (fs.statSync(path.join(dist, file)).isFile())
				hash.update(file).update(fs.readFileSync(path.join(dist, file)));
		return hash.digest("hex");
	}
	const builtHash = fingerprint();
	const probe = http.createServer();
	await new Promise((r) => probe.listen(0, "127.0.0.1", r));
	const port = probe.address().port;
	await new Promise((r) => probe.close(r));
	const log = fs.openSync(path.join(root, "runtime.log"), "w");
	const server = spawn(process.execPath, ["scripts/runtime/serve.mjs"], {
		cwd: repo,
		env: {
			...process.env,
			WONDER_RUNTIME_CODE_REVISION: config.codeRevision,
			WONDER_RUNTIME_RELEASE_DIR: config.releaseDir,
			WONDER_RUNTIME_LIVE_LINK: config.liveLink,
			WONDER_RUNTIME_PORT: String(port),
		},
		stdio: ["ignore", log, log],
	});
	process.once("exit", () => server.kill());
	const origin = "http://127.0.0.1:" + port;
	for (let i = 0; i < 300; i++) {
		try {
			if ((await fetch(origin + "/")).ok) break;
		} catch {}
		if (i === 299) {
			server.kill();
			throw Error(
				"Runtime did not start: " +
					fs.readFileSync(path.join(root, "runtime.log"), "utf8"),
			);
		}
		await pause();
	}
	const store = openStore({ dataDir: path.join(root, "studio-data") });
	const driver = runtimePublisher(config),
		build = driver.build,
		deploy = driver.deploy;
	let failDeploy = false,
		editDuringBuild = null;
	driver.build = async (...args) => {
		const result = await build(...args);
		if (editDuringBuild) {
			editDuringBuild();
			editDuringBuild = null;
		}
		return result;
	};
	driver.deploy = async (...args) => {
		if (failDeploy) throw Error("injected failure before switch");
		return deploy(...args);
	};
	const args = {
		dataDir: path.join(root, "studio-data"),
		store,
		config,
		adapter: driver,
	};
	let manager = openPublications(args);
	const api = http.createServer((req, res) =>
		createHandler(store, { publications: manager })(req, res),
	);
	await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve));
	const endpoint = "http://127.0.0.1:" + api.address().port;
	async function request(route, data, status) {
		const response = await fetch(endpoint + route, {
			method: data ? "POST" : "GET",
			headers: { "Content-Type": "application/json", Origin: endpoint },
			...(data ? { body: JSON.stringify(data) } : {}),
		});
		const result = await response.json();
		assert.equal(
			response.status,
			status ?? (data ? 202 : 200),
			JSON.stringify(result),
		);
		return result.publication;
	}
	async function wait(id) {
		for (let i = 0; i < 3000; i++) {
			const job = await request("/publications/" + id);
			if (!["building", "publishing"].includes(job.state)) return job;
			await pause();
		}
		throw Error("Publication exceeded 60 seconds");
	}
	async function publicRead(route, status = 200) {
		const response = await fetch(origin + route);
		assert.equal(response.status, status, route);
		return { text: await response.text(), headers: response.headers };
	}
	const imageBytes = Buffer.from(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV8sAAAAASUVORK5CYII=",
		"base64",
	);
	const media = store.upload(imageBytes);
	let location=store.editFolderOrganization({revision:store.organization([]).revision,action:'create',name:'writing',parent:null},[]);
  const writing=location.folders.find(f=>f.name==='writing').id;
  let draft = store.create({
    organization:{revision:location.revision,target:writing},
		title: "快速发布 FIRST",
		body:
			'## Pipeline verification\n\nquasarfirst\n\n```python\nprint("wonder")\n```\n\n$E=mc^2$\n\n![pipeline image](' +
			media.url +
			")\n",
		category: "验证/第一类",
		tags: "runtime",
	});
	store.create({
		title: "PRIVATE UNSHARED DRAFT",
		body: "neverpublicsecret",
		category: "",
		tags: "",
	});
	const input = () => ({
		revision: draft.revision,
		path: "writing/runtime-pipeline.md",
		published: "2026-10-14",
		description: "运行时发布摘要 " + draft.title,
	});
	const prepare = async () => {
		const job = await request("/drafts/" + draft.id + "/publication", input());
		const ready = await wait(job.id);
		assert.equal(ready.state, "ready", JSON.stringify(ready));
		return ready;
	};
	const confirm = (job) =>
		request("/publications/" + job.id, {
			revision: job.revision,
			confirm: true,
		});
	const head = () => git(["rev-parse", "refs/heads/feat/runtime-test"], remote);
	const live = () => fs.realpathSync(config.liveLink);
	const timings = [],
		checks = [];
	let initialHead = head(),
		previousSearch,
		previousImage;
	async function verify(job, word) {
		assert.equal(head(), job.commit);
		assert.equal(server.exitCode, null);
		assert.equal(fingerprint(), builtHash);
		const article = await publicRead("/posts/writing/runtime-pipeline/"),
			home = await publicRead("/"),
			archive = await publicRead("/archive/"),
			meta = await publicRead("/api/allPostMeta.json");
		for (const page of [article, home, archive, meta]) {
			assert.ok(page.text.includes(draft.title));
			assert.ok(!page.text.includes("PRIVATE UNSHARED DRAFT"));
			assert.equal(page.headers.get("x-content-revision"), job.id);
			assert.equal(page.headers.get("cache-control"), "no-store");
		}
		assert.ok(article.text.includes(word));
		assert.ok(article.text.includes("katex"));
		assert.ok(article.text.includes("expressive-code"));
		for (const url of ["/rss.xml", "/sitemap-0.xml"])
			assert.ok(
				(await publicRead(url)).text.includes("writing/runtime-pipeline/"),
			);
		assert.ok(
			(await publicRead("/rss.xml")).text.includes(word),
			"full RSS body must update",
		);
		assert.ok((await publicRead("/sitemap-0.xml")).text.includes("/archive/"));
		const image = parse(article.text)
			.querySelector('img[alt="pipeline image"]')
			.getAttribute("src");
		const response = await fetch(origin + image);
		assert.equal(response.status, 200);
		assert.deepEqual(Buffer.from(await response.arrayBuffer()), imageBytes);
		if (previousImage) await publicRead(previousImage);
		previousImage = image;
		const manifest = JSON.parse(
			(await publicRead("/runtime-release.json")).text,
		);
		assert.equal(manifest.id, job.id);
		await publicRead(manifest.search);
		// Pagefind metadata/index extensions contain underscores; never canonicalize them as HTML.
		for (const file of fs.readdirSync(path.join(live(), "pagefind"), {
			recursive: true,
		})) {
			if (!fs.statSync(path.join(live(), "pagefind", file)).isFile()) continue;
			const asset = await fetch(
				origin + "/runtime-search/" + job.id + "/" + file,
				{ redirect: "manual" },
			);
			assert.equal(asset.status, 200, "Pagefind asset: " + file);
		}

		if (previousSearch) {
			assert.notEqual(manifest.search, previousSearch);
			await publicRead(previousSearch);
		}
		previousSearch = manifest.search;
		await publicRead("/published.json", 404);
		await publicRead("/manifest.json", 404);
		assert.ok(
			git(["diff-tree", "--no-commit-id", "--name-only", "-r", job.commit])
				.split("\n")
				.every((file) => file.startsWith("src/content/posts/writing/")||["src/data/article-routes.json","src/data/public-archive.json"].includes(file)),
		);
		const snapshot = fs.readFileSync(
			path.join(live(), "published.json"),
			"utf8",
		);
		assert.ok(!snapshot.includes("neverpublicsecret"));
		assert.ok(!snapshot.includes("/studio-api/media/"));
	}
	async function verifyExistingCudaImages() {
		const page = await publicRead("/posts/ai-infra/cuda/global-indexing/");
		const images = parse(page.text).querySelectorAll(".markdown-content img");
		assert.equal(images.length, 3, "original CUDA article retains all images");
		const filenames = [
			"file-20260516173113359.webp",
			"003.DbAsiMCW_1mrdxw.webp",
			"004.Bgaxujgw_XFgdz.webp",
		];
		const rss = (await publicRead("/rss.xml")).text;
		for (const [index, img] of images.entries()) {
			const url = img.getAttribute("src");
			assert.ok(url.startsWith("/published-media/"), url);
			const response = await fetch(origin + url, { redirect: "manual" });
			assert.equal(response.status, 200, url);
			assert.ok(response.headers.get("content-type").startsWith("image/"));
			assert.deepEqual(
				Buffer.from(await response.arrayBuffer()),
				fs.readFileSync(
					path.join(
						repo,
						"src/content/posts/ai-infra/cuda/assets/全局位置计算",
						filenames[index],
					),
				),
			);
			assert.ok(
				rss.includes("https://wonder-ai.info" + url),
				"full RSS uses the same mapped image",
			);
		}
	}
	try {
		await verifyExistingCudaImages();
		await publicRead("/posts/writing/runtime-pipeline/", 404);
		for (const round of [1, 2]) {
			if (round === 2)
				draft = store.update(draft.id, {
					...draft,
					title: "快速发布 UPDATED",
					category: "验证/第二类",
					body: draft.body.replace("quasarfirst", "quasarsecond"),
				});
			const start = performance.now(),
				job = await prepare(),
				prepared = performance.now();
			assert.equal(
				head(),
				round === 1 ? initialHead : timings[0].commit,
				"preview must not push",
			);
			const before = live();
			await confirm(job);
			// While publishing, a second confirmation cannot create another job/commit.
			await request(
				"/publications/" + job.id,
				{ revision: job.revision, confirm: true },
				409,
			);
			const done = await wait(job.id);
			assert.equal(done.state, "published", JSON.stringify(done));
			const published = performance.now();
			await verify(done, round === 1 ? "quasarfirst" : "quasarsecond");
			assert.notEqual(live(), before);
			const repeated = await confirm(done);
			assert.equal(repeated.commit, done.commit);
			assert.equal(head(), done.commit);
			timings.push({
				scenario:
					round === 1 ? "first publication" : "body and metadata update",
				previewMs: Math.round(prepared - start),
				confirmToPublishedMs: Math.round(published - prepared),
				includingHTTPVerificationMs: Math.round(performance.now() - start),
				timings: done.timings,
				commit: done.commit,
			});
		}
		await verifyExistingCudaImages();
		checks.push(
			"original three CUDA images return exact bytes before and after publishing",
		);
		checks.push(
			"two real HTTP preview/confirm flows and local Git pushes",
			"home/archive/article/feed/sitemap/media updated together",
			"versioned Pagefind bundles and old assets retained",
			"duplicate confirm blocked/idempotent",
			"draft data excluded",
		);
		// Actual Git remote rejects a push. Existing site stays live; saved commit is retried once.
		draft = store.update(draft.id, {
			...draft,
			body: draft.body + "\nretrytoken\n",
		});
		let job = await prepare(),
			oldHead = head(),
			oldLive = live();
		const hook = path.join(remote, "hooks/pre-receive");
		fs.writeFileSync(hook, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
		await confirm(job);
		let failed = await wait(job.id);
		assert.equal(failed.state, "retry");
		assert.equal(head(), oldHead);
		assert.equal(live(), oldLive);
		fs.unlinkSync(hook);
		manager = openPublications(args);
		await confirm(failed);
		let done = await wait(job.id);
		assert.equal(done.state, "published", JSON.stringify(done));
		assert.equal(done.commit, failed.commit);
		await verify(done, "retrytoken");
		checks.push(
			"real rejected push preserves site; manager restart retries same commit",
		);
		// Push succeeds but activation fails: retry must not make another Git commit.
		draft = store.update(draft.id, {
			...draft,
			body: draft.body + "\nactivationtoken\n",
		});
		job = await prepare();
		oldLive = live();
		failDeploy = true;
		await confirm(job);
		failed = await wait(job.id);
		assert.equal(failed.state, "retry");
		assert.equal(head(), failed.commit);
		assert.equal(live(), oldLive);
		failDeploy = false;
		manager = openPublications(args);
		await confirm(failed);
		done = await wait(job.id);
		assert.equal(done.state, "published");
		assert.equal(done.commit, failed.commit);
		await verify(done, "activationtoken");
		checks.push(
			"post-push activation failure preserves previous release; restart retry creates no extra commit",
		);
		// Edit the draft during candidate preparation: no commit and no activation.
		draft = store.update(draft.id, {
			...draft,
			body: draft.body + "\nnotyetpublished\n",
		});
		job = await prepare();
		oldHead = head();
		oldLive = live();
		editDuringBuild = () => {
			draft = store.update(draft.id, {
				...draft,
				body: draft.body + "\nconcurrentedit\n",
			});
		};
		await confirm(job);
		failed = await wait(job.id);
		assert.equal(failed.state, "failed");
		assert.equal(head(), oldHead);
		assert.equal(live(), oldLive);
		checks.push(
			"draft changes during candidate build block commit and activation",
		);
		// Move the real remote branch after preview; stale confirmation must fail closed.
		job = await prepare();
		const externalDir = path.join(root, "external");
		fs.mkdirSync(externalDir);
		const base = await driver.head(),
			externalWork = await driver.prepare(externalDir, base),
			file = "src/content/posts/external-runtime.md";
		fs.writeFileSync(
			path.join(externalWork, file),
			"---\ntitle: external\npublished: 2026-10-14\n---\nExternal commit\n",
		);
		const externalCommit = await driver.commit(
			externalWork,
			base,
			[file],
			"external-test",
		);
		await driver.push(externalCommit, base);
		await confirm(job);
		failed = await wait(job.id);
		assert.equal(failed.state, "failed");
		assert.equal(head(), externalCommit);
		assert.equal(live(), oldLive);
		checks.push("real concurrent remote commit rejects stale preview");

        const publicItems=manager.decorate(store.list());
        let organization=store.organization(publicItems);
        organization=store.editFolderOrganization({action:'create',parent:null,name:'公开整理验收',revision:organization.revision},publicItems);
        const folder=organization.folders.find(f=>f.name==='公开整理验收');
        organization=store.moveOrganization({kind:'article',id:'draft:'+draft.id,target:folder.id,revision:organization.revision},publicItems);
        const preparedDirectory=await request('/organization/publication',{revision:organization.revision});
        const directoryReady=await wait(preparedDirectory.id);
        assert.equal(directoryReady.state,'ready',JSON.stringify(directoryReady));
        assert.ok(!JSON.stringify(directoryReady.archiveRows).includes('PRIVATE UNSHARED DRAFT'));
        const previousBody=(await publicRead('/posts/writing/runtime-pipeline/')).text;
        const previousCommit=head(),directoryStart=performance.now();
        await confirm(directoryReady);
        const directoryDone=await wait(directoryReady.id);
        assert.equal(directoryDone.state,'published',JSON.stringify(directoryDone));
        const changed=git(['diff','--no-renames','--name-only','-z',previousCommit,directoryDone.commit]).split('\0');assert.ok(changed.includes('src/content/posts/writing/runtime-pipeline.md'));assert.ok(changed.includes('src/content/posts/公开整理验收/runtime-pipeline.md'));assert.ok(!git(['ls-tree','-r','--name-only',directoryDone.commit]).includes('src/content/posts/writing/runtime-pipeline.md'));
        const redirected=await fetch(origin+'/posts/writing/runtime-pipeline/?test=1',{redirect:'manual'});assert.equal(redirected.status,302);assert.match(redirected.headers.get('cache-control'),/no-store/);assert.equal(decodeURI(redirected.headers.get('location')),'/posts/公开整理验收/runtime-pipeline/?test=1');
        const archiveSnapshot=JSON.parse(fs.readFileSync(path.join(live(),'published.json'),'utf8'));
        const archived=archiveSnapshot.entries.find(e=>e.id==='公开整理验收/runtime-pipeline');
        assert.equal(archived.data.archivePath,'公开整理验收');
        assert.equal(archived.data.category,'公开整理验收');
        assert.ok(!archived.data.runtimeBody.includes('notyetpublished'));
        assert.ok((await publicRead('/archive/')).text.includes('公开整理验收'));
        const afterBody=(await publicRead('/posts/'+encodeURIComponent('公开整理验收')+'/runtime-pipeline/')).text;
        assert.ok(afterBody.includes('activationtoken'));assert.ok(!afterBody.includes('concurrentedit'));
        const movedImage=await fetch(origin+parse(afterBody).querySelector('img[alt="pipeline image"]').getAttribute('src'));assert.deepEqual(Buffer.from(await movedImage.arrayBuffer()),imageBytes);
        await verifyExistingCudaImages();
        assert.equal(await driver.head(),directoryDone.commit,'manifest changes must be allowed by deployed code baseline');
        assert.ok(!directoryDone.timings.some(t=>['icons','site'].includes(t.stage)));
        timings.push({scenario:'directory publication',confirmToPublishedMs:Math.round(performance.now()-directoryStart),timings:directoryDone.timings,commit:directoryDone.commit});
        checks.push('real directory move, old URL redirects, draft body excluded and image bytes preserved');
        draft=store.get(draft.id);
        let currentOrg=store.organization(manager.decorate(store.list()));
        currentOrg=store.moveOrganization({revision:currentOrg.revision,kind:'article',id:'draft:'+draft.id,target:writing},manager.decorate(store.list()));
        const moveBack=await prepare();await confirm(moveBack);const movedBack=await wait(moveBack.id);assert.equal(movedBack.state,'published',JSON.stringify(movedBack));
        const oldChinese=await fetch(origin+'/posts/'+encodeURIComponent('公开整理验收')+'/runtime-pipeline/',{redirect:'manual'});assert.equal(oldChinese.status,302);assert.equal(oldChinese.headers.get('location'),'/posts/writing/runtime-pipeline/');
        assert.ok((await publicRead('/posts/writing/runtime-pipeline/')).text.includes('concurrentedit'));
        checks.push('single publication includes own body and desired move; reversible aliases do not loop');

        // A published Chinese filename and a private sibling travel with their folder.
        // Only the public version is included when applying the directory change.
        const allItems = () => manager.decorate(store.list());
        const newFolder = (name, parent) => {
            const state = store.organization(allItems());
            const next = store.editFolderOrganization({revision:state.revision, action:'create', name, parent}, allItems());
            return next.folders.find(f => f.name === name && f.parent === parent).id;
        };
        const chineseParent = newFolder('中文验收', null);
        const chineseChild = newFolder('嵌套目录', chineseParent);
        let chinese = store.create({title:'标题可以不同于文件名', body:'chinesepublicbody\n\n![pipeline image]('+media.url+')', category:'', tags:'', organization:{revision:store.organization(allItems()).revision, target:chineseChild}}, allItems());
        const privateSibling = store.create({title:'PRIVATE FOLDER SIBLING', body:'folderprivatesecret', category:'', tags:'', organization:{revision:store.organization(allItems()).revision, target:chineseChild}}, allItems());
        async function publishChinese() {
            chinese = store.get(chinese.id);
            const job = await request('/drafts/'+chinese.id+'/publication', {revision:chinese.revision, filename:'第一篇中文文章.md', published:'2026-10-17', description:'目录联动验收'});
            const ready = await wait(job.id);
            assert.equal(ready.state,'ready',JSON.stringify(ready));
            await confirm(ready);
            const done = await wait(job.id);
            assert.equal(done.state,'published',JSON.stringify(done));
            assert.equal(head(),done.commit);
            return done;
        }
        await publishChinese();
        const originalChinesePath = '中文验收/嵌套目录/第一篇中文文章.md';
        const finalChinesePath = '公开整理验收/'+originalChinesePath;
        const articleUrl = file => '/posts/'+file.slice(0,-3).split('/').map(encodeURIComponent).join('/')+'/';
        const unchangedHead = head(), unchangedLive = live();
        chinese = store.get(chinese.id);
        chinese = store.update(chinese.id, {...chinese, body:chinese.body+'\nnewprivatebody'});
        const privateBody = chinese.body;
        let folderState = store.organization(allItems());
        const moveParent = () => store.moveOrganization({revision:folderState.revision, kind:'folder', id:chineseParent, target:folder.id}, allItems());
        folderState = moveParent();
        assert.equal(manager.info(chinese.id).path,finalChinesePath);
        folderState = store.undoOrganization({revision:folderState.revision, token:folderState.undoToken}, allItems());
        assert.equal(manager.info(chinese.id).path,originalChinesePath);
        folderState = moveParent();
        assert.equal(head(),unchangedHead,'workbench move and undo must not commit');
        assert.equal(live(),unchangedLive,'workbench move and undo must not activate');
        const folderJob = await request('/organization/publication',{revision:folderState.revision});
        const folderReady = await wait(folderJob.id);
        assert.equal(folderReady.state,'ready',JSON.stringify(folderReady));
        assert.ok(!JSON.stringify(folderReady.archiveRows).includes(privateSibling.title));
        await confirm(folderReady);
        const folderDone = await wait(folderJob.id);
        assert.equal(folderDone.state,'published',JSON.stringify(folderDone));
        assert.equal(head(),folderDone.commit);
        const tracked = git(['ls-tree','-r','--name-only','-z',folderDone.commit]).split('\0');
        assert.ok(tracked.includes('src/content/posts/'+finalChinesePath));
        assert.ok(!tracked.includes('src/content/posts/'+originalChinesePath));
        const movedChinese = await publicRead(articleUrl(finalChinesePath));
        assert.ok(movedChinese.text.includes(chinese.title));
        assert.ok(movedChinese.text.includes('chinesepublicbody'));
        assert.ok(!movedChinese.text.includes('newprivatebody'));
        const redirectChinese = await fetch(origin+articleUrl(originalChinesePath),{redirect:'manual'});
        assert.equal(redirectChinese.status,302);
        assert.equal(redirectChinese.headers.get('location'),articleUrl(finalChinesePath));
        assert.match(redirectChinese.headers.get('cache-control'),/no-store/);
        const folderSnapshot = JSON.parse(fs.readFileSync(path.join(live(),'published.json'),'utf8'));
        const chineseEntry = folderSnapshot.entries.find(e=>e.id === finalChinesePath.slice(0,-3));
        assert.equal(chineseEntry.data.category,'公开整理验收/中文验收/嵌套目录');
        assert.ok(!JSON.stringify(folderSnapshot).includes('folderprivatesecret'));
        assert.equal(store.get(chinese.id).body,privateBody,'directory apply must preserve private edits');
        assert.equal(store.get(privateSibling.id).body,privateSibling.body);
        const chineseImage = await fetch(origin+parse(movedChinese.text).querySelector('img[alt="pipeline image"]').getAttribute('src'));
        assert.equal(chineseImage.status,200);
        assert.deepEqual(Buffer.from(await chineseImage.arrayBuffer()),imageBytes);
        const bodyUpdate = await publishChinese();
        assert.equal(bodyUpdate.path,finalChinesePath,'body-only update stays in the current folder');
        assert.ok((await publicRead(articleUrl(finalChinesePath))).text.includes('newprivatebody'));
        const bodyDiff = git(['diff','--name-only','-z',folderDone.commit,bodyUpdate.commit]).split('\0').filter(Boolean);
        assert.ok(bodyDiff.includes('src/content/posts/'+finalChinesePath));
        const ownAssets = 'src/content/posts/'+path.posix.dirname(finalChinesePath)+'/assets/第一篇中文文章/';
        assert.ok(bodyDiff.every(file=>!file.startsWith('src/content/posts/') || file === 'src/content/posts/'+finalChinesePath || file.startsWith(ownAssets)));
        for (const file of bodyDiff.filter(file=>file.startsWith(ownAssets))) {
            assert.deepEqual(execFileSync('git',['show',bodyUpdate.commit+':'+file],{cwd:remote}),imageBytes,'relocated own attachment must retain its bytes');
        }
        checks.push('Chinese filename differs from title; nested folder move and undo stay private until applied; public path/category/image/redirect agree; private sibling and body edits excluded; subsequent body-only update keeps new folder');
		assert.equal(fingerprint(), builtHash);
		assert.equal(git(["status", "--porcelain"]), "");
		const report = {
			isolated: true,
			origin,
			buildMs,
			buildCount: 1,
			compiledHashUnchanged: true,
			measurements: timings,
			checks,
			limitations: [
				"local bare remote, not GitHub network",
				"no production CDN; HTML/manifest use no-store",
				"runtime mode rejects published MDX/encrypted posts/automatic OG images",
				"media kept original; not a load test",
			],
		};
		fs.writeFileSync(
			path.join(root, "pipeline-results.json"),
			JSON.stringify(report, null, 2),
		);
		console.log(JSON.stringify(report, null, 2));
		if (process.argv.includes("--serve"))
			await new Promise((resolve) => process.once("SIGTERM", resolve));
	} finally {
		await new Promise((resolve) => api.close(resolve));
		store.close();
		server.kill();
		fs.closeSync(log);
		await closeRuntimeIndexer();
	}
}

await runPipeline();
