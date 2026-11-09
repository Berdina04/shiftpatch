import "dotenv/config";
import { defineConfig } from "prisma/config";

// Migrations use the direct (unpooled) connection when one is provided
// (Neon on Vercel sets DATABASE_URL_UNPOOLED); the app uses DATABASE_URL.
// No env() here: `prisma generate` must work without a database URL.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL,
  },
});
