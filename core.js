// レッスン予約の共通部分（操作用 index.html と掲示用 board.html で使う）
// 先生・部屋・生徒・グループと予定は、API（Apps Script）から読み込んで setMaster / setEvents で入れる
'use strict';
/* ===== 定数 ===== */
const DAY_START = 9 * 60, DAY_END = 21 * 60, SLOT = 30, NSLOT = (DAY_END - DAY_START) / SLOT;
const WD = ['日', '月', '火', '水', '木', '金', '土'];
const PALETTE = ['#1d4ed8', '#be123c', '#15803d', '#a16207', '#7e22ce', '#0e7490', '#c2410c', '#334155', '#a21caf', '#4d7c0f', '#4338ca', '#8a4b1f'];
// 先生・部屋・生徒・グループ（名簿マスターと予約スプレッドシートから。setMaster で入れる）
let ROOMS = [], TEACHERS = [], TMAP = new Map(), STUDENTS = [], SMAP = new Map(), GROUPS = [], GMAP = new Map();
// 教室外の場所の候補（予約スプレッドシートの「場所」シート。候補にない場所も文字で入れられる）
let PLACES = [];
// 色（#rrggbb）を白と混ぜて、枠の背景に使う薄い色を作る
function tint(hex, k) {
  const n = parseInt(hex.slice(1), 16), mix = c => Math.round(c + (255 - c) * k);
  return '#' + [n >> 16, (n >> 8) & 255, n & 255].map(c => mix(c).toString(16).padStart(2, '0')).join('');
}
function setMaster(d) {
  ROOMS = (d.rooms || []).map(r => ({ id: r.id, name: r.name }));
  // name：表や枠に出す短い表示名。full：ログインや詳細、印刷の見出しに出す名前。active：在籍（退職した先生は過去の予定の表示にだけ使う）
  TEACHERS = (d.teachers || []).map((t, i) => {
    const fg = t.color || PALETTE[i % PALETTE.length];
    return { id: t.id, name: t.name || t.full, full: t.full || t.name, kind: t.lessons || '', active: t.active !== false, fg, bg: tint(fg, .85) };
  });
  TMAP = new Map(TEACHERS.map(t => [t.id, t]));
  STUDENTS = (d.students || []).map(s => ({ id: s.id, name: s.name, kana: s.kana || '', status: s.status || '' }))
    .sort((a, b) => a.kana.localeCompare(b.kana, 'ja'));
  SMAP = new Map(STUDENTS.map(s => [s.id, s]));
  // グループ：teachers はメインの先生（何人でも）。active：活動中（終了したグループは過去の予定の表示にだけ使う）
  // home：いつもの部屋・場所（{ rooms: ['R3'] } か、教室外なら { rooms: [], place: '分館' }。決めていなければ null）
  GROUPS = (d.groups || []).map(g => ({ id: g.id, name: g.name, teachers: g.teachers || [], active: g.active !== false, home: g.home || null }));
  PLACES = d.places || [];
  GMAP = new Map(GROUPS.map(g => [g.id, g]));
}
// 予約の選択肢に出す先生（在籍）と生徒（在籍・休会）
const activeTeachers = () => TEACHERS.filter(t => t.active);
const isBookable = s => s.status === '在籍' || s.status === '休会';
// rows: 一画面で何回分か（日時・部屋・先生が回ごとに違ってよい）を入れる / repeat: 毎週・隔週の繰り返しで入れる
// rooms: one=1部屋 / multi=複数（既定は全部屋） / opt=なしも可 / none=部屋なし
// teachers: mainsub=メイン＋伴奏 / multi=複数 / one=1人 / none
// outside: 部屋の代わりに「教室外」も選べる（部屋なし＋場所。部屋のぶつかりは見ず、先生のぶつかりだけ見る）
const TYPES = {
  lesson:   { label: 'レッスン', rooms: 'one',   teachers: 'mainsub', student: true, rows: true },
  group:    { label: 'グループ', rooms: 'one',   teachers: 'mainsub', group: true, rows: true, outside: true },
  // 体験：入会前の人の1回だけのレッスン。生徒ではないので、名前（任意・わかる範囲）を文字で持つ
  trial:    { label: '体験',     rooms: 'one',   teachers: 'mainsub', title: true, titleLabel: '申し込んだ人の名前（任意）', titleHint: '例：やまだ（わかる範囲で）' },
  practice: { label: '先生練習', rooms: 'one',   teachers: 'multi', title: true, repeat: true },
  // 生徒練習：生徒が先生なしで部屋だけ使う（部屋代がかかるので、レッスンとは分けて持つ）。グループの練習はない
  spractice: { label: '生徒練習', rooms: 'one',  teachers: 'none', student: true, rows: true },
  record:   { label: '録音',     rooms: 'multi', teachers: 'multi', title: true },
  clean:    { label: '掃除',     rooms: 'multi', teachers: 'none', title: true, repeat: true },
  event:    { label: '行事',     rooms: 'opt',   teachers: 'multi', title: true, allDay: true },
  out:      { label: '教室外',   rooms: 'none',  teachers: 'multi', place: true, repeat: true },
  absent:   { label: '不在',     rooms: 'none',  teachers: 'one', allDay: true, repeat: true },
  // 教室の休み（年末年始・お盆など）。祝日と同じくカレンダーに出し、曜日で入れるときは既定で外す
  closed:   { label: '教室の休み', rooms: 'none', teachers: 'none', title: true, allDay: true, onlyAllDay: true, repeat: true },
};

