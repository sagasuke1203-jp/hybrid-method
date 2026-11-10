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
const UM = { hybrid: 800, m46: 1000, sw1: 800, mugen: 800, jbrc26: 1200, yamaguchi: 1000, iced46: 800, cold: 1200 };
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

test('ナイスカットGはカリタ挽き3.5を基準にした目安を出す', () => {
  assert.deepEqual(['sw1', 'm46', 'jbrc26', 'cold'].map((id) => G.settingFor(id, g('kalita-nicecut-g'), cals, UM).value), [4, 5.5, 6.5, 7]);
  assert.equal(G.settingFor('m46', g('kalita-nicecut-g'), cals, UM).kind, 'reference');
});

test('公開情報からの目安があればそれを出す', () => {
  const h = G.settingFor('hybrid', g('timemore-c3s'), cals, UM);
  assert.equal(h.kind, 'reference');
  assert.equal(h.value, 16);
  assert.equal(G.settingFor('m46', g('timemore-c3s'), cals, UM).value, 21);
  assert.equal(G.settingFor('cold', g('timemore-c3s'), cals, UM).value, 24);
});

test('自分の実測は公開情報より優先する', () => {
  const mine = cals.concat([{ recipeId: 'hybrid', grinderId: 'timemore-c3s', setting: 17, source: 'own' }]);
  assert.equal(G.settingFor('hybrid', g('timemore-c3s'), mine, UM).kind, 'measured');
  assert.equal(G.settingFor('hybrid', g('timemore-c3s'), mine, UM).value, 17);
});

test('同じミルのほかの自分の実測から差で出す(公開情報は基準にしない)', () => {
  const h = G.settingFor('hybrid', g('timemore-c3s'), own, UM);
  assert.deepEqual(h, { kind: 'relative', value: 18, from: 'yamaguchi' });       // 20 - 200/83.3 = 17.6
  assert.equal(G.settingFor('jbrc26', g('timemore-c3s'), own, UM).value, 22);    // 20 + 200/83.3 = 22.4
});

test('µm の近い実測を基準にする', () => {
  const two = own.concat([{ recipeId: 'jbrc26', grinderId: 'timemore-c3s', setting: 30 }]);
  const r = G.settingFor('cold', g('timemore-c3s'), two, UM);
  assert.deepEqual(r, { kind: 'relative', value: 30, from: 'jbrc26' });
});

test('1目盛りの µm が分からないミルは、実測のないレシピで未校正', () => {
  assert.deepEqual(G.settingFor('m46', g('kalita-nicecut-g'), own, UM), { kind: 'uncalibrated' });
});

test('実測がないミルは µm ÷ 1クリックで粗い目安(最細設定があればそこから)', () => {
  assert.deepEqual(G.settingFor('hybrid', g('timemore-c3-esp-pro'), cals, UM), { kind: 'rough', value: 34 }); // 800/23.3
  assert.deepEqual(G.settingFor('hybrid', g('timemore-c5-pro'), cals, UM), { kind: 'rough', value: 29 });     // 3 + 800/31
});

test('µm のないレシピは未校正', () => {
  assert.deepEqual(G.settingFor('unknown', g('timemore-c3s'), cals, UM), { kind: 'uncalibrated' });
});

test('ダイヤル式は 0.5 刻みに丸め、目盛りの範囲に収める', () => {
  const n = g('kalita-nicecut-g');
  assert.equal(G.snap(n, 3.3), 3.5);
  assert.equal(G.snap(n, 9.2), 8);
  assert.equal(G.snap(n, 0.2), 1);
  assert.equal(G.snap(g('timemore-c3s'), -3), 0);
});

test('validate は書き間違いを見つける', () => {
  const bad = JSON.parse(JSON.stringify({ grinders, calibrations: cals }));
  bad.grinders[1].umPerStep = -5;
  bad.grinders.push({ id: 'timemore-c3s', name: 'dup', unit: 'click' });
  bad.calibrations.push({ recipeId: 'hybrid', grinderId: 'comandante', setting: 25 });
  bad.calibrations.push({ recipeId: 'latte', grinderId: 'timemore-c3s', setting: 10 });
  bad.calibrations.push({ recipeId: 'hybrid', grinderId: 'kalita-nicecut-g', setting: 9 });
  bad.calibrations.push({ recipeId: 'hybrid', grinderId: 'kalita-nicecut-g', setting: 4, source: 'blog' });
  const errs = G.validate(bad, RECIPE_IDS).join('\n');
  assert.match(errs, /umPerStep は正の数か null/);
  assert.match(errs, /id timemore-c3s が重複/);
  assert.match(errs, /ミル comandante が grinders\.json にない/);
  assert.match(errs, /レシピ latte がアプリにない/);
  assert.match(errs, /setting が目盛りの範囲外/);
  assert.match(errs, /source は own か public/);
  assert.ok(G.validate({}, RECIPE_IDS).length > 0);
});
