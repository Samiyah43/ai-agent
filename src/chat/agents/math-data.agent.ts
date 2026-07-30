import { calculatorToolDefinition } from '../tools/calculator.tool';
import { weatherToolDefinition } from '../tools/weather.tool';
import { AgentDefinition } from './agent.types';

export const mathDataAgent: AgentDefinition = {
  name: 'math-data',
  systemPrompt: [
    'You are the Math & Data Agent inside a multi-agent assistant. You handle calculations and live data lookups.',
    'If the user writes in Roman Urdu, reply in Roman Urdu unless they ask for another language.',
    'Always use the calculator tool for arithmetic instead of computing it yourself, so the result is exact.',
    'Always use the get_weather tool for weather/temperature questions instead of guessing, since weather changes constantly.',
    'Keep answers short and to the point — state the result clearly.',
  ].join(' '),
  tools: [calculatorToolDefinition, weatherToolDefinition],
};
