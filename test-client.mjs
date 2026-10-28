// Client-bundle smoke test: materialize the factory in Node with stubbed
// require/window, run apply() against a fake ctx, and SSR-render the overlay
// for both session-catalog generations (0.1.x inline rosters and 0.2.x seats)
// to catch runtime errors without a browser.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));

/**
 * Load the React the harness page actually ships. `react` and `react-dom` must
 * come from one installation: this machine carries a stray React 18 copy, and
 * mixing element `$$typeof` markers across instances breaks SSR with
 * "Objects are not valid as a React child". Anchor on the resolved react-dom
 * package so the pair always matches.
 */
function loadHarnessReact() {
	const dshHome = process.env.DSH_HOME ?? `${process.env.HOME}/.dsh`;
	const bases = [
		`${here}package.json`,
		`${dshHome}/profiles/web/package.json`,
		`${dshHome}/profiles/node_modules/react/package.json`,
		`${process.env.HOME}/node_modules/react/package.json`
	];
	const errors = [];
	for (const base of bases) {
		try {
			const domPkg = createRequire(base).resolve("react-dom/package.json");
			const anchor = createRequire(domPkg);
			const react = anchor("react");
			return {
				require: anchor,
				react,
				jsxRuntime: anchor("react/jsx-runtime"),
				server: anchor("react-dom/server")
			};
		} catch (error) {
			errors.push(`${base}: ${error.message}`);
		}
	}
	throw new Error(`cannot resolve the harness react pair for the smoke test\n${errors.join("\n")}`);
}

const harness = loadHarnessReact();
const code = readFileSync(`${here}lib/client.js`, "utf8");

let failures = 0;
function check(name, cond, extra = "") {
	if (cond) console.log(`  ok  ${name}`);
	else {
		failures++;
		console.error(`FAIL  ${name} ${extra}`);
	}
}

// evaluate the bundle with a window sink that captures the handoff
let handoff = null;
globalThis.window = { __ModuleLoader__: { load: (h) => { handoff = h; } } };
globalThis.document = {
	querySelector: () => null,
	createElement: (tag) => ({ dataset: {}, style: {}, appendChild() {}, set textContent(v) { this._text = v; } }),
	head: { appendChild() {} }
};
(0, eval)(code); // indirect eval → runs in global scope, sees globalThis.window
check("factory registered", handoff !== null && typeof handoff.factory === "function", String(handoff?.id));
check("id is dsh-pets", handoff?.id === "dsh-pets");

// materialize: call the factory with a require that resolves react seeds
const seedMap = new Map([
	["react", harness.react],
	["react/jsx-runtime", harness.jsxRuntime]
]);
const exportsObj = handoff.factory((spec) => {
	if (seedMap.has(spec)) return seedMap.get(spec);
	throw new Error(`unexpected require: ${spec}`);
});
check("factory exports inject", Array.isArray(exportsObj.inject), JSON.stringify(exportsObj.inject));
check("factory exports apply", typeof exportsObj.apply === "function");
check("inject services", exportsObj.inject.join(",") === "slots,locale", exportsObj.inject.join(","));

// apply() with a fake ctx — no `jobs` service, i.e. the smallest composition
const fakeCtx = {
	effect(fn) { return fn(); },
	locale: { register(ns, dicts) { this.last = { ns, dicts }; } },
	slots: {
		inject(key, cb) {
			check("slots.inject key is shell.overlay", key === "shell.overlay", key);
			cb();
		},
		register(opts, component) {
			check("register name shell.overlay", opts.name === "shell.overlay", JSON.stringify(opts));
			check("register id dsh-pets", opts.id === "dsh-pets", opts.id);
			check("register has locale", opts.locale === "pets", opts.locale);
			check("register has inject face", typeof opts.inject === "function", typeof opts.inject);
			const face = opts.inject();
			check("inject face is inert without a jobs service", face !== null && Object.keys(face).length === 0, JSON.stringify(face));
			this.lastComponent = component;
		}
	}
};
exportsObj.apply(fakeCtx);
check("locale registered pets ns", fakeCtx.locale.last?.ns === "pets", fakeCtx.locale.last?.ns);
check("zh dict populated", Object.keys(fakeCtx.locale.last?.dicts?.zh ?? {}).length > 10);

// the jobs service, when present, contributes the roster hook and the watcher
const jobsCtx = {
	effect(fn) { return fn(); },
	locale: { register() {} },
	get(name) {
		if (name !== "jobs") return void 0;
		return {
			state: { getSnapshot: () => ({ rows: {}, observed: {} }), subscribe: () => () => {} },
			watchRows: () => () => {}
		};
	},
	slots: {
		inject(_key, cb) { cb(); },
		register(opts) {
			const face = opts.inject();
			check("jobs face carries the roster hook", typeof face.hooks?.jobs === "object", JSON.stringify(Object.keys(face)));
			check("jobs face carries watchRows", typeof face.watchRows === "function", typeof face.watchRows);
		}
	}
};
exportsObj.apply(jobsCtx);

