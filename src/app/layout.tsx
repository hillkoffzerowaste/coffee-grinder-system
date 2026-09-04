import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hillkoff Coffee Grinding",
  description: "ระบบรับออเดอร์และจัดคิวบดกาแฟ",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="th">
      <body>
        <a className="skip-link" href="#main">ข้ามไปเนื้อหาหลัก</a>
        {children}
      </body>
    </html>
  );
}
