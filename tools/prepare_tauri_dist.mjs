import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const outDir = path.join(rootDir, 'dist-web');

const entriesToCopy = ['index.html', 'main.js', 'style.css', 'src', 'assets'];

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

for (const entry of entriesToCopy) {
  const srcPath = path.join(rootDir, entry);
  const destPath = path.join(outDir, entry);
  if (!fs.existsSync(srcPath)) {
    throw new Error(`Missing required frontend asset: ${srcPath}`);
  }
  fs.cpSync(srcPath, destPath, { recursive: true });
}

console.log(`[prepare_tauri_dist] Copied ${entriesToCopy.join(', ')} -> ${outDir}`);
