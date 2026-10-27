-- Índice de búsqueda: se quita el btree sobre "text" y se respalda la
-- búsqueda por subcadena con un índice trigram sobre "textNorm".

-- El btree sobre "text" no lo usaba ninguna consulta (el buscador va por el
-- `tsv` y por LIKE '%…%' sobre "textNorm", que un btree no puede servir) y tenía
-- un coste: una entrada de btree no puede superar ~2,7 kB, y "text" admite hasta
-- 8000 caracteres, así que el upsert de una nota larga fallaba.
DROP INDEX IF EXISTS "SearchIndex_text_idx";

-- `pg_trgm` permite que un LIKE con comodín inicial use un índice GIN. Es una
-- extensión de confianza (PG13+): la puede crear el dueño de la base.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "SearchIndex_textNorm_trgm_idx" ON "SearchIndex" USING GIN ("textNorm" gin_trgm_ops);
