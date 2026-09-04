# Coffee Grinding Order System — Stable System Design

สถานะ: Baseline สำหรับเริ่มพัฒนา
แหล่งที่มา: requirement จาก shared chat และ stability review

## 1. เป้าหมายและขอบเขต

ระบบรองรับการรับออเดอร์กาแฟบดที่หน้าร้าน และส่งงานต่อไปยังห้องบด/แพ็คแบบ realtime โดยต้องไม่ทำงานหาย ไม่สร้างงานซ้ำ และตรวจสอบย้อนหลังได้ แม้เกิดกรณีอินเทอร์เน็ตหลุด, browser refresh, worker หยุด, printer offline หรือผู้ใช้กดซ้ำ

ขอบเขตระยะแรก:

- Counter Station: สแกน Product Barcode, แสดง SKU/ชื่อ/ขนาด, สแกน Grind Barcode, สร้างถุงละ 1 งาน และยืนยันออเดอร์
- Queue/Grinding Station: รับงานตาม FIFO, สแกนถุง, สแกน/เลือกเบอร์บด, เลือกชื่อคนบด, เปลี่ยนสถานะงาน
- Packing Station: เห็นงาน realtime, ตรวจและปิดงาน
- Print Agent: รับ print job และ retry ได้โดยไม่ทำออเดอร์หาย
- Master Data, dashboard, audit log และรายงานพื้นฐาน

## 2. หลักการที่บังคับใช้

1. PostgreSQL เป็น source of truth เพียงแห่งเดียว
2. Realtime เป็นช่องทางแจ้งเตือน/ลดเวลารอ ไม่ใช่หลักฐานว่าการเปลี่ยนสถานะสำเร็จ
3. ทุก command ต้อง idempotent ด้วย idempotency key
4. เปลี่ยนสถานะผ่าน server-side command เท่านั้น ห้ามให้ client update status ตรง
5. สร้าง order, bags, queue number, events และ print jobs ใน transaction เดียวกันเท่าที่อยู่ในฐานข้อมูลเดียวกัน
6. งานที่ค้างต้องเห็นและ retry ได้เสมอ ไม่มีการลบเพื่อแก้ปัญหา ให้ใช้ void/cancel โดยไม่บังคับกรอกเหตุผล
7. เก็บ snapshot ของ product/grind configuration ไว้ใน bag เพื่อไม่ให้แก้ Master Data ย้อนกระทบงานเก่า

## 2.1 โครงสร้างหน้าจอและการ Login

ระบบมีหน้าจอใช้งานหลักเพียง 2 สถานี:

1. `Counter Station` — หน้าร้าน สำหรับเปิดออเดอร์และติดตามคิว
2. `Packing Station` — ห้องแพ็ค สำหรับรับงานบด/แพ็ค
3. `Admin Console` — หน้า Admin แยกต่างหากภายในฝั่งห้องแพ็ค สำหรับจัดการระบบทั้งหมด

```text
หน้า Login
  ├─ เข้าใช้งานหน้าร้าน
  │    └─ Counter Workspace
  └─ เข้าใช้งานห้องแพ็ค
       ├─ Packing Workspace
       │    ├─ งานบด/แพ็ค
       │    └─ Queue Monitor
       └─ Admin Console (เฉพาะ account ที่มี role admin)
            ├─ Products/SKU/Barcode
            ├─ Grind/Users/Stations/Printers
            └─ Reports/Settings/Recovery
```

กติกา:

- ผู้ใช้เลือกสถานีตอน Login ได้ แต่ server ต้องตรวจซ้ำว่า account มีสิทธิ์ใช้สถานีนั้นจริง
- Packing ไม่ใช่สิทธิ์ Admin โดยอัตโนมัติ; ผู้ใช้ที่เป็น `admin` จะเห็น Admin Panel ใน Packing Workspace ส่วน `packer` เห็นเฉพาะงานที่ได้รับอนุญาต
- Admin Console เป็นหน้าแยกจาก Packing Workspace อย่างชัดเจน แต่ใช้ account และการ Login ฝั่งห้องแพ็คร่วมกัน
- การเปิด Admin Console ต้องตรวจ role `admin` จาก server ทุกครั้ง และควรมีเมนูทางเข้าเฉพาะสำหรับ Admin
- ผู้ใช้ห้องแพ็คทั่วไปเข้า Admin Console ไม่ได้ แม้อยู่ที่เครื่องเดียวกัน
- เมื่อเปลี่ยนผู้ใช้ต้อง logout และล้างข้อมูล draft/งานที่ค้างจากผู้ใช้เดิม
- session สามารถคงอยู่แบบ persistent ได้ตามนโยบายหน้างาน โดยต้องมีปุ่ม `ออกจากระบบทุกเครื่อง` และ revoke session ได้จาก Admin
- หาก Admin เปิดหน้าจอค้างไว้แล้วสิทธิ์ถูกลด/บัญชีถูกปิด ระบบต้องบังคับตรวจสิทธิ์ใหม่และซ่อนเมนูทันที
- ทุกคำสั่ง CRUD, override, recovery และการเปลี่ยน Master Data ต้องตรวจ role ที่ server ไม่พึ่งการซ่อนเมนู

### 2.2 Login Workflow

```text
เปิดระบบ
  ↓
เลือกสถานี: หน้าร้าน หรือ ห้องแพ็ค
  ↓
กรอก Username และ Password
  ↓
Server ตรวจ account, active status, role และ station permission
  ├─ ไม่ผ่าน → แจ้งเตือนและไม่เปิดข้อมูลระบบ
  ├─ Counter → Counter Workspace
  └─ Packing → Packing Workspace
                  └─ Admin role → แสดงทางเข้า Admin Console
```

กติกาการ Login:

- การเลือกสถานีเป็นเพียงบริบทการใช้งาน ไม่ใช่การให้สิทธิ์; server ต้องตรวจสิทธิ์ซ้ำ
- `counter` เข้า Counter Workspace ได้เท่านั้น
- `packer` เข้า Packing Workspace ได้เท่านั้น
- `admin` เข้า Packing Workspace และ Admin Console ได้
- Admin Console เป็น route/page แยกจากหน้า Packing และตรวจ `role = admin` ทุก request
- ระบบ Login ใช้ Username + Password เป็นมาตรฐานเดียวกันทั้ง Counter และ Packing
- Username ต้องไม่ซ้ำกันและต้องผูกกับ role/station ที่ Admin กำหนด
- ข้อความ login ไม่บอกว่า username มีอยู่หรือ password ผิด เพื่อไม่เปิดเผยข้อมูลบัญชี
- session ใช้ cookie ที่ `HttpOnly`, `Secure`, `SameSite` และเก็บ session record/token แบบ hash ฝั่ง server
- ระบบไม่เก็บรหัสผ่านจริงในฐานข้อมูล, cookie, localStorage หรือ sessionStorage
- อนุญาตให้ Browser Password Manager ของเครื่องช่วยบันทึกรหัสผ่านผ่านกลไกของ browser ได้ แต่ระบบไม่อ่านหรือจัดเก็บค่ารหัสผ่านเอง
- ไม่บังคับ logout ตามเวลา; logout เกิดเมื่อผู้ใช้กดออกจากระบบ, Admin revoke, account ถูกปิด หรือ session ถูกยกเลิก
- กด Logout ต้องยกเลิก session ฝั่ง server และล้าง draft/selection ของสถานี
- ถ้า account ถูกปิดหรือเปลี่ยน role ระหว่างใช้งาน ให้บังคับตรวจ session ใหม่และตัดสิทธิ์ทันที
- การ login/logout/failed login/เปลี่ยนสิทธิ์บันทึก audit โดยไม่เก็บรหัสผ่าน

### 2.3 การเปิด Admin Console จากฝั่งห้องแพ็ค

