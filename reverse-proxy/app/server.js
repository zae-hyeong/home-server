const express = require('express');
const next = require('next');
const httpProxy = require('http-proxy');
const fs = require('fs');
const path = require('path');

const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev, dir: __dirname });
const handle = app.getRequestHandler();

const routesFilePath = path.join(__dirname, 'routes.json');

// routes.json에서 실시간 라우팅 규칙 로드
function getRoutes() {
  if (!fs.existsSync(routesFilePath)) {
    return [];
  }
  try {
    const data = fs.readFileSync(routesFilePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading routes.json:', error);
    return [];
  }
}

// http-proxy 인스턴스 생성
const proxy = httpProxy.createProxyServer({
  ws: true, // WebSocket 지원
  xfwd: true // X-Forwarded-* 헤더 자동 추가
});

// 프록시 에러 처리
proxy.on('error', (err, req, res) => {
  console.error('[Proxy Error]:', err.message);
  
  // HTTP 응답 에러 핸들링
  if (res && !res.headersSent && typeof res.writeHead === 'function') {
    res.writeHead(502, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`
      <div style="font-family: sans-serif; text-align: center; padding: 50px;">
        <h1 style="color: #e53e3e;">Bad Gateway (502)</h1>
        <p style="color: #4a5568;">대상 서버에 연결할 수 없습니다. 서비스가 작동 중인지 확인해 주세요.</p>
        <hr style="max-width: 500px; margin: 20px auto; border: 0; border-top: 1px solid #e2e8f0;"/>
        <p style="font-size: 0.875rem; color: #a0aec0;">Antigravity Dynamic Proxy Engine</p>
      </div>
    `);
  }
});

// WebSocket 프록시 에러 처리
proxy.on('open', (proxySocket) => {
  // socket connection created
});

proxy.on('close', (res, socket, head) => {
  // connection closed
});

app.prepare().then(() => {
  const server = express();

  // 모든 HTTP 요청 가로채기
  server.use((req, res, nextMiddleware) => {
    const rawHost = req.headers.host || '';
    const host = rawHost.split(':')[0]; // 포트 제거 (예: portfolio.zaehyeong.cloud:3000 -> portfolio.zaehyeong.cloud)
    
    // 테스트 에러 페이지 호스트 가로채기
    if (host === 'error.zae-hyeong.cloud' || host === 'error.zaehyeong.cloud') {
      const errorPagePath = path.join(__dirname, 'public', 'error.html');
      return fs.readFile(errorPagePath, 'utf8', (err, htmlContent) => {
        if (err) {
          console.error('Error reading static error page:', err);
          res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
          return res.end('<h1>Internal Server Error (Static Error Page Missing)</h1>');
        }
        res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(htmlContent);
      });
    }

    // API 요청이나 내부 _next 정적 자원은 관리자용이므로 프록시를 태우지 않고 바로 Next.js로 보냄
    const isNextInternal = req.url.startsWith('/_next') || req.url.startsWith('/api/routes');
    
    if (!isNextInternal) {
      const routes = getRoutes();
      // Host와 매칭되는 라우트 중 활성화된 규칙을 검색
      const matchedRoute = routes.find(r => r.sourceHost === host && r.active);
      
      if (matchedRoute) {
        console.log(`[Proxy] Routing ${req.method} ${host}${req.url} -> ${matchedRoute.destinationUrl}`);
        return proxy.web(req, res, { 
          target: matchedRoute.destinationUrl,
          changeOrigin: true // 가상 호스트 대응을 위해 Origin 변경
        });
      }
    }
    
    // 매칭되지 않는 호스트거나 Next.js 내부 요청인 경우 Next.js로 패스
    nextMiddleware();
  });

  // Next.js 핸들러 처리 (Catch-all)
  server.use((req, res) => {
    return handle(req, res);
  });

  const port = process.env.PORT || 3000;
  const httpServer = server.listen(port, (err) => {
    if (err) throw err;
    console.log(`> Dynamic Proxy & Admin Dashboard ready on http://localhost:${port}`);
  });

  // WebSocket 업그레이드 요청 처리
  httpServer.on('upgrade', (req, socket, head) => {
    const rawHost = req.headers.host || '';
    const host = rawHost.split(':')[0];
    const routes = getRoutes();
    
    const matchedRoute = routes.find(r => r.sourceHost === host && r.active);
    
    if (matchedRoute) {
      console.log(`[Proxy WS] Routing WS ${host}${req.url} -> ${matchedRoute.destinationUrl}`);
      proxy.ws(req, socket, head, { 
        target: matchedRoute.destinationUrl,
        changeOrigin: true 
      });
    } else {
      // Next.js HMR(Hot Module Replacement) 등을 위한 웹소켓 처리 지원
      if (req.url.startsWith('/_next/webpack-hmr')) {
        // Next.js 내장 WS 서버가 처리할 수 있도록 개발 모드에서 소켓 전달 필요
        // 프로덕션 모드에서는 무시 가능
      } else {
        socket.destroy();
      }
    }
  });
});
