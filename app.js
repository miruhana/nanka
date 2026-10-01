// なんか。 — 個人用の肌管理アプリ
// 記録はこの端末のブラウザ(localStorage)だけに保存する。サーバーには何も送らない。
// 外部に送るのは、天気用の地名・座標と、アドバイスを頼むときの写真・記録(利用者自身の Claude API キーで送る)だけ。
import { geocode, fetchRegions } from './weather-core.js';

/* ---------- small helpers ---------- */
const $ = (s, r) => (r || document).querySelector(s);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const dkey = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const todayKey = () => dkey(new Date());
function parseKey(k) { const p = k.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]) }
function addDays(k, n) { const d = parseKey(k); d.setDate(d.getDate() + n); return dkey(d) }
const WD = ['日', '月', '火', '水', '木', '金', '土'];
function mdw(k) { const d = parseKey(k); return (d.getMonth() + 1) + '/' + d.getDate() + '(' + WD[d.getDay()] + ')' }
function fmtMin(m) { return Math.floor(m / 60) + '時間' + (m % 60 ? pad(m % 60) + '分' : '') }
const nn = (v) => typeof v === 'number' && isFinite(v);
function setPath(o, path, v) { const p = path.split('.'); let c = o; for (let i = 0; i < p.length - 1; i++) { if (c[p[i]] == null) c[p[i]] = {}; c = c[p[i]] } c[p[p.length - 1]] = v }
const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));
function numOrNull(v) { if (v === '' || v == null) return null; const n = Number(v); return isFinite(n) ? n : null }
function lsGet(k) { try { return localStorage.getItem(k) } catch (e) { return null } }
function lsSet(k, v) { try { localStorage.setItem(k, v); return true } catch (e) { return false } }
function lsDel(k) { try { localStorage.removeItem(k) } catch (e) { } }

const ICON = {
  home: '<path d="M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1z"/>',
  med: '<rect x="2.5" y="8" width="19" height="8" rx="4" transform="rotate(-40 12 12)"/><path d="M9.2 9.4l5.4 5.2"/>',
  sleep: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  skin: '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 14c1 1.5 2.2 2.2 3.5 2.2s2.5-.7 3.5-2.2"/><path d="M9 10h.01M15 10h.01"/>',
  head: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>'
};
const TABS = [['home', 'ホーム'], ['med', '服薬'], ['sleep', '睡眠'], ['skin', '肌'], ['head', '頭痛・天気']];
const TIMINGS = ['朝', '昼', '夜', '就寝前'];
const SKIN_CHIPS = ['乾燥', '赤み', 'テカリ', 'ニキビ', 'くすみ', '調子いい'];
const MOODS = ['すっきり', 'ふつう', 'だるい', '頭が重い'];
const SLEEP_TAGS = ['スマホ', 'カフェイン', 'お酒', '入浴', '運動'];
const HL_TIMES = ['朝', '昼', '夕方', '夜', '夜中'];
const WX_CONDS = ['晴れ', 'くもり', '雨', '強い雨', '雪', '雷雨'];
const DEF_TH = { pressureDrop: 3, tempDiff: 5 };
const DEFAULT_REGIONS = [
  { name: '東京都荒川区南千住', lat: 35.7335, lon: 139.7911 },
  { name: '千葉県浦安市舞浜', lat: 35.6321, lon: 139.8816 },
  { name: '新潟県加茂市', lat: 37.6664, lon: 139.0403 }
];
// 毎朝 GitHub Actions が更新する天気(初期の地域ぶん)。端末から直接取れないときの予備。
const MORNING_WEATHER_URLS = ['./weather.json', 'https://raw.githubusercontent.com/miruhana/nanka/main/weather.json'];
const STORE_KEY = 'nanka-v1', KEY_KEY = 'nanka-apikey';
const MODEL = 'claude-opus-5-5';
const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.131.0/+esm';

/* ---------- state ---------- */
let data = null;          // 保存する記録すべて
let persistent = true;    // localStorage が使えるか
const ui = { tab: lsGet('nk-tab') || 'home', region: lsGet('nk-region'), draft: {}, open: {}, photo: null, photoUrl: null, adv: null, ctl: null, confirm: null, pending: false, wxBusy: false, wxFailed: false, apiKey: lsGet(KEY_KEY) || '' };

function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => { t.hidden = true }, 3400) }

/* ---------- storage ---------- */
function emptyData() { return { v: 1, meds: {}, days: {}, prefs: { regions: clone(DEFAULT_REGIONS), thresholds: clone(DEF_TH) }, weather: { regions: {}, manual: {} } } }
function load() {
  try {
    localStorage.setItem('nk-probe', '1'); localStorage.removeItem('nk-probe');
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return normalize(JSON.parse(raw));
  } catch (e) { persistent = false }
  const d = emptyData(); seedSamples(d); return d;
}
function normalize(d) {
  const e = emptyData();
  d = Object.assign(e, d || {});
  d.meds = d.meds || {}; d.days = d.days || {};
  d.prefs = Object.assign({ regions: [], thresholds: clone(DEF_TH) }, d.prefs || {});
  d.weather = Object.assign({ regions: {}, manual: {} }, d.weather || {});
  return d;
}
function save() {
  if (!persistent) return;
  try { localStorage.setItem(STORE_KEY, JSON.stringify(data)) }
  catch (e) { toast(e && e.name === 'QuotaExceededError' ? '保存の上限に達しました。古い記録を削除してください。' : '保存できませんでした。ブラウザの設定(プライベートモードなど)を確認してください。') }
}
function commit() { save(); render() }

function updateDay(date, mut) { const cur = clone(data.days[date]) || {}; mut(cur); cur.date = date; data.days[date] = cur; commit() }
function saveMed(m) { data.meds[m.id] = m; commit() }
function removeMed(id) { delete data.meds[id]; commit() }
function updatePrefs(mut) { mut(data.prefs); commit() }

function prefs() { const p = data.prefs || {}; return { regions: p.regions || [], thresholds: Object.assign({}, DEF_TH, p.thresholds || {}) } }
function medList() { return Object.values(data.meds).sort((a, b) => TIMINGS.indexOf(a.timing) - TIMINGS.indexOf(b.timing) || String(a.name).localeCompare(String(b.name), 'ja')) }
const dayOf = (k) => data.days[k] || {};

/* ---------- derived values ---------- */
function sleepMin(bed, wake) {
  if (!bed || !wake) return null; const b = bed.split(':').map(Number), w = wake.split(':').map(Number);
  return ((w[0] * 60 + w[1]) - (b[0] * 60 + b[1]) + 1440) % 1440;
}
function takenCount(k) { const t = dayOf(k).taken || []; return t.filter((i) => data.meds[i]).length }
function adherence(k) { const n = Object.keys(data.meds).length; return n ? takenCount(k) / n : null }
function streak() {
  const n = Object.keys(data.meds).length; if (!n) return 0;
  const full = (k) => takenCount(k) >= n; let k = todayKey(); if (!full(k)) k = addDays(k, -1); let c = 0;
  while (full(k) && c < 400) { c++; k = addDays(k, -1) } return c;
}
function hasSamples() { return Object.values(data.meds).some((m) => m.sample) || Object.values(data.days).some((d) => d.sample) }
function lastSleep() { const ks = Object.keys(data.days).filter((k) => data.days[k].sleep).sort(); return ks.length ? data.days[ks[ks.length - 1]].sleep : null }

/* ---------- weather ---------- */
function curRegionName() {
  const rs = prefs().regions; if (!rs.length) return null;
  if (ui.region && rs.some((r) => r.name === ui.region)) return ui.region; return rs[0].name;
}
// 今朝6時(6時前なら前日の6時)。これより古い天気は自動で取り直す。
function morningCutoff() { const d = new Date(); d.setHours(6, 0, 0, 0); if (Date.now() < d.getTime()) d.setDate(d.getDate() - 1); return d.getTime() }
function wxNeedsUpdate() {
  const cut = morningCutoff();
  return prefs().regions.some((r) => { const e = data.weather.regions[r.name]; return !e || !(Date.parse(e.fetchedAt) >= cut) });
}
function wxView(name) {
  const tk = todayKey(), e = data.weather.regions[name], man = data.weather.manual[name];
  let today = null, tomorrow = null, tempDiff = null;
  if (e) {
    if (e.today && e.today.date === tk) { today = e.today; tomorrow = e.tomorrow; tempDiff = e.tempDiffFromYesterday }
    else if (e.tomorrow && e.tomorrow.date === tk) { today = e.tomorrow; tempDiff = nn(e.tomorrow.tempMax) && nn(e.today && e.today.tempMax) ? e.tomorrow.tempMax - e.today.tempMax : null }
  }
  let manual = false;
  if (man && man.date === tk) {
    const v = {}; Object.keys(man.values).forEach((k) => { if (man.values[k] != null && man.values[k] !== '') v[k] = man.values[k] });
    today = Object.assign({ date: tk }, today || {}, v); if (nn(v.tempDiff)) tempDiff = v.tempDiff; manual = true;
  }
  const fetchedAt = e ? Date.parse(e.fetchedAt) : NaN;
  const stale = !e || !(fetchedAt >= Date.now() - 30 * 3600e3) || !(e.today && e.today.date === tk);
  return { name, today, tomorrow, tempDiff, fetchedAt, stale, manual };
}
function fmtUpdated(t) { if (!nn(t)) return ''; const d = new Date(t); return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ' 更新' }
function storeWeather(res, source) {
  const names = prefs().regions.map((r) => r.name);
  res.regions.forEach((r) => {
    if (names.indexOf(r.name) < 0) return;
    const cur = data.weather.regions[r.name];
    if (cur && Date.parse(cur.fetchedAt) >= Date.parse(res.updatedAt)) return;
    data.weather.regions[r.name] = Object.assign({}, r, { fetchedAt: res.updatedAt, source });
  });
}
async function refreshWeather(manual) {
  if (ui.wxBusy) return; const regs = prefs().regions; if (!regs.length) return;
  ui.wxBusy = true; scheduleRender();
  let ok = false;
  try {
    const res = await fetchRegions(regs);
    if (res.regions.length) { storeWeather(res, 'live'); ok = res.regions.length === regs.filter((r) => nn(r.lat)).length }
  } catch (e) { }
  if (!ok) {
    for (const u of MORNING_WEATHER_URLS) {
      try { const r = await fetch(u, { cache: 'no-store' }); if (r.ok) { storeWeather(await r.json(), 'morning'); break } } catch (e) { }
    }
  }
  ui.wxBusy = false; ui.wxFailed = !ok && wxNeedsUpdate(); save();
  if (manual) toast(ok ? '天気を更新しました' : '天気を取得できませんでした。前回の情報を表示しています');
  scheduleRender();
}

