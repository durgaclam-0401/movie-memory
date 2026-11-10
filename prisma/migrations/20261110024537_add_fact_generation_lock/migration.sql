-- CreateTable
CREATE TABLE "FactGenerationLock" (
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "FactGenerationLock_pkey" PRIMARY KEY ("userId")
);

-- AddForeignKey
ALTER TABLE "FactGenerationLock" ADD CONSTRAINT "FactGenerationLock_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
