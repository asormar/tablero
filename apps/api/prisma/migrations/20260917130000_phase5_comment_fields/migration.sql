-- Comentarios: la fila del índice espeja el `Y.Map` plano del documento (la web
-- mapea `parentCommentId` a su `parentId`). Faltaban la posición de la chincheta
-- libre (`x`/`y`), quién resolvió el hilo y las menciones.

ALTER TABLE "Comment" ADD COLUMN "x" DOUBLE PRECISION;
ALTER TABLE "Comment" ADD COLUMN "y" DOUBLE PRECISION;
ALTER TABLE "Comment" ADD COLUMN "resolvedBy" TEXT;
ALTER TABLE "Comment" ADD COLUMN "mentions" JSONB;
