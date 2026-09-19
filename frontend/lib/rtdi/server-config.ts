import { env } from "cloudflare:workers";
export function serverConfig(){
  const bindings=env as unknown as Record<string,string|undefined>;
  return {
    publicOrigin:bindings.APP_ORIGIN||process.env.APP_ORIGIN||"",
    key:bindings.OPENAI_API_KEY||process.env.OPENAI_API_KEY||"",
    model:bindings.OPENAI_MODEL||process.env.OPENAI_MODEL||"gpt-5.6-sol",
    ingestToken:bindings.INGEST_TOKEN||process.env.INGEST_TOKEN||"",
    commandToken:bindings.COMMAND_TOKEN||process.env.COMMAND_TOKEN||"",
  };
}
