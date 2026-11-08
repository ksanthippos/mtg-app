import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const configPath = path.resolve(__dirname, '../src/config.js');

try {
  const content = fs.readFileSync(configPath, 'utf8');
  const match = content.match(/version:\s*['"]([0-9]+\.[0-9]+)['"]/);

  if (!match) {
    console.error('Versiota ei löytynyt src/config.js -tiedostosta.');
    process.exit(1);
  }

  const currentVersion = parseFloat(match[1]);
  const nextVersion = (currentVersion + 0.01).toFixed(2);

  const updatedContent = content.replace(
    /version:\s*['"][0-9]+\.[0-9]+['"]/,
    `version: '${nextVersion}'`
  );

  fs.writeFileSync(configPath, updatedContent, 'utf8');
  console.log(`Versio päivitetty: ${match[1]} -> ${nextVersion} (src/config.js)`);
} catch (error) {
  console.error('Virhe version korottamisessa:', error);
  process.exit(1);
}
