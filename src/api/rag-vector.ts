/**
 * 벡터 검색은 아직 콘텐츠 API에 연결하지 않습니다.
 * Firestore에 저장된 예전 임베딩은 조회하지 않습니다.
 */

export type RetrievedDocument = {
  id: string;
  title: string;
  content: string;
  source: "notice" | "event";
  url?: string | null;
  date?: string | null;
  similarity?: number;
};

export async function retrieveRelevantDocumentsVector(
  _queryText: string,
  _maxResults: number = 5
): Promise<RetrievedDocument[]> {
  return [];
}

export async function retrieveRelevantDocumentsHybrid(
  _queryText: string,
  _maxResults: number = 5,
  _vectorWeight: number = 0.7
): Promise<RetrievedDocument[]> {
  return [];
}
