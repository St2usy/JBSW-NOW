import React, { useState, useEffect, useMemo, useCallback, memo } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { View, Text, TextInput, Pressable, StyleSheet, FlatList, ScrollView, TouchableOpacity, useColorScheme } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Event } from "../../src/types";
import EventCard from "../../src/components/EventCard";
import { fetchNoticesCleaned } from "../../src/api/eventsFirestore";
import { ALLOWED_TAGS, TAG_COLORS } from "../../src/services/tags";
import { searchByAllWords, normalize, extractHashtags, filterItemsByAllTags } from "../../src/services/search";
import { PageTransition } from "../../src/components/PageTransition";
import { usePageTransition } from "../../src/hooks/usePageTransition";

const SearchScreen = memo(() => {
  const { isVisible, direction } = usePageTransition();
  const router = useRouter();
  const params = useLocalSearchParams<{ q?: string; tag?: string }>();
  const scheme = useColorScheme();
  const [searchQuery, setSearchQuery] = useState("");
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [allItems, setAllItems] = useState<any[]>([]);
  const [results, setResults] = useState<any[]>([]);
  const [isDataLoaded, setIsDataLoaded] = useState(false);
  const RECENT_KEY = "recentSearches";

  const isHashtagMode = useMemo(() => {
    const q = normalize(searchQuery);
    return extractHashtags(q).length > 0;
  }, [searchQuery]);

  // 최근 검색어 로드 + 데이터 프리로드(메모리)
  useEffect(() => {
    loadRecentSearches();
    preloadData();
  }, []);

  // URL 파라미터에서 검색어/태그를 받아 자동 검색 수행
  useEffect(() => {
    if (!isDataLoaded) return;
    
    // 태그 파라미터가 있으면 해시태그 검색
    if (params.tag && typeof params.tag === "string") {
      const tagQuery = `#${params.tag}`;
      setSearchQuery(tagQuery);
      performSearch(tagQuery);
      return;
    }
    
    // 일반 검색어 파라미터가 있으면 검색 수행
    if (params.q && typeof params.q === "string") {
      setSearchQuery(params.q);
      performSearch(params.q);
    }
  }, [params.q, params.tag, isDataLoaded]);

  // 컴포넌트 마운트 시 최근 검색어 재로드
  // (포커스 시 재로드는 네비게이션 훅 문제로 제거)

  const loadRecentSearches = async () => {
    try {
      const saved = await AsyncStorage.getItem(RECENT_KEY);
      const parsed = saved ? (JSON.parse(saved) as string[]) : [];
      console.log("[SEARCH] loadRecentSearches", { savedLength: parsed.length, items: parsed });
      setRecentSearches(parsed);
    } catch (error) {
      console.error("최근 검색어 로드 실패:", error);
    }
  };

  const preloadData = async () => {
    try {
      const notices = await fetchNoticesCleaned(200);
      const noticeAsEventsRaw: Event[] = (notices || []).map((n: any) => ({
        id: `notice-${n.id}`,
        title: n.title,
        summary: n.content ? String(n.content).slice(0, 200) : null,
        startAt: n.date || n.crawled_at || n.firebase_created_at || "",
        endAt: null,
        location: null,
        tags: Array.isArray(n.tags) ? n.tags : [],
        org: { id: "notice", name: n.author || "공지", logoUrl: null },
        sourceUrl: n.url || null,
        posterImageUrl: Array.isArray(n.image_urls) && n.image_urls.length > 0 ? n.image_urls[0] : null,
        ai: null,
      } as any));
      setAllItems(noticeAsEventsRaw);
      setIsDataLoaded(true);
    } catch (e) {
      console.warn("[UI] preloadData error", e);
      setAllItems([]);
      setIsDataLoaded(true);
    }
  };

  // 검색 수행 함수 (외부에서 호출 가능)
  const performSearch = useCallback(async (query: string, saveToRecent = true) => {
    const q = normalize(query);
    if (!q) {
      setIsSearching(false);
      setResults([]);
      return;
    }
    
    // 최근 검색어 저장 (옵션)
    if (saveToRecent) {
      try {
        const beforeRaw = await AsyncStorage.getItem(RECENT_KEY);
        const before = beforeRaw ? (JSON.parse(beforeRaw) as string[]) : [];
        const updated = [q, ...before.filter((v) => v !== q)].slice(0, 10);
        await AsyncStorage.setItem(RECENT_KEY, JSON.stringify(updated));
        console.log("[SEARCH] saveRecentSearch", { query: q, before: before.length, after: updated.length });
        setRecentSearches(updated);
      } catch {}
    }

    const tags = extractHashtags(q);
    const found = tags.length > 0
      ? filterItemsByAllTags(allItems as any, tags)
      : searchByAllWords(allItems as any, q, ["title", "summary", "tags"] as any);
    setIsSearching(true);
    setResults(found);
  }, [allItems]);

  const handleSearch = async () => {
    await performSearch(searchQuery, true);
  };

  const handleRecentSearchPress = async (query: string) => {
    console.log("[SEARCH] pressRecentSearch", { query });
    setSearchQuery(query);
    await performSearch(query, false); // 이미 저장된 검색어이므로 다시 저장하지 않음
  };

  const handleTagPress = async (tag: string) => {
    const tagQuery = `#${tag}`;
    setSearchQuery(tagQuery);
    await performSearch(tagQuery, true);
  };

  const handleClearRecent = async () => {
    try {
      await AsyncStorage.removeItem(RECENT_KEY);
      console.log("[SEARCH] clearAllRecent");
      setRecentSearches([]);
    } catch (error) {
      console.error("최근 검색어 삭제 실패:", error);
    }
  };

  return (
    <PageTransition isVisible={isVisible} direction={direction}>
      <SafeAreaView style={styles.container}>
      {/* 검색 헤더 */}
      <View style={styles.header}>
        <View style={[styles.searchContainer, isHashtagMode && styles.searchContainerTagActive]}>
          <Ionicons name="search" size={20} color={isHashtagMode ? "#7C3AED" : "#999"} style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="검색"
            value={searchQuery}
            onChangeText={setSearchQuery}
            onSubmitEditing={handleSearch}
            returnKeyType="search"
          />
          {isHashtagMode ? (
            <View style={styles.tagModeBadge}>
              <Ionicons name="pricetag" size={14} color="#7C3AED" />
              <Text style={styles.tagModeText}>태그</Text>
            </View>
          ) : null}
        </View>
        
        {/* 태그 안내 및 태그 목록 */}
        {!isSearching && (
          <View style={styles.tagSection}>
            <View style={styles.tagGuide}>
              <Ionicons name="information-circle-outline" size={16} color={scheme === "dark" ? "#999" : "#666"} />
              <Text style={[styles.tagGuideText, { color: scheme === "dark" ? "#bbb" : "#666" }]}>
                #태그명을 통해 관심사별 정보를 모아보세요!
              </Text>
            </View>
            <ScrollView 
              horizontal 
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.tagsContainer}
            >
              {ALLOWED_TAGS.map((tag) => {
                const tagColor = TAG_COLORS[tag] || TAG_COLORS["일반"];
                return (
                  <TouchableOpacity
                    key={tag}
                    onPress={() => handleTagPress(tag)}
                    style={[
                      styles.tagChip,
                      {
                        backgroundColor: scheme === "dark" 
                          ? `${tagColor.bg}20` 
                          : tagColor.bg,
                        borderColor: scheme === "dark"
                          ? `${tagColor.border}40`
                          : tagColor.border,
                      }
                    ]}
                  >
                    <Text style={[
                      styles.tagChipText,
                      { color: scheme === "dark" ? tagColor.text : tagColor.text }
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

      {/* 검색 결과 또는 최근 검색어 */}
      <View style={styles.content}>
        {isSearching ? (
          // 검색 결과
          <View style={styles.searchResults}>
            {results.length > 0 ? (
              <FlatList
                data={results}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                  <EventCard 
                    event={item as Event} 
                    onPress={() => router.push({ pathname: "/events/[id]", params: { id: item.id } })} 
                  />
                )}
                showsVerticalScrollIndicator={false}
              />
            ) : (
              <View style={styles.emptyState}>
                <Text style={styles.emptyText}>검색 결과가 없습니다</Text>
              </View>
            )}
          </View>
        ) : (
          // 최근 검색어 (칩 UI)
          <View>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>최근 검색어</Text>
              {recentSearches.length > 0 && (
                <Pressable onPress={handleClearRecent}>
                  <Text style={styles.clearButton}>전체삭제</Text>
                </Pressable>
              )}
            </View>
            {recentSearches.length > 0 ? (
              <View style={styles.chipsContainer}>
                {recentSearches.map((item, index) => (
                  <View key={`${item}-${index}`} style={styles.chip}>
                    <Pressable style={styles.chipTextWrap} onPress={() => handleRecentSearchPress(item)}>
                      <Text style={styles.chipText} numberOfLines={1}>{item}</Text>
                    </Pressable>
                    <Pressable
                      style={styles.chipClose}
                      hitSlop={8}
                      onPress={() => {
                        const updated = recentSearches.filter((s) => s !== item);
                        console.log("[SEARCH] removeRecent", { item, before: recentSearches.length, after: updated.length });
                        setRecentSearches(updated);
                        try {
                          AsyncStorage.setItem(RECENT_KEY, JSON.stringify(updated));
                        } catch {}
                      }}
                    >
                      <Ionicons name="close" size={16} color="#666" />
                    </Pressable>
                  </View>
                ))}
              </View>
            ) : (
              <View style={styles.emptyState}>
                <Text style={styles.emptyText}>최근 검색어가 없습니다</Text>
              </View>
            )}
          </View>
        )}
      </View>
    </SafeAreaView>
    </PageTransition>
  );
});

SearchScreen.displayName = "SearchScreen";

export default SearchScreen;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  header: {
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  tagSection: {
    width: "100%",
    marginTop: 16,
  },
  tagGuide: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  tagGuideText: {
    fontSize: 13,
    marginLeft: 6,
    fontWeight: "500",
  },
  tagsContainer: {
    paddingRight: 16,
  },
  tagChip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    marginRight: 10,
    borderWidth: 1,
    minHeight: 40,
    justifyContent: "center",
    alignItems: "center",
  },
  tagChipText: {
    fontSize: 14,
    fontWeight: "600",
  },
  searchContainer: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f5f5f5",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "transparent",
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  searchContainerTagActive: {
    borderColor: "#E9D5FF",
    backgroundColor: "#FAF5FF",
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: "#000",
  },
  tagModeBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: "#F3E8FF",
    marginLeft: 8,
  },
  tagModeText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#7C3AED",
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 20,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#000",
  },
  clearButton: {
    fontSize: 14,
    color: "#007AFF",
  },
  chipsContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: 8,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f5f5f5",
    borderRadius: 20,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginRight: 10,
    marginBottom: 12,
  },
  chipTextWrap: {
    maxWidth: 200,
  },
  chipText: {
    fontSize: 16,
    color: "#000",
  },
  chipClose: {
    marginLeft: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  searchResults: {
    flex: 1,
  },
  emptyState: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 60,
  },
  emptyText: {
    fontSize: 14,
    color: "#999",
  },
});
