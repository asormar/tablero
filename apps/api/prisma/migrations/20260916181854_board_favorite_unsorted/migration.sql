-- AlterTable
ALTER TABLE "Board" ADD COLUMN     "favoriteAt" TIMESTAMP(3),
ADD COLUMN     "isUnsorted" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Board_favoriteAt_idx" ON "Board"("favoriteAt");
