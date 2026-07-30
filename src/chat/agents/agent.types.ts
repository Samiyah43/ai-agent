import OpenAI from 'openai';

// One specialist agent: its own system prompt and its own subset of tools.
// The router picks one of these per user message; ChatService then runs the
// existing tool-calling loop scoped to just that agent's tools.
export interface AgentDefinition {
  name: string;
  systemPrompt: string;
  tools: OpenAI.Chat.ChatCompletionTool[];
}
