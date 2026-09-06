import { transaction } from "@/lib/db";
import { defaultUiConfig, parseUiConfig, type UiConfig } from "@/lib/ui-config";

export async function publishedUiConfig(_:string):Promise<UiConfig>{
 try{const [row]=await transaction(async client=>(await client.query<{config:unknown}>("select config from coffee.ui_config_versions where status='PUBLISHED' order by published_at desc nulls last limit 1")).rows);const parsed=row&&parseUiConfig(row.config);return parsed?.success?parsed.data:defaultUiConfig;}catch{return defaultUiConfig;}
}
