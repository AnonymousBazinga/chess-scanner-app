import "./env.ts";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AppConfig, Filters, ServerEvent, Spec } from "../shared/types.ts";
import { MODEL_ID, missingConfig } from "./agent.ts";
import { loadCountries } from "./freelancer.ts";
import { getCountries, regionMap } from "./geo.ts";
import { Runner } from "./runner.ts";
import { createSession, getSession, type Session } from "./session.ts";

const app = express();
app.use(express.json({ limit: "2mb" }));

const runners = new WeakMap<Session, Runner>();

function session(req: express.Request, res: express.Response) {
  const s = getSession(String(req.params.id));
  if (!s) res.status(404).json({ error: "This search session has expired. Start a new chat." });
  return s;
}

app.get("/api/config", (_req, res) => {
  const missing = missingConfig();
  const config: AppConfig = {
    ready: missing.length === 0,
    missing,
    model: MODEL_ID,
    regions: regionMap(),
    countries: getCountries().map((c) => c.name),
  };
  res.json(config);
});

app.post("/api/sessions", (_req, res) => {
  const missing = missingConfig();
  if (missing.length) {
    res.status(503).json({ error: `Missing configuration: ${missing.join(", ")}` });
    return;
  }
  const s = createSession();
  runners.set(s, new Runner(s));
  res.json({ id: s.id });
});

app.get("/api/sessions/:id/events", (req, res) => {
  const s = session(req, res);
  if (!s) return;
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  const send = (e: ServerEvent) => res.write(`data: ${JSON.stringify(e)}\n\n`);
  for (const e of s.snapshot()) send(e);
  const unsubscribe = s.subscribe(send);
  const ping = setInterval(() => res.write(": ping\n\n"), 20_000);
  req.on("close", () => {
    clearInterval(ping);
    unsubscribe();
  });
});

app.post("/api/sessions/:id/messages", (req, res) => {
  const s = session(req, res);
  if (!s) return;
  const text = String(req.body?.text ?? "").trim();
  if (!text) {
    res.status(400).json({ error: "text is required" });
    return;
  }
  runners.get(s)!.send(text);
  res.status(202).json({ ok: true });
});

app.post("/api/sessions/:id/abort", (req, res) => {
  const s = session(req, res);
  if (!s) return;
  runners.get(s)!.abort();
  res.json({ ok: true });
});

/** Filter changes from the UI. The list re-filters in the browser; this keeps the agent's view in sync. */
app.put("/api/sessions/:id/filters", (req, res) => {
  const s = session(req, res);
  if (!s) return;
  s.setFilters(req.body as Filters);
  // Widening a filter can reveal pool members nobody has screened yet.
  s.screenPool().catch((err) => console.error("screening failed:", err));
  res.json({ ok: true });
});

/** Criteria edited by hand in the UI: re-screen the pool with Jev against the new criteria. */
app.put("/api/sessions/:id/spec", (req, res) => {
  const s = session(req, res);
  if (!s) return;
  s.setSpec(req.body as Spec);
  s.screenPool().catch((err) => console.error("re-screen failed:", err));
  res.json({ ok: true });
});

if (process.env.NODE_ENV === "production") {
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");
  app.use(express.static(dist));
  app.get("/{*splat}", (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

const port = Number(process.env.PORT ?? 8787);
loadCountries()
  .then((c) => console.log(`Loaded ${c.length} countries from Freelancer.com`))
  .catch((err) => console.warn("Couldn't load the country list; location filters will be limited:", err.message));
app.listen(port, () => {
  const missing = missingConfig();
  console.log(`API on http://localhost:${port} · agent model ${MODEL_ID}`);
  if (missing.length) console.warn(`Not ready. Missing in .env: ${missing.join(", ")}`);
});
