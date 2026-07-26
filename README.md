# 🏠 Home Server Project

이 프로젝트는 개인 홈 서버 환경을 구축하고 관리하기 위한 멀티 서비스 도커 구성 프로젝트입니다. 
Nginx와 Node.js 기반 동적 프록시 서버를 관문(Gateway)으로 두어, 여러 독립된 서브 서비스를 도메인 기반으로 안전하게 외부에 노출하고 관리할 수 있도록 설계되었습니다.

---

## 🛠️ 전체 시스템 아키텍처

아래 다이어그램은 외부 요청이 들어와서 각 서비스로 전달되기까지의 네트워크 흐름을 보여줍니다.

```mermaid
graph TD
    Client(["🌐 Client (Internet)"]) -->|HTTP:80 / HTTPS:443| Nginx["🛡️ Nginx Container (reverse-proxy)"]
    
    subgraph Reverse Proxy Area [reverse-proxy Network (proxy_net)]
        Nginx -->|SSL Offloading & Pass| NodeProxy["⚙️ Dynamic Proxy & Admin Dashboard (app_service:3000)"]
        Certbot["🔒 Certbot (SSL Auto Renew)"] <-->|Cert Vol. Sharing| Nginx
    end

    subgraph Internal Services Area [Shared Network (homeserver-net)]
        NodeProxy -->|portfolio.zaehyeong.cloud| FinPort["📊 Finance Portfolio (nextjs-app:3000)"]
        FinPort -->|DB Connection| Postgres["🗄️ PostgreSQL (postgres-db:5432)"]
    end

    classDef proxy fill:#2b6cb0,stroke:#2b6cb0,color:#fff;
    classDef service fill:#2f855a,stroke:#2f855a,color:#fff;
    classDef client fill:#d69e2e,stroke:#d69e2e,color:#fff;
    class Nginx,NodeProxy,Certbot proxy;
    class FinPort,Postgres service;
    class Client client;
```

---

## 🔌 포트 및 네트워크 배정 정의

효율적인 라우팅과 보안을 위해 포트 및 도커 네트워크를 다음과 같이 구분하여 운영합니다.

### 1. 포트 맵핑 현황

| 서비스 분류 | 서비스명 (컨테이너명) | 호스트 포트 | 내부 포트 | 도커 네트워크 | 역할 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Gateway** | Nginx (`reverse-proxy`) | `80`, `443` | `80`, `443` | `proxy_net` | 외부 트래픽 인입, SSL/TLS 오프로딩, Certbot 인증 |
| **Gateway** | Proxy Admin (`app_service`) | *비노출* | `3000` | `proxy_net`<br>`homeserver-net` | `routes.json` 기반 동적 프록시 라우팅 및 대시보드 |
| **Gateway** | Certbot (`certbot`) | *비노출* | - | `proxy_net` | Let's Encrypt 인증서 12시간마다 자동 갱신 시도 |
| **Service** | Finance Portfolio (`nextjs-app`) | `3000` | `3000` | `homeserver-net` | 자산 포트폴리오 Next.js 애플리케이션 |
| **Database**| PostgreSQL (`postgres-db`) | `5432` | `5432` | `homeserver-net` | 홈 서버 공용 관계형 데이터베이스 |

> [!NOTE]
> `app_service`는 Nginx 컨테이너와 동일한 `proxy_net` 내에서만 포트 `3000`으로 통신하므로, 외부 호스트 포트를 별도로 점유하지 않아 포트 충돌을 방지합니다.
> `nextjs-app`은 개발 편의 및 단독 접근을 위해 호스트의 `3000` 포트를 노출하고 있습니다.

### 2. 도커 네트워크 정의

- **`proxy_net` (Bridge Network)**
  - `reverse-proxy` 프로젝트 내부에서만 생성 및 활용되는 전용 네트워크입니다.
  - 외부 관문인 Nginx, Certbot, 동적 프록시 서버(`app_service`)만 참여하여 보안성을 확보합니다.
- **`homeserver-net` (External Shared Network)**
  - 홈 서버 상의 서로 다른 독립적인 프로젝트(DB, 애플리케이션, 프록시)들이 서로를 도커 컨테이너명으로 참조하고 안전하게 통신할 수 있도록 사용하는 공유 네트워크입니다.
  - `external: true` 설정을 사용하여 별도로 먼저 생성한 뒤 각 `docker-compose.yml`에서 참조합니다.

---

## 📂 파일 및 디렉토리 구조

```directory
homeserver/
├── DB/                      # 공용 데이터베이스 (PostgreSQL)
│   ├── pgdata/              # DB 데이터 영구 저장소 (Git 제외)
│   ├── .env                 # DB 접속 정보 환경 변수
│   └── docker-compose.yml
├── finance-portfolio/       # 자산 포트폴리오 서비스 (Next.js)
│   ├── app/                 # Next.js 애플리케이션 소스
│   ├── .env                 # 앱 정보 및 DB 커넥션 설정
│   └── docker-compose.yml
├── reverse-proxy/           # 외부 관문 (Nginx + Node Proxy)
│   ├── app/                 # 동적 프록시 라우터 & 관리자 대시보드 (Node/Next)
│   │   ├── routes.json      # 서브도메인-컨테이너 라우팅 맵핑 규칙 파일
│   │   └── server.js        # 동적 라우팅 엔진 (Express + http-proxy)
│   ├── certbot/             # SSL 인증서 관리 경로 (Git 제외)
│   ├── nginx.conf           # SSL 설정 및 트래픽 바이패스 설정
│   └── docker-compose.yml
└── scripts/                 # 모니터링 및 유틸리티 스크립트
```

