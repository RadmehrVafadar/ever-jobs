import "dotenv/config";
import {
  prestigeInternshipsV2Watch,
  PrismaWatchRepository,
  WatcherPrismaService,
} from "@ever-jobs/watcher";

async function seed(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required to seed the watcher");
  }
  const prisma = new WatcherPrismaService();
  await prisma.$connect();
  const repository = new PrismaWatchRepository(prisma);
  try {
    const watches = await repository.listWatches();
    // Seeding is fresh-install-only. A repeated deploy must never duplicate or
    // overwrite legacy/custom watches, cadence, thresholds, or baseline state.
    const watch =
      watches[0] ??
      (await repository.createWatch(prestigeInternshipsV2Watch()));

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