/* ===== 小道具 ===== */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const ds = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const pd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = pd(s); d.setDate(d.getDate() + n); return ds(d); };
const dow = s => pd(s).getDay();
const today = () => ds(new Date());
// 週は日曜から土曜まで（2026-11-22、先生の希望で月曜始まりから変えた）
const sundayOf = s => addDays(s, -dow(s));
const diffDays = (a, b) => Math.round((pd(b) - pd(a)) / 86400000);
const hm = m => `${Math.floor(m / 60)}:${pad(m % 60)}`;
const md = s => { const d = pd(s); return `${d.getMonth() + 1}/${d.getDate()}(${WD[d.getDay()]})`; };
const range = (a, b, step = SLOT) => { const r = []; for (let x = a; x <= b; x += step) r.push(x); return r; };
const kata = s => String(s || '').replace(/[ぁ-ゖ]/g, c => String.fromCharCode(c.charCodeAt(0) + 0x60)).replace(/[\s　]/g, '');
const tOf = e => e.teachers || [];
const tName = id => (TMAP.get(id) || { name: '?' }).name;
const tFull = id => (TMAP.get(id) || { full: '?' }).full;
const rName = id => (ROOMS.find(r => r.id === id) || { name: '?' }).name;
/* ===== 祝日（2020年以降の祝日法に合わせて計算する。春分・秋分は2099年まで使える近似式） ===== */
const HOLIDAYS = new Map();
function holidaysOf(y) {
  if (HOLIDAYS.has(y)) return HOLIDAYS.get(y);
  const m = new Map(), key = (mo, d) => `${y}-${pad(mo)}-${pad(d)}`;
  // その月の第n月曜日
  const nthMon = (mo, n) => 1 + (8 - new Date(y, mo - 1, 1).getDay()) % 7 + (n - 1) * 7;
  for (const [mo, d, name] of [[1, 1, '元日'], [2, 11, '建国記念の日'], [2, 23, '天皇誕生日'], [4, 29, '昭和の日'], [5, 3, '憲法記念日'], [5, 4, 'みどりの日'],
    [5, 5, 'こどもの日'], [8, 11, '山の日'], [11, 3, '文化の日'], [11, 23, '勤労感謝の日']]) m.set(key(mo, d), name);
  m.set(key(1, nthMon(1, 2)), '成人の日'); m.set(key(7, nthMon(7, 3)), '海の日');
  m.set(key(9, nthMon(9, 3)), '敬老の日'); m.set(key(10, nthMon(10, 2)), 'スポーツの日');
  const k = y - 1980, q = Math.floor(k / 4);
  m.set(key(3, Math.floor(20.8431 + 0.242194 * k) - q), '春分の日');
  m.set(key(9, Math.floor(23.2488 + 0.242194 * k) - q), '秋分の日');
  // 国民の休日：前の日と次の日が祝日にはさまれた平日（敬老の日と秋分の日の間など）
  for (const d of [...m.keys()]) { const mid = addDays(d, 1); if (m.has(addDays(d, 2)) && !m.has(mid) && dow(mid) !== 0) m.set(mid, '国民の休日'); }
  // 振替休日：祝日が日曜なら、そのあとの祝日でない最初の日
  for (const d of [...m.keys()].sort()) if (dow(d) === 0) { let x = addDays(d, 1); while (m.has(x)) x = addDays(x, 1); m.set(x, '振替休日'); }
  HOLIDAYS.set(y, m);
  return m;
}
const holidayName = d => holidaysOf(+d.slice(0, 4)).get(d) || '';
const roomsText = rs => !rs || !rs.length ? '部屋なし' : rs.length === ROOMS.length ? '全部屋' : rs.map(rName).join('・');
// 教室外のグループなど：部屋を選べる種類で、部屋の代わりに「教室外」を選んだ予定
const isOutside = e => !!TYPES[e.type].outside && !(e.rooms && e.rooms.length);
// 部屋の欄に出す文字。教室外なら場所を添える
const whereText = e => isOutside(e) ? '教室外' + (e.place ? '（' + e.place + '）' : '') : roomsText(e.rooms);