function risk(which, v) {
  const w = which === 'today' ? v.today : v.tomorrow; if (!w) return null;
  const th = prefs().thresholds; let score = 0; const why = []; let noPressure = false;
  const pc = w.pressureChangeHpa;
  if (nn(pc)) {
    if (pc <= -th.pressureDrop * 2) { score += 2; why.push('気圧が大きく下がる見込み(' + pc + ' hPa)') }
    else if (pc <= -th.pressureDrop) { score += 1; why.push('気圧が下がる見込み(' + pc + ' hPa)') }
  } else {
    noPressure = true;
    if (/雨|雷|雪|台風|低気圧/.test(w.condition || '')) { score += 1; why.push('天気が崩れる見込み(低気圧が近づくかも)') }
  }
  const td = which === 'today' ? v.tempDiff : (nn(w.tempMax) && nn(v.today && v.today.tempMax) ? w.tempMax - v.today.tempMax : null);
  if (nn(td)) {
    const a = Math.abs(td), s = (td > 0 ? '+' : '') + td;
    if (a >= th.tempDiff + 2) { score += 2; why.push('寒暖差が大きい(前日比 ' + s + '℃)') }
    else if (a >= th.tempDiff) { score += 1; why.push('寒暖差がある(前日比 ' + s + '℃)') }
  }
  if (nn(w.humidity) && w.humidity >= 80 && /雨|雷/.test(w.condition || '')) { score += 1; why.push('湿度が高い雨の日(' + w.humidity + '%)') }
  if (which === 'today') {
    const s = dayOf(todayKey()).sleep;
    if (s && nn(s.min)) { if (s.min < 360) { score += 1; why.push('睡眠が6時間未満') } else if (s.min > 540) { score += 1; why.push('睡眠が9時間より長い') } }
    if (s && s.tags && (s.tags.indexOf('お酒') >= 0 || s.tags.indexOf('カフェイン') >= 0)) { score += 1; why.push('前夜のお酒・カフェイン') }
  }
  const k = score >= 4 ? 'alert' : score >= 2 ? 'warn' : 'ok';
  return { k, label: k === 'alert' ? '警戒' : k === 'warn' ? '注意' : '通常', score, why, noPressure };
}
const TIPS = {
  ok: 'いつも通りで大丈夫そう。水分だけこまめにとりましょう。',
  warn: '早めに寝て、水分と食事をしっかりとりましょう。予定に少し余裕をもたせて。',
  alert: '無理をしない日に。早めに休み、予定は軽めに。処方された頭痛薬は手元に置いておきましょう。'
};
const lvBadge = (r) => '<span class="lv lv-' + r.k + '"><i></i>' + r.label + '</span>';
function wxLine(w) {
  if (!w) return ''; const a = [];
  if (w.condition) a.push(w.condition);
  if (nn(w.tempMax)) a.push(w.tempMax + '°' + (nn(w.tempMin) ? ' / ' + w.tempMin + '°' : ''));
  if (nn(w.humidity)) a.push('湿度' + w.humidity + '%');
  if (nn(w.pressure)) a.push('気圧' + w.pressure + 'hPa');
  if (nn(w.pressureChangeHpa)) a.push('気圧変化' + (w.pressureChangeHpa > 0 ? '+' : '') + w.pressureChangeHpa);
  return a.join('・');
}
function wxStatus(v) {
  if (ui.wxBusy) return '<span class="tag">更新中…</span>';
  return esc(fmtUpdated(v.fetchedAt)) + (v.stale ? ' <span class="tag stale">古い情報</span>' : '') + (v.manual ? ' <span class="tag">手入力あり</span>' : '');
}

/* ---------- views ---------- */
function viewHome() {
  let h = ''; const td = todayKey(), d = dayOf(td); const name = curRegionName();
  if (!persistent) h += '<div class="notice"><b>この画面では保存できません。</b> いまの記録は、画面を閉じると消えます。プライベートモードをやめると保存できます。</div>';
  if (hasSamples()) h += '<div class="notice"><b>サンプル表示中です。</b> 「サンプル」の印がついた記録は使い方の例です。<div style="margin-top:6px"><button class="btn small ghost" data-act="clearSamples">サンプルをすべて消す</button></div></div>';
  h += '<div class="card lift stack"><div class="hd"><h2>頭痛への注意度</h2><span class="sub">目安です</span></div>';
  const rs = prefs().regions;
  if (!rs.length) h += '<div class="empty">天気を見る地域がまだありません。<br><button class="btn small soft" data-act="tab" data-v="head">地域を追加する</button></div>';
  else {
    if (rs.length > 1) h += '<div class="pills">' + rs.map((r) => '<button class="chip" data-act="region" data-v="' + esc(r.name) + '" aria-pressed="' + (r.name === name) + '">' + esc(r.name.replace(/^(東京都|北海道|(京都|大阪)府|.{2,3}県)/, '')) + '</button>').join('') + '</div>';
    else h += '<div class="sub">' + esc(name) + '</div>';
    const v = wxView(name), rt = risk('today', v), rm = risk('tomorrow', v);
    if (!rt && !rm) {
      h += '<div class="empty">' + (ui.wxBusy ? '天気を読み込んでいます…' : 'この地域の天気をまだ取得できていません。<br>電波のよい場所で開き直すか、「頭痛・天気」で手入力できます。') + '</div>';
    } else {
      h += '<div class="outlook">' + [['今日', rt], ['明日', rm]].map(([when, r]) => {
        if (!r) return '<div><span class="when">' + when + '</span><span class="sub">情報なし</span></div>';
        return '<div><span class="when">' + when + '</span>' + lvBadge(r) + (r.why.length ? '<ul class="reasons">' + r.why.slice(0, 3).map((w) => '<li>' + esc(w) + '</li>').join('') + '</ul>' : '<span class="sub">特に気になる点はありません</span>') + '</div>';
      }).join('') + '</div>';
      const worst = rm && (!rt || rm.score > rt.score) ? rm : rt;
      const hr = new Date().getHours();
      h += '<div class="tip">' + (worst === rm && rm.k !== 'ok' && (!rt || rt.k === 'ok') ? (hr >= 17 ? '明日に備えて、今夜は早めに休みましょう。' : '明日は注意の日。今日のうちに予定を軽めにしておくと安心です。') : TIPS[worst.k]) + '</div>';
      if (rt && rt.noPressure) h += '<div class="sub">気圧の数値がないため、天気と気温差から出しています。</div>';
      h += '<div class="sub">' + esc(wxLine(v.today)) + '<br>' + wxStatus(v) + '</div>';
    }
  }
  h += '</div>';
  const meds = Object.keys(data.meds).length, tk = takenCount(td), sl = d.sleep, sk = d.skin;
  const slOk = sl && nn(sl.min) ? (sl.min >= 360 && (sl.q || 0) >= 3) : null;
  h += '<div class="tiles">';
  h += '<div class="tile"><button data-act="tab" data-v="med"><span class="lbl">服薬</span><span class="big num">' + tk + '<span class="sub"> / ' + meds + '</span></span>' +
    '<div class="bar"><span style="width:' + (meds ? Math.round(tk / meds * 100) : 0) + '%"></span></div>' +
    (meds ? (tk >= meds ? '<span class="tag good" style="align-self:flex-start;margin-top:6px">ぜんぶ飲めた</span>' : '<span class="sub" style="margin-top:4px">あと ' + (meds - tk) + ' つ</span>') : '') + '</button></div>';
  h += '<div class="tile"><button data-act="tab" data-v="sleep"><span class="lbl">昨夜の睡眠</span>' + (sl && nn(sl.min) ? '<span class="big num">' + Math.floor(sl.min / 60) + '<span class="sub">時間</span>' + pad(sl.min % 60) + '<span class="sub">分</span></span><span class="sub">質 ' + '★'.repeat(sl.q || 0) + '☆'.repeat(5 - (sl.q || 0)) + '</span>' +
    '<span class="tag ' + (slOk ? 'good' : 'stale') + '" style="align-self:flex-start;margin-top:4px">' + (slOk ? 'よく眠れた' : '少し足りないかも') + '</span>' : '<span class="sub" style="padding-block:6px">まだ記録していません</span>') + '</button></div>';
  h += '<div class="tile wide"><button data-act="tab" data-v="skin"><span class="lbl">今日の肌のひとこと</span>' + (sk && sk.advice ? '<span style="font-size:15px">' + esc(sk.advice.observation || '') + '</span>' : '<span class="sub" style="padding-block:4px">写真と自己評価から、今日の過ごし方をもらいましょう</span>') + '</button></div>';
  h += '</div>';
  const hl = d.headache;
  if (hl && hl.had) h += '<div class="notice">今日は頭痛を記録しています(強さ ' + hl.level + ')。無理せず、休息を優先してください。</div>';
  h += viewDataCard();
  return h;
}

