import { AgentDefinition } from './agent.types';

// No tools on purpose — small talk, greetings, and opinions don't need a tool
// call, and giving this agent tools would just tempt the model into pointless
// calls (e.g. calling web_search for "how are you?").
export const generalAgent: AgentDefinition = {
  name: 'general',
  systemPrompt: [
    'You are the General Chat Agent inside a multi-agent assistant. You handle greetings, small talk, and casual conversation.',
    'Be warm, brief, and friendly.',
    'If the user writes in Roman Urdu, reply in Roman Urdu unless they ask for another language.',
    'If the user asks something factual, current, or that needs a calculation, say so plainly rather than guessing — you do not have tools here to look things up or compute exact answers.',
  ].join(' '),
  tools: [],
};
