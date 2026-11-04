const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const express = require("express");

const app = express();
// 환경변수 값의 앞뒤 공백을 제거하고, URL 끝의 슬래시를 제거하여 안전하게 처리
const PORT = (process.env.PORT || "8080").toString().trim();
// \ 문자나 기타 공백도 확실하게 제거
const OLLAMA_URL = (process.env.OLLAMA_URL || "http://localhost:11434")
  .toString()
  .trim()
  .replace(/\\$/, "")      // 끝에 붙은 역슬래시 제거
  .replace(/\/$/, "")      // 끝에 붙은 슬래시 제거
  .replace(/[\s\\]+$/, ""); // 혹시 몰라 공백+역슬래시 조합도 한번 더 제거
const MAX_CONCURRENT_REQUESTS = parseInt((process.env.MAX_CONCURRENT_REQUESTS || "10").toString().trim(), 10);

// 동시 요청 제한 관리
let activeRequests = 0;
const requestQueue = [];

// JSON 파싱 미들웨어
app.use(express.json());

// 간단 요청 로깅 미들웨어
app.use((req, res, next) => {
  const startedAt = Date.now();
  res.on("finish", () => {
    const ms = Date.now() - startedAt;
    // eslint-disable-next-line no-console
    console.log(`[proxy] ${req.method} ${req.url} -> ${res.statusCode} ${ms}ms`);
  });
  next();
});

// 공통 CORS 헤더
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET,HEAD,OPTIONS,POST,PUT,DELETE");
  res.header("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// 간단한 헬스체크
app.get("/health", (_req, res) => res.json({ ok: true }));

// 요청 처리 함수
async function processChatRequest(req, res) {
  try {
    const { model, messages, options } = req.body;
    
    if (!model || !messages) {
      activeRequests--;
      // 대기 중인 요청 처리
      if (requestQueue.length > 0 && activeRequests < MAX_CONCURRENT_REQUESTS) {
        const next = requestQueue.shift();
        activeRequests++;
        processChatRequest(next.req, next.res);
      }
      return res.status(400).json({ error: "Missing 'model' or 'messages'" });
    }

    // eslint-disable-next-line no-console
    console.log(`[ollama] chat request → model: ${model}, messages: ${messages.length} (활성 요청: ${activeRequests}/${MAX_CONCURRENT_REQUESTS})`);
    // eslint-disable-next-line no-console
    console.log(`[ollama] connecting to: ${OLLAMA_URL}/api/chat`);

    const response = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        options,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      // eslint-disable-next-line no-console
      console.error(`[ollama] error ${response.status} for model '${model}':`, errorText);
      
      // 404 에러인 경우 더 자세한 정보 제공
      if (response.status === 404) {
        // eslint-disable-next-line no-console
        console.error(`[ollama] 모델 '${model}'을 찾을 수 없습니다.`);
        // eslint-disable-next-line no-console
        console.error(`[ollama] 사용 가능한 모델 확인: ollama list`);
        // eslint-disable-next-line no-console
        console.error(`[ollama] 모델 다운로드: ollama pull ${model}`);
      }
      
      return res.status(response.status).json({ 
        error: errorText,
        model: model,
        suggestion: response.status === 404 
          ? `모델 '${model}'을 찾을 수 없습니다. 'ollama list'로 사용 가능한 모델을 확인하거나 'ollama pull ${model}'로 다운로드하세요.`
          : undefined
      });
    }

    const data = await response.json();
    res.json(data);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[ollama] connection error:", err);
    
    // 연결 오류인 경우 더 자세한 정보 제공
    if (err.code === "ECONNREFUSED" || err.message?.includes("fetch failed")) {
      // eslint-disable-next-line no-console
      console.error(`[ollama] Ollama 서버에 연결할 수 없습니다: ${OLLAMA_URL}`);
      // eslint-disable-next-line no-console
      console.error(`[ollama] Ollama 서버가 실행 중인지 확인하세요: ollama serve`);
      return res.status(503).json({ 
        error: `Ollama 서버에 연결할 수 없습니다: ${OLLAMA_URL}`,
        suggestion: "Ollama 서버가 실행 중인지 확인하세요. 터미널에서 'ollama serve'를 실행하거나 Ollama 데스크톱 앱을 실행하세요."
      });
    }
    
    res.status(500).json({ error: String(err?.message || err) });
  } finally {
    activeRequests--;
    // 대기 중인 요청 처리
    if (requestQueue.length > 0 && activeRequests < MAX_CONCURRENT_REQUESTS) {
      const next = requestQueue.shift();
      processChatRequest(next.req, next.res);
    }
  }
}

