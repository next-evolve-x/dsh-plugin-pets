// Client-bundle smoke test: materialize the factory in Node with stubbed
// require/window, run apply() against a fake ctx, and SSR-render the overlay
// to catch runtime errors without a browser.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire("/Users/evanx/.dsh/profiles/web/package.json");
const code = readFileSync("/Users/evanx/WebstormProjects/dsh-pets/lib/client.js", "utf8");

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
const windowStub = {
	__ModuleLoader__: { load: (h) => { handoff = h; } }
};
globalThis.window = windowStub;
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
	["react", require("react")],
	["react/jsx-runtime", require("react/jsx-runtime")]
]);
const myRequire = (spec) => {
	if (seedMap.has(spec)) return seedMap.get(spec);
	throw new Error(`unexpected require: ${spec}`);
};
const exportsObj = handoff.factory(myRequire);
check("factory exports inject", Array.isArray(exportsObj.inject), JSON.stringify(exportsObj.inject));
check("factory exports apply", typeof exportsObj.apply === "function");
check("inject services", exportsObj.inject.join(",") === "slots,locale", exportsObj.inject.join(","));

// apply() with a fake ctx
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
			this.lastComponent = component;
		}
	}
};
exportsObj.apply(fakeCtx);
check("locale registered pets ns", fakeCtx.locale.last?.ns === "pets", fakeCtx.locale.last?.ns);
check("zh dict populated", Object.keys(fakeCtx.locale.last?.dicts?.zh ?? {}).length > 10);
const Component = fakeCtx.slots.lastComponent;
check("component captured", typeof Component === "function");

// SSR render the overlay with stub hooks
if (typeof Component === "function") {
	const ReactDOMServer = require("/Users/evanx/.dsh/profiles/node_modules/react-dom/server");
	const React = require("react");
	const useSessions = (sel) => sel({ byId: {}, current: undefined, jobsBySession: {} });
	const t = (k) => k;
	try {
		const html = ReactDOMServer.renderToString(React.createElement(Component, { useSessions, t }));
		check("SSR render ok", typeof html === "string", html.slice(0, 120));
	} catch (error) {
		failures++;
		console.error("FAIL SSR render:", error);
	}
}

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
