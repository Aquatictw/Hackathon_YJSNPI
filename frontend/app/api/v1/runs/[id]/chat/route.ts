import { handleChat } from "@/lib/rtdi/chat-handler";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return handleChat(request, id);
}
