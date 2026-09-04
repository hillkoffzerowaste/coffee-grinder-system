import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from "node:crypto";
import { join } from "node:path";
import { localTestEnabled } from "./local-mode";

export function passwordHash(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}
export function verifyPassword(password: string, stored: string) {
  const [salt, hash] = stored.split(":");
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return expected.length === actual.length && timingSafeEqual(actual, expected);
}
export const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

// RFC-style quoted fields, including embedded commas/newlines; identifiers remain text.
function csvRows(text: string) {
  const rows: string[][] = []; let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && c === ",") { row.push(field); field = ""; }
    else if (!quoted && (c === "\n" || c === "\r")) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); if (row.some(Boolean)) rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (quoted) throw new Error("Unclosed CSV field");
  if (field || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift()!;
  return rows.map((values) => Object.fromEntries(header.map((key, i) => [key.replace(/^\uFEFF/, ""), values[i] ?? ""])));
}

async function initialize() {
  const db = new PGlite(join(process.cwd(), ".local-test-db"));
  await db.exec("create table if not exists public.local_migrations(name text primary key)");
  const applied = new Set((await db.query<{ name: string }>("select name from public.local_migrations")).rows.map(r => r.name));
  if (!applied.has("bootstrap")) {
    await db.exec(`create role anon; create role authenticated;
      create schema auth;
      create table auth.users(id uuid primary key, email text unique not null, password_hash text not null);
      create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema public,auth to authenticated;
      grant execute on function auth.uid() to authenticated;
      create publication supabase_realtime;
      create table public.local_sessions(token_hash text primary key, user_id uuid references auth.users(id) on delete cascade);
      insert into public.local_migrations values ('bootstrap');`);
  }
  for (const file of (await readdir(join(process.cwd(), "supabase/migrations"))).filter(f => f.endsWith(".sql")).sort()) {
    if (applied.has(file)) continue;
    const sql = (await readFile(join(process.cwd(), "supabase/migrations", file), "utf8")).replace("create extension if not exists pgcrypto;", "");
    await db.transaction(async tx => { await tx.exec(sql); await tx.query("insert into local_migrations values ($1)", [file]); });
  }
  if (!applied.has("seed-v1")) {
    const records = csvRows(await readFile(join(process.cwd(), "data/sku-coffee-beans-200g-plus.csv"), "utf8"));
    await db.transaction(async tx => {
      for (const [username, role, station, label] of [
        ["counter", "counter", "counter", "หน้าร้าน • ทดสอบ LOCAL"],
        ["packing", "packer", "packing", "ห้องแพ็ค • ทดสอบ LOCAL"],
        ["admin", "admin", "packing", "แอดมิน • ทดสอบ LOCAL"],
      ]) {
        const id = randomUUID();
        await tx.query("insert into auth.users values ($1,$2,$3)", [id, `${username}@coffee.internal`, passwordHash("TestCoffee2026!")]);
        await tx.query("insert into profiles(id,username,display_name,role,station) values ($1,$2,$3,$4,$5)", [id, username, label, role, station]);
      }
      for (const row of records) {
        const id = randomUUID();
        await tx.query("insert into products(id,sku,name,size_grams,unit) values ($1,$2,$3,$4,$5)", [id,row.sku,row.product_name,Number(row.size_grams),row.unit]);
        for (const barcode of row.barcode.split(",").map(s => s.trim()).filter(Boolean)) {
          if (!/^\d{4,32}$/.test(barcode)) throw new Error(`Invalid barcode in ${row.sku}`);
          await tx.query("insert into product_barcodes(product_id,barcode) values ($1,$2)", [id,barcode]);
        }
      }
      await tx.query("insert into grinder_users(name) values ($1)", ["ผู้บดทดสอบ"]);
      await tx.query("insert into local_migrations values ('seed-v1')");
    });
  }
  return db;
}

const globals = globalThis as typeof globalThis & { coffeeLocalDB?: Promise<PGlite> };
export function localDB() {
  if (!localTestEnabled()) throw new Error("Local test database is disabled");
  globals.coffeeLocalDB ??= initialize();
  return globals.coffeeLocalDB;
}
