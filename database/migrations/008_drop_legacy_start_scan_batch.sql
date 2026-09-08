-- ตัวเก่า 6 พารามิเตอร์ถูกคงไว้ตอน 007 เพื่อให้ช่วง rolling deploy โค้ดเก่ายังเรียกได้
-- ตอนนี้ production รันตัว 7 พารามิเตอร์แล้ว ตัวเก่าจึงเหลือเป็นทางเริ่มงานที่ข้ามชุด blend ได้
drop function if exists coffee.start_scan_batch(uuid,uuid,text,uuid,integer,uuid);