function viewDataCard() {
  return '<div class="card"><details' + (ui.open.data ? ' open' : '') + '><summary data-act="toggleOpen" data-v="data">データの管理</summary><div class="stack" style="margin-top:12px">' +
    '<p class="sub">記録はこの端末のブラウザの中だけに保存されます。ほかの人には見えず、サーバーにも送られません。機種変更やブラウザのデータ削除に備えて、ときどき書き出しておくと安心です。</p>' +
    '<div class="row wrap"><button class="btn small soft" data-act="export">記録を書き出す</button><button class="btn small ghost" data-act="import">書き出したファイルから戻す</button></div>' +
    (ui.confirm === 'all' ? '<button class="link danger" data-act="wipe">本当にすべて削除する</button>' : '<button class="link" data-act="askDel" data-v="all">すべての記録を削除</button>') +
    '<p class="sub">スマホへの通知は送れません。飲み忘れ防止には、端末のリマインダーとの併用がおすすめです。</p>' +
    '</div></details></div>';
}

function viewMed() {
  let h = ''; const td = todayKey(), meds = medList(), t = dayOf(td).taken || [];
  h += '<div class="card stack"><div class="hd"><h2>今日の服薬</h2><span class="sub">連続 <span class="num" style="font-size:16px;color:var(--accent)">' + streak() + '</span> 日</span></div>';
  if (!meds.length) h += '<div class="empty">サプリや薬を登録すると、ここにチェックリストが出ます。</div>';
  TIMINGS.forEach((tm) => {
    const g = meds.filter((m) => m.timing === tm); if (!g.length) return;
    h += '<div><div class="lbl" style="margin-bottom:2px">' + tm + '</div>' + g.map((m) => {
      const on = t.indexOf(m.id) >= 0;
      return '<div class="med"><button class="check" data-act="toggleMed" data-v="' + esc(m.id) + '" aria-pressed="' + on + '" aria-label="' + esc(m.name) + 'を飲んだ"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></button>' +
        '<div class="grow"><div><b>' + esc(m.name) + '</b> <span class="tag">' + esc(m.kind) + '</span>' + (on ? ' <span class="tag good">飲んだ</span>' : '') + (m.sample ? ' <span class="tag sample">サンプル</span>' : '') + '</div>' +
        '<div class="sub">' + esc(m.dose || '') + (m.effect ? (m.dose ? ' ・ ' : '') + '期待: ' + esc(m.effect) : '') + '</div></div>' +
        (ui.confirm === 'med:' + m.id ? '<button class="link danger" data-act="delMed" data-v="' + esc(m.id) + '">本当に削除</button>' : '<button class="link" data-act="askDel" data-v="med:' + esc(m.id) + '">削除</button>') + '</div>';
    }).join('') + '</div>';
  });
  const miss = meds.filter((m) => t.indexOf(m.id) < 0 && m.timing !== '就寝前');
  if (meds.length && miss.length && new Date().getHours() >= 19) h += '<div class="tip">まだのものが ' + miss.length + ' つあります(' + esc(miss.map((m) => m.name).join('、')) + ')。思い出したときで大丈夫です。</div>';
  const y = addDays(td, -1), yMiss = meds.filter((m) => (dayOf(y).taken || []).indexOf(m.id) < 0 && !m.sample);
  if (data.days[y] && yMiss.length) h += '<div class="sub">昨日はチェックが ' + yMiss.length + ' つ空いていました。今日もマイペースでいきましょう。</div>';
  h += '</div>';
  h += '<div class="card stack"><h3>今日の体感メモ</h3><div class="field"><textarea id="memo" data-d="memo" placeholder="例: 肌がしっとりした / 少しニキビが増えた">' + esc(ui.draft.memo != null ? ui.draft.memo : (dayOf(td).memo || '')) + '</textarea></div><button class="btn small" data-act="saveMemo">メモを保存</button></div>';
  h += '<div class="card stack"><h3>7日間の服薬と肌</h3>';
  const keys = [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(td, i - 6));
  const logged = keys.filter((k) => data.days[k]).length;
  if (logged < 7 || !meds.length) h += '<div class="empty">記録が7日分たまると、服薬と肌の変化を並べて見られます(いま ' + logged + ' 日分)。</div>';
  else h += '<div class="scroll"><table><thead><tr><th>日付</th><th>服薬</th><th>肌の自己評価</th><th>メモ</th></tr></thead><tbody>' + keys.slice().reverse().map((k) => {
    const a = adherence(k), sc = (dayOf(k).skin && dayOf(k).skin.chips) || [];
    return '<tr><td class="num">' + mdw(k) + '</td><td class="num">' + (a == null ? '-' : Math.round(a * 100) + '%') + '</td><td>' + (sc.length ? esc(sc.join('・')) : '<span class="sub">記録なし</span>') + '</td><td class="sub">' + esc(dayOf(k).memo || '') + '</td></tr>';
  }).join('') + '</tbody></table></div><div class="sub">並べて見るだけです。原因の判断はしません。薬の効果や飲み合わせは、医師・薬剤師に相談してください。</div>';
  h += '</div>';
  const m = ui.draft.med = ui.draft.med || { name: '', kind: 'サプリ', dose: '', timing: '朝', effect: '' };
  h += '<div class="card"><details' + (ui.open.addMed ? ' open' : '') + '><summary data-act="toggleOpen" data-v="addMed">サプリ・薬を登録する</summary><div class="stack" style="margin-top:12px">' +
    '<div class="field"><label for="mName">名前</label><input type="text" id="mName" data-d="med.name" value="' + esc(m.name) + '" placeholder="例: ビタミンC"></div>' +
    '<div class="two"><div class="field"><label for="mKind">種類</label><select id="mKind" data-d="med.kind">' + ['サプリ', '薬'].map((x) => '<option' + (m.kind === x ? ' selected' : '') + '>' + x + '</option>').join('') + '</select></div>' +
    '<div class="field"><label for="mTiming">飲むタイミング</label><select id="mTiming" data-d="med.timing">' + TIMINGS.map((x) => '<option' + (m.timing === x ? ' selected' : '') + '>' + x + '</option>').join('') + '</select></div></div>' +
    '<div class="field"><label for="mDose">量</label><input type="text" id="mDose" data-d="med.dose" value="' + esc(m.dose) + '" placeholder="例: 1錠"></div>' +
    '<div class="field"><label for="mEffect">期待する効果のメモ</label><input type="text" id="mEffect" data-d="med.effect" value="' + esc(m.effect) + '" placeholder="例: 肌のハリ"></div>' +
    '<button class="btn" data-act="addMed">登録する</button></div></details></div>';
  return h;
}

function viewSleep() {
  const td = todayKey(), s = dayOf(td).sleep, last = lastSleep();
  const dr = ui.draft.sleep = ui.draft.sleep || (s ? { bed: s.bed, wake: s.wake, q: s.q, mood: s.mood || '', tags: (s.tags || []).slice() } : { bed: last ? last.bed : '23:30', wake: last ? last.wake : '07:00', q: 3, mood: '', tags: [] });
  const min = sleepMin(dr.bed, dr.wake); let h = '';
  h += '<div class="card stack"><div class="hd"><h2>昨夜の睡眠</h2>' + (s ? '<span class="tag">記録済み</span>' : '') + '</div>' +
    '<div class="two"><div class="field"><label for="sBed">就寝</label><input type="time" id="sBed" data-d="sleep.bed" value="' + esc(dr.bed) + '"></div>' +
    '<div class="field"><label for="sWake">起床</label><input type="time" id="sWake" data-d="sleep.wake" value="' + esc(dr.wake) + '"></div></div>' +
    '<div class="num" style="font-size:28px" id="sDur">' + (min == null ? '-' : fmtMin(min)) + '</div>' +
    '<div class="field"><span class="lbl">眠りの質(1 いまいち 〜 5 ぐっすり)</span><div class="seg">' + [1, 2, 3, 4, 5].map((i) => '<button class="chip" data-act="sleepQ" data-v="' + i + '" aria-pressed="' + (dr.q === i) + '">' + i + '</button>').join('') + '</div></div>' +
    '<div class="field"><span class="lbl">起きたときの気分</span><div class="chips">' + MOODS.map((x) => '<button class="chip" data-act="sleepMood" data-v="' + x + '" aria-pressed="' + (dr.mood === x) + '">' + x + '</button>').join('') + '</div></div>' +
    '<div class="field"><span class="lbl">寝る前の習慣</span><div class="chips">' + SLEEP_TAGS.map((x) => '<button class="chip" data-act="sleepTag" data-v="' + x + '" aria-pressed="' + (dr.tags.indexOf(x) >= 0) + '">' + x + '</button>').join('') + '</div></div>' +
    '<div class="row wrap"><button class="btn" data-act="saveSleep">睡眠を保存</button>' + (s ? (ui.confirm === 'sleep' ? '<button class="link danger" data-act="delSleep">本当に削除</button>' : '<button class="link" data-act="askDel" data-v="sleep">今日の記録を削除</button>') : '') + '</div></div>';
  h += '<div class="card stack"><h3>この7日間</h3>' + sleepChart() + '</div>';
  return h;
}

