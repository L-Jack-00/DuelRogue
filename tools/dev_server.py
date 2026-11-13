"""개발용 정적 서버. 브라우저가 수정 전 모듈을 캐시해 두지 않도록 캐시를 끈다.

실행: python tools/dev_server.py [포트=1420]
"""
import http.server
import os
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        super().end_headers()


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 1420
    os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
    http.server.ThreadingHTTPServer(('127.0.0.1', port), NoCacheHandler).serve_forever()