---

## 🚀 빠른 시작 가이드 (Quick Start)

이 홈 서버 시스템을 안정적으로 초기화하고 실행하는 순서입니다.

### Step 1. 외부 공유 네트워크 생성
가장 먼저 컨테이너 간의 통신을 돕는 외부 공유 네트워크인 `homeserver-net`을 호스트 터미널에서 생성합니다.
```bash
docker network create homeserver-net
```

### Step 2. PostgreSQL 데이터베이스 기동
1. `DB/` 폴더로 이동합니다.
2. `.env.example`을 복사하여 `.env` 파일을 생성하고 패스워드 정보를 설정합니다.
3. 데이터베이스 서비스를 백그라운드로 실행합니다.
   ```bash
   # DB 폴더 내에서 실행
   docker compose up -d
   ```

### Step 3. Finance Portfolio 애플리케이션 실행
1. `finance-portfolio/` 폴더로 이동합니다.
2. `.env.example`을 복사하여 `.env` 파일을 작성합니다.
   * `DB_HOST`는 반드시 `postgres-db`로 설정하여 도커 네트워크 내에서 DB를 찾아갈 수 있도록 합니다.
3. 애플리케이션을 기동합니다.
   ```bash
   # finance-portfolio 폴더 내에서 실행
   docker compose up -d
   ```

### Step 4. 로컬 테스트를 위한 호스트 설정 (개발 환경인 경우)
로컬 PC에서 `finance.zae-hyeong.cloud` 및 `error.zae-hyeong.cloud` 도메인으로 리버스 프록시 접속을 테스트하기 위해 OS별 `hosts` 파일을 수정해야 합니다.

* **Windows**: `C:\Windows\System32\drivers\etc\hosts` 파일을 관리자 권한으로 열고 맨 아래에 아래 줄을 추가합니다.
* **macOS / Linux**: `/etc/hosts` 파일을 `sudo` 권한으로 열고 추가합니다.
```text
127.0.0.1 finance.zae-hyeong.cloud
127.0.0.1 error.zae-hyeong.cloud
```

### Step 5. Reverse Proxy 구동 및 SSL 설정
1. `reverse-proxy/` 폴더로 이동합니다.
2. **초기 구동 시 주의사항 (SSL)**:
   * Nginx 설정 파일(`nginx.conf`)에 SSL 인증서 경로가 활성화되어 있는 상태에서, 실제 Let's Encrypt 인증서 파일이 존재하지 않는다면 Nginx가 오류로 인해 실행되지 않습니다.
   * 로컬에서 인증서 없이 단순히 포워딩 기능만 테스트하고 싶은 경우, `nginx.conf`의 **3. HTTPS 통합 바이패스** 부분을 주석 처리하고 사용하시거나, 최초 1회 `certbot`을 통해 인증서를 실제로 발급받아야 합니다.
3. 프록시 및 인증서 갱신 데몬을 기동합니다.
   ```bash
   # reverse-proxy 폴더 내에서 실행
   docker compose up -d
   ```
4. 이제 다음 주소들로 접속하여 결과를 확인합니다:
   * **자산 포트폴리오**: `http://finance.zae-hyeong.cloud` (인증서 설정 완료 시 HTTPS로 자동 리디렉션)
   * **테스트 에러 페이지**: `http://error.zae-hyeong.cloud` (정적 500 에러 페이지 반환 확인)
   * **프록시 관리자 대시보드 (HTTP 전용)**: `http://localhost` 또는 `http://127.0.0.1`

---

## 📝 라우팅 규칙 관리 (`routes.json`)

서비스가 추가되거나 변경되면 `reverse-proxy/app/routes.json` 파일을 수정하여 동적으로 리다이렉션 경로를 추가할 수 있습니다. 프록시 서버 재시작 없이 실시간으로 반영됩니다.

```json
[
  {
    "id": "1",
    "name": "Finance Portfolio",
    "sourceHost": "portfolio.zaehyeong.cloud",
    "destinationUrl": "http://nextjs-app:3000",
    "active": true,
    "description": "개인 자산 포트폴리오 서비스 (Next.js)"
  }
]
```
- `sourceHost`: 접속할 도메인 주소 (Nginx가 HTTPS 인증을 처리한 뒤 이 호스트명 그대로 패스합니다).
- `destinationUrl`: 도커 공유 네트워크(`homeserver-net`) 내부의 컨테이너 목적지 주소 및 포트.
- `active`: 활성화 여부 (`true`인 경우에만 라우팅 반영).