function sleepChart() {
  const td = todayKey(), keys = [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(td, i - 6));
  const vals = keys.map((k) => { const s = dayOf(k).sleep; return s && nn(s.min) ? s : null });
  const W = 320, H = 190, pl = 30, pr = 8, pt = 14, pb = 42, cw = W - pl - pr, ch = H - pt - pb, max = 600;
  const y = (m) => pt + ch - (Math.min(m, max) / max) * ch; const bw = cw / 7;
  let g = '';
  [0, 180, 360, 540].forEach((m) => { g += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + y(m) + '" y2="' + y(m) + '" stroke="var(--line)" stroke-width="1"/><text x="' + (pl - 6) + '" y="' + (y(m) + 3) + '" text-anchor="end">' + (m / 60) + 'h</text>' });
  g += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + y(420) + '" y2="' + y(420) + '" stroke="var(--ok)" stroke-width="1.2" stroke-dasharray="4 3"/><text x="' + (W - pr) + '" y="' + (y(420) - 4) + '" text-anchor="end" style="fill:var(--ok)">目安 7h</text>';
  vals.forEach((s, i) => {
    const x = pl + bw * i + bw * 0.2, w = bw * 0.6;
    if (s) {
      const v = s.min, yy = y(v);
      g += '<rect x="' + x + '" y="' + yy + '" width="' + w + '" height="' + (y(0) - yy) + '" rx="6" style="fill:' + (v < 360 ? 'var(--warn)' : 'var(--accent)') + '"/><text x="' + (x + w / 2) + '" y="' + (yy - 4) + '" text-anchor="middle" style="fill:var(--ink)">' + (v / 60).toFixed(1) + '</text>';
      g += '<text x="' + (x + w / 2) + '" y="' + (H - 24) + '" text-anchor="middle" style="fill:var(--accent)">' + (s.q ? '★' + s.q : '') + '</text>';
    }
    g += '<text x="' + (x + w / 2) + '" y="' + (H - 8) + '" text-anchor="middle">' + WD[parseKey(keys[i]).getDay()] + '</text>';
  });
  const rec = vals.filter(Boolean).map((s) => s.min), low = rec.filter((v) => v < 360).length;
  const qs = vals.filter((s) => s && s.q).map((s) => s.q), qAvg = qs.length ? qs.reduce((a, b) => a + b, 0) / qs.length : null;
  let streakLow = 0; for (let i = vals.length - 1; i >= 0; i--) { if (vals[i] && vals[i].min < 360) streakLow++; else if (vals[i]) break }
  const cm = rec.length < 3 ? '3日分たまると、傾向が見えてきます。' :
    streakLow >= 2 ? '睡眠が6時間未満の日が ' + streakLow + ' 日続いています。今夜は少し早めに休めるといいですね。' :
      low >= 3 ? '6時間未満の日が ' + low + ' 日ありました。早めに休める日をつくれると◎' :
        low > 0 ? '6時間未満の日が ' + low + ' 日ありました。無理のない範囲で、寝る時間をそろえてみましょう。' :
        qAvg != null && qAvg < 2.5 ? '時間は取れていますが、眠りの質が低めです。寝る前のスマホやカフェインを見直してみても。' : '睡眠は安定しています。この調子で。';
  return '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="直近7日の睡眠時間と質のグラフ">' + g + '</svg><div class="sub"><span style="color:var(--accent)">■</span> 6時間以上 <span style="color:var(--warn)">■</span> 6時間未満 ・ ★は眠りの質</div><p>' + cm + '</p>';
}

function advHtml(a) {
  if (!a) return ''; const t = a.today || {};
  const sec = (l, x) => (x ? '<div class="adv"><h3>' + l + '</h3><p>' + esc(x) + '</p></div>' : '');
  return (a.seeDoctor ? '<div class="notice alert"><b>皮膚科の受診をおすすめします。</b> 強い赤みや腫れ、痛みなど、気になる様子があります。</div>' : '') +
    sec('今日の肌', a.observation) + sec('スキンケア', t.skincare) + sec('水分と食事', t.foodWater) + sec('紫外線', t.uv) + sec('休息', t.rest) + sec('気をつけたい点', a.caution);
}

const ADV_STEPS = [[0, '写真と記録をまとめています'], [4, '肌の様子を見ています'], [15, '今日の過ごし方を考えています'], [35, 'もう少しで できあがります']];
function viewSkin() {
  const td = todayKey(), d = dayOf(td), sk = d.skin;
  const chips = ui.draft.skinChips || (ui.draft.skinChips = sk && sk.chips ? sk.chips.slice() : []);
  let h = '<div class="card stack"><h2>今日の肌をチェック</h2>';
  if (ui.photoUrl) h += '<img class="photo" src="' + ui.photoUrl + '" alt="選んだ肌の写真"><div class="row"><button class="btn small ghost" data-act="pickPhoto">写真を変える</button><button class="link" data-act="clearPhoto">写真をやめる</button></div>';
  else h += '<button class="drop" data-act="pickPhoto"><span><b>写真を選ぶ・撮る</b><br><span class="sub">自然光・正面・メイクなしがおすすめ。<br>写真は保存されず、アドバイス作成に一度だけ使います。</span></span></button>';
  h += '<div class="field"><span class="lbl">今日の自己評価(いくつでも)</span><div class="chips">' + SKIN_CHIPS.map((x) => '<button class="chip" data-act="skinChip" data-v="' + x + '" aria-pressed="' + (chips.indexOf(x) >= 0) + '">' + x + '</button>').join('') + '</div></div>';
  if (ui.adv && ui.adv.state === 'run') {
    h += '<div class="stack"><div class="row"><div class="grow"><b id="advStep">' + ADV_STEPS[0][1] + '…</b><div class="sub">数十秒かかることがあります。</div></div><button class="btn small ghost" data-act="stopAdvice">止める</button></div><div class="progress"><span id="advBar" style="width:4%"></span></div></div>';
  } else {
    h += '<button class="btn" data-act="genAdvice">今日のアドバイスをもらう</button>';
    if (!ui.apiKey) h += '<div class="sub">いまは端末の中だけで作る「かんたんアドバイス」になります(写真は使いません)。写真から見てほしいときは、下の「Claudeとつなぐ」で設定してください。</div>';
    h += '<button class="link" style="align-self:flex-start" data-act="saveChips">自己評価だけ保存する</button>';
  }
  if (ui.adv && ui.adv.state === 'err') h += '<div class="notice">' + advErrText(ui.adv.code) + '</div>';
  h += '</div>';
  if (sk && sk.advice) h += '<div class="card lift stack"><div class="hd"><h2>今日のアドバイス</h2><span>' + (sk.advice.mode === 'rest' ? '<span class="tag">休息を優先</span> ' : '') + '<span class="tag">' + (sk.advice.source === 'claude' ? 'Claude' : 'かんたん') + '</span></span></div>' + advHtml(sk.advice) + '<div class="sub">参考情報です。診断ではありません。気になる症状や薬のことは、医師・薬剤師に相談してください。</div></div>';
  const hist = Object.keys(data.days).filter((k) => data.days[k].skin && k !== td).sort().reverse().slice(0, 14);
  h += '<div class="card stack"><h3>これまでの肌</h3>';
  if (!hist.length) h += '<div class="empty">チェックした日が、ここにたまります。</div>';
  hist.forEach((k) => {
    const s = data.days[k].skin;
    h += '<details><summary>' + mdw(k) + ' <span class="sub">' + esc((s.chips || []).join('・') || '自己評価なし') + '</span>' + (data.days[k].sample ? ' <span class="tag sample">サンプル</span>' : '') + '</summary><div class="stack" style="margin-top:8px">' + (s.advice ? advHtml(s.advice) : '<div class="sub">アドバイスはありません。</div>') +
      (ui.confirm === 'skin:' + k ? '<button class="link danger" style="align-self:flex-start" data-act="delSkin" data-v="' + k + '">本当に削除</button>' : '<button class="link" style="align-self:flex-start" data-act="askDel" data-v="skin:' + k + '">この日の肌記録を削除</button>') + '</div></details>';
  });
  h += '</div>';
  h += '<div class="card"><details' + (ui.open.key ? ' open' : '') + '><summary data-act="toggleOpen" data-v="key">Claudeとつなぐ ' + (ui.apiKey ? '<span class="tag good">設定済み</span>' : '<span class="tag">未設定</span>') + '</summary><div class="stack" style="margin-top:12px">' +
    '<p class="sub">ご自身の Anthropic API キーを入れると、写真と記録から Claude がアドバイスを作ります。キーはこの端末のブラウザにだけ保存され、Anthropic への送信以外には使いません。利用料はご自身のアカウントにかかります。キーは <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">Anthropic Console</a> で発行できます。</p>' +
    '<div class="field"><label for="apiKey">APIキー</label><input type="password" id="apiKey" data-d="apiKey" autocomplete="off" placeholder="sk-ant-..." value="' + esc(ui.draft.apiKey != null ? ui.draft.apiKey : '') + '"></div>' +
    '<div class="row wrap"><button class="btn small" data-act="saveKey">保存</button>' + (ui.apiKey ? '<button class="link danger" data-act="delKey">キーを削除</button>' : '') + '</div></div></details></div>';
  return h;
}
function advErrText(c) {
  return ({
    auth: 'APIキーが正しくないようです。「Claudeとつなぐ」でキーを確かめてください。',
    rate_limited: '利用の上限に達しています。しばらく待ってからお試しください。',
    refused: 'この内容ではアドバイスを作れませんでした。写真を変えるか、写真なしでお試しください。',
    invalid_json: 'うまくまとめられませんでした。もう一度お試しください。',
    network: 'インターネットにつながらないようです。電波のよい場所でもう一度お試しください。',
    overloaded: 'いま混み合っています。少し時間をおいてお試しください。',
    sdk: 'アドバイスの部品を読み込めませんでした。電波のよい場所で開き直してください。',
    image: '写真を読み込めませんでした。JPEG か PNG の写真を選んでください。'
  })[c] || 'うまく作れませんでした。もう一度お試しください。';
}

