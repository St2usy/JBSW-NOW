import "../db/firebase";
import { getFirestore, collection, query, where, orderBy, limit, getDocs, Timestamp, type QueryDocumentSnapshot, type DocumentData } from "firebase/firestore";
import type { Event } from "../types";
import { api } from "./client";
import { formatRowTextForPost, cleanCrawledText } from "../utils/textCleaner";

/**
 * Firestore에서 최근 14일 이내 생성된 이벤트 중 포스터 이미지가 있는 문서를 가져옵니다.
 * - 입력: 최대 건수(maxCount)
 * - 필터: date >= (현재 - 14일), posterImageUrl 존재
 * - 정렬: date DESC
 *
 * 주의(파이어스토어 제약):
 * - 범위 필터(<, <=, >, >=, !=, not-in)는 단일 필드에만 허용됩니다.
 *   본 쿼리는 date(>=)과 posterImageUrl(!=) 두 필드에 범위 필터가 있어
 *   프로젝트/인덱스와 환경에 따라 에러가 발생할 수 있습니다.
 *   문제가 된다면 posterImageUrl 필터를 exists 체크 방식(예: '>' "")으로 바꾸거나,
 *   데이터 모델을 변경(저장 시 flag 필드 추가)하는 방식을 고려하세요.
 */

// 최근 14일 이내에 생성된 문서 중 포스터 이미지가 있는 항목을 가져옵니다.
export async function fetchRecentPosterEvents(maxCount: number = 200): Promise<Event[]> {
  const db = getFirestore();
  const eventsRef = collection(db, "events");

  // 기준 시점 계산: 현재 시각과 14일 전 Timestamp
  const now = Timestamp.now();
  const fourteenDaysAgo = Timestamp.fromMillis(now.toMillis() - 14 * 24 * 60 * 60 * 1000);

  // Firestore 제약으로 하나의 쿼리에서 여러 필드에 부등호/범위 필터를 함께 사용할 수 없습니다.
  // date 범위 필터만 사용하고, posterImageUrl 존재 여부는 클라이언트에서 후처리합니다.
  // 충분한 수집을 위해 쿼리 limit을 여유 있게 늘린 뒤(slice) 반환합니다.
  const q = query(
    eventsRef,
    where("date", ">=", fourteenDaysAgo),
    orderBy("date", "desc"),
    limit(Math.max(20, maxCount * 3))
  );

  // 디버그: 쿼리 조건 로그
  console.log("[DB] fetchRecentPosterEvents:start", {
    maxCount,
    sinceISO: fourteenDaysAgo.toDate().toISOString(),
    nowISO: now.toDate().toISOString(),
  });

  try {
    const snap = await getDocs(q);
    console.log("[DB] fetchRecentPosterEvents:snapshot", { count: snap.size });

    const collected: Event[] = [];
    snap.forEach((doc) => {
      const d = doc.data() as any;
      // 간단한 문서 단위 로그
      console.log("[DB] fetchRecentPosterEvents:doc", {
        id: doc.id,
        posterImageUrl: d?.posterImageUrl ?? null,
        date: d?.date?.toDate?.()?.toISOString?.() ?? d?.date ?? null,
      });
      // 필요한 필드만 추출하고 기본값을 보강합니다.
      collected.push({
        id: doc.id,
        title: d.title,
        summary: d.summary ?? null,
        startAt: d.startAt ?? null,
        endAt: d.endAt ?? null,
        location: d.location ?? null,
        tags: d.tags ?? [],
        org: d.org,
        sourceUrl: d.sourceUrl ?? null,
        posterImageUrl: d.posterImageUrl ?? null,
        ai: d.ai ?? null,
      } as Event);
    });
    // posterImageUrl이 존재하는 문서만 필터링 후 상한(maxCount)으로 자릅니다.
    const out = collected.filter((e) => !!e.posterImageUrl && String(e.posterImageUrl).trim() !== "").slice(0, maxCount);
    console.log("[DB] fetchRecentPosterEvents:filtered", { filteredCount: out.length });
    return out;
  } catch (err) {
    console.error("[DB] fetchRecentPosterEvents:error", err);
    throw err;
  }
}

// 알림(notification) 컬렉션에서 배너로 사용할 이미지가 포함된 항목을 조회
// 다양한 필드명을 허용: imageUrl | image_url | image | bannerImageUrl | image_urls[0]
export async function fetchRecentNotificationBanners(maxCount: number = 200): Promise<Event[]> {
  const db = getFirestore();
  const ref = collection(db, "notifications");
  // date 기준 최근 순, 실패 시 정렬 없이 제한만 적용
  let snap;
  try {
    snap = await getDocs(query(ref, orderBy("date", "desc"), limit(maxCount * 3)));
  } catch (_) {
    snap = await getDocs(query(ref, limit(maxCount * 3)));
  }

  const out: Event[] = [];
  snap.forEach((doc: { id: string; data: () => any }) => {
    const d = doc.data() as any;
    const candidates: Array<string | null | undefined> = [
      d?.imageUrl,
      d?.image_url,
      d?.image,
      d?.bannerImageUrl,
      Array.isArray(d?.image_urls) ? d.image_urls[0] : undefined,
    ];
    const image = candidates.find((u) => typeof u === "string" && String(u).trim() !== "");
    if (!image) return;

    // 최소 필드만 채운 Event 형태로 변환
    out.push({
      id: `notif-${doc.id}`,
      title: d?.title || "",
      summary: d?.body || d?.content || null,
      startAt: d?.date?.toDate?.()?.toISOString?.() || new Date().toISOString(),
      endAt: null,
      location: null,
      tags: ["알림"],
      org: { id: "notification", name: d?.sender || "알림", logoUrl: null },
      sourceUrl: d?.url || d?.link || null,
      posterImageUrl: image,
      ai: null,
    } as Event);
  });

  // 상한 제한
  return out.slice(0, maxCount);
}

