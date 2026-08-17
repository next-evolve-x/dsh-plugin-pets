/**
 * dsh-pets — Codex-style pets for the DeepSeek Harness web app.
 *
 * Host half of the plugin. Manages pet packages sourced from the public
 * codex-pets.net gallery: downloads the install zip (pet.json +
 * spritesheet.webp), caches it under `$DSH_HOME/storages/pets/<id>/`, and
 * exposes everything to the browser half through same-origin HTTP routes on
 * the web server:
 *
 *   GET  /pets/api/state           installed pets + settings
 *   POST /pets/api/state           persist a settings merge patch
 *   GET  /pets/api/gallery         codex-pets.net gallery (scraped, cached)
 *   POST /pets/api/install         { slug } → download + cache + activate
 *   POST /pets/api/remove          { id } → drop the cached pet
 *   GET  /pets/assets/<id>/<file>  cached spritesheet / pet.json / meta.json
 *
 * No authentication: the route prefix is only reachable while the web server
 * is bound, and the default bind is loopback. Path components are validated
 * against strict patterns and containment is re-checked after resolution, so
 * nothing outside the pets root can be addressed.
 */
import { mkdir, readFile, writeFile, readdir, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import { inflateRawSync } from "node:zlib";

export const name = "dsh-pets";
export const inject = ["webServer"];

const GALLERY_URL = "https://codexpets.net/";
const DOWNLOAD_PREFIX = "https://codexpets.net/api/gallery-pets/";
const USER_AGENT = "dsh-pets/0.1.2 (+deepseek-harness plugin)";
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/i;
const ID_RE = /^[a-z0-9][a-z0-9._-]*$/i;
const FILE_RE = /^[A-Za-z0-9._-]+$/;
const GALLERY_TTL_MS = 10 * 60 * 1000;
const INSTALL_TIMEOUT_MS = 30 * 1000;

/** Resolve the harness home the same way the app does: DSH_HOME → ~/.dsh. */
function resolveHome() {
	const fromEnv = process.env.DSH_HOME;
	if (fromEnv !== void 0 && fromEnv.trim().length > 0) return resolve(fromEnv.trim());
	return join(homedir(), ".dsh");
}

/** Default plugin root: $DSH_HOME/storages/pets. */
function defaultRoot() {
	return join(resolveHome(), "storages", "pets");
}

// ── minimal ZIP reader (store + deflate, central-directory based) ──────────

/**
 * Parse a ZIP archive into `{ name: Buffer }` for its file entries. Supports
 * method 0 (store) and 8 (deflate); anything else throws. Reads through the
 * central directory so data-descriptor entries (flag bit 3) work too.
 */
export function parseZip(buf) {
	let eocd = -1;
	const from = Math.max(0, buf.length - 22 - 65536);
	for (let i = buf.length - 22; i >= from; i--) {
		if (buf.readUInt32LE(i) === 0x06054b50) {
			eocd = i;
			break;
		}
	}
	if (eocd < 0) throw new Error("zip: end-of-central-directory not found");
	const count = buf.readUInt16LE(eocd + 10);
	let off = buf.readUInt32LE(eocd + 16);
	const entries = {};
	for (let i = 0; i < count; i++) {
		if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error("zip: malformed central directory entry");
		const method = buf.readUInt16LE(off + 10);
		const compressedSize = buf.readUInt32LE(off + 20);
		const uncompressedSize = buf.readUInt32LE(off + 24);
		const nameLength = buf.readUInt16LE(off + 28);
		const extraLength = buf.readUInt16LE(off + 30);
		const commentLength = buf.readUInt16LE(off + 32);
		const localOffset = buf.readUInt32LE(off + 42);
		const entryName = buf.toString("utf8", off + 46, off + 46 + nameLength);
		const localNameLength = buf.readUInt16LE(localOffset + 26);
		const localExtraLength = buf.readUInt16LE(localOffset + 28);
		const dataStart = localOffset + 30 + localNameLength + localExtraLength;
		let data = buf.subarray(dataStart, dataStart + compressedSize);
		if (method === 8) {
			data = inflateRawSync(data);
		} else if (method !== 0) {
			throw new Error(`zip: unsupported compression method ${method} for "${entryName}"`);
		}
		entries[entryName] = Buffer.from(data.subarray(0, uncompressedSize));
		off += 46 + nameLength + extraLength + commentLength;
	}
	return entries;
}

// ── codex-pets.net gallery scraping ─────────────────────────────────────────

/** Find the end offset of the JSON object starting at `start` (a `{`). */
function findObjectEnd(text, start) {
	let depth = 0;
	let inString = false;
	let escaped = false;
	for (let i = start; i < text.length; i++) {
		const ch = text[i];
		if (inString) {
			if (escaped) escaped = false;
			else if (ch === "\\") escaped = true;
			else if (ch === '"') inString = false;
		} else if (ch === '"') {
			inString = true;
		} else if (ch === "{") {
			depth++;
		} else if (ch === "}") {
			depth--;
			if (depth === 0) return i + 1;
		}
	}
	return -1;
}

/**
 * Decode the Next.js flight payload (`self.__next_f.push([1,"…"])` script
 * tags) back into readable text. The gallery objects arrive JSON-string
 * escaped inside these pushes, so a literal `{"key":` scan finds nothing
 * without this step. Concatenating the decoded pushes in order reconstructs
 * the full payload; unparseable pushes are skipped.
 */
export function decodeNextFlight(html) {
	const out = [];
	const pattern = /self\.__next_f\.push\(\[1,("[^]*?")\]\)/g;
	let match;
	while ((match = pattern.exec(html)) !== null) {
		try {
			out.push(JSON.parse(match[1]));
		} catch {
			/* skip malformed pushes */
		}
	}
	return out.join("");
}

/**
 * Extract gallery items from the codex-pets.net homepage HTML. The Next.js
 * RSC payload embeds one JSON object per pet (`key`, `slug`, `name`,
 * `description`, `tags`, `contributorName`, `spritesheetUrl`,
 * `previewFrames`, `downloadHref`, `downloadFilename`, …). Scanning for
 * `{"key":` and parsing balanced objects keeps the parser independent of
 * field order; items that fail to parse or lack a download href are skipped.
 */
export function extractGallery(html) {
	const items = [];
	const seen = new Set();
	let cursor = 0;
	while (true) {
		const start = html.indexOf('{"key":', cursor);
		if (start < 0) break;
		const end = findObjectEnd(html, start);
		if (end < 0) break;
		cursor = end;
		let obj;
		try {
			obj = JSON.parse(html.slice(start, end));
		} catch {
			continue;
		}
		if (obj === null || typeof obj !== "object") continue;
		if (typeof obj.slug !== "string" || typeof obj.downloadHref !== "string") continue;
		if (!obj.downloadHref.includes("/api/gallery-pets/")) continue;
		if (seen.has(obj.slug)) continue;
		seen.add(obj.slug);
		items.push({
			slug: obj.slug,
			name: typeof obj.name === "string" ? obj.name : obj.slug,
			description: typeof obj.description === "string" ? obj.description : "",
			tags: Array.isArray(obj.tags) ? obj.tags.filter((t) => typeof t === "string") : [],
			contributorName: typeof obj.contributorName === "string" ? obj.contributorName : "",
			spritesheetUrl: typeof obj.spritesheetUrl === "string" ? obj.spritesheetUrl : "",
			previewFrames: typeof obj.previewFrames === "number" ? obj.previewFrames : 8,
			downloadHref: obj.downloadHref,
			downloadFilename: typeof obj.downloadFilename === "string" ? obj.downloadFilename : `${obj.slug}.zip`
		});
	}
	return items;
}

// ── pets store ──────────────────────────────────────────────────────────────

const DEFAULT_STATE = {
	activeId: null,
	hidden: false,
	scale: 1,
	idleRow: null,
	position: { x: 24, y: 120 }
};

class PetsStore {
	constructor(root) {
		this.root = root;
		this.galleryCache = { items: null, fetchedAt: 0 };
	}

	statePath() {
		return join(this.root, "state.json");
	}

	galleryPath() {
		return join(this.root, "gallery.json");
	}

	async loadState() {
		try {
			const raw = await readFile(this.statePath(), "utf8");
			const parsed = JSON.parse(raw);
			return { ...DEFAULT_STATE, ...parsed, position: { ...DEFAULT_STATE.position, ...(parsed?.position ?? {}) } };
		} catch {
			return { ...DEFAULT_STATE, position: { ...DEFAULT_STATE.position } };
		}
	}

	async saveState(state) {
		await mkdir(this.root, { recursive: true });
		await writeFile(this.statePath(), JSON.stringify(state, null, 2), "utf8");
	}

	/** Read one pet dir's manifest: pet.json merged with our meta.json. */
	async manifestOf(id) {
		const dir = this.petDir(id);
		let pet = null;
		try {
			pet = JSON.parse(await readFile(join(dir, "pet.json"), "utf8"));
		} catch {
			return null;
		}
		let meta = null;
		try {
			meta = JSON.parse(await readFile(join(dir, "meta.json"), "utf8"));
		} catch {
			/* no meta (legacy install) */
		}
		return {
			id,
			slug: meta?.slug ?? pet.id ?? id,
			displayName: pet.displayName ?? meta?.name ?? pet.id ?? id,
			description: pet.description ?? meta?.description ?? "",
			spritesheetPath: pet.spritesheetPath ?? "spritesheet.webp",
			kind: pet.kind ?? "object",
			tags: meta?.tags ?? [],
			contributorName: meta?.contributorName ?? "",
			previewFrames: meta?.previewFrames ?? 8,
			installedAt: meta?.installedAt ?? 0
		};
	}

	async listInstalled() {
		let names = [];
		try {
			names = await readdir(this.root, { withFileTypes: true });
		} catch {
			return [];
		}
		const manifests = [];
		for (const entry of names) {
			if (!entry.isDirectory() || !ID_RE.test(entry.name)) continue;
			const manifest = await this.manifestOf(entry.name);
			if (manifest !== null) manifests.push(manifest);
		}
		manifests.sort((a, b) => a.displayName.localeCompare(b.displayName));
		return manifests;
	}

	petDir(id) {
		return join(this.root, id);
	}

	async assetFile(id, file) {
		if (!ID_RE.test(id)) throw Object.assign(new Error("invalid pet id"), { status: 400 });
		if (!FILE_RE.test(file)) throw Object.assign(new Error("invalid asset name"), { status: 400 });
		const dir = await this.petDir(id);
		const target = resolve(dir, file);
		const root = resolve(this.root);
		if (target !== root && !target.startsWith(root + sep)) throw Object.assign(new Error("path escapes pets root"), { status: 400 });
		try {
			const info = await stat(target);
			if (!info.isFile()) throw Object.assign(new Error("not a file"), { status: 404 });
			return target;
		} catch (error) {
			if (error?.status === 404) throw error;
			throw Object.assign(new Error("asset not found"), { status: 404 });
		}
	}

	async install(slug) {
		if (!SLUG_RE.test(slug)) throw Object.assign(new Error("invalid slug"), { status: 400 });
		const existing = await this.manifestOf(slug);
		if (existing !== null) return existing;
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), INSTALL_TIMEOUT_MS);
		let response;
		try {
			response = await fetch(`${DOWNLOAD_PREFIX}${slug}/download`, {
				headers: { "user-agent": USER_AGENT },
				signal: controller.signal,
				redirect: "follow"
			});
		} catch (error) {
			throw Object.assign(new Error(`download failed: ${error instanceof Error ? error.message : String(error)}`), { status: 502 });
		} finally {
			clearTimeout(timer);
		}
		if (!response.ok) throw Object.assign(new Error(`codex-pets.net answered ${response.status}`), { status: 502 });
		const buffer = Buffer.from(await response.arrayBuffer());
		let entries;
		try {
			entries = parseZip(buffer);
		} catch (error) {
			throw Object.assign(new Error(`package is not a readable zip: ${error instanceof Error ? error.message : String(error)}`), { status: 502 });
		}
		let pet = null;
		for (const candidate of ["pet.json", "Pet.json", "./pet.json"]) {
			if (entries[candidate] !== void 0) {
				try {
					pet = JSON.parse(entries[candidate].toString("utf8"));
				} catch {
					throw Object.assign(new Error("pet.json is not valid JSON"), { status: 502 });
				}
				break;
			}
		}
		if (pet === null) throw Object.assign(new Error("package has no pet.json"), { status: 502 });
		const spritesheetPath = typeof pet.spritesheetPath === "string" && pet.spritesheetPath.length > 0 ? pet.spritesheetPath : "spritesheet.webp";
		const base = spritesheetPath.split(/[\\/]/).pop();
		if (!FILE_RE.test(base)) throw Object.assign(new Error("unsafe spritesheetPath"), { status: 502 });
		const sprite = entries[spritesheetPath] ?? entries[base] ?? entries[`./${base}`];
		if (sprite === void 0) throw Object.assign(new Error(`package has no "${spritesheetPath}"`), { status: 502 });
		const id = pet.id !== void 0 && typeof pet.id === "string" && ID_RE.test(pet.id) ? pet.id : slug;
		const dir = this.petDir(id);
		await mkdir(dir, { recursive: true });
		await writeFile(join(dir, "pet.json"), JSON.stringify(pet, null, 2), "utf8");
		await writeFile(join(dir, base), sprite);
		const meta = {
			slug,
			name: pet.displayName ?? slug,
			description: pet.description ?? "",
			tags: [],
			contributorName: "",
			previewFrames: 8,
			installedAt: Date.now()
		};
		await writeFile(join(dir, "meta.json"), JSON.stringify(meta, null, 2), "utf8");
		return this.manifestOf(id);
	}

	async remove(id) {
		if (!ID_RE.test(id)) throw Object.assign(new Error("invalid pet id"), { status: 400 });
		const dir = this.petDir(id);
		try {
			await rm(dir, { recursive: true, force: true });
		} catch {
			/* already gone */
		}
		const state = await this.loadState();
		if (state.activeId === id) {
			state.activeId = null;
			await this.saveState(state);
		}
		return id;
	}

	async gallery(force = false) {
		const now = Date.now();
		if (!force && this.galleryCache.items !== null && now - this.galleryCache.fetchedAt < GALLERY_TTL_MS) {
			return { items: this.galleryCache.items, fetchedAt: this.galleryCache.fetchedAt, source: "memory" };
		}
		let response;
		try {
			response = await fetch(GALLERY_URL, { headers: { "user-agent": USER_AGENT }, redirect: "follow" });
		} catch (error) {
			// fall back to the on-disk cache, then to the in-memory copy
			return this.galleryFallback(now, error);
		}
		if (!response.ok) return this.galleryFallback(now, new Error(`codex-pets.net answered ${response.status}`));
		const html = await response.text();
		let items = extractGallery(html);
		if (items.length === 0) {
			// the site sometimes ships the payload JSON-string escaped inside
			// __next_f.push scripts — decode that layer and re-scan
			const decoded = decodeNextFlight(html);
			if (decoded.length > 0) items = extractGallery(decoded);
		}
		if (items.length === 0) return this.galleryFallback(now, new Error("no gallery items parsed"));
		this.galleryCache = { items, fetchedAt: now };
		await mkdir(this.root, { recursive: true });
		try {
			await writeFile(this.galleryPath(), JSON.stringify({ items, fetchedAt: now }), "utf8");
		} catch {
			/* cache write is best-effort */
		}
		return { items, fetchedAt: now, source: "live" };
	}

	async galleryFallback(now, cause) {
		try {
			const raw = await readFile(this.galleryPath(), "utf8");
			const parsed = JSON.parse(raw);
			if (Array.isArray(parsed.items) && parsed.items.length > 0) {
				this.galleryCache = { items: parsed.items, fetchedAt: parsed.fetchedAt ?? 0 };
				return { items: parsed.items, fetchedAt: parsed.fetchedAt ?? 0, source: "disk", fallback: true };
			}
		} catch {
			/* no disk cache */
		}
		if (this.galleryCache.items !== null) return { items: this.galleryCache.items, fetchedAt: this.galleryCache.fetchedAt, source: "memory", fallback: true };
		throw Object.assign(new Error(`gallery unavailable: ${cause instanceof Error ? cause.message : String(cause)}`), { status: 502 });
	}
}