const Component = fakeCtx.slots.lastComponent;
check("component captured", typeof Component === "function");

// SSR render the overlay with stub seats for both catalog generations. The
// component returns null until its state fetch resolves (effects never run in
// SSR), so these renders prove what matters: no seat shape throws while
// rendering an overlay entry.
if (typeof Component === "function") {
	const React = harness.react;
	const ReactDOMServer = harness.server;
	const t = (key) => key;
	const render = (label, props) => {
		try {
			const html = ReactDOMServer.renderToString(React.createElement(Component, props));
			check(`SSR render ok (${label})`, typeof html === "string", html.slice(0, 160));
		} catch (error) {
			failures++;
			console.error(`FAIL SSR render (${label}):`, error);
		}
	};

	// 0.1.x: the catalog owns the selected session and the inline job rosters
	render("0.1.x catalog", {
		useSessions: (sel) => sel({ byId: {}, current: undefined, jobsBySession: {} }),
		t
	});

	// 0.2.x: `current`/`jobsBySession` are gone; status and rosters are seats
	render("0.2.x seats", {
		useSessions: (sel) => sel({ ids: ["s1"], byId: { s1: { id: "s1", running: true, retainedBy: { mainView: 1 } } }, phase: "ready" }),
		useSessionStatus: (sel) => sel(new Map([["s1", { running: true, completionUnread: false, pendingInteraction: false }]])),
		useJobs: (sel) => sel({ rows: { s1: [{ id: "job-1", status: "running" }] }, observed: {} }),
		watchRows: () => () => {},
		t
	});

	// a catalog that reports no session at all must not throw either
	render("empty catalog", {
		useSessions: (sel) => sel({ ids: [], byId: {}, phase: "pending" }),
		useSessionStatus: (sel) => sel(new Map()),
		useJobs: (sel) => sel({ rows: {}, observed: {} }),
		t
	});
}

// The compatibility layer is exactly what broke on the 0.2 client: assert its
// reads against both catalog shapes and against junk.
const compat = exportsObj.__compat ?? {};
check("__compat exported", typeof compat.activeSessionIdOf === "function");
if (typeof compat.activeSessionIdOf === "function") {
	check("0.1.x current wins", compat.activeSessionIdOf({ current: "s1", byId: { s2: {} } }) === "s1");
	check("0.2.x main view wins", compat.activeSessionIdOf({ byId: { s2: { running: true }, s1: { retainedBy: { mainView: 1 } } } }) === "s1");
	check("0.2.x running fallback", compat.activeSessionIdOf({ byId: { s2: { running: true } } }) === "s2");
	check("idle catalog has no session", compat.activeSessionIdOf({ byId: { s1: { retainedBy: { mainView: 0 } } } }) === void 0);
	check("junk snapshot is inert", compat.activeSessionIdOf(void 0) === void 0 && compat.activeSessionIdOf(null) === void 0);
	check("0.1.x inline rosters detected", compat.hasInlineJobs({ jobsBySession: {} }) === true);
	check("0.2.x catalog has no inline rosters", compat.hasInlineJobs({ ids: [], byId: {} }) === false);
	check("inline roster read", compat.inlineJobsOf({ jobsBySession: { s1: [{ id: "j" }] } }, "s1").length === 1);
	check("service roster read", compat.serviceJobsOf({ rows: { s1: [{ id: "j" }] } }, "s1").length === 1);
	check("missing rosters are empty", compat.inlineJobsOf({}, "s1").length === 0 && compat.serviceJobsOf({}, "s1").length === 0);
	check("undefined session is empty", compat.inlineJobsOf({ jobsBySession: { s1: [1] } }, void 0).length === 0);
	check("running sessions counted from a Map", compat.countRunning(new Map([["a", { running: true }], ["b", { running: false }]])) === 1);
	check("running sessions counted from an object", compat.countRunning({ a: { running: true }, b: { running: true } }) === 2);
	check("running count tolerates junk", compat.countRunning(void 0) === 0);
	check("session running follows the catalog", compat.sessionRunning({ current: "s1", byId: { s1: { running: true } } }) === true);
	check("live job statuses", compat.isLiveJob({ status: "running" }) && compat.isLiveJob({ status: "stopping" }) && !compat.isLiveJob({ status: "completed" }) && !compat.isLiveJob(void 0));
}

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
