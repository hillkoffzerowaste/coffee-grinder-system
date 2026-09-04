import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { attachDatabasePool } from "@vercel/functions";
import { databaseUrl } from "./env";
const globals = globalThis as typeof globalThis & { coffeePool?: Pool };
export function pool() {
  if (!globals.coffeePool) {
    globals.coffeePool = new Pool({connectionString:databaseUrl(),max:5,idleTimeoutMillis:10000,connectionTimeoutMillis:15000});
    globals.coffeePool.on("error", () => console.error("Idle database connection closed"));
    if (process.env.VERCEL) attachDatabasePool(globals.coffeePool);
  }
  return globals.coffeePool;
}
export async function transaction<T>(work: (client: PoolClient) => Promise<T>, actor?: string, admin = false): Promise<T> {
  const client = await pool().connect();
  try {
    await client.query("begin");
    await client.query("set local search_path = coffee,pg_catalog");
    await client.query("set local statement_timeout = '20s'");
    if (actor) {
      await client.query("select set_config('coffee.actor_id',$1,true)",[actor]);
      if (admin) {
        const result = await client.query("select id from coffee.profiles where id=$1 and active and role='admin' and station in ('packing','both') for share",[actor]);
        if (!result.rowCount) throw new Error("FORBIDDEN");
      } else await client.query("set local role coffee_app");
    }
    const result = await work(client);
    await client.query("commit");
    return result;
  } catch (error) { await client.query("rollback").catch(()=>undefined); throw error; }
  finally { client.release(); }
}
export async function readRows<T extends QueryResultRow = QueryResultRow>(actor: string, sql: string, values: unknown[] = []): Promise<T[]> {
  return transaction(async client => (await client.query<T>(sql,values)).rows,actor);
}
export function databaseError(error: unknown) {
  const e = error as { code?: string; message?: string };
  if (e.code === "23505") return {message:"ข้อมูลซ้ำกับรายการที่มีอยู่",status:409};
  if (e.code === "23503") return {message:"รายการอ้างอิงไม่ถูกต้องหรือมีประวัติใช้งานแล้ว",status:409};
  if (e.code?.startsWith("23")) return {message:"ข้อมูลไม่ตรงตามข้อกำหนด",status:400};
  if (e.code === "P0001") return {message:e.message || "คำสั่งไม่ถูกต้อง",status:409};
  if (e.message === "FORBIDDEN") return {message:"ไม่มีสิทธิ์ดำเนินการ",status:403};
  return {message:"เชื่อมต่อฐานข้อมูลไม่สำเร็จ กรุณาลองใหม่",status:503};
}
