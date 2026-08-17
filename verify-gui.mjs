// Drive headless Chrome over CDP to load the DSH GUI and verify the pet.
const CDP = "http://127.0.0.1:9222";

async function main() {
	// create a fresh tab
	const tab = await (await fetch(`${CDP}/json/new?about:blank`, { method: "PUT" })).json();
	const ws = new WebSocket(tab.webSocketDebuggerUrl);
	const pending = new Map();
	let seq = 0;
	const messages = [];
	const exceptions = [];
	const send = (method, params = {}) => new Promise((resolve, reject) => {
		const id = ++seq;
		pending.set(id, { resolve, reject });
		ws.send(JSON.stringify({ id, method, params }));
	});
	ws.onmessage = (event) => {
		const msg = JSON.parse(event.data);
		if (msg.id !== void 0 && pending.has(msg.id)) {
			const { resolve, reject } = pending.get(msg.id);
			pending.delete(msg.id);
			msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
			return;
		}
		if (msg.method === "Runtime.consoleAPICalled") {
			const text = (msg.params.args ?? []).map((a) => a.value ?? a.description ?? "").join(" ");
			messages.push(`[console.${msg.params.type}] ${text}`);
		}
		if (msg.method === "Runtime.exceptionThrown") {
			const d = msg.params.exceptionDetails;
			exceptions.push(`[exception] ${d.text} ${d.exception?.description ?? ""}`.slice(0, 500));
		}
		if (msg.method === "Log.entryAdded") {
			messages.push(`[log.${msg.params.entry.level}] ${msg.params.entry.text}`);
		}
	};
	await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
	await send("Runtime.enable");
	await send("Log.enable");
	await send("Page.enable");
	await send("Page.navigate", { url: "http://127.0.0.1:3080/" });
	console.log("navigated, waiting 12s…");
	await new Promise((r) => setTimeout(r, 12000));
	const result = await send("Runtime.evaluate", {
		expression: `JSON.stringify({
			hasOverlay: !!document.querySelector('.dsp-root'),
			hasPet: !!document.querySelector('.dsp-pet'),
			hasChip: !!document.querySelector('.dsp-chip'),
			petCount: document.querySelectorAll('.dsp-pet').length,
			chipCount: document.querySelectorAll('.dsp-chip').length,
			bodyText: (document.body.innerText || '').slice(0, 300),
			overlayHtml: (document.querySelector('.dsp-root')?.outerHTML || '').slice(0, 300),
			title: document.title
		})`,
		returnByValue: true
	});
	console.log("DOM CHECK:", result.result?.value ?? JSON.stringify(result));
	console.log("\n--- console messages ---");
	for (const m of messages.slice(-40)) console.log(m);
	console.log("\n--- exceptions ---");
	for (const e of exceptions.slice(-20)) console.log(e);
	ws.close();
	try { await fetch(`${CDP}/json/close/${tab.id}`); } catch { /* ignore */ }
}

main().catch((error) => { console.error("CDP driver failed:", error); process.exit(1); });
