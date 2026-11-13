/**
 * tools/client_launcher.ts
 * Duel Rogue 스탠드얼론 데스크톱 클라이언트 런처 (Deno Compile 호환)
 * - 번들된 게임 정적 파일(index.html, main.js, style.css, src/, assets/)을 로컬 루프백(127.0.0.1)으로 서빙
 * - Microsoft Edge 앱 모드(--app) 창으로 실행해 일반 브라우저 탭/주소창 없이 독립 클라이언트처럼 구동
 * - 클라이언트 창 종료 시 자동 감지하여 프로세스를 깔끔하게 정리
 */

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
};

const ROOT_URL = new URL('../', import.meta.url);

function getMimeType(path: string): string {
  const dotIdx = path.lastIndexOf('.');
  if (dotIdx === -1) return 'application/octet-stream';
  const ext = path.slice(dotIdx).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

function sanitizeRelPath(pathname: string): string | null {
  let decoded = decodeURIComponent(pathname);
  if (decoded === '/') decoded = '/index.html';
  const parts = decoded.split('/').filter((p) => p.length > 0 && p !== '.');
  if (parts.some((p) => p === '..')) return null;
  if (parts.length === 0) return 'index.html';
  return parts.join('/');
}

async function readBundledFile(relPath: string): Promise<Uint8Array | null> {
  try {
    const fileUrl = new URL(relPath, ROOT_URL);
    return await Deno.readFile(fileUrl);
  } catch {
    return null;
  }
}

function injectClientHeartbeat(htmlBytes: Uint8Array): string {
  const html = new TextDecoder().decode(htmlBytes);
  const heartbeatScript = `
<script>
(() => {
  const ping = () => fetch('/__ping', { method: 'POST', cache: 'no-store' }).catch(() => {});
  ping();
  setInterval(ping, 2500);
  window.addEventListener('pagehide', () => {
    try { navigator.sendBeacon('/__exit'); } catch {}
  });
})();
</script>
`;
  const idx = html.lastIndexOf('</body>');
  if (idx !== -1) {
    return html.slice(0, idx) + heartbeatScript + html.slice(idx);
  }
  return html + heartbeatScript;
}

async function findDesktopBrowserExe(): Promise<{ exe: string; kind: 'chromium' } | null> {
  const localAppData = Deno.env.get('LOCALAPPDATA') || '';
  const candidates = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    localAppData ? `${localAppData}\\Microsoft\\Edge\\Application\\msedge.exe` : '',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ].filter(Boolean);

  for (const exe of candidates) {
    try {
      const stat = await Deno.stat(exe);
      if (stat.isFile) return { exe, kind: 'chromium' };
    } catch {
      // ignore missing path
    }
  }
  return null;
}

async function main() {
  const isSelfCheck = Deno.args.includes('--self-check');
  let hasConnected = false;
  let lastPingAt = Date.now();
  let exitRequested = false;

  const controller = new AbortController();

  const server = Deno.serve(
    {
      hostname: '127.0.0.1',
      port: 0,
      signal: controller.signal,
      onListen: () => {},
    },
    async (req) => {
      const url = new URL(req.url);

      if (url.pathname === '/__ping') {
        hasConnected = true;
        exitRequested = false;
        lastPingAt = Date.now();
        return new Response('ok', {
          status: 200,
          headers: { 'Cache-Control': 'no-store' },
        });
      }

      if (url.pathname === '/__exit') {
        exitRequested = true;
        lastPingAt = Date.now();
        return new Response('bye', { status: 200 });
      }

      const relPath = sanitizeRelPath(url.pathname);
      if (!relPath) {
        return new Response('Forbidden', { status: 403 });
      }

      const data = await readBundledFile(relPath);
      if (!data) {
        return new Response('Not Found', { status: 404 });
      }

      if (relPath === 'index.html' && !isSelfCheck) {
        hasConnected = true;
        lastPingAt = Date.now();
        const patchedHtml = injectClientHeartbeat(data);
        return new Response(patchedHtml, {
          status: 200,
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store, must-revalidate',
          },
        });
      }

      return new Response(new Uint8Array(data), {
        status: 200,
        headers: {
          'Content-Type': getMimeType(relPath),
          'Cache-Control': 'no-store, must-revalidate',
        },
      });
    },
  );

  const addr = server.addr as Deno.NetAddr;
  const baseUrl = `http://127.0.0.1:${addr.port}/`;

  if (isSelfCheck) {
    const checks = [
      '',
      'main.js',
      'style.css',
      'src/ui/vectorIcons.js',
      'assets/ui/tarot_justice.svg',
      'assets/frames/card_frame_unit_blank.svg',
      'assets/ui/card_back.svg',
    ];
    for (const path of checks) {
      const res = await fetch(`${baseUrl}${path}`);
      if (!res.ok) {
        console.error(`SELF_CHECK_FAIL: ${path} -> ${res.status}`);
        controller.abort();
        Deno.exit(1);
      }
      await res.arrayBuffer();
    }
    console.log(`SELF_CHECK_OK port=${addr.port} files=${checks.length}`);
    controller.abort();
    await server.finished;
    Deno.exit(0);
  }

  const browser = await findDesktopBrowserExe();
  let childExited = false;

  if (browser) {
    const localAppData = Deno.env.get('LOCALAPPDATA') || Deno.cwd();
    const profileDir = `${localAppData}\\DuelRogue\\ClientProfile`;
    try {
      await Deno.mkdir(profileDir, { recursive: true });
    } catch {
      // ignore if already exists
    }

    const cmd = new Deno.Command(browser.exe, {
      args: [
        `--app=${baseUrl}`,
        `--user-data-dir=${profileDir}`,
        '--window-size=1360,860',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-features=msEdgeSidebarV2',
      ],
      stdout: 'null',
      stderr: 'null',
    });

    const child = cmd.spawn();
    child.status.then(() => {
      childExited = true;
    }).catch(() => {
      childExited = true;
    });
  } else {
    // Fallback: 기본 브라우저로 열기
    const fallback = new Deno.Command('cmd.exe', {
      args: ['/c', 'start', '', baseUrl],
      stdout: 'null',
      stderr: 'null',
    });
    await fallback.output();
    childExited = true;
  }

  // 창이 열린 뒤 닫힐 때까지 감시하다가 서버를 종료한다
  const startedAt = Date.now();
  const timer = setInterval(() => {
    const now = Date.now();
    if (!hasConnected && now - startedAt > 20000) {
      clearInterval(timer);
      controller.abort();
      Deno.exit(0);
    }
    if (hasConnected && exitRequested && now - lastPingAt > 900) {
      clearInterval(timer);
      controller.abort();
      Deno.exit(0);
    }
    if (hasConnected && childExited && now - lastPingAt > 4500) {
      clearInterval(timer);
      controller.abort();
      Deno.exit(0);
    }
    if (hasConnected && now - lastPingAt > 10000) {
      clearInterval(timer);
      controller.abort();
      Deno.exit(0);
    }
  }, 500);

  await server.finished;
}

main();
