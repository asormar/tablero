-- AlterTable
ALTER TABLE "Asset" ADD COLUMN     "boardId" TEXT,
ADD COLUMN     "sha256" TEXT;

-- CreateIndex
CREATE INDEX "Asset_ownerId_createdAt_idx" ON "Asset"("ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "Asset_ownerId_sha256_idx" ON "Asset"("ownerId", "sha256");

-- CreateIndex
CREATE INDEX "Asset_boardId_idx" ON "Asset"("boardId");
