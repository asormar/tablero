-- Fase 5 (colaboración): miembros, invitaciones, comentarios extraídos del
-- documento, actividad, notificaciones y publicación de tableros.
--
-- `Share` cae: la reemplaza `BoardMember` (rol por tablero con herencia en
-- subtableros, resuelta en `lib/access.ts`). La tabla estaba vacía de uso real
-- (el código solo la leía) y no tiene datos que migrar en desarrollo.
DROP TABLE IF EXISTS "Share";

-- Publicación (§4 de la fase 5): cuándo se publicó y si la vista pública
-- navega los subtableros. `publishedSlug` y `publishedPasswordHash` ya existían.
ALTER TABLE "Board" ADD COLUMN "publishedAt" TIMESTAMP(3);
ALTER TABLE "Board" ADD COLUMN "publicIncludeSubBoards" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "Board_publishedAt_idx" ON "Board"("publishedAt");

-- Miembros del tablero. El dueño no tiene fila (su rol sale de `Board.ownerId`).
CREATE TABLE "BoardMember" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "BoardRole" NOT NULL,
    "invitedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BoardMember_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BoardMember_boardId_userId_key" ON "BoardMember"("boardId", "userId");
CREATE INDEX "BoardMember_boardId_idx" ON "BoardMember"("boardId");
CREATE INDEX "BoardMember_userId_idx" ON "BoardMember"("userId");
CREATE INDEX "BoardMember_boardId_role_idx" ON "BoardMember"("boardId", "role");

ALTER TABLE "BoardMember" ADD CONSTRAINT "BoardMember_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BoardMember" ADD CONSTRAINT "BoardMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BoardMember" ADD CONSTRAINT "BoardMember_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Invitaciones por email con caducidad. El token se guarda en claro (es un
-- secreto de un solo uso para leer/escribir el tablero, no una credencial de
-- cuenta) y viaja en el enlace `/invite/:token`.
CREATE TABLE "Invitation" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "BoardRole" NOT NULL DEFAULT 'viewer',
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "acceptedById" TEXT,
    "invitedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Invitation_token_key" ON "Invitation"("token");
CREATE INDEX "Invitation_boardId_idx" ON "Invitation"("boardId");
CREATE INDEX "Invitation_email_idx" ON "Invitation"("email");
CREATE INDEX "Invitation_expiresAt_idx" ON "Invitation"("expiresAt");

ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_acceptedById_fkey" FOREIGN KEY ("acceptedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Comentarios: proyección del hilo que vive en el documento Yjs. `parentId`
-- pasa a llamarse `parentCommentId` y `resolved` (booleano) a `resolvedAt`
-- (marca de tiempo): el hilo resuelto guarda *cuándo*, que es lo que muestra el
-- panel. Las tablas estaban sin uso: no hay datos que conservar.
DROP TABLE IF EXISTS "Comment";

CREATE TABLE "Comment" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "elementId" TEXT,
    "parentCommentId" TEXT,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Comment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Comment_boardId_idx" ON "Comment"("boardId");
CREATE INDEX "Comment_elementId_idx" ON "Comment"("elementId");
CREATE INDEX "Comment_authorId_idx" ON "Comment"("authorId");
CREATE INDEX "Comment_parentCommentId_idx" ON "Comment"("parentCommentId");
CREATE INDEX "Comment_boardId_resolvedAt_idx" ON "Comment"("boardId", "resolvedAt");

ALTER TABLE "Comment" ADD CONSTRAINT "Comment_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_parentCommentId_fkey" FOREIGN KEY ("parentCommentId") REFERENCES "Comment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Actividad del tablero (lotes del cliente).
CREATE TABLE "Activity" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "elementId" TEXT,
    "elementType" TEXT,
    "meta" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Activity_boardId_createdAt_idx" ON "Activity"("boardId", "createdAt");
CREATE INDEX "Activity_boardId_userId_idx" ON "Activity"("boardId", "userId");
CREATE INDEX "Activity_userId_createdAt_idx" ON "Activity"("userId", "createdAt");

ALTER TABLE "Activity" ADD CONSTRAINT "Activity_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Notificaciones: `type` → `kind` y el `payload` genérico se reemplaza por las
-- referencias que el panel necesita (tablero, elemento, actor) más `meta` y
-- `dedupeKey` (una mención por comentario y usuario, una tarea vencida por
-- tarea y día). La tabla estaba sin uso.
DROP TABLE IF EXISTS "Notification";

CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "boardId" TEXT,
    "elementId" TEXT,
    "actorId" TEXT,
    "meta" JSONB NOT NULL DEFAULT '{}',
    "dedupeKey" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Notification_dedupeKey_key" ON "Notification"("dedupeKey");
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");
CREATE INDEX "Notification_boardId_idx" ON "Notification"("boardId");

ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;
