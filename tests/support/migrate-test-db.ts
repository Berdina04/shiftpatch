import { execSync } from "node:child_process";
import { testProcessEnv } from "./test-env";

export function migrateTestDatabase(): void {
  execSync("npx prisma migrate deploy", { env: testProcessEnv(), stdio: "pipe" });
}
