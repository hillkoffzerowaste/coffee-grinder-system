import type { JobStatus } from "./types";
export const jobStatusLabels: Record<JobStatus,string> = {
  QUEUED:"รอรับงาน",CLAIMED:"รับงานแล้ว",GRINDING:"กำลังบด",COMPLETED:"เสร็จแล้ว",
  BLOCKED:"พักงาน",CANCELLED:"ยกเลิก",
};
