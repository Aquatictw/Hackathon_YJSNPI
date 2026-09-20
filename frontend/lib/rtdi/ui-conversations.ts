import {z} from 'zod';

const scopeSchema = z.object({run: z.string().min(1), tester: z.string().min(1)});
const contextSchema = z.tuple([z.enum(['incident', 'event', 'run']), z.string()]);
const messageSchema = z.object({
  role: z.enum(['user', 'assistant']), text: z.string(),
  refs: z.array(z.string()).optional(), knowledgeRefs: z.array(z.string()).optional(), id: z.string().optional(),
});
const conversationSchema = z.object({messages: z.array(messageSchema), question: z.string()});
const sessionSchema = z.object({
  version: z.literal(1), lastScope: scopeSchema.nullable(),
  selections: z.array(z.object({scope: scopeSchema, selected: z.string()})),
  conversations: z.array(z.object({scope: scopeSchema, context: contextSchema, value: conversationSchema})),
});
export type ConversationScope = z.infer<typeof scopeSchema>;
export type ConversationContext = z.infer<typeof contextSchema>;
export type ConversationMessage = z.infer<typeof messageSchema>;
export type ConversationStorage = Pick<Storage, 'getItem' | 'setItem'>;
type Conversation = z.infer<typeof conversationSchema>;
export const CONVERSATION_SESSION_KEY = 'rtdi.dashboard.conversations.v1';
// Bound parsing and synchronous session writes. In-memory conversations remain
// intact if the browser denies storage, exceeds quota, or reaches this limit.
const MAX_SESSION_CHARS = 2_000_000;
const scopeKey = (scope: ConversationScope) => JSON.stringify([scope.run, scope.tester]);
export const conversationKey = (scope: ConversationScope, context: ConversationContext) =>
  JSON.stringify([scope.run, scope.tester, ...context]);

/** Browser-independent cache. Only validated snapshots may supply its scope. */
export function createConversationCache(storage?: ConversationStorage) {
  let lastScope: ConversationScope | null = null;
  const selections = new Map<string, {scope: ConversationScope; selected: string}>();
  const conversations = new Map<string, {scope: ConversationScope; context: ConversationContext; value: Conversation}>();
  try {
    const raw = storage?.getItem(CONVERSATION_SESSION_KEY);
    if (raw && raw.length <= MAX_SESSION_CHARS) {
      const parsed = sessionSchema.safeParse(JSON.parse(raw));
      if (parsed.success) {
        lastScope = parsed.data.lastScope;
        for (const entry of parsed.data.selections) selections.set(scopeKey(entry.scope), entry);
        for (const entry of parsed.data.conversations) conversations.set(conversationKey(entry.scope, entry.context), entry);
      }
    }
  } catch { /* An unavailable or corrupt session must not prevent connection. */ }
  const persist = () => {
    if (!storage) return;
    try {
      const raw = JSON.stringify({version: 1, lastScope, selections: [...selections.values()], conversations: [...conversations.values()]});
      if (raw.length <= MAX_SESSION_CHARS) storage.setItem(CONVERSATION_SESSION_KEY, raw);
    } catch { /* Keep the current in-memory session when storage is denied/full. */ }
  };
  return {
    forget(scope: ConversationScope) {
      const key = scopeKey(scope);
      selections.delete(key);
      for (const [id, entry] of conversations) if (scopeKey(entry.scope) === key) conversations.delete(id);
      if (lastScope && scopeKey(lastScope) === key) lastScope = null;
      // A deletion can finish after route unmount. Preserve newer conversations
      // written by the destination controller rather than saving our stale cache.
      try {
        const raw = storage?.getItem(CONVERSATION_SESSION_KEY);
        const parsed = raw && raw.length <= MAX_SESSION_CHARS ? sessionSchema.safeParse(JSON.parse(raw)) : null;
        if (parsed?.success) {
          const saved = parsed.data;
          saved.selections = saved.selections.filter(entry => scopeKey(entry.scope) !== key);
          saved.conversations = saved.conversations.filter(entry => scopeKey(entry.scope) !== key);
          if (saved.lastScope && scopeKey(saved.lastScope) === key) saved.lastScope = null;
          storage?.setItem(CONVERSATION_SESSION_KEY, JSON.stringify(saved));
          return;
        }
      } catch { /* In-memory cleanup still succeeds when storage is unavailable. */ }
      persist();
    },
    lastScope: () => lastScope,
    selected: (scope: ConversationScope) => selections.get(scopeKey(scope))?.selected ?? '',
    read: (scope: ConversationScope, context: ConversationContext): Conversation =>
      conversations.get(conversationKey(scope, context))?.value ?? {messages: [], question: ''},
    write(scope: ConversationScope, context: ConversationContext, value: Conversation, selected: string) {
      lastScope = scope;
      selections.set(scopeKey(scope), {scope, selected});
      conversations.set(conversationKey(scope, context), {scope, context, value});
      persist();
    },
  };
}
