"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";

export function AdminPasswordReset({ users }: { users: { id: string; username: string }[] }) {
  const router = useRouter();
  const [target, setTarget] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const saving = useRef(false);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (saving.current) return;
    setError(""); setMessage("");
    if (!target || password.length < 8 || password.length > 200 || password !== confirmPassword) {
      setError("เลือกผู้ใช้ กรอกรหัสผ่าน 8–200 ตัวอักษร และยืนยันให้ตรงกัน"); return;
    }
    saving.current = true; setBusy(true);
    try {
      const result = await apiFetch<{ requiresLogin: boolean }>(`/api/admin/users/${target}/password`, {
        method: "PATCH", body: JSON.stringify({ password, confirmPassword }),
      });
      setPassword(""); setConfirmPassword("");
      if (result.requiresLogin) { router.replace("/login"); router.refresh(); }
      else setMessage("เปลี่ยนรหัสผ่านสำเร็จ ผู้ใช้ต้องเข้าสู่ระบบใหม่ทุกเครื่อง");
    } catch (error) { setError(error instanceof Error ? error.message : "เปลี่ยนรหัสผ่านไม่สำเร็จ"); }
    finally { saving.current = false; setBusy(false); }
  }
  return <form className="panel stack" onSubmit={save}>
    <h3>เปลี่ยนรหัสผ่านผู้ใช้</h3>
    <p>ผู้ใช้จะออกจากระบบทุกเครื่อง หากเปลี่ยนรหัสของตัวเอง คุณต้องเข้าสู่ระบบใหม่ด้วย</p>
    <div className="field"><label htmlFor="reset-user">Username</label>
      <select id="reset-user" className="select" value={target} disabled={busy} required onChange={event => {
        setTarget(event.target.value); setPassword(""); setConfirmPassword(""); setError(""); setMessage("");
      }}><option value="">เลือกผู้ใช้</option>{users.map(user => <option key={user.id} value={user.id}>{user.username}</option>)}</select>
    </div>
    <div className="field"><label htmlFor="reset-password">รหัสผ่านใหม่</label>
      <input id="reset-password" className="input" type="password" autoComplete="new-password" minLength={8} maxLength={200} required disabled={busy} value={password} onChange={event => setPassword(event.target.value)} />
    </div>
    <div className="field"><label htmlFor="reset-confirm">ยืนยันรหัสผ่านใหม่</label>
      <input id="reset-confirm" className="input" type="password" autoComplete="new-password" minLength={8} maxLength={200} required disabled={busy} value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} />
    </div>
    {error && <div className="notice error" role="alert">{error}</div>}
    {message && <div className="notice success" role="status">{message}</div>}
    <button className="button" disabled={busy || !target}>{busy ? "กำลังบันทึก..." : "บันทึกรหัสผ่านใหม่"}</button>
  </form>;
}
