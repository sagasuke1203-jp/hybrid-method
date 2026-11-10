// 実行: node --test tests/taste.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const T = require('../js/taste.js');

const DIR = path.join(__dirname, '..', 'data', 'coffee');
function loadData() {
  const d = {};
  for (const [key, file] of Object.entries(T.FILES)) d[key] = JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8'));
  return d;
}
const data = loadData();

test('同梱の JSON に書き間違いがない', () => {
  assert.deepEqual(T.validate(data), []);
});

test('件数: 産地17・地域4・品種18・精製8・焙煎3', () => {
  assert.equal(data.origins.length, 17);
  assert.equal(data.regions.length, 4);
  assert.equal(data.varieties.length, 18);
  assert.equal(data.processes.length, 8);
  assert.equal(data.roasts.length, 3);
});

test('どの産地にも、よく見かける品種が1つ以上ある', () => {
  for (const o of data.origins) assert.ok(o.varieties.length > 0, o.id);
});

const ids = (list) => list.map((x) => x.id);

test('産地を選ぶと、品種はよく見かけるものとそれ以外に分かれる', () => {
  const s = T.splitCommon('variety', { origin: 'kenya' }, data);
  assert.deepEqual(ids(s.common), ['sl28', 'sl34', 'batian']);
  assert.equal(s.common.length + s.other.length, data.varieties.length);
  assert.ok(ids(s.other).includes('geisha'));
});

test('地域だけなら、その地域の国でよく見かける品種をまとめる', () => {
  const s = T.splitCommon('variety', { region: 'africa' }, data);
  for (const id of ['heirloom', 'geisha', 'sl28', 'sl34', 'batian', 'bourbon', 'yemenia']) assert.ok(ids(s.common).includes(id), id);
  assert.ok(ids(s.other).includes('castillo'));
});

test('産地も地域も選ばなければ、品種も精製もすべて表示', () => {
  assert.equal(T.splitCommon('variety', {}, data).other.length, 0);
  assert.equal(T.splitCommon('process', {}, data).other.length, 0);
});

test('スマトラ式はインドネシアだけ、パルプドナチュラルはブラジルだけでよく見かける', () => {
  const indo = ids(T.splitCommon('process', { origin: 'indonesia' }, data).common);
  assert.ok(indo.includes('wethulled') && !indo.includes('pulped') && indo.includes('washed'));
  const bra = ids(T.splitCommon('process', { origin: 'brazil' }, data).common);
  assert.ok(bra.includes('pulped') && !bra.includes('wethulled'));
  const asia = ids(T.splitCommon('process', { region: 'asia' }, data).common);
  assert.ok(asia.includes('wethulled'));
});

test('あまり見かけない組み合わせを見つける', () => {
  assert.deepEqual(T.unusual({ origin: 'kenya', variety: 'sl28', process: 'washed' }, data), []);
  assert.deepEqual(T.unusual({ origin: 'ethiopia', variety: 'castillo' }, data), ['variety']);
  assert.deepEqual(T.unusual({ origin: 'kenya', variety: 'castillo', process: 'wethulled' }, data), ['variety', 'process']);
  assert.deepEqual(T.unusual({ variety: 'castillo', process: 'wethulled' }, data), []);
});

test('珍しい品種でも味の計算はふつうにできる', () => {
  const r = T.compose({ origin: 'ethiopia', variety: 'castillo' }, data);
  assert.deepEqual(r, T.findById(data.origins, 'ethiopia').base);
});

test('clamp は 1〜5 に収める', () => {
  assert.equal(T.clamp(6), 5);
  assert.equal(T.clamp(0.5), 1);
  assert.equal(T.clamp(3.5), 3.5);
});

test('何も選ばなければすべて3', () => {
  assert.deepEqual(T.compose({}, data), T.NEUTRAL);
  assert.deepEqual(T.compose(undefined, data), T.NEUTRAL);
});

test('産地だけならその産地の基本値そのまま', () => {
  const eth = T.findById(data.origins, 'ethiopia');
  assert.deepEqual(T.compose({ origin: 'ethiopia' }, data), eth.base);
});

test('ウォッシュト・中煎りは補正なし', () => {
  const ken = T.findById(data.origins, 'kenya');
  assert.deepEqual(T.compose({ origin: 'kenya', process: 'washed', roast: 'medium' }, data), ken.base);
});

