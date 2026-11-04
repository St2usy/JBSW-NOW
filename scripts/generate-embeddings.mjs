/**
 * Firestore의 공지사항과 이벤트에 벡터 임베딩을 생성하고 저장하는 스크립트
 * 
 * 사용법:
 *   node scripts/generate-embeddings.mjs
 * 
 * 옵션:
 *   --limit=100        처리할 문서 수 제한
 *   --collection=notices  처리할 컬렉션 (notices 또는 events)
 *   --force            기존 임베딩이 있어도 재생성
 */

import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, "..", ".env") });

// Firebase Admin 초기화
let db;
try {
  const serviceAccountPath = join(__dirname, "../GoogleService-Info.plist");
  // 실제로는 JSON 형식의 서비스 계정 키가 필요합니다
  // initializeApp({ credential: cert(serviceAccount) });
  console.log("Firebase Admin 초기화 필요");
} catch (error) {
  console.error("Firebase Admin 초기화 실패:", error);
  process.exit(1);
}

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.EXPO_PUBLIC_GEMINI_API_KEY;
const EMBEDDING_MODEL = "models/text-embedding-004";

if (!GEMINI_API_KEY) {
  console.error("GEMINI_API_KEY 또는 EXPO_PUBLIC_GEMINI_API_KEY 환경 변수가 필요합니다.");
  process.exit(1);
}

/**
 * 텍스트를 벡터 임베딩으로 변환
 */
async function generateEmbedding(text) {
  if (!text || text.trim().length === 0) {
    throw new Error("Text cannot be empty");
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/${EMBEDDING_MODEL}:embedContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        content: {
          parts: [{ text: text.trim() }],
        },
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini Embedding API error: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  return data.embedding?.values || [];
}

/**
 * 문서를 검색 가능한 텍스트로 변환
 */
function documentToSearchableText(doc, type) {
  if (type === "notice") {
    return `${doc.title}\n${doc.content || ""}`.trim();
  } else {
    return `${doc.title}\n${doc.summary || ""}`.trim();
  }
}

/**
 * 컬렉션의 문서들에 임베딩 생성 및 저장
 */
async function processCollection(collectionName, limitCount = 100, force = false) {
  console.log(`\n[Embeddings] Processing ${collectionName} collection (limit: ${limitCount})...`);

  const collectionRef = db.collection(collectionName);
  const snapshot = await collectionRef.limit(limitCount).get();

  let processed = 0;
  let skipped = 0;
  let errors = 0;

  for (const doc of snapshot.docs) {
    try {
      const data = doc.data();

      // 이미 임베딩이 있고 force가 false면 스킵
      if (!force && data.embedding && Array.isArray(data.embedding)) {
        skipped++;
        continue;
      }

      // 검색 가능한 텍스트 생성
      const searchableText = documentToSearchableText(data, collectionName === "notices" ? "notice" : "event");

      if (!searchableText || searchableText.length < 10) {
        console.warn(`[Embeddings] Skipping ${doc.id}: text too short`);
        skipped++;
        continue;
      }

      // 임베딩 생성
      console.log(`[Embeddings] Generating embedding for ${doc.id}...`);
      const embedding = await generateEmbedding(searchableText);

      // Firestore에 저장
      await doc.ref.update({
        embedding,
        embeddingModel: EMBEDDING_MODEL,
        embeddingUpdatedAt: new Date(),
      });

      processed++;
      console.log(`[Embeddings] ✓ Processed ${doc.id} (${processed}/${snapshot.size})`);

      // API 레이트 리밋 방지를 위한 딜레이
      await new Promise((resolve) => setTimeout(resolve, 100));
    } catch (error) {
      console.error(`[Embeddings] ✗ Error processing ${doc.id}:`, error.message);
      errors++;
    }
  }

  console.log(`\n[Embeddings] ${collectionName} 완료:`);
  console.log(`  - 처리됨: ${processed}`);
  console.log(`  - 스킵됨: ${skipped}`);
  console.log(`  - 오류: ${errors}`);
}

// 메인 실행
async function main() {
  const args = process.argv.slice(2);
  const limitArg = args.find((arg) => arg.startsWith("--limit="));
  const collectionArg = args.find((arg) => arg.startsWith("--collection="));
  const force = args.includes("--force");

  const limitCount = limitArg ? parseInt(limitArg.split("=")[1], 10) : 100;
  const targetCollection = collectionArg ? collectionArg.split("=")[1] : null;

  console.log("=".repeat(60));
  console.log("벡터 임베딩 생성 스크립트");
  console.log("=".repeat(60));
  console.log(`제한: ${limitCount}개`);
  console.log(`강제 재생성: ${force ? "예" : "아니오"}`);
  console.log(`대상 컬렉션: ${targetCollection || "모두"}`);

  if (targetCollection) {
    await processCollection(targetCollection, limitCount, force);
  } else {
    await processCollection("notices", limitCount, force);
    await processCollection("events", limitCount, force);
  }

  console.log("\n[Embeddings] 모든 작업 완료!");
}

main().catch(console.error);

