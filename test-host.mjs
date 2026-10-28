// Standalone smoke test for the dsh-pets host half (no cordis needed).
// Fixtures are downloaded from the live gallery, so this run needs network
// access and nothing pre-staged on disk.
import { parseZip, extractGallery, decodeNextFlight, PetsStore } from "./lib/index.js";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const GALLERY_URL = "https://codexpets.net/";
const DOWNLOAD_PREFIX = "https://codexpets.net/api/gallery-pets/";
const USER_AGENT = "dsh-pets/0.2.0 (+deepseek-harness plugin, smoke test)";
const SLUG = process.env.PETS_TEST_SLUG ?? "agumon";

let failures = 0;
function check(name, cond, extra = "") {
	if (cond) console.log(`  ok  ${name}`);
	else {
		failures++;
		console.error(`FAIL  ${name} ${extra}`);
	}
}

async function get(url) {
	const response = await fetch(url, { headers: { "user-agent": USER_AGENT }, redirect: "follow" });
	if (!response.ok) throw new Error(`${url}: ${response.status}`);
	return response;
}

console.log("== fixtures ==");
const zip = Buffer.from(await (await get(`${DOWNLOAD_PREFIX}${SLUG}/download`)).arrayBuffer());
const html = await (await get(GALLERY_URL)).text();
check("pet package downloaded", zip.length > 1024, `${zip.length} bytes`);
check("gallery html downloaded", html.length > 1024, `${html.length} bytes`);

console.log("== parseZip ==");
const entries = parseZip(zip);
check("package has pet.json", entries["pet.json"] !== void 0);
check("package has spritesheet.webp", entries["spritesheet.webp"] !== void 0);
const pet = JSON.parse(entries["pet.json"].toString("utf8"));
check("pet.json parses", typeof pet.id === "string" && pet.id.length > 0, JSON.stringify(pet));
check("spritesheet is webp", entries["spritesheet.webp"].subarray(0, 4).toString() === "RIFF");

console.log("== extractGallery ==");
let gallery = extractGallery(html);
if (gallery.length === 0) gallery = extractGallery(decodeNextFlight(html));
check("gallery parsed", gallery.length > 500, `count=${gallery.length}`);
if (gallery.length > 0) {
	const entry = gallery.find((g) => g.slug === SLUG);
	check("fixture slug present", entry !== void 0, JSON.stringify(entry));
	check("entry has name", typeof entry?.name === "string" && entry.name.length > 0, JSON.stringify(entry?.name));
	check("entry has download href", typeof entry?.downloadHref === "string" && entry.downloadHref.includes("/api/gallery-pets/"));
	const slugs = new Set(gallery.map((g) => g.slug));
	check("slugs unique", slugs.size === gallery.length);
}

console.log("== PetsStore.install (live network) ==");
const root = await mkdtemp(join(tmpdir(), "dsh-pets-test-"));
const store = new PetsStore(root);
try {
	const manifest = await store.install(SLUG);
	check("install returns manifest", manifest.id === SLUG, JSON.stringify(manifest));
	check("manifest has displayName", typeof manifest.displayName === "string" && manifest.displayName.length > 0);
	const assets = await store.listInstalled();
	check("listInstalled sees it", assets.length === 1 && assets[0].id === SLUG);
	const asset = await store.assetFile(SLUG, "spritesheet.webp");
	check("asset resolves", asset.endsWith("spritesheet.webp"));
	let traversalBlocked = true;
	try {
		await store.assetFile(SLUG, "../../state.json");
		traversalBlocked = false;
	} catch {
		/* expected */
	}
	check("path traversal blocked", traversalBlocked);
	// idempotent reinstall
	const again = await store.install(SLUG);
	check("reinstall idempotent", again.id === SLUG);
	// state round trip
	await store.saveState({ activeId: SLUG, scale: 1.5, idleRow: 2, position: { x: 10, y: 20 } });
	const state = await store.loadState();
	check("state round trip", state.activeId === SLUG && state.scale === 1.5 && state.idleRow === 2 && state.position.x === 10);
	await store.remove(SLUG);
	const after = await store.listInstalled();
	check("remove works", after.length === 0);
	check("remove clears active", (await store.loadState()).activeId === null);
} catch (error) {
	failures++;
	console.error("FAIL install flow:", error);
}
await rm(root, { recursive: true, force: true });

console.log("== gallery() live fetch ==");
const store2 = new PetsStore(await mkdtemp(join(tmpdir(), "dsh-pets-test2-")));
try {
	const result = await store2.gallery();
	check("gallery() fetches live", result.items.length > 500, `source=${result.source} count=${result.items.length}`);
} catch (error) {
	failures++;
	console.error("FAIL gallery fetch:", error);
}
await rm(store2.root, { recursive: true, force: true });

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
