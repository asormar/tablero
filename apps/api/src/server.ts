/** Arranque del servidor: Fastify + Hocuspocus sobre el mismo puerto. */

import { buildApp } from './app.js';
import { createCollabServer } from './collab/server.js';
import { disconnectPrisma } from './db.js';
import { assertRuntimeEnv, env, loadedEnvFiles } from './env.js';

async function main(): Promise<void> {
  assertRuntimeEnv();
  const app = await buildApp();

  const collab = createCollabServer({ log: (message) => app.log.info(message) });
  collab.attach(app.server);

  app.addHook('onClose', async () => {
    await collab.destroy();
    await disconnectPrisma();
  });

  await app.listen({ port: env.port, host: env.host });
  app.log.info(
    { env: loadedEnvFiles, port: env.port, appOrigin: env.appOrigin },
    `API lista en http://localhost:${env.port} (collab en ws://localhost:${env.port}/collab)`,
  );

  const shutdown = (signal: NodeJS.Signals): void => {
    app.log.info(`${signal} recibido: cerrando servidor`);
    app
      .close()
      .then(() => process.exit(0))
      .catch((error: unknown) => {
        app.log.error({ error }, 'Fallo al cerrar');
        process.exit(1);
      });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error: unknown) => {
  console.error('No se pudo arrancar la API:', error);
  process.exit(1);
});