type ApiNotice = {
  id: string;
  title?: string | null;
  author?: string | null;
  date?: string | null;
  content_html?: string | null;
  url?: string | null;
  category?: string | null;
  views?: string | null;
  crawled_at?: string | null;
  image_urls?: string[] | null;
  attachments?: string | null;
};

function cleanNoticeContent(rawContent: string): string {
  if (/<TEXT>|<JSON>/i.test(rawContent)) {
    const { text } = formatRowTextForPost(rawContent);
    return cleanCrawledText(text, { maxLength: 10000 });
  }
  return cleanCrawledText(rawContent, { maxLength: 10000 });
}

function mapApiNotice(d: ApiNotice): Notice {
  const rawContent = d.content_html ?? "";
  return {
    id: String(d.id),
    title: cleanCrawledText(d.title ?? "", { maxLength: 300 }),
    content: cleanNoticeContent(rawContent),
    url: d.url ?? null,
    author: d.author ?? null,
    category: d.category ?? null,
    date: d.date ?? null,
    crawled_at: d.crawled_at ?? null,
    image_urls: Array.isArray(d.image_urls) ? d.image_urls : null,
    attachments: d.attachments ?? null,
    views: d.views ?? null,
  };
}

function noticeStartAt(date: string | null | undefined): string {
  if (date && /^\d{4}-\d{2}-\d{2}/.test(date)) {
    const parsed = new Date(date);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return new Date().toISOString();
}

// 공지 배너: inline 이미지가 있는 글을 콘텐츠 API에서 가져옵니다.
export async function fetchRecentNoticeBanners(maxCount: number = 10): Promise<Event[]> {
  const res = await api.get("/notices/banners", { params: { limit: maxCount } });
  const rows: ApiNotice[] = Array.isArray(res.data?.data) ? res.data.data : [];
  const out: Event[] = [];
  for (const d of rows) {
    const image = Array.isArray(d.image_urls) && d.image_urls.length > 0 ? d.image_urls[0] : undefined;
    if (!image) continue;
    out.push({
      id: `notice-${d.id}`,
      title: cleanCrawledText(d.title ?? "", { maxLength: 300 }),
      summary: null,
      startAt: noticeStartAt(d.date),
      endAt: null,
      location: null,
      tags: ["공지"],
      org: { id: "notice", name: d.author || "공지", logoUrl: null },
      sourceUrl: d.url ?? null,
      posterImageUrl: image,
      ai: null,
    });
  }
  return out.slice(0, maxCount);
}

// Firestore events는 콘텐츠 원본으로 쓰지 않습니다.
export async function searchHotNews(_searchTerm: string, _maxCount: number = 200): Promise<Event[]> {
  return [];
}

// 인기소식 전용 최근 검색어 관련 함수들
export async function getHotRecentSearches(): Promise<string[]> {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      const stored = window.localStorage.getItem("hotRecentSearches");
      return stored ? JSON.parse(stored) : [];
    }
    return [];
  } catch (error) {
    console.error("인기소식 최근 검색어 로드 실패:", error);
    return [];
  }
}

export async function saveHotRecentSearch(query: string): Promise<void> {
  try {
    const recent = await getHotRecentSearches();
    const updated = [query, ...recent.filter(item => item !== query)].slice(0, 10);
    
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.setItem("hotRecentSearches", JSON.stringify(updated));
    }
  } catch (error) {
    console.error("인기소식 최근 검색어 저장 실패:", error);
  }
}

export async function clearHotRecentSearches(): Promise<void> {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.removeItem("hotRecentSearches");
    }
  } catch (error) {
    console.error("인기소식 최근 검색어 삭제 실패:", error);
  }
}

// Firestore events는 콘텐츠 원본으로 쓰지 않습니다.
export async function fetchRecentNews(_maxCount: number = 200): Promise<Event[]> {
  return [];
}

export async function fetchRecentNewsWithinDays(_days: number = 30, _maxCount: number = 200): Promise<Event[]> {
  return [];
}

export async function fetchRecentNewsByDateWithinDays(_days: number = 30, _maxCount: number = 200): Promise<Event[]> {
  return [];
}


// notices 컬렉션: 원문(title/content) 정제 전/후 로그와 함께 정제 결과 반환
export type Notice = {
  id: string;
  title: string; // 정제된 제목
  content: string; // 정제된 본문(plain text)
  url?: string | null; // 원문 URL
  author?: string | null;
  category?: string | null;
  date?: string | null;
  crawled_at?: string | null;
  firebase_created_at?: string | null;
  firebase_updated_at?: string | null;
  image_urls?: string[] | null;
  attachments?: string | null; // 예: "3"
  views?: string | null;
  createdAt?: any;
  updatedAt?: any;
};

export async function fetchNoticesCleaned(maxCount: number = 200): Promise<Notice[]> {
  const res = await api.get("/notices", { params: { limit: maxCount } });
  const rows: ApiNotice[] = Array.isArray(res.data?.data) ? res.data.data : [];
  return rows.map(mapApiNotice);
}

// 샘플: 15건만 조회해 정제 및 로그 출력
export async function fetchNoticesSample(): Promise<Notice[]> {
  return fetchNoticesCleaned(15);
}


