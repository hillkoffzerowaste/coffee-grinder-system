"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import type { Station } from "@/lib/types";
import { PwaInstallButton } from "@/components/pwa-install-button";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submitting = useRef(false);
  async function login(station: Station) {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true); setError("");
    try {
      const result = await apiFetch<{ destination: string }>("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password, station }) });
      router.replace(result.destination); router.refresh();
    } catch (error) { setError(error instanceof Error ? error.message : "เข้าสู่ระบบไม่สำเร็จ"); }
    finally { submitting.current = false; setBusy(false); }
  }
  return <main id="main" tabIndex={-1} className="login-page">
    <section className="panel login-card stack">
      <div><h1>HILLKOFF</h1><p>ระบบรับออเดอร์และจัดคิวบดกาแฟ</p></div>
      <form className="stack" onSubmit={(event) => { event.preventDefault(); void login("counter"); }}>
        <div className="field"><label htmlFor="username">Username</label><input id="username" className="input" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} required /></div>
        <div className="field"><label htmlFor="password">Password</label><input id="password" className="input" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></div>
        {error && <div role="alert" className="notice error">{error}</div>}
        <div className="station-picker">
          <button className="button large" type="submit" disabled={busy}>{busy ? "กำลังตรวจสอบ..." : "เข้าหน้าร้าน"}</button>
          <button className="button large secondary" type="button" disabled={busy || !username || !password} onClick={() => void login("packing")}>เข้าห้องแพ็ค</button>
        </div>
      </form>
      <PwaInstallButton />
      <small>ใช้บัญชีที่ Admin สร้างไว้ · เบราว์เซอร์สามารถจดจำรหัสผ่านได้</small>
    </section>
  </main>;
}
