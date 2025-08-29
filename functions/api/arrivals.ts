// functions/api/arrivals.ts （Cloudflare Pages Functions）
// ─────────────────────────────
// これは Cloudflare Pages の "Functions" 機能で動くバックエンドAPIです。
// index.html から「/api/arrivals?stop_ids=...」と呼ばれると、
// 神奈中の公式バス接近ページを取得して、到着情報だけをJSONに整形して返します。
//
// 初心者向けに：
// 1. GitHub にこのファイルを /functions/api/arrivals.ts として置く
// 2. Cloudflare Pages でリポジトリを指定してデプロイ（Framework: None, ビルドなし）
// 3. index.html の fetch('/api/arrivals?...') が自動でこのコードに届きます
//
// 注意：神奈中公式サイトの構造が変わると抽出が壊れる可能性があります。
// アクセスは20秒に1回程度にして、教育目的での利用にとどめてください。

// 停留所IDとfNOの対応表（町田駅方面）
const STOP_FNO = {
  machiko_kougyoumae_toward_machida: 22264, // 町田工業高校前
  kamijuku_toward_machida: 22011,          // 上宿
  tadao_park_toward_machida: 22041,        // 忠生公園前
  ja_tadao_branch_toward_machida: 22280,   // JA忠生支店前
};

export const onRequestGet = async ({ request }) => {
  const url = new URL(request.url);
  // クエリ ?stop_ids=... を分解
  const ids = (url.searchParams.get('stop_ids') || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const out = {};

  // 各停留所ごとにページを取得
  for (const id of ids) {
    const fno = STOP_FNO[id];
    if (!fno) continue;
    try {
      const res = await fetch(`http://real.kanachu.jp/sp/DisplayApproachFrom?fNO=${fno}&pNO=2`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; machida-bus/1.0)' },
      });
      const html = await res.text();

      // HTMLから <li>…</li> を抜き出してテキストに変換
      const rows = [];
      const liMatches = html.match(/<li[^>]*>(.*?)<\\/li>/g) || [];
      for (const li of liMatches) {
        const text = li.replace(/<[^>]+>/g, '').replace(/\\s+/g, ' ').trim();
        if (!text) continue;
        const mMin = text.match(/(約\\s*)?(\\d{1,2})\\s*分/);
        const mNow = text.match(/到着|発車|まもなく/);
        if (mMin || mNow) {
          const mRoute = text.match(/[町相川横湘藤他]*\\d{1,3}/);
          rows.push({
            route: mRoute ? mRoute[0] : '-',
            headsign: text.slice(0, 40),
            minutes: mMin ? Number(mMin[2]) : '到着',
          });
        }
      }
      out[id] = rows.slice(0, 4); // 最大4件まで返す
    } catch (e) {
      out[id] = [];
    }
    // サイトへの負荷を減らすため200ms待機
    await new Promise((r) => setTimeout(r, 200));
  }

  // JSONとして返す
  return new Response(JSON.stringify(out), {
    headers: { 'Content-Type': 'application/json' },
  });
};
