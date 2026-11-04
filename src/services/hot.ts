import "../db/firebase";
import { getFirestore, doc, setDoc, updateDoc, getDoc, serverTimestamp, increment, collection, query, orderBy, limit, getDocs, where, documentId, Timestamp } from "firebase/firestore";
import type { Event } from "../types";
import { fetchNoticesCleaned } from "../api/eventsFirestore";

export type HotClickDoc = {
  id: string; // key
  count: number;
  title?: string | null;
  sourceUrl?: string | null;
  posterImageUrl?: string | null;
  updatedAt?: any;
};

const COL = "hotClicks";

// ID 정규화: incrementHotClick과 동일한 로직 적용
function normalizeHotClickId(rawId: string): string {
  let key = rawId.replace(/^hot-/, "");
  if (!/^notice-/.test(key)) key = `notice-${key}`;
  return key;
}

// 특정 이벤트 ID의 조회수를 가져오는 함수
export async function getHotClickCount(eventId: string): Promise<number> {
  try {
    const db = getFirestore();
    const normalizedId = normalizeHotClickId(eventId);
    const ref = doc(db, COL, normalizedId);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const data = snap.data() as any;
      return Number(data?.count ?? 0) || 0;
    }
    return 0;
  } catch (error) {
    console.warn("[HOT] getHotClickCount failed", error);
    return 0;
  }
}

// 여러 이벤트 ID의 조회수를 한 번에 가져오는 함수
export async function getHotClickCounts(eventIds: string[]): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (!eventIds.length) return result;
  
  try {
    const db = getFirestore();
    const col = collection(db, COL);
    const normalizedIds = eventIds.map(normalizeHotClickId);
    
    // 원본 ID와 정규화된 ID 매핑
    const normalizedToOriginal = new Map<string, string>();
    eventIds.forEach((originalId) => {
      normalizedToOriginal.set(normalizeHotClickId(originalId), originalId);
    });
    
    // Firestore의 documentId() in 쿼리는 최대 10개까지이므로 청크로 나누어 조회
    const chunkSize = 10;
    for (let i = 0; i < normalizedIds.length; i += chunkSize) {
      const chunkIds = normalizedIds.slice(i, i + chunkSize);
      if (chunkIds.length === 0) continue;
      
      try {
        const snap = await getDocs(query(col, where(documentId(), "in", chunkIds)));
        snap.forEach((d) => {
          const data = d.data() as any;
          const count = Number(data?.count ?? 0) || 0;
          const originalId = normalizedToOriginal.get(d.id);
          if (originalId) {
            result.set(originalId, count);
          }
        });
      } catch (error) {
        console.warn("[HOT] chunk query failed, fallback by getDoc loop", error);
        // 폴백: 개별 getDoc (병렬 처리)
        const getDocPromises = chunkIds.map(async (normalizedId) => {
          try {
            const ref = doc(db, COL, normalizedId);
            const s = await getDoc(ref);
            if (s.exists()) {
              const count = Number(s.data()?.count ?? 0) || 0;
              const originalId = normalizedToOriginal.get(normalizedId);
              if (originalId) {
                result.set(originalId, count);
              }
            }
          } catch (err) {
            console.warn("[HOT] getDoc failed for", normalizedId, err);
          }
        });
        await Promise.allSettled(getDocPromises);
      }
    }
  } catch (error) {
    console.warn("[HOT] getHotClickCounts failed", error);
  }
  
  return result;
}

export async function incrementHotClick(payload: { key: string; title?: string | null; sourceUrl?: string | null; posterImageUrl?: string | null; }): Promise<void> {
  try {
    const db = getFirestore();
    const raw = (payload.key || "").trim();
    if (!raw) return;
    // notice로 통일: 선행 hot- 제거 후, notice- 없으면 부여
    let key = raw.replace(/^hot-/, "");
    if (!/^notice-/.test(key)) key = `notice-${key}`;
    const ref = doc(db, COL, key);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        id: key,
        count: 1,
        title: payload.title ?? null,
        sourceUrl: payload.sourceUrl ?? null,
        posterImageUrl: payload.posterImageUrl ?? null,
        updatedAt: serverTimestamp(),
      });
      console.log("[HOT] created +1", { id: key, prev: 0, next: 1 });
      return;
    }
    const prev = Number(snap.data()?.count ?? 0) || 0;
    await updateDoc(ref, {
      count: increment(1),
      title: payload.title ?? snap.data()?.title ?? null,
      sourceUrl: payload.sourceUrl ?? snap.data()?.sourceUrl ?? null,
      posterImageUrl: payload.posterImageUrl ?? snap.data()?.posterImageUrl ?? null,
      updatedAt: serverTimestamp(),
    });
    console.log("[HOT] increment", { id: key, prev, next: prev + 1 });
  } catch (error) {
    console.warn("[HOT] incrementHotClick failed", error);
    throw error; // 호출자에게 오류 전달
  }
}

