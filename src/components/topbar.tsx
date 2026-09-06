"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Profile } from "@/lib/types";
import { apiFetch } from "@/lib/api";
import { PwaInstallButton } from "@/components/pwa-install-button";
import { defaultUiConfig, type UiConfig } from "@/lib/ui-config";

export function Topbar({ title, profile, uiConfig=defaultUiConfig }: { title: string; profile: Profile; uiConfig?: UiConfig }) {
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
      {uiConfig.menus.filter(menu=>menu.visible && (menu.id!=="admin"||profile.role==="admin")).sort((a,b)=>a.order-b.order).filter(menu=>menu.id!=="counter" || title!==menu.label).map(menu=><Link key={menu.id} href={menu.id==="packing"?"/packing":menu.id==="admin"?"/admin":"/counter"}>{menu.label}</Link>)}
      <PwaInstallButton />
      <button className="button secondary" onClick={logout}>ออกจากระบบ</button>
    </div>
  </header>;
}
