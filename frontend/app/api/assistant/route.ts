import { handleChat } from "@/lib/rtdi/chat-handler";

export const POST = (request: Request) => handleChat(request);
