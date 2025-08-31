import { readFileSync, readdirSync } from 'fs';

const getLatestResults = () => {
  try {
    const files = readdirSync('.')
      .filter(f => (f.startsWith('wordle-arena-results-') || f.startsWith('combined-best-results-') || f.startsWith('temp-')) && f.endsWith('.json'))
      .sort()
      .reverse();
    
    console.log('All files found:', files);
    
    if (files.length === 0) return null;
    
    // Prioritize combined results over individual runs
    const combinedFile = files.find(f => f.startsWith('combined-best-results-'));
    console.log('Combined file found:', combinedFile);
    
    const latestFile = combinedFile || files[0];
    console.log('Selected file:', latestFile);
    
    const rawData = JSON.parse(readFileSync(latestFile, 'utf8'));
    
    // Handle both old and new result formats
    const data = rawData.results ? rawData.results : rawData;
    const metadata = rawData.metadata || { version: "1.0" };
    
    console.log('Number of models in data:', Object.keys(data).length);
    console.log('Models:', Object.keys(data));
    
    return { filename: latestFile, data, metadata };
  } catch (error) {
    console.error('Error reading results:', error);
    return null;
  }
};

const results = getLatestResults();
console.log('\nFinal result filename:', results?.filename);