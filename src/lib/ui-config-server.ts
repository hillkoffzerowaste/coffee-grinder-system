import { readRows } from "@/lib/db";
import { defaultUiConfig, parseUiConfig, type UiConfig } from "@/lib/ui-config";

export async function publishedUiConfig(actorId:string):Promise<UiConfig>{
 try{const [row]=await readRows<{config:unknown}>(actorId,"select config from coffee.ui_config_versions where status='PUBLISHED' order by published_at desc nulls last limit 1");const parsed=row&&parseUiConfig(row.config);return parsed?.success?parsed.data:defaultUiConfig;}catch{return defaultUiConfig;}
}
