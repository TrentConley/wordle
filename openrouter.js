import axios from 'axios';
import dotenv from 'dotenv';
import { writeFileSync, appendFileSync } from 'fs';
import { MODEL_CONFIGS } from './config.js';

dotenv.config();

export class OpenRouterClient {
  constructor() {
    this.apiKey = process.env.OPENROUTER_API_KEY;
    this.baseURL = 'https://openrouter.ai/api/v1';
    
    if (!this.apiKey) {
      throw new Error('OPENROUTER_API_KEY environment variable is required');
    }
  }

  async chat(model, messages, maxTokens = 50) {
    const modelConfig = MODEL_CONFIGS[model] || {};
    const requestBody = {
      model: model,
      messages: messages,
      max_tokens: maxTokens,
      temperature: modelConfig.temperature || 0.1
    };

    // Add reasoning parameters if specified in config
    if (modelConfig.reasoning) {
      if (typeof modelConfig.reasoning === 'object') {
        requestBody.reasoning = modelConfig.reasoning;
      } else if (modelConfig.reasoning === true) {
        requestBody.reasoning = true;
      }
    }

    try {
      const response = await axios.post(
        `${this.baseURL}/chat/completions`,
        requestBody,
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'http://localhost:8080',
            'X-Title': 'LLM Wordle Arena'
          }
        }
      );

      const content = response.data.choices[0].message.content.trim();
      
      // Strict validation: must be exactly one 5-letter word
      const words = content.split(/\s+/).filter(w => w.length > 0);
      if (words.length !== 1) {
        throw new Error(`Invalid response: Expected exactly 1 word, got ${words.length} words: "${content}"`);
      }
      
      const word = words[0].toUpperCase().replace(/[^A-Z]/g, '');
      if (word.length !== 5) {
        throw new Error(`Invalid response: Word must be exactly 5 letters, got "${word}" (${word.length} letters)`);
      }
      
      return word;
    } catch (error) {
      const errorDetails = {
        model: model,
        timestamp: new Date().toISOString(),
        type: error.response ? 'API_ERROR' : 'NETWORK_ERROR',
        message: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        prompt: messages[0]?.content?.substring(0, 200) + '...',
        requestBody: JSON.stringify(requestBody, null, 2)
      };
      
      console.error(`🚨 ERROR calling ${model}:`, JSON.stringify(errorDetails, null, 2));
      
      // Log to file
      const logEntry = `${new Date().toISOString()} - ERROR: ${JSON.stringify(errorDetails)}\n`;
      appendFileSync('arena-errors.log', logEntry);
      
      throw error;
    }
  }

  async getModels() {
    try {
      const response = await axios.get(`${this.baseURL}/models`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        }
      });
      
      return response.data.data;
    } catch (error) {
      console.error('Error fetching models:', error.response?.data || error.message);
      throw error;
    }
  }
}