// 実行: node --test tests/grind.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const G = require('../js/grind.js');

const DIR = path.join(__dirname, '..', 'data', 'coffee');
const load = (f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
const grinders = load(G.FILES.grinders);
const cals = load(G.FILES.calibrations);
const g = (id) => grinders.find((x) => x.id === id);
const own = cals.filter((c) => c.source !== 'public'); // 自分の実測だけ

// index.html の RECIPES の grindUm と同じ値
const UM = { hybrid: 710, m46: 820, sw1: 710, mugen: 710, jbrc26: 1200, yamaguchi: 760, iced46: 710, cold: 1200 };
const RECIPE_IDS = Object.keys(UM);

test('同梱の JSON に書き間違いがない', () => {
  assert.deepEqual(G.validate({ grinders, calibrations: cals }, RECIPE_IDS), []);
});

test('手持ちのミルはナイスカットGと C3s', () => {
  assert.deepEqual(grinders.filter((x) => x.owned).map((x) => x.id), ['kalita-nicecut-g', 'timemore-c3s']);
});

test('実測があればそのまま出す', () => {
  assert.deepEqual(G.settingFor('hybrid', g('kalita-nicecut-g'), cals, UM), { kind: 'measured', value: 4, note: '標準より一目盛り粗め。基準の設定' });
  assert.equal(G.settingFor('yamaguchi', g('timemore-c3s'), cals, UM).value, 20);
});

test('換算式を持つミルは、レシピの粒の大きさから換算する', () => {
  assert.deepEqual(G.settingFor('hybrid', g('timemore-c3s'), cals, UM), { kind: 'converted', value: 19, um: 710, warn: null });
  assert.deepEqual(G.settingFor('yamaguchi', g('kalita-nicecut-g'), cals, UM), { kind: 'converted', value: 4.5, um: 760, warn: null });
  assert.equal(G.settingFor('m46', g('timemore-c3s'), cals, UM).value, 22);
  assert.equal(G.settingFor('m46', g('kalita-nicecut-g'), cals, UM).value, 5);
  assert.equal(G.settingFor('m46', g('comandante-c40'), cals, UM).value, 30);
});

test('実測と換算は同じ式でつながっている', () => {
  // ハイブリッドの ナイスカットG 4 と、山口スペシャルの C3s 20 を µm にすると grindUm とほぼ同じ
  assert.equal(G.umFromSetting(g('kalita-nicecut-g'), 4), 708);
  assert.equal(G.umFromSetting(g('timemore-c3s'), 20), 760);
  assert.equal(G.umFromSetting(g('comandante-c40'), 30), 817.5);
});

test('C3s で出せない粗さは上限と注意', () => {
  assert.deepEqual(G.settingFor('cold', g('timemore-c3s'), cals, UM), { kind: 'converted', value: 25, um: 1200, warn: 'coarse' });
  assert.equal(G.settingFor('cold', g('kalita-nicecut-g'), cals, UM).value, 7.5);
});

test('自分の実測は換算より優先する', () => {
  const mine = cals.concat([{ recipeId: 'hybrid', grinderId: 'timemore-c3s', setting: 17, source: 'own' }]);
  assert.equal(G.settingFor('hybrid', g('timemore-c3s'), mine, UM).kind, 'measured');
  assert.equal(G.settingFor('hybrid', g('timemore-c3s'), mine, UM).value, 17);
});

// 換算式のないミル(C3 ESP Pro など)での動き
test('換算式のないミルは、公開の目安 → 同じミルの実測からの差 → 粗い目安の順', () => {
  const esp = g('timemore-c3-esp-pro');
  const pub = [{ recipeId: 'hybrid', grinderId: esp.id, setting: 33, source: 'public', note: 'x' }];
  assert.deepEqual(G.settingFor('hybrid', esp, pub, UM), { kind: 'reference', value: 33, note: 'x' });
  const mine = [{ recipeId: 'hybrid', grinderId: esp.id, setting: 30, source: 'own' }];
  assert.deepEqual(G.settingFor('m46', esp, mine, UM), { kind: 'relative', value: 35, from: 'hybrid' });   // 30 + 120/23.3 = 35.2
  const two = mine.concat([{ recipeId: 'jbrc26', grinderId: esp.id, setting: 50 }]);
  assert.deepEqual(G.settingFor('cold', esp, two, UM), { kind: 'relative', value: 50, from: 'jbrc26' });  // µm の近い実測を基準にする
  assert.deepEqual(G.settingFor('hybrid', esp, [], UM), { kind: 'rough', value: 30 });                     // 710/23.3
  assert.deepEqual(G.settingFor('hybrid', g('timemore-c5-pro'), [], UM), { kind: 'rough', value: 26 });   // 3 + 710/31
});

test('µm が分からないときは未校正', () => {
  assert.deepEqual(G.settingFor('unknown', g('timemore-c3s'), cals, UM), { kind: 'uncalibrated' });
  assert.deepEqual(G.settingFor('hybrid', g('timemore-c2'), [], UM), { kind: 'uncalibrated' });
});

test('ダイヤル式は 0.5 刻みに丸め、目盛りの範囲に収める', () => {
  const n = g('kalita-nicecut-g');
  assert.equal(G.snap(n, 3.3), 3.5);
  assert.equal(G.snap(n, 9.2), 8);
  assert.equal(G.snap(n, 0.2), 1);
  assert.equal(G.snap(g('timemore-c3s'), -3), 0);
});

test('換算: 粒の大きさ ⇄ 設定(比較表と同じ値)', () => {
  const cmd = g('comandante-c40'), nc = g('kalita-nicecut-g'), c3 = g('timemore-c3s');
  assert.equal(G.umFromSetting(cmd, 25), 681.25);
  assert.deepEqual(G.settingFromUm(nc, G.umFromSetting(cmd, 25)), { value: 4, warn: null });
  assert.deepEqual(G.settingFromUm(c3, G.umFromSetting(cmd, 25)), { value: 18, warn: null });
  const um20 = G.umFromSetting(c3, 20);                                    // 760
  assert.deepEqual(G.settingFromUm(cmd, um20), { value: 28, warn: null });
  assert.deepEqual(G.settingFromUm(nc, um20), { value: 4.5, warn: null });
});

test('換算: 範囲の外は端の値と注意を返す', () => {
  const cmd = g('comandante-c40'), nc = g('kalita-nicecut-g'), c3 = g('timemore-c3s');
  assert.deepEqual(G.settingFromUm(c3, G.umFromSetting(cmd, 40)), { value: 25, warn: 'coarse' });
  assert.deepEqual(G.settingFromUm(nc, G.umFromSetting(cmd, 5)), { value: 1, warn: 'fine' });
  assert.equal(G.settingFromUm(c3, G.umFromSetting(cmd, 7)).warn, 'unsafe');
  assert.deepEqual(G.rangeOf(nc), { min: 1, max: 8, step: 0.5 });
  assert.deepEqual(G.rangeOf(c3), { min: 1, max: 25, step: 1 });
});

test('換算の式を持つミルはコマンダンテ・ナイスカットG・C3s・Varia VS3', () => {
  assert.deepEqual(grinders.filter((x) => x.scale).map((x) => x.id).sort(), ['comandante-c40', 'kalita-nicecut-g', 'timemore-c3s', 'varia-vs3-gen2']);
});

test('Varia VS3 は 0.5 刻みの目盛りで、0 より細かくできない', () => {
  const v = g('varia-vs3-gen2');
  assert.deepEqual(G.rangeOf(v), { min: 0, max: 19.5, step: 0.5 });
  assert.deepEqual(G.settingFromUm(v, G.umFromSetting(g('comandante-c40'), 25)), { value: 8, warn: null });   // 681µm
  assert.deepEqual(G.settingFromUm(v, G.umFromSetting(g('timemore-c3s'), 20)), { value: 9.5, warn: null });  // 760µm
  assert.deepEqual(G.settingFromUm(v, 100), { value: 0, warn: 'fine' });
  assert.equal(G.settingFor('hybrid', v, cals, UM).value, 8.5);                                                // 710µm
});

test('validate は書き間違いを見つける', () => {
  const bad = JSON.parse(JSON.stringify({ grinders, calibrations: cals }));
  bad.grinders[1].umPerStep = -5;
  bad.grinders[2].scale = { a: 0 };
  bad.grinders.push({ id: 'timemore-c3s', name: 'dup', unit: 'click' });
  bad.calibrations.push({ recipeId: 'hybrid', grinderId: 'comandante', setting: 25 });
  bad.calibrations.push({ recipeId: 'latte', grinderId: 'timemore-c3s', setting: 10 });
  bad.calibrations.push({ recipeId: 'hybrid', grinderId: 'kalita-nicecut-g', setting: 9 });
  bad.calibrations.push({ recipeId: 'hybrid', grinderId: 'kalita-nicecut-g', setting: 4, source: 'blog' });
  const errs = G.validate(bad, RECIPE_IDS).join('\n');
  assert.match(errs, /umPerStep は正の数か null/);
  assert.match(errs, /scale は/);
  assert.match(errs, /id timemore-c3s が重複/);
  assert.match(errs, /ミル comandante が grinders\.json にない/);
  assert.match(errs, /レシピ latte がアプリにない/);
  assert.match(errs, /setting が目盛りの範囲外/);
  assert.match(errs, /source は own か public/);
  assert.ok(G.validate({}, RECIPE_IDS).length > 0);
});