1. ผู้ใช้ Login เข้าฝั่งห้องแพ็ค
2. ระบบโหลด role จาก server
3. เฉพาะ `admin` จึงเห็นปุ่ม `Admin Console`
4. เมื่อเปิดหน้า Admin ระบบตรวจ session และ role ซ้ำ
5. Admin ทำ CRUD/ตั้งค่า/กู้คืนงานในหน้าแยก
6. กลับหน้า Packing ได้โดยไม่ต้องสร้าง session ใหม่
7. เมื่อ Logout ต้องออกจากทั้ง Packing Workspace และ Admin Console พร้อมกัน

การ Login สำเร็จไม่ได้แปลว่า Admin เสมอไป; สิทธิ์ต้องมาจาก role ที่ Admin กำหนดในระบบเท่านั้น

## 3. Architecture

ใช้ modular monolith ก่อน เพื่อลดจุดล้มเหลวและดูแลง่าย:

```text
Counter / Grinding / Packing Web
              |
        Next.js API commands
              |
   Supabase PostgreSQL + RLS
       |                  |
 Realtime changes      Outbox events
                            |
                   Linux Print/Station Agent
                            |
                         Printer
```

องค์ประกอบ:

- Next.js/React/TypeScript เป็น web application
- Supabase PostgreSQL เป็นฐานข้อมูลหลักและ transaction boundary
- Supabase Realtime ใช้ broadcast/change notification ไปยัง station
- Server API เป็นผู้ตรวจสิทธิ์, validate command, lock job และเขียน audit
- Linux Agent ทำหน้าที่ print เท่านั้น ไม่เป็นผู้ตัดสินสถานะงาน
- Scanner รับข้อมูลผ่าน Scanner Agent/USB Serial (CDC) เป็นหลัก เพื่อไม่ผูกกับภาษาหรือ keyboard layout ของเครื่องคอม
- Health endpoint และ agent heartbeat ใช้บอก online/offline แบบมีเวลาหมดอายุ

ห้ามใช้ service worker ทำให้ดูเหมือน offline แล้วบอกว่าส่งออเดอร์สำเร็จ หากยัง commit เข้า server ไม่ได้ ระหว่าง offline ให้เป็นสถานะ `OFFLINE / NOT SYNCED` และอนุญาตเฉพาะ retry หรือ local draft ที่ยังไม่ใช่ออเดอร์จริง

### 3.1 สถาปัตยกรรมฉบับใช้งานจริง

ใช้ `Modular Monolith` เป็นแกนกลางก่อน แยกความรับผิดชอบเป็นโมดูล แต่ deploy และดูแลง่าย:

```text
Counter Workspace ───────┐
Packing Workspace ───────┼── Next.js Server/API ── PostgreSQL + RLS
Admin Console ───────────┘             │
                                       ├── Realtime notification
                                       ├── Durable Outbox
                                       └── Audit Log

Station Computer
  ├── Scanner Agent ── raw numeric barcode ──┐
  └── Print Agent  ── durable print job ──────┴── Server
```

โมดูลหลัก:

- `Auth/RBAC`: Username + Password, session persistent, ตรวจ role และ station
- `Product Master`: Product Barcode → SKU, ชื่อ, ขนาด, หน่วย และสถานะ
- `Grind Master`: Grind Barcode → grind value; รองรับ 6, 8, 10, 12, 15 และค่าเพิ่มเติม
- `Order`: สร้างออเดอร์จาก Product Barcode และสร้างถุงตามจำนวนที่เลือก
- `Queue`: สร้าง queue ต่อถุงและควบคุม FIFO/priority
- `Job State Machine`: ควบคุม QUEUED → CLAIMED → GRINDING → GROUND → PACKING → COMPLETED
- `Realtime`: แจ้ง event ให้หน้าจอ แต่ไม่ใช่ source of truth
- `Print`: durable queue, lease, retry และ verify
- `Admin`: CRUD ข้อมูล Master, ผู้ใช้, เครื่อง, settings, recovery และ reports
- `Observability`: heartbeat, health check, metrics และ audit

หลักการสื่อสาร:

1. Browser ส่ง command ไป Server เท่านั้น ไม่เขียนตารางสำคัญตรงจาก client
2. Server validate สิทธิ์/ข้อมูล แล้วทำ transaction ก่อนตอบกลับ
3. Database เป็น source of truth; realtime มีไว้ปลุกให้ refresh
4. Scanner Agent ส่ง barcode ดิบเข้าระบบ ไม่แปลงเป็น SKU ที่ฝั่งเครื่อง
5. Print Agent ทำหน้าที่ส่งพิมพ์และรายงานผล ไม่เปลี่ยนสถานะงานเอง
6. ทุก command สำคัญมี idempotency key และ request id

## UX/UI System

หมายเหตุ: ส่วนนี้เป็นโครงสร้าง UX/UI ยังไม่ลงสีหรือ design token จนกว่าจะมีไฟล์ `C:\Users\Office14\DESIGN.md` ใน workspace

### 4.1 หลักการใช้งาน

- Scanner-first: ทุก workflow เริ่มจากช่อง scan และคืน focus กลับช่อง scan หลังจบแต่ละงาน
- หน้างานต้องอ่านได้จากระยะทำงานจริง: สถานะ, SKU, เบอร์บด, เลขถุง และเวลาต้องเด่นกว่าข้อมูลรอง
- ลดการพิมพ์: ใช้ barcode, dropdown และ Enter; ไม่มีช่องกรอกเหตุผลใน workflow ปกติ
- หนึ่งหน้าจอมีหนึ่ง primary action ที่ชัดเจน เช่น `สแกน`, `จบออเดอร์`, `เริ่มบด`, `บดเสร็จ`, `เริ่มแพ็ค`, `แพ็คเสร็จ`
- ห้ามใช้สีอย่างเดียวบอกสถานะ ต้องมีข้อความ/ไอคอน/รูปแบบร่วมด้วย
- ทุก action สำคัญต้องมีผลตอบกลับทันที:เสียง,ข้อความ,สถานะ loading และผลจาก server
- เป็น Internal Operations UI: ใช้ layout เรียบง่าย ข้อมูลหนาแน่น และองค์ประกอบเท่าที่จำเป็น
- ไม่ใช้ hero section, card ตกแต่ง, animation, gradient หรือ visual effect ที่ไม่ช่วยการทำงาน
- ปุ่มหลักต้องใหญ่พอสำหรับการกดเร็ว แต่ไม่ทำให้ข้อมูลสำคัญต้อง scroll เกินจำเป็น
- ใช้รูปแบบตาราง/แถบสถานะ/ฟอร์มมาตรฐานเดียวกันทุกหน้า เพื่อให้พนักงานเรียนรู้ครั้งเดียว
- ให้ความสำคัญกับความเร็ว ความชัดเจน และการลดข้อผิดพลาด มากกว่าความสวยงาม

### 4.1.1 Scanner ที่ไม่ขึ้นกับภาษาเครื่อง

ต้องรองรับการสแกน Product Barcode ที่เป็นตัวเลขยาว แม้ Windows/เครื่องคอมจะตั้ง input language เป็นภาษาไทย; ค่า `RB-HK-...` และ `RB-RT-...` เป็น SKU ที่ระบบแสดงหลังค้นหา

แนวทางหลัก:

```text
Barcode Scanner (USB CDC/Serial)
          ↓
Scanner Agent บนเครื่องสถานี
          ↓  raw barcode + CR/LF
Counter/Packing Web App
```

