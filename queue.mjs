#!/usr/bin/env node

import { buildCliOutput, parseCliArguments } from "./src/cli.js";
import { createLiveQueueService } from "./src/live-queue.js";

try {
  const options = parseCliArguments(process.argv.slice(2));
  const getQueue = createLiveQueueService();
  const snapshot = await getQueue({ force: true });
  process.stdout.write(`${JSON.stringify(buildCliOutput(snapshot, options), null, 2)}\n`);
} catch (error) {
  process.stdout.write(
    `${JSON.stringify({ error: { message: error.message } }, null, 2)}\n`,
  );
  process.exitCode = 1;
}
