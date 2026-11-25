import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * 정식 릴리즈 빌드용 HTML 변환:
 * - `<!-- @debug-only:start --> ... <!-- @debug-only:end -->` 디버깅 전용 UI/모달/버튼 블록 제거
 * - 턴 타이머 일시정지 툴팁 제거
 */
export function transformReleaseHtml(html) {
  return String(html || '')
    .replace(/<!--\s*@debug-only:start\s*-->[\s\S]*?<!--\s*@debug-only:end\s*-->\s*/g, '')
    .replace('title="턴 타이머 (클릭하여 일시정지 / 재개)"', 'title="턴 타이머"');
}

/**
 * 정식 릴리즈 빌드용 main.js 변환:
 * - IS_RELEASE_BUILD 플래그를 true로 전환하여 일시정지/F1/F3/F4/즉시승리 등 디버깅 기능 비활성화
 */
export function transformReleaseMainJs(source) {
  return String(source || '').replace(
    /const\s+IS_RELEASE_BUILD\s*=\s*false\s*;/,
    'const IS_RELEASE_BUILD = true;'
  );
}

export function prepareTauriDist({ isRelease = process.env.DUEL_ROGUE_DEBUG !== '1' } = {}) {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const rootDir = path.resolve(__dirname, '..');
  const outDir = path.join(rootDir, 'dist-web');

  const entriesToCopy = ['index.html', 'main.js', 'style.css', 'theme-alley.css', 'src', 'assets'];

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  for (const entry of entriesToCopy) {
    const srcPath = path.join(rootDir, entry);
    const destPath = path.join(outDir, entry);
    if (!fs.existsSync(srcPath)) {
      throw new Error(`Missing required frontend asset: ${srcPath}`);
    }
    fs.cpSync(srcPath, destPath, {
      recursive: true,
      filter: (src) => {
        const rel = path.relative(rootDir, src).replace(/\\/g, '/');
        return !rel.startsWith('assets/_raw_cache') && !rel.startsWith('assets/style_samples') && !rel.startsWith('assets/workflows');
      },
    });
  }

  if (isRelease) {
    const distHtmlPath = path.join(outDir, 'index.html');
    const distMainPath = path.join(outDir, 'main.js');
    fs.writeFileSync(distHtmlPath, transformReleaseHtml(fs.readFileSync(distHtmlPath, 'utf8')), 'utf8');
    fs.writeFileSync(distMainPath, transformReleaseMainJs(fs.readFileSync(distMainPath, 'utf8')), 'utf8');
  }

  console.log(`[prepare_tauri_dist] Copied ${entriesToCopy.join(', ')} -> ${outDir} (mode=${isRelease ? 'release' : 'debug'})`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  prepareTauriDist();
}
