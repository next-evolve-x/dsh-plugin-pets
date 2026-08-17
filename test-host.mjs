// Standalone smoke test for the dsh-pets host half (no cordis needed).
import { parseZip, extractGallery, decodeNextFlight, PetsStore } from "./lib/index.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

let failures = 0;
function check(name, cond, extra = "") {
	if (cond) console.log(`  ok  ${name}`);
	else {
		failures++;
		console.error(`FAIL  ${name} ${extra}`);
	}
}

console.log("== parseZip ==");
const zip = await readFile("/tmp/agumon.zip");
const entries = parseZip(zip);
check("agumon zip has pet.json", entries["pet.json"] !== void 0);
check("agumon zip has spritesheet.webp", entries["spritesheet.webp"] !== void 0);
const pet = JSON.parse(entries["pet.json"].toString("utf8"));
check("pet.json parses", pet.id === "agumon", JSON.stringify(pet));
check("spritesheet is webp", entries["spritesheet.webp"].subarray(0, 4).toString() === "RIFF");

console.log("== extractGallery ==");
const html = await readFile("/tmp/codexpets_fresh.html", "utf8");
let gallery = extractGallery(html);
if (gallery.length === 0) gallery = extractGallery(decodeNextFlight(html));
check("gallery parsed", gallery.length > 500, `count=${gallery.length}`);
if (gallery.length > 0) {
	const agumon = gallery.find((g) => g.slug === "agumon");
	check("agumon entry present", agumon !== void 0, JSON.stringify(agumon));
	check("entry has name", typeof agumon?.name === "string" && agumon.name.length > 0, JSON.stringify(agumon?.name));
	check("entry has download href", typeof agumon?.downloadHref === "string" && agumon.downloadHref.includes("/api/gallery-pets/"));
	const slugs = new Set(gallery.map((g) => g.slug));
	check("slugs unique", slugs.size === gallery.length);
}

console.log("== PetsStore.install (live network) ==");
const root = await mkdtemp(join(tmpdir(), "dsh-pets-test-"));
const store = new PetsStore(root);
try {
	const manifest = await store.install("agumon");
	check("install returns manifest", manifest.id === "agumon", JSON.stringify(manifest));
	check("manifest has displayName", typeof manifest.displayName === "string" && manifest.displayName.length > 0);
	const assets = await store.listInstalled();
	check("listInstalled sees it", assets.length === 1 && assets[0].id === "agumon");
	const asset = await store.assetFile("agumon", "spritesheet.webp");
	check("asset resolves", asset.endsWith("spritesheet.webp"));
	let traversalBlocked = true;
	try {
		await store.assetFile("agumon", "../../state.json");
		traversalBlocked = false;
	} catch {
		/* expected */
	}
	check("path traversal blocked", traversalBlocked);
	// idempotent reinstall
	const again = await store.install("agumon");
	check("reinstall idempotent", again.id === "agumon");
	// state round trip
	await store.saveState({ activeId: "agumon", scale: 1.5, idleRow: 2, position: { x: 10, y: 20 } });
	const state = await store.loadState();
	check("state round trip", state.activeId === "agumon" && state.scale === 1.5 && state.idleRow === 2 && state.position.x === 10);
	await store.remove("agumon");
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
