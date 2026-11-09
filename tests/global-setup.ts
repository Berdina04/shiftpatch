import { migrateTestDatabase } from "./support/migrate-test-db";

export default function setup() {
  migrateTestDatabase();
}
