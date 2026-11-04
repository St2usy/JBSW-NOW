/**
 * RAG (Retrieval-Augmented Generation) 시스템
 * Firebase에서 관련 문서를 검색하여 LLM 컨텍스트로 제공
 */

import { fetchNoticesCleaned, type Notice } from "./eventsFirestore";

export type RetrievedDocument = {
  id: string;
  title: string;
  content: string;
  source: "notice" | "event";
  url?: string | null;
  date?: string | null;
};

/**
 * 키워드 기반 문서 검색 (간단한 구현)
 * 나중에 벡터 검색으로 업그레이드 가능
 */
function searchDocuments(
  query: string,
  notices: Notice[],
  maxResults: number = 5
): RetrievedDocument[] {
  const queryLower = query.toLowerCase();
  const queryWords = queryLower.split(/\s+/).filter((w) => w.length > 1);

  const results: RetrievedDocument[] = [];

  // 공지사항 검색
  for (const notice of notices) {
    const titleLower = notice.title.toLowerCase();
    const contentLower = notice.content.toLowerCase();

    // 제목 매칭 점수
    let score = 0;
    for (const word of queryWords) {
      if (titleLower.includes(word)) score += 3; // 제목 매칭은 높은 점수
      if (contentLower.includes(word)) score += 1; // 내용 매칭은 낮은 점수
    }

    if (score > 0) {
      results.push({
        id: notice.id,
        title: notice.title,
        content: notice.content.slice(0, 500), // 최대 500자
        source: "notice",
        url: notice.url || null,
        date: notice.date || notice.firebase_created_at || null,
        score, // 내부 정렬용
      } as RetrievedDocument & { score: number });
    }
  }

  // 점수 순으로 정렬하고 상위 N개 반환
  return (results as Array<RetrievedDocument & { score: number }>)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)
    .map(({ score, ...doc }) => doc);
}

/**
 * RAG 컨텍스트 생성
 * 검색된 문서들을 LLM 프롬프트에 포함할 형식으로 변환
 */
export function formatRAGContext(docs: RetrievedDocument[]): string {
  if (docs.length === 0) {
    return "관련 정보를 찾을 수 없습니다.";
  }

  const sections = docs.map((doc, idx) => {
    const sourceLabel = doc.source === "notice" ? "📢 공지사항" : "🎉 이벤트";
    const dateInfo = doc.date ? `\n📅 날짜: ${doc.date}` : "";
    const urlInfo = doc.url ? `\n🔗 링크: ${doc.url}` : "";
    
    // 내용을 더 읽기 쉽게 정리 (너무 길면 요약)
    let content = doc.content;
    if (content.length > 300) {
      content = content.slice(0, 300) + "...";
    }
    
    return `${sourceLabel}: ${doc.title}${dateInfo}${urlInfo}\n\n📝 내용:\n${content}`;
  });

  return `다음은 검색된 관련 정보입니다 (총 ${docs.length}개):\n\n${sections.join("\n\n---\n\n")}\n\n위 정보를 바탕으로 사용자의 질문에 친절하고 상세하게 답변해주세요.`;
}

/**
 * 날짜 문자열을 파싱하여 밀리초로 변환
 */
function parseDateMs(dateStr: string | null | undefined): number | null {
  if (!dateStr || typeof dateStr !== "string") return null;
  
  // YYYY.MM.DD 형식 파싱
  const match = dateStr.match(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})/);
  if (match) {
    const year = parseInt(match[1], 10);
    const month = parseInt(match[2], 10) - 1; // 0-based
    const day = parseInt(match[3], 10);
    return new Date(year, month, day).getTime();
  }
  
  // ISO 형식 파싱
  const parsed = Date.parse(dateStr);
  return isNaN(parsed) ? null : parsed;
}

/**
 * 최근 N일 이내의 공지사항만 필터링
 */
function filterRecentNotices(notices: Notice[], days: number = 90): Notice[] {
  const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;
  
  return notices.filter((notice) => {
    // date, crawled_at, firebase_created_at 중 하나라도 최근이면 포함
    const dateMs = parseDateMs(notice.date || notice.crawled_at || notice.firebase_created_at);
    if (!dateMs) return false;
    
    // 미래 날짜는 제외 (데이터 오류 방지)
    if (dateMs > Date.now() + 7 * 24 * 60 * 60 * 1000) return false;
    
    return dateMs >= cutoffMs;
  });
}

/**
 * RAG 검색 실행
 */
export async function retrieveRelevantDocuments(
  query: string,
  maxResults: number = 5
): Promise<RetrievedDocument[]> {
  try {
    const notices = await fetchNoticesCleaned(500);
    const recentNotices = filterRecentNotices(notices, 90);
    
    console.log("[RAG] Filtered notices", {
      total: notices.length,
      recent: recentNotices.length,
      cutoff: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
    });

    return searchDocuments(query, recentNotices, maxResults);
  } catch (error) {
    console.error("[RAG] 검색 오류:", error);
    return [];
  }
}

/**
 * 검색 결과에서 citations URL 추출
 */
export function extractCitations(docs: RetrievedDocument[]): string[] {
  return docs
    .map((doc) => doc.url)
    .filter((url): url is string => url !== null && url !== undefined && url.trim() !== "");
}

