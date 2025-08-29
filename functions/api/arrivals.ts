// functions/api/arrivals.ts（高精度パーサ版 + 軽量キャッシュ）
// ─────────────────────────────
// 目的：神奈中バスロケ（スマホ版）の「接近情報」を取得し、
//      町田工科高校周辺4停留所（町田方面）の到着情報をJSON化して返す。
// 注意：公式サイトのHTMLが変わると壊れる可能性があります。教育目的/低頻度で利用してください。
//      ここでは 15 秒のエッジキャッシュを使い、アクセス負荷を抑えます。

// 停留所ID → fNO（町田方面）
const STOP_FNO: Record<string, number> = {
  machiko_kougyoumae_toward_machida: 22264, // 町田工業高校前
  kamijuku_toward_machida: 22011,          // 上宿
  tadao_park_toward_machida: 22041,        // 忠生公園前
  ja_tadao_branch_toward_machida: 22280,   // JA忠生支店前
};

type ArrivalRow = {
  route: string;    // 系統（例：町32）
  headsign: string; // 行先（例：町田バスセンター）
  minutes: number;  // 0=到着/まもなく/発車、1..=約x分
  raw?: string;     // デバッグ用
};

// HTML → ArrivalRow[] に変換
function parseApproachHTML(html: string): ArrivalRow[] {
  // <li>…</li> を全取得（改行/入れ子を考慮して [\s\S] を使用）
  const lis =
    html.match(/<li[\s\S]*?<\/li>/g) // ← 旧版の `/<li[^>]*>(.*?)<\/li>/g` より堅牢
    || [];

  const rows: ArrivalRow[] = [];

  for (const li of lis) {
    // タグ除去 → 1行化
    const text = li
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;|&amp;|&lt;|&gt;|&quot;|&#39;/g, (m) =>
        ({
          "&nbsp;": " ",
          "&amp;": "&",
          "&lt;": "<",
          "&gt;": ">",
          "&quot;": '"',
          "&#39;": "'",
        }[m] as string)
      )
      .replace(/\s+/g, " ")
      .trim();

    // 接近っぽい行だけ通す
    const hasApproach = /(約\s*\d{1,2}\s*分|到着|発車|まもなく)/.test(text);
    if (!hasApproach) continue;

    // 系統番号（漢字/英字が付くことがあるので少し緩め）
    const mRoute = text.match(/([\u4e00-\u9fafA-Za-z]{0,2}\d{1,3})/);
    const route = mRoute ? mRoute[1] : "-";

    // 行先はキーワード直前までをざっくり抽出 → 余分を整理
    const kwIndex = text.search(/(約\s*\d{1,2}\s*分|到着|発車|まもなく)/);
    const headRaw = kwIndex > 0 ? text.slice(0, kwIndex) : text;
    const headsign =
      headRaw
        .replace(route, "")
        .replace(/[\(（].*?[\)）]/g, " ") // カッコ中は除去
        .replace(/行|方面/g, " ")
        .replace(/\s+/g, " ")
        .trim() || "-";

    // 分数（到着/発車/まもなく は 0分扱い）
    let minutes = 0;
    const mMin = text.match(/約\s*(\d{1,2})\s*分/);
    if (mMin) minutes = parseInt(mMin[1], 10);

    rows.push({ route, headsign, minutes, raw: text });
  }

  // 重複除去 + 近い順に整列
  const uniq = new Map<string, ArrivalRow>();
  for (const r of rows) {
    const key = `${r.route}|${r.headsign}|${r.minutes}`;
    if (!uniq.has(key)) uniq.set(key, r);
  }
  return Array.from(uniq.values())
    .sort((a, b) => a.minutes - b.minutes)
    .slice(0, 6);
}

export const onRequestGet: PagesFunction = async ({ request, waitUntil }) => {
  const url = new URL(request.url);
  const ids = (url.searchParams.get("stop_ids") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  // 15秒キャッシュ（エッジ）
  const cache = caches.default;
  const cacheKey = new Request(request.url, request);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const out: Record<string, ArrivalRow[] | { error: string }> = {};

  for (const id of ids) {
    const fno = STOP_FNO[id];
    if (!fno) {
      out[id] = { error: "unknown_stop_id" };
      continue;
    }
    try {
      // 混在コンテンツ回避のため https を使用
      const res = await fetch(
        `https://real.kanachu.jp/sp/DisplayApproachFrom?fNO=${fno}&pNO=2`,
        { headers: { "User-Agent": "Mozilla/5.0 machida-bus/1.0 (+edu)" } }
      );
      const html = await res.text();
      out[id] = parseApproachHTML(html);
      // 軽いマナーウェイト（過負荷防止）
      await new Promise((r) => setTimeout(r, 150));
    } catch {
      out[id] = { error: "fetch_failed" };
    }
  }

  const resp = new Response(JSON.stringify(out), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "max-age=15",
    },
  });

  // キャッシュして返す
  waitUntil(cache.put(cacheKey, resp.clone()));
  return resp;
};
