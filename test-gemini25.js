import { OpenRouterClient } from './openrouter.js';

async function testGemini25() {
  const client = new OpenRouterClient();
  
  const messages = [
    {
      role: 'user',
      content: 'You are playing Wordle. Respond with ONLY a single 5-letter word in uppercase. No explanations, no punctuation, no extra text. Just the word.'
    }
  ];
  
  try {
    console.log('Testing Gemini 2.5 Pro...');
    const response = await client.chat('google/gemini-2.5-flash', messages, 50);
    console.log('✅ Success! Response:', response);
    
    // Try a few more times
    for (let i = 1; i <= 3; i++) {
      console.log(`\nAttempt ${i + 1}:`);
      try {
        const resp = await client.chat('google/gemini-2.5-flash', messages, 50);
        console.log('✅ Response:', resp);
      } catch (err) {
        console.log('❌ Error:', err.message);
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
    
    // Let's also check what models are available
    try {
      console.log('\nChecking available models...');
      const models = await client.getModels();
      const geminiModels = models.filter(m => m.id.includes('gemini'));
      console.log('Available Gemini models:');
      geminiModels.forEach(model => {
        console.log(`  - ${model.id}`);
      });
    } catch (modelError) {
      console.error('Could not fetch models:', modelError.message);
    }
  }
}

testGemini25();