export async function fetchHotTop(maxCount: number = 200): Promise<Event[]> {
  try {
    const db = getFirestore();
    const col = collection(db, COL);
    const q = query(col, orderBy("count", "desc"), limit(maxCount));
    const snap = await getDocs(q);
    console.log("[HOT] fetchHotTop: snapshot size", snap.size);
    
    const out: Event[] = [];
    snap.forEach((docu) => {
      const d = docu.data() as any;
      // 저장된 문서 id는 notice-로 통일되어 있다고 가정
      const normalizedId = (() => {
        let id = String(docu.id || "");
        id = id.replace(/^hot-/, "");
        if (!/^notice-/.test(id)) id = `notice-${id}`;
        return id;
      })();
      out.push({
        id: normalizedId,
        title: d?.title || "인기 글",
        summary: null,
        startAt: new Date(d?.updatedAt?.toDate?.() || Date.now()).toISOString(),
        endAt: null,
        location: null,
        tags: ["인기"],
        org: { id: "hot", name: `조회수 ${d?.count ?? 0}`, logoUrl: null },
        sourceUrl: d?.sourceUrl ?? null,
        posterImageUrl: d?.posterImageUrl ?? null,
        ai: null,
        hotClickCount: Number(d?.count ?? 0) || 0,
      } as Event);
    });
    console.log("[HOT] fetchHotTop: result count", out.length);
    return out;
  } catch (error) {
    console.error("[HOT] fetchHotTop error", error);
    return [];
  }
}

// Notice를 Event로 변환하는 헬퍼 함수
function noticeToEvent(notice: any): Event {
  const startAtIso = (() => {
    const date = notice.date || notice.crawled_at || notice.firebase_created_at;
    if (!date) return new Date().toISOString();
    if (date instanceof Date) return date.toISOString();
    if (typeof date === "string") {
      // ISO 문자열이거나 날짜 문자열
      if (date.includes("T")) return date;
      // YYYY-MM-DD 형식
      const match = date.match(/(\d{4})\D(\d{1,2})\D(\d{1,2})/);
      if (match) {
        const [, y, m, d] = match;
        return new Date(Number(y), Number(m) - 1, Number(d)).toISOString();
      }
      return new Date(date).toISOString();
    }
    return new Date().toISOString();
  })();
  
  return {
    id: `notice-${notice.id}`,
    title: notice.title || "",
    summary: notice.content ? String(notice.content).slice(0, 200) : null,
    startAt: startAtIso,
    endAt: null,
    location: null,
    tags: ["공지"],
    org: { id: "notice", name: notice.author || "공지", logoUrl: null },
    sourceUrl: notice.url || null,
    posterImageUrl: Array.isArray(notice.image_urls) && notice.image_urls.length > 0 ? notice.image_urls[0] : null,
    ai: null,
  } as Event;
}

// 최근 N일 공지를 원문 조회수(views) 내림차순으로 자른다.
export async function fetchRecentHotTopWithinDays(days: number = 30, topCount: number = 10): Promise<Event[]> {
  try {
    const notices = await fetchNoticesCleaned(Math.max(150, topCount * 10));
    const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;
    const recent = notices.filter((notice) => {
      const raw = notice.date || notice.crawled_at;
      const ms = raw ? new Date(raw).getTime() : NaN;
      return Number.isFinite(ms) && ms >= cutoffMs;
    });
    recent.sort((a, b) => (Number(b.views) || 0) - (Number(a.views) || 0));
    return recent.slice(0, topCount).map((notice) => ({
      ...noticeToEvent(notice),
      hotClickCount: Number(notice.views) || 0,
    }));
  } catch (error) {
    console.warn("[HOT] fetchRecentHotTopWithinDays failed", error);
    return [];
  }
}