function viewHead() {
  const td = todayKey(), d = dayOf(td), hlRec = d.headache; let h = '';
  h += '<div class="notice alert"><b>こんなときは、すぐに救急や医療機関へ。</b><br>突然の激しい頭痛 / 経験したことのない頭痛 / ろれつが回らない / 手足のまひやしびれ / 意識がもうろうとする / 発熱や首のこわばりを伴う</div>';
  // 注意度
  const name = curRegionName();
  if (name) {
    const v = wxView(name), rt = risk('today', v), rm = risk('tomorrow', v);
    h += '<div class="card stack"><div class="hd"><h2>今日と明日の注意度</h2><span class="sub">' + esc(name) + '</span></div>';
    if (rt || rm) h += '<div class="outlook">' + [['今日', rt, v.today], ['明日', rm, v.tomorrow]].map(([when, r, w]) => '<div><span class="when">' + when + '</span>' + (r ? lvBadge(r) + '<span class="sub">' + esc(wxLine(w)) + '</span>' : '<span class="sub">情報なし</span>') + '</div>').join('') + '</div>';
    else h += '<div class="empty">' + (ui.wxBusy ? '天気を読み込んでいます…' : '天気をまだ取得できていません。') + '</div>';
    if ((rt && rt.k !== 'ok') || (rm && rm.k !== 'ok')) h += '<div class="tip">早めに寝る / 水分と食事をとる / 予定に余裕をもたせる / 処方された頭痛薬を手元に置く</div>';
    h += '<div class="row between"><span class="sub">' + wxStatus(v) + '</span><button class="btn small soft" data-act="refreshWx"' + (ui.wxBusy ? ' disabled' : '') + '>今すぐ更新</button></div>';
    if (v.stale || ui.wxFailed) h += manualWxForm(name, v);
    h += '</div>';
  }
  // 頭痛の記録
  const dr = ui.draft.hl = ui.draft.hl || (hlRec && hlRec.had ? { had: true, level: hlRec.level, time: hlRec.time, aura: hlRec.aura, meds: (hlRec.meds || []).slice(), trigger: hlRec.trigger || '' } : { had: hlRec ? false : null, level: 3, time: '朝', aura: false, meds: [], trigger: '' });
  h += '<div class="card stack"><div class="hd"><h2>今日の頭痛</h2>' + (hlRec ? '<span class="tag">記録済み</span>' : '') + '</div>' +
    '<div class="seg" style="grid-template-columns:1fr 1fr"><button class="chip" data-act="hlHad" data-v="0" aria-pressed="' + (dr.had === false) + '">出ていない</button><button class="chip" data-act="hlHad" data-v="1" aria-pressed="' + (dr.had === true) + '">出た</button></div>';
  if (dr.had === true) {
    h += '<div class="field"><span class="lbl">強さ(1 軽い 〜 5 つらい)</span><div class="seg">' + [1, 2, 3, 4, 5].map((i) => '<button class="chip" data-act="hlLevel" data-v="' + i + '" aria-pressed="' + (dr.level === i) + '">' + i + '</button>').join('') + '</div></div>' +
      '<div class="field"><span class="lbl">始まった時間帯</span><div class="chips">' + HL_TIMES.map((x) => '<button class="chip" data-act="hlTime" data-v="' + x + '" aria-pressed="' + (dr.time === x) + '">' + x + '</button>').join('') + '</div></div>' +
      '<div class="field"><span class="lbl">前兆(視界のちかちかなど)</span><div class="seg" style="grid-template-columns:1fr 1fr"><button class="chip" data-act="hlAura" data-v="1" aria-pressed="' + (dr.aura === true) + '">あり</button><button class="chip" data-act="hlAura" data-v="0" aria-pressed="' + (dr.aura === false) + '">なし</button></div></div>' +
      (Object.keys(data.meds).length ? '<div class="field"><span class="lbl">飲んだ薬(登録済みから)</span><div class="chips">' + medList().map((m) => '<button class="chip" data-act="hlMed" data-v="' + esc(m.id) + '" aria-pressed="' + (dr.meds.indexOf(m.id) >= 0) + '">' + esc(m.name) + '</button>').join('') + '</div></div>' : '') +
      '<div class="field"><label for="hlTrig">思い当たるきっかけ</label><input type="text" id="hlTrig" data-d="hl.trigger" value="' + esc(dr.trigger) + '" placeholder="例: 寝不足、人混み"></div>';
  }
  h += '<div class="row wrap"><button class="btn" data-act="saveHl"' + (dr.had == null ? ' disabled' : '') + '>保存</button>' + (hlRec ? (ui.confirm === 'hl' ? '<button class="link danger" data-act="delHl">本当に削除</button>' : '<button class="link" data-act="askDel" data-v="hl">今日の記録を削除</button>') : '') + '</div></div>';
  // 振り返り
  const days = Object.keys(data.days).filter((k) => data.days[k].headache && data.days[k].headache.had).sort().reverse().slice(0, 14);
  h += '<div class="card stack"><h3>頭痛が出た日の振り返り</h3>';
  if (!days.length) h += '<div class="empty">頭痛を記録すると、その日の天気・睡眠・服薬が並びます。</div>';
  else h += '<div class="scroll"><table><thead><tr><th>日付</th><th>強さ</th><th>天気・気圧</th><th>睡眠</th><th>服薬</th></tr></thead><tbody>' + days.map((k) => {
    const x = data.days[k], hl = x.headache, w = hl.wx || {}, a = adherence(k);
    return '<tr><td class="num">' + mdw(k) + (x.sample ? '<br><span class="tag sample">サンプル</span>' : '') + '</td><td class="num">' + hl.level + '</td><td>' + esc((w.condition || '-') + (nn(w.pressureChangeHpa) ? ' / ' + (w.pressureChangeHpa > 0 ? '+' : '') + w.pressureChangeHpa + 'hPa' : '')) + '</td><td class="num">' + (x.sleep && nn(x.sleep.min) ? (x.sleep.min / 60).toFixed(1) + 'h' : '-') + '</td><td class="num">' + (a == null ? '-' : Math.round(a * 100) + '%') + '</td></tr>';
  }).join('') + '</tbody></table></div>';
  const mo = td.slice(0, 7), used = Object.keys(data.days).filter((k) => { const hl = data.days[k].headache; return k.slice(0, 7) === mo && hl && hl.had && hl.meds && hl.meds.length }).length;
  if (used >= 10) h += '<div class="notice">今月は頭痛薬を飲んだ日が ' + used + ' 日あります。一度、医師や薬剤師に相談してみてください。</div>';
  h += '<div class="sub">注意度は天気や記録から出した目安で、頭痛が起きることを予測・断定するものではありません。</div></div>';
  // 地域
  const rs = prefs().regions, rd = ui.draft.region || '';
  h += '<div class="card stack"><h2>天気を見る地域</h2><div class="sub">毎朝6時以降にアプリを開くと、その日の天気に自動で更新されます(最大5か所)。天気を調べるために外へ送るのは、登録した地名とその位置だけです。</div>' +
    (rs.length ? rs.map((r, i) => {
      const w = wxView(r.name);
      return '<div class="row between"><div class="grow"><b>' + esc(r.name) + '</b><div class="sub">' + (w.today ? esc(wxLine(w.today)) : 'まだ取得されていません') + '</div></div>' +
        (ui.confirm === 'rg:' + i ? '<button class="link danger" data-act="delRegion" data-v="' + i + '">本当に外す</button>' : '<button class="link" data-act="askDel" data-v="rg:' + i + '">外す</button>') + '</div>';
    }).join('') : '<div class="empty">地域を追加してください。</div>') +
    (rs.length < 5 ? '<div class="row"><div class="field grow"><label for="rgIn" class="lbl">地名を追加</label><input type="text" id="rgIn" data-d="region" value="' + esc(rd) + '" placeholder="例: 東京都渋谷区"></div><button class="btn small" style="align-self:flex-end" data-act="addRegion"' + (ui.rgBusy ? ' disabled' : '') + '>' + (ui.rgBusy ? '確認中…' : '追加') + '</button></div>' : '<div class="sub">5か所まで登録できます。</div>') + '</div>';
  // 基準
  const th = prefs().thresholds;
  h += '<div class="card"><details' + (ui.open.th ? ' open' : '') + '><summary data-act="toggleOpen" data-v="th">注意度の基準を変える</summary><div class="stack" style="margin-top:12px"><div class="two">' +
    '<div class="field"><label for="thP">気圧の下がり幅(hPa)</label><input type="number" id="thP" min="1" max="15" step="1" data-d="th.p" value="' + (ui.draft.th && ui.draft.th.p != null ? esc(ui.draft.th.p) : th.pressureDrop) + '"></div>' +
    '<div class="field"><label for="thT">気温差(℃)</label><input type="number" id="thT" min="1" max="15" step="1" data-d="th.t" value="' + (ui.draft.th && ui.draft.th.t != null ? esc(ui.draft.th.t) : th.tempDiff) + '"></div></div>' +
    '<div class="sub">この値以上になると「注意」に近づきます。気圧は倍の幅で「警戒」寄りになります。</div><button class="btn small" data-act="saveTh">基準を保存</button></div></details></div>';
  return h;
}