const sName = id => (SMAP.get(id) || { name: '' }).name;
// グループの予定の名前：グループシートの今の名前。見つからなければ、入れたときの名前
const gName = e => (GMAP.get(e.groupId) || { name: '' }).name || e.group || 'グループ';

/* ===== 重なりの判定 ===== */
// 45分のレッスンは1時間の枠を押さえる（枠は30分単位に切り上げる）
const endOf = e => e.start + Math.ceil(e.len / SLOT) * SLOT;
function overlap(a, b) { return a.date === b.date && a.start < endOf(b) && b.start < endOf(a); }
function conflictsOf(ev, ignore, map) {
  const out = [], list = (map || byDate).get(ev.date) || [];
  for (const o of list) {
    if (o === ev || (o.id && o.id === ev.id) || o.status === 'cancel' || (ignore && ignore.has(o.id))) continue;
    if (!overlap(ev, o)) continue;
    const rs = (ev.rooms || []).filter(r => (o.rooms || []).includes(r));
    const ts = tOf(ev).filter(t => tOf(o).includes(t));
    if (rs.length) out.push({ kind: 'room', o, rs });
    if (ts.length) out.push({ kind: 'teacher', o, ts });
    if (!rs.length && !ts.length && ev.studentId && ev.studentId === o.studentId) out.push({ kind: 'student', o, warn: true });
  }
  return out;
}
const hard = cs => cs.filter(c => !c.warn);
// その日の「教室の休み」の名前（なければ空）
const closedName = d => { const e = (byDate.get(d) || []).find(x => x.type === 'closed' && x.status !== 'cancel'); return e ? e.title || '教室の休み' : ''; };
// 祝日か教室の休みなら、日付を赤くする
const isRedDay = d => dow(d) === 0 || !!holidayName(d) || !!closedName(d);

/* ===== 予定 ===== */
// S.events：読み込んだ予定。byDate：日付ごとの一覧（ぶつかりの判定と表示に使う）
const S = { events: [] };
let byDate = new Map();
function reindex() {
  byDate = new Map();
  for (const e of S.events) { if (!byDate.has(e.date)) byDate.set(e.date, []); byDate.get(e.date).push(e); }
}
// 期間（from〜to）の予定を、読み込んだもので置き換える
function setEvents(list, from, to) {
  S.events = S.events.filter(e => e.date < from || e.date > to);
  mergeEvents(list);
}
// 予定を足す・置き換える（同じ予約IDは新しいほう）。removed は消えた予約ID
function mergeEvents(list, removed) {
  const drop = new Set([...(list || []).map(e => e.id), ...(removed || [])]);
  S.events = S.events.filter(e => !drop.has(e.id)).concat(list || []);
  reindex();
}
const getEv = id => S.events.find(e => e.id === id);

