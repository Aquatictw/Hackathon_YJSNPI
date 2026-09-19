import { serverConfig } from "@/lib/rtdi/server-config";
export function GET(){
  const {key,model}=serverConfig();
  return Response.json({openai_configured:Boolean(key),model,backend_connected:false},{headers:{"Cache-Control":"no-store"}});
}
