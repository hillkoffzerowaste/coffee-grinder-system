"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Profile } from "@/lib/types";
import { apiFetch } from "@/lib/api";

export function Topbar({ title, profile }: { title: string; profile: Profile }) {
  const router = useRouter();
  async function logout() {
    try { await apiFetch("/api/auth/logout", { method: "POST" }); }
    catch { window.alert("ออกจากระบบไม่สำเร็จ กรุณาลองใหม่"); return; }
    router.replace("/login");
    router.refresh();
  }
  return <header className="topbar">
    <h1>HILLKOFF · {title}</h1>
    <div className="topbar-actions">
      <span>{profile.display_name}</span>
      {profile.role === "admin" && <><Link href="/packing">ห้องแพ็ค</Link><Link href="/admin">Admin Console</Link></>}
      <button className="button secondary" onClick={logout}>ออกจากระบบ</button>
    </div>
  </header>;
}
