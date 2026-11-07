import React, { useEffect, useState, useCallback, useMemo, memo } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, useColorScheme } from "react-native";
import { useFocusEffect } from "expo-router";
import SectionHeader from "../../src/components/SectionHeader";
import EventsList from "../../src/components/EventsList";
import type { Event } from "../../src/types";
import { fetchRecentHotTopWithinDays, getHotClickCounts } from "../../src/services/hot";
import { fetchNoticesCleaned, type Notice } from "../../src/api/eventsFirestore";
import { normalize } from "../../src/services/search";
import { subscribe as subscribeFavorites, hydrateFavorites as hydrateFavs } from "../../src/services/favorites";
import { PageTransition } from "../../src/components/PageTransition";
import { usePageTransition } from "../../src/hooks/usePageTransition";

// 태그별 색상 매핑 (검색 페이지와 동일)
const TAG_COLORS: Record<string, { bg: string; text: string; border?: string }> = {
  "수강": { bg: "#E3F2FD", text: "#1976D2", border: "#BBDEFB" },
  "졸업": { bg: "#F3E5F5", text: "#7B1FA2", border: "#CE93D8" },
  "학사": { bg: "#E8F5E9", text: "#388E3C", border: "#A5D6A7" },
  "일반": { bg: "#FAFAFA", text: "#616161", border: "#E0E0E0" },
  "대학원": { bg: "#FFF3E0", text: "#E65100", border: "#FFCC80" },
  "취업": { bg: "#FFEBEE", text: "#C62828", border: "#EF9A9A" },
  "공모전": { bg: "#E1F5FE", text: "#0277BD", border: "#81D4FA" },
  "봉사활동": { bg: "#F1F8E9", text: "#558B2F", border: "#AED581" },
  "교내활동": { bg: "#FCE4EC", text: "#C2185B", border: "#F48FB1" },
  "대외활동": { bg: "#E0F2F1", text: "#00695C", border: "#80CBC4" },
  "지원금": { bg: "#FFF8E1", text: "#F57F17", border: "#FFE082" },
  "장학금": { bg: "#EDE7F6", text: "#512DA8", border: "#B39DDB" },
};