- ใช้ scanner ที่รองรับ USB CDC/Serial หรือโหมด POS ไม่ใช่พึ่ง HID Keyboard อย่างเดียว
- Scanner Agent อ่านค่า raw barcode โดยตรงและส่งเข้าหน้าเว็บผ่าน localhost/WebSocket หรือช่องทาง local bridge
- Agent ต้องส่ง suffix `Enter/CR` หลังอ่านจบ เพื่อให้ workflow ทำงานอัตโนมัติ
- ข้อมูลที่รับต้องคงตัวเลขตามต้นฉบับ ไม่ผ่าน Thai IME
- หน้าเว็บต้องแสดงสถานะ `Scanner Online/Offline`, ชื่อสถานี และเวลาที่รับ scan ล่าสุด
- หาก Agent ไม่ทำงาน ให้แจ้งเตือนและยังเปิดการกรอกทดสอบด้วย keyboard ได้ แต่ไม่ควรยืนยันว่าเป็น scan จากอุปกรณ์
- เครื่องคอมต้องเปิดและ Agent ต้องทำงาน; browser ไม่จำเป็นต้องใช้ภาษาอังกฤษหรือเปลี่ยน keyboard layout
- เครื่องที่ถูกล็อกหน้าจอหรือปิดเครื่องจะไม่รับงาน ซึ่งเป็นพฤติกรรมด้านความปลอดภัยที่ต้องคงไว้

Fallback หากยังใช้ scanner แบบ HID Keyboard:

- ตั้ง scanner เป็น US keyboard layout และติด suffix Enter
- บังคับเปิดหน้าเว็บด้วย input ที่รองรับ scanner และทดสอบบนเครื่องจริง
- ห้ามถือว่า HID ทำงานข้ามภาษาได้ 100%; หาก input language เป็นไทยอาจแปลงตัวอักษร SKU ผิด
- ก่อนใช้งานจริงต้องทดสอบ Product Barcode ตัวเลขยาว, Grind Barcode และ Bag/Job Barcode บนเครื่องจริง

### 4.2 Login UX

```text
┌─────────────────────────────┐
│ Login                       │
│ [ Username                 ] │
│ [ Password                 ] │
│                             │
│ [ เข้าใช้งานหน้าร้าน ]      │
│ [ เข้าใช้งานห้องแพ็ค ]      │
└─────────────────────────────┘
```

- ใช้ Username + Password เท่านั้น
- ปุ่มสถานีสองปุ่มแยกชัดเจน และ server ตรวจสิทธิ์ซ้ำ
- เมื่อ Login สำเร็จให้เข้า workspace ตามสถานีทันที ไม่แสดงเมนูเกินสิทธิ์
- ฝั่งห้องแพ็คแสดง `Packing` และปุ่ม `Admin Console` เฉพาะ role admin
- มี `เปลี่ยนผู้ใช้` และ `Logout` ที่มองเห็นง่ายสำหรับเครื่องส่วนกลาง

### 4.3 Counter Workspace

```text
Header: สถานี / ผู้ใช้ / Online state / เปลี่ยนผู้ใช้
Main:   [ Scan SKU __________________ ] [สถานะการสแกน]
        รายการออเดอร์แบบถุงต่อแถว
        ถุง | SKU | ชื่อ | ขนาด | เบอร์บด | จำนวน (1)
Footer: จำนวนถุงรวม | [ล้าง draft] | [ยืนยันออเดอร์]
Side:   Queue Monitor / งานค้าง / ETA
```

พฤติกรรม:

- เปิดหน้ามา focus ช่อง Scan SKU ทันที
- scan ผ่านแล้วเพิ่มรายการและ focus กลับช่อง scan
- จำนวนถุงเริ่มต้นเป็น 1 และช่องเลือกจำนวนจะแสดงหลังสแกน Grind Barcode
- หลัง Product Barcode ผ่าน ระบบแสดงสินค้าแล้วเปลี่ยน focus ไปช่อง Grind Barcode ทันที
- หน้าร้านต้องสแกน Grind Barcode เพื่อกำหนดเบอร์บด ห้ามพิมพ์เอง
- เมื่อเลือกจำนวนมากกว่า 1 ระบบสร้างถุงแยกและคิวแยกให้ครบตามจำนวน
- ยืนยันแล้ว lock ปุ่มจน server ตอบกลับ ป้องกัน double submit
- สำเร็จให้แสดงเลขออเดอร์/จำนวนถุงเต็มหน้าจอชั่วคราว แล้วเริ่ม draft ใหม่

แนวทางยืนยันออเดอร์ที่เร็วที่สุด:

```text
สแกนสินค้า
→ สแกน Grind Barcode
→ เลือกจำนวน (เริ่มต้น 1)
→ ระบบเพิ่มรายการเข้า draft อัตโนมัติ
→ focus กลับไปสแกนสินค้าเพื่อเพิ่มถุงถัดไป
→ กด `จบออเดอร์ / ยืนยัน` เพียงครั้งเดียว
```

- ปุ่ม `จบออเดอร์ / ยืนยัน` เป็นปุ่มหลักแบบ sticky และรองรับปุ่มลัด `Enter`/`F10`
- ปุ่มแสดงจำนวนถุงรวม เช่น `ยืนยัน 3 ถุง`
- ไม่เปิด confirmation modal ซ้ำเมื่อข้อมูลผ่าน validation แล้ว
- ถ้ายังไม่มีรายการ หรือมี scan/command กำลังทำงาน ปุ่มยืนยันต้อง disabled
- ส่งสำเร็จแล้วแสดง Order No/Queue จาก server ล้าง draft และคืน focus ไป Product Barcode
- ไม่ auto-submit หลังรายการแรก เพราะออเดอร์หนึ่งรายการอาจมีหลายถุง

### 4.4 Packing Workspace

ใช้หน้าเดียวรองรับงานบดและแพ็ค แต่แบ่งเป็นโหมดชัดเจน:

```text
Header: Packing / ผู้ใช้ / Agent+Printer / [Admin Console] / Logout
Mode:   [งานบด] [งานแพ็ค]
Main:   [ Scan SKU หรือ Bag/Job Barcode __________ ]
        รายละเอียดงานที่เลือก
        [สแกนเบอร์บด] [เลือกเบอร์บด] [เลือกชื่อคนบด]
        [เริ่มบด] [บดเสร็จ] หรือ [เริ่มแพ็ค] [แพ็คเสร็จ]
Side:   Queue / งานที่กำลังทำ / งานติดขัด / Print status
```

- งานบด: scan Bag/Job Barcode → scan Grind Barcode 6/8/10/12/15 → เลือกชื่อคนบด → เริ่มบด
- เบอร์บดนอก 5 ค่าหลักเลือกจาก dropdown ที่ Admin ตั้งไว้
- งานแพ็ค: scan Product Barcode ก่อน; งานเดียวเปิดอัตโนมัติ, หลายงานให้ scan Bag/Job Barcode เพิ่มหรือเลือกจากรายการ
- หลัง Product Barcode scan ผ่าน ต้องแสดงชื่อสินค้า, ขนาด, SKU และ barcode ที่อ่านได้ทันที ก่อนแสดง/เปิดงานแพ็ค
- ปุ่ม action แสดงเฉพาะตามสถานะ เช่น งาน `GROUND` จึงแสดง `เริ่มแพ็ค`
- scan ผิดให้แสดงแถบ error ที่อ่านได้ชัด, เสียงเตือน และคืน focus โดยไม่ถามเหตุผล

### 4.5 Admin Console

เป็นหน้าแยกจาก Packing Workspace และใช้ layout แบบข้อมูลหนาแน่น:

```text
Sidebar: Products/SKU | Barcodes | Grind | Grinder Users |
         Users/Roles | Stations | Printers | Queue/SLA |
         Reports | Recovery | Audit
Main:    Search + Filter + [เพิ่มรายการ]
         ตารางข้อมูล
         Drawer/หน้าแก้ไขข้อมูล
```

