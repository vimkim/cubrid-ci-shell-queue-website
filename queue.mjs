#!/usr/bin/env node

import {
  buildCliOutput,
  buildEtaOutput,
  parseCliArguments,
} from "./src/cli.js";
import { createLiveQueueService } from "./src/live-queue.js";

try {
  const options = parseCliArguments(process.argv.slice(2));
  const getQueue = createLiveQueueService();
  const snapshot = await getQueue({ force: true });
  const output = options.etaOnly
    ? buildEtaOutput(snapshot, options)
    : buildCliOutput(snapshot, options);
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
} catch (error) {
  process.stdout.write(
    `${JSON.stringify({ error: { message: error.message } }, null, 2)}\n`,
  );
  process.exitCode = 1;
}