function manualWxForm(name, v) {
  const man = data.weather.manual[name], cur = (man && man.date === todayKey() && man.values) || {};
  const f = ui.draft.wx = ui.draft.wx || { condition: cur.condition || (v.today && v.today.condition) || '', tempMax: cur.tempMax != null ? cur.tempMax : '', tempDiff: cur.tempDiff != null ? cur.tempDiff : '', pressureChangeHpa: cur.pressureChangeHpa != null ? cur.pressureChangeHpa : '' };
  return '<details' + (ui.open.wxman ? ' open' : '') + '><summary data-act="toggleOpen" data-v="wxman">今日の天気を手入力で補う</summary><div class="stack" style="margin-top:12px">' +
    '<div class="sub">天気予報などを見て、分かる項目だけ入れてください。</div>' +
    '<div class="field"><span class="lbl">天気</span><div class="chips">' + WX_CONDS.map((x) => '<button class="chip" data-act="wxCond" data-v="' + x + '" aria-pressed="' + (f.condition === x) + '">' + x + '</button>').join('') + '</div></div>' +
    '<div class="two"><div class="field"><label for="wxT">最高気温(℃)</label><input type="number" id="wxT" data-d="wx.tempMax" value="' + esc(f.tempMax) + '"></div>' +
    '<div class="field"><label for="wxD">前日との気温差(℃)</label><input type="number" id="wxD" data-d="wx.tempDiff" value="' + esc(f.tempDiff) + '"></div></div>' +
    '<div class="field"><label for="wxP">気圧の変化(hPa・下がるならマイナス)</label><input type="number" id="wxP" step="0.5" data-d="wx.pressureChangeHpa" value="' + esc(f.pressureChangeHpa) + '"></div>' +
    '<div class="row wrap"><button class="btn small" data-act="saveWxManual">手入力を保存</button>' + (man ? '<button class="link" data-act="delWxManual">手入力を消す</button>' : '') + '</div></div></details>';
}

const VIEWS = { home: viewHome, med: viewMed, sleep: viewSleep, skin: viewSkin, head: viewHead };

/* ---------- render ---------- */
function render() {
  const now = new Date(), hr = now.getHours();
  $('#hdDate').textContent = (now.getMonth() + 1) + '月' + now.getDate() + '日(' + WD[now.getDay()] + ')';
  $('#hdGreet').textContent = hr < 5 ? 'こんばんは' : hr < 11 ? 'おはよう' : hr < 18 ? 'こんにちは' : 'おつかれさま';
  $('#tabs').innerHTML = TABS.map((t) => '<button data-act="tab" data-v="' + t[0] + '"' + (ui.tab === t[0] ? ' aria-current="page"' : '') + '><svg viewBox="0 0 24 24" aria-hidden="true">' + ICON[t[0]] + '</svg>' + t[1] + '</button>').join('');
  $('#view').innerHTML = (VIEWS[ui.tab] || viewHome)();
}
// 入力中に非同期の更新(天気など)が来たら、入力が終わるまで描き直しを待つ
function scheduleRender() {
  const a = document.activeElement;
  if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && $('#view').contains(a)) { ui.pending = true; return }
  render();
}
document.addEventListener('focusout', () => { if (ui.pending) { ui.pending = false; setTimeout(render, 50) } });

/* ---------- events ---------- */
document.addEventListener('input', (e) => {
  const t = e.target; if (!t.dataset || !t.dataset.d) return; setPath(ui.draft, t.dataset.d, t.value);
  if (t.id === 'sBed' || t.id === 'sWake') { const m = sleepMin(ui.draft.sleep.bed, ui.draft.sleep.wake); const el = $('#sDur'); if (el) el.textContent = m == null ? '-' : fmtMin(m) }
});
document.addEventListener('change', (e) => { const t = e.target; if (t.dataset && t.dataset.d) setPath(ui.draft, t.dataset.d, t.value) });
document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'rgIn') { e.preventDefault(); addRegion() } });
$('#photoInput').addEventListener('change', (e) => {
  const f = e.target.files && e.target.files[0]; if (!f) return;
  if (ui.photoUrl) URL.revokeObjectURL(ui.photoUrl); ui.photo = f; ui.photoUrl = URL.createObjectURL(f); e.target.value = ''; render();
});
$('#importInput').addEventListener('change', async (e) => {
  const f = e.target.files && e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const j = JSON.parse(await f.text());
    if (!j || typeof j !== 'object' || !j.days || !j.meds) throw new Error('format');
    data = normalize(j); commit(); toast('記録を戻しました');
  } catch (err) { toast('このファイルは読み込めませんでした。「記録を書き出す」で作ったファイルを選んでください。') }
});

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]'); if (!b) return; const a = b.dataset.act, v = b.dataset.v, td = todayKey();
  if (a !== 'toggleOpen' && a !== 'askDel' && ui.confirm) ui.confirm = null;
  switch (a) {
    case 'tab': ui.tab = v; lsSet('nk-tab', v); ui.confirm = null; render(); window.scrollTo(0, 0); break;
    case 'region': ui.region = v; lsSet('nk-region', v); render(); break;
    case 'toggleOpen': e.preventDefault(); ui.open[v] = !ui.open[v]; render(); break;
    case 'askDel': e.preventDefault(); ui.confirm = v; render(); break;
    case 'toggleMed': updateDay(td, (d) => { const t = d.taken || []; const i = t.indexOf(v); if (i >= 0) t.splice(i, 1); else t.push(v); d.taken = t }); break;
    case 'addMed': {
      const m = ui.draft.med || {}; if (!(m.name || '').trim()) { toast('名前を入れてください'); break }
      saveMed({ id: 'm' + Date.now().toString(36), name: m.name.trim(), kind: m.kind || 'サプリ', dose: (m.dose || '').trim(), timing: m.timing || '朝', effect: (m.effect || '').trim() });
      ui.draft.med = null; ui.open.addMed = false; render(); toast('登録しました'); break;
    }
    case 'delMed': removeMed(v); toast('削除しました'); break;
    case 'saveMemo': { const tx = ui.draft.memo != null ? ui.draft.memo : (dayOf(td).memo || ''); ui.draft.memo = null; updateDay(td, (d) => { d.memo = tx.trim() }); toast('メモを保存しました'); break }
    case 'sleepQ': ui.draft.sleep.q = Number(v); render(); break;
    case 'sleepMood': ui.draft.sleep.mood = ui.draft.sleep.mood === v ? '' : v; render(); break;
    case 'sleepTag': { const tg = ui.draft.sleep.tags, i = tg.indexOf(v); if (i >= 0) tg.splice(i, 1); else tg.push(v); render(); break }
    case 'saveSleep': {
      const s = ui.draft.sleep, m2 = sleepMin(s.bed, s.wake); if (m2 == null) { toast('時刻を入れてください'); break }
      updateDay(td, (d) => { d.sleep = { bed: s.bed, wake: s.wake, min: m2, q: s.q, mood: s.mood, tags: s.tags.slice() } }); toast('睡眠を保存しました'); break;
    }
    case 'delSleep': ui.draft.sleep = null; updateDay(td, (d) => { delete d.sleep }); toast('削除しました'); break;
    case 'skinChip': { const c = ui.draft.skinChips, j = c.indexOf(v); if (j >= 0) c.splice(j, 1); else c.push(v); render(); break }
    case 'saveChips': updateDay(td, (d) => { d.skin = Object.assign(d.skin || {}, { chips: ui.draft.skinChips.slice() }) }); toast('自己評価を保存しました'); break;
    case 'pickPhoto': $('#photoInput').click(); break;
    case 'clearPhoto': clearPhoto(); render(); break;
    case 'genAdvice': genAdvice(); break;
    case 'stopAdvice': if (ui.ctl) ui.ctl.abort(); break;
    case 'delSkin': updateDay(v, (d) => { delete d.skin }); toast('削除しました'); break;
    case 'saveKey': {
      const k = (ui.draft.apiKey || '').trim(); if (!k) { toast('APIキーを入れてください'); break }
      if (!lsSet(KEY_KEY, k)) toast('この画面では保存できないため、閉じるまでの間だけ使います'); else toast('保存しました');
      ui.apiKey = k; ui.draft.apiKey = ''; ui.open.key = false; render(); break;
    }
    case 'delKey': lsDel(KEY_KEY); ui.apiKey = ''; render(); toast('キーを削除しました'); break;
    case 'hlHad': ui.draft.hl.had = v === '1'; render(); break;
    case 'hlLevel': ui.draft.hl.level = Number(v); render(); break;
    case 'hlTime': ui.draft.hl.time = v; render(); break;
    case 'hlAura': ui.draft.hl.aura = v === '1'; render(); break;
    case 'hlMed': { const hm = ui.draft.hl.meds, k = hm.indexOf(v); if (k >= 0) hm.splice(k, 1); else hm.push(v); render(); break }
    case 'saveHl': saveHeadache(); break;
    case 'delHl': ui.draft.hl = null; updateDay(td, (d) => { delete d.headache }); toast('削除しました'); break;
    case 'refreshWx': refreshWeather(true); break;
    case 'wxCond': ui.draft.wx.condition = ui.draft.wx.condition === v ? '' : v; render(); break;
    case 'saveWxManual': {
      const f = ui.draft.wx || {}, name = curRegionName(); if (!name) break;
      data.weather.manual[name] = { date: td, values: { condition: f.condition || null, tempMax: numOrNull(f.tempMax), tempDiff: numOrNull(f.tempDiff), pressureChangeHpa: numOrNull(f.pressureChangeHpa) } };
      ui.draft.wx = null; commit(); toast('手入力を保存しました'); break;
    }
    case 'delWxManual': delete data.weather.manual[curRegionName()]; ui.draft.wx = null; commit(); break;
    case 'addRegion': addRegion(); break;
    case 'delRegion': {
      const r = prefs().regions[Number(v)];
      updatePrefs((p) => { p.regions.splice(Number(v), 1) });
      if (r) { delete data.weather.regions[r.name]; delete data.weather.manual[r.name]; save() }
      toast('外しました'); break;
    }
    case 'saveTh': {
      const th = ui.draft.th || {};
      const P = Math.max(1, Math.min(15, Number(th.p != null ? th.p : prefs().thresholds.pressureDrop) || DEF_TH.pressureDrop));
      const T = Math.max(1, Math.min(15, Number(th.t != null ? th.t : prefs().thresholds.tempDiff) || DEF_TH.tempDiff));
      ui.draft.th = null; updatePrefs((p) => { p.thresholds = { pressureDrop: P, tempDiff: T } }); toast('基準を保存しました'); break;
    }
    case 'clearSamples': clearSamples(); break;
    case 'export': exportData(); break;
    case 'import': $('#importInput').click(); break;
    case 'wipe': data = emptyData(); ui.draft = {}; commit(); refreshWeather(); toast('すべての記録を削除しました'); break;
  }
});

