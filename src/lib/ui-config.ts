import { z } from "zod";

const color = z.string().regex(/^#[0-9a-f]{6}$/i);
const menu = z.object({id:z.enum(["counter","packing","admin"]),label:z.string().trim().min(1).max(40),visible:z.boolean(),order:z.number().int().min(0).max(20)}).strict();
export const uiConfigSchema = z.object({
  theme:z.object({accent:color,contrast:color,density:z.enum(["compact","comfortable"]),buttonSize:z.enum(["normal","large"])}).strict(),
  menus:z.array(menu).length(3).superRefine((items,ctx)=>{if(new Set(items.map(item=>item.id)).size!==3)ctx.addIssue({code:"custom",message:"Menu ids must be unique"});}),
  layouts:z.object({counter:z.object({main:z.enum(["left","center","wide"]),detail:z.enum(["right","bottom"])}).strict(),packing:z.object({main:z.enum(["left","center","wide"]),detail:z.enum(["right","bottom"])}).strict()}).strict(),
  sounds:z.object({queue:z.enum(["chime","pulse","alert"]),overdue:z.enum(["chime","pulse","alert"]),sla:z.enum(["chime","pulse","alert"]),volume:z.number().min(0).max(1)}).strict(),
  operations:z.object({slaGrams:z.number().int().min(1).max(5000),slaSeconds:z.number().int().min(1).max(3600),overdueSeconds:z.number().int().min(30).max(3600)}).strict(),
}).strict();
export type UiConfig=z.infer<typeof uiConfigSchema>;
export const defaultUiConfig:UiConfig={
  theme:{accent:"#064f4d",contrast:"#f3f7f7",density:"comfortable",buttonSize:"normal"},
  menus:[{id:"counter",label:"หน้าร้าน",visible:true,order:0},{id:"packing",label:"ห้องแพ็ค",visible:true,order:1},{id:"admin",label:"Admin Console",visible:true,order:2}],
  layouts:{counter:{main:"left",detail:"right"},packing:{main:"left",detail:"right"}},
  sounds:{queue:"alert",overdue:"alert",sla:"pulse",volume:1},
  operations:{slaGrams:500,slaSeconds:120,overdueSeconds:60},
};
export function parseUiConfig(value:unknown){return uiConfigSchema.safeParse(value);}