// ── HTTP helpers ────────────────────────────────────────────────────────────

const MIME_BY_EXT = {
	".webp": "image/webp",
	".png": "image/png",
	".gif": "image/gif",
	".json": "application/json; charset=utf-8"
};

function sendJson(res, status, body) {
	const payload = JSON.stringify(body);
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"content-length": Buffer.byteLength(payload),
		"cache-control": "no-store"
	});
	res.end(payload);
}

function sendError(res, error) {
	const status = typeof error?.status === "number" ? error.status : 500;
	if (status >= 500) console.error("[dsh-pets]", error);
	sendJson(res, status, { error: error instanceof Error ? error.message : String(error) });
}

function readBody(req) {
	return new Promise((resolvePromise, reject) => {
		const chunks = [];
		let size = 0;
		req.on("data", (chunk) => {
			size += chunk.length;
			if (size > 1 << 20) {
				reject(Object.assign(new Error("body too large"), { status: 413 }));
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => {
			try {
				resolvePromise(chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
			} catch {
				reject(Object.assign(new Error("body is not valid JSON"), { status: 400 }));
			}
		});
		req.on("error", reject);
	});
}

async function sendFile(res, path, ext) {
	try {
		const body = await readFile(path);
		res.writeHead(200, {
			"content-type": MIME_BY_EXT[ext] ?? "application/octet-stream",
			"content-length": body.length,
			"cache-control": "private, max-age=3600"
		});
		res.end(body);
	} catch {
		sendJson(res, 404, { error: "asset not found" });
	}
}

// ── plugin body ─────────────────────────────────────────────────────────────

export function apply(ctx, config = {}) {
	const root = config.root ?? defaultRoot();
	const store = new PetsStore(root);

	ctx.effect(async () => {
		await mkdir(root, { recursive: true });

		const disposeAssets = ctx.webServer.register({
			kind: "prefix",
			path: "/pets/assets",
			handler: async (req, res) => {
				if (req.method !== "GET" && req.method !== "HEAD") {
					res.writeHead(405);
					res.end();
					return;
				}
				const pathname = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
				const rest = pathname.slice("/pets/assets/".length).split("/");
				if (rest.length !== 2 || rest[0].length === 0 || rest[1].length === 0) {
					sendJson(res, 404, { error: "not found" });
					return;
				}
				try {
					const [id, file] = rest;
					const path = await store.assetFile(id, file);
					const ext = file.slice(file.lastIndexOf(".")).toLowerCase();
					if (req.method === "HEAD") {
						res.writeHead(200, { "content-type": MIME_BY_EXT[ext] ?? "application/octet-stream" });
						res.end();
						return;
					}
					await sendFile(res, path, ext);
				} catch (error) {
					sendError(res, error);
				}
			}
		});

		const disposeApi = ctx.webServer.register({
			kind: "prefix",
			path: "/pets/api",
			handler: async (req, res) => {
				const pathname = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
				const route = pathname.slice("/pets/api".length) || "/";
				try {
					if (route === "/state" && (req.method === "GET" || req.method === "HEAD")) {
						const [state, pets] = await Promise.all([store.loadState(), store.listInstalled()]);
						sendJson(res, 200, { ...state, pets });
						return;
					}
					if (route === "/state" && req.method === "POST") {
						const patch = await readBody(req);
						const state = await store.loadState();
						if (typeof patch.activeId === "string" || patch.activeId === null) state.activeId = patch.activeId;
						if (typeof patch.hidden === "boolean") state.hidden = patch.hidden;
						if (typeof patch.scale === "number" && Number.isFinite(patch.scale)) state.scale = Math.min(6, Math.max(0.25, patch.scale));
						if (patch.idleRow === null || (typeof patch.idleRow === "number" && Number.isInteger(patch.idleRow))) state.idleRow = patch.idleRow;
						if (patch.position && typeof patch.position === "object") {
							const x = patch.position.x;
							const y = patch.position.y;
							if (typeof x === "number" && Number.isFinite(x) && typeof y === "number" && Number.isFinite(y)) {
								state.position = { x: Math.round(x), y: Math.round(y) };
							}
						}
						await store.saveState(state);
						const pets = await store.listInstalled();
						sendJson(res, 200, { ...state, pets });
						return;
					}
					if (route === "/gallery" && (req.method === "GET" || req.method === "HEAD")) {
						const force = new URL(req.url ?? "/", "http://x").searchParams.get("refresh") === "1";
						const gallery = await store.gallery(force);
						sendJson(res, 200, gallery);
						return;
					}
					if (route === "/install" && req.method === "POST") {
						const body = await readBody(req);
						if (typeof body.slug !== "string") throw Object.assign(new Error("missing slug"), { status: 400 });
						const manifest = await store.install(body.slug.trim().toLowerCase());
						const state = await store.loadState();
						state.activeId = manifest.id;
						await store.saveState(state);
						sendJson(res, 200, { manifest, activeId: manifest.id });
						return;
					}
					if (route === "/remove" && req.method === "POST") {
						const body = await readBody(req);
						if (typeof body.id !== "string") throw Object.assign(new Error("missing id"), { status: 400 });
						await store.remove(body.id);
						const state = await store.loadState();
						const pets = await store.listInstalled();
						sendJson(res, 200, { removed: body.id, activeId: state.activeId, pets });
						return;
					}
					sendJson(res, 404, { error: `no route ${req.method} ${route}` });
				} catch (error) {
					sendError(res, error);
				}
			}
		});

		return () => {
			disposeAssets();
			disposeApi();
		};
	}, "dsh-pets: routes");
}

export default { name, inject, apply };
export { PetsStore };
