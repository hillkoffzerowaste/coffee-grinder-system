import {z} from "zod";

export const blendBatchStartSchema = z.object({
  clientRequestId:z.uuid(),orderId:z.uuid(),blendGroupNo:z.number().int().min(1),quantity:z.number().int().min(1).max(500),grinderUserId:z.uuid(),
}).strict();
