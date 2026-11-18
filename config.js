// レッスン予約の画面の設定（公開してよい値だけを書く。掲示の合言葉はここに書かない）
// apiUrl  : Apps Script のウェブアプリのURL（デプロイで出る …/exec）
// clientId: Google Cloud で作った OAuth クライアントID（…apps.googleusercontent.com）
// localhost から開いたとき（booking/serve.sh）は、テスト用の API（レッスン予約（テスト））を使う
(() => {
  const test = location.hostname === 'localhost';
  window.MENUET_CONFIG = {
    apiUrl: test
      ? 'https://script.google.com/macros/s/AKfycbyJzBU4idA93hg-2pI7MW-ByZx54m02bZ4Bj_tVbjcg7YoGY4h_L-Zsa1bVoGXudZIBrw/exec'
      : 'https://script.google.com/macros/s/AKfycbz2Bc_UaMPzIDtkP-xUvrarv00_DU7bbbVwlF7Z4WhWUm23ejTA9Lx6oCaUmTshHBQ/exec',
    clientId: '350722720643-pmu5eqevgif80haei9g3mjsfjcq6hsi3.apps.googleusercontent.com',
    test,
  };
  // テストのときは、画面の上に「テスト環境」の帯を出し、タブの名前に【テスト】を付けて、本番と見分けられるようにする
  if (test) addEventListener('DOMContentLoaded', () => {
    document.title = '【テスト】' + document.title;
    const b = document.createElement('div');
    b.textContent = 'テスト環境（本番の予定ではありません）';
    b.style.cssText = 'position:fixed;top:0;left:50%;transform:translateX(-50%);z-index:9999;pointer-events:none;' +
      'background:#c62828;color:#fff;font:700 12px/1 sans-serif;padding:3px 12px;border-radius:0 0 8px 8px;opacity:.9';
    document.body.appendChild(b);
  });
})();
