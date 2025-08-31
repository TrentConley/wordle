import { readFileSync, writeFileSync, readdirSync } from 'fs';

function loadResultsFile(filename) {
  try {
    const rawData = JSON.parse(readFileSync(filename, 'utf8'));
    const data = rawData.results ? rawData.results : rawData;
    const metadata = rawData.metadata || { version: "1.0", timestamp: filename };
    return { data, metadata, filename };
  } catch (error) {
    console.error(`Error loading ${filename}:`, error.message);
    return null;
  }
}

function combineResults() {
  const files = readdirSync('.')
    .filter(f => f.startsWith('wordle-arena-results-') || f.startsWith('temp-'))
    .filter(f => f.endsWith('.json'))
    .sort();
  
  console.log(`Found ${files.length} result files:`, files);
  
  const modelResults = {};
  
  for (const file of files) {
    const results = loadResultsFile(file);
    if (!results) continue;
    
    console.log(`\nProcessing ${file}:`);
    
    for (const [model, modelData] of Object.entries(results.data)) {
      const validGames = modelData.games.filter(g => !g.error);
      const totalAttempts = modelData.games.length;
      const wins = validGames.filter(g => g.won).length;
      const winRate = validGames.length > 0 ? (wins / validGames.length * 100) : 0;
      
      console.log(`  ${model}: ${totalAttempts} attempts, ${validGames.length} valid, ${winRate.toFixed(1)}% win rate`);
      
      // Only keep models with 50+ attempts
      if (totalAttempts >= 50) {
        // If we haven't seen this model, or this run has better performance, keep it
        if (!modelResults[model] || 
            (validGames.length >= 50 && winRate > modelResults[model].bestWinRate)) {
          modelResults[model] = {
            data: modelData,
            metadata: {
              ...results.metadata,
              sourceFile: file,
              totalAttempts,
              validGames: validGames.length,
              winRate: winRate
            },
            bestWinRate: winRate
          };
          console.log(`    → Selected as best result for ${model}`);
        }
      } else {
        console.log(`    → Skipped (less than 50 attempts)`);
      }
    }
  }
  
  // Create final combined results
  const combinedResults = {};
  const combinedMetadata = {
    timestamp: new Date().toISOString(),
    version: "2.0",
    description: "Combined results from multiple test runs, keeping highest performing runs with 50+ attempts",
    sources: [],
    totalModels: Object.keys(modelResults).length
  };
  
  for (const [model, result] of Object.entries(modelResults)) {
    combinedResults[model] = result.data;
    combinedMetadata.sources.push({
      model,
      sourceFile: result.metadata.sourceFile,
      attempts: result.metadata.totalAttempts,
      winRate: result.metadata.winRate.toFixed(1) + '%'
    });
  }
  
  const finalOutput = {
    metadata: combinedMetadata,
    results: combinedResults
  };
  
  const outputFile = `combined-best-results-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  writeFileSync(outputFile, JSON.stringify(finalOutput, null, 2));
  
  console.log(`\n=== SUMMARY ===`);
  console.log(`Combined results saved to: ${outputFile}`);
  console.log(`Total models included: ${Object.keys(modelResults).length}`);
  
  console.log('\nBest results by model:');
  const sorted = Object.entries(modelResults).sort((a, b) => b[1].bestWinRate - a[1].bestWinRate);
  sorted.forEach(([model, result]) => {
    console.log(`  ${model}: ${result.bestWinRate.toFixed(1)}% (${result.metadata.totalAttempts} attempts from ${result.metadata.sourceFile})`);
  });
  
  return outputFile;
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  combineResults();
}

export { combineResults };