const HotScreen = memo(() => {
  const { isVisible, direction } = usePageTransition();
  const [allEvents, setAllEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [favTick, setFavTick] = useState<number>(0);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const scheme = useColorScheme();

  const previewItem = (e: Event) => ({
    id: e?.id,
    title: typeof e?.title === "string" ? e.title.slice(0, 80) : e?.title,
    hasSummary: typeof e?.summary === "string" && e.summary.length > 0,
    hasAiSummary: typeof e?.ai?.summary === "string" && e.ai.summary.length > 0,
    summaryPreview: typeof e?.summary === "string" ? e.summary.slice(0, 160) : null,
    aiSummaryPreview: typeof e?.ai?.summary === "string" ? e.ai.summary.slice(0, 160) : null,
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // 병렬 처리: hot 게시물과 notices를 동시에 가져오기
      const [top10Raw, notices] = await Promise.all([
        fetchRecentHotTopWithinDays(30, 10),
        fetchNoticesCleaned(200),
      ]);
      
      console.log("[HOT] load: fetched recent hot raw", {
        count: top10Raw.length,
        sample: top10Raw.slice(0, 3).map(previewItem),
      });

      // notices를 Map으로 변환 (빠른 조회를 위해)
      const byUrl = new Map<string, Notice>();
      (notices || []).forEach((n) => {
        const url = (n.url || "").trim();
        if (url) byUrl.set(url, n);
      });
      
      const findNoticeFor = (title?: string | null, url?: string | null): Notice | undefined => {
        const u = (url || "").trim();
        if (u && byUrl.has(u)) return byUrl.get(u);
        const t = normalize(title || "");
        if (!t) return undefined;
        return (notices || []).find((n) => {
          const nt = normalize(n.title || "");
          return nt && (nt === t || nt.includes(t) || t.includes(nt));
        });
      };

      // summary 보강
      const withSummary = (top10Raw as any[]).map((e: any) => {
        if (typeof e?.summary === "string" && e.summary.trim()) return e;
        const matched = findNoticeFor(e?.title, e?.sourceUrl);
        const fromContent = matched?.content ? String(matched.content).slice(0, 200) : null;
        return fromContent ? { ...e, summary: fromContent } : e;
      });
      
      console.log("[HOT] load: after notice-merge", withSummary.slice(0, 3).map(previewItem as any));
      
      setAllEvents(withSummary as any);
    } catch (e) {
      console.error("[HOT] load error", e);
      setAllEvents([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      // 병렬 처리로 성능 개선
      const [top10Raw, notices] = await Promise.all([
        fetchRecentHotTopWithinDays(30, 10),
        fetchNoticesCleaned(200),
      ]);
      
      console.log("[HOT] refresh: fetched recent hot raw", {
        count: top10Raw.length,
        sample: top10Raw.slice(0, 3).map(previewItem),
      });

      const byUrl = new Map<string, Notice>();
      (notices || []).forEach((n) => {
        const url = (n.url || "").trim();
        if (url) byUrl.set(url, n);
      });
      
      const findNoticeFor = (title?: string | null, url?: string | null): Notice | undefined => {
        const u = (url || "").trim();
        if (u && byUrl.has(u)) return byUrl.get(u);
        const t = normalize(title || "");
        if (!t) return undefined;
        return (notices || []).find((n) => {
          const nt = normalize(n.title || "");
          return nt && (nt === t || nt.includes(t) || t.includes(nt));
        });
      };
      
      const withSummary = (top10Raw as any[]).map((e: any) => {
        if (typeof e?.summary === "string" && e.summary.trim()) return e;
        const matched = findNoticeFor(e?.title, e?.sourceUrl);
        const fromContent = matched?.content ? String(matched.content).slice(0, 200) : null;
        return fromContent ? { ...e, summary: fromContent } : e;
      });
      
      console.log("[HOT] refresh: after notice-merge", withSummary.slice(0, 3).map(previewItem as any));
      
      setAllEvents(withSummary as any);
    } catch (e) {
      console.error("[HOT] refresh error", e);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // 상태 변경 시 프리뷰 로그
  useEffect(() => {
    if (!allEvents) return;
    const preview = (allEvents || []).slice(0, 5).map(previewItem);
    console.log("[HOT] state: events updated", { count: allEvents.length, preview });
  }, [allEvents]);

  // 모든 태그 추출
  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    allEvents.forEach((event) => {
      event.tags?.forEach((tag) => tagSet.add(tag));
    });
    return Array.from(tagSet).sort();
  }, [allEvents]);

  // 태그별 필터링된 이벤트
  const filteredEvents = useMemo(() => {
    if (!selectedTag) return allEvents;
    return allEvents.filter((event) => event.tags?.includes(selectedTag));
  }, [allEvents, selectedTag]);

  useEffect(() => {
    hydrateFavs();
    const unsub = subscribeFavorites(() => setFavTick((v) => v + 1));
    return () => unsub();
  }, []);

  // 실시간 조회수 업데이트 (5초마다 - 더 빠른 반영)
  useEffect(() => {
    if (allEvents.length === 0) return;
    
    const updateClickCounts = async () => {
      try {
        const eventIds = allEvents.map((e) => e.id);
        const counts = await getHotClickCounts(eventIds);
        
        setAllEvents((prevEvents) =>
          prevEvents.map((ev) => {
            const count = counts.get(ev.id);
            // 조회수가 있으면 업데이트 (0도 포함)
            if (count !== undefined) {
              return { ...ev, hotClickCount: count };
            }
            return ev;
          })
        );
      } catch (error) {
        console.warn("[HOT] failed to update click counts", error);
      }
    };

    // 초기 업데이트
    updateClickCounts();
    
    // 5초마다 업데이트 (더 빠른 반영)
    const interval = setInterval(updateClickCounts, 30000);
    
    return () => clearInterval(interval);
  }, [allEvents.length]);

  // 페이지 포커스 시 조회수 갱신
  useFocusEffect(
    useCallback(() => {
      if (allEvents.length === 0) return;
      
      const updateClickCounts = async () => {
        try {
          const eventIds = allEvents.map((e) => e.id);
          const counts = await getHotClickCounts(eventIds);
          
          setAllEvents((prevEvents) =>
            prevEvents.map((ev) => {
              const count = counts.get(ev.id);
              if (count !== undefined) {
                return { ...ev, hotClickCount: count };
              }
              return ev;
            })
          );
        } catch (error) {
          console.warn("[HOT] failed to update click counts on focus", error);
        }
      };

      updateClickCounts();
    }, [allEvents.length])
  );

  return (
    <PageTransition isVisible={isVisible} direction={direction}>
      <SafeAreaView style={styles.container} edges={["top", "left", "right"]}> 
      <View style={styles.content}>
        {loading ? (
          <View style={styles.loadingBox}>
            <Text style={styles.loadingText}>불러오는 중...</Text>
          </View>
        ) : (
          <EventsList
            events={filteredEvents}
            placeholderColor="#f5f5f5"
            emptyText={selectedTag ? `#${selectedTag} 태그의 인기 소식이 없습니다` : "최근 30일 내 인기 소식이 없습니다"}
            onPressItem={(ev) => {
              console.log("[UI] hot item press", ev.id);
            }}
            style={{ paddingTop: 0 }}
            ListHeaderComponent={
              <View>
                <SectionHeader title="실시간 인기 소식" showMore={false} style={{ marginTop: 8 }} />
                {allTags.length > 0 && (
                  <View style={styles.tagFilterContainer}>
                    <ScrollView 
                      horizontal 
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.tagFilterScroll}
                    >
                      <TouchableOpacity
                        onPress={() => setSelectedTag(null)}
                        style={[
                          styles.tagButton,
                          { backgroundColor: selectedTag === null 
                            ? (scheme === "dark" ? "#2f80ed" : "#2f80ed")
                            : (scheme === "dark" ? "#2a2a2a" : "#f1f1f1")
                          }
                        ]}
                      >
                        <Text style={[
                          styles.tagButtonText,
                          { color: selectedTag === null 
                            ? "#fff" 
                            : (scheme === "dark" ? "#ddd" : "#333")
                          }
                        ]}>
                          전체
                        </Text>
                      </TouchableOpacity>
                      {allTags.map((tag) => {
                        const tagColor = TAG_COLORS[tag] || TAG_COLORS["일반"];
                        const isActive = selectedTag === tag;
                        return (
                          <TouchableOpacity
                            key={tag}
                            onPress={() => setSelectedTag(tag)}
                            style={[
                              styles.tagButton,
                              { 
                                backgroundColor: isActive
                                  ? (scheme === "dark" ? "#2f80ed" : "#2f80ed")
                                  : (scheme === "dark" 
                                      ? `${tagColor.bg}20` 
                                      : tagColor.bg),
                                borderWidth: isActive ? 0 : 1,
                                borderColor: isActive 
                                  ? "transparent"
                                  : (scheme === "dark"
                                      ? `${tagColor.border || tagColor.text}40`
                                      : (tagColor.border || tagColor.text))
                              }
                            ]}
                          >
                            <Text style={[
                              styles.tagButtonText,
                              { color: isActive
                                ? "#fff"
                                : tagColor.text
                              }
                            ]}>
                              #{tag}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </ScrollView>
                  </View>
                )}
              </View>
            }
            refreshing={refreshing}
            onRefresh={onRefresh}
            extraData={favTick}
          />
        )}
      </View>
    </SafeAreaView>
    </PageTransition>
  );
});

HotScreen.displayName = "HotScreen";

export default HotScreen;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  content: {
    flex: 1,
  },
  loadingBox: {
    paddingVertical: 40,
    alignItems: "center",
  },
  loadingText: {
    color: "#666",
  },
  tagFilterContainer: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  tagFilterScroll: {
    paddingRight: 16,
  },
  tagButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    marginRight: 8,
    minHeight: 36,
    justifyContent: "center",
    alignItems: "center",
  },
  tagButtonText: {
    fontSize: 13,
    fontWeight: "600",
  },
});

