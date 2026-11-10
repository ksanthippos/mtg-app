import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const configPath = path.resolve(__dirname, '../src/config.js');

try {
  // 1. Stage all changes
  execSync('git add -A', { stdio: 'inherit' });

  // 2. Check if there are any staged changes
  const staged = execSync('git diff --cached --name-only').toString().trim();
  if (!staged) {
    console.log('Ei tallennettavia muutoksia työtilassa.');
    process.exit(0);
  }

  // 3. Determine commit message
  const args = process.argv.slice(2);
  let commitMsg = args.join(' ').trim();

  if (!commitMsg) {
    try {
      const content = fs.readFileSync(configPath, 'utf8');
      const match = content.match(/version:\s*['"]([0-9]+\.[0-9]+)['"]/);
      if (match) {
        const nextVersion = (parseFloat(match[1]) + 0.01).toFixed(2);
        commitMsg = `Päivitys v${nextVersion}`;
      }
    } catch {}
    if (!commitMsg) commitMsg = 'Päivitys';
  }

  // 4. Commit (triggers pre-commit hook which bumps version and stages config.js)
  execSync(`git commit -m "${commitMsg.replace(/"/g, '\\"')}"`, { stdio: 'inherit' });

  // 5. Push to remote
  try {
    execSync('git push origin HEAD', { stdio: 'inherit' });
  } catch {
    // If post-commit hook already pushed, ignore duplicate push
  }

  console.log('✅ Automaattinen commit ja push suoritettu onnistuneesti!');
} catch (error) {
  console.error('❌ Virhe automaattisessa commitissa/pushissa:', error.message);
  process.exit(1);
}
