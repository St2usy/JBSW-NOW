import React, { useEffect, useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { View, useColorScheme, Text, StyleSheet, Platform, ScrollView, TouchableOpacity, Dimensions } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import HotBannerSlider from "../HotBannerSlider";
import QuickMenuGrid from "../QuickMenuGrid";
import WebQuickMenu from "../WebQuickMenu";
import { subscribe as subscribeFavorites, hydrateFavorites as hydrateFavs } from "../../services/favorites";
import { fetchNoticesCleaned } from "../../api/eventsFirestore";
import EventsList from "../EventsList";
import EventCard from "../EventCard";

const isWeb = Platform.OS === "web";

export default function Home() {
  const colorScheme = useColorScheme();
  const placeholder = colorScheme === "dark" ? "#2B2F33" : "#E4EAEE";
  const textColor = colorScheme === "dark" ? "#fff" : "#111";
  const router = useRouter();
  const [news, setNews] = useState<any[]>([]);
  const [newsLimit] = useState<number>(200);
  const [favTick, setFavTick] = useState<number>(0);
  const [screenWidth, setScreenWidth] = useState(Dimensions.get("window").width);

  // 화면 크기 변경 감지
  useEffect(() => {
    const subscription = Dimensions.addEventListener("change", ({ window }) => {
      setScreenWidth(window.width);
    });
    return () => subscription?.remove();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const notices = await fetchNoticesCleaned(newsLimit);
        const noticeAsEvents = (notices || []).map((n: any) => {
          const firstImage = Array.isArray(n.image_urls) && n.image_urls.length > 0 ? n.image_urls[0] : null;
          return {
            id: `notice-${n.id}`,
            title: n.title,
            summary: n.content ? String(n.content).slice(0, 200) : null,
            startAt: deriveIsoDate(n.date || n.crawled_at),
            endAt: null,
            location: null,
            tags: Array.isArray(n.tags) ? n.tags : [],
            org: { id: "notice", name: n.author || "공지", logoUrl: null },
            sourceUrl: n.url || null,
            posterImageUrl: firstImage,
            ai: null,
          };
        });
        setNews(noticeAsEvents);
      } catch (e) {
        console.warn("[UI] fetchNotices error", e);
      }
    })();
  }, [newsLimit]);

  // 즐겨찾기 변경 구독: 재조회 없이 카드 상태만 리렌더
  useEffect(() => {
    const unsub = subscribeFavorites(() => setFavTick((v) => v + 1));
    // 화면 마운트 시 Firestore에서 즐겨찾기 상태 로드
    (async () => {
      try {
        await hydrateFavs();
      } catch {}
    })();
    return () => unsub();
  }, []);

  function deriveIsoDate(input?: string | null): string {
    if (!input || typeof input !== "string") return new Date().toISOString();
    const s = input.trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return new Date(s).toISOString();
    const m = s.match(/(\d{4})\D(\d{1,2})\D(\d{1,2})/);
    if (m) {
      const y = Number(m[1]);
      const mo = Number(m[2]);
      const d = Number(m[3]);
      const dt = new Date(Date.UTC(y, Math.max(0, mo - 1), d, 0, 0, 0));
      return dt.toISOString();
    }
    const parsed = new Date(s);
    if (!isNaN(parsed.getTime())) return parsed.toISOString();
    return new Date().toISOString();
  }

  // 전체화면일 때는 패딩 0, 작은 화면일 때는 패딩 추가
  const headerPadding = isWeb && screenWidth >= 1400 ? 0 : (isWeb ? 24 : 8);

  const topHeaderComponent = (
    <View style={{ alignSelf: "stretch", marginHorizontal: -16, paddingTop: 16, backgroundColor: colorScheme === "dark" ? "#1E293B" : "#F5F5F5" }}>
      <View style={[styles.headerWrapper, { paddingHorizontal: headerPadding }]}>
        <HotBannerSlider />
        {!isWeb && (
          <View style={{ paddingHorizontal: 0, marginBottom: 16 }}>
            <QuickMenuGrid 
              selectedFilter={null}
              onFilterSelect={(filter) => {
                if (filter) {
                  router.push(`/events?tag=${filter}`);
                }
              }}
            />
          </View>
        )}
        {isWeb && (
          <View style={{ marginTop: 24, marginBottom: 8 }}>
            <WebQuickMenu />
          </View>
        )}
      </View>
    </View>
  );

  const newsSectionHeader = (
    <View style={styles.newsSectionContainer}>
      <View style={styles.feedHeader}>
        <View style={styles.feedTitleRow}>
          <Text style={[styles.feedTitle, { color: textColor }]}>
            최근 소식
          </Text>
          <TouchableOpacity 
            onPress={() => router.push("/events")}
            style={styles.moreButton}
            activeOpacity={0.7}
          >
            <Text style={[styles.moreButtonText, { color: textColor }]}>
              더 보기
            </Text>
            <Ionicons name="chevron-forward" size={16} color={textColor} />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );

  if (isWeb) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colorScheme === "dark" ? "#0F172A" : "#F9FAFB" }} edges={["left", "right", "bottom"]}>
        <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
          {topHeaderComponent}
          <View style={styles.contentWrapper}>
            <View style={styles.mainContent}>
              <View style={[styles.feedContainer, { backgroundColor: colorScheme === "dark" ? "#1E293B" : "#FFFFFF", borderRadius: 12, padding: 16 }]}>
                {newsSectionHeader}
                {news.length === 0 ? (
                  <View style={[styles.emptyState, { backgroundColor: placeholder }]}>
                    <Text style={{ color: "#888" }}>최근 소식이 없습니다.</Text>
                  </View>
                ) : (
                  news.map((item) => (
                    <EventCard 
                      key={item.id}
                      event={item} 
                      onPress={() => {
                        // TODO: 상세 라우팅 연결
                      }}
                    />
                  ))
                )}
              </View>
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colorScheme === "dark" ? "#0F172A" : "#F5F5F5" }} edges={["left", "right"]}>
      <View style={{ flex: 1, backgroundColor: colorScheme === "dark" ? "#1E293B" : "#FFFFFF" }}>
        <EventsList
          events={news}
          placeholderColor={placeholder}
          extraData={favTick}
        ListHeaderComponent={
          <View style={{ width: "100%" }}>
            {topHeaderComponent}
            {newsSectionHeader}
          </View>
        }
          ListFooterComponent={null}
          style={{ backgroundColor: "transparent" }}
          onPressItem={(ev: any) => {
            // TODO: 상세 라우팅 연결
          }}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  headerWrapper: {
    maxWidth: 1400,
    alignSelf: "center",
    width: "100%",
  },
  newsSectionContainer: {
    backgroundColor: "transparent",
  },
  feedHeader: {
    paddingTop: 16,
    paddingBottom: 12,
    paddingHorizontal: 16,
  },
  feedTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
  },
  feedTitle: {
    fontSize: 22,
    fontWeight: "800",
    marginRight: 8,
  },
  moreButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  moreButtonText: {
    fontSize: 14,
    fontWeight: "600",
  },
  contentWrapper: {
    width: "100%",
    paddingHorizontal: 24,
  },
  mainContent: {
    flexDirection: "row",
    alignItems: "flex-start",
    maxWidth: 1400,
    alignSelf: "center",
    width: "100%",
    paddingTop: 8,
    paddingBottom: 24,
  },
  feedContainer: {
    flex: 1,
    minWidth: 0,
  },
  emptyState: {
    height: 120,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginVertical: 8,
  },
});


