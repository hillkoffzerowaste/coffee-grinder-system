import { randomBytes, scrypt, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";
const derive = promisify(scrypt);
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const key = await derive(password,salt,64) as Buffer;
  return salt+":"+key.toString("hex");
}
export async function checkPassword(password: string, stored: string) {
  const [salt,hash] = stored.split(":");
  if (!salt || !hash) return false;
  const key = await derive(password,salt,64) as Buffer;
  const expected = Buffer.from(hash,"hex");
  return key.length === expected.length && timingSafeEqual(key,expected);
}
export const hashToken = (value: string) => createHash("sha256").update(value).digest("hex");