// Ollama 프록시 엔드포인트 (동시 요청 제한 포함)
app.post("/api/ollama/chat", (req, res) => {
  if (activeRequests >= MAX_CONCURRENT_REQUESTS) {
    // 대기열에 추가
    requestQueue.push({ req, res });
    // eslint-disable-next-line no-console
    console.log(`[ollama] 요청 대기열에 추가 (대기 중: ${requestQueue.length})`);
  } else {
    activeRequests++;
    processChatRequest(req, res);
  }
});

// Ollama 모델 목록 조회
app.get("/api/ollama/models", async (_req, res) => {
  try {
    // eslint-disable-next-line no-console
    console.log("[ollama] listing models");

    const response = await fetch(`${OLLAMA_URL}/api/tags`);
    
    if (!response.ok) {
      const errorText = await response.text();
      // eslint-disable-next-line no-console
      console.error(`[ollama] error ${response.status}:`, errorText);
      return res.status(response.status).json({ error: errorText });
    }

    const data = await response.json();
    res.json(data);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[ollama] error:", err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

// Ollama 모델 다운로드
app.post("/api/ollama/pull", async (req, res) => {
  try {
    const { name } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: "Missing 'name'" });
    }

    // eslint-disable-next-line no-console
    console.log(`[ollama] pulling model: ${name}`);

    const response = await fetch(`${OLLAMA_URL}/api/pull`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      // eslint-disable-next-line no-console
      console.error(`[ollama] error ${response.status}:`, errorText);
      return res.status(response.status).json({ error: errorText });
    }

    // 스트리밍 응답 처리
    res.setHeader("Content-Type", "application/json");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      const chunk = decoder.decode(value);
      res.write(chunk);
    }
    
    res.end();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[ollama] error:", err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

// 템플릿 방식: /proxy?url={target}
app.get("/proxy", async (req, res) => {
  try {
    const target = req.query.url;
    if (!target || typeof target !== "string") {
      return res.status(400).json({ error: "Missing 'url' query" });
    }

    // 요청 대상 로그
    // eslint-disable-next-line no-console
    console.log(`[proxy] fetch → ${target}`);

    const upstream = await fetch(target);
    if (!upstream.ok) {
      // eslint-disable-next-line no-console
      console.warn(`[proxy] upstream ${upstream.status} for ${target}`);
      return res.status(upstream.status).send(await upstream.text());
    }

    // 원본 Content-Type 유지
    const contentType = upstream.headers.get("content-type") || "application/octet-stream";
    res.setHeader("Content-Type", contentType);

    // 스트리밍 전송
    const arrayBuffer = await upstream.arrayBuffer();
    // eslint-disable-next-line no-console
    console.log(`[proxy] delivered ${arrayBuffer.byteLength}B as ${contentType}`);
    res.send(Buffer.from(arrayBuffer));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[proxy] error:", err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

// 서버 시작 시 Ollama 연결 확인
async function checkOllamaConnection() {
  try {
    const response = await fetch(`${OLLAMA_URL}/api/tags`);
    if (response.ok) {
      const data = await response.json();
      // eslint-disable-next-line no-console
      console.log(`[ollama] ✅ 연결 성공: ${OLLAMA_URL}`);
      // eslint-disable-next-line no-console
      console.log(`[ollama] 사용 가능한 모델: ${data.models?.map(m => m.name).join(", ") || "없음"}`);
    } else {
      // eslint-disable-next-line no-console
      console.warn(`[ollama] ⚠️  연결 확인 실패: ${response.status}`);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[ollama] ⚠️  Ollama 서버에 연결할 수 없습니다: ${OLLAMA_URL}`);
    // eslint-disable-next-line no-console
    console.warn(`[ollama] Ollama 서버가 실행 중인지 확인하세요: ollama serve`);
  }
}

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[proxy] listening on http://localhost:${PORT}`);
  // eslint-disable-next-line no-console
  console.log(`[ollama] Ollama URL: ${OLLAMA_URL}`);
  checkOllamaConnection();
});

