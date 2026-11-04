const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const express = require("express");

const app = express();

// 환경변수에서 포트 가져오기 (기본값: 4001)
const PORT = (process.env.IMAGE_PROXY_PORT || "4001").toString().trim();

// JSON 파싱 미들웨어
app.use(express.json());

// 요청 로깅 미들웨어
app.use((req, res, next) => {
  const startedAt = Date.now();
  res.on("finish", () => {
    const ms = Date.now() - startedAt;
    // eslint-disable-next-line no-console
    console.log(`[imageProxy] ${req.method} ${req.url} -> ${res.statusCode} ${ms}ms`);
  });
  next();
});

// CORS 헤더 설정 (모든 도메인 허용)
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET,HEAD,OPTIONS");
  res.header("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// 헬스체크
app.get("/health", (_req, res) => res.json({ ok: true, service: "image-proxy" }));

// 이미지 프록시 엔드포인트: /proxy?url={target}
app.get("/proxy", async (req, res) => {
  try {
    const target = req.query.url;
    if (!target || typeof target !== "string") {
      return res.status(400).json({ error: "Missing 'url' query parameter" });
    }

    // URL 디코딩
    const decodedUrl = decodeURIComponent(target);

    // URL 유효성 검사
    if (!decodedUrl.startsWith("http://") && !decodedUrl.startsWith("https://")) {
      return res.status(400).json({ error: "Invalid URL. Must start with http:// or https://" });
    }

    // eslint-disable-next-line no-console
    console.log(`[imageProxy] fetching image → ${decodedUrl}`);

    // 이미지 요청
    const upstream = await fetch(decodedUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; JBSW-ImageProxy/1.0)",
        "Accept": "image/*,*/*;q=0.8",
      },
      // 타임아웃 설정 (30초)
      signal: AbortSignal.timeout(30000),
    });

    if (!upstream.ok) {
      // eslint-disable-next-line no-console
      console.warn(`[imageProxy] upstream ${upstream.status} for ${decodedUrl}`);
      return res.status(upstream.status).json({ 
        error: `Failed to fetch image: ${upstream.status} ${upstream.statusText}`,
        url: decodedUrl,
      });
    }

    // Content-Type 확인
    const contentType = upstream.headers.get("content-type") || "image/jpeg";
    
    // 이미지 타입만 허용 (보안)
    if (!contentType.startsWith("image/")) {
      // eslint-disable-next-line no-console
      console.warn(`[imageProxy] non-image content-type: ${contentType} for ${decodedUrl}`);
      // 이미지가 아니어도 전달 (일부 서버가 잘못된 Content-Type을 보낼 수 있음)
    }

    // Content-Type 헤더 설정
    res.setHeader("Content-Type", contentType);
    
    // 캐시 헤더 설정 (1시간)
    res.setHeader("Cache-Control", "public, max-age=3600");
    
    // CORS 헤더 (이미 위에서 설정했지만 명시적으로)
    res.setHeader("Access-Control-Allow-Origin", "*");

    // 이미지 데이터 스트리밍
    const arrayBuffer = await upstream.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    // eslint-disable-next-line no-console
    console.log(`[imageProxy] delivered ${buffer.byteLength}B (${(buffer.byteLength / 1024).toFixed(2)}KB) as ${contentType}`);
    
    res.send(buffer);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[imageProxy] error:", err);
    
    // 타임아웃 에러
    if (err.name === "AbortError" || err.message?.includes("timeout")) {
      return res.status(504).json({ 
        error: "Request timeout",
        message: "Image fetch took too long",
      });
    }
    
    // 네트워크 에러
    if (err.code === "ECONNREFUSED" || err.message?.includes("fetch failed")) {
      return res.status(502).json({ 
        error: "Connection failed",
        message: "Could not connect to image server",
      });
    }
    
    res.status(500).json({ 
      error: String(err?.message || err),
    });
  }
});

// 루트 경로
app.get("/", (_req, res) => {
  res.json({
    service: "JBSW Image Proxy",
    version: "1.0.0",
    endpoints: {
      health: "/health",
      proxy: "/proxy?url={encoded_image_url}",
    },
    example: `/proxy?url=${encodeURIComponent("https://example.com/image.jpg")}`,
  });
});

// 서버 시작
app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[imageProxy] 🖼️  Image proxy server listening on http://localhost:${PORT}`);
  // eslint-disable-next-line no-console
  console.log(`[imageProxy] Health check: http://localhost:${PORT}/health`);
  // eslint-disable-next-line no-console
  console.log(`[imageProxy] Example: http://localhost:${PORT}/proxy?url=${encodeURIComponent("https://example.com/image.jpg")}`);
});

