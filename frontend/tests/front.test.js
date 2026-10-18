/* Testes do front com o Chromium headless (Playwright) e dados SINTÉTICOS (frontend/tests/sintetico.py,
   gerados pelo próprio back-end). Rodar na raiz do repositório:

       node --test frontend/tests/front.test.js

   Precisa de Python 3 com as dependências do back-end e do Playwright (pacote "playwright" global ou local;
   o Chromium vem de PLAYWRIGHT_BROWSERS_PATH ou de /opt/pw-browsers/chromium). Sem eles os testes são pulados.
   Os arquivos são servidos por interceptação de requisições (sem servidor). */
'use strict';
const {test, before, after, describe} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync, execSync} = require('node:child_process');

const RAIZ = path.resolve(__dirname, '..', '..');
const FRONT = path.join(RAIZ, 'frontend');

function carregaPlaywright(){
  try { return require('playwright'); } catch(e) { /* tenta o global */ }
  try { return require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); } catch(e) { return null; }
}
const pw = carregaPlaywright();
const CHROMIUM = ['/opt/pw-browsers/chromium'].find(p => fs.existsSync(p));
const pular = !pw ? 'Playwright não instalado' : false;

let browser, tmp;
const DADOS = {};

before(async () => {
  if(pular) return;
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'drotas-'));
  for(const [nome, args] of [['normal', []], ['fech', ['--fechamento']]]){
    const dir = path.join(tmp, nome);
    execFileSync('python3', [path.join(FRONT, 'tests', 'sintetico.py'), dir, ...args], {cwd: RAIZ});
    DADOS[nome] = dir;
  }
  browser = await pw.chromium.launch(CHROMIUM ? {executablePath: CHROMIUM} : {});
});
after(async () => {
  if(browser) await browser.close();
  if(tmp) fs.rmSync(tmp, {recursive: true, force: true});
});

const TIPOS = {'.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json',
  '.png':'image/png', '.webmanifest':'application/manifest+json'};

/* Abre o painel com os dados `nome` ('normal' | 'fech'); devolve {page, erros}. `armazenado` = localStorage inicial. */
async function abre(nome, {armazenado = {}, largura = 1200} = {}){
  const ctx = await browser.newContext({viewport: {width: largura, height: 1000}});
  const page = await ctx.newPage();
  const erros = [];
  page.on('pageerror', e => erros.push(String(e)));
  page.on('console', m => { if(m.type() === 'error') erros.push(m.text()); });
  await page.route('http://painel.test/**', rota => {
    const url = new URL(rota.request().url());
    let arq = url.pathname.startsWith('/data/') ? path.join(DADOS[nome], url.pathname.slice(6))
                                                 : path.join(FRONT, url.pathname);
    if(!fs.existsSync(arq)) return rota.fulfill({status: 404, body: ''});
    rota.fulfill({status: 200, contentType: TIPOS[path.extname(arq)] || 'application/octet-stream',
                  body: fs.readFileSync(arq)});
  });
  // bibliotecas do PDF (CDN) não são usadas nos testes
  await page.route(/cdnjs\.cloudflare\.com/, r => r.abort());
  await page.addInitScript(itens => { try { for(const k in itens) localStorage.setItem(k, itens[k]); } catch(e){} },
                           armazenado);
  await page.goto('http://painel.test/index.html');
  // P é 'let' de script clássico: existe no escopo global, mas não em window
  await page.waitForFunction(() => typeof P !== 'undefined' && P && document.querySelector('#lista').innerHTML !== '');
  return {page, ctx, erros};
}
module.exports = {abre};

/* Seleciona gerência/supervisão/rota e aba e espera o render. */
async function filtra(page, {gc, sv = '', rota = '', aba} = {}){
  await page.evaluate(({gc, sv, rota, aba}) => {
    if(gc !== undefined) sel = {...sel, gc, sv, rota};
    if(aba){ document.querySelector(`.tab[data-g="${aba}"]`).click(); }
    render();
  }, {gc, sv, rota, aba});
}

