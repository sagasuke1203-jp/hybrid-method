// 豆の味の傾向を計算する。画面からは独立した純粋な関数だけを置く。
// ブラウザでは window.Taste、node では require('./taste.js') で使う。
//
// 計算: 最終値 = 基本値 + 品種の補正 + 精製方法の補正 + 焙煎度の補正 → 1〜5 に収める
//   基本値: 産地を選んでいればその産地の値。産地がなく地域だけなら地域の国の平均。どちらもなければすべて3。
//   選んでいない項目や、データにない id は補正なしとして扱う。
// 値はすべて data/coffee/*.json にある。数値を直すときは JSON だけ書き換えればよい。
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Taste = api;
})(this, function () {
  'use strict';

  var KEYS = ['acidity', 'sweetness', 'body', 'aroma', 'bitterness'];
  var NAMES = { acidity: '酸味', sweetness: '甘み', body: 'コク', aroma: '香り', bitterness: '苦味' };
  var MIN = 1, MAX = 5;
  var NEUTRAL = { acidity: 3, sweetness: 3, body: 3, aroma: 3, bitterness: 3 };
  var FILES = { regions: 'regions.json', origins: 'origins.json', varieties: 'varieties.json', processes: 'processes.json', roasts: 'roasts.json' };
  // 補正を持つ項目と、data のどのリストを見るか
  var DELTA_AXES = { variety: 'varieties', process: 'processes', roast: 'roasts' };

  function clamp(x) { return Math.min(MAX, Math.max(MIN, x)); }
  function round1(x) { return Math.round(x * 10) / 10; }

  function findById(list, id) {
    if (!id || !list) return null;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  // 地域に入っている国の基本値の平均(小数1桁)。国が1つも見つからなければ null
  function regionAverage(region, origins) {
    var found = (region.origins || []).map(function (id) { return findById(origins, id); }).filter(Boolean);
    if (!found.length) return null;
    var out = {};
    KEYS.forEach(function (k) {
      out[k] = round1(found.reduce(function (s, o) { return s + o.base[k]; }, 0) / found.length);
    });
    return out;
  }

  // 補正を足す前の値
  function baseFor(sel, data) {
    var o = findById(data.origins, sel.origin);
    if (o) return copy(o.base);
    var r = findById(data.regions, sel.region);
    var avg = r && regionAverage(r, data.origins);
    return avg || copy(NEUTRAL);
  }

  function compose(sel, data) {
    sel = sel || {};
    var out = baseFor(sel, data);
    Object.keys(DELTA_AXES).forEach(function (axis) {
      var it = findById(data[DELTA_AXES[axis]], sel[axis]);
      if (!it) return;
      KEYS.forEach(function (k) { out[k] += it.delta[k]; });
    });
    KEYS.forEach(function (k) { out[k] = clamp(round1(out[k])); });
    return out;
  }

  function copy(v) { var o = {}; KEYS.forEach(function (k) { o[k] = v[k]; }); return o; }

  // 選んだ産地(なければ地域の国すべて)。どちらもなければ null
  function originsInScope(sel, data) {
    var o = findById(data.origins, sel.origin);
    if (o) return [o];
    var r = findById(data.regions, sel.region);
    if (!r) return null;
    return (r.origins || []).map(function (id) { return findById(data.origins, id); }).filter(Boolean);
  }

  // 品種(axis='variety')や精製方法(axis='process')を、その産地でよく見かけるものと、それ以外に分ける。
  //   品種: origins.json の varieties に載っているものがよく見かけるもの
  //   精製: processes.json の onlyIn がなければどこでも見かける。あればその国だけ
  //   産地も地域も選んでいなければ、すべてよく見かけるものとして扱う
  function splitCommon(axis, sel, data) {
    sel = sel || {};
    var list = data[axis === 'variety' ? 'varieties' : 'processes'] || [];
    var scope = originsInScope(sel, data);
    if (!scope) return { common: list.slice(), other: [] };
    var ok = {};
    scope.forEach(function (o) {
      if (axis === 'variety') (o.varieties || []).forEach(function (id) { ok[id] = true; });
      else ok[o.id] = true;
    });
    var out = { common: [], other: [] };
    list.forEach(function (it) {
      var common = axis === 'variety' ? !!ok[it.id]
        : !it.onlyIn || it.onlyIn.some(function (id) { return ok[id]; });
      out[common ? 'common' : 'other'].push(it);
    });
    return out;
  }

  // 選んだ品種・精製方法のうち、その産地ではあまり見かけないもの
  function unusual(sel, data) {
    sel = sel || {};
    var res = [];
    ['variety', 'process'].forEach(function (axis) {
      if (!sel[axis]) return;
      var other = splitCommon(axis, sel, data).other;
      if (other.some(function (it) { return it.id === sel[axis]; })) res.push(axis);
    });
    return res;
  }

  // JSON を手で直したときの書き間違いを見つける。問題がなければ空の配列
  function validate(data) {
    var errs = [];
    function checkTaste(file, item, field, lo, hi) {
      var t = item[field];
      if (!t || typeof t !== 'object') { errs.push(file + ' の ' + item.id + ' に ' + field + ' がない'); return; }
      KEYS.forEach(function (k) {
        if (typeof t[k] !== 'number' || isNaN(t[k])) errs.push(file + ' の ' + item.id + ' の ' + field + '.' + k + ' が数値でない');
        else if (t[k] < lo || t[k] > hi) errs.push(file + ' の ' + item.id + ' の ' + field + '.' + k + ' が ' + lo + '〜' + hi + ' の外 (' + t[k] + ')');
      });
    }
    Object.keys(FILES).forEach(function (key) {
      var file = FILES[key], list = data[key];
      if (!Array.isArray(list)) { errs.push(file + ' が配列になっていない'); return; }
      var seen = {};
      list.forEach(function (item, i) {
        if (!item || typeof item.id !== 'string' || !item.id) { errs.push(file + ' の ' + (i + 1) + '件目に id がない'); return; }
        if (seen[item.id]) errs.push(file + ' の id ' + item.id + ' が重複している');
        seen[item.id] = true;
        if (typeof item.name !== 'string' || !item.name) errs.push(file + ' の ' + item.id + ' に name がない');
        if (key === 'origins') checkTaste(file, item, 'base', MIN, MAX);
        else if (key !== 'regions') checkTaste(file, item, 'delta', -(MAX - MIN), MAX - MIN);
      });
    });
    if (Array.isArray(data.regions) && Array.isArray(data.origins)) {
      var owner = {};
      data.regions.forEach(function (r) {
        if (!Array.isArray(r.origins)) { errs.push(FILES.regions + ' の ' + r.id + ' に origins の配列がない'); return; }
        r.origins.forEach(function (id) {
          if (!findById(data.origins, id)) errs.push(FILES.regions + ' の ' + r.id + ' にある ' + id + ' が origins.json にない');
          if (owner[id]) errs.push(id + ' が ' + owner[id] + ' と ' + r.id + ' の両方に入っている');
          owner[id] = r.id;
        });
      });
      data.origins.forEach(function (o) {
        if (o && o.id && !owner[o.id]) errs.push(o.id + ' がどの地域にも入っていない');
      });
    }
    // よく見かける品種(origins.json の varieties)と、精製方法の onlyIn は省略できる。書くなら実在する id で
    if (Array.isArray(data.origins) && Array.isArray(data.varieties)) {
      data.origins.forEach(function (o) {
        if (!o || o.varieties === undefined) return;
        if (!Array.isArray(o.varieties)) { errs.push(FILES.origins + ' の ' + o.id + ' の varieties が配列でない'); return; }
        o.varieties.forEach(function (id) {
          if (!findById(data.varieties, id)) errs.push(FILES.origins + ' の ' + o.id + ' にある品種 ' + id + ' が varieties.json にない');
        });
      });
    }
    if (Array.isArray(data.processes) && Array.isArray(data.origins)) {
      data.processes.forEach(function (p) {
        if (!p || p.onlyIn === undefined) return;
        if (!Array.isArray(p.onlyIn)) { errs.push(FILES.processes + ' の ' + p.id + ' の onlyIn が配列でない'); return; }
        p.onlyIn.forEach(function (id) {
          if (!findById(data.origins, id)) errs.push(FILES.processes + ' の ' + p.id + ' にある産地 ' + id + ' が origins.json にない');
        });
      });
    }
    return errs;
  }

  return {
    KEYS: KEYS, NAMES: NAMES, NEUTRAL: NEUTRAL, FILES: FILES,
    clamp: clamp, findById: findById, regionAverage: regionAverage,
    baseFor: baseFor, compose: compose, validate: validate,
    splitCommon: splitCommon, unusual: unusual
  };
});