- ใช้ตารางสำหรับค้นหา/กรอง/เรียง และ drawer สำหรับเพิ่ม/แก้ไขรายการ
- แสดง active/inactive ชัดเจน พร้อมประวัติการแก้ไข
- ลบข้อมูลที่มีประวัติใช้ `ปิดใช้งาน` ไม่ลบจริง
- Barcode สินค้าหนึ่ง SKU เพิ่มได้หลายรายการ
- ฟอร์มต้อง validate ก่อนบันทึก และหลังบันทึกมีปุ่ม `ทดสอบสแกน`
- CRUD สำคัญต้องแสดงผลจาก server และมี audit summary

### 4.6 สถานะที่ต้องออกแบบให้ครบ

- `Loading`: disable action เฉพาะปุ่มที่กำลังทำและแสดง progress
- `Success`: ยืนยันสิ่งที่ server บันทึกแล้ว พร้อมเลขอ้างอิง
- `Validation error`: ชี้จุดผิดและให้กลับไป scan/เลือกใหม่
- `Conflict`: แจ้งว่างานถูกผู้ใช้อื่นรับไปแล้ว แล้ว refresh ข้อมูล
- `Offline`: แสดงเวลาการ sync ล่าสุดและห้ามสื่อว่าส่งงานสำเร็จ
- `Printer error`: แสดง print status/error code และปุ่ม retry/verify ตามสิทธิ์
- `Session/account`: แจ้งให้เปลี่ยนผู้ใช้เมื่อ account ถูก revoke หรือออกจากระบบ

### 4.7 Accessibility และ responsive acceptance

- มี skip link เป็น focusable element แรก และ main มี `id="main"` กับ `tabindex="-1"`
- keyboard/USB scanner ใช้ได้โดยไม่ต้องจับเมาส์
- focus ring ต้องเห็นชัด และ input ในกล่องมี focus-within ring
- checkbox/radio แยกจากกฎ input ทั่วไป
- ตรวจที่ viewport 375, 768 และ 1280 โดยไม่มี horizontal overflow และไม่มีข้อความสำคัญถูกตัด

## 4. Workflow แบบปฏิบัติงานจริง

### 4.1 ภาพรวมตั้งแต่ต้นจนจบ

```text
COUNTER
  สแกน Product Barcode
    ↓
  แสดงชื่อ/ขนาด/SKU
    ↓
  สแกน Grind Barcode
    ↓
  จำนวนถุง = 1 อัตโนมัติ แล้วจึงเลือกจำนวน
    ↓
  ตรวจรายการและกดยืนยัน
    ↓
  Server สร้าง Order + Bag Jobs + Queue + Print Jobs ใน transaction เดียว
    ↓
  พิมพ์ใบงาน / แจ้งเตือนสถานี
    ↓
GRINDING
  เห็นงาน QUEUED → Claim งานถัดไปตาม policy
    ↓
  สแกน Bag/Job Barcode → สแกน Grind Barcode → เลือกชื่อคนบด → เริ่มบด → บดเสร็จ
    ↓
PACKING
  รับงาน GROUND → ตรวจใบงาน/SKU/จำนวน
    ↓
  เริ่มแพ็ค → แพ็คเสร็จ
    ↓
COMPLETED
  ปิดงาน + บันทึกเวลา + audit
```

กติกากลาง: ผู้ปฏิบัติงานเห็นงานจาก server, ปุ่มทุกปุ่มส่ง command ไป server, server เป็นผู้อนุมัติการเปลี่ยนสถานะ และ client ต้อง refresh ข้อมูล authoritative หลัง command สำเร็จ

### 4.1.1 กติกา Scan-first สำหรับทุกสถานี

ทั้ง Counter และ Packing ต้องเริ่ม workflow ด้วยการโฟกัสช่องสแกน Product Barcode เป็นค่าเริ่มต้นเสมอ:

```text
เปิดหน้า/กดเริ่มออเดอร์
  ↓
สแกน Product Barcode ก่อน
  ↓
ระบบตรวจ SKU และอ่านบริบทของสถานี
  ├─ Counter: แปลง barcode เป็น SKU แล้วเปิด draft ออเดอร์ใหม่
  └─ Packing: แปลง barcode เป็น SKU แล้วแสดงงานเดิม หรือเริ่ม manual order
```

ข้อกำหนด:

- scanner ทำงานเหมือน keyboard และ Enter หลัง barcode ต้อง submit scan เพียงครั้งเดียว
- scan สำเร็จต้องมีเสียง/ข้อความยืนยัน แสดงชื่อสินค้า ขนาด SKU และหน่วยทันที แล้วจึงไปขั้นตอนถัดไป
- scan ไม่พบหรือสินค้า inactive ต้องหยุดทันที ไม่สร้าง draft line และไม่เปลี่ยนสถานะงาน
- Product Barcode หนึ่งค่าต้องชี้ไปยัง SKU เดียว ส่วน SKU เดียวมี barcode ได้หลายค่า
- SKU เดียวกันอาจอยู่หลายออเดอร์ ห้ามเลือกงานแบบเดาสุ่ม ต้องแสดงรายการให้เลือกด้วย `Order No`, `Bag No`, เวลา และสถานะ
- การค้นหาด้วยเลขออเดอร์เป็นทางเลือกเสริม ไม่ใช่ขั้นตอนเริ่มต้น
- จำนวนถุงเริ่มต้นเป็น 1 อัตโนมัติ และช่องเลือกจำนวนจะแสดงหลังสแกน Grind Barcode เท่านั้น
- หากเลือกมากกว่า 1 ระบบสร้าง Bag Job แยกถุงตามจำนวน โดยใช้สินค้าและเบอร์บดเดียวกัน
- เมื่อเปลี่ยนสถานีหรือเริ่มรอบใหม่ ต้องล้าง draft/selection เดิมและคืน focus ไปที่ช่อง SKU

ชนิด barcode ที่ใช้ต้องแยกความหมายชัดเจน:

- `Product Barcode`: ตัวเลขยาวจากสินค้าจริง ใช้เริ่มออเดอร์ที่ Counter และค้นหา SKU/งานที่ Packing
- `SKU`: รหัสภายในรูปแบบ `RB-HK-...` หรือ `RB-RT-...` ใช้แสดงผล ค้นหา และอ้างอิงใน Admin ไม่ใช่ค่าที่ scanner ต้องส่งเป็นหลัก
- `Bag/Job Barcode`: ตัวเลขจากใบงาน ใช้ระบุถุงงานเฉพาะใบ และพิมพ์รวมอยู่ในใบงานเดิม
- `Grind Barcode`: ตัวเลขจากป้ายเบอร์บด ใช้ที่ Grinding โดยค่าหลักคือ `6`, `8`, `10`, `12`, `15`

ที่ Packing ให้ใช้ Product Barcode scan เป็นจุดเริ่มต้นตามกติกา หากพบงานเดียวให้เปิดอัตโนมัติ หากพบหลายงานให้ scan `Bag/Job Barcode` เพิ่มหรือเลือกจากรายการ ห้ามเลือกงานแบบเดาสุ่ม

### 4.1.2 Grind Barcode ที่สแกนง่ายและเปลี่ยนค่าได้

- ป้ายแต่ละเบอร์มี barcode ของตัวเองและพิมพ์เลขเบอร์ขนาดใหญ่ให้เห็นตรงกัน เช่น `6`, `8`, `10`, `12`, `15`
- ใช้ barcode แบบตัวเลขยาวที่อยู่ในช่วงรหัสเฉพาะของ Grind เช่น `990006`, `990008`, `990010`, `990012`, `990015` เพื่อไม่ชนกับ Product Barcode
- Admin เป็นผู้สร้าง/แก้ mapping ระหว่าง Grind Barcode กับ `grind_value`; ห้ามพนักงานพิมพ์ค่าเอง
- หลังสแกนต้องแสดง `เบอร์บดที่เลือก` เด่นทันที พร้อมสถานะว่า valid
- ถ้าสแกน barcode เบอร์ใหม่ก่อนกดยืนยัน/เริ่มงาน ให้แทนค่าเดิมทันที (latest valid scan wins)
- ถ้าสแกนผิด ให้สแกนเบอร์ที่ถูกต้องซ้ำได้ ไม่ต้องล้างฟอร์ม
- ถ้าเพิ่มรายการลง draft แล้ว ให้เลือกแถวนั้นและสแกน Grind Barcode ใหม่เพื่อเปลี่ยนค่าได้จนกว่าจะกดยืนยันออเดอร์
- หลังยืนยันออเดอร์หรือเริ่มบดแล้ว ห้ามแก้เงียบ ๆ; ต้องใช้คำสั่ง rework/override ของ Supervisor
- เครื่องสแกนรับเฉพาะตัวเลข จึงไม่ขึ้นกับภาษาไทย/อังกฤษของเครื่อง