describe('Parte B — Neutraliza, ocultas, AT e Del Valle Frut', {skip: pular}, () => {
  test('Neutraliza fora dos selects, somada no total da gerência', async () => {
    const {page, ctx, erros} = await abre('normal');
    await filtra(page, {gc: 'G1', aba: 'VOLUME'});
    const r = await page.evaluate(() => {
      const opSv = [...document.querySelectorAll('#fsv option')].map(o => o.value);
      const opRota = [...document.querySelectorAll('#frota option')].map(o => o.value);
      const k = 'VOL REFRIGERANTES';
      const total = agrega(rotasAtuais()).ind[k].meta;
      const soma = Object.values(DATA.G1).flatMap(s => Object.values(s)).reduce((a, d) => a + d.indicators[k].meta, 0);
      const visiveis = svsVisiveis('G1').flatMap(s => Object.keys(DATA.G1[s]));
      const semNeutra = agrega(visiveis).ind[k].meta;
      const neutra = DATA.G1['SV.G1.5']['151'].indicators[k].meta;
      return {opSv, opRota, total, soma, semNeutra, neutra, base: agrega(rotasAtuais()).tot.baseTotal,
              baseVis: visiveis.reduce((a, r) => a + nodo('G1', r).baseTotal, 0)};
    });
    assert.ok(!r.opSv.includes('SV.G1.5'));
    assert.ok(!r.opRota.includes('151'));
    assert.equal(r.total, r.soma);
    assert.ok(Math.abs(r.total - (r.semNeutra + r.neutra)) < 1e-6);
    assert.equal(r.base, r.baseVis, 'clientes da Neutraliza não contam na base');
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('Neutraliza e ocultas fora do "puxa a média" e do Resumo; AT mostra tudo', async () => {
    const {page, ctx, erros} = await abre('normal');
    const r = await page.evaluate(() => ({
      excl: ['SV.G1.5', 'SV.G2.5', 'SV.IT.3', 'SV.MO.3', 'SV.G3.3', 'SV.AT.3'].map(s => [s, svExcluido(s)]),
      at: svsVisiveis('AT'),
    }));
    assert.deepEqual(Object.fromEntries(r.excl), {'SV.G1.5': true, 'SV.G2.5': true, 'SV.IT.3': true, 'SV.MO.3': true,
                                                  'SV.G3.3': true, 'SV.AT.3': false});
    assert.deepEqual(r.at, ['SV.AT.1', 'SV.AT.2', 'SV.AT.3']);
    await filtra(page, {gc: 'G2'});
    await page.click('#btnResumo');
    const cols = await page.$$eval('#rsFolha .rs-tab thead th', ths => ths.map(t => t.textContent));
    assert.ok(cols.some(c => c.startsWith('GC.G2')));
    assert.ok(!cols.some(c => c.includes('SV.G2.5')), cols.join('|'));
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('Del Valle Frut só na G2 e fora das somas dos macros', async () => {
    const {page, ctx, erros} = await abre('normal');
    await filtra(page, {gc: 'G2', aba: 'VOLUME'});
    const g2 = await page.$$eval('#lista .ind .tit', t => t.map(x => x.textContent));
    assert.ok(g2.includes('Del Valle Frut'), g2.join('|'));
    await filtra(page, {gc: 'G1', aba: 'VOLUME'});
    const g1 = await page.$$eval('#lista .ind .tit', t => t.map(x => x.textContent));
    assert.ok(!g1.includes('Del Valle Frut'));
    // busca de cliente da G2 na aba Volume: 6º quadrinho
    await filtra(page, {gc: 'G2', aba: 'VOLUME'});
    const pv = await page.evaluate(() => CLIENT_ROSTER['G211'][0][0]);
    await page.fill('#q', String(pv));
    await page.dispatchEvent('#q', 'input');
    const tiles = await page.$$eval('#cli .tileVol .t', t => t.map(x => x.textContent));
    assert.equal(tiles.length, 6);
    assert.equal(tiles[5], 'Del Valle Frut');
    const resumo = await page.evaluate(() => { RS.pinta(); return true; });
    assert.ok(resumo);
    assert.deepEqual(erros, []);
    await ctx.close();
  });
});
