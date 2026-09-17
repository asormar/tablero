/**
 * Gestión de almacenamiento (§7.7 del plan).
 *
 *   GET    /api/storage          → espacio usado y archivos huérfanos
 *   DELETE /api/storage/orphans  → borra los huérfanos (fila + objetos)
 *
 * Un archivo es **huérfano** cuando ninguna referencia de sus tableros lo usa.
 * El cálculo de referencias vive en `lib/assets.ts` (`referencedAssetIds`) y lo
 * comparten este informe, el borrado de huérfanos y el borrado directo de un
 * archivo: los tres tienen que ver lo mismo, o uno borraría lo que otro
 * protege.
 */

import type { FastifyInstance } from 'fastify';

import { prisma } from '../db.js';
import { deleteAssetObjects, referencedAssetIds } from '../lib/assets.js';
import { currentUser } from '../lib/session.js';

export type OrphanAsset = {
  id: string;
  originalName: string;
  type: string;
  mime: string;
  size: number;
  createdAt: number;
};

type StorageReport = {
  usedBytes: number;
  assetCount: number;
  referencedCount: number;
  orphanedBytes: number;
  orphanCount: number;
  orphaned: OrphanAsset[];
  boardsScanned: number;
  /** Los huérfanos tienen un tope en el listado; el borrado no. */
  orphanListLimit: number;
};

const ORPHAN_LIST_LIMIT = 200;

/** Fila de `Asset` tal como la devuelve Prisma. */
type AssetRow = Awaited<ReturnType<typeof prisma.asset.findMany>>[number];

async function computeOrphans(userId: string): Promise<{ orphans: AssetRow[]; report: StorageReport }> {
  const assets = await prisma.asset.findMany({ where: { ownerId: userId }, orderBy: { createdAt: 'desc' } });
  const { referenced, boardsScanned } = await referencedAssetIds(userId);
  const orphans = assets.filter((asset) => !referenced.has(asset.id));
  const usedBytes = assets.reduce((total, asset) => total + asset.size, 0);
  const report: StorageReport = {
    usedBytes,
    assetCount: assets.length,
    referencedCount: assets.length - orphans.length,
    orphanedBytes: orphans.reduce((total, asset) => total + asset.size, 0),
    orphanCount: orphans.length,
    orphaned: [],
    boardsScanned,
    orphanListLimit: ORPHAN_LIST_LIMIT,
  };
  return { orphans, report };
}

export async function storageRoutes(app: FastifyInstance): Promise<void> {
  app.get('/storage', async (request) => {
    const user = currentUser(request);
    const { orphans, report } = await computeOrphans(user.id);
    report.orphaned = orphans.slice(0, ORPHAN_LIST_LIMIT).map((asset) => ({
      id: asset.id,
      originalName: asset.originalName,
      type: asset.type,
      mime: asset.mime,
      size: asset.size,
      createdAt: asset.createdAt.getTime(),
    }));
    return report;
  });

  /** Borra los huérfanos reales (se recalculan acá, no se confía en el cliente). */
  app.delete('/storage/orphans', async (request) => {
    const user = currentUser(request);
    const { orphans } = await computeOrphans(user.id);
    let deleted = 0;
    let freedBytes = 0;
    const failures: { id: string; reason: string }[] = [];

    for (const asset of orphans) {
      const failedKeys = await deleteAssetObjects(asset, (key, error) => {
        request.log.warn({ err: error, key }, 'No se pudo borrar un objeto huérfano de S3');
      });
      try {
        await prisma.asset.delete({ where: { id: asset.id } });
      } catch (error) {
        failures.push({ id: asset.id, reason: error instanceof Error ? error.message : String(error) });
        continue;
      }
      deleted += 1;
      // Si algún objeto no salió del bucket, la fila igual se borra (mismo
      // criterio que `DELETE /api/assets/:id`) pero se avisa en la respuesta.
      if (failedKeys.length > 0) failures.push({ id: asset.id, reason: `objetos sin borrar: ${failedKeys.join(', ')}` });
      freedBytes += asset.size;
    }

    return { ok: true, deleted, freedBytes, failures };
  });
}
