/**
 * dsh-pets — browser half.
 *
 * Single-file classic-script bundle in the DSH client-module format:
 * `window.__ModuleLoader__.load({ id, factory })`. The factory is CJS-shaped
 * and receives the module-table `require` (seed words like `react` and
 * `react/jsx-runtime` resolve from the page; nothing else is required at
 * runtime — services arrive through the exported cordis `inject` list).
 *
 * The component registers into the `shell.overlay` root slot: a frame-wide,
 * click-through floating layer. The pet is a fixed-position, draggable
 * canvas sprite animated from the installed spritesheet (8 columns × 9 rows
 * of cells per the Codex Pet spritesheet spec), with mood rows derived from
 * live row occupancy and from session/job activity:
 *
 *   idle     — agent idle (first non-empty row)
 *   working  — session running or a live background job
 *   happy    — a job just completed
 *   sad      — a job just failed
 *
 * The shop panel browses the codex-pets.net gallery through the host routes
 * (`/pets/api/*`, `/pets/assets/<id>/<file>`).
 */
window.__ModuleLoader__.load({
	id: "dsh-pets",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const React = require("react");
		const { useState, useEffect, useRef, useMemo, useCallback } = React;
		const r = require("react/jsx-runtime");
		const Fragment = r.Fragment;
		/**
		 * jsx helpers that accept children as trailing arguments (the raw
		 * jsx-runtime signature is `jsx(type, props, key)` — children must live
		 * inside props, so callers passing `h(type, props, a, b, c)` need this
		 * wrap). One child is forwarded directly; several are bundled into an
		 * array, matching JSX semantics.
		 */
		const h = (type, props, ...rest) => r.jsx(type, rest.length === 0
			? (props ?? {})
			: { ...(props ?? {}), children: rest.length === 1 ? rest[0] : rest });
		const hs = (type, props, ...rest) => r.jsxs(type, rest.length === 0
			? (props ?? {})
			: { ...(props ?? {}), children: rest.length === 1 ? rest[0] : rest });

		// ── styles (claimed by the module system's style bookkeeping) ────────
		const CSS_ID = "dsh-pets/style";
		if (typeof document !== "undefined" && document.querySelector(`style[data-plugin-css="${CSS_ID}"]`) === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-pets";
			tag.dataset.pluginCss = CSS_ID;
			tag.textContent = `
.dsp-root{position:fixed;inset:0;pointer-events:none;z-index:9999;font-family:var(--dsw-font-ui,system-ui,-apple-system,sans-serif)}
.dsp-pet{position:absolute;pointer-events:auto;cursor:grab;user-select:none;touch-action:none;filter:drop-shadow(0 4px 10px rgba(0,0,0,.35))}
.dsp-pet:active{cursor:grabbing}
.dsp-pet canvas{display:block;image-rendering:pixelated;pointer-events:none}
.dsp-bubble{position:absolute;left:50%;bottom:calc(100% + 8px);transform:translateX(-50%);background:var(--dsw-specific-menu,#fff);color:var(--dsw-alias-label-primary,#222);border:1px solid var(--dsw-alias-border-l2,#ddd);border-radius:10px;padding:3px 10px;font-size:12px;line-height:18px;white-space:nowrap;box-shadow:var(--dsw-shadow-lv3,0 4px 16px rgba(0,0,0,.18));animation:dsp-pop .18s ease-out}
@keyframes dsp-pop{from{opacity:0;transform:translateX(-50%) translateY(4px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
.dsp-chip{position:absolute;pointer-events:auto;cursor:pointer;width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:18px;background:var(--dsw-specific-menu,#fff);border:1px solid var(--dsw-alias-border-l2,#ddd);box-shadow:var(--dsw-shadow-lv3,0 4px 16px rgba(0,0,0,.18));color:var(--dsw-alias-label-primary,#222)}
.dsp-menu{position:absolute;right:0;bottom:calc(100% + 12px);width:340px;max-width:min(420px,calc(100vw - 32px));max-height:min(600px,calc(100vh - 40px));overflow:auto;background:var(--dsw-specific-menu,#fff);color:var(--dsw-alias-label-primary,#222);border:1px solid var(--dsw-alias-border-l2,#ddd);border-radius:14px;box-shadow:var(--dsw-shadow-lv3,0 8px 28px rgba(0,0,0,.22));pointer-events:auto;font-size:13px;line-height:18px;animation:dsp-pop .16s ease-out}
.dsp-menu-head{padding:10px 12px;border-bottom:1px solid var(--dsw-alias-border-l2,#ddd)}
.dsp-menu-head h3{margin:0;font-size:14px;line-height:20px;color:var(--dsw-alias-label-primary,#222)}
.dsp-menu-head p{margin:2px 0 0;font-size:12px;color:var(--dsw-alias-label-tertiary,#888)}
.dsp-section{padding:10px 12px;border-bottom:1px solid var(--dsw-alias-border-l2,#eee)}
.dsp-section h4{margin:0 0 6px;font-size:12px;line-height:16px;text-transform:uppercase;letter-spacing:.04em;color:var(--dsw-alias-label-tertiary,#888)}
.dsp-row{display:flex;align-items:center;gap:8px;margin:4px 0}
.dsp-label{flex:none;width:64px;font-size:12px;color:var(--dsw-alias-label-secondary,#555)}
.dsp-preview{width:64px;height:64px;flex:none;border:1px solid var(--dsw-alias-border-l2,#ddd);border-radius:8px;background:repeating-conic-gradient(#f3f3f3 0 25%,#fff 0 50%) 0 0/12px 12px;overflow:hidden}
.dsp-preview canvas{width:100%;height:100%;image-rendering:pixelated}
.dsp-rowbtns{display:flex;gap:4px;flex-wrap:wrap}
.dsp-rowbtn{min-width:26px;height:24px;padding:0 5px;border:1px solid var(--dsw-alias-border-l2,#ddd);border-radius:6px;background:var(--dsw-alias-fill-l2,#f5f5f5);color:var(--dsw-alias-label-secondary,#555);font-size:11px;cursor:pointer}
.dsp-rowbtn[data-active="true"]{background:var(--dsw-alias-accent,#4a6cf7);border-color:transparent;color:#fff}
.dsp-range{flex:1;accent-color:var(--dsw-alias-accent,#4a6cf7)}
.dsp-btn{height:26px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2,#ddd);border-radius:7px;background:var(--dsw-alias-fill-l2,#f5f5f5);color:var(--dsw-alias-label-primary,#222);font-size:12px;cursor:pointer;flex:none}
.dsp-btn:hover{filter:brightness(.97)}
.dsp-btn[data-primary="true"]{background:var(--dsw-alias-accent,#4a6cf7);border-color:transparent;color:#fff}
.dsp-btn:disabled{opacity:.5;cursor:default}
.dsp-search{width:100%;box-sizing:border-box;height:30px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2,#ddd);border-radius:8px;background:var(--dsw-alias-fill-l1,#fff);color:var(--dsw-alias-label-primary,#222);font-size:13px}
.dsp-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:6px}
.dsp-item{border:1px solid var(--dsw-alias-border-l2,#eee);border-radius:10px;padding:8px;display:flex;flex-direction:column;gap:6px;background:var(--dsw-alias-fill-l1,#fff)}
.dsp-item b{font-size:12px;line-height:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsp-item small{font-size:11px;color:var(--dsw-alias-label-tertiary,#888);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsp-tags{display:flex;gap:3px;flex-wrap:wrap}
.dsp-tag{font-size:10px;line-height:14px;padding:0 5px;border-radius:4px;background:var(--dsw-alias-fill-l2,#f0f0f0);color:var(--dsw-alias-label-secondary,#666)}
.dsp-empty{padding:18px 12px;text-align:center;color:var(--dsw-alias-label-tertiary,#888)}
.dsp-error{color:#c33;font-size:12px;padding:4px 0}
.dsp-note{font-size:11px;color:var(--dsw-alias-label-tertiary,#888)}
.dsp-list{margin-top:4px;display:flex;flex-direction:column;gap:4px}
.dsp-installed{display:flex;align-items:center;gap:8px;border:1px solid var(--dsw-alias-border-l2,#eee);border-radius:8px;padding:6px 8px}
.dsp-installed b{flex:1;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsp-installed[data-active="true"]{border-color:var(--dsw-alias-accent,#4a6cf7)}
.dsp-thumb{width:64px;height:64px;flex:none;margin:0 auto;border:1px solid var(--dsw-alias-border-l2,#eee);border-radius:8px;background:repeating-conic-gradient(#f3f3f3 0 25%,#fff 0 50%) 0 0/12px 12px;overflow:hidden;position:relative}
.dsp-thumb img{display:block;position:absolute;top:0;left:0;image-rendering:pixelated}
.dsp-thumb canvas{width:100%;height:100%;image-rendering:pixelated}
.dsp-thumb-fallback{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:22px;opacity:.5}
.dsp-mini{width:34px;height:34px;flex:none;border:1px solid var(--dsw-alias-border-l2,#eee);border-radius:6px;background:repeating-conic-gradient(#f3f3f3 0 25%,#fff 0 50%) 0 0/12px 12px;overflow:hidden}
.dsp-mini canvas{width:100%;height:100%;image-rendering:pixelated}
`;
			document.head.appendChild(tag);
		}

		// ── small helpers ────────────────────────────────────────────────────
		const EMPTY_JOBS = [];
		const NO_PETS = [];

		async function api(path, body) {
			const res = await fetch(path, body === void 0
				? undefined
				: { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
			if (!res.ok) {
				let message = `${path}: ${res.status}`;
				try {
					const parsed = await res.json();
					if (parsed?.error) message = parsed.error;
				} catch {
					/* keep status message */
				}
				throw new Error(message);
			}
			return res.json();
		}

		function debounce(fn, ms) {
			let timer = null;
			const wrapped = (...args) => {
				if (timer !== null) clearTimeout(timer);
				timer = setTimeout(() => {
					timer = null;
					fn(...args);
				}, ms);
			};
			wrapped.flush = () => {
				if (timer !== null) {
					clearTimeout(timer);
					timer = null;
					fn();
				}
			};
			return wrapped;
		}

		// ── spritesheet rendering ────────────────────────────────────────────
		const COLS = 8;
		const ROWS = 9;
		const FPS_BY_MOOD = { idle: 4, working: 10, happy: 12, sad: 6 };

		/**
		 * Sheet analysis: draw the whole spritesheet once and scan it for
		 * non-transparent pixels, returning:
		 *   rows    – ordered indices of rows that contain any content
		 *   content – boolean[ROWS][COLS] per-cell content flags, used to skip
		 *             empty frames during animation (many sheets pad their rows
		 *             with blank cells, which otherwise flash as gaps).
		 */
		function detectSheet(img) {
			const w = img.naturalWidth;
			const h = img.naturalHeight;
			const canvas = document.createElement("canvas");
			canvas.width = w;
			canvas.height = h;
			const ctx = canvas.getContext("2d", { willReadFrequently: true });
			ctx.drawImage(img, 0, 0);
			const data = ctx.getImageData(0, 0, w, h).data;
			const content = [];
			const rows = [];
			for (let row = 0; row < ROWS; row++) {
				const cells = [];
				let rowHas = false;
				for (let col = 0; col < COLS; col++) {
					let has = false;
					const x0 = Math.round((col * w) / COLS);
					const y0 = Math.round((row * h) / ROWS);
					const x1 = Math.round(((col + 1) * w) / COLS);
					const y1 = Math.round(((row + 1) * h) / ROWS);
					for (let y = y0; y < y1 && !has; y += 2) {
						const base = y * w;
						for (let x = x0; x < x1 && !has; x += 2) {
							if (data[(base + x) * 4 + 3] > 8) has = true;
						}
					}
					cells.push(has);
					if (has) rowHas = true;
				}
				content.push(cells);
				if (rowHas) rows.push(row);
			}
			return { rows, content };
		}

		function PetSprite({ petId, file, mood, scale, idleRow, onRows, preview = false, width, height }) {
			const canvasRef = useRef(null);
			const imgRef = useRef(null);
			const [dims, setDims] = useState(null);
			const [rows, setRows] = useState(null);
			const [content, setContent] = useState(null);

			useEffect(() => {
				let alive = true;
				const img = new Image();
				img.src = `/pets/assets/${encodeURIComponent(petId)}/${encodeURIComponent(file)}`;
				img.onload = () => {
					if (!alive) return;
					setDims({ w: img.naturalWidth, h: img.naturalHeight });
					let detected = null;
					try {
						detected = detectSheet(img);
					} catch {
						detected = null;
					}
					const occupied = detected !== null && detected.rows.length > 0 ? detected.rows : [0, 1, 2, 3];
					setRows(occupied);
					setContent(detected !== null ? detected.content : null);
					onRows?.(occupied);
				};
				img.onerror = () => {
					if (!alive) return;
					setDims(null);
				};
				imgRef.current = img;
				return () => {
					alive = false;
				};
			}, [petId, file, onRows]);

			const fps = preview ? 8 : FPS_BY_MOOD[mood] ?? 6;
			const row = useMemo(() => {
				if (rows === null) return idleRow ?? 0;
				const nonEmpty = rows;
				let idle = idleRow ?? nonEmpty[0] ?? 0;
				const rest = nonEmpty.filter((r) => r !== idle);
				if (preview) return idle;
				if (mood === "idle") return idle;
				if (mood === "working") return rest[0] ?? idle;
				if (mood === "happy") return rest[1] ?? rest[0] ?? idle;
				if (mood === "sad") return rest[2] ?? rest[0] ?? idle;
				return idle;
			}, [rows, idleRow, mood, preview]);

			// Only cycle through cells of the active row that actually contain
			// pixels; blank padding cells would otherwise render as a blink.
			const frames = useMemo(() => {
				const cols = [];
				const cells = content?.[row];
				for (let c = 0; c < COLS; c++) if (cells?.[c]) cols.push(c);
				return cols.length > 0 ? cols : [0];
			}, [content, row]);

			useEffect(() => {
				if (dims === null || rows === null) return;
				const canvas = canvasRef.current;
				if (canvas === null) return;
				const ctx = canvas.getContext("2d");
				const fw = dims.w / COLS;
				const fh = dims.h / ROWS;
				canvas.width = Math.max(1, Math.round(fw));
				canvas.height = Math.max(1, Math.round(fh));
				const frameMs = Math.max(40, 1000 / fps);
				let frame = 0;
				let raf = 0;
				let last = 0;
				const tick = (ts) => {
					raf = requestAnimationFrame(tick);
					if (ts - last < frameMs) return;
					last = ts;
					ctx.clearRect(0, 0, canvas.width, canvas.height);
					ctx.drawImage(imgRef.current, Math.round(frames[frame] * fw), Math.round(row * fh), fw, fh, 0, 0, canvas.width, canvas.height);
					frame = (frame + 1) % frames.length;
				};
				raf = requestAnimationFrame(tick);
				return () => cancelAnimationFrame(raf);
			}, [dims, rows, row, fps, frames]);

			const displayWidth = width ?? Math.round((dims ? dims.w / COLS : 96) * scale * 0.5);
			const displayHeight = height ?? Math.round((dims ? dims.h / ROWS : 96) * scale * 0.5);
			return h("canvas", {
				ref: canvasRef,
				width: 8,
				height: 8,
				style: preview ? { width: "100%", height: "100%" } : { width: displayWidth, height: displayHeight }
			});
		}

		/**
		 * Static shop thumbnail for a pet that is NOT installed yet: loads the
		 * spritesheet straight from its gallery URL (codex-pets.net serves the
		 * sheet without CORS headers, so pixel-level row detection is
		 * unavailable — we show the top-left cell, i.e. row 0 / frame 0, which
		 * is the spec's idle frame). `loading="lazy"` keeps the grid from
		 * fetching every sheet at once; once the pet is adopted, the card
		 * switches to the same-origin animated {@link PetSprite} instead.
		 */
		function SpriteThumb({ src, alt = "", size = 64 }) {
			const [dims, setDims] = useState(null);
			const [failed, setFailed] = useState(false);

			const onLoad = useCallback((event) => {
				const img = event.currentTarget;
				if (img.naturalWidth > 0 && img.naturalHeight > 0) setDims({ w: img.naturalWidth, h: img.naturalHeight });
			}, []);
			const onError = useCallback(() => setFailed(true), []);

			if (failed) return h("div", { className: "dsp-thumb-fallback", role: "img", "aria-label": alt }, "🐾");
			const k = dims === null ? 0 : Math.min(size / (dims.w / COLS), size / (dims.h / ROWS));
			return h("img", {
				src,
				alt,
				loading: "lazy",
				decoding: "async",
				onLoad,
				onError,
				style: dims === null
					? { visibility: "hidden" }
					: {
						width: Math.max(1, Math.round(dims.w * k)),
						height: Math.max(1, Math.round(dims.h * k))
					}
			});
		}

		// ── main overlay ─────────────────────────────────────────────────────
		const MOOD_TEXT = {
			idle: "mood.idle",
			working: "mood.working",
			happy: "mood.happy",
			sad: "mood.sad"
		};

		function PetsOverlay({ useSessions, t }) {
			const [state, setState] = useState(null);
			const [stateError, setStateError] = useState(null);
			const [menuOpen, setMenuOpen] = useState(false);
			const [gallery, setGallery] = useState(null);
			const [galleryBusy, setGalleryBusy] = useState(false);
			const [installing, setInstalling] = useState({});
			const [installError, setInstallError] = useState(null);
			const [previewRow, setPreviewRow] = useState(null);
			const [rows, setRows] = useState(null);
			const [flash, setFlash] = useState(null);
			const [draftPosition, setDraftPosition] = useState(null);

			const current = useSessions((s) => s.current);
			const summary = useSessions((s) => s.byId[s.current]);
			const jobs = useSessions((s) => s.jobsBySession[s.current]);
			const liveJobs = useMemo(
				() => (jobs ?? EMPTY_JOBS).filter((j) => j.status === "running" || j.status === "stopping"),
				[jobs]
			);
			const working = summary?.running === true || liveJobs.length > 0;

			const refreshState = useCallback(async () => {
				const next = await api("/pets/api/state");
				setState(next);
				setStateError(null);
				return next;
			}, []);
			const refreshStateRef = useRef(refreshState);
			refreshStateRef.current = refreshState;

			useEffect(() => {
				let alive = true;
				api("/pets/api/state")
					.then((next) => {
						if (alive) {
							setState(next);
							setStateError(null);
						}
					})
					.catch((error) => {
						if (alive) setStateError(error instanceof Error ? error.message : String(error));
					});
				return () => {
					alive = false;
				};
			}, []);

			// job status transitions → one-shot happy/sad flash
			const prevJobsRef = useRef(null);
			useEffect(() => {
				const prev = prevJobsRef.current;
				prevJobsRef.current = jobs ?? EMPTY_JOBS;
				if (prev === null || !jobs) return;
				const prevByKey = new Map(prev.map((j) => [j.id, j]));
				for (const job of jobs) {
					const before = prevByKey.get(job.id);
					if (!before || before.status === job.status) continue;
					const wasLive = before.status === "running" || before.status === "stopping";
					if (wasLive && (job.status === "completed" || job.status === "killed")) {
						setFlash({ mood: "happy", at: Date.now() });
					} else if (wasLive && job.status === "failed") {
						setFlash({ mood: "sad", at: Date.now() });
					}
				}
			}, [jobs]);

			useEffect(() => {
				if (flash === null) return;
				const timer = setTimeout(() => setFlash(null), 5000);
				return () => clearTimeout(timer);
			}, [flash]);

			// close the menu on outside pointerdown
			const menuRootRef = useRef(null);
			useEffect(() => {
				if (!menuOpen) return;
				const close = (event) => {
					if (menuRootRef.current !== null && event.target instanceof Node && !menuRootRef.current.contains(event.target)) {
						setMenuOpen(false);
					}
				};
				document.addEventListener("pointerdown", close);
				return () => document.removeEventListener("pointerdown", close);
			}, [menuOpen]);

			const persistPosition = useMemo(() => debounce((position) => {
				api("/pets/api/state", { position }).catch(() => {
					/* best-effort position persistence */
				});
			}, 400), []);

			// drag
			const dragRef = useRef(null);
			const suppressClickRef = useRef(false);
			const position = draftPosition ?? state?.position ?? { x: 24, y: 120 };
			const onPointerDown = useCallback((event) => {
				if (event.button !== 0) return;
				const el = event.currentTarget;
				try {
					el.setPointerCapture(event.pointerId);
				} catch {
					/* older engines */
				}
				suppressClickRef.current = false;
				dragRef.current = { px: event.clientX, py: event.clientY, x: position.x, y: position.y, moved: 0 };
			}, [position]);
			const onPointerMove = useCallback((event) => {
				const drag = dragRef.current;
				if (drag === null) return;
				const nx = drag.x - (event.clientX - drag.px);
				const ny = drag.y - (event.clientY - drag.py);
				if (drag.lastX !== void 0) drag.moved += Math.abs(event.clientX - drag.lastX) + Math.abs(event.clientY - drag.lastY);
				drag.lastX = event.clientX;
				drag.lastY = event.clientY;
				if (drag.moved > 4) suppressClickRef.current = true;
				setDraftPosition({ x: nx, y: ny });
			}, []);
			const onPointerUp = useCallback(() => {
				if (dragRef.current === null) return;
				dragRef.current = null;
				if (draftPosition !== null) {
					const next = { ...draftPosition };
					setDraftPosition(null);
					setState((prev) => (prev === null ? prev : { ...prev, position: next }));
					persistPosition(next);
				}
			}, [draftPosition, persistPosition]);
			const onPetClick = useCallback(() => {
				if (suppressClickRef.current) {
					suppressClickRef.current = false;
					return;
				}
				setMenuOpen((open) => !open);
				if (gallery === null && !galleryBusy) {
					setGalleryBusy(true);
					api("/pets/api/gallery")
						.then((result) => setGallery(result.items ?? []))
						.catch(() => setGallery([]))
						.finally(() => setGalleryBusy(false));
				}
			}, [gallery, galleryBusy]);

			const openMenu = useCallback(() => {
				setMenuOpen(true);
				if (gallery === null && !galleryBusy) {
					setGalleryBusy(true);
					api("/pets/api/gallery")
						.then((result) => setGallery(result.items ?? []))
						.catch(() => setGallery([]))
						.finally(() => setGalleryBusy(false));
				}
			}, [gallery, galleryBusy]);

			const install = useCallback(async (slug) => {
				setInstalling((prev) => ({ ...prev, [slug]: true }));
				setInstallError(null);
				try {
					await api("/pets/api/install", { slug });
					await refreshState();
				} catch (error) {
					setInstallError(error instanceof Error ? error.message : String(error));
				} finally {
					setInstalling((prev) => ({ ...prev, [slug]: false }));
				}
			}, [refreshState]);

			const handleRows = useCallback((occupied) => {
				setRows((prev) => (prev === null || prev.join(",") !== occupied.join(",") ? occupied : prev));
			}, []);

			const activate = useCallback(async (id) => {
				try {
					await api("/pets/api/state", { activeId: id });
					await refreshState();
				} catch {
					/* keep current */
				}
			}, [refreshState]);

			const remove = useCallback(async (id) => {
				try {
					const result = await api("/pets/api/remove", { id });
					setState((prev) => (prev === null ? prev : { ...prev, activeId: result.activeId, pets: result.pets }));
				} catch {
					/* keep list */
				}
			}, []);

			const patchSettings = useCallback((patch) => {
				setState((prev) => (prev === null ? prev : { ...prev, ...patch }));
				api("/pets/api/state", patch).catch(() => {
					/* optimistic write; host is source of truth on reload */
				});
			}, []);

			if (stateError !== null) {
				return h("div", { className: "dsp-root" },
					h("div", { className: "dsp-chip", style: { right: 24, bottom: 24 }, title: stateError, onClick: openMenu }, "🐾")
				);
			}
			if (state === null) return null;

			const pets = state.pets ?? NO_PETS;
			const active = pets.find((p) => p.id === state.activeId) ?? pets[0] ?? null;
			const mood = flash?.mood ?? (working ? "working" : "idle");
			const scale = state.scale ?? 1;
			const idleRow = state.idleRow;

			const petNode = active === null
				? h("div", {
					className: "dsp-chip",
					style: { right: position.x, bottom: position.y },
					title: t("adopt.title"),
					onClick: openMenu
				}, "🐾")
				: h("div", {
					className: "dsp-pet",
					style: { right: position.x, bottom: position.y },
					onPointerDown: onPointerDown,
					onPointerMove: onPointerMove,
					onPointerUp: onPointerUp,
					onClick: onPetClick,
					title: `${active.displayName} — ${t("drag.hint")}`
				}, [
					h(PetSprite, {
						key: active.id,
						petId: active.id,
						file: active.spritesheetPath,
						mood,
						scale,
						idleRow,
						onRows: handleRows
					}),
					mood !== "idle" && h("div", { className: "dsp-bubble" }, t(MOOD_TEXT[mood]))
				]);

			return h("div", { className: "dsp-root" }, [
				petNode,
				menuOpen && h("div", { ref: menuRootRef, className: "dsp-menu", style: { right: position.x, bottom: position.y + (active === null ? 0 : 72) } },
					h("div", { className: "dsp-menu-head" },
						h("h3", null, active === null ? t("title.empty") : active.displayName),
						active !== null && h("p", null, active.description || t("no.description"))
					),
					active !== null && h("div", { className: "dsp-section" },
						h("h4", null, t("preview.title")),
						h("div", { className: "dsp-row" },
							h("div", { className: "dsp-preview" },
								h(PetSprite, { petId: active.id, file: active.spritesheetPath, mood: "idle", scale: 1, idleRow: previewRow ?? idleRow, preview: true, width: 64, height: 64 })
							),
							h("div", { className: "dsp-rowbtns", role: "group" },
								Array.from({ length: ROWS }, (_, row) => h("button", {
									key: row,
									className: "dsp-rowbtn",
									"data-active": String((previewRow ?? idleRow) === row),
									onClick: () => setPreviewRow(row)
								}, String(row)))
							)
						),
						h("div", { className: "dsp-row" },
							h("span", { className: "dsp-label" }, t("scale.label")),
							h("input", {
								className: "dsp-range",
								type: "range",
								min: 0.5,
								max: 4,
								step: 0.1,
								value: scale,
								onChange: (event) => patchSettings({ scale: Number(event.target.value) })
							}),
							h("span", { className: "dsp-note" }, String(Math.round(scale * 100) / 100))
						),
						previewRow !== null && h("div", { className: "dsp-row" },
							h("button", { className: "dsp-btn", "data-primary": true, onClick: () => { patchSettings({ idleRow: previewRow }); setPreviewRow(null); } }, t("set.idle")),
							h("button", { className: "dsp-btn", onClick: () => setPreviewRow(null) }, t("cancel"))
						),
						rows !== null && h("div", { className: "dsp-note" }, `${t("rows.found")}: ${rows.join(", ")}`)
					),
					pets.length > 0 && h("div", { className: "dsp-section" },
						h("h4", null, t("installed.title")),
						h("div", { className: "dsp-list" },
							pets.map((pet) => h("div", {
								key: pet.id,
								className: "dsp-installed",
								"data-active": String(pet.id === active?.id)
							}, [
								h("div", { className: "dsp-mini" },
									h(PetSprite, { petId: pet.id, file: pet.spritesheetPath, mood: "idle", scale: 1, preview: true })
								),
								h("b", null, pet.displayName),
								h("button", { className: "dsp-btn", onClick: () => activate(pet.id) }, t("activate")),
								h("button", { className: "dsp-btn", onClick: () => remove(pet.id) }, t("remove"))
							]))
						)
					),
					h("div", { className: "dsp-section" },
						h("h4", null, t("shop.title")),
						installError !== null && h("div", { className: "dsp-error" }, installError),
						galleryBusy && gallery === null && h("div", { className: "dsp-empty" }, t("shop.loading")),
						gallery !== null && gallery.length === 0 && h("div", { className: "dsp-empty" }, t("shop.empty")),
						gallery !== null && gallery.length > 0 && h(ShopGrid, {
							t,
							gallery,
							pets,
							installing,
							install,
							activate
						})
					)
				)
			]);
		}

		function ShopGrid({ t, gallery, pets, installing, install, activate }) {
			const [query, setQuery] = useState("");
			const [limit, setLimit] = useState(60);
			const filtered = useMemo(() => {
				const q = query.trim().toLowerCase();
				if (q.length === 0) return gallery;
				return gallery.filter((item) =>
					item.slug.toLowerCase().includes(q) ||
					(item.name ?? "").toLowerCase().includes(q) ||
					(item.tags ?? []).some((tag) => tag.toLowerCase().includes(q))
				);
			}, [gallery, query]);
			const visible = filtered.slice(0, limit);
			return hs(Fragment, {
				children: [
					h("input", {
						className: "dsp-search",
						placeholder: t("shop.search"),
						value: query,
						onChange: (event) => { setQuery(event.target.value); setLimit(60); }
					}),
					h("div", { className: "dsp-grid" },
						visible.map((item) => {
							const installed = pets.find((p) => p.slug === item.slug || p.id === item.slug);
							const busy = installing[item.slug] === true;
							return h("div", { key: item.slug, className: "dsp-item" }, [
								h("div", { className: "dsp-thumb" },
									installed !== void 0
										? h(PetSprite, { petId: installed.id, file: installed.spritesheetPath, mood: "idle", scale: 1, preview: true, width: 64, height: 64 })
										: item.spritesheetUrl !== ""
											? h(SpriteThumb, { src: item.spritesheetUrl, alt: item.name ?? item.slug })
											: null
								),
								h("b", null, item.name ?? item.slug),
								item.contributorName !== "" && h("small", null, `@${item.contributorName}`),
								(item.tags ?? []).length > 0 && h("div", { className: "dsp-tags" },
									item.tags.slice(0, 4).map((tag) => h("span", { key: tag, className: "dsp-tag" }, tag))
								),
								installed !== void 0
									? h("button", { className: "dsp-btn", onClick: () => activate(installed.id) }, t("activate"))
									: h("button", {
										className: "dsp-btn",
										"data-primary": true,
										disabled: busy,
										onClick: () => install(item.slug)
									}, busy ? t("installing") : t("install"))
							]);
						})
					),
					filtered.length > limit && h("div", { className: "dsp-row", style: { justifyContent: "center" } },
						h("button", { className: "dsp-btn", onClick: () => setLimit((n) => n + 100) }, `${t("load.more")} (${filtered.length - limit})`)
					),
					h("div", { className: "dsp-note", style: { marginTop: 6 } }, `${t("shop.total")}: ${gallery.length} · ${t("shop.source")}`)
				]
			});
		}

		// ── plugin body ──────────────────────────────────────────────────────
		const inject = ["slots", "locale"];

		const zh = {
			"title.empty": "还没有宠物",
			"no.description": "来自 codex-pets.net 的宠物",
			"adopt.title": "领养一只宠物",
			"drag.hint": "拖动移动位置 · 点击打开宠物店",
			"mood.idle": "……",
			"mood.working": "工作中…",
			"mood.happy": "搞定！",
			"mood.sad": "出错了 😢",
			"preview.title": "动画预览与闲置行",
			"scale.label": "大小",
			"set.idle": "设为闲置行",
			"cancel": "取消",
			"rows.found": "检测到动画行",
			"installed.title": "已领养",
			"activate": "启用",
			"remove": "删除",
			"shop.title": "宠物商店（codex-pets.net）",
			"shop.loading": "正在加载商店…",
			"shop.empty": "商店暂时不可用",
			"shop.search": "搜索宠物（名称 / 标签）…",
			"install": "领养",
			"installing": "领养中…",
			"load.more": "加载更多",
			"shop.total": "共",
			"shop.source": "资源来自 codex-pets.net 公共图库"
		};

		const en = {
			"title.empty": "No pet yet",
			"no.description": "A pet from codex-pets.net",
			"adopt.title": "Adopt a pet",
			"drag.hint": "Drag to move · Click for the pet shop",
			"mood.idle": "……",
			"mood.working": "Working…",
			"mood.happy": "Done!",
			"mood.sad": "Something failed 😢",
			"preview.title": "Preview & idle row",
			"scale.label": "Size",
			"set.idle": "Set as idle row",
			"cancel": "Cancel",
			"rows.found": "Animated rows found",
			"installed.title": "Adopted",
			"activate": "Use",
			"remove": "Remove",
			"shop.title": "Pet shop (codex-pets.net)",
			"shop.loading": "Loading the shop…",
			"shop.empty": "The shop is unavailable right now",
			"shop.search": "Search pets (name / tag)…",
			"install": "Adopt",
			"installing": "Adopting…",
			"load.more": "Load more",
			"shop.total": "Total",
			"shop.source": "Pets from the public codex-pets.net gallery"
		};

		function apply(ctx) {
			ctx.effect(() => ctx.locale.register("pets", { zh, en }), "dsh-pets: dictionaries");
			ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "dsh-pets",
				order: 100,
				locale: "pets"
			}, PetsOverlay));
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
