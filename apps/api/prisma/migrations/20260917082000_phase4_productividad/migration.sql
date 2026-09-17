-- Fase 4 (productividad): búsqueda con tsvector, historial de versiones,
-- plantillas del sistema (sin cambios de esquema) y ajustes (ya existían).

-- Búsqueda: columna generada por Postgres con el índice GIN que la respalda.
-- Es una columna *generada* (no un trigger) porque la mantiene el motor y no hay
-- nada que pueda desincronizarse: la API escribe `text` y el `tsv` sale solo.
ALTER TABLE "SearchIndex"
  ADD COLUMN "tsv" tsvector GENERATED ALWAYS AS (to_tsvector('spanish', "text")) STORED;

CREATE INDEX "SearchIndex_tsv_idx" ON "SearchIndex" USING GIN ("tsv");

-- Respaldo por subcadena del buscador: el texto se guarda normalizado
-- (minúsculas y sin diacríticos) y la API consulta con LIKE, así `reunion`
-- encuentra «Reunión» y `reun` encuentra «Reunión con Ana». Sin índice: un
-- patrón con comodín inicial no puede usar un btree y el volumen es personal;
-- si creciera, el reemplazo natural es `pg_trgm` con un índice GIN.
ALTER TABLE "SearchIndex"
  ADD COLUMN "textNorm" TEXT NOT NULL DEFAULT '';

-- Historial de versiones (§7.5): instantáneas del documento Yjs.
CREATE TABLE "BoardVersion" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "yjsState" BYTEA NOT NULL,
    "elementCount" INTEGER NOT NULL DEFAULT 0,
    "sizeBytes" INTEGER NOT NULL DEFAULT 0,
    "origin" TEXT NOT NULL DEFAULT 'auto',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BoardVersion_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BoardVersion_boardId_createdAt_idx" ON "BoardVersion"("boardId", "createdAt");

ALTER TABLE "BoardVersion"
  ADD CONSTRAINT "BoardVersion_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
