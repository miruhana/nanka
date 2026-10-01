// 天気の取得と整形。ブラウザ(app.js)と GitHub Actions(scripts/update-weather.js)の両方から使う。
// 外部に送るのは「地名」(国土地理院の住所検索)と、その座標(Open-Meteo)だけ。

const WMO = {
  0: '快晴', 1: '晴れ', 2: '晴れ時々くもり', 3: 'くもり',
  45: '霧', 48: '霧',
  51: '弱い霧雨', 53: '霧雨', 55: '強い霧雨', 56: '着氷性の霧雨', 57: '着氷性の霧雨',
  61: '小雨', 63: '雨', 65: '強い雨', 66: '着氷性の雨', 67: '着氷性の雨',
  71: '小雪', 73: '雪', 75: '大雪', 77: '雪',
  80: 'にわか雨', 81: 'にわか雨', 82: '激しいにわか雨',
  85: 'にわか雪', 86: '強いにわか雪',
  95: '雷雨', 96: '雷雨(ひょう)', 99: '激しい雷雨'
};
export function wmoText(code) { return WMO[code] || 'くもり' }

const r1 = (v) => Math.round(v * 10) / 10;
const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null);

/** 地名 → 座標。見つからなければ null。 */
export async function geocode(name, signal) {
  const url = 'https://msearch.gsi.go.jp/address-search/AddressSearch?q=' + encodeURIComponent(name);
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error('geocode ' + res.status);
  const list = await res.json();
  if (!Array.isArray(list) || !list.length) return null;
  const [lon, lat] = list[0].geometry.coordinates;
  return { lat: Math.round(lat * 1e4) / 1e4, lon: Math.round(lon * 1e4) / 1e4, title: list[0].properties.title };
}

// その日の気圧変化: 前日の最後の値から当日23時までで、いちばん大きく下がった幅(下がっていなければ上昇幅)。
function pressureOf(times, pres, date) {
  const idx = [];
  times.forEach((t, i) => { if (t.startsWith(date)) idx.push(i) });
  if (!idx.length) return { pressure: null, change: null };
  const series = [];
  if (idx[0] > 0) series.push(pres[idx[0] - 1]);
  idx.forEach((i) => series.push(pres[i]));
  const vals = series.filter((v) => num(v) != null);
  if (vals.length < 2) return { pressure: null, change: null };
  let peak = vals[0], drop = 0;
  vals.forEach((v) => { peak = Math.max(peak, v); drop = Math.min(drop, v - peak) });
  const dayVals = idx.map((i) => pres[i]).filter((v) => num(v) != null);
  const mean = dayVals.reduce((a, b) => a + b, 0) / dayVals.length;
  const change = drop < -0.5 ? drop : vals[vals.length - 1] - vals[0];
  return { pressure: Math.round(mean), change: r1(change) };
}

/** 座標 → 今日・明日の天気。 */
export async function fetchForecast(lat, lon, signal) {
  const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lon +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min,relative_humidity_2m_mean,precipitation_probability_max' +
    '&hourly=pressure_msl&past_days=1&forecast_days=2&timezone=Asia%2FTokyo';
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error('forecast ' + res.status);
  const j = await res.json();
  const d = j.daily, h = j.hourly;
  // daily[0]=昨日, [1]=今日, [2]=明日
  const day = (i) => {
    const p = pressureOf(h.time, h.pressure_msl, d.time[i]);
    return {
      date: d.time[i],
      condition: wmoText(d.weather_code[i]),
      tempMax: num(d.temperature_2m_max[i]) == null ? null : Math.round(d.temperature_2m_max[i]),
      tempMin: num(d.temperature_2m_min[i]) == null ? null : Math.round(d.temperature_2m_min[i]),
      humidity: num(d.relative_humidity_2m_mean[i]) == null ? null : Math.round(d.relative_humidity_2m_mean[i]),
      rainChance: num(d.precipitation_probability_max[i]),
      pressure: p.pressure,
      pressureChangeHpa: p.change
    };
  };
  const yesterday = day(0), today = day(1), tomorrow = day(2);
  const diff = num(today.tempMax) != null && num(yesterday.tempMax) != null ? today.tempMax - yesterday.tempMax : null;
  return { today, tomorrow, tempDiffFromYesterday: diff };
}

/** 登録地域(座標つき)をまとめて取得。1か所失敗しても他は返す。 */
export async function fetchRegions(regions, signal) {
  const out = [];
  for (const r of regions) {
    if (num(r.lat) == null || num(r.lon) == null) continue;
    try {
      const wx = await fetchForecast(r.lat, r.lon, signal);
      out.push(Object.assign({ name: r.name }, wx));
    } catch (e) {
      if (e && e.name === 'AbortError') throw e;
    }
  }
  return { updatedAt: new Date().toISOString(), regions: out };
}
