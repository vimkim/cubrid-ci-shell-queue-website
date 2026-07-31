import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createQueueService,
  fetchRecentBuilds,
} from "./src/circleci.js";
import { buildQueueSnapshot } from "./src/queue.js";

const root = fileURLToPath(new URL(".", import.meta.url));
const publicDirectory = join(root, "public");
const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 4173);

const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".svg", "image/svg+xml"],
]);

const getQueue = createQueueService({
  loadBuilds: () => fetchRecentBuilds(),
  buildSnapshot: buildQueueSnapshot,
});

function sendJson(response, statusCode, value) {
  const body = JSON.stringify(value);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
  });
  response.end(body);
}

async function sendStatic(response, pathname) {
  const asset = new Map([
    ["/", "index.html"],
    ["/index.html", "index.html"],
    ["/styles.css", "styles.css"],
    ["/app.js", "app.js"],
  ]).get(pathname);

  if (!asset) {
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  const file = join(publicDirectory, asset);
  const metadata = await stat(file);
  response.writeHead(200, {
    "content-type": contentTypes.get(extname(file)) ?? "application/octet-stream",
    "content-length": metadata.size,
    "cache-control": "no-cache",
  });
  createReadStream(file).pipe(response);
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || host}`);

    if (request.method !== "GET") {
      sendJson(response, 405, { error: "Method not allowed" });
      return;
    }

    if (url.pathname === "/api/health") {
      sendJson(response, 200, { ok: true });
      return;
    }

    if (url.pathname === "/api/queue") {
      const snapshot = await getQueue({
        force: url.searchParams.get("refresh") === "1",
      });
      sendJson(response, 200, snapshot);
      return;
    }

    await sendStatic(response, url.pathname);
  } catch (error) {
    console.error(error);
    sendJson(response, 502, {
      error: "Unable to load the CircleCI queue",
      detail: error.message,
    });
  }
});

server.listen(port, host, () => {
  console.log(`CUBRID test_shell queue: http://${host}:${port}`);
});
