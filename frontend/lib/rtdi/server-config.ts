import { env } from "cloudflare:workers";
export function serverConfig(){
  const bindings=env as unknown as Record<string,string|undefined>;
  return {key:bindings.OPENAI_API_KEY||process.env.OPENAI_API_KEY||"",model:bindings.OPENAI_MODEL||process.env.OPENAI_MODEL||"gpt-6-astra"};
}
