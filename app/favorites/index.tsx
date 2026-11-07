import React, { useEffect, useMemo, useState, memo } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { View, Text, ActivityIndicator } from "react-native";
import EventsList from "../../src/components/EventsList";
import type { Event } from "../../src/types";
import { getFavorites as getFavIds, subscribe, hydrateFavorites as hydrateFavs } from "../../src/services/favorites";
import { fetchNoticesCleaned } from "../../src/api/eventsFirestore";
import { PageTransition } from "../../src/components/PageTransition";
import { usePageTransition } from "../../src/hooks/usePageTransition";

const FavoritesScreen = memo(() => {
  const { isVisible, direction } = usePageTransition();
  const [allItems, setAllItems] = useState<Event[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [favTick, setFavTick] = useState<number>(0);

  // 모든 데이터 로드(공지 + 이벤트) 후 상태 보관
  const loadAll = async () => {
    setLoading(true);
    try {
      await hydrateFavs();
      const notices = await fetchNoticesCleaned(200);
      const mappedNotices: Event[] = (notices || []).map((n: any): Event => ({
        id: `notice-${n.id}`,
        title: n.title,
        summary: n.content ? String(n.content).slice(0, 200) : null,
        startAt: n.date || n.crawled_at || new Date().toISOString(),
        endAt: null,
        location: null,
        tags: Array.isArray(n.tags) ? n.tags : [],
        org: { id: "notice", name: n.author || "공지", logoUrl: null },
        sourceUrl: n.url || null,
        posterImageUrl: Array.isArray(n.image_urls) && n.image_urls.length > 0 ? n.image_urls[0] : null,
        ai: null,
      }));
      setAllItems(mappedNotices);
    } catch (e) {
      setAllItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  // 즐겨찾기 변경 구독 → 리스트 리렌더
  useEffect(() => {
    const unsub = subscribe(() => setFavTick((v) => v + 1));
    return () => unsub();
  }, []);

  // 컴포넌트 마운트 시 즐겨찾기 상태 로드
  useEffect(() => {
    (async () => {
      try {
        await hydrateFavs();
        setFavTick((v) => v + 1);
      } catch {}
    })();
  }, []);

  // 즐겨찾기 id 집합에 따라 필터링된 피드
  const favoriteFeed = useMemo(() => {
    const favIds = new Set(getFavIds());
    return allItems.filter((e) => favIds.has(e.id));
  }, [allItems, favTick]);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await loadAll();
      await hydrateFavs();
      setFavTick((v) => v + 1);
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <PageTransition isVisible={isVisible} direction={direction}>
      <SafeAreaView style={{ flex: 1, backgroundColor: "#fff" }} edges={["top", "left", "right"]}>
      <View style={{ flex: 1 }}>
        <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 }}>
          <Text style={{ fontSize: 20, fontWeight: "700", color: "#000" }}>즐겨찾기</Text>
        </View>

        {loading ? (
          <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
            <ActivityIndicator size="small" color="#007AFF" />
            <Text style={{ marginTop: 10, color: "#666" }}>로딩 중...</Text>
          </View>
        ) : (
          <EventsList
            events={favoriteFeed}
            placeholderColor="#f5f5f5"
            emptyText="즐겨찾기가 없습니다"
            onPressItem={(ev) => {}}
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

FavoritesScreen.displayName = "FavoritesScreen";

export default FavoritesScreen;


