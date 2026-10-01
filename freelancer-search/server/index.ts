import "./env.ts";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { SearchEvent, SearchRequest } from "../shared/types.ts";
import { aiEnabled, MODEL } from "./ai.ts";
import { loadCountries } from "./freelancer.ts";
import { runSearch } from "./search.ts";

const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/api/config", (_req, res) => {
  res.json({ ai: aiEnabled(), model: aiEnabled() ? MODEL : null });
});

app.post("/api/search", async (req, res) => {
  const body = req.body as SearchRequest;
  if (!Array.isArray(body?.messages)) {
    res.status(400).json({ error: "messages is required" });
    return;
  }
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  const controller = new AbortController();
  res.on("close", () => controller.abort());
  const emit = (e: SearchEvent) => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(e)}\n\n`);
  };
  try {
    await runSearch(body, emit, controller.signal);
  } catch (err) {
    console.error(err);
    emit({ type: "error", message: (err as Error).message });
  }
  res.end();
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
  console.log(`API on http://localhost:${port} · ranking with ${aiEnabled() ? `Claude (${MODEL})` : "keywords only (set ANTHROPIC_API_KEY for AI ranking)"}`);
});