async function addRegion() {
  const nm = (ui.draft.region || '').trim(); if (!nm) { toast('地名を入れてください'); return }
  if (prefs().regions.length >= 5) { toast('5か所まで登録できます'); return }
  if (prefs().regions.some((r) => r.name === nm)) { toast('もう登録されています'); return }
  ui.rgBusy = true; render();
  let g = null;
  try { g = await geocode(nm) } catch (e) { ui.rgBusy = false; render(); toast('地名を確認できませんでした。電波のよい場所でもう一度お試しください。'); return }
  ui.rgBusy = false;
  if (!g) { render(); toast('その地名は見つかりませんでした。「東京都渋谷区」のように都道府県から入れてみてください。'); return }
  ui.draft.region = '';
  updatePrefs((p) => { p.regions.push({ name: nm, lat: g.lat, lon: g.lon }) });
  toast('追加しました。天気を読み込みます');
  refreshWeather();
}

function saveHeadache() {
  const dr = ui.draft.hl, td = todayKey(); if (dr.had == null) return;
  const name = curRegionName(), t = (name && wxView(name).today) || {};
  updateDay(td, (d) => {
    if (!dr.had) d.headache = { had: false };
    else d.headache = {
      had: true, level: dr.level, time: dr.time, aura: !!dr.aura, meds: dr.meds.slice(), trigger: (dr.trigger || '').trim(),
      wx: { region: name || '', condition: t.condition || '', pressureChangeHpa: nn(t.pressureChangeHpa) ? t.pressureChangeHpa : null, tempMax: nn(t.tempMax) ? t.tempMax : null }
    };
  });
  toast('保存しました');
}

function clearSamples() {
  Object.values(data.meds).forEach((m) => { if (m.sample) delete data.meds[m.id] });
  Object.keys(data.days).forEach((k) => { if (data.days[k].sample) delete data.days[k] });
  Object.values(data.days).forEach((d) => { if (d.taken) d.taken = d.taken.filter((id) => data.meds[id]) });
  ui.draft = {}; commit(); toast('サンプルを消しました');
}

function exportData() {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'nanka-' + todayKey() + '.json';
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ---------- skin advice ---------- */
function clearPhoto() { if (ui.photoUrl) URL.revokeObjectURL(ui.photoUrl); ui.photo = null; ui.photoUrl = null }

function adviceContext() {
  const td = todayKey(), d = dayOf(td), meds = medList(), chips = (ui.draft.skinChips || []).slice();
  const name = curRegionName(), v = name ? wxView(name) : null, rt = v ? risk('today', v) : null;
  return { td, d, meds, chips, name, v, rt, sl: d.sleep, hl: d.headache };
}

function buildPrompt(c, withPhoto) {
  const L = [];
  L.push('あなたは、肌と生活習慣のセルフケアを手伝うアシスタントです。医療的な診断はしません。');
  L.push('次の情報をもとに、今日1日の過ごし方を日本語でやさしく提案してください。');
  L.push('【今日の情報】');
  L.push('日付: ' + mdw(c.td));
  L.push('肌の自己評価: ' + (c.chips.length ? c.chips.join('、') : '未入力'));
  L.push('服薬: ' + takenCount(c.td) + '/' + c.meds.length + ' 件チェック済み(' + (c.meds.map((m) => m.name + ((c.d.taken || []).indexOf(m.id) >= 0 ? '○' : '×')).join('、') || '登録なし') + ')');
  L.push('昨夜の睡眠: ' + (c.sl && nn(c.sl.min) ? fmtMin(c.sl.min) + '、質 ' + c.sl.q + '/5' + (c.sl.mood ? '、起床時の気分 ' + c.sl.mood : '') + ((c.sl.tags || []).length ? '、寝る前: ' + c.sl.tags.join('・') : '') : '未記録'));
  L.push('今日の体感メモ: ' + (c.d.memo || 'なし'));
  L.push('頭痛: ' + (c.hl && c.hl.had ? 'あり(強さ ' + c.hl.level + '/5)' : 'なし・未記録'));
  L.push('頭痛への注意度: ' + (c.rt ? c.rt.label : '不明'));
  L.push('天気: ' + (c.v && c.v.today ? wxLine(c.v.today) + (nn(c.v.today.rainChance) ? '、降水確率 ' + c.v.today.rainChance + '%' : '') : '不明'));
  L.push(withPhoto ? '添付した写真は今日の肌です。見た目で分かる範囲(乾燥、赤み、テカリ、くすみ、ニキビなど)だけを述べてください。写真の明るさや向きで見え方が変わることにも配慮してください。' : '写真はありません。自己評価と記録だけで提案してください。');
  L.push('【守ること】');
  L.push('- 病名の診断や断定をしない。服薬と肌の関係も断定しない。');
  L.push('- 薬やサプリの量・時間の変更、中止、開始を指示しない。薬のことは医師・薬剤師に相談するよう促す。');
  L.push('- 強い赤み、腫れ、痛み、急な広がり、できものの変化が見える・書かれている場合は seeDoctor を true にして、皮膚科の受診を勧める。');
  L.push('- 頭痛がある日、または注意度が「警戒」の日は、全体を短くして休息を優先した内容にし、mode を "rest" にする。それ以外は "normal"。');
  L.push('- observation は「今日のひとこと」としてホームにも出すので、1文で短く。ほかの各項目は1〜2文。やさしい口調で、責める言い方はしない。');
  return L.join('\n');
}

const ADVICE_SCHEMA = {
  type: 'object',
  properties: {
    mode: { type: 'string', enum: ['normal', 'rest'] },
    observation: { type: 'string' },
    today: {
      type: 'object',
      properties: { skincare: { type: 'string' }, foodWater: { type: 'string' }, uv: { type: 'string' }, rest: { type: 'string' } },
      required: ['skincare', 'foodWater', 'uv', 'rest'], additionalProperties: false
    },
    caution: { type: 'string' },
    seeDoctor: { type: 'boolean' }
  },
  required: ['mode', 'observation', 'today', 'caution', 'seeDoctor'], additionalProperties: false
};

// 写真を長辺1280pxのJPEGに縮めて base64 にする(保存はしない)
async function photoToBase64(file) {
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = ui.photoUrl });
  const s = Math.min(1, 1280 / Math.max(img.naturalWidth, img.naturalHeight));
  const cv = document.createElement('canvas'); cv.width = Math.round(img.naturalWidth * s); cv.height = Math.round(img.naturalHeight * s);
  cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
  return cv.toDataURL('image/jpeg', 0.85).split(',')[1];
}

