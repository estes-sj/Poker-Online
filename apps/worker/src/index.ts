import { setTimeout as delay } from "node:timers/promises";

import { RankingReconciliationJob } from "./jobs/reconcile-rankings.js";

const workerConcurrency = Number(process.env.WORKER_CONCURRENCY ?? 2);
const pollIntervalMs = Number(process.env.WORKER_POLL_INTERVAL_MS ?? 30000);
const job = new RankingReconciliationJob();

let shuttingDown = false;

process.on("SIGINT", () => {
  shuttingDown = true;
});

process.on("SIGTERM", () => {
  shuttingDown = true;
});

async function main(): Promise<void> {
  console.log(
    JSON.stringify(
      {
        service: "worker",
        status: "started",
        workerConcurrency,
        pollIntervalMs,
      },
      null,
      2
    )
  );

  while (!shuttingDown) {
    const summary = await job.run();

    console.log(
      JSON.stringify(
        {
          service: "worker",
          workerConcurrency,
          summary,
        },
        null,
        2
      )
    );

    if (!shuttingDown) {
      await delay(pollIntervalMs);
    }
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        service: "worker",
        error: error instanceof Error ? error.message : "Unknown worker failure.",
      },
      null,
      2
    )
  );
  process.exitCode = 1;
});
