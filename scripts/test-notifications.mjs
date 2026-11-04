/**
 * 알림 기능 테스트를 위한 스크립트
 * 
 * ⚠️ 주의: 이 스크립트는 Firestore 보안 규칙 때문에 실패할 수 있습니다.
 * 
 * 권장 방법:
 * 1. 앱 내에서 테스트: /test/notifications 페이지 사용 (인증된 사용자로 실행)
 * 2. Firestore 콘솔에서 직접 추가
 * 
 * 스크립트 사용법 (Firebase Admin SDK 필요):
 * 1. 관심 태그 설정: 설정 페이지에서 관심 태그 선택
 * 2. 테스트 이벤트 생성: 이 스크립트 실행
 *    node scripts/test-notifications.mjs
 * 
 * 또는 Firestore 콘솔에서 직접:
 * - events 컬렉션에 새 문서 추가
 * - 필드:
 *   - title: string (예: "2025년 하반기 해커톤 참가자 모집")
 *   - summary: string (선택)
 *   - tags: array (예: ["공모전", "교내활동"])
 *   - org: object { id: string, name: string, logoUrl: null, homepageUrl: null }
 *   - sourceUrl: string (선택)
 *   - posterImageUrl: string (선택)
 *   - createdAt: timestamp
 *   - updatedAt: timestamp
 * 
 * 실패 원인:
 * - 클라이언트 SDK는 Firestore 보안 규칙의 영향을 받습니다
 * - 보안 규칙이 인증된 사용자만 쓰기를 허용하는 경우, 스크립트는 실패합니다
 * - 해결: 앱 내 /test/notifications 페이지 사용 (인증된 사용자로 실행)
 */

import { initializeApp } from 'firebase/app';
import { getFirestore, collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '..', '.env') });

const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// 테스트 이벤트 데이터
const testEvents = [
  {
    title: "2025년 하반기 해커톤 참가자 모집",
    summary: "교내 해커톤 참가자를 모집합니다. 팀 매칭 및 사전 교육 제공, 우수팀 시상.",
    tags: ["공모전", "교내활동"],
    org: {
      id: "engineering",
      name: "공학대학",
      logoUrl: null,
      homepageUrl: null,
    },
    sourceUrl: "https://example.com/hackathon",
    posterImageUrl: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  },
  {
    title: "현직자 멘토링 프로그램 안내",
    summary: "IT·SW 분야 현직자와의 1:1 멘토링. 신청 선착순 마감.",
    tags: ["취업", "대외활동"],
    org: {
      id: "career",
      name: "취업진로지원과",
      logoUrl: null,
      homepageUrl: null,
    },
    sourceUrl: null,
    posterImageUrl: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  },
  {
    title: "알고리즘 스터디 모집(초급/중급)",
    summary: "백준 단계별/분류별 문제로 진행. 주 2회 오프라인 스터디.",
    tags: ["학사", "교내활동"],
    org: {
      id: "cs",
      name: "컴퓨터공학부",
      logoUrl: null,
      homepageUrl: null,
    },
    sourceUrl: null,
    posterImageUrl: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  },
  {
    title: "봉사활동 프로그램 신청 안내",
    summary: "지역사회 봉사활동 프로그램에 참여하세요.",
    tags: ["봉사활동"],
    org: {
      id: "volunteer",
      name: "학생처",
      logoUrl: null,
      homepageUrl: null,
    },
    sourceUrl: null,
    posterImageUrl: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  },
];

async function createTestEvents() {
  console.log('🚀 테스트 이벤트 생성 시작...\n');
  
  for (const event of testEvents) {
    try {
      const docRef = await addDoc(collection(db, 'events'), event);
      console.log(`✅ 이벤트 생성 완료: ${event.title}`);
      console.log(`   ID: ${docRef.id}`);
      console.log(`   태그: ${event.tags.join(', ')}\n`);
    } catch (error) {
      console.error(`❌ 이벤트 생성 실패: ${event.title}`, error.message);
    }
  }
  
  console.log('✨ 테스트 이벤트 생성 완료!');
  console.log('\n📝 다음 단계:');
  console.log('1. 앱에서 설정 페이지로 이동');
  console.log('2. 관심 태그 선택 (예: "공모전", "취업" 등)');
  console.log('3. 알림 페이지에서 새 알림 확인');
  console.log('\n💡 참고: 알림은 관심 태그와 매칭된 이벤트에 대해서만 생성됩니다.');
}

createTestEvents()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('스크립트 실행 오류:', error);
    process.exit(1);
  });