let sdkPromise = null;
function loadSdk() { if (!sdkPromise) sdkPromise = import(SDK_URL).catch((e) => { sdkPromise = null; throw e }); return sdkPromise }

async function claudeAdvice(c, signal) {
  let mod;
  try { mod = await loadSdk() } catch (e) { throw { code: 'sdk' } }
  const Anthropic = mod.default;
  const client = new Anthropic({ apiKey: ui.apiKey, dangerouslyAllowBrowser: true, maxRetries: 1 });
  const content = [];
  const withPhoto = !!ui.photo;
  if (withPhoto) {
    let b64; try { b64 = await photoToBase64(ui.photo) } catch (e) { throw { code: 'image' } }
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } });
  }
  content.push({ type: 'text', text: buildPrompt(c, withPhoto) });
  let res;
  try {
    res = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: ADVICE_SCHEMA } },
      messages: [{ role: 'user', content }]
    }, { signal });
  } catch (e) {
    if (e instanceof mod.APIUserAbortError || (e && e.name === 'AbortError')) throw { code: 'cancelled' };
    if (e instanceof mod.AuthenticationError || e instanceof mod.PermissionDeniedError) throw { code: 'auth' };
    if (e instanceof mod.RateLimitError) throw { code: 'rate_limited' };
    if (e instanceof mod.APIConnectionError) throw { code: 'network' };
    if (e instanceof mod.InternalServerError) throw { code: 'overloaded' };
    throw { code: 'other' };
  }
  if (res.stop_reason === 'refusal') throw { code: 'refused' };
  const txt = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  let out; try { out = JSON.parse(txt) } catch (e) { throw { code: 'invalid_json' } }
  out.source = 'claude'; out.photo = withPhoto;
  return out;
}

// APIキーがないときの、端末内だけで作るかんたんアドバイス
function localAdvice(c) {
  const ch = c.chips, has = (x) => ch.indexOf(x) >= 0, rest = (c.hl && c.hl.had) || (c.rt && c.rt.k === 'alert');
  const sk = [];
  if (has('乾燥')) sk.push('化粧水のあとに乳液やクリームでふたをして、うるおいを逃がさないように');
  if (has('テカリ')) sk.push('皮脂はやさしく押さえる程度にして、保湿は軽めのものを');
  if (has('ニキビ')) sk.push('気になる所は触らず、低刺激のケアで');
  if (has('赤み')) sk.push('こすらず、香料などの刺激が少ないものを選んで');
  if (has('くすみ')) sk.push('丁寧な保湿と、温かい飲み物で血のめぐりを意識して');
  if (!sk.length) sk.push(has('調子いい') ? 'いつものケアを続けましょう' : 'まずは洗顔と保湿の基本ケアを丁寧に');
  const w = c.v && c.v.today, sl = c.sl;
  const sleepShort = sl && nn(sl.min) && sl.min < 360;
  const a = {
    mode: rest ? 'rest' : 'normal',
    observation: ch.length ? '自己評価では「' + ch.join('・') + '」の日です。' : '自己評価が未入力です。チップを選ぶと、より合ったアドバイスになります。',
    today: {
      skincare: sk.join('。') + '。',
      foodWater: rest ? '水分をこまめにとり、食事は抜かないようにしましょう。' : 'こまめな水分補給と、野菜やたんぱく質を意識した食事を。',
      uv: rest ? '' : (w && /雨|雪/.test(w.condition || '') ? 'くもりや雨の日も、紫外線は届きます。軽めの日焼け止めを。' : '外に出るときは日焼け止めを。2〜3時間おきの塗り直しが理想です。'),
      rest: sleepShort ? '昨夜は睡眠が短めでした。今夜は早めに休みましょう。' : rest ? '今日は休息を最優先に。無理せず、早めに横になりましょう。' : '寝る前のスマホを少し控えると、眠りが深くなりやすいです。'
    },
    caution: has('赤み') ? '赤みが強い・痛む・広がる場合は、皮膚科で相談してください。' : (c.rt && c.rt.k !== 'ok' ? '頭痛の注意度が「' + c.rt.label + '」の日です。予定に余裕をもたせて。' : '急に肌の様子が変わったときは、皮膚科で相談してください。'),
    seeDoctor: false, source: 'local', photo: false
  };
  return a;
}

async function genAdvice() {
  if (ui.adv && ui.adv.state === 'run') return;
  const c = adviceContext();
  if (!ui.apiKey) {
    updateDay(c.td, (d) => { d.skin = { chips: c.chips, advice: localAdvice(c), at: Date.now() } });
    toast('かんたんアドバイスを作りました'); return;
  }
  ui.adv = { state: 'run', start: Date.now() }; ui.ctl = new AbortController(); render();
  const tick = setInterval(() => {
    const t = (Date.now() - ui.adv.start) / 1000, bar = $('#advBar'), st = $('#advStep');
    if (bar) bar.style.width = Math.round(4 + 92 * (1 - Math.exp(-t / 18))) + '%';
    if (st) { let label = ADV_STEPS[0][1]; ADV_STEPS.forEach(([s, l]) => { if (t >= s) label = l }); st.textContent = label + '…' }
  }, 500);
  try {
    const out = await claudeAdvice(c, ui.ctl.signal);
    const clip = (s) => String(s || '').slice(0, 400);
    const adv = {
      mode: out.mode === 'rest' ? 'rest' : 'normal', observation: clip(out.observation), caution: clip(out.caution), seeDoctor: out.seeDoctor === true,
      today: { skincare: clip(out.today && out.today.skincare), foodWater: clip(out.today && out.today.foodWater), uv: clip(out.today && out.today.uv), rest: clip(out.today && out.today.rest) },
      source: 'claude', photo: out.photo
    };
    clearInterval(tick); ui.adv = { state: 'done' }; ui.ctl = null; clearPhoto();
    updateDay(c.td, (d) => { d.skin = { chips: c.chips, advice: adv, at: Date.now() } });
    toast('アドバイスができました');
  } catch (e) {
    clearInterval(tick); ui.ctl = null;
    ui.adv = e && e.code === 'cancelled' ? null : { state: 'err', code: e && e.code };
    if (!ui.adv) toast('止めました');
    render();
  }
}

/* ---------- sample data on first launch ---------- */
function seedSamples(d) {
  const td = todayKey();
  [['s1', 'ビタミンC', 'サプリ', '1000mg', '朝', '肌のハリ'], ['s2', 'ヘム鉄', 'サプリ', '1粒', '夜', 'くすみ対策'], ['s3', '頭痛薬(例)', '薬', '1錠', '昼', '頭痛のとき']].forEach((x) => {
    d.meds[x[0]] = { id: x[0], name: x[1], kind: x[2], dose: x[3], timing: x[4], effect: x[5], sample: true };
  });
  const mins = [430, 380, 350, 455, 410, 330, 445], qs = [4, 3, 2, 4, 3, 2, 4], chipsets = [['乾燥'], ['調子いい'], ['乾燥', 'くすみ'], ['調子いい'], ['テカリ'], ['ニキビ'], ['乾燥']];
  mins.forEach((m, i) => {
    const k = addDays(td, i - 7);
    d.days[k] = {
      date: k, sample: true, taken: i % 3 === 2 ? ['s1'] : ['s1', 's2'],
      sleep: { bed: '23:30', wake: '07:00', min: m, q: qs[i], mood: '', tags: i === 5 ? ['スマホ', 'カフェイン'] : [] },
      skin: { chips: chipsets[i], advice: i === 6 ? { mode: 'normal', observation: '(サンプル)少し乾燥ぎみの日です。', today: { skincare: '保湿を重ねて、うるおいを守りましょう。', foodWater: 'こまめに水分を。', uv: '日焼け止めを忘れずに。', rest: '早めに休みましょう。' }, caution: '赤みが強い場合は皮膚科へ。', seeDoctor: false, source: 'local' } : null },
      memo: i === 4 ? '(サンプル)肌がしっとりした' : ''
    };
    if (i === 5) d.days[k].headache = { had: true, level: 3, time: '夕方', aura: false, meds: ['s3'], trigger: '(サンプル)寝不足', wx: { condition: '雨', pressureChangeHpa: -6, tempMax: 21 } };
  });
}

/* ---------- boot ---------- */
data = load();
if (persistent && !lsGet(STORE_KEY)) save();
render();
if (wxNeedsUpdate()) refreshWeather();
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { render(); if (wxNeedsUpdate()) refreshWeather() } });
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => { });
