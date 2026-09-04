import { z } from "zod";
import type { PoolClient } from "pg";

export const resetPasswordSchema = z.object({
  password: z.string().min(8).max(200),
  confirmPassword: z.string(),
}).strict().refine(value => value.password === value.confirmPassword, "รหัสผ่านไม่ตรงกัน");

// Called only inside an admin-authorized transaction. Account row locking also
// serializes against login, so an old-password login cannot survive this reset.
export async function resetAccountPassword(client: Pick<PoolClient, "query">, actor: string, target: string, hash: string) {
  const result = await client.query("update coffee.accounts set password_hash=$1 where id=$2 returning id", [hash, target]);
  if (!result.rowCount) return false;
  await client.query("update coffee.sessions set revoked_at=now() where user_id=$1 and revoked_at is null", [target]);
  await client.query("insert into coffee.audit_log(actor_id,action,entity,entity_id) values ($1,'RESET_PASSWORD','profiles',$2)", [actor, target]);
  return true;
}