### 4.2 Workflow A — หน้าร้านรับออเดอร์

ผู้รับผิดชอบ: Counter Operator

1. เปิดหน้า Counter และตรวจว่า `Database`, `Realtime` และ `Print Agent` เป็น `ONLINE`
2. ระบบวาง focus ที่ช่องสแกน Product Barcode และรอ scan เป็นขั้นตอนแรก
3. สแกน Product Barcode ตัวเลขยาว ระบบค้นหา Product Master และแสดง SKU ที่ผูกไว้
4. แสดงผลทันที: ชื่อสินค้า, ขนาด เช่น `200 g/500 g/1 kg`, SKU, หน่วย และ barcode ที่สแกน
5. ถ้าไม่พบ/สินค้า inactive: แจ้ง `ไม่พบ Product Barcode`, ไม่เพิ่มรายการ และให้สแกนใหม่
6. เมื่อ barcode ผ่าน ระบบแสดงชื่อสินค้า, ขนาด และ SKU แต่ยังไม่ให้เลือกจำนวน
7. ระบบเปลี่ยน focus ไปช่อง Grind Barcode ทันที
8. สแกน Grind Barcode เพื่อกำหนดเบอร์บด โดยค่าที่ Master แนะนำใช้เป็นค่าอ้างอิงเท่านั้น
9. ถ้า Grind Barcode ไม่ถูกต้องหรือ inactive: ไม่สร้างถุงและคืน focus ไปช่อง Grind Barcode
10. เมื่อสแกนผ่าน ระบบแสดงตัวเลือกจำนวน โดยค่าเริ่มต้นเป็น 1
11. เลือกจำนวนแล้วระบบสร้าง Bag Job แยกตามจำนวน เช่น เลือก 3 = 3 ถุง/3 คิว
12. สแกน Product Barcode ถัดไปเพื่อเพิ่มสินค้า/เบอร์บดชุดใหม่
13. Operator ตรวจชื่อสินค้า, ขนาด, SKU, จำนวน และเบอร์บด
14. กดยืนยันหนึ่งครั้ง ระบบ disable ปุ่มระหว่างรอผลและสร้าง `client_request_id`
15. Server ตรวจซ้ำและ transaction สร้าง `Order`, `Order Items`, `Bags`, `Queue Sequence`, `Outbox Event`, `Print Jobs`
16. แสดงเลขออเดอร์และเลขคิวที่ server ออกให้เท่านั้น
17. ถ้าผลตอบกลับหาย ให้กด `ตรวจสอบผลการส่ง` หรือ retry ด้วย key เดิม ห้ามสร้างออเดอร์ใหม่ทันที

ผลลัพธ์: ทุกถุงมี `bag_id` และคิวของตัวเอง พร้อม Grind Barcode ที่ยืนยันแล้ว

### 4.3 Workflow B — การจัดคิว

ผู้รับผิดชอบ: Queue Engine/Server

1. สร้าง `queue_seq` ตอน commit order โดย server
2. งานปกติเรียงจาก `priority` และ `queue_seq` ตาม policy ที่ประกาศไว้
3. งานด่วนต้องมีผู้มีสิทธิ์กำหนด priority โดยไม่เพิ่มช่องกรอกเหตุผลใน workflow หน้างาน
4. การแสดงคิวใช้ query จากฐานข้อมูล ไม่ใช้ลำดับจากหน้าจอเดิม
5. เมื่อมีงานใหม่ ให้สร้าง outbox event แล้วค่อยแจ้งสถานีผ่าน realtime
6. ถ้า realtime ล่ม งานยังอยู่ใน `QUEUED` และ station จะพบเมื่อ refresh/catch-up
7. ห้ามลบหรือข้ามงานเงียบ ๆ หากมีปัญหาให้เปลี่ยนเป็น `BLOCKED` และบันทึกเพียงสถานะ/ผู้ทำ/เวลาใน audit

### 4.4 Workflow C — ห้องบด

ผู้รับผิดชอบ: Grinder Operator

1. หน้า Grinding โหลดงาน `QUEUED` และแสดงงานที่พร้อมทำก่อน โดย focus อยู่ที่ช่องสแกน
2. สแกน `Bag/Job Barcode` ที่ถุง/ใบงานก่อนเสมอ ระบบค้นหา Bag Job ที่ตรงกัน
3. ถ้ามีคนอื่นรับไปแล้ว ให้แสดงว่า `งานถูกหยิบไปแล้ว` และ reload รายการ
4. เมื่อพบงาน ให้กด `รับงาน` หรือใช้ Enter เพื่อ claim ด้วย lease และเปลี่ยนเป็น `CLAIMED`
5. สแกน `Grind Barcode` ที่เครื่องกำหนดให้ โดยค่าหลักเริ่มต้นมี 5 ค่า: `6`, `8`, `10`, `12`, `15`
6. ถ้าเป็นเบอร์บดนอก 5 ค่าหลัก ให้เลือกจาก dropdown เบอร์บดที่ Admin เปิดใช้งานไว้
7. เลือกชื่อคนบดจาก dropdown ที่ Admin สร้างไว้ ระบบห้ามรับชื่อที่พิมพ์เอง
8. Server ตรวจ Bag/Job, grind value และ grinder user แล้วจึงเปลี่ยน `CLAIMED → GRINDING`
9. ไม่ตรง: เสียงแจ้งเตือน, ไม่เปลี่ยนสถานะ และคืน focus ไปช่องสแกน โดยไม่ถามเหตุผล
10. เมื่อบดเสร็จ กด `บดเสร็จ` เปลี่ยน `GRINDING → GROUND`
11. ถ้า operator ปิด browser หลัง claim lease หมดอายุแล้วงานกลับเข้า available queue โดยไม่หาย

หมายเหตุ: ถ้าใช้คอมพิวเตอร์เครื่องเดียวและทำทีละงาน ไม่ต้องทำ multi-operator assignment ที่ซับซ้อน แต่ยังต้องมี lease เพื่อกัน refresh/เครื่องซ้ำ

### 4.5 Workflow D — ห้องแพ็ค

ผู้รับผิดชอบ: Packing Operator

1. หน้า Packing วาง focus ที่ช่องสแกน Product Barcode เป็นขั้นตอนแรก
2. สแกน Product Barcode ก่อน ระบบแปลงเป็น SKU และค้นหาเฉพาะงานที่สถานีนี้มีสิทธิ์ทำ เช่น `GROUND` หรือ `PACKING`
3. ถ้าพบหลายงานที่ SKU เดียวกัน ระบบแสดงตัวเลือก `Order No`, `Bag No`, เวลา และสถานะ ห้ามเลือกอัตโนมัติ
4. Operator เลือกถุงที่ต้องการ แล้วระบบ claim/เปิดงานนั้นจาก server
5. ตรวจใบงานกับถุงจริง: เลขงาน, SKU, ขนาด, เบอร์บด และจำนวน 1 ถุง
6. ไม่ตรง: หยุดงาน เปลี่ยน `BLOCKED` และบันทึกผู้ทำ/เวลาอัตโนมัติ ห้ามปิดเป็น completed
7. ตรง: กด `เริ่มแพ็ค` เปลี่ยน `GROUND → PACKING`
8. ตรวจฉลาก/น้ำหนัก/การปิดถุงตาม SOP ของหน้างาน
9. กด `แพ็คเสร็จ` ระบบแสดง confirmation ที่มีเลขถุงและรายการสำคัญ
10. Server เปลี่ยน `PACKING → COMPLETED` ใน transaction พร้อม audit
11. หลัง completed แล้วห้ามแก้ตรง ๆ หากพบความผิดพลาด ให้สร้าง `REWORK` และเก็บประวัติเดิม