/* ===== 表示用の文字 ===== */
function evTitle(e) {
  if (e.type === 'lesson') return sName(e.studentId) || '（生徒未定）';
  if (e.type === 'group') return gName(e);
  if (e.type === 'trial') return e.title ? `体験 ${e.title}` : '体験';
  if (e.type === 'spractice') return sName(e.studentId) || '（生徒未定）';
  if (e.type === 'out') return e.place || '教室外';
  if (e.type === 'absent') return '不在';
  return e.title || TYPES[e.type].label;
}
function evWho(e) {
  const ts = tOf(e);
  if (e.type === 'spractice') return '練習';
  if (TYPES[e.type].teachers === 'mainsub') return ts.length ? tName(ts[0]) + (ts.length > 1 ? ' / 伴 ' + ts.slice(1).map(tName).join('・') : '') : '先生未定';
  return ts.map(tName).join('・');
}
const evTime = e => e.allDay ? '終日' : `${hm(e.start)}–${hm(e.start + e.len)}`;
function teacherStyle(e) {
  if (e.type === 'spractice') return '--c:var(--ev-spr);--cf:var(--ev-spr-f);';
  if (!['lesson', 'group', 'trial', 'practice'].includes(e.type)) return '';
  const t = TMAP.get(tOf(e)[0]);
  return t ? `--c:${t.bg};--cf:${t.fg};` : '';
}
function shortTitle(e) {
  if (e.type === 'lesson') return sName(e.studentId).split('　')[0] || '？';
  if (e.type === 'group') return gName(e);
  if (e.type === 'trial') return '体験';
  if (e.type === 'spractice') return sName(e.studentId).split('　')[0] || '？';
  return evTitle(e);
}

