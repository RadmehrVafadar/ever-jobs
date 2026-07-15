import "dotenv/config";
import {
  defaultInternshipWatch,
  PrismaWatchRepository,
  WatcherPrismaService,
} from "@ever-jobs/watcher";

const DEFAULT_WATCH_NAME = "Toronto and Canada Software Internships";

async function seed(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required to seed the watcher");
  }
  const prisma = new WatcherPrismaService();
  await prisma.$connect();
  const repository = new PrismaWatchRepository(prisma);
  try {
    const existing = (await repository.listWatches()).find(
      (watch) => watch.name === DEFAULT_WATCH_NAME,
    );
    // Seeding is create-only. A repeated deploy must never overwrite source
    // cadence, thresholds, initialization state, or other user edits.
    const watch =
      existing ?? (await repository.createWatch(defaultInternshipWatch()));

    process.stdout.write(
      JSON.stringify(
        {
          id: watch.id,
          name: watch.name,
          enabled: watch.enabled,
          initializationMode: watch.initializationMode,
          initializedAt: watch.initializedAt,
        },
        null,
        2,
      ) + "\n",
    );
  } finally {
    await prisma.$disconnect();
  }
}

void seed().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Watcher seed failed: ${message}\n`);
  process.exitCode = 1;
});
