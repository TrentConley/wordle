export const DEFAULT_MODELS = [
  'anthropic/claude-3.5-sonnet',
  'openai/gpt-4o',
  'openai/gpt-4o-mini',
  'meta-llama/llama-3.1-70b-instruct',
  'google/gemini-pro-1.5',
  'mistralai/mistral-7b-instruct'
];

export const PREMIUM_MODELS = [
  'anthropic/claude-sonnet-4',
  'anthropic/claude-opus-4.1',
  'openai/gpt-5-chat',
  'moonshotai/kimi-k2',
  'openai/gpt-4o-2024-11-20',
  'anthropic/claude-3.5-sonnet-20241022',
  'anthropic/claude-3.5-sonnet',
  'google/gemini-pro-1.5',
  'openai/gpt-4o'
];

export const CUTTING_EDGE_MODELS = [
  'google/gemini-2.5-flash',
  'x-ai/grok-4',
  'openai/gpt-5-high',
  'anthropic/claude-opus-4',
  'google/gemini-2.0-pro',
  'meta-llama/llama-3.3-70b-instruct',
  'deepseek/deepseek-r1',
  'openai/o3-mini'
];

export const GROK_GPT5_TEST = [
  'x-ai/grok-4',
  'openai/gpt-5-chat'
];

export const BUDGET_MODELS = [
  'openai/gpt-4o-mini',
  'anthropic/claude-3-haiku',
  'meta-llama/llama-3.1-8b-instruct',
  'mistralai/mistral-7b-instruct',
  'google/gemma-2-9b-it'
];

export const MODEL_CONFIGS = {
  'anthropic/claude-3.5-sonnet': {
    maxTokens: 50,
    temperature: 0.1,
    cost: 'high'
  },
  'openai/gpt-4o': {
    maxTokens: 50,
    temperature: 0.1,
    cost: 'high'
  },
  'openai/gpt-4o-mini': {
    maxTokens: 50,
    temperature: 0.1,
    cost: 'low'
  },
  'meta-llama/llama-3.1-70b-instruct': {
    maxTokens: 50,
    temperature: 0.1,
    cost: 'medium'
  },
  'google/gemini-pro-1.5': {
    maxTokens: 50,
    temperature: 0.1,
    cost: 'medium'
  },
  'mistralai/mistral-7b-instruct': {
    maxTokens: 50,
    temperature: 0.1,
    cost: 'low'
  },
  'openai/chatgpt-4o-latest': {
    maxTokens: 50,
    temperature: 0.1,
    cost: 'premium'
  },
  'openai/gpt-4o-2024-11-20': {
    maxTokens: 50,
    temperature: 0.1,
    cost: 'premium'
  },
  'anthropic/claude-3.5-sonnet-20241022': {
    maxTokens: 50,
    temperature: 0.1,
    cost: 'premium'
  },
  'meta-llama/llama-3.2-90b-vision-instruct': {
    maxTokens: 50,
    temperature: 0.1,
    cost: 'premium'
  },
  'anthropic/claude-opus-4.1': {
    maxTokens: 50,
    temperature: 0.1,
    cost: 'premium'
  },
  'openai/gpt-5-chat': {
    maxTokens: 50,
    temperature: 0.1,
    cost: 'premium'
  },
  'moonshotai/kimi-k2': {
    maxTokens: 50,
    temperature: 0.1,
    cost: 'premium'
  },
  'anthropic/claude-sonnet-4': {
    maxTokens: 50,
    temperature: 0.1,
    cost: 'premium'
  },
  'x-ai/grok-4': {
    maxTokens: 50,
    temperature: 0.1,
    cost: 'premium'
  },
  'openai/gpt-5-chat': {
    maxTokens: 50,
    temperature: 0.1,
    cost: 'premium',
    reasoning: {
      effort: 'high'
    }
  },
  'anthropic/claude-opus-4': {
    maxTokens: 50,
    temperature: 0.1,
    cost: 'premium'
  },
  'google/gemini-2.0-pro': {
    maxTokens: 50,
    temperature: 0.1,
    cost: 'premium'
  },
  'meta-llama/llama-3.3-70b-instruct': {
    maxTokens: 50,
    temperature: 0.1,
    cost: 'medium'
  },
  'deepseek/deepseek-r1': {
    maxTokens: 50,
    temperature: 0.1,
    cost: 'medium'
  },
  'openai/o3-mini': {
    maxTokens: 50,
    temperature: 0.1,
    cost: 'premium'
  },
  'google/gemini-2.5-flash': {
    maxTokens: 50,
    temperature: 0.1,
    cost: 'premium'
  }
};

export const ARENA_CONFIG = {
  defaultRounds: 20,
  maxRetries: 3,
  delayBetweenRequests: 100,
  timeout: 30000
};