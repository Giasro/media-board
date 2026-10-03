# Gv 로컬 서버 — 표준 라이브러리만 사용 (Flask 불필요)
# 브라우저 Cache API(세션에 영상 저장)는 file:// 에서는 동작하지 않아서 http://localhost 로 열어야 합니다.
import http.server, socketserver, webbrowser, os, sys, threading

ROOT = os.path.dirname(os.path.abspath(__file__))
os.chdir(ROOT)

class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()
    def log_message(self, fmt, *args):
        pass  # 콘솔 조용히

class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True

def main():
    for port in range(8000, 8020):
        try:
            srv = Server(('127.0.0.1', port), Handler)
            break
        except OSError:
            continue
    else:
        print('사용 가능한 포트를 찾지 못했습니다.'); sys.exit(1)
    url = f'http://localhost:{port}/'
    print('=' * 50); print('  Gv 영상 동시재생기'); print('  주소:', url); print('  종료: 이 창을 닫거나 Ctrl+C'); print('=' * 50)
    if not os.environ.get('GV_NO_BROWSER'):
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass

if __name__ == '__main__':
    main()
