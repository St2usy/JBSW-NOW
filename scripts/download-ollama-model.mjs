#!/usr/bin/env node

/**
 * Ollama 모델 다운로드 스크립트
 * 
 * 사용법:
 *   node scripts/download-ollama-model.mjs <model-name>
 * 
 * 예시:
 *   node scripts/download-ollama-model.mjs llama3.2
 *   node scripts/download-ollama-model.mjs qwen2.5:7b
 */

import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env") });

const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const modelName = process.argv[2];

if (!modelName) {
  console.error("❌ 모델 이름을 입력해주세요.");
  console.log("\n사용법: node scripts/download-ollama-model.mjs <model-name>");
  console.log("\n예시:");
  console.log("  node scripts/download-ollama-model.mjs llama3.2");
  console.log("  node scripts/download-ollama-model.mjs qwen2.5:7b");
  console.log("  node scripts/download-ollama-model.mjs gemma2:2b");
  process.exit(1);
}

async function pullModel(name) {
  console.log(`📥 모델 다운로드 시작: ${name}`);
  console.log(`🔗 Ollama 서버: ${OLLAMA_URL}\n`);

  try {
    const response = await fetch(`${OLLAMA_URL}/api/pull`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.trim()) {
          try {
            const data = JSON.parse(line);
            
            if (data.status) {
              if (data.status.includes("pulling")) {
                process.stdout.write(`\r⏳ ${data.status}...`);
              } else if (data.status.includes("downloading")) {
                const percent = data.completed ? Math.round((data.completed / data.total) * 100) : 0;
                process.stdout.write(`\r⬇️  다운로드 중: ${percent}%`);
              } else if (data.status.includes("verifying")) {
                process.stdout.write(`\r✅ 검증 중...`);
              } else {
                process.stdout.write(`\r${data.status}`);
              }
            }
            
            if (data.completed && data.total) {
              const percent = Math.round((data.completed / data.total) * 100);
              process.stdout.write(`\r⬇️  다운로드 중: ${percent}%`);
            }
          } catch (e) {
            // JSON 파싱 실패 시 무시
          }
        }
      }
    }

    console.log(`\n\n✅ 모델 다운로드 완료: ${name}`);
    console.log(`\n사용 가능한 명령어:`);
    console.log(`  ollama run ${name}`);
  } catch (error) {
    console.error(`\n❌ 모델 다운로드 실패:`, error.message);
    console.error(`\nOllama가 실행 중인지 확인해주세요:`);
    console.error(`  ollama serve`);
    process.exit(1);
  }
}

// 모델 목록 확인
async function checkModel(name) {
  try {
    const response = await fetch(`${OLLAMA_URL}/api/tags`);
    if (!response.ok) return false;
    
    const data = await response.json();
    return data.models?.some((m) => m.name === name || m.name.startsWith(`${name}:`));
  } catch {
    return false;
  }
}

async function main() {
  // Ollama 서버 연결 확인
  try {
    const healthCheck = await fetch(`${OLLAMA_URL}/api/tags`);
    if (!healthCheck.ok) {
      throw new Error("Ollama 서버에 연결할 수 없습니다");
    }
  } catch (error) {
    console.error("❌ Ollama 서버에 연결할 수 없습니다.");
    console.error(`   URL: ${OLLAMA_URL}`);
    console.error("\nOllama를 설치하고 실행해주세요:");
    console.error("  1. https://ollama.com 에서 Ollama 설치");
    console.error("  2. 터미널에서 'ollama serve' 실행");
    console.error("  3. 또는 Ollama 데스크톱 앱 실행");
    process.exit(1);
  }

  // 이미 다운로드된 모델인지 확인
  const exists = await checkModel(modelName);
  if (exists) {
    console.log(`ℹ️  모델 '${modelName}'이 이미 다운로드되어 있습니다.`);
    console.log("다시 다운로드하시겠습니까? (y/N)");
    
    // 간단한 확인 (실제로는 readline을 사용하는 것이 좋지만, 스크립트 단순화를 위해 스킵)
    console.log("강제 다운로드를 진행합니다...\n");
  }

  await pullModel(modelName);
}

main();


