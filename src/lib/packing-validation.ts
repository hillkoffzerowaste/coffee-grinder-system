import {z} from "zod";

export const blendBatchStartSchema = z.object({
  clientRequestId:z.uuid(),orderId:z.uuid(),blendGroupNo:z.number().int().min(1),quantity:z.number().int().min(1).max(500),grinderUserId:z.uuid(),bagIds:z.array(z.uuid()).min(1).max(500).optional(),
}).strict().superRefine((value,ctx)=>{
  if(value.bagIds&&new Set(value.bagIds).size!==value.bagIds.length)ctx.addIssue({code:"custom",path:["bagIds"],message:"ถุงที่สแกนซ้ำกัน"});
});
