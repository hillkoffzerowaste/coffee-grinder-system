export function databaseUrl() {
  const value = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!value) throw new Error("Database is not configured");
  const url = new URL(value);
  if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error("Invalid database configuration");
  url.searchParams.set("sslmode", "verify-full");
  return url.toString();
}
export function hasDatabaseEnv() {
  try { databaseUrl(); return true; } catch { return false; }
}