test('足し算と上限: ケニア + SL28 + 浅煎りで酸味は5に収まる', () => {
  const r = T.compose({ origin: 'kenya', variety: 'sl28', process: 'washed', roast: 'light' }, data);
  assert.equal(r.acidity, 5);          // 4.5 + 0.5 + 1 = 6 → 5
  assert.equal(r.aroma, 5);            // 4 + 0.5 + 0.5
  assert.equal(r.bitterness, 1);       // 2 - 1
  assert.equal(r.body, 2.5);           // 3 - 0.5
});

test('下限: ブラジル + 深煎りで酸味は1に収まる', () => {
  const r = T.compose({ origin: 'brazil', roast: 'dark' }, data);
  assert.equal(r.acidity, 1);          // 2 - 1.5 = 0.5 → 1
  assert.equal(r.bitterness, 4.5);     // 3 + 1.5
});

test('焙煎度を深くすると酸味は下がり、苦味とコクは上がる', () => {
  for (const o of data.origins) {
    const light = T.compose({ origin: o.id, roast: 'light' }, data);
    const medium = T.compose({ origin: o.id, roast: 'medium' }, data);
    const dark = T.compose({ origin: o.id, roast: 'dark' }, data);
    assert.ok(light.acidity >= medium.acidity && medium.acidity >= dark.acidity, o.id + ' acidity');
    assert.ok(light.bitterness <= medium.bitterness && medium.bitterness <= dark.bitterness, o.id + ' bitterness');
    assert.ok(light.body <= medium.body && medium.body <= dark.body, o.id + ' body');
  }
});

test('地域だけなら地域の国の平均(小数1桁)', () => {
  const r = T.compose({ region: 'south' }, data);
  // コロンビア3・ブラジル2・ペルー3・ボリビア3 の平均 2.75 → 2.8
  assert.equal(r.acidity, 2.8);
  const asia = T.compose({ region: 'asia' }, data);
  assert.deepEqual(asia, T.findById(data.origins, 'indonesia').base);
});

test('産地があれば地域より産地を優先する', () => {
  assert.deepEqual(T.compose({ region: 'south', origin: 'ethiopia' }, data), T.findById(data.origins, 'ethiopia').base);
});

test('データにない id は未選択と同じ扱いでエラーにならない', () => {
  assert.deepEqual(T.compose({ origin: 'mars', variety: 'xxx', process: null, roast: '' }, data), T.NEUTRAL);
  assert.deepEqual(T.compose({ region: 'nowhere', origin: 'kenya', roast: 'dark2' }, data), T.findById(data.origins, 'kenya').base);
});

test('計算しても元のデータは書き換わらない', () => {
  const before = JSON.stringify(data);
  T.compose({ origin: 'kenya', variety: 'geisha', process: 'natural', roast: 'dark' }, data);
  T.compose({ region: 'africa', roast: 'light' }, data);
  assert.equal(JSON.stringify(data), before);
});

test('validate は書き間違いを見つける', () => {
  const bad = loadData();
  bad.origins[0].base.acidity = 7;
  delete bad.varieties[0].delta.aroma;
  bad.roasts.push({ id: 'light', name: '浅煎り2', delta: { ...T.NEUTRAL } });
  bad.regions[0].origins.push('atlantis');
  bad.origins.push({ id: 'vietnam', name: 'ベトナム', base: { ...T.NEUTRAL } });
  bad.origins[1].varieties.push('robusta');
  bad.processes[3].onlyIn = ['japan'];
  const errs = T.validate(bad).join('\n');
  assert.match(errs, /kenya にある品種 robusta が varieties\.json にない/);
  assert.match(errs, /pulped にある産地 japan が origins\.json にない/);
  assert.match(errs, /ethiopia の base\.acidity が 1〜5 の外/);
  assert.match(errs, /geisha の delta\.aroma が数値でない/);
  assert.match(errs, /roasts\.json の id light が重複/);
  assert.match(errs, /atlantis が origins\.json にない/);
  assert.match(errs, /vietnam がどの地域にも入っていない/);
});

test('validate はファイルが壊れていても例外を出さない', () => {
  assert.ok(T.validate({}).length > 0);
  assert.ok(T.validate({ regions: [], origins: [null], varieties: 'x', processes: [], roasts: [] }).length > 0);
});
