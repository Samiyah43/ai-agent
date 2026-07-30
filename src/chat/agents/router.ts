import { AgentDefinition } from './agent.types';
import { generalAgent } from './general.agent';
import { mathDataAgent } from './math-data.agent';
import { researchAgent } from './research.agent';

// A raw arithmetic expression like "2 + 2" or "10 * 5" has no keyword to match,
// so this looks for <number> <operator> <number> directly.
const ARITHMETIC_PATTERN = /\d\s*[-+*/^x×÷]\s*\d/i;

const MATH_DATA_PATTERN =
  /\b(calculate|compute|sum|total|multiply|multiplied|times|divide|divided|plus|minus|square root|percentage|weather|mausam|temperature|forecast|climate|garmi|sardi)\b/i;

const SMALL_TALK_PATTERN =
  /^\s*(hi|hello|hey|salam|assalam|asalam|good morning|good evening|good night|kya hal|kaisay ho|kaise ho|how are you|thanks|thank you|shukriya|bye|goodbye)\b|\b(tell me a joke|who are you|what can you do|tell me about yourself)\b/i;

// Deterministic keyword-based routing, same philosophy as needsWebSearch() in
// research.agent.ts: small/free models are unreliable at *deciding* which
// specialist should handle a message, so classification is done in code
// rather than trusting a model call. researchAgent is the fallback because it
// is the most versatile (web_search + knowledge_base), matching the old
// single-agent behaviour for anything that isn't clearly math/data or small talk.
export function routeToAgent(message: string): AgentDefinition {
  if (MATH_DATA_PATTERN.test(message) || ARITHMETIC_PATTERN.test(message)) {
    return mathDataAgent;
  }
  if (SMALL_TALK_PATTERN.test(message)) {
    return generalAgent;
  }
  return researchAgent;
}
