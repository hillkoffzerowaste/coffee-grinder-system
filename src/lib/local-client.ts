import { cookies, headers } from "next/headers";
import { randomBytes, randomUUID } from "node:crypto";
import { localDB, passwordHash, tokenHash, verifyPassword } from "./local-store";

type Row = Record<string, unknown>;
type Result = { data: unknown; error: { message: string } | null };
const cookieName = "coffee_local_session";
const tables = new Set(["profiles","products","product_barcodes","grind_size_codes","grinder_users","orders","order_items","bags","job_events","print_jobs","outbox_events","audit_log","app_settings"]);
function identifier(value: string) {
  if (!/^[a-z_][a-z_0-9]*$/.test(value)) throw new Error("Invalid column");
  return `"${value}"`;
}
async function checkHost() {
  const h = await headers();
  const host = h.get("host") || "";
  if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) throw new Error("Local test mode only accepts loopback requests");
  const origin = h.get("origin");
  if (origin && new URL(origin).host !== host) throw new Error("Cross-origin local request denied");
}
async function userId() {
  await checkHost();
  const token = (await cookies()).get(cookieName)?.value;
  if (!token) return null;
  const db = await localDB();
  return (await db.query<{ user_id: string }>("select s.user_id from local_sessions s join profiles p on p.id=s.user_id where s.token_hash=$1 and p.active", [tokenHash(token)])).rows[0]?.user_id ?? null;
}

class LocalQuery implements PromiseLike<Result> {
  private columns = "*";
  private filters: { column: string; value: unknown; list: boolean }[] = [];
  private sorting?: { column: string; ascending: boolean };
  private max = 500;
  private mode = "select";
  private payload: Row = {};
  private singleRow = false;
  private required = false;
  constructor(private table: string, private privileged: boolean) { if (!tables.has(table)) throw new Error("Unknown local table"); }
  select(columns = "*") { this.columns = columns; return this; }
  eq(column: string, value: unknown) { this.filters.push({column,value,list:false}); return this; }
  in(column: string, value: unknown[]) { this.filters.push({column,value,list:true}); return this; }
  order(column: string, options?: { ascending?: boolean }) { this.sorting = {column,ascending:options?.ascending !== false}; return this; }
  limit(value: number) { this.max = Math.min(500, Math.max(1,value)); return this; }
  insert(payload: Row) { this.mode = "insert"; this.payload = payload; return this; }
  upsert(payload: Row) { this.mode = "upsert"; this.payload = payload; return this; }
  update(payload: Row) { this.mode = "update"; this.payload = payload; return this; }
  single() { this.singleRow = true; this.required = true; return this; }
  maybeSingle() { this.singleRow = true; return this; }
  then<T = Result, U = never>(resolve?: ((value: Result) => T | PromiseLike<T>) | null, reject?: ((reason: unknown) => U | PromiseLike<U>) | null): PromiseLike<T | U> {
    return this.run().then(resolve,reject);
  }
  private async run(): Promise<Result> {
    try {
      const actor = await userId();
      const db = await localDB();
      const rows = await db.transaction(async tx => {
        if (this.privileged) {
          const profile = (await tx.query<{ role: string }>("select role from profiles where id=$1 and active",[actor])).rows[0];
          if (profile?.role !== "admin") throw new Error("FORBIDDEN");
        } else {
          await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[actor ?? ""]);
          await tx.exec("set local role authenticated");
        }
        const values: unknown[] = [];
        const bind = (value: unknown) => { values.push(value); return `$${values.length}`; };
        const table = identifier(this.table);
        const joinProduct = this.columns.includes("products!inner(");
        const joinOrder = this.columns.includes("orders(");
        const where = this.filters.map(f => {
          const column = f.column.startsWith("products.") && joinProduct ? `p.${identifier(f.column.slice(9))}` : `t.${identifier(f.column)}`;
          return f.list ? `${column} = any(${bind(f.value)})` : `${column} = ${bind(f.value)}`;
        });
        const condition = where.length ? ` where ${where.join(" and ")}` : "";
        let sql: string;
        if (this.mode === "select") {
          let projection: string;
          if (joinProduct) projection = "t.barcode,jsonb_build_object('id',p.id,'sku',p.sku,'name',p.name,'size_grams',p.size_grams,'unit',p.unit,'active',p.active) as products";
          else if (joinOrder) projection = "t.*,jsonb_build_object('order_no',o.order_no) as orders";
          else projection = this.columns === "*" ? "t.*" : this.columns.split(",").map(c => `t.${identifier(c)}`).join(",");
          sql = `select ${projection} from ${table} t` + (joinProduct ? " join products p on p.id=t.product_id" : "") + (joinOrder ? " join orders o on o.id=t.order_id" : "") + condition;
          if (this.sorting) sql += ` order by t.${identifier(this.sorting.column)} ${this.sorting.ascending ? "asc" : "desc"}`;
          sql += ` limit ${bind(this.max)}`;
        } else {
          const entries = Object.entries(this.payload);
          if (!entries.length) throw new Error("Empty payload");
          if (this.mode === "update") {
            if (!where.length) throw new Error("Unfiltered update denied");
            sql = `update ${table} t set ${entries.map(([k,v]) => `${identifier(k)}=${bind(v)}`).join(",")}${condition} returning *`;
          } else {
            sql = `insert into ${table} (${entries.map(([k]) => identifier(k)).join(",")}) values (${entries.map(([,v]) => bind(v)).join(",")})`;
            if (this.mode === "upsert") sql += ` on conflict (id) do update set ${entries.filter(([k]) => k !== "id").map(([k]) => `${identifier(k)}=excluded.${identifier(k)}`).join(",")}`;
            sql += " returning *";
          }
        }
        return (await tx.query<Row>(sql,values)).rows;
      });
      if (this.singleRow && (rows.length > 1 || (this.required && !rows.length))) throw new Error("Expected one row");
      return { data: this.singleRow ? rows[0] ?? null : rows, error: null };
    } catch (error) { return { data: null, error: { message: error instanceof Error ? error.message : "Local database error" } }; }
  }
}