### 4.5.1 กรณีห้องแพ็คกดออเดอร์เอง

คำว่า “กดออเดอร์เอง” แบ่งเป็น 2 กรณี และต้องใช้ปุ่มคนละแบบ:

#### กรณีที่ 1 — เรียกงานที่มีอยู่แล้ว

ใช้เมื่อออเดอร์ถูกสร้างจากหน้าร้านแล้ว แต่ห้องแพ็คต้องการเปิดงานขึ้นมาทำเอง

```text
ห้องแพ็คกด “เรียกงานถัดไป”
  ↓
Server เลือก Bag Job ที่พร้อมทำตาม Queue Policy
  ↓
ระบบ Claim งานด้วย lease
  ↓
แสดง Order No + Bag No + SKU + ขนาด + เบอร์บด
  ↓
สแกน/ตรวจ Bag/Job Barcode และใบงาน
  ↓
เริ่มแพ็ค → แพ็คเสร็จ → COMPLETED
```

กติกา:

- ไม่สร้าง Order หรือ Bag ใหม่
- ไม่อนุญาตให้เลือกข้ามคิวเอง ยกเว้น Supervisor override
- ถ้างานยังอยู่ `QUEUED` หรือ `GROUND` จึงเรียกได้ตาม policy
- ถ้างานถูก Claim โดยสถานีอื่นแล้ว ต้องแจ้งว่าไม่สามารถเรียกซ้ำได้
- การเรียกงานต้องบันทึก `claimed_by`, `station_id` และเวลาอัตโนมัติ

#### กรณีที่ 2 — สร้างออเดอร์ใหม่จากห้องแพ็ค

ใช้เฉพาะกรณีหน้างานจริง เช่น ลูกค้ามารับของด่วน, งานตกหล่นจากหน้าร้าน หรือมีคำสั่งจากหัวหน้างาน ไม่ควรใช้เป็นทางลัดปกติ

```text
ห้องแพ็คกด “เริ่มออเดอร์หน้างาน”
  ↓
สแกน Product Barcode ก่อนเสมอ
  ↓
ระบบตรวจว่าไม่มีงานเดิมที่ต้องเปิด หรือผู้ใช้เลือกสร้างใหม่
  ↓
ยืนยันแหล่งที่มาและผู้อนุมัติจากสิทธิ์ผู้ใช้ (ไม่ต้องกรอกเหตุผล)
  ↓
จำนวนถุง = 1 อัตโนมัติ
  ↓
ระบบดึงเบอร์บดจาก Master Data
  ↓
ยืนยันข้อมูล
  ↓
Server สร้าง Order ใหม่ด้วย source = PACKING_MANUAL
  ↓
สร้าง Bag Job และ Queue Sequence ใหม่
  ↓
สร้างใบงาน/Print Job และบันทึก audit
  ↓
เข้าสู่ workflow ปกติ หรือเข้าโหมด “พร้อมแพ็ค” ตามสิทธิ์ที่กำหนด
```

ข้อบังคับของ manual order:

- ต้องมี `source = PACKING_MANUAL` แยกจาก `COUNTER`
- ต้องใช้ `client_request_id` เช่นเดียวกับหน้าร้าน เพื่อป้องกันกดซ้ำ
- บันทึกผู้สร้าง/สถานี/เวลาสร้างและ `source = PACKING_MANUAL` โดยไม่ต้องกรอกเหตุผล
- ถ้าเป็นงานที่ยังไม่ได้บด ห้ามข้ามขั้นไป `PACKING` โดยอัตโนมัติ
- การข้ามขั้น `QUEUED → PACKING` ทำได้เฉพาะ Supervisor และระบบบันทึก audit อัตโนมัติโดยไม่ถามเหตุผล
- ถ้าห้องแพ็คมีสิทธิ์ทำทั้งบดและแพ็ค ให้ระบบสร้าง transition ตามจริงเป็น `QUEUED → CLAIMED → GRINDING → GROUND → PACKING`
- งาน manual ต้องเข้าคิวเดียวกับงานอื่น เพื่อให้ dashboard, SLA และรายงานนับรวมได้ถูกต้อง

#### ปุ่มที่ควรมีในห้องแพ็ค

| ปุ่ม | ความหมาย | ผลลัพธ์ |
|---|---|---|
| `เรียกงานถัดไป` | ขอรับงานเดิมจากคิว | Claim Bag Job เดิม |
| `ค้นหาออเดอร์` | เปิดงานเดิมจากเลขออเดอร์/SKU | ไม่สร้างงานใหม่ |
| `สร้างออเดอร์หน้างาน` | สร้างออเดอร์ใหม่จริง | สร้าง Order + Bag + Queue ใหม่ |
| `ขอ Override` | ขอทำงานผิดลำดับ/ข้ามขั้น | ต้องมี Supervisor ระบบบันทึก audit อัตโนมัติ |

ระบบต้องไม่ใช้ปุ่มเดียวที่ตีความได้ทั้ง “เรียกงานเดิม” และ “สร้างงานใหม่” เพราะเป็นสาเหตุโดยตรงของงานซ้ำและตัวเลขรายงานคลาดเคลื่อน

### 4.6 Workflow E — การพิมพ์

ผู้รับผิดชอบ: Print Agent + Supervisor เมื่อผิดปกติ

1. Server สร้าง print job พร้อม order ใน transaction
2. Agent heartbeat เป็น `ONLINE` และขอรับงานที่ `PENDING`
3. Server lease งานให้ agent เป็น `PRINTING`
4. Agent พิมพ์ payload snapshot ที่ได้รับ
5. สำเร็จ: mark `PRINTED` และเก็บเวลาพิมพ์
6. agent ล่ม/timeout: lease หมดอายุ งานกลับมา retry อัตโนมัติ
7. printer offline/กระดาษหมด: mark `FAILED_RETRYABLE`, แสดง error code อัตโนมัติ และ retry ตาม backoff
8. ถ้าไม่แน่ใจว่าพิมพ์ไปแล้วหรือไม่: mark `VERIFY_REQUIRED`; supervisor ตรวจใบงานจริงก่อน retry
9. ออเดอร์ไม่ควรถูกยกเลิกเพียงเพราะ printer มีปัญหา

### 4.7 Workflow F — Realtime และการ reconnect

1. ทุกหน้าดึงข้อมูลล่าสุดจาก API เมื่อเปิดหน้า
2. subscribe realtime เพื่อรับสัญญาณว่ามีการเปลี่ยนแปลง
3. เมื่อได้รับ event ให้ refetch aggregate ที่เกี่ยวข้อง ไม่ merge state แบบเดาสุ่ม
4. ถ้า connection ขาด แสดง `OFFLINE` และเวลาที่ sync ล่าสุด
5. เมื่อกลับมา online ให้ยกเลิก subscription เดิม, สร้างใหม่ และทำ catch-up query
6. ถ้า command สำเร็จแต่หน้าจอไม่อัปเดต ให้ refetch ไม่ส่ง command ซ้ำ

### 4.8 Workflow G — Supervisor / recovery

Supervisor ต้องทำได้จากหน้าจอเดียว:

- ค้น order/bag จาก order no, SKU, barcode และสถานะ
- ดู timeline ทุก transition และ error
- ปลด lease ที่ค้างหลังตรวจสอบ
- ย้ายงานเป็น `BLOCKED`, `REWORK` หรือ `CANCELLED` โดยระบบบันทึก error code/ผู้ทำ/เวลาอัตโนมัติ
- retry/verify print job
- ตรวจ station, agent, printer และ backlog
- replay outbox event ที่ค้าง โดยไม่สร้าง order/bag ซ้ำ

### 4.9 ตารางสถานะและผู้มีสิทธิ์

| จาก | ไป | ผู้ทำ | เงื่อนไข |
|---|---|---|---|
| `QUEUED` | `CLAIMED` | Grinder/Packer | claim สำเร็จและยังไม่มีคนถือ lease |
| `CLAIMED` | `GRINDING` | Grinder | Bag/Job Barcode และเบอร์บดผ่านการตรวจสอบ |
| `GRINDING` | `GROUND` | Grinder | ยืนยันบดเสร็จ |
| `GROUND` | `PACKING` | Packer | ตรวจรายการผ่าน |
| `PACKING` | `COMPLETED` | Packer | ยืนยันแพ็คเสร็จ |
| ทุกสถานะที่ยังไม่จบ | `BLOCKED` | Operator/Supervisor | บันทึกผู้ทำและเวลาอัตโนมัติ |
| `BLOCKED` | สถานะเดิม/ถัดไป | Supervisor | บันทึกการแก้ไขอัตโนมัติ |
| งานที่จบแล้ว | `REWORK` | Supervisor | ต้องเปิด rework ใหม่ ห้ามแก้ทับประวัติ |

## 5. Data model

ตารางหลัก:

- `products`: SKU, ชื่อ, หน่วย, product_type, active, version
- `product_barcodes`: product_id, barcode, barcode_type, active, valid_from, valid_to, created_by
- `grind_profiles`: product_id, grind_value, grind_barcode, active, version
- `grind_size_codes`: grind_value, barcode, active, sort_order (ค่าเริ่มต้น 5 ค่า: 6, 8, 10, 12, 15)
- `grinder_users`: รายชื่อคนบด, active, sort_order (Admin เป็นผู้ดูแล)
- `orders`: order_id, order_no, source, priority, status, client_request_id, created_by, timestamps
- `order_items`: order_id, product_id, quantity
- `bags`: order_id, bag_no, product/barcode snapshot, grind snapshot, quantity (1), status, queue_seq, timestamps
- `job_events`: bag_id, from_status, to_status, actor, station, system_code, event_id, created_at (ไม่ให้ผู้ใช้พิมพ์ reason)
- `print_jobs`: bag/order reference, template_version, payload_snapshot, status, attempts, next_attempt_at, last_error, printed_at
- `outbox_events`: event_id, aggregate_type/id, event_type, payload, published_at, attempts, available_at
- `agent_heartbeats`: agent_id, station, last_seen_at, printer_status, app_version
- `audit_log`: actor, action, entity, before/after summary, request_id, created_at
- `app_settings`: station configuration, SLA, numbering configuration

ข้อกำหนดสำคัญ:

- ใช้ UUID เป็น primary key และใช้ `queue_seq` เป็นเลขคิวที่มี unique constraint ตาม business scope
- barcode ต้องเก็บเป็น text ห้ามแปลงเป็น number และต้อง normalize ก่อนค้นหา
- barcode หนึ่งค่า active ได้กับสินค้าเดียวเท่านั้น แต่สินค้าหนึ่งรายการมีหลาย barcode ได้
- unique: product SKU, active product barcode, order client_request_id, event_id, active grind profile ต่อ product/grind value
- foreign key ทุกความสัมพันธ์, check constraint สำหรับ status/priority และ index ที่ `status`, `queue_seq`, `created_at`, `next_attempt_at`
- `bags` เก็บ snapshot เช่น `product_name_snapshot`, `size_snapshot`, `grind_value_snapshot`
- ห้าม hard delete order/bag/event; ใช้ cancelled/voided

## 5.1 Workflow Admin — เพิ่ม SKU และ barcode ในอนาคต

ผู้รับผิดชอบ: Admin เท่านั้น

หน้า Admin เป็นศูนย์กลางจัดการระบบทั้งหมด และต้องรองรับ CRUD (Create, Read, Update, Delete) สำหรับข้อมูลที่อยู่ในขอบเขตของระบบ ได้แก่ Products/SKU, Product Barcodes, Grind Profiles, Grind Barcode, Grinder Users, Users/Roles, Stations, Printers/Print Agents, Queue Settings, SLA, Priority Policy และ App Settings รวมถึงการค้นหา กรอง เปิด/ปิดใช้งาน และนำเข้าข้อมูลแบบ bulk

```text
Admin เปิด Master Data > Products
  ↓
เพิ่ม SKU หรือเปิดสินค้าเดิม
  ↓
กรอก SKU + ชื่อสินค้า + หน่วย + ประเภทสินค้า
  ↓
เพิ่ม barcode ได้ 1 รายการหรือหลายรายการ
  ↓
ระบบตรวจ barcode ซ้ำทั้งระบบ
  ↓
บันทึก
  ↓
สินค้าใช้งานได้ทันทีสำหรับออเดอร์ใหม่
```

กติกา:

- SKU และ barcode ต้องเก็บเป็น text เพื่อรักษาเลขศูนย์นำหน้า
- barcode ใหม่ต้องไม่ซ้ำกับสินค้าอื่นที่ active
- ปิดใช้งาน barcode เดิมได้โดยไม่ลบประวัติ
- สินค้าที่ถูกใช้ในออเดอร์แล้วห้าม hard delete ให้เปลี่ยนเป็น inactive
- การเปลี่ยน Master Data มีผลกับออเดอร์ใหม่เท่านั้น ออเดอร์เก่าใช้ snapshot เดิม
- การเพิ่ม barcode ไม่ต้องแก้โค้ดและไม่ต้อง deploy ระบบใหม่
- ทุกการเพิ่ม แก้ ปิดใช้งาน และนำเข้าแบบ bulk บันทึกผู้ทำและเวลาอัตโนมัติ
- หลังบันทึก Admin ต้องทดสอบ scan จากหน้า Counter หรือใช้ปุ่ม `ทดสอบ barcode`
- CRUD ทุกโมดูลต้องมี validation, confirmation ก่อนการลบ/ปิดใช้งาน และแสดงผลสำเร็จ/ล้มเหลวจาก server
- ข้อมูลที่ถูกอ้างอิงโดย order, bag, event หรือ audit ห้าม hard delete; ปุ่ม `ลบ` ให้ทำ soft delete/inactive และเก็บประวัติ
- ข้อมูลที่ยังไม่ถูกใช้งานจึง hard delete ได้ และต้องยืนยันซ้ำโดย Admin
- Admin แก้สถานะงาน, retry print, ปลด lease, rework และ cancel ได้ผ่าน command เฉพาะ พร้อม audit อัตโนมัติ
- ห้ามให้ Admin แก้ `order_no`, `queue_seq`, `bag_id`, `event_id` หรือประวัติ transition โดยตรง
- การแก้ Master Data มีผลกับออเดอร์ใหม่เท่านั้น งานเก่าใช้ snapshot เดิม

โครงสร้างที่แนะนำคือแยก `products` กับ `product_barcodes` ไม่เก็บ barcode หลายค่ารวมในช่องเดียว เพื่อให้ค้นหาเร็ว ตรวจซ้ำได้ และรองรับ barcode ใหม่ในอนาคต

## 6. State machine

สถานะของ bag:

```text
QUEUED -> CLAIMED -> GRINDING -> GROUND -> PACKING -> COMPLETED
   |         |          |          |         |
   +-------> BLOCKED / REWORK <----+---------+
                         |
                       CANCELLED
```

