// ミルの設定値の換算。画面からは独立した純粋な関数だけを置く。
// ブラウザでは window.Grind、node では require('./grind.js') で使う。
//
// 出す順番(上ほど優先):
//   1. measured     そのレシピ・そのミルの自分の実測(calibrations.json の source が "own" か省略)
//   2. reference    公開情報から決めた目安(calibrations.json の source が "public")
//   3. relative     同じミルのほかのレシピの自分の実測から、レシピの µm の差 ÷ 1目盛りの µm で目安を出す
//   4. rough        実測がないとき、レシピの µm ÷ 1目盛りの µm(最細設定があればそこから)。かなり粗い目安
//   5. uncalibrated 1目盛りの µm が分からず、使える実測もない
// 1目盛りの µm は刃の移動量で、粉の粒の大きさそのものではない。どれも目安。
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Grind = api;
})(this, function () {
  'use strict';

  var FILES = { grinders: 'grinders.json', calibrations: 'calibrations.json' };

  function stepOf(g) { return g.unit === 'dial' ? ((g.dial && g.dial.step) || 0.5) : 1; }

  // ミルの目盛りに合わせて丸め、ダイヤル式は範囲内に収める
  function snap(g, x) {
    var st = stepOf(g);
    var v = Math.round(x / st) * st;
    if (g.unit === 'dial' && g.dial) v = Math.min(g.dial.max, Math.max(g.dial.min, v));
    else v = Math.max(g.finestSetting || 0, v);
    return Math.round(v * 10) / 10;
  }

  // recipeUm: { レシピID: µm } 。µm のないレシピは入れないか null
  function settingFor(recipeId, grinder, calibrations, recipeUm) {
    var all = (calibrations || []).filter(function (c) { return c.grinderId === grinder.id; });
    var cals = all.filter(function (c) { return c.source !== 'public'; });   // 自分の実測だけ
    var exact = cals.filter(function (c) { return c.recipeId === recipeId; })[0];
    if (exact) return { kind: 'measured', value: exact.setting, note: exact.note || '' };
    var ref = all.filter(function (c) { return c.source === 'public' && c.recipeId === recipeId; })[0];
    if (ref) return { kind: 'reference', value: ref.setting, note: ref.note || '' };

    var um = recipeUm && recipeUm[recipeId];
    var per = grinder.umPerStep;
    if (!um || !per) return { kind: 'uncalibrated' };

    // µm が近い実測ほど誤差が小さいので、いちばん近いものを使う
    var base = null;
    cals.forEach(function (c) {
      var cu = recipeUm[c.recipeId];
      if (!cu) return;
      if (!base || Math.abs(cu - um) < Math.abs(base.um - um)) base = { cal: c, um: cu };
    });
    if (base) {
      return { kind: 'relative', value: snap(grinder, base.cal.setting + (um - base.um) / per), from: base.cal.recipeId };
    }
    return { kind: 'rough', value: snap(grinder, (grinder.finestSetting || 0) + um / per) };
  }

  function validate(data, recipeIds) {
    var errs = [];
    var gs = data.grinders, cs = data.calibrations;
    if (!Array.isArray(gs)) errs.push(FILES.grinders + ' が配列になっていない');
    if (!Array.isArray(cs)) errs.push(FILES.calibrations + ' が配列になっていない');
    if (errs.length) return errs;
    var seen = {};
    gs.forEach(function (g, i) {
      if (!g || typeof g.id !== 'string' || !g.id) { errs.push(FILES.grinders + ' の ' + (i + 1) + '件目に id がない'); return; }
      if (seen[g.id]) errs.push(FILES.grinders + ' の id ' + g.id + ' が重複している');
      seen[g.id] = g;
      if (typeof g.name !== 'string' || !g.name) errs.push(FILES.grinders + ' の ' + g.id + ' に name がない');
      if (g.unit !== 'dial' && g.unit !== 'click') errs.push(FILES.grinders + ' の ' + g.id + ' の unit は dial か click');
      if (g.unit === 'dial' && !(g.dial && g.dial.min < g.dial.max && g.dial.step > 0)) errs.push(FILES.grinders + ' の ' + g.id + ' の dial の min/max/step がおかしい');
      if (g.umPerStep !== null && g.umPerStep !== undefined && !(typeof g.umPerStep === 'number' && g.umPerStep > 0)) errs.push(FILES.grinders + ' の ' + g.id + ' の umPerStep は正の数か null');
    });
    cs.forEach(function (c, i) {
      var where = FILES.calibrations + ' の ' + (i + 1) + '件目';
      if (!c || !seen[c.grinderId]) { errs.push(where + ' のミル ' + (c && c.grinderId) + ' が grinders.json にない'); return; }
      if (recipeIds && recipeIds.indexOf(c.recipeId) < 0) errs.push(where + ' のレシピ ' + c.recipeId + ' がアプリにない');
      if (typeof c.setting !== 'number' || isNaN(c.setting)) errs.push(where + ' の setting が数値でない');
      if (c.source !== undefined && c.source !== 'own' && c.source !== 'public') errs.push(where + ' の source は own か public');
      var g = seen[c.grinderId];
      if (g.unit === 'dial' && g.dial && typeof c.setting === 'number' && (c.setting < g.dial.min || c.setting > g.dial.max)) errs.push(where + ' の setting が目盛りの範囲外');
    });
    return errs;
  }

  return { FILES: FILES, snap: snap, settingFor: settingFor, validate: validate };
});