export function createLocalClient(privileged = false) {
  return {
    from: (table: string) => new LocalQuery(table,privileged),
    async rpc(name: string, args: Row) {
      try {
        const actor = await userId(), db = await localDB();
        const names = name === "create_order" ? ["p_client_request_id","p_source","p_lines"] : name === "transition_bag" ? ["p_bag_id","p_expected_status","p_next_status","p_grinder_user_id","p_grind_id"] : null;
        if (!names) throw new Error("Unknown RPC");
        const data = await db.transaction(async tx => {
          await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[actor ?? ""]);
          await tx.exec("set local role authenticated");
          return (await tx.query<{ result: unknown }>(`select ${identifier(name)}(${names.map((_,i)=>`$${i+1}`).join(",")}) as result`,names.map(n=>args[n] ?? null))).rows[0].result;
        });
        return {data,error:null};
      } catch (e) { return {data:null,error:{message:e instanceof Error ? e.message : "RPC failed"}}; }
    },
    auth: {
      async getUser() { const id = await userId(); return {data:{user:id ? {id} : null},error:null}; },
      async signInWithPassword({email,password}: {email: string; password: string}) {
        await checkHost(); const db = await localDB();
        const user = (await db.query<{id:string;password_hash:string}>("select id,password_hash from auth.users where email=$1",[email])).rows[0];
        if (!user || !verifyPassword(password,user.password_hash)) return {data:{user:null},error:{message:"Invalid credentials"}};
        const store = await cookies(), previous = store.get(cookieName)?.value;
        if (previous) await db.query("delete from local_sessions where token_hash=$1",[tokenHash(previous)]);
        const token = randomBytes(32).toString("hex");
        await db.query("insert into local_sessions values ($1,$2)",[tokenHash(token),user.id]);
        store.set(cookieName,token,{httpOnly:true,sameSite:"strict",path:"/",maxAge:60*60*24*365});
        return {data:{user:{id:user.id}},error:null};
      },
      async signOut() {
        await checkHost(); const store = await cookies(), token = store.get(cookieName)?.value;
        if (token) await (await localDB()).query("delete from local_sessions where token_hash=$1",[tokenHash(token)]);
        store.delete(cookieName); return {error:null};
      },
      admin: {
        async createUser(input: {email:string;password:string}) {
          try {
            if (!privileged) throw new Error("FORBIDDEN");
            const actor = await userId(), db = await localDB();
            if (!(await db.query("select id from profiles where id=$1 and role='admin' and active",[actor])).rows.length) throw new Error("FORBIDDEN");
            const id = randomUUID();
            await db.query("insert into auth.users values ($1,$2,$3)",[id,input.email,passwordHash(input.password)]);
            return {data:{user:{id}},error:null};
          } catch (e) { return {data:{user:null},error:{message:e instanceof Error ? e.message : "Create failed"}}; }
        },
        async deleteUser(id: string) {
          if (!privileged) throw new Error("FORBIDDEN");
          const actor = await userId(), db = await localDB();
          if (!(await db.query("select id from profiles where id=$1 and role='admin' and active",[actor])).rows.length) throw new Error("FORBIDDEN");
          await db.query("delete from auth.users where id=$1",[id]); return {error:null};
        },
      },
    },
  };
}