/* ===== 月の全部屋（操作用の「月」と掲示で共通） ===== */
const legend = () => `<span class="mleg">${activeTeachers().map(t => `<span style="--c:${t.bg};--cf:${t.fg}">${esc(t.name)}</span>`).join('')}</span>`;
// 週（日曜の日付）の並びを、日ごとの枠で描く。dim(d) が真の日は薄くする
// noNow：現在時刻の線を引かない（掲示）
function monthGrid(weeks, dim, fold, style, key, noNow) {
  const R = ROOMS.length;
  // 2列：1日を9〜15時と15〜21時に分けて横に並べ、縦の長さを半分にする
  const C = fold ? 2 * R : R, NS = fold ? NSLOT / 2 : NSLOT;
  // 2列は最小幅を小さくして、横幅1200px程度の画面でも横スクロールなしで収める（広い画面では列が広がって名字が全部見える）
  const mcol = fold ? 16 : 26, mcolSun = fold ? 6 : 14;
  let h = `<div class="mwrap" data-k="${key}" style="--mhd:14px;--mg:14px;--mcol:${mcol}px;--mcolsun:${mcolSun}px;${style}">`;
  // 時刻の目盛り（0が日曜）。1列：日・月・水・金の前に置く。
  // 2列：日・月・水・金の左に9〜14時、日・火・木・土の右に15〜20時を置き、目盛りをその時間の列の隣にする
  const seq = fold ? ['L', 0, 'R', 'L', 1, 2, 'R', 'L', 3, 4, 'R', 'L', 5, 6, 'R'] : ['G', 0, 'G', 1, 2, 'G', 3, 4, 'G', 5, 6];
  const nGut = seq.filter(x => typeof x === 'string').length;
  // 日の列は最小幅（列数×--mcol）を守りつつ、画面の幅いっぱいに広げる。日曜はレッスンが少ないので細くする
  const cols = seq.map(x => typeof x === 'string' ? 'var(--mg)' : x === 0 ? `minmax(calc(${C} * var(--mcolsun)), .45fr)` : `minmax(calc(${C} * var(--mcol)), 1fr)`);
  const minW = `calc(${nGut} * var(--mg) + ${6 * C} * var(--mcol) + ${C} * var(--mcolsun) + 33px)`;
  const gutter = kind => {
    let g = `<div class="mgut${kind === 'R' ? ' gr' : ''}" style="grid-template-rows:var(--mhd) repeat(${NS},var(--mrow))">`;
    for (let s = 0; s < NS; s += 2) g += `<div style="grid-row:${s + 2}">${DAY_START / 60 + s / 2 + (kind === 'R' ? NS / 2 : 0)}</div>`;
    return g + `</div>`;
  };
  for (const ws of weeks) {
    h += `<div class="mweek" style="grid-template-columns:${cols.join(' ')};min-width:${minW}">`;
    seq.forEach((x, k) => {
      if (typeof x === 'string') { h += gutter(x); return; }
      const d = addDays(ws, x);
      // 目盛りのすぐ右の日は、目盛りと一続きに見せるため左の線を引かない
      h += monthDay(d, R, dim(d), fold, k > 0 && typeof seq[k - 1] === 'string', noNow);
    });
    h += `</div>`;
  }
  return h + `</div>`;
}
// 前後の月の日も、薄くして予定を出す
function monthDay(d, R, out, fold, noLine, noNow) {
  const C = fold ? 2 * R : R, NS = fold ? NSLOT / 2 : NSLOT, MID = DAY_START + NS * SLOT;
  const list = (byDate.get(d) || []).filter(e => e.status !== 'cancel');
  const ex = list.filter(e => e.allDay || !(e.rooms && e.rooms.length)).sort((a, b) => a.start - b.start).map(e => {
    const who = tOf(e).map(tName).join('・');
    return e.type === 'absent' ? `不在:${who}${e.allDay ? '' : '〜' + hm(e.start + e.len)}` : e.type === 'out' ? `外:${who}` : isOutside(e) ? `外:${evTitle(e)}` : evTitle(e);
  });
  if (holidayName(d)) ex.unshift(holidayName(d));
  let h = `<div class="mday${noLine ? ' nl' : ''}${out ? ' out' : ''}${d === today() ? ' today' : ''}${dow(d) === 0 ? ' sun' : ''}${isRedDay(d) ? ' red' : ''}" style="grid-template-columns:repeat(${C},minmax(0,1fr));grid-template-rows:var(--mhd) repeat(${NS},var(--mrow))">`;
  h += `<div class="mhd" style="grid-column:1/-1" data-act="gotoDay" data-d="${d}" title="${esc(ex.join(' / '))}"><b>${out ? pd(d).getMonth() + 1 + '/' : ''}${pd(d).getDate()}</b>${WD[dow(d)]}<span class="ex">${esc(ex.join(' / '))}</span></div>`;
  h += `<div class="mbody" style="grid-column:1/-1;grid-row:2/-1;background-size:calc(100% / ${C}) 100%,100% calc(var(--mrow) * 2)"></div>`;
  if (fold) h += `<div class="mhalf" style="grid-column:${R + 1}/-1;grid-row:2/-1"></div>`;
  if (d === today() && !noNow) {
    const n = new Date(), m = n.getHours() * 60 + n.getMinutes();
    if (m >= DAY_START && m < DAY_END) {
      const right = fold && m >= MID, base = right ? MID : DAY_START, s = Math.floor((m - base) / SLOT);
      h += `<div class="mnow" style="grid-column:${right ? R + 1 : 1}/span ${R};grid-row:${s + 2};top:calc(var(--mrow) * ${(((m - base) % SLOT) / SLOT).toFixed(3)})"></div>`;
    }
  }
  for (const e of list) {
    if (!e.rooms || !e.rooms.length) continue;
    const idx = e.rooms.map(r => ROOMS.findIndex(x => x.id === r)).filter(x => x >= 0).sort((a, b) => a - b);
    const s0 = Math.max(e.start, DAY_START), s1 = Math.min(endOf(e), DAY_END);
    if (s1 <= s0 || !idx.length) continue;
    const tip = `${md(d)} ${evTime(e)} ${roomsText(e.rooms)} ${evTitle(e)}（${evWho(e)}）`;
    // 2列のときは、15時をまたぐ予定を左右に分けて置く
    const segs = !fold ? [[s0, s1, 0, DAY_START]] : [[s0, Math.min(s1, MID), 0, DAY_START], [Math.max(s0, MID), s1, R, MID]].filter(([a, b]) => b > a);
    for (const [a0, a1, off, base] of segs) {
      let a = idx[0];
      for (let k = 1; k <= idx.length; k++) {
        if (k === idx.length || idx[k] !== idx[k - 1] + 1) {
          h += `<div class="mev t-${e.type}" data-ev="${e.id}" title="${esc(tip)}" style="grid-column:${off + a + 1}/${off + idx[k - 1] + 2};grid-row:${(a0 - base) / SLOT + 2}/span ${(a1 - a0) / SLOT};${teacherStyle(e)}">${esc(shortTitle(e))}</div>`;
          a = idx[k];
        }
      }
    }
  }
  return h + `</div>`;
}