กติกา:

- `QUEUED`: รอคิวและยังไม่ถูก claim
- `CLAIMED`: worker/operator จองงานพร้อม lease หมดอายุ
- `GRINDING`: เริ่มบดแล้ว
- `GROUND`: บดเสร็จ รอแพ็ค
- `PACKING`: กำลังแพ็ค
- `COMPLETED`: ปิดงานถาวร แก้ไขได้เฉพาะผ่าน rework command
- `BLOCKED`: ใช้เมื่อระบบ/ผู้ควบคุมหยุดงาน โดยเก็บ system_code, ผู้ทำ และเวลาอัตโนมัติ ไม่ถาม reason
- ทุก transition ตรวจ `expected_version` หรือ lock ใน transaction เพื่อกันกดซ้ำ/สองเครื่องชนกัน
- งานปกติเลือก `queue_seq` ต่ำสุดที่ยังพร้อมทำ; งานด่วนต้องมี policy ชัดเจนและบันทึกผู้อนุมัติ/เวลาอัตโนมัติ ไม่ให้แทรกแบบเงียบ ๆ

ใช้ database function/transaction สำหรับ `claim_next_job` และ `transition_job` โดย lock แถวที่เกี่ยวข้อง (`FOR UPDATE SKIP LOCKED` เมื่อเหมาะสม) และคืนผลลัพธ์ authoritative กลับ client

## 7. Workflow ที่เสถียร

### Create order

1. Client สร้าง `client_request_id` และส่ง command
2. Server validate product barcode, SKU, quantity และ active grind profile
3. transaction สร้าง order/items/bags พร้อม snapshot และ queue sequence
4. transaction สร้าง outbox event และ print jobs
5. commit แล้วจึงตอบ order number ให้ client
6. client retry key เดิมได้ ผลลัพธ์ต้องเป็น order เดิม ไม่สร้างซ้ำ

### Station processing

1. station ดึงรายการจาก API เมื่อเปิดหน้าและหลัง reconnect
2. realtime event แจ้งให้ refresh เฉพาะ aggregate ที่เปลี่ยน
3. operator scan SKU; server ตรวจ SKU กับ bag ที่ถูก claim
4. server transition พร้อม audit event ใน transaction
5. ถ้า realtime หาย ผู้ใช้ยังทำงานต่อผ่าน command และ refresh ได้

### Refresh/reconnect

- ทุก station มี initial sync จาก server
- เก็บ `last_seen_event_at` หรือ cursor และทำ catch-up query หลัง reconnect
- ห้ามเชื่อ state ที่ค้างใน browser มากกว่า state จาก server
- แสดง connection state, last successful sync และเวลาที่ข้อมูลล่าสุดอย่างชัดเจน

## 8. Printing ที่ไม่ทำงานหาย

Print job ต้องเป็น durable queue ใน PostgreSQL:

- สร้างพร้อม order ใน transaction เดียวกัน
- agent ดึงงานด้วย lease: `leased_until`, `agent_id`, `attempts`
- พิมพ์สำเร็จแล้วค่อย mark `PRINTED` พร้อม timestamp
- timeout/crash ทำให้ lease หมดอายุและงานกลับมา retry
- printer offline/paper out ใช้ exponential backoff และแจ้งเตือนหลังเกิน threshold
- ป้องกันพิมพ์ซ้ำด้วย `print_job_id` และ agent local spool/receipt เมื่อเครื่องพิมพ์รองรับ
- มีหน้าจอ `PENDING / PRINTING / PRINTED / FAILED / CANCELLED` และปุ่ม retry ที่บันทึกผู้กด
- payload ที่พิมพ์ต้องเป็น snapshot ไม่ query ข้อมูลปัจจุบันมาทับใบงานเก่า

ข้อควรยอมรับ: เครื่องพิมพ์ทั่วไปไม่สามารถรับประกัน exactly-once ได้สมบูรณ์ หากไฟดับหลังพิมพ์แต่ก่อน server รับ acknowledgement ดังนั้น UX ต้องมี `UNKNOWN / VERIFY` และให้ operator ยืนยันก่อน retry เพื่อหลีกเลี่ยงใบงานซ้ำ

## 9. Security และสิทธิ์

บทบาทอย่างน้อย:

- `counter`: สร้าง order และดู queue ที่เกี่ยวข้อง
- `grinder`: claim/transition งานบด
- `packer`: transition งานแพ็ค/ปิดงาน
- `supervisor`: override, rework, cancel, retry print, ดูทุก station
- `admin`: ใช้งาน Packing Workspace และ CRUD/กำกับดูแลทุกโมดูลในระบบ รวมถึง master data, users, roles, stations, printers, queue, settings, recovery และ reports

RLS ต้องป้องกันการอ่าน/เขียนข้ามบทบาท แต่ command สำคัญควรผ่าน server/RPC ที่ตรวจสิทธิ์ซ้ำ ไม่พึ่งการซ่อนปุ่ม frontend; service role ห้ามส่งไป browser; audit log ต้อง append-only

## 10. Observability และ recovery

ต้องมี:

- structured log พร้อม `request_id`, `order_id`, `bag_id`, `event_id`, `agent_id`
- metrics: order create failure, transition conflict, queue age, SLA breach, print retry, realtime reconnect, agent heartbeat age
- `/api/health`: database, realtime configuration, outbox backlog, print backlog
- supervisor dashboard แสดง station/agent/printer offline จาก heartbeat timeout
- daily backup และทดสอบ restore เป็นระยะ; migration ต้อง versioned และ rollback plan ชัดเจน
- dead-letter หรือ `FAILED` state สำหรับ outbox/print ที่ retry เกิน limit พร้อม manual replay
- clock ใช้ server timestamp เป็นหลัก และเก็บ timezone เป็น UTC ในฐานข้อมูล

## 11. Test plan ก่อนใช้งานจริง

ต้องผ่านอย่างน้อย:

- duplicate submit 10 ครั้งได้ order เดียว
- สอง operator claim งานเดียวพร้อมกันได้ผู้ชนะเพียงคนเดียว
- refresh/reconnect ทุกจุดไม่ทำสถานะย้อนหรือสร้างงานซ้ำ
- เปลี่ยน Master Data หลังสร้าง order แล้วใบงานเดิมยังใช้ snapshot เดิม
- database commit สำเร็จแต่ realtime หาย ระบบยังทำงานและ catch up ได้
- agent crash ระหว่าง print แล้ว lease/retry ทำงานถูกต้อง
- printer offline/paper out งานยังค้างและกลับมาพิมพ์ได้
- transition ผิดลำดับถูกปฏิเสธและมี audit
- permission test ทุก role และ RLS test ทั้ง read/write
- load test จำนวน order และ realtime subscribers ตาม peak จริง
- visual/functional test ที่ viewport 375, 768, 1280 และตรวจ horizontal overflow เป็นศูนย์

## 12. ลำดับการพัฒนา

1. เขียน migration, constraints, RLS และ state transition RPC
2. ทำ order creation แบบ idempotent และหน้าร้านขั้นต่ำ
3. ทำ station command + audit + reconnect sync
4. ทำ outbox และ realtime notification
5. ทำ Linux Print Agent และ print recovery
6. ทำ master data, supervisor controls, dashboard และ reports
7. ทำ failure-injection tests, backup/restore drill และ pilot ใช้งานจริง

เกณฑ์พร้อมใช้งานจริง: ไม่มี command สำคัญที่แก้ฐานข้อมูลตรงจาก client, ทุกงานมีประวัติ transition, ทุก print job ตรวจสอบสถานะได้, retry ได้โดยไม่ทำ order หาย และ supervisor สามารถกู้ทุกกรณีที่ไม่ใช่ความเสียหายทางกายภาพของเครื่องพิมพ์
