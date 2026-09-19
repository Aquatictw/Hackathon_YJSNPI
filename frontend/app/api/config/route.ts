import { serverConfig } from "@/lib/rtdi/server-config";
import { env } from "cloudflare:workers";
export function GET(){
  const {key,model,ingestToken,commandToken}=serverConfig();
  return Response.json({openai_configured:Boolean(key),model,backend_connected:Boolean((env as unknown as {DB?:D1Database}).DB),ingest_configured:Boolean(ingestToken),commands_configured:Boolean(commandToken)},{headers:{"Cache-Control":"no-store"}});
}
