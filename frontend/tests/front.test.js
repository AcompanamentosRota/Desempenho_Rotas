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
  for(const [nome, args] of [['normal', []], ['fech', ['--fechamento']], ['semdv', ['--sem-meta-dv']]]){
    const dir = path.join(tmp, nome);
    execFileSync('python3', [path.join(FRONT, 'tests', 'sintetico.py'), dir, ...args], {cwd: RAIZ});
    DADOS[nome] = dir;
  }
  // payload antigo (antes de GC_NOMES): com REGIOES, sem GC_NOMES e GC_ATIVAS na ordem antiga
  const antigo = path.join(tmp, 'antigo');
  fs.mkdirSync(antigo);
  const p = JSON.parse(fs.readFileSync(path.join(DADOS.normal, 'payload.json'), 'utf-8'));
  delete p.GC_NOMES;
  p.REGIOES = {Matriz: ['G1', 'G2', 'G3', 'AT', 'AP'], Sul: ['AN', 'SL', 'RV', 'MO', 'IT'],
               Norte: ['RI', 'UR', 'GU', 'PO', 'PA', 'DI']};
  p.GC_ATIVAS = ['G1', 'G2', 'G3', 'AP', 'IT', 'MO', 'AT', 'AN', 'SL', 'RV', 'RI', 'UR', 'GU', 'PO', 'PA'];
  fs.writeFileSync(path.join(antigo, 'payload.json'), JSON.stringify(p));
  fs.copyFileSync(path.join(DADOS.normal, 'online.json'), path.join(antigo, 'online.json'));
  DADOS.antigo = antigo;
  // payload em que a SV.G2.2 saiu (acesso guardado que não vale mais)
  const semsv = path.join(tmp, 'semsv');
  fs.mkdirSync(semsv);
  const q = JSON.parse(fs.readFileSync(path.join(DADOS.normal, 'payload.json'), 'utf-8'));
  delete q.DATA.G2['SV.G2.2'];
  fs.writeFileSync(path.join(semsv, 'payload.json'), JSON.stringify(q));
  fs.copyFileSync(path.join(DADOS.normal, 'online.json'), path.join(semsv, 'online.json'));
  DADOS.semsv = semsv;
  // grupo IT+MO com uma rota virtual na IT (I32, na SV.IT.3 junto com a Neutraliza I31) e clientes de rota eventual
  // na MO (rota oculta MO-EV, só com o Real de volume, como a SL-EV)
  const grupo = path.join(tmp, 'grupo');
  fs.mkdirSync(grupo);
  const g = JSON.parse(fs.readFileSync(path.join(DADOS.normal, 'payload.json'), 'utf-8'));
  const i32 = JSON.parse(JSON.stringify(g.DATA.IT['SV.IT.3'].I31));
  for(const b of Object.values(i32.indicators)){
    if(b.unavailable || b.meta == null) continue;
    b.meta *= 2;
    for(const c of ['real', 'tendencia', 'metaDia']) if(b[c] != null) b[c] *= 3;
  }
  i32.consultor = 'CONSULTOR I32';
  g.DATA.IT['SV.IT.3'].I32 = i32;
  const mev = JSON.parse(JSON.stringify(g.DATA.SL['SV.SL.EV']['SL-EV']));
  Object.assign(mev.indicators['VOL REFRIGERANTES'], {real: 77, tendencia: 77});
  g.DATA.MO['SV.MO.EV'] = {'MO-EV': mev};
  g.VIRTUAIS_ROTAS.push('I32', 'MO-EV');
  g.EVENTUAIS_ROTAS.push('MO-EV');
  fs.writeFileSync(path.join(grupo, 'payload.json'), JSON.stringify(g));
  fs.copyFileSync(path.join(DADOS.normal, 'online.json'), path.join(grupo, 'online.json'));
  DADOS.grupo = grupo;
  // G3 e PA sem dados: a G3 aparece desabilitada e o grupo PA+DI também (a DI já não tem dados)
  const semdados = path.join(tmp, 'semdados');
  fs.mkdirSync(semdados);
  const s = JSON.parse(fs.readFileSync(path.join(DADOS.normal, 'payload.json'), 'utf-8'));
  delete s.DATA.G3;
  delete s.DATA.PA;
  s.GC_ATIVAS = s.GC_ATIVAS.filter(x => x !== 'G3' && x !== 'PA');
  fs.writeFileSync(path.join(semdados, 'payload.json'), JSON.stringify(s));
  fs.copyFileSync(path.join(DADOS.normal, 'online.json'), path.join(semdados, 'online.json'));
  DADOS.semdados = semdados;
  browser = await pw.chromium.launch(CHROMIUM ? {executablePath: CHROMIUM} : {});
});
after(async () => {
  if(browser) await browser.close();
  if(tmp) fs.rmSync(tmp, {recursive: true, force: true});
});

const TIPOS = {'.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json',
  '.png':'image/png', '.webmanifest':'application/manifest+json'};

/* Abre o painel com os dados `nome` ('normal' | 'fech' | 'semdv' | 'antigo' | 'semsv' | 'grupo' | 'semdados');
   devolve {page, erros}.
   `armazenado` = localStorage inicial; `busca` = query string (ex.: link do Resumo); `fuso` = fuso do navegador;
   `antes(page)` roda antes de abrir (ex.: relógio simulado); `entrar` = como entra pela entrada (ver entra()). */
async function abre(nome, {armazenado = {}, largura = 1200, altura = 1000, entrar = 'gc', busca = '', fuso, antes} = {}){
  const ctx = await browser.newContext({viewport: {width: largura, height: altura}, ...(fuso ? {timezoneId: fuso} : {})});
  const page = await ctx.newPage();
  const erros = [], fonte = {nome};     // fonte.nome pode mudar no meio do teste (payload novo)
  page.on('pageerror', e => erros.push(String(e)));
  page.on('console', m => { if(m.type() === 'error') erros.push(m.text()); });
  await page.route('http://painel.test/**', rota => {
    const url = new URL(rota.request().url());
    let arq = url.pathname.startsWith('/data/') ? path.join(DADOS[fonte.nome], url.pathname.slice(6))
                                                 : path.join(FRONT, url.pathname);
    if(!fs.existsSync(arq)) return rota.fulfill({status: 404, body: ''});
    rota.fulfill({status: 200, contentType: TIPOS[path.extname(arq)] || 'application/octet-stream',
                  body: fs.readFileSync(arq)});
  });
  // bibliotecas do PDF (CDN) não são usadas nos testes
  await page.route(/cdnjs\.cloudflare\.com/, r => r.abort());
  // só na 1ª carga da aba (um reload não deve regravar o acesso guardado)
  await page.addInitScript(itens => { try { if(!sessionStorage.getItem('_teste')){ sessionStorage.setItem('_teste', '1');
    for(const k in itens) localStorage.setItem(k, itens[k]); } } catch(e){} }, armazenado);
  if(antes) await antes(page);
  await page.goto('http://painel.test/index.html' + busca);
  await esperaCarga(page);
  // sem acesso guardado a página abre na entrada; entrar = 'gc' | 'dir' | {perfil, ...} entra, null fica na entrada
  if(entrar) await entra(page, entrar);
  return {page, ctx, erros, fonte};
}
module.exports = {abre};

/* Espera o payload e o fim da tela de carga (entrada, acesso guardado ou link do Resumo já resolvidos).
   P é 'let' de script clássico: existe no escopo global, mas não em window. */
const esperaCarga = page => page.waitForFunction(() => typeof P !== 'undefined' && P &&
  document.querySelector('#lista').innerHTML !== '' && document.getElementById('carga').hidden);
/* Entra pela tela de entrada, por seleção: {perfil: 'dir'} | {perfil: 'gc', gc} | {perfil: 'sv', gc, sv} |
   {perfil: 'rota', gc, rota}, com gc = sigla ou chave de grupo ('IT+MO'; a sigla de uma gerência agrupada escolhe o
   grupo dela, como faria o usuário), sv = código (SV.G2.1) ou só o número ('1') e rota = código; 'dir' = Diretoria;
   'gc' = Gerência na primeira gerência com dados (onde a Gerência abria antes). */
async function entra(page, entrar){
  if(entrar === 'dir') entrar = {perfil: 'dir'};
  if(entrar === 'gc') entrar = {perfil: 'gc', gc: await page.evaluate(() => primeiraGc())};
  const {perfil, gc = '', sv = '', rota = ''} = entrar;
  if(await page.isVisible('#entCaixa')) await page.click('#entFechar');     // de volta aos quatro botões
  await page.click(`#entrada [data-perfil="${perfil}"]`);
  if(perfil === 'dir') return;
  const opcao = await page.$$eval('#entOpcoes [data-gc]', (bs, gc) => ((bs.find(b => b.dataset.gc === gc)
    || bs.find(b => b.dataset.gc.split('+').includes(gc))) || {dataset: {gc}}).dataset.gc, gc);
  await page.click(`#entOpcoes [data-gc="${opcao}"]`);
  if(perfil === 'sv') await page.click(`#entOpcoes [data-sv="${/^\d+$/.test(sv) ? `SV.${gc}.${Number(sv)}` : sv}"]`);
  if(perfil === 'rota') await page.click(`#entOpcoes [data-rota="${rota}"]`);
}
/* volta para a entrada pela casa e entra de novo */
async function vaiPara(page, entrar){
  await page.click('#btnCasa');
  await entra(page, entrar);
}

/* Seleciona gerência/supervisão/rota e aba e espera o render. */
async function filtra(page, {gc, sv = '', rota = '', aba} = {}){
  await page.evaluate(({gc, sv, rota, aba}) => {
    if(gc !== undefined) sel = {...sel, gc, sv, rota};
    if(aba){ document.querySelector(`.tab[data-g="${aba}"]`).click(); }
    render();
  }, {gc, sv, rota, aba});
}

/* opções dos selects de supervisão e de rota */
const opcoes = page => page.evaluate(() => ({
  sv: [...document.querySelectorAll('#fsv option')].map(o => o.value).filter(Boolean),
  rota: [...document.querySelectorAll('#frota option')].map(o => o.value).filter(Boolean),
}));
/* Põe o real de todos os indicadores das rotas em `fator` x meta (cobertura e tendência de volume). */
const ritmo = (page, gc, rotas, fator) => page.evaluate(([gc, rotas, fator]) => rotas.forEach(r => {
  for(const b of Object.values(nodo(gc, r).indicators)){
    if(b.unavailable || b.meta == null) continue;
    b.real = b.meta * fator;
    if(b.tendencia != null) b.tendencia = b.meta * fator;
  }
}), [gc, rotas, fator]);

describe('Parte B — Neutraliza e virtuais por rota, ocultas, AT e Del Valle Frut', {skip: pular}, () => {
  test('filtro: opção "Neutraliza" abre os cards só dessas rotas; virtuais fora dos selects e no total', async () => {
    const {page, ctx, erros} = await abre('normal');
    const k = 'VOL REFRIGERANTES';
    await filtra(page, {gc: 'G1', aba: 'VOLUME'});
    let op = await opcoes(page);
    assert.deepEqual(op.sv, ['SV.G1.1', 'SV.G1.2', 'Neutraliza'], 'SV.G1.5 só tem a 151: vira "Neutraliza"');
    assert.ok(op.rota.includes('151'), 'a rota Neutraliza aparece em "Todas rotas"');
    let r = await page.evaluate(k => ({total: agrega(rotasAtuais()).ind[k].meta, base: agrega(rotasAtuais()).tot.baseTotal,
      soma: Object.values(DATA.G1).flatMap(s => Object.values(s)).reduce((a, d) => a + d.indicators[k].meta, 0),
      baseTodas: Object.values(DATA.G1).flatMap(s => Object.values(s)).reduce((a, d) => a + d.baseTotal, 0)}), k);
    assert.equal(r.total, r.soma);
    assert.equal(r.base, r.baseTodas, 'os clientes da Neutraliza contam na base da gerência');
    // filtro "Neutraliza": só a 151, sem card de Venda Zero e sem "puxa a média"
    await page.selectOption('#fsv', 'Neutraliza');
    op = await opcoes(page);
    assert.deepEqual(op.rota, ['151']);
    r = await page.evaluate(k => ({meta: agrega(rotasAtuais()).ind[k].meta, n151: DATA.G1['SV.G1.5']['151'].indicators[k].meta,
      base: document.getElementById('nBase').textContent, sub: document.getElementById('sub').textContent,
      puxa: document.getElementById('puxa').innerHTML}), k);
    assert.equal(r.meta, r.n151);
    assert.equal(r.base, '3');
    assert.match(r.sub, /· Neutraliza$/);
    assert.equal(r.puxa, '');
    await filtra(page, {aba: 'ICS_GC'});
    let tits = await page.$$eval('#lista .ind .tit', t => t.map(x => x.textContent));
    assert.ok(tits.includes('CCTM 2L Pet') && !tits.includes('Venda Zero'), 'Venda Zero não vale para a Neutraliza');
    await filtra(page, {gc: 'G1', aba: 'ICS_GC'});
    tits = await page.$$eval('#lista .ind .tit', t => t.map(x => x.textContent));
    assert.ok(tits.includes('Venda Zero'));
    // AN: SV.AN.4 só tem A41 (Neutraliza) e as virtuais A42-A44
    await filtra(page, {gc: 'AN', aba: 'VOLUME'});
    op = await opcoes(page);
    assert.deepEqual(op.sv, ['SV.AN.1', 'SV.AN.2', 'Neutraliza']);
    assert.ok(op.rota.includes('A41') && !op.rota.some(x => ['A42', 'A43', 'A44'].includes(x)), op.rota.join('|'));
    r = await page.evaluate(k => {
      const todas = rotasDe('AN', ''), vis = todas.filter(x => !['A42', 'A43', 'A44'].includes(x));
      return {total: agrega(rotasAtuais()).ind[k].meta, soma: todas.reduce((a, x) => a + nodo('AN', x).indicators[k].meta, 0),
              base: agrega(rotasAtuais()).tot.baseTotal, baseVis: vis.reduce((a, x) => a + nodo('AN', x).baseTotal, 0),
              rodape: document.getElementById('rodape').textContent};
    }, k);
    assert.equal(r.total, r.soma, 'virtuais somam no total da gerência');
    assert.equal(r.base, r.baseVis, 'clientes das virtuais não aparecem');
    assert.match(r.rodape, /^5 rotas/);
    // supervisão mista (SV.PO.2 = PO21, PO22 e a Neutraliza O21): a supervisão soma só as normais
    await filtra(page, {gc: 'PO', sv: 'SV.PO.2', aba: 'VOLUME'});
    op = await opcoes(page);
    assert.deepEqual(op.rota, ['PO21', 'PO22']);
    r = await page.evaluate(k => ({meta: agrega(rotasAtuais()).ind[k].meta,
      soma: ['PO21', 'PO22'].reduce((a, x) => a + nodo('PO', x).indicators[k].meta, 0)}), k);
    assert.equal(r.meta, r.soma);
    // escolher uma rota Neutraliza em "Todos os SVs" leva o filtro de supervisão para "Neutraliza"
    await filtra(page, {gc: 'AT', aba: 'VOLUME'});
    await page.selectOption('#frota', '431');
    assert.deepEqual(await page.evaluate(() => [sel.sv, sel.rota, document.getElementById('fsv').value]),
                     ['Neutraliza', '431', 'Neutraliza']);
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('"puxa a média" sem Neutraliza, virtuais e ocultas; AT e a 411 normais', async () => {
    const {page, ctx, erros} = await abre('normal');
    const r = await page.evaluate(() => ({
      excl: ['Neutraliza', 'SV.G3.3', 'SV.AT.3', 'SV.G1.1'].map(s => [s, svExcluido(s)]),
      at: svsVisiveis('AT'), at1: rotasNormais('AT', 'SV.AT.1'), at3: rotasNormais('AT', 'SV.AT.3'),
      neutra: rotasNeutraliza('AT'),
    }));
    assert.deepEqual(Object.fromEntries(r.excl), {'Neutraliza': true, 'SV.G3.3': true, 'SV.AT.3': false, 'SV.G1.1': false});
    assert.deepEqual(r.at, ['SV.AT.1', 'SV.AT.2', 'SV.AT.3'], 'na AT nenhuma supervisão é oculta');
    assert.deepEqual(r.at1, ['411', 'AT12'], '411 é normal');
    assert.deepEqual(r.at3, ['AT31', 'AT32']);
    assert.deepEqual(r.neutra, ['431']);
    // supervisões no ritmo (40% com 33% do mês) e a Neutraliza (ou a virtual) zerada: ninguém "puxa a média"
    // (na SV.PO.2, somar a O21 derrubaria a supervisão para 27%)
    for(const [gc, ruins] of [['G1', ['151']], ['AN', ['A41', 'A42', 'A43', 'A44']], ['PO', ['O21']]]){
      await filtra(page, {gc, aba: 'ICS_GC'});
      const todas = await page.evaluate(gc => rotasDe(gc, ''), gc);
      await ritmo(page, gc, todas.filter(x => !ruins.includes(x)), 0.4);
      await ritmo(page, gc, ruins, 0);
      await filtra(page, {gc});
      assert.equal(await page.innerHTML('#puxa'), '', gc);
    }
    // controle: com uma supervisão abaixo, ela aparece
    await ritmo(page, 'G1', ['G111'], 0);
    await filtra(page, {gc: 'G1'});
    assert.match(await page.textContent('#puxa'), /Supervisão que mais puxa a média para baixo: SV\.G1\.1/);
    // AT: a 411 entra na comparação das rotas da SV.AT.1
    await ritmo(page, 'AT', ['AT12'], 1);
    await ritmo(page, 'AT', ['411'], 0);
    await filtra(page, {gc: 'AT', sv: 'SV.AT.1'});
    assert.match(await page.textContent('#puxa'), /Rota que mais puxa a média para baixo: Rota 411/);
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('Resumo sem coluna de Neutraliza nem de virtual; filtro "Neutraliza" mostra a gerência', async () => {
    const {page, ctx, erros} = await abre('normal');
    const cabecalhos = () => page.$$eval('#rsFolha .rs-tab thead th', ths => ths.map(t => t.firstChild ? t.firstChild.textContent : ''));
    await filtra(page, {gc: 'G2'});
    await page.click('#btnResumo');
    let cols = await cabecalhos();
    assert.ok(cols.includes('GC.G2'));
    assert.ok(!cols.some(c => c.includes('SV.G2.5') || c.includes('Neutraliza') || c === '251'), cols.join('|'));
    await page.click('#rsVoltar');
    await filtra(page, {gc: 'AN', sv: 'Neutraliza'});
    await page.click('#btnResumo');
    cols = await cabecalhos();
    assert.equal(await page.textContent('#rsFolha h2'), 'Resumo de vendas · GC.AN · Anápolis');
    assert.ok(cols.includes('SV.AN.1') && !cols.some(c => /SV\.AN\.4|A4\d|Neutraliza/.test(c)), cols.join('|'));
    await page.click('#rsVoltar');
    // supervisão mista: colunas só com as rotas normais
    await filtra(page, {gc: 'PO', sv: 'SV.PO.2'});
    await page.click('#btnResumo');
    cols = await cabecalhos();
    assert.ok(cols.includes('PO21') && cols.includes('PO22') && !cols.includes('O21'), cols.join('|'));
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('busca: cliente de rota Neutraliza aparece (tag e GDM); de rota virtual, não', async () => {
    const {page, ctx, erros} = await abre('normal');
    await filtra(page, {gc: 'G1', aba: 'VOLUME'});
    const [pv, gdm] = await page.evaluate(() => {
      // um cliente com geladeira de situação conhecida (tem tag)
      const c = CLIENT_ROSTER['151'].find(x => ((P.COMODATO_CLIENTE['151'] || {})[x[0]] || [])[2]);
      return [c[0], P.COMODATO_CLIENTE['151'][c[0]]];
    });
    await page.fill('#q', String(pv));
    const r = await page.evaluate(() => ({h3: (document.querySelector('#cli h3') || {}).textContent || '',
      meta: (document.querySelector('#cli .meta') || {}).textContent || '', gdm: document.querySelectorAll('#cli .tileVol.gdm').length}));
    assert.match(r.meta, /rota 151/);
    assert.match(r.h3, new RegExp(`${gdm[3]} geladeira`));
    assert.equal(r.gdm, 1);
    await filtra(page, {gc: 'AN', aba: 'VOLUME'});
    const pvVirtual = await page.evaluate(() => CLIENT_ROSTER['A42'][0][0]);
    await page.fill('#q', String(pvVirtual));
    assert.equal(await page.innerHTML('#cli'), '');
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
    const tiles = await page.$$eval('#cli .tileVol:not(.gdm) .t', t => t.map(x => x.textContent));
    assert.equal(tiles.length, 6);
    assert.equal(tiles[5], 'Del Valle Frut');
    const resumo = await page.evaluate(() => { RS.pinta(); return true; });
    assert.ok(resumo);
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('Del Valle Frut sem meta (META_VOLUME e META_NEG): sem card na G2', async () => {
    const {page, ctx, erros} = await abre('semdv');
    for(const f of [{gc: 'G2'}, {gc: 'G2', sv: 'SV.G2.1'}, {gc: 'G2', sv: 'SV.G2.1', rota: 'G211'}]){
      await filtra(page, {...f, aba: 'VOLUME'});
      const tits = await page.$$eval('#lista .ind .tit', t => t.map(x => x.textContent));
      assert.ok(tits.includes('Refrigerantes') && !tits.includes('Del Valle Frut'), tits.join('|'));
    }
    assert.ok(await page.evaluate(() => DATA.G2['SV.G2.1'].G211.indicators['VOL DEL VALLE FRUT'].unavailable));
    assert.deepEqual(erros, []);
    await ctx.close();
  });
});

/* Busca um cliente (PV) na gerência e aba informadas; devolve tags e quadrinhos do card do cliente. */
async function buscaPv(page, gc, pv, aba = 'VOLUME'){
  await filtra(page, {gc, aba});
  await page.fill('#q', String(pv));
  return page.evaluate(() => ({
    tags: [...document.querySelectorAll('#cli h3 span')].map(s => [s.className, s.textContent]),
    gdm: [...document.querySelectorAll('#cli .tileVol.gdm')].map(t => [t.className, t.querySelector('.nums').textContent]),
  }));
}

describe('Parte C — Desempenho GDM e tag de geladeira', {skip: pular}, () => {
  test('tag e cor do quadrinho por situação (tabela C2), sem geladeira e desconhecido', async () => {
    const {page, ctx, erros} = await abre('normal');
    const casos = await page.evaluate(() => {
      const out = {}, sem = [];
      for(const gc of ['G1', 'G3', 'AP']){
        for(const r of svsVisiveis(gc).flatMap(s => Object.keys(DATA[gc][s]))){
          for(const c of CLIENT_ROSTER[r]){
            const b = (P.COMODATO_CLIENTE[r] || {})[c[0]];
            if(!b) sem.push([gc, c[0]]);
            else if(!out[b[2] || 'nulo']) out[b[2] || 'nulo'] = [gc, r, c[0], b];
          }
        }
      }
      return {out, sem};
    });
    const esperado = {zero: ['tagVZ', 'Venda Zero · '], baixo: ['tagBaixo', 'Baixo Giro · '], ok: ['tagAtivo', ''],
                      '30d': ['tagNovo', '< 30 dias · ']};
    for(const [sit, [gc, r, pv, b]] of Object.entries(casos.out)){
      const res = await buscaPv(page, gc, pv);
      const onl = await page.evaluate(([r, pv]) => (((ONLINE.gdmCliente || {})[r] || {})[pv] || 0), [r, pv]);
      const real = b[1] + onl;
      const ger = `${b[3]} geladeira${b[3] > 1 ? 's' : ''}`;
      if(sit === 'nulo'){
        assert.deepEqual(res.tags, [], 'situação desconhecida: sem tag');
        assert.match(res.gdm[0][0], /\bnc\b/);
        continue;
      }
      assert.deepEqual(res.tags, [[esperado[sit][0], esperado[sit][1] + ger]], sit);
      const cor = sit === 'zero' ? 'no' : sit === 'baixo' ? 'pace' : sit === 'ok' ? 'ok'
        : (real <= 0 ? 'no' : real < b[0] ? 'pace' : 'ok');
      assert.match(res.gdm[0][0], new RegExp(`\\b${cor}\\b`), sit);
    }
    assert.deepEqual(Object.keys(casos.out).sort(), ['30d', 'baixo', 'nulo', 'ok', 'zero']);
    const [gc, pv] = casos.sem[0];
    const semGel = await buscaPv(page, gc, pv);
    assert.deepEqual(semGel, {tags: [], gdm: []}, 'sem geladeira: sem tag e sem quadrinho');
    // fora da aba Volume a tag aparece, o quadrinho não
    const [g0, r0, pv0] = casos.out.zero;
    const ics = await buscaPv(page, g0, pv0, 'ICS_GC');
    assert.equal(ics.gdm.length, 0);
    assert.equal(ics.tags.length, 1);
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('rede soma Meta, Real e geladeiras das lojas com geladeira', async () => {
    const {page, ctx, erros} = await abre('normal');
    await filtra(page, {gc: 'G1', aba: 'VOLUME'});
    const esperado = await page.evaluate(() => {
      const g = gruposRede(rotasVisiveis()).get('REDE TESTE');
      const gs = g.membros.map(([r, c]) => gdmCliente(r, c)).filter(Boolean);
      return {n: gs.reduce((a, x) => a + x.n, 0), meta: gs.reduce((a, x) => a + x.meta, 0),
              real: gs.reduce((a, x) => a + x.real, 0)};
    });
    await page.fill('#q', 'REDE TESTE');
    const r = await page.evaluate(() => ({
      tags: [...document.querySelectorAll('#cli h3 span')].map(s => s.textContent),
      nums: document.querySelector('#cli .tileVol.gdm .nums').textContent,
    }));
    const fmt = n => n.toLocaleString('pt-BR', {minimumFractionDigits: 1, maximumFractionDigits: 1});
    assert.deepEqual(r.tags, ['Rede', `${esperado.n} geladeiras`]);
    assert.equal(r.nums, `${fmt(esperado.real)} / ${fmt(esperado.meta)}`);
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('fechamento: sem tag e sem quadrinho', async () => {
    const {page, ctx, erros} = await abre('fech');
    const pv = await page.evaluate(() => CLIENT_ROSTER['G111'][0][0]);
    const res = await buscaPv(page, 'G1', pv);
    assert.deepEqual(res, {tags: [], gdm: []});
    assert.deepEqual(erros, []);
    await ctx.close();
  });
});

/* ---------- Parte D ---------- */
// abre a cascata do card `k` na aba `aba` e devolve o estado da gaveta
async function cascata(page, k, aba){
  await filtra(page, {aba});
  await page.click(`.ind[data-k="${k}"]`);
  return lerGaveta(page);
}
function lerGaveta(page){
  return page.evaluate(() => ({
    tit: document.getElementById('dTit').textContent,
    sub: document.getElementById('dSub').textContent,
    volta: (document.getElementById('cVolta') || {}).textContent || '',
    linhas: [...document.querySelectorAll('#dCorpo .cLin')].map(el => ({
      nome: el.querySelector('.cNome b').textContent, off: el.classList.contains('off'),
      meta: Number(el.dataset.meta), real: Number(el.dataset.real), dir: el.dataset.dir === '' ? null : Number(el.dataset.dir),
      meio: (el.querySelector('.cMeio') || {}).textContent || ''})),
    clientes: [...document.querySelectorAll('#dCorpo .cCli')].map(el => Number(el.dataset.dif)),
    itens: document.querySelectorAll('#dCorpo .item').length,
    nota: [...document.querySelectorAll('#dCorpo .cNota')].map(el => ({texto: el.textContent, meta: Number(el.dataset.meta),
      real: Number(el.dataset.real), ultima: el === el.parentElement.lastElementChild})),
  }));
}
const somaMeta = ls => ls.filter(l => !l.off).reduce((a, l) => a + l.meta, 0);

describe('Parte D — entrada', {skip: pular}, () => {
  test('preta por padrão, sol/lua troca e guarda; casa volta; rodapé', async () => {
    const {page, ctx, erros} = await abre('normal', {entrar: null});
    assert.equal(await page.evaluate(() => document.getElementById('entrada').className), 'entrada');
    await page.click('#btnTema');
    assert.equal(await page.evaluate(() => localStorage.getItem('drotas_entrada')), 'branca');
    assert.ok(await page.evaluate(() => document.getElementById('entrada').classList.contains('branca')));
    await entra(page, 'gc');
    assert.ok(await page.evaluate(() => document.getElementById('entrada').hidden));
    assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(245, 245, 247)');
    await page.click('#btnCasa');
    assert.ok(!(await page.evaluate(() => document.getElementById('entrada').hidden)));
    assert.equal(await page.textContent('#entRod'), 'Karen Oliveira - Inteligência de Mercado');
    await entra(page, 'gc');
    assert.match(await page.textContent('#rodape .creditos'), /^Karen Oliveira - Inteligência de Mercado$/);
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('escolha guardada vale na próxima visita; sem armazenamento fica preta', async () => {
    let {page, ctx, erros} = await abre('normal', {entrar: null, armazenado: {drotas_entrada: 'branca'}});
    assert.ok(await page.evaluate(() => document.getElementById('entrada').classList.contains('branca')));
    assert.deepEqual(erros, []);
    await ctx.close();
    ctx = await browser.newContext(); page = await ctx.newPage();
    const erros2 = [];
    page.on('pageerror', e => erros2.push(String(e)));
    await page.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', {get(){ throw new Error('bloqueado'); }});
    });
    await page.route('http://painel.test/**', r => {
      const u = new URL(r.request().url());
      const a = u.pathname.startsWith('/data/') ? path.join(DADOS.normal, u.pathname.slice(6)) : path.join(FRONT, u.pathname);
      fs.existsSync(a) ? r.fulfill({status: 200, body: fs.readFileSync(a), contentType: TIPOS[path.extname(a)]})
                       : r.fulfill({status: 404, body: ''});
    });
    await page.goto('http://painel.test/index.html');
    await page.waitForFunction(() => typeof P !== 'undefined' && P);
    assert.equal(await page.evaluate(() => document.getElementById('entrada').className), 'entrada');
    await page.click('#btnTema');      // não quebra sem armazenamento
    assert.deepEqual(erros2, []);
    await ctx.close();
  });
});

describe('Parte D — cascata', {skip: pular}, () => {
  test('gerência com todos os SVs: supervisões -> rotas -> clientes; soma = card; ordem; voltar', async () => {
    const {page, ctx, erros} = await abre('normal');
    await filtra(page, {gc: 'G1'});
    const k = 'VOL REFRIGERANTES';
    const card = await page.evaluate(k => agrega(rotasAtuais()).ind[k], k);
    let g = await cascata(page, k, 'VOLUME');
    // ordem pelo código (item 1 de entrada-perfis-ordem; antes era pela tendência), "Neutraliza" por último
    assert.deepEqual(g.linhas.map(l => l.nome), ['SV.G1.1 · Supervisor', 'SV.G1.2 · Supervisor', 'Neutraliza']);
    assert.ok(Math.abs(somaMeta(g.linhas) - card.meta) < 1e-6, 'linhas (com a Neutraliza) = card');
    assert.match(g.sub, /^Meta [\d.]+ · Real [\d.]+ · tendência \d+%$/, 'D2: números pt-BR');
    await page.click('#dCorpo .cLin[data-i="0"]');
    g = await lerGaveta(page);
    assert.equal(g.volta, '← Supervisões');
    assert.equal(g.linhas.length, 2);
    assert.ok(g.linhas.every(l => /^Rota /.test(l.nome)));
    await page.click('#dCorpo .cLin[data-i="0"]');
    g = await lerGaveta(page);
    assert.equal(g.volta, '← Rotas');
    assert.ok(g.clientes.length > 0 && g.clientes.length <= 400);
    assert.ok(g.clientes.every((d, i) => i === 0 || g.clientes[i - 1] <= d), 'Dif. Abs crescente');
    await page.click('#cVolta'); await page.click('#cVolta');
    g = await lerGaveta(page);
    assert.equal(g.volta, '');
    assert.equal(g.linhas.length, 3);
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('linha "Neutraliza" nos dois modos: rotas e clientes dentro; soma das linhas = card; fora da Venda Zero', async () => {
    const k = 'VOL REFRIGERANTES';
    // modo Gerência: G1 (sem virtual) -> a soma das linhas é o card
    let {page, ctx, erros} = await abre('normal');
    await filtra(page, {gc: 'G1'});
    const esperado = await page.evaluate(k => {
      const b = agrega(['151']).ind[k];
      return {meta: b.meta, real: b.real, dir: b.pctTendencia, md: Math.round(b.metaDia).toLocaleString('pt-BR'),
              onl: Math.round(ONLINE.volume['151'] ? ONLINE.volume['151'][k] || 0 : 0).toLocaleString('pt-BR')};
    }, k);
    let g = await cascata(page, k, 'VOLUME');
    const n = g.linhas[g.linhas.length - 1];
    assert.deepEqual([n.nome, n.meta, n.real, n.dir], ['Neutraliza', esperado.meta, esperado.real, esperado.dir]);
    assert.equal(n.meio, `${esperado.onl}meta do dia ${esperado.md}`, 'Online e Meta do dia');
    const iN = g.linhas.length - 1;      // a linha "Neutraliza" é a última linha (depois dela só a nota das virtuais)
    assert.equal(await page.textContent(`#dCorpo .cLin[data-i="${iN}"] .cNome small`), '1 rota');
    await page.click(`#dCorpo .cLin[data-i="${iN}"]`);
    g = await lerGaveta(page);
    assert.equal(g.tit, 'Refrigerantes · Neutraliza · G1');
    assert.equal(g.volta, '← Supervisões');
    assert.deepEqual(g.linhas.map(l => l.nome), ['Rota 151']);
    await page.click('#dCorpo .cLin[data-i="0"]');
    g = await lerGaveta(page);
    assert.equal(g.volta, '← Rotas');
    assert.equal(g.clientes.length, 3, 'clientes da rota Neutraliza');
    await page.keyboard.press('Escape');
    // Venda Zero: sem linha Neutraliza
    g = await cascata(page, 'VENDAZERO', 'ICS_GC');
    assert.ok(g.linhas.length && !g.linhas.some(l => l.nome === 'Neutraliza'));
    await page.keyboard.press('Escape');
    // filtro "Neutraliza": a gaveta começa nas rotas
    await filtra(page, {gc: 'G1', sv: 'Neutraliza'});
    g = await cascata(page, 'CCTM 2L PET', 'ICS_GC');
    assert.deepEqual([g.tit, g.linhas.map(l => l.nome)], ['CCTM 2L Pet · Neutraliza · G1', ['Rota 151']]);
    assert.deepEqual(erros, []);
    await ctx.close();
    // modo Diretoria: AN tem a Neutraliza A41 e as virtuais A42-A44 (sem linha): linhas + virtuais = card
    ({page, ctx, erros} = await abre('normal', {entrar: 'dir'}));
    g = await cascata(page, k, 'VOLUME');
    await page.click(`#dCorpo .cLin[data-i="${g.linhas.findIndex(l => l.nome === 'GC.AN · Anápolis')}"]`);
    g = await lerGaveta(page);
    const an = await page.evaluate(k => ({card: agrega(rotasDe('AN', '')).ind[k].meta,
      virt: ['A42', 'A43', 'A44'].reduce((a, r) => a + nodo('AN', r).indicators[k].meta, 0),
      a41: nodo('AN', 'A41').indicators[k].meta}), k);
    assert.deepEqual(g.linhas.map(l => l.nome).sort(), ['Neutraliza', 'SV.AN.1 · Supervisor', 'SV.AN.2 · Supervisor']);
    assert.equal(g.linhas[2].nome, 'Neutraliza');
    assert.equal(g.linhas[2].meta, an.a41);
    assert.ok(an.virt > 0);
    assert.ok(Math.abs(somaMeta(g.linhas) + an.virt - an.card) < 1e-6, 'linhas + virtuais = card');
    await page.click('#dCorpo .cLin[data-i="2"]');
    g = await lerGaveta(page);
    assert.deepEqual(g.linhas.map(l => l.nome), ['Rota A41']);
    assert.deepEqual(g.nota, [], 'a nota das virtuais só fica nas supervisões');
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('clientes de rotas eventuais (EV*): rota oculta só no total da gerência, com nota própria', async () => {
    const {page, ctx, erros} = await abre('normal');
    const k = 'VOL REFRIGERANTES';
    await filtra(page, {gc: 'SL', aba: 'VOLUME'});
    const op = await opcoes(page);
    assert.deepEqual(op.sv, ['SV.SL.1', 'SV.SL.2'], 'a supervisão da rota oculta não aparece');
    assert.ok(!op.rota.includes('SL-EV'), op.rota.join('|'));
    const r = await page.evaluate(k => ({card: agrega(rotasAtuais()).ind[k], ev: nodo('SL', 'SL-EV').indicators[k],
      eventuais: P.EVENTUAIS_ROTAS, base: agrega(rotasAtuais()).tot.baseTotal,
      baseVis: rotasVisiveis().reduce((a, x) => a + nodo('SL', x).baseTotal, 0)}), k);
    assert.deepEqual(r.eventuais, ['SL-EV']);
    assert.deepEqual([r.ev.meta, r.ev.real, r.ev.tendencia], [0, 120, 120]);
    assert.equal(r.base, r.baseVis, 'sem clientes');
    let g = await cascata(page, k, 'VOLUME');
    assert.equal(g.nota.length, 1);
    assert.deepEqual([g.nota[0].texto, g.nota[0].meta, g.nota[0].real, g.nota[0].ultima],
                     ['Inclui clientes de rotas eventuais (EV*): Real 120', 0, 120, true]);
    const somaReal = g.linhas.filter(l => !l.off).reduce((a, l) => a + l.real, 0);
    assert.ok(Math.abs(somaReal + g.nota[0].real - r.card.real) < 1e-6, 'linhas + nota = card (Real)');
    assert.ok(Math.abs(somaMeta(g.linhas) - r.card.meta) < 1e-6, 'sem meta');
    await page.keyboard.press('Escape');
    assert.deepEqual((await cascata(page, 'CCTM 2L PET', 'ICS_GC')).nota, [], 'só volume');
    await page.keyboard.press('Escape');
    // Diretoria: a linha da SL soma a rota oculta; a nota aparece ao abrir a gerência
    await vaiPara(page, 'dir');
    g = await cascata(page, k, 'VOLUME');
    const iSl = g.linhas.findIndex(l => l.nome === 'GC.SL · São Luís');
    const sl = await page.evaluate(k => agrega(rotasDe('SL', '')).ind[k].real, k);
    assert.equal(g.linhas[iSl].real, sl);
    await page.click(`#dCorpo .cLin[data-i="${iSl}"]`);
    g = await lerGaveta(page);
    assert.deepEqual(g.nota.map(n => n.texto), ['Inclui clientes de rotas eventuais (EV*): Real 120']);
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('nota das rotas virtuais no fim das supervisões: só Meta e Real, e a conta fecha com o card', async () => {
    const {page, ctx, erros} = await abre('normal');
    const virtuais = (k, gc) => page.evaluate(([k, gc]) => {
      const b = agrega(rotasDe(gc, '').filter(ehVirtual)).ind[k], f = ehVolume(k) ? fmt0 : fmtN;
      return {meta: b.meta, real: b.real, texto: `Inclui rotas virtuais: Meta ${f(b.meta)} · Real ${f(b.real)}`,
              card: agrega(rotasDe(gc, '')).ind[k].meta};
    }, [k, gc]);
    for(const [k, aba] of [['VOL REFRIGERANTES', 'VOLUME'], ['CCTM 2L PET', 'ICS_GC']]){
      for(const gc of ['AN', 'RV']){
        await filtra(page, {gc});
        const g = await cascata(page, k, aba), v = await virtuais(k, gc);
        assert.equal(g.nota.length, 1, `${gc} ${k}`);
        assert.deepEqual([g.nota[0].texto, g.nota[0].meta, g.nota[0].real, g.nota[0].ultima], [v.texto, v.meta, v.real, true]);
        assert.match(g.nota[0].texto, /^Inclui rotas virtuais: Meta [\d.,]+ · Real [\d.,]+$/, 'sem rota nem cliente');
        assert.ok(Math.abs(somaMeta(g.linhas) + g.nota[0].meta - v.card) < 1e-6, `${gc} ${k}: linhas + nota = card`);
        await page.keyboard.press('Escape');
      }
    }
    // sem virtuais na gerência, na Venda Zero (virtuais fora dela) e no nível das rotas: sem nota
    await filtra(page, {gc: 'G1'});
    assert.deepEqual((await cascata(page, 'VOL REFRIGERANTES', 'VOLUME')).nota, []);
    await page.keyboard.press('Escape');
    await filtra(page, {gc: 'AN'});
    assert.deepEqual((await cascata(page, 'VENDAZERO', 'ICS_GC')).nota, []);
    await page.keyboard.press('Escape');
    await filtra(page, {gc: 'AN', sv: 'SV.AN.1'});
    assert.deepEqual((await cascata(page, 'VOL REFRIGERANTES', 'VOLUME')).nota, []);
    await page.keyboard.press('Escape');
    // Diretoria: a nota aparece ao abrir a gerência, não na lista de gerências (que já somam as virtuais)
    await vaiPara(page, 'dir');
    let g = await cascata(page, 'VOL REFRIGERANTES', 'VOLUME');
    assert.deepEqual(g.nota, []);
    await page.click(`#dCorpo .cLin[data-i="${g.linhas.findIndex(l => l.nome === 'GC.AN · Anápolis')}"]`);
    g = await lerGaveta(page);
    assert.equal(g.nota.length, 1);
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('uma supervisão começa nas rotas; uma rota começa nos clientes', async () => {
    const {page, ctx, erros} = await abre('normal');
    await filtra(page, {gc: 'G2', sv: 'SV.G2.1'});
    let g = await cascata(page, 'CCTM 2L PET', 'ICS_GC');
    assert.ok(g.linhas.length === 2 && g.linhas.every(l => /^Rota /.test(l.nome)));
    const card = await page.evaluate(() => agrega(rotasAtuais()).ind['CCTM 2L PET']);
    assert.equal(somaMeta(g.linhas), card.meta);
    await page.keyboard.press('Escape');
    await filtra(page, {gc: 'G2', sv: 'SV.G2.1', rota: 'G211'});
    g = await cascata(page, 'CCTM 2L PET', 'ICS_GC');
    assert.equal(g.linhas.length, 0);
    assert.ok(g.itens > 0 || (await page.$('#dLista .vazio')), 'lista de quem falta comprar');
    assert.ok(await page.$('#dLista .chips'));
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('Diretoria: card = soma das 16; gerências -> supervisões; DI desabilitada; ← Gerências', async () => {
    const {page, ctx, erros} = await abre('normal', {entrar: 'dir'});
    const r = await page.evaluate(() => {
      const k = 'CCTM 2L PET';
      const total = agrega(rotasAtuais()).ind[k].meta;
      const soma = todasGcs().filter(g => DATA[g]).reduce((a, g) => a + agrega(rotasDe(g, '')).ind[k].meta, 0);
      return {total, soma, n: todasGcs().length, selects: [document.getElementById('fsv').hidden, document.getElementById('frota').hidden]};
    });
    assert.equal(r.n, 16);
    assert.equal(r.total, r.soma);
    assert.deepEqual(r.selects, [true, true]);
    let g = await cascata(page, 'CCTM 2L PET', 'ICS_GC');
    assert.equal(g.linhas.length, 16);
    assert.deepEqual(g.linhas.filter(l => l.off).map(l => l.nome), ['GC.DI · Dianópolis']);
    assert.equal(somaMeta(g.linhas), r.total);
    // ordem fixa de GC_NOMES/GC_ATIVAS (antes: pela tendência), a DI sem dados no lugar dela
    assert.deepEqual(g.linhas.map(l => l.nome.split(' ·')[0]), ['AN', 'AP', 'AT', 'G1', 'G2', 'G3', 'PA', 'DI', 'RV', 'SL',
      'GU', 'PO', 'IT', 'MO', 'UR', 'RI'].map(x => 'GC.' + x));
    const iG1 = g.linhas.findIndex(l => l.nome === 'GC.G1 · Goiânia 01');
    await page.click(`#dCorpo .cLin[data-i="${iG1}"]`);
    g = await lerGaveta(page);
    assert.equal(g.volta, '← Gerências');
    assert.ok(!g.linhas.some(l => l.nome.startsWith('SV.G1.5')));
    // Diretoria: sem Del Valle Frut na aba Volume
    await filtra(page, {aba: 'VOLUME'});
    const tits = await page.$$eval('#lista .ind .tit', t => t.map(x => x.textContent));
    assert.ok(!tits.includes('Del Valle Frut'));
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('AT mostra tudo; Venda Zero mostra revertidos hoje no meio', async () => {
    const {page, ctx, erros} = await abre('normal');
    await filtra(page, {gc: 'AT'});
    let g = await cascata(page, 'CCTM 2L PET', 'ICS_GC');
    assert.deepEqual(g.linhas.map(l => l.nome.split(' ·')[0]).slice(0, 3).sort(), ['SV.AT.1', 'SV.AT.2', 'SV.AT.3'],
                     'SV.AT.3 (sem vendedor) aparece');
    assert.equal(g.linhas[3].nome, 'Neutraliza', 'a 431 vai para a linha Neutraliza');
    const at3 = await page.evaluate(() => agrega(['AT31', 'AT32']).ind['CCTM 2L PET'].meta);
    assert.equal(g.linhas.find(l => l.nome.startsWith('SV.AT.3')).meta, at3, 'a SV.AT.3 soma só as normais');
    await page.keyboard.press('Escape');
    await filtra(page, {gc: 'G1'});
    g = await cascata(page, 'VENDAZERO', 'ICS_GC');
    assert.ok(g.linhas.length && g.linhas.every(l => /revertidos hoje/.test(l.meio)));
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('fechamento: sem tendência nem meta do dia, % realizado (ordem pelo código)', async () => {
    const {page, ctx, erros} = await abre('fech');
    await filtra(page, {gc: 'G1'});
    const g = await cascata(page, 'VOL REFRIGERANTES', 'VOLUME');
    const pctReal = await page.evaluate(() => [...svsVisiveis('G1').map(s => agrega(rotasNormais('G1', s))),
      agrega(rotasNeutraliza('G1'))].map(a => a.ind['VOL REFRIGERANTES'].pctReal));
    assert.deepEqual(g.linhas.map(l => l.dir).sort(), pctReal.sort());
    // ordem pelo código também no fechamento (antes: pelo % realizado)
    assert.deepEqual(g.linhas.map(l => l.nome), ['SV.G1.1 · Supervisor', 'SV.G1.2 · Supervisor', 'Neutraliza']);
    assert.equal(g.linhas[g.linhas.length - 1].nome, 'Neutraliza');
    assert.ok(g.linhas.every(l => /online hoje/.test(l.meio)));
    assert.match(g.sub, /realizado$/);
    assert.match(await page.textContent('#sub'), /Fechamento/);
    assert.deepEqual(erros, []);
    await ctx.close();
  });
});

describe('Parte D — Resumo de vendas', {skip: pular}, () => {
  test('Diretoria em faixas de 8; com uma gerência no filtro, o Resumo é o dela; reabrir volta para "Todas"', async () => {
    const {page, ctx, erros} = await abre('normal', {entrar: 'dir'});
    await page.click('#btnResumo');
    let r = await page.evaluate(() => ({
      faixas: [...document.querySelectorAll('#rsFolha .rs-bloco')][0].querySelectorAll('.rs-faixa').length,
      cab: [...document.querySelectorAll('#rsFolha .rs-bloco')][0].querySelectorAll('.rs-faixa .rs-tab thead th').length,
      seletor: !!document.getElementById('rsGc'),
      titulo: document.querySelector('#rsFolha h2').textContent,
      placa: !!document.querySelector('#rsFolha .rs-atencao'),
    }));
    assert.equal(r.faixas, 2, '15 gerências com dados: 8 + 7');
    assert.equal(r.cab, (1 + 1 + 8) * 2, 'faixa 1: nome + total + 8; faixa 2: nome + 7 + 2 em branco (alinhadas)');
    assert.equal(r.seletor, false, 'o Resumo segue o filtro da Diretoria (sem seletor próprio)');
    assert.equal(r.titulo, 'Resumo de vendas · Diretoria');
    const alinhadas = await page.evaluate(() => {
      const fx = [...document.querySelectorAll('#rsFolha .rs-bloco')][0].querySelectorAll('.rs-faixa .rs-tab thead');
      const xs = t => [...t.querySelectorAll('th')].map(th => Math.round(th.getBoundingClientRect().left));
      return JSON.stringify(xs(fx[0])) === JSON.stringify(xs(fx[1]));
    });
    assert.ok(alinhadas, 'colunas das faixas alinhadas');
    assert.equal(r.placa, false, 'placa ATENÇÃO desligada');
    await page.click('#rsVoltar');
    const gcAntes = await page.evaluate(() => sel.gc);
    await page.selectOption('#fgc', 'IT');
    await page.click('#btnResumo');
    r = await page.evaluate(() => ({
      titulo: document.querySelector('#rsFolha h2').textContent,
      cols: [...document.querySelector('#rsFolha .rs-tab thead').querySelectorAll('th')].map(t => t.firstChild.textContent),
      sel: [sel.modo, sel.dgc, sel.gc],
    }));
    assert.equal(r.titulo, 'Resumo de vendas · GC.IT · Itumbiara');
    assert.deepEqual(r.cols, ['Agrupador', 'GC.IT', 'SV.IT.1', 'SV.IT.2'], 'gerência + supervisões; Neutraliza sem coluna');
    assert.deepEqual(r.sel, ['dir', 'IT', gcAntes], 'o filtro da Gerência não muda');
    // reabrir a Diretoria volta para "Todas as gerências" (e o Resumo das 16)
    await page.click('#rsVoltar');
    await vaiPara(page, 'dir');
    assert.equal(await page.inputValue('#fgc'), '');
    await page.click('#btnResumo');
    assert.equal(await page.textContent('#rsFolha h2'), 'Resumo de vendas · Diretoria');
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('"Faltam" vermelho claro e colunas alinhadas', async () => {
    const {page, ctx, erros} = await abre('normal');
    await filtra(page, {gc: 'G1'});
    await page.click('#btnResumo');
    const r = await page.evaluate(() => {
      const f = document.querySelector('#rsFolha .rs-k.rs-faltam');
      const tabs = [...document.querySelectorAll('#rsFolha .rs-tab table')];
      return {faltam: f ? [getComputedStyle(f).backgroundColor, getComputedStyle(f.querySelector('strong')).color] : null,
              larguras: tabs.map(t => t.querySelector('th.rs-nome').getBoundingClientRect().width)};
    });
    assert.deepEqual(r.faltam, ['rgb(253, 231, 231)', 'rgb(198, 40, 40)']);
    assert.ok(r.larguras.every(w => Math.abs(w - r.larguras[0]) < 1), 'coluna de nomes igual em todos os blocos');
    assert.deepEqual(erros, []);
    await ctx.close();
  });
});

/* ---------- Parte G: sem regiões, nomes e ordem das gerências, filtro por gerência na Diretoria ---------- */
const ORDEM = ['AN', 'AP', 'AT', 'G1', 'G2', 'G3', 'PA', 'DI', 'RV', 'SL', 'GU', 'PO', 'IT', 'MO', 'UR', 'RI'];
const NOMES = {AN: 'Anápolis', AP: 'Aparecida', AT: 'Atacados', G1: 'Goiânia 01', G2: 'Goiânia 02', G3: 'Goiânia 03',
  PA: 'Palmas', DI: 'Dianópolis', RV: 'Rio Verde', SL: 'São Luís', GU: 'Gurupi', PO: 'Porangatu', IT: 'Itumbiara',
  MO: 'Morrinhos', UR: 'Uruaçu', RI: 'Rialma'};
const ROTULO = g => `GC.${g} · ${NOMES[g]}`;
const REGIAO = /Regi[aã]o|Matriz|\bSul\b|\bNorte\b/;
/* todo o texto da página (inclusive o escondido, opções e grupos de <select>) */
const textos = page => page.evaluate(() => [document.title, document.body.textContent,
  ...[...document.querySelectorAll('optgroup')].map(o => o.label)].join('\n'));
const opcoesGc = page => page.$$eval('#fgc option', os => os.map(o => [o.value, o.textContent, o.disabled]));
/* cabeçalhos do 1º bloco do Resumo (todas as faixas): [código, nome embaixo] */
const colunasRs = page => page.$eval('#rsFolha .rs-bloco', bl => [...bl.querySelectorAll('.rs-tab thead th')].map(t =>
  [t.firstChild ? t.firstChild.textContent : '', (t.querySelector('small') || {}).textContent || '']));

describe('Parte G — sem regiões, nomes e ordem das gerências, filtro da Diretoria', {skip: pular}, () => {
  test('nenhum texto de região: Gerência, Diretoria, cascata e Resumo (tela e título do PDF)', async () => {
    const {page, ctx, erros} = await abre('normal');
    const confere = async onde => assert.doesNotMatch(await textos(page), REGIAO, onde);
    await confere('Gerência');
    assert.equal(await page.$$eval('#fgc optgroup', g => g.length), 0, 'seletor sem grupos por região');
    await filtra(page, {gc: 'IT'});
    await cascata(page, 'VOL REFRIGERANTES', 'VOLUME');
    await confere('cascata da Gerência');
    await page.keyboard.press('Escape');
    await page.click('#btnResumo');
    await confere('Resumo da Gerência');
    assert.equal(await page.textContent('#rsFolha h2'), 'Resumo de vendas · GC.IT · Itumbiara');
    await page.click('#rsVoltar');
    await vaiPara(page, 'dir');
    await confere('Diretoria');
    await cascata(page, 'CCTM 2L PET', 'ICS_GC');
    await confere('cascata da Diretoria');
    await page.keyboard.press('Escape');
    await page.click('#btnResumo');
    await confere('Resumo da Diretoria');
    await page.click('#rsVoltar');
    await page.selectOption('#fgc', 'MO');
    await page.click('#btnResumo');
    await confere('Resumo de uma gerência na Diretoria');
    assert.equal(await page.textContent('#rsFolha h2'), 'Resumo de vendas · GC.MO · Morrinhos');
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('ordem e rótulos "GC.G1 · Goiânia 01" das 16: seletores, cabeçalho, cascata, Resumo e "puxa a média"', async () => {
    const {page, ctx, erros} = await abre('normal');
    const p = await page.evaluate(() => ({nomes: P.GC_NOMES, ativas: P.GC_ATIVAS, data: Object.keys(DATA), gc: sel.gc}));
    assert.deepEqual(Object.keys(p.nomes), ORDEM);
    assert.deepEqual(p.nomes, NOMES);
    assert.deepEqual(p.ativas, ORDEM.filter(g => g !== 'DI'), 'GC_ATIVAS: as com dados, na mesma ordem');
    assert.deepEqual(p.data, p.ativas);
    assert.equal(p.gc, 'AN', 'a Gerência abre na primeira da lista com dados');
    // seletor da Gerência: lista simples na ordem, DI sem dados desabilitada
    const lista = ORDEM.map(g => g === 'DI' ? [g, ROTULO(g) + ' · sem dados', true] : [g, ROTULO(g), false]);
    assert.deepEqual(await opcoesGc(page), lista);
    await filtra(page, {gc: 'G1'});
    assert.match(await page.textContent('#sub'), /· GC\.G1 · Goiânia 01$/);
    // Resumo da gerência: título com o rótulo; a 1ª coluna traz o nome da praça
    await page.click('#btnResumo');
    assert.equal(await page.textContent('#rsFolha h2'), 'Resumo de vendas · GC.G1 · Goiânia 01');
    assert.deepEqual((await colunasRs(page))[1], ['GC.G1', 'Goiânia 01']);
    await page.click('#rsVoltar');
    // Diretoria: seletor "Todas" + as 16; cascata com as 16 gerências; Resumo com as colunas na ordem
    await vaiPara(page, 'dir');
    assert.deepEqual(await opcoesGc(page), [['', 'Todas as gerências', false], ...lista]);
    assert.match(await page.textContent('#sub'), /· Diretoria$/);
    const g = await cascata(page, 'VOL REFRIGERANTES', 'VOLUME');
    assert.deepEqual(g.linhas.map(l => l.nome).sort(), ORDEM.map(ROTULO).sort());
    assert.deepEqual(g.linhas.filter(l => l.off).map(l => l.nome), ['GC.DI · Dianópolis']);
    await page.click(`#dCorpo .cLin[data-i="${g.linhas.findIndex(l => l.nome === 'GC.G2 · Goiânia 02')}"]`);
    assert.equal(await page.textContent('#dTit'), 'Refrigerantes · GC.G2 · Goiânia 02');
    await page.keyboard.press('Escape');
    await page.click('#btnResumo');
    const gcs = (await colunasRs(page)).filter(([c]) => c.startsWith('GC.'));
    assert.deepEqual(gcs.map(([c]) => c.slice(3)), ORDEM.filter(x => x !== 'DI'), 'colunas na ordem (faixas de 8 + 7)');
    assert.ok(gcs.every(([c, nm]) => nm === NOMES[c.slice(3)]), 'nome da praça embaixo do código');
    await page.click('#rsVoltar');
    // "gerência que mais puxa a média" com o rótulo: todas no ritmo, a MO zerada
    await filtra(page, {aba: 'ICS_GC'});
    for(const gc of ORDEM.filter(x => x !== 'DI')){
      const rotas = await page.evaluate(gc => rotasDe(gc, ''), gc);
      await ritmo(page, gc, rotas, gc === 'MO' ? 0 : 1);
    }
    await filtra(page, {});
    assert.match(await page.textContent('#puxa'), /Gerência que mais puxa a média para baixo: GC\.MO · Morrinhos/);
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('Diretoria com uma gerência: cards, cascata (supervisões, Neutraliza, nota das virtuais) e Resumo dela', async () => {
    const {page, ctx, erros} = await abre('normal');
    const gcGerencia = await page.evaluate(() => sel.gc);
    await vaiPara(page, 'dir');
    const k = 'VOL REFRIGERANTES';
    const todas = await page.evaluate(k => agrega(rotasAtuais()).ind[k].meta, k);
    await page.selectOption('#fgc', 'G2');
    await filtra(page, {aba: 'VOLUME'});
    const r = await page.evaluate(k => ({rotas: rotasAtuais(), g2: rotasDe('G2', ''), meta: agrega(rotasAtuais()).ind[k].meta,
      metaG2: agrega(rotasDe('G2', '')).ind[k].meta, base: document.getElementById('nBase').textContent,
      baseG2: agrega(rotasDe('G2', '')).tot.baseTotal.toLocaleString('pt-BR'), sub: document.getElementById('sub').textContent,
      tits: [...document.querySelectorAll('#lista .ind .tit')].map(t => t.textContent),
      sv: [document.getElementById('fsv').hidden, document.getElementById('frota').hidden]}), k);
    assert.deepEqual(r.rotas, r.g2, 'cards só da G2');
    assert.ok(r.meta === r.metaG2 && r.meta < todas);
    assert.equal(r.base, r.baseG2);
    assert.match(r.sub, /· Diretoria · GC\.G2 · Goiânia 02$/);
    assert.ok(!r.tits.includes('Del Valle Frut'), 'Del Valle Frut continua fora da Diretoria');
    assert.deepEqual(r.sv, [true, true], 'na Diretoria só o filtro de gerência');
    // cascata: card -> supervisões (com a linha Neutraliza) -> rotas -> clientes
    let g = await cascata(page, k, 'VOLUME');
    assert.equal(g.tit, 'Refrigerantes · GC.G2 · Goiânia 02');
    assert.equal(g.volta, '');
    assert.deepEqual(g.linhas.map(l => l.nome).sort(), ['Neutraliza', 'SV.G2.1 · Supervisor', 'SV.G2.2 · Supervisor']);
    assert.ok(Math.abs(somaMeta(g.linhas) - r.metaG2) < 1e-6, 'linhas = card');
    await page.click('#dCorpo .cLin[data-i="0"]');
    g = await lerGaveta(page);
    assert.equal(g.volta, '← Supervisões');
    assert.ok(g.linhas.length && g.linhas.every(l => /^Rota /.test(l.nome)));
    await page.click('#dCorpo .cLin[data-i="0"]');
    g = await lerGaveta(page);
    assert.ok(g.clientes.length > 0);
    await page.keyboard.press('Escape');
    // AN: a nota das virtuais, como na Gerência
    await page.selectOption('#fgc', 'AN');
    g = await cascata(page, k, 'VOLUME');
    assert.equal(g.nota.length, 1);
    assert.match(g.nota[0].texto, /^Inclui rotas virtuais: Meta /);
    await page.keyboard.press('Escape');
    // "puxa a média": as supervisões da gerência escolhida
    await page.selectOption('#fgc', 'G2');
    await filtra(page, {aba: 'ICS_GC'});
    await ritmo(page, 'G2', await page.evaluate(() => rotasDe('G2', '')), 1);
    await ritmo(page, 'G2', ['G211', 'G212'], 0);
    await filtra(page, {});
    assert.match(await page.textContent('#puxa'), /Supervisão que mais puxa a média para baixo: SV\.G2\.1/);
    // Resumo: o da G2 (gerência + supervisões)
    await page.click('#btnResumo');
    assert.equal(await page.textContent('#rsFolha h2'), 'Resumo de vendas · GC.G2 · Goiânia 02');
    assert.deepEqual((await colunasRs(page)).map(c => c[0]), ['Agrupador', 'GC.G2', 'SV.G2.1', 'SV.G2.2']);
    await page.click('#rsVoltar');
    // a escolha não muda a Gerência e volta para "Todas" ao reabrir a Diretoria
    await vaiPara(page, 'gc');
    assert.deepEqual(await page.evaluate(() => [sel.modo, sel.gc, document.getElementById('fgc').value]),
                     ['gc', gcGerencia, gcGerencia]);
    await vaiPara(page, 'dir');
    assert.deepEqual(await page.evaluate(() => [sel.dgc, document.getElementById('fgc').value]), ['', '']);
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('link do Resumo da Diretoria: com gerência abre o dela; link antigo com região abre o de todas', async () => {
    let {page, ctx, erros} = await abre('normal', {entrar: null, busca: '?resumo=vol,ics&modo=dir&gc=IT'});
    assert.deepEqual(await page.evaluate(() => [sel.modo, sel.dgc, document.getElementById('fgc').value]), ['dir', 'IT', 'IT']);
    assert.equal(await page.textContent('#rsFolha h2'), 'Resumo de vendas · GC.IT · Itumbiara');
    assert.deepEqual(erros, []);
    await ctx.close();
    ({page, ctx, erros} = await abre('normal', {entrar: null, busca: '?resumo=vol&modo=dir&reg=Sul'}));
    assert.deepEqual(await page.evaluate(() => [sel.modo, sel.dgc]), ['dir', '']);
    assert.equal(await page.textContent('#rsFolha h2'), 'Resumo de vendas · Diretoria');
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('payload antigo com REGIOES (sem GC_NOMES): ignora a chave e não quebra', async () => {
    const {page, ctx, erros} = await abre('antigo');
    assert.doesNotMatch(await textos(page), REGIAO);
    const op = await opcoesGc(page);
    assert.deepEqual(op.map(o => o[0]), ['G1', 'G2', 'G3', 'AP', 'IT', 'MO', 'AT', 'AN', 'SL', 'RV', 'RI', 'UR', 'GU', 'PO', 'PA'],
                     'ordem do GC_ATIVAS do payload');
    assert.deepEqual(op.slice(0, 2).map(o => o[1]), ['GC.G1', 'GC.G2'], 'sem GC_NOMES: só o código');
    await cascata(page, 'VOL REFRIGERANTES', 'VOLUME');
    await page.keyboard.press('Escape');
    await page.click('#btnResumo');
    assert.equal(await page.textContent('#rsFolha h2'), 'Resumo de vendas · GC.G1');
    await page.click('#rsVoltar');
    await vaiPara(page, 'dir');
    await page.selectOption('#fgc', 'IT');
    await cascata(page, 'CCTM 2L PET', 'ICS_GC');
    await page.keyboard.press('Escape');
    await page.click('#btnResumo');
    assert.equal(await page.textContent('#rsFolha h2'), 'Resumo de vendas · GC.IT');
    assert.doesNotMatch(await textos(page), REGIAO);
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('Gerência inalterada: filtros de supervisão e rota, cascata a partir das supervisões', async () => {
    // perfil Gerência: a gerência vem do login (sem seletor de gerência)
    const {page, ctx, erros} = await abre('normal', {entrar: {perfil: 'gc', gc: 'G3'}});
    const r = await page.evaluate(() => ({sel: [sel.modo, sel.gc, sel.sv, sel.rota],
      vis: [document.getElementById('fsv').hidden, document.getElementById('frota').hidden],
      svs: [...document.querySelectorAll('#fsv option')].map(o => o.value).filter(Boolean)}));
    assert.deepEqual(r.sel, ['gc', 'G3', '', '']);
    assert.deepEqual(r.vis, [false, false]);
    assert.deepEqual(r.svs, ['SV.G3.1', 'SV.G3.2', 'SV.G3.3']);
    const g = await cascata(page, 'CCTM 2L PET', 'ICS_GC');
    assert.equal(g.tit, 'CCTM 2L Pet · GC.G3 · Goiânia 03');
    assert.ok(g.linhas.length && g.linhas.every(l => /^SV\.G3\./.test(l.nome)));
    assert.deepEqual(erros, []);
    await ctx.close();
  });
});

/* ---------- Parte H: ordem das listas da cascata ---------- */
/* Embaralha a G1 no navegador (só DATA): a SV.G1.2 vira SV.G1.10 com as rotas G129 e G1210 (antes G121 e G122), a
   SV.G1.1 se divide em SV.G1.1 (G111) e SV.G1.2 (G112), as chaves ficam fora de ordem e as gerências de DATA invertidas. */
const embaralha = page => page.evaluate(() => {
  const g1 = DATA.G1, s1 = g1['SV.G1.1'], s2 = g1['SV.G1.2'];
  DATA.G1 = {'SV.G1.5': g1['SV.G1.5'], 'SV.G1.10': {G1210: s2.G122, G129: s2.G121}, 'SV.G1.2': {G112: s1.G112},
             'SV.G1.1': {G111: s1.G111}};
  P.NOME_SUPERVISOR['SV.G1.10'] = 'SUPERVISOR G1 10';
  DATA = Object.fromEntries(Object.entries(DATA).reverse());
  ROTA_IDX = {};
  for(const gc in DATA) for(const sv in DATA[gc]) for(const r in DATA[gc][sv]) ROTA_IDX[r] = [gc, sv];
});
/* linhas da gaveta: [nome, meta, número da direita, cor] */
const linhasCor = page => page.$$eval('#dCorpo .cLin', ls => ls.map(l => [l.querySelector('.cNome b').textContent,
  Number(l.dataset.meta), l.dataset.dir === '' ? null : Number(l.dataset.dir), l.classList.contains('ok') ? 'ok' : 'no']));

describe('Parte H — ordem das listas da cascata', {skip: pular}, () => {
  test('ordem natural dos códigos', async () => {
    const {page, ctx, erros} = await abre('normal');
    const r = await page.evaluate(() => [['A12', '111', 'I11', 'A11', '112', 'M21', '151'].sort(ordemNatural),
      ['SV.G1.10', 'SV.G1.2', 'SV.G1.1', 'SV.G1.5'].sort(ordemNatural), ['G1210', 'G129', 'G2110', 'G211'].sort(ordemNatural),
      ['sv.g1.2', 'SV.G1.02', 'SV.G1.1'].sort(ordemNatural)]);
    assert.deepEqual(r, [['111', '112', '151', 'A11', 'A12', 'I11', 'M21'], ['SV.G1.1', 'SV.G1.2', 'SV.G1.5', 'SV.G1.10'],
                         ['G129', 'G211', 'G1210', 'G2110'], ['SV.G1.1', 'SV.G1.02', 'sv.g1.2']]);
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  for(const nome of ['normal', 'fech']){
    test(`gerências, supervisões ("Neutraliza" por último), rotas e clientes pelo código (${nome})`, async () => {
      const {page, ctx, erros} = await abre(nome);
      const k = 'VOL REFRIGERANTES', ORDEM_SV = ['SV.G1.1 · Supervisor', 'SV.G1.2 · Supervisor', 'SV.G1.10 · Supervisor',
        'Neutraliza'];
      await embaralha(page);
      // números diferentes por linha: pela ordem antiga (tendência / % realizado) a ordem seria outra
      for(const [rs, f] of [[['G111'], 0.2], [['G112'], 0.6], [['G129'], 0.9], [['G1210'], 1.2], [['151'], 2]])
        await ritmo(page, 'G1', rs, f);
      await filtra(page, {gc: 'G1'});
      let g = await cascata(page, k, 'VOLUME');
      assert.deepEqual(g.linhas.map(l => l.nome), ORDEM_SV);
      // cada linha com os números e a cor de agrega() do grupo (só a ordem muda)
      const esperado = await page.evaluate(k => [['G111'], ['G112'], ['G129', 'G1210'], ['151']].map(rs => {
        const b = agrega(rs).ind[k];
        return [b.meta, P.FECHAMENTO ? b.pctReal : b.pctTendencia, b.onPace ? 'ok' : 'no'];
      }), k);
      assert.deepEqual((await linhasCor(page)).map(l => l.slice(1)), esperado);
      assert.notDeepEqual([0, 1, 2].sort((a, b) => esperado[b][1] - esperado[a][1]), [0, 1, 2],
                          'a ordem antiga (pelos números) seria outra');
      // SV.G1.10: rotas em ordem natural (G129 antes de G1210)
      await page.click('#dCorpo .cLin[data-i="2"]');
      g = await lerGaveta(page);
      assert.deepEqual(g.linhas.map(l => l.nome), ['Rota G129', 'Rota G1210']);
      await page.click('#cVolta');
      // clientes de volume: Meta, Real, Dif. Abs e %, do mais negativo para o mais positivo
      await page.click('#dCorpo .cLin[data-i="0"]');
      await page.click('#dCorpo .cLin[data-i="0"]');
      g = await lerGaveta(page);
      assert.deepEqual(await page.$$eval('#dCorpo .cCab span', s => s.map(x => x.textContent)),
                       ['Cliente', 'Meta', 'Real', 'Dif. Abs', '%']);
      assert.ok(g.clientes.length > 1 && g.clientes.every((d, i) => i === 0 || g.clientes[i - 1] <= d), 'Dif. Abs crescente');
      await page.keyboard.press('Escape');
      // Diretoria: gerências na ordem fixa, mesmo com DATA invertido e a RI com o maior número
      await vaiPara(page, 'dir');
      const gcs = ORDEM.filter(x => x !== 'DI');
      for(const [i, gc] of gcs.entries())
        await ritmo(page, gc, await page.evaluate(gc => rotasDe(gc, ''), gc), 0.1 + i * 0.1);
      await filtra(page, {});
      g = await cascata(page, k, 'VOLUME');
      assert.deepEqual(g.linhas.map(l => l.nome), ORDEM.map(ROTULO));
      await page.click(`#dCorpo .cLin[data-i="${ORDEM.indexOf('G1')}"]`);
      g = await lerGaveta(page);
      assert.deepEqual(g.linhas.map(l => l.nome), ORDEM_SV);
      await page.keyboard.press('Escape');
      // cobertura: lista de clientes como antes (pelo nome)
      await filtra(page, {});
      await vaiPara(page, 'gc');
      await filtra(page, {gc: 'G2', sv: 'SV.G2.1', rota: 'G211'});
      await cascata(page, 'KAPO', 'ICS_GC');
      await page.click('#dLista .dchip[data-d="Todos"]');
      const nomes = await page.$$eval('#dLista .item .nm', ns => ns.map(n => n.firstChild.textContent));
      assert.ok(nomes.length > 1);
      assert.deepEqual(nomes, [...nomes].sort((a, b) => a.localeCompare(b)));
      assert.deepEqual(erros, []);
      await ctx.close();
    });
  }

  test('rota oculta das eventuais (-EV) nunca aparece em lista, mesmo fora de VIRTUAIS_ROTAS; o Real fica no total', async () => {
    const {page, ctx, erros} = await abre('normal');
    const k = 'VOL REFRIGERANTES';
    await page.evaluate(() => { P.VIRTUAIS_ROTAS = P.VIRTUAIS_ROTAS.filter(r => r !== 'SL-EV'); });
    await filtra(page, {gc: 'SL', aba: 'VOLUME'});
    const op = await opcoes(page);
    assert.deepEqual(op.sv, ['SV.SL.1', 'SV.SL.2']);
    assert.ok(!op.rota.includes('SL-EV'), op.rota.join('|'));
    const r = await page.evaluate(k => ({card: agrega(rotasAtuais()).ind[k].real,
      soma: rotasDe('SL', '').reduce((a, x) => a + nodo('SL', x).indicators[k].real, 0)}), k);
    assert.equal(r.card, r.soma, 'o Real da rota oculta continua no total');
    const g = await cascata(page, k, 'VOLUME');
    assert.ok(!g.linhas.some(l => /EV/.test(l.nome)), g.linhas.map(l => l.nome).join('|'));
    assert.deepEqual(g.nota.map(n => n.texto), ['Inclui clientes de rotas eventuais (EV*): Real 120']);
    assert.deepEqual(erros, []);
    await ctx.close();
  });
});

/* ---------- Parte I: entrada com perfis (por seleção), acesso guardado e virada diária ---------- */
const REINICIADO = 'Acesso reiniciado, entre novamente', INDISPONIVEL = 'O acesso anterior não está mais disponível';
// relógio fixo: 13/10/2026 10:00 de Brasília (dia de trabalho 2026-10-13)
const HOJE = new Date('2026-10-13T13:00:00Z'), DIA = '2026-10-13';
const fixo = (quando = HOJE) => page => page.clock.setFixedTime(quando);
/* acesso guardado em 'drotas_sessao' (dia = null: sem o campo) */
const sessao = (a, dia = DIA) => JSON.stringify({gc: '', sv: '', rota: '', ...a, ...(dia ? {dia} : {})});
/* estado da tela: entrada, aviso, acesso em uso, filtro, filtros visíveis, cabeçalho, botão do Resumo e acesso guardado */
const estado = page => page.evaluate(() => ({
  entrada: !document.getElementById('entrada').hidden,
  msg: document.getElementById('entMsg').textContent,
  acesso: ACESSO && [ACESSO.perfil, ACESSO.gc, ACESSO.sv, ACESSO.rota],
  sel: [sel.modo, sel.modo === 'dir' ? sel.dgc : sel.gc, sel.sv, sel.rota],
  filtros: ['fgc', 'fsv', 'frota'].filter(id => !document.getElementById(id).hidden),
  sub: document.getElementById('sub').textContent,
  resumo: !document.querySelector('.rsBox').hidden,
  guardado: (() => { try { return JSON.parse(localStorage.getItem('drotas_sessao')); } catch(e) { return 'sem armazenamento'; } })(),
}));
const guardadoTxt = page => page.evaluate(() => localStorage.getItem('drotas_sessao'));

/* opções da caixa de seleção: 1ª etapa [chave, rótulo, desabilitada]; 2ª etapa [código, rótulo] e os nomes das seções */
const caixa = page => page.evaluate(() => {
  const c = document.getElementById('entCaixa'), a = document.activeElement || {};
  return {vis: !c.hidden, tit: document.getElementById('entCaixaTit').textContent,
    sub: document.getElementById('entCaixaSub').textContent, voltar: !document.getElementById('entVoltar').hidden,
    gcs: [...c.querySelectorAll('#entOpcoes button[data-gc]')].map(b => [b.dataset.gc, b.textContent, b.disabled]),
    itens: [...c.querySelectorAll('#entOpcoes button:not([data-gc])')].map(b => [b.dataset.sv || b.dataset.rota, b.textContent]),
    secoes: [...c.querySelectorAll('#entOpcoes .entSecao')].map(s => s.textContent),
    foco: a.dataset ? (a.dataset.gc || a.dataset.sv || a.dataset.rota || a.id || a.textContent) : '',
    campos: document.querySelectorAll('#entrada input, #entrada textarea, #entrada select, #entrada form').length};
});
// as 12 opções da 1ª etapa, na ordem de GC_ATIVAS com cada grupo na posição do 1º membro
const OPCOES_GC = [...['AN', 'AP', 'AT', 'G1', 'G2', 'G3'].map(g => [g, ROTULO(g), false]),
  ['PA+DI', 'GC.PA + GC.DI · Palmas + Dianópolis', false], ['RV', ROTULO('RV'), false], ['SL', ROTULO('SL'), false],
  ['GU+PO', 'GC.GU + GC.PO · Gurupi + Porangatu', false], ['IT+MO', 'GC.IT + GC.MO · Itumbiara + Morrinhos', false],
  ['UR+RI', 'GC.UR + GC.RI · Uruaçu + Rialma', false]];
const GRUPO_IT_MO = 'GC.IT + GC.MO · Itumbiara + Morrinhos';

describe('Parte I — entrada por seleção', {skip: pular}, () => {
  test('quatro botões; Diretoria entra direto, sem usuário, senha nem campo de texto', async () => {
    const {page, ctx, erros} = await abre('normal', {entrar: null, antes: fixo()});
    assert.deepEqual(await page.$$eval('#entBotoes button', bs => bs.map(b => b.textContent)),
                     ['DIRETORIA', 'GERÊNCIA', 'SUPERVISÃO', 'ROTA']);
    let e = await estado(page);
    assert.deepEqual([e.entrada, e.msg, e.guardado, e.acesso], [true, '', null, null]);
    assert.equal((await caixa(page)).campos, 0, 'sem campo de texto');
    assert.doesNotMatch(await page.textContent('#entrada'), /usu[aá]rio|senha|DICOM/i);
    await page.click('#entrada [data-perfil="dir"]');
    e = await estado(page);
    assert.ok(!e.entrada);
    assert.deepEqual([e.sel, e.filtros, e.resumo], [['dir', '', '', ''], ['fgc'], true]);
    assert.equal(await page.inputValue('#fgc'), '', '"Todas as gerências"');
    assert.match(e.sub, /· Diretoria$/);
    assert.deepEqual(e.guardado, {perfil: 'dir', gc: '', sv: '', rota: '', dia: DIA});
    assert.equal((await caixa(page)).vis, false);
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('Gerência: caixa sem campo de texto, 12 opções (grupos na posição do 1º membro); foco, setas, Tab, ESC, × e clique fora', async () => {
    const {page, ctx, erros} = await abre('normal', {entrar: null, antes: fixo()});
    await page.click('#entrada [data-perfil="gc"]');
    let c = await caixa(page);
    assert.deepEqual([c.vis, c.tit, c.sub, c.voltar, c.campos], [true, 'GERÊNCIA', 'Escolha a gerência', false, 0]);
    assert.deepEqual(await page.$eval('#entCaixa', el => [el.getAttribute('role'), el.getAttribute('aria-modal')]),
                     ['dialog', 'true']);
    assert.deepEqual(c.gcs, OPCOES_GC, 'PA+DI habilitado: o PA tem dados');
    assert.equal(c.foco, 'AN', 'foco na primeira opção');
    await page.keyboard.press('ArrowDown');
    assert.equal((await caixa(page)).foco, 'AP');
    await page.keyboard.press('ArrowUp');
    assert.equal((await caixa(page)).foco, 'AN');
    // Tab fica preso na caixa: da última opção volta para o ×; Shift+Tab no × vai para a última opção
    await page.focus('#entOpcoes [data-gc="UR+RI"]');
    await page.keyboard.press('Tab');
    assert.equal((await caixa(page)).foco, 'entFechar');
    await page.keyboard.press('Shift+Tab');
    assert.equal((await caixa(page)).foco, 'UR+RI');
    // a lista rola dentro da caixa
    assert.equal(await page.$eval('#entOpcoes', el => getComputedStyle(el).overflowY), 'auto');
    // ESC, × e clique fora fecham sem entrar; o foco volta ao botão do perfil
    await page.keyboard.press('Escape');
    c = await caixa(page);
    let e = await estado(page);
    assert.deepEqual([c.vis, c.foco, e.entrada, e.guardado], [false, 'GERÊNCIA', true, null]);
    await page.click('#entrada [data-perfil="gc"]');
    await page.click('#entFechar');
    assert.deepEqual([(await caixa(page)).vis, (await estado(page)).entrada], [false, true]);
    await page.click('#entrada [data-perfil="gc"]');
    await page.mouse.click(3, 3);
    assert.deepEqual([(await caixa(page)).vis, (await estado(page)).entrada], [false, true]);
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('gerência e grupo sem dados aparecem desabilitados e não entram', async () => {
    const {page, ctx, erros} = await abre('semdados', {entrar: null, antes: fixo()});
    for(const perfil of ['gc', 'sv', 'rota']){
      await page.click(`#entrada [data-perfil="${perfil}"]`);
      const c = await caixa(page);
      assert.deepEqual(c.gcs.filter(o => o[2]), [['G3', ROTULO('G3') + ' · sem dados', true],
        ['PA+DI', 'GC.PA + GC.DI · Palmas + Dianópolis · sem dados', true]], perfil);
      assert.equal(c.gcs.length, 12);
      await page.$eval('#entOpcoes [data-gc="G3"]', b => b.click());
      await page.$eval('#entOpcoes [data-gc="PA+DI"]', b => b.click());
      const d = await caixa(page);
      assert.deepEqual([d.vis, d.sub, (await estado(page)).acesso], [true, 'Escolha a gerência', null], perfil);
      await page.click('#entFechar');
    }
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('Gerência individual: gerência travada, supervisão e rota livres; cascata a partir das supervisões', async () => {
    const {page, ctx, erros} = await abre('normal', {entrar: null, antes: fixo()});
    await entra(page, {perfil: 'gc', gc: 'G2'});
    let e = await estado(page);
    assert.deepEqual([e.entrada, e.sel, e.filtros, e.resumo], [false, ['gc', 'G2', '', ''], ['fsv', 'frota'], true]);
    assert.ok(e.sub.endsWith('· Gerência · GC.G2 · Goiânia 02'), e.sub);
    assert.deepEqual(e.guardado, {perfil: 'gc', gc: 'G2', sv: '', rota: '', dia: DIA});
    await page.selectOption('#fsv', 'SV.G2.1');
    await page.selectOption('#frota', 'G212');
    e = await estado(page);
    assert.deepEqual([e.sel, e.filtros], [['gc', 'G2', 'SV.G2.1', 'G212'], ['fsv', 'frota']]);
    assert.ok(e.sub.endsWith('· Gerência · GC.G2 · Goiânia 02 · SV.G2.1 · Supervisor · Rota G212 — Consultor G212'), e.sub);
    await page.selectOption('#fsv', 'Neutraliza');
    assert.deepEqual((await estado(page)).sel, ['gc', 'G2', 'Neutraliza', '']);
    await page.selectOption('#fsv', '');
    const g = await cascata(page, 'CCTM 2L PET', 'ICS_GC');
    assert.deepEqual(g.linhas.map(l => l.nome), ['SV.G2.1 · Supervisor', 'SV.G2.2 · Supervisor', 'Neutraliza']);
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('grupo IT+MO: total das duas (cards, uma linha "Neutraliza", notas, "puxa a média"); seletor Total / IT / MO filtra tudo', async () => {
    const {page, ctx, erros} = await abre('grupo', {entrar: null, antes: fixo()});
    await entra(page, {perfil: 'gc', gc: 'IT+MO'});
    let e = await estado(page);
    assert.deepEqual([e.entrada, e.sel, e.filtros, e.resumo], [false, ['gc', 'IT+MO', '', ''], ['fgc', 'fsv', 'frota'], true]);
    assert.ok(e.sub.endsWith(`· Gerência · ${GRUPO_IT_MO}`), e.sub);
    assert.deepEqual(e.guardado, {perfil: 'gc', gc: 'IT+MO', sv: '', rota: '', dia: DIA});
    assert.deepEqual(await opcoesGc(page), [['IT+MO', 'Total (GC.IT + GC.MO)', false], ['IT', ROTULO('IT'), false],
                                            ['MO', ROTULO('MO'), false]]);
    // cards = soma das duas gerências inteiras (normais, Neutraliza, a virtual I32 e a eventual MO-EV)
    const confereCards = async gcs => {
      const r = await page.evaluate(gcs => {
        const todas = gcs.flatMap(g => Object.values(DATA[g]).flatMap(s => Object.keys(s)));
        const soma = (k, c) => todas.reduce((a, x) => { const b = nodo('', x).indicators[k]; return a + (b.unavailable ? 0 : b[c] || 0); }, 0);
        const card = agrega(rotasAtuais()).ind;
        return {rotas: [...rotasAtuais()].sort(), todas: [...todas].sort(),
          cards: ['VOL REFRIGERANTES', 'CCTM 2L PET'].map(k => [card[k].meta, card[k].real]),
          somas: ['VOL REFRIGERANTES', 'CCTM 2L PET'].map(k => [soma(k, 'meta'), soma(k, 'real')]),
          base: document.getElementById('nBase').textContent,
          baseVis: todas.filter(x => !ehVirtual(x)).reduce((a, x) => a + nodo('', x).baseTotal, 0).toLocaleString('pt-BR')};
      }, gcs);
      assert.deepEqual(r.rotas, r.todas, gcs.join('+'));
      assert.deepEqual(r.cards, r.somas, gcs.join('+'));
      assert.equal(r.base, r.baseVis, gcs.join('+'));
      return r;
    };
    const total = await confereCards(['IT', 'MO']);
    assert.ok(total.rotas.includes('I32') && total.rotas.includes('MO-EV') && total.rotas.includes('I31'));
    let op = await opcoes(page);
    assert.deepEqual(op.sv, ['SV.IT.1', 'SV.IT.2', 'SV.MO.1', 'SV.MO.2', 'Neutraliza'], 'supervisões das duas; uma "Neutraliza"');
    assert.ok(!op.rota.some(r => ['I32', 'MO-EV'].includes(r)) && op.rota.includes('I31') && op.rota.includes('M31'), op.rota.join('|'));
    // cascata: supervisões das duas (gerência -> número), UMA linha "Neutraliza", notas das virtuais e das eventuais
    const k = 'VOL REFRIGERANTES';
    let g = await cascata(page, k, 'VOLUME');
    assert.equal(g.tit, `Refrigerantes · ${GRUPO_IT_MO}`);
    assert.deepEqual(g.linhas.map(l => l.nome), ['SV.IT.1 · Supervisor', 'SV.IT.2 · Supervisor', 'SV.MO.1 · Supervisor',
                                                 'SV.MO.2 · Supervisor', 'Neutraliza']);
    assert.equal(await page.textContent('#dCorpo .cLin[data-i="4"] .cNome small'), '2 rotas');
    assert.deepEqual(g.nota.map(n => n.texto.split(':')[0]), ['Inclui rotas virtuais', 'Inclui clientes de rotas eventuais (EV*)']);
    assert.equal(g.nota[1].real, 77);
    const card = await page.evaluate(k => agrega(rotasAtuais()).ind[k], k);
    const somaReal = g.linhas.reduce((a, l) => a + l.real, 0) + g.nota.reduce((a, n) => a + n.real, 0);
    assert.ok(Math.abs(somaMeta(g.linhas) + g.nota[0].meta - card.meta) < 1e-6, 'linhas + nota = card (Meta)');
    assert.ok(Math.abs(somaReal - card.real) < 1e-6, 'linhas + notas = card (Real)');
    await page.click('#dCorpo .cLin[data-i="4"]');
    g = await lerGaveta(page);
    assert.deepEqual([g.tit, g.linhas.map(l => l.nome)], ['Refrigerantes · Neutraliza · IT + MO', ['Rota I31', 'Rota M31']]);
    await page.keyboard.press('Escape');
    // "puxa a média" entre as supervisões das duas
    await filtra(page, {aba: 'ICS_GC'});
    await ritmo(page, 'IT', await page.evaluate(() => rotasDe('IT+MO', '')), 1);
    await ritmo(page, 'MO', ['MO21', 'MO22'], 0);
    await filtra(page, {});
    assert.match(await page.textContent('#puxa'), /Supervisão que mais puxa a média para baixo: SV\.MO\.2/);
    // uma das duas no seletor: tudo filtrado para ela (cards, filtros, cascata, cabeçalho)
    for(const [gc, svs, linhas, notas] of [
      ['MO', ['SV.MO.1', 'SV.MO.2', 'Neutraliza'], ['SV.MO.1 · Supervisor', 'SV.MO.2 · Supervisor', 'Neutraliza'],
       ['Inclui clientes de rotas eventuais (EV*)']],
      ['IT', ['SV.IT.1', 'SV.IT.2', 'Neutraliza'], ['SV.IT.1 · Supervisor', 'SV.IT.2 · Supervisor', 'Neutraliza'],
       ['Inclui rotas virtuais']]]){
      await page.selectOption('#fgc', gc);
      e = await estado(page);
      assert.deepEqual([e.sel, e.filtros], [['gc', gc, '', ''], ['fgc', 'fsv', 'frota']]);
      assert.ok(e.sub.endsWith(`· Gerência · ${ROTULO(gc)}`), e.sub);
      assert.equal((await opcoesGc(page)).length, 3, 'o seletor continua com Total e as duas');
      await confereCards([gc]);
      op = await opcoes(page);
      assert.deepEqual(op.sv, svs);
      assert.ok(op.rota.every(r => r.startsWith(gc[0])), op.rota.join('|'));
      g = await cascata(page, k, 'VOLUME');
      assert.deepEqual(g.linhas.map(l => l.nome), linhas);
      assert.deepEqual(g.nota.map(n => n.texto.split(':')[0]), notas);
      await page.keyboard.press('Escape');
      assert.deepEqual((await estado(page)).guardado, {perfil: 'gc', gc: 'IT+MO', sv: '', rota: '', dia: DIA});
    }
    // supervisão e rota dentro da escolha
    await page.selectOption('#fsv', 'SV.IT.1');
    assert.deepEqual((await opcoes(page)).rota, ['IT11', 'IT12']);
    // de volta ao Total: as duas de novo, filtros zerados
    await page.selectOption('#fgc', 'IT+MO');
    assert.deepEqual((await estado(page)).sel, ['gc', 'IT+MO', '', '']);
    await confereCards(['IT', 'MO']);
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('Resumo do grupo: Total = as duas lado a lado (como na Diretoria); uma gerência = o Resumo dela', async () => {
    const {page, ctx, erros} = await abre('grupo', {entrar: {perfil: 'gc', gc: 'IT+MO'}, antes: fixo()});
    await page.click('#btnResumo');
    assert.equal(await page.textContent('#rsFolha h2'), `Resumo de vendas · ${GRUPO_IT_MO}`);
    assert.deepEqual(await colunasRs(page), [['Agrupador', ''], ['GC.IT + GC.MO', 'Itumbiara + Morrinhos'],
                                              ['GC.IT', 'Itumbiara'], ['GC.MO', 'Morrinhos']]);
    // Online de Refrigerantes: total = IT + MO
    const onl = await page.$eval('#rsFolha .rs-bloco', bl => [...bl.querySelectorAll('.rs-tab tbody tr:first-child td:not(.rs-nome)')]
      .map(td => Number(([...td.querySelectorAll('.rs-k')].find(k => k.querySelector('small').textContent === 'Online')
        .querySelector('strong').textContent).replace(/\./g, ''))));
    assert.equal(onl.length, 3);
    assert.ok(onl[1] > 0 && onl[2] > 0 && onl[0] === onl[1] + onl[2], onl.join('|'));
    assert.doesNotMatch(await page.textContent('#rsFolha'), /Neutraliza|I31|M31|I32|MO-EV/);
    await page.click('#rsVoltar');
    await page.selectOption('#fgc', 'IT');
    await page.click('#btnResumo');
    assert.equal(await page.textContent('#rsFolha h2'), 'Resumo de vendas · GC.IT · Itumbiara');
    assert.deepEqual((await colunasRs(page)).map(c => c[0]), ['Agrupador', 'GC.IT', 'SV.IT.1', 'SV.IT.2']);
    await page.click('#rsVoltar');
    await page.selectOption('#fgc', 'MO');
    await page.click('#btnResumo');
    assert.equal(await page.textContent('#rsFolha h2'), 'Resumo de vendas · GC.MO · Morrinhos');
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('Supervisão em duas etapas: gerência, depois as supervisões dela (no grupo, as das duas); travada', async () => {
    const {page, ctx, erros} = await abre('normal', {entrar: null, antes: fixo()});
    await page.click('#entrada [data-perfil="sv"]');
    let c = await caixa(page);
    assert.deepEqual([c.tit, c.sub, c.gcs, c.campos], ['SUPERVISÃO', 'Escolha a gerência', OPCOES_GC, 0]);
    const lista = async gc => {
      await page.click(`#entOpcoes [data-gc="${gc}"]`);
      const x = await caixa(page);
      assert.ok(x.voltar && x.sub === `${gc.includes('+') ? OPCOES_GC.find(o => o[0] === gc)[1] : ROTULO(gc)} · escolha a supervisão`, x.sub);
      assert.equal(x.foco, x.itens[0][0], 'foco na primeira supervisão');
      await page.click('#entVoltar');
      assert.deepEqual([(await caixa(page)).sub, (await caixa(page)).voltar], ['Escolha a gerência', false]);
      return x;
    };
    const casos = {G2: ['SV.G2.1', 'SV.G2.2'], G3: ['SV.G3.1', 'SV.G3.2'], AT: ['SV.AT.1', 'SV.AT.2', 'SV.AT.3'],
      AN: ['SV.AN.1', 'SV.AN.2'], SL: ['SV.SL.1', 'SV.SL.2'], 'IT+MO': ['SV.IT.1', 'SV.IT.2', 'SV.MO.1', 'SV.MO.2'],
      'UR+RI': ['SV.UR.1', 'SV.UR.2', 'SV.RI.1', 'SV.RI.2']};
    for(const [gc, svs] of Object.entries(casos)){
      const x = await lista(gc);
      assert.deepEqual(x.itens.map(i => i[0]), svs, `${gc}: sem SV.G3.3, "Neutraliza", só-Neutraliza/virtual nem a das EV`);
      assert.deepEqual(x.secoes, gc.includes('+') ? gc.split('+').map(ROTULO) : [], gc);
    }
    assert.deepEqual((await lista('AT')).itens[2], ['SV.AT.3', 'SV.AT.3 · sem vendedor']);
    assert.deepEqual((await lista('G2')).itens[0], ['SV.G2.1', 'SV.G2.1 · Supervisor']);
    // escolhida no grupo: entra na gerência dela, com gerência e supervisão travadas
    await page.click('#entOpcoes [data-gc="IT+MO"]');
    await page.click('#entOpcoes [data-sv="SV.MO.1"]');
    let e = await estado(page);
    assert.deepEqual([e.entrada, e.sel, e.filtros, e.guardado],
                     [false, ['gc', 'MO', 'SV.MO.1', ''], ['frota'], {perfil: 'sv', gc: 'MO', sv: 'SV.MO.1', rota: '', dia: DIA}]);
    assert.ok(e.sub.endsWith('· Supervisão · GC.MO · Morrinhos · SV.MO.1 · Supervisor'), e.sub);
    await page.click('#btnCasa');
    // SV.G2.1: só o filtro das rotas dela; cascata card -> rotas -> clientes; "puxa a média" das rotas; Resumo dela
    await entra(page, {perfil: 'sv', gc: 'G2', sv: 'SV.G2.1'});
    e = await estado(page);
    assert.deepEqual([e.sel, e.filtros, e.resumo], [['gc', 'G2', 'SV.G2.1', ''], ['frota'], true]);
    assert.ok(e.sub.endsWith('· Supervisão · GC.G2 · Goiânia 02 · SV.G2.1 · Supervisor'), e.sub);
    assert.deepEqual(await page.$$eval('#frota option', os => os.map(o => o.value)), ['', 'G211', 'G212']);
    let g = await cascata(page, 'CCTM 2L PET', 'ICS_GC');
    assert.deepEqual([g.volta, g.linhas.map(l => l.nome)], ['', ['Rota G211', 'Rota G212']]);
    await page.click('#dCorpo .cLin[data-i="0"]');
    g = await lerGaveta(page);
    assert.equal(g.volta, '← Rotas');
    assert.ok(await page.$('#dLista .chips'), 'clientes');
    await page.keyboard.press('Escape');
    await ritmo(page, 'G2', ['G212'], 1);
    await ritmo(page, 'G2', ['G211'], 0);
    await filtra(page, {});
    assert.match(await page.textContent('#puxa'), /Rota que mais puxa a média para baixo: Rota G211/);
    await page.click('#btnResumo');
    assert.equal(await page.textContent('#rsFolha h2'), 'Resumo de vendas · SV.G2.1');
    assert.deepEqual((await colunasRs(page)).map(c => c[0]), ['Agrupador', 'SV.G2.1', 'G211', 'G212']);
    await page.click('#rsVoltar');
    await page.selectOption('#frota', 'G212');
    e = await estado(page);
    assert.deepEqual([e.sel, e.filtros], [['gc', 'G2', 'SV.G2.1', 'G212'], ['frota']]);
    assert.equal(await page.innerHTML('#puxa'), '');
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('Rota em duas etapas: rotas da gerência (no grupo, das duas), Neutraliza sim, virtual e -EV não; tudo travado', async () => {
    const {page, ctx, erros} = await abre('normal', {entrar: null, antes: fixo()});
    await page.click('#entrada [data-perfil="rota"]');
    assert.deepEqual([(await caixa(page)).tit, (await caixa(page)).gcs], ['ROTA', OPCOES_GC]);
    const casos = {AN: ['A41', 'AN11', 'AN12', 'AN21', 'AN22'], SL: ['SL11', 'SL12', 'SL21', 'SL22'],
      G2: ['251', 'G211', 'G212', 'G221', 'G222'],
      RV: ['R31', 'RV11', 'RV12', 'RV21', 'RV22'], AT: ['411', '431', 'AT12', 'AT21', 'AT22', 'AT31', 'AT32'],
      G3: ['331', 'G311', 'G312', 'G321', 'G322'],
      'IT+MO': ['I31', 'IT11', 'IT12', 'IT21', 'IT22', 'M31', 'MO11', 'MO12', 'MO21', 'MO22']};
    for(const [gc, rotas] of Object.entries(casos)){
      await page.click(`#entOpcoes [data-gc="${gc}"]`);
      const x = await caixa(page);
      assert.ok(x.sub.endsWith('· escolha a rota'), x.sub);
      assert.deepEqual(x.itens.map(i => i[0]), rotas, gc);
      assert.deepEqual(x.secoes, gc.includes('+') ? gc.split('+').map(ROTULO) : [], gc);
      await page.click('#entVoltar');
    }
    await page.click('#entOpcoes [data-gc="G2"]');
    assert.deepEqual((await caixa(page)).itens.find(i => i[0] === 'G211'), ['G211', 'Rota G211 · Consultor G211']);
    await page.click('#entOpcoes [data-rota="G211"]');
    let e = await estado(page);
    assert.deepEqual([e.entrada, e.sel, e.filtros, e.resumo, e.guardado],
      [false, ['gc', 'G2', 'SV.G2.1', 'G211'], [], false, {perfil: 'rota', gc: 'G2', sv: 'SV.G2.1', rota: 'G211', dia: DIA}]);
    assert.ok(e.sub.endsWith('· Rota · GC.G2 · Goiânia 02 · SV.G2.1 · Supervisor · Rota G211 — Consultor G211'), e.sub);
    assert.equal(await page.innerHTML('#puxa'), '');
    let g = await cascata(page, 'CCTM 2L PET', 'ICS_GC');
    assert.deepEqual([g.tit, g.volta, g.linhas.length], ['CCTM 2L Pet · Rota G211', '', 0]);
    assert.ok(await page.$('#dLista .chips'), 'clientes');
    await page.keyboard.press('Escape');
    g = await cascata(page, 'VOL REFRIGERANTES', 'VOLUME');
    assert.ok(g.clientes.length > 0);
    await page.keyboard.press('Escape');
    // escolhida no grupo: entra na gerência dela
    await vaiPara(page, {perfil: 'rota', gc: 'IT+MO', rota: 'MO21'});
    e = await estado(page);
    assert.deepEqual([e.sel, e.filtros, e.guardado], [['gc', 'MO', 'SV.MO.2', 'MO21'], [],
                                                       {perfil: 'rota', gc: 'MO', sv: 'SV.MO.2', rota: 'MO21', dia: DIA}]);
    assert.ok(e.sub.endsWith('· Rota · GC.MO · Morrinhos · SV.MO.2 · Supervisor · Rota MO21 — Consultor Mo21'), e.sub);
    // rota Neutraliza: clientes dentro, sem Venda Zero
    await vaiPara(page, {perfil: 'rota', gc: 'AT', rota: '431'});
    e = await estado(page);
    assert.deepEqual([e.sel, e.filtros, e.resumo], [['gc', 'AT', 'Neutraliza', '431'], [], false]);
    assert.ok(e.sub.endsWith('· Rota · GC.AT · Atacados · Neutraliza · Rota 431 — Consultor 431'), e.sub);
    g = await cascata(page, 'VOL REFRIGERANTES', 'VOLUME');
    assert.equal(g.clientes.length, 3);
    await page.keyboard.press('Escape');
    await filtra(page, {aba: 'ICS_GC'});
    assert.ok(!(await page.$$eval('#lista .ind .tit', t => t.map(x => x.textContent))).includes('Venda Zero'));
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('entrada e caixa de seleção em 390 px: sem rolagem lateral, tudo na tela, lista com rolagem própria', async () => {
    for(const altura of [844, 560]){
      const {page, ctx, erros} = await abre('normal', {entrar: null, largura: 390, altura});
      const mede = () => page.evaluate(() => {
        const caixa = el => { const b = el.getBoundingClientRect(); return [b.left, b.right, b.top, b.bottom].map(Math.round); };
        const lista = document.getElementById('entOpcoes');
        const vis = [...document.querySelectorAll('#entrada button, #entrada .entPainel')].filter(el => el.offsetParent !== null)
          .filter(el => !lista.contains(el));
        return {largura: document.documentElement.clientWidth,
                rolagem: [document.documentElement.scrollWidth, document.getElementById('entrada').scrollWidth, lista.scrollWidth],
                listaW: lista.clientWidth, caixas: vis.map(el => [el.id || el.className || el.textContent.trim(), ...caixa(el)]),
                lista: caixa(lista), rolaLista: lista.scrollHeight > lista.clientHeight,
                opcoes: [...lista.querySelectorAll('button')].filter(b => b.offsetParent !== null)
                  .map(b => [b.textContent, ...caixa(b), b.offsetHeight])};
      });
      const confere = (m, onde) => {
        assert.equal(m.largura, 390);
        assert.ok(m.rolagem.slice(0, 2).every(w => w <= 390) && m.rolagem[2] <= m.listaW, `${onde}: rolagem lateral ${m.rolagem}`);
        for(const [nome, esq, dir, topo, base] of m.caixas)
          assert.ok(esq >= 0 && dir <= 390 && topo >= 0 && base <= altura, `${onde} ${nome}: ${[esq, dir, topo, base]}`);
        for(const [nome, esq, dir, , , h] of m.opcoes)
          assert.ok(esq >= 0 && dir <= 390 && h >= 44, `${onde} ${nome}: ${[esq, dir, h]}`);
      };
      for(const tema of ['preta', 'branca']){
        if(tema === 'branca') await page.click('#btnTema');
        confere(await mede(), `${altura} ${tema} botões`);
        for(const [perfil, gc] of [['gc', ''], ['sv', 'IT+MO'], ['rota', 'IT+MO'], ['rota', 'G2']]){
          await page.click(`#entrada [data-perfil="${perfil}"]`);
          if(gc) await page.click(`#entOpcoes [data-gc="${gc}"]`);
          const m = await mede();
          confere(m, `${altura} ${tema} ${perfil} ${gc}`);
          assert.ok(m.lista[3] <= altura, `${altura} ${tema} ${perfil}: a caixa cabe na tela`);
          if(altura === 560 && perfil === 'gc') assert.ok(m.rolaLista, 'com pouca altura, a lista rola dentro da caixa');
          // a última opção é alcançável rolando a lista
          const ultima = await page.$('#entOpcoes button:last-of-type');
          await ultima.scrollIntoViewIfNeeded();
          assert.ok(await ultima.isVisible());
          await page.click('#entFechar');
        }
      }
      assert.deepEqual(erros, []);
      await ctx.close();
    }
  });
});

describe('Parte I — acesso guardado e virada diária', {skip: pular}, () => {
  test('casa apaga o acesso; recarregar reabre os quatro perfis no mesmo contexto (demais filtros no padrão)', async () => {
    const {page, ctx, erros} = await abre('normal', {entrar: null, antes: fixo()});
    for(const [login, guardado, ctxSel, filtros] of [
      [{perfil: 'dir'}, {perfil: 'dir', gc: '', sv: '', rota: ''}, ['dir', '', '', ''], ['fgc']],
      [{perfil: 'gc', gc: 'G2'}, {perfil: 'gc', gc: 'G2', sv: '', rota: ''}, ['gc', 'G2', '', ''], ['fsv', 'frota']],
      [{perfil: 'sv', gc: 'IT', sv: '2'}, {perfil: 'sv', gc: 'IT', sv: 'SV.IT.2', rota: ''}, ['gc', 'IT', 'SV.IT.2', ''], ['frota']],
      [{perfil: 'rota', gc: 'AT', rota: '431'}, {perfil: 'rota', gc: 'AT', sv: 'Neutraliza', rota: '431'},
       ['gc', 'AT', 'Neutraliza', '431'], []]]){
      await entra(page, login);
      assert.deepEqual(JSON.parse(await guardadoTxt(page)), {...guardado, dia: DIA});
      // mexe nos filtros livres e abre a cascata: ao recarregar, voltam ao padrão
      if(login.perfil === 'dir') await page.selectOption('#fgc', 'IT');
      if(login.perfil === 'gc') await page.selectOption('#fsv', 'SV.G2.2');
      if(login.perfil === 'sv') await page.selectOption('#frota', 'IT22');
      await page.click('.ind[data-k]');
      await page.reload();
      await esperaCarga(page);
      let e = await estado(page);
      assert.ok(!e.entrada, login.perfil);
      assert.deepEqual([e.sel, e.filtros, e.guardado], [ctxSel, filtros, {...guardado, dia: DIA}], login.perfil);
      assert.ok(!(await page.evaluate(() => document.getElementById('drw').classList.contains('on'))), 'cascata fechada');
      await page.click('#btnCasa');
      e = await estado(page);
      assert.deepEqual([e.entrada, e.msg, e.guardado, e.acesso], [true, '', null, null], login.perfil);
    }
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('acesso guardado que não vale mais (sem dados, saiu do payload, oculta, virtual...) volta para a entrada', async () => {
    for(const [nome, a] of [['normal', {perfil: 'gc', gc: 'DI'}], ['semsv', {perfil: 'sv', gc: 'G2', sv: 'SV.G2.2'}],
      ['normal', {perfil: 'sv', gc: 'G3', sv: 'SV.G3.3'}], ['normal', {perfil: 'sv', gc: 'G2', sv: 'Neutraliza'}],
      ['normal', {perfil: 'rota', gc: 'AN', rota: 'A42'}], ['normal', {perfil: 'rota', gc: 'G2', rota: 'G111'}],
      ['normal', {perfil: 'chefe'}]]){
      const {page, ctx, erros} = await abre(nome, {entrar: null, antes: fixo(), armazenado: {drotas_sessao: sessao(a)}});
      const e = await estado(page);
      assert.deepEqual([e.entrada, e.msg, e.guardado, e.acesso], [true, INDISPONIVEL, null, null], JSON.stringify(a));
      assert.deepEqual(erros, []);
      await ctx.close();
    }
    // controle: a SV.G2.2 vale no payload que tem ela; deixa de valer quando chega um payload novo sem ela
    const {page, ctx, erros, fonte} = await abre('normal', {entrar: null, antes: fixo(),
      armazenado: {drotas_sessao: sessao({perfil: 'sv', gc: 'G2', sv: 'SV.G2.2'})}});
    let e = await estado(page);
    assert.deepEqual([e.entrada, e.sel], [false, ['gc', 'G2', 'SV.G2.2', '']]);
    fonte.nome = 'semsv';
    await page.evaluate(() => recarregaPayload());
    e = await estado(page);
    assert.deepEqual([e.entrada, e.msg, e.guardado, e.acesso], [true, INDISPONIVEL, null, null]);
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('acesso guardado sem "dia" (ou ilegível) vale como vencido', async () => {
    for(const s of [sessao({perfil: 'gc', gc: 'G2'}, null), '{quebrado', '"texto"']){
      const {page, ctx, erros} = await abre('normal', {entrar: null, antes: fixo(), armazenado: {drotas_sessao: s}});
      const e = await estado(page);
      assert.deepEqual([e.entrada, e.msg, e.guardado], [true, REINICIADO, null], s);
      assert.deepEqual(erros, []);
      await ctx.close();
    }
  });

  test('sem localStorage (bloqueado): entrada normal a cada visita, sem erro', async () => {
    const {page, ctx, erros} = await abre('normal', {entrar: null, antes: p => p.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', {get(){ throw new Error('bloqueado'); }});
    })});
    let e = await estado(page);
    assert.deepEqual([e.entrada, e.msg, e.guardado], [true, '', 'sem armazenamento']);
    await entra(page, {perfil: 'sv', gc: 'G2', sv: '1'});
    e = await estado(page);
    assert.deepEqual([e.entrada, e.sel, e.filtros], [false, ['gc', 'G2', 'SV.G2.1', ''], ['frota']]);
    await page.reload();
    await esperaCarga(page);
    e = await estado(page);
    assert.deepEqual([e.entrada, e.msg, e.acesso], [true, '', null]);
    await page.click('#btnTema');
    await entra(page, 'dir');
    await page.click('#btnCasa');
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('ao reabrir um acesso guardado a entrada não pisca (tela neutra de carregamento)', async () => {
    const html = fs.readFileSync(path.join(FRONT, 'index.html'), 'utf-8');
    assert.match(html, /<div id="entrada"[^>]*\shidden>/, 'a entrada começa escondida');
    assert.match(html, /<div id="carga"(?![^>]*hidden)[^>]*>/, 'a tela de carga começa visível');
    // vigia: a entrada apareceu em algum momento?
    const vigia = p => p.addInitScript(() => {
      window.__entradaVista = false;
      new MutationObserver(() => { const el = document.getElementById('entrada'); if(el && !el.hidden) window.__entradaVista = true; })
        .observe(document, {subtree: true, childList: true, attributes: true, attributeFilter: ['hidden']});
    });
    for(const [armazenado, vista] of [[{drotas_sessao: sessao({perfil: 'rota', gc: 'G2', rota: 'G211'})}, false], [{}, true]]){
      const {page, ctx, erros} = await abre('normal', {entrar: null, armazenado,
                                                       antes: async p => { await fixo()(p); await vigia(p); }});
      assert.equal(await page.evaluate(() => window.__entradaVista), vista, vista ? 'controle: sem acesso, a entrada aparece' : '');
      assert.ok(await page.evaluate(() => document.getElementById('carga').hidden));
      assert.deepEqual(erros, []);
      await ctx.close();
    }
  });

  test('?resumo= abre o Resumo sem mexer no acesso guardado; ao fechar, volta ao acesso (ou à entrada)', async () => {
    const guardada = sessao({perfil: 'sv', gc: 'G2', sv: 'SV.G2.1'});
    let {page, ctx, erros} = await abre('normal', {entrar: null, antes: fixo(), armazenado: {drotas_sessao: guardada},
                                                   busca: '?resumo=vol,ics&modo=dir&gc=IT'});
    assert.equal(await page.textContent('#rsFolha h2'), 'Resumo de vendas · GC.IT · Itumbiara');
    assert.equal(await guardadoTxt(page), guardada);
    await page.click('#rsVoltar');
    let e = await estado(page);
    assert.deepEqual([e.entrada, e.sel, e.filtros], [false, ['gc', 'G2', 'SV.G2.1', ''], ['frota']]);
    assert.equal(await guardadoTxt(page), guardada);
    assert.equal(await page.evaluate(() => location.search), '');
    assert.deepEqual(erros, []);
    await ctx.close();
    // acesso de outro dia: o link abre sem mexer nele; ao fechar, ele vence
    const velha = sessao({perfil: 'gc', gc: 'G2'}, '2026-10-12');
    ({page, ctx, erros} = await abre('normal', {entrar: null, antes: fixo(), armazenado: {drotas_sessao: velha},
                                                busca: '?resumo=vol&gc=G2&sv=SV.G2.1'}));
    assert.equal(await page.textContent('#rsFolha h2'), 'Resumo de vendas · SV.G2.1');
    assert.equal(await guardadoTxt(page), velha);
    await page.click('#rsVoltar');
    e = await estado(page);
    assert.deepEqual([e.entrada, e.msg, e.guardado], [true, REINICIADO, null]);
    assert.deepEqual(erros, []);
    await ctx.close();
    // sem acesso guardado: ao fechar, a entrada
    ({page, ctx, erros} = await abre('normal', {entrar: null, antes: fixo(), busca: '?resumo=vol&gc=G1'}));
    assert.equal(await page.textContent('#rsFolha h2'), 'Resumo de vendas · GC.G1 · Goiânia 01');
    await page.click('#rsVoltar');
    e = await estado(page);
    assert.deepEqual([e.entrada, e.msg, e.guardado], [true, '', null]);
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('virada às 05:00 de Brasília nos quatro perfis, com o navegador em UTC e em America/Sao_Paulo', async () => {
    const ACESSOS = [{perfil: 'dir'}, {perfil: 'gc', gc: 'G2'}, {perfil: 'sv', gc: 'G2', sv: 'SV.G2.1'},
                     {perfil: 'rota', gc: 'AT', rota: '431'}];
    for(const fuso of ['UTC', 'America/Sao_Paulo']){
      const {page, ctx, erros} = await abre('normal', {entrar: null, fuso, antes: fixo(new Date('2026-10-14T07:59:00Z'))});
      assert.equal(await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone), fuso);
      const linhas = [];
      for(const a of ACESSOS){
        // acesso do dia 13 às 04:59 e às 05:00 de Brasília do dia 14
        for(const hora of ['2026-10-14T07:59:00Z', '2026-10-14T08:00:00Z']){
          await page.clock.setFixedTime(new Date(hora));
          await page.evaluate(s => localStorage.setItem('drotas_sessao', s), sessao(a, '2026-10-13'));
          await page.reload();
          await esperaCarga(page);
          const e = await estado(page);
          linhas.push([a.perfil, hora.slice(11, 16), e.entrada, e.msg, e.acesso && e.acesso[0], e.guardado && e.guardado.dia]);
        }
      }
      assert.deepEqual(linhas, ACESSOS.flatMap(a => [[a.perfil, '07:59', false, '', a.perfil, '2026-10-13'],
                                                     [a.perfil, '08:00', true, REINICIADO, null, null]]), fuso);
      // depois das 05:00, um acesso novo é do dia 14
      await entra(page, {perfil: 'gc', gc: 'G2'});
      assert.equal((await estado(page)).guardado.dia, '2026-10-14');
      assert.deepEqual(erros, []);
      await ctx.close();
    }
  });

  test('aba aberta atravessando as 05:00: entrada na próxima atualização do online ou ao voltar para a aba', async () => {
    const {page, ctx, erros} = await abre('normal', {entrar: null,
      antes: p => p.clock.install({time: new Date('2026-10-14T07:58:00Z')})});     // 04:58 de Brasília
    await entra(page, {perfil: 'sv', gc: 'G2', sv: '1'});
    let e = await estado(page);
    assert.deepEqual([e.entrada, e.guardado.dia], [false, '2026-10-13']);
    await page.clock.fastForward('06:00');           // 05:04: a atualização do online (a cada 5 min) confere o dia
    e = await estado(page);
    assert.deepEqual([e.entrada, e.msg, e.guardado, e.acesso], [true, REINICIADO, null, null]);
    // acesso novo (dia 14): três horas depois, no mesmo dia de trabalho, continua (não reinicia por inatividade)
    await entra(page, {perfil: 'rota', gc: 'G2', rota: 'G211'});
    await page.clock.fastForward('03:00:00');
    e = await estado(page);
    assert.deepEqual([e.entrada, e.guardado.dia], [false, '2026-10-14']);
    // virada com a aba em segundo plano (sem atualização do online): confere ao voltar para a aba
    await page.clock.setSystemTime(new Date('2026-10-15T08:01:00Z'));     // 15/10 05:01 de Brasília
    e = await estado(page);
    assert.equal(e.entrada, false, 'ainda não conferiu');
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    e = await estado(page);
    assert.deepEqual([e.entrada, e.msg, e.guardado], [true, REINICIADO, null]);
    assert.deepEqual(erros, []);
    await ctx.close();
  });
});

describe('Parte I — grupos: acesso guardado, virada diária e link do Resumo', {skip: pular}, () => {
  test('grupo: recarregar reabre no Total (mesmo com uma das duas no seletor); payload novo mantém a escolha; casa', async () => {
    const {page, ctx, erros} = await abre('grupo', {entrar: {perfil: 'gc', gc: 'IT+MO'}, antes: fixo()});
    const guardado = {perfil: 'gc', gc: 'IT+MO', sv: '', rota: '', dia: DIA};
    await page.selectOption('#fgc', 'MO');
    await page.selectOption('#fsv', 'SV.MO.1');
    let e = await estado(page);
    assert.deepEqual([e.sel, e.guardado], [['gc', 'MO', 'SV.MO.1', ''], guardado]);
    // payload novo: a escolha do seletor fica (a MO continua com dados)
    await page.evaluate(() => recarregaPayload());
    e = await estado(page);
    assert.deepEqual([e.entrada, e.sel, e.filtros], [false, ['gc', 'MO', 'SV.MO.1', ''], ['fgc', 'fsv', 'frota']]);
    await page.reload();
    await esperaCarga(page);
    e = await estado(page);
    assert.deepEqual([e.entrada, e.sel, e.filtros, e.guardado], [false, ['gc', 'IT+MO', '', ''], ['fgc', 'fsv', 'frota'], guardado]);
    assert.ok(e.sub.endsWith(`· Gerência · ${GRUPO_IT_MO}`), e.sub);
    await page.click('#btnCasa');
    e = await estado(page);
    assert.deepEqual([e.entrada, e.msg, e.guardado, e.acesso], [true, '', null, null]);
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('acesso guardado: grupo e supervisão/rota de grupo valem; chave fora de GC_GRUPOS, grupo sem dados, virtual e -EV não', async () => {
    for(const [nome, a, sel] of [['grupo', {perfil: 'gc', gc: 'IT+MO'}, ['gc', 'IT+MO', '', '']],
      ['grupo', {perfil: 'sv', gc: 'IT+MO', sv: 'SV.MO.1'}, ['gc', 'MO', 'SV.MO.1', '']],
      ['grupo', {perfil: 'rota', gc: 'IT+MO', rota: 'I31'}, ['gc', 'IT', 'Neutraliza', 'I31']],
      ['normal', {perfil: 'gc', gc: 'PA+DI'}, ['gc', 'PA+DI', '', '']]]){
      const {page, ctx, erros} = await abre(nome, {entrar: null, antes: fixo(), armazenado: {drotas_sessao: sessao(a)}});
      const e = await estado(page);
      assert.deepEqual([e.entrada, e.sel], [false, sel], JSON.stringify(a));
      assert.deepEqual(erros, []);
      await ctx.close();
    }
    for(const [nome, a] of [['grupo', {perfil: 'gc', gc: 'MO+IT'}], ['grupo', {perfil: 'gc', gc: 'IT+XX'}],
      ['grupo', {perfil: 'gc', gc: 'IT+MO+G1'}], ['semdados', {perfil: 'gc', gc: 'PA+DI'}], ['semdados', {perfil: 'gc', gc: 'G3'}],
      ['grupo', {perfil: 'gc', gc: 'MO'}],      // gerência de grupo sozinha não é opção da entrada (só no seletor do grupo)
      ['grupo', {perfil: 'sv', gc: 'IT+MO', sv: 'SV.G2.1'}], ['grupo', {perfil: 'sv', gc: 'IT+MO', sv: 'Neutraliza'}],
      ['grupo', {perfil: 'rota', gc: 'IT+MO', rota: 'I32'}], ['grupo', {perfil: 'rota', gc: 'IT+MO', rota: 'MO-EV'}],
      ['normal', {perfil: 'rota', gc: 'SL', rota: 'SL-EV'}], ['normal', {perfil: 'gc', gc: {g: 'G2'}}]]){
      const {page, ctx, erros} = await abre(nome, {entrar: null, antes: fixo(), armazenado: {drotas_sessao: sessao(a)}});
      const e = await estado(page);
      assert.deepEqual([e.entrada, e.msg, e.guardado, e.acesso], [true, INDISPONIVEL, null, null], JSON.stringify(a));
      assert.deepEqual(erros, []);
      await ctx.close();
    }
  });

  test('virada às 05:00 de Brasília nos acessos de grupo, com o navegador em UTC e em America/Sao_Paulo', async () => {
    const ACESSOS = [[{perfil: 'gc', gc: 'IT+MO'}, 'IT+MO'], [{perfil: 'sv', gc: 'UR+RI', sv: 'SV.RI.2'}, 'RI'],
                     [{perfil: 'rota', gc: 'UR+RI', rota: 'UR11'}, 'UR']];
    for(const fuso of ['UTC', 'America/Sao_Paulo']){
      const {page, ctx, erros} = await abre('normal', {entrar: null, fuso, antes: fixo(new Date('2026-10-14T07:59:00Z'))});
      const linhas = [];
      for(const [a] of ACESSOS){
        // acesso do dia 13 às 04:59 e às 05:00 de Brasília do dia 14
        for(const hora of ['2026-10-14T07:59:00Z', '2026-10-14T08:00:00Z']){
          await page.clock.setFixedTime(new Date(hora));
          await page.evaluate(s => localStorage.setItem('drotas_sessao', s), sessao(a, '2026-10-13'));
          await page.reload();
          await esperaCarga(page);
          const e = await estado(page);
          linhas.push([a.perfil, hora.slice(11, 16), e.entrada, e.msg, e.acesso ? e.sel[1] : null]);
        }
      }
      assert.deepEqual(linhas, ACESSOS.flatMap(([a, gc]) => [[a.perfil, '07:59', false, '', gc],
                                                             [a.perfil, '08:00', true, REINICIADO, null]]), fuso);
      await entra(page, {perfil: 'gc', gc: 'UR+RI'});
      assert.deepEqual((await estado(page)).guardado, {perfil: 'gc', gc: 'UR+RI', sv: '', rota: '', dia: '2026-10-14'});
      assert.deepEqual(erros, []);
      await ctx.close();
    }
  });

  test('?resumo= do grupo abre o Total das duas sem mexer no acesso guardado; o link do Total leva o grupo', async () => {
    const guardada = sessao({perfil: 'rota', gc: 'G2', rota: 'G211'});
    for(const busca of ['?resumo=vol,ics&gc=IT%2BMO', '?resumo=vol&gc=IT+MO']){
      const {page, ctx, erros} = await abre('normal', {entrar: null, antes: fixo(), armazenado: {drotas_sessao: guardada}, busca});
      assert.equal(await page.textContent('#rsFolha h2'), `Resumo de vendas · ${GRUPO_IT_MO}`, busca);
      assert.deepEqual((await colunasRs(page)).map(c => c[0]), ['Agrupador', 'GC.IT + GC.MO', 'GC.IT', 'GC.MO']);
      assert.equal(await guardadoTxt(page), guardada);
      await page.click('#rsVoltar');
      const e = await estado(page);
      assert.deepEqual([e.entrada, e.sel, e.filtros], [false, ['gc', 'G2', 'SV.G2.1', 'G211'], []]);
      assert.equal(await guardadoTxt(page), guardada);
      assert.deepEqual(erros, []);
      await ctx.close();
    }
    // o link gerado no Total do grupo leva a chave do grupo
    const {page, ctx, erros} = await abre('normal', {entrar: {perfil: 'gc', gc: 'IT+MO'}, antes: fixo()});
    const link = await page.evaluate(() => new Promise(ok => {
      navigator.share = async d => ok(d.url);
      document.getElementById('btnResumo').click();
      document.getElementById('rsLink').click();
    }));
    assert.match(link, /\?resumo=vol,ics&gc=IT%2BMO$/);
    assert.deepEqual(erros, []);
    await ctx.close();
  });
});

describe('Parte H — ordem dentro de um grupo de gerências', {skip: pular}, () => {
  for(const nome of ['normal', 'fech']){
    test(`supervisões por gerência -> número, "Neutraliza" por último, rotas e clientes pelo código (${nome})`, async () => {
      const {page, ctx, erros} = await abre(nome, {entrar: {perfil: 'gc', gc: 'UR+RI'}});
      const k = 'VOL REFRIGERANTES';
      // DATA da UR e da RI com supervisões e rotas fora de ordem, e números que dariam outra ordem pela tendência
      await page.evaluate(() => {
        for(const gc of ['UR', 'RI'])
          DATA[gc] = Object.fromEntries(Object.entries(DATA[gc]).reverse().map(([s, rs]) =>
            [s, Object.fromEntries(Object.entries(rs).reverse())]));
        DATA = Object.fromEntries(Object.entries(DATA).reverse());
        ROTA_IDX = {};
        for(const gc in DATA) for(const sv in DATA[gc]) for(const r in DATA[gc][sv]) ROTA_IDX[r] = [gc, sv];
      });
      for(const [rs, f] of [[['UR11', 'UR12'], 0.2], [['UR21', 'UR22'], 0.5], [['RI11', 'RI12'], 1.4], [['RI21', 'RI22'], 0.9]])
        await ritmo(page, 'UR', rs, f);
      await filtra(page, {});
      let g = await cascata(page, k, 'VOLUME');
      assert.deepEqual(g.linhas.map(l => l.nome), ['SV.UR.1 · Supervisor', 'SV.UR.2 · Supervisor', 'SV.RI.1 · Supervisor',
                                                   'SV.RI.2 · Supervisor']);
      const esperado = await page.evaluate(k => [['UR11', 'UR12'], ['UR21', 'UR22'], ['RI11', 'RI12'], ['RI21', 'RI22']]
        .map(rs => { const b = agrega(rs).ind[k]; return [b.meta, P.FECHAMENTO ? b.pctReal : b.pctTendencia, b.onPace ? 'ok' : 'no']; }), k);
      assert.deepEqual((await linhasCor(page)).map(l => l.slice(1)), esperado, 'números e cor de agrega(), só a ordem muda');
      await page.click('#dCorpo .cLin[data-i="2"]');
      g = await lerGaveta(page);
      assert.deepEqual(g.linhas.map(l => l.nome), ['Rota RI11', 'Rota RI12']);
      await page.click('#dCorpo .cLin[data-i="0"]');
      g = await lerGaveta(page);
      assert.ok(g.clientes.length > 1 && g.clientes.every((d, i) => i === 0 || g.clientes[i - 1] <= d), 'Dif. Abs crescente');
      await page.keyboard.press('Escape');
      // IT+MO: a linha "Neutraliza" (I31 e M31 juntas) por último; dentro, as rotas em ordem natural
      await vaiPara(page, {perfil: 'gc', gc: 'IT+MO'});
      g = await cascata(page, k, 'VOLUME');
      assert.deepEqual(g.linhas.map(l => l.nome), ['SV.IT.1 · Supervisor', 'SV.IT.2 · Supervisor', 'SV.MO.1 · Supervisor',
                                                   'SV.MO.2 · Supervisor', 'Neutraliza']);
      await page.click('#dCorpo .cLin[data-i="4"]');
      g = await lerGaveta(page);
      assert.deepEqual(g.linhas.map(l => l.nome), ['Rota I31', 'Rota M31']);
      assert.deepEqual(erros, []);
      await ctx.close();
    });
  }
});

/* ---------- Parte K: "Meta batida!" (volume: meta do dia do nível <= 0; só rótulo e cor) ---------- */
// põe a meta do dia (metaDia) do indicador `k` nas rotas: {rota: valor}
const poeMetaDia = (page, k, valores) => page.evaluate(([k, v]) => {
  for(const r in v) nodo('', r).indicators[k].metaDia = v[r];
}, [k, valores]);
// caixa Online do card: classe, número e rótulo
const caixaCard = (page, k) => page.$eval(`.ind[data-k="${k}"] .obox`, el => ({
  cls: el.className, num: el.querySelector('b').textContent, rot: el.querySelector('span').textContent.trim()}));
// meio das linhas da gaveta: [nome, classe da caixa do online, número, rótulo de baixo, data-meta, data-real]
// (sem as linhas "sem dados", que não têm números)
const meioLinhas = page => page.$$eval('#dCorpo .cLin:not(.off)', ls => ls.map(l => [l.querySelector('.cNome b').textContent,
  l.querySelector('.cOn').className, l.querySelector('.cOn').textContent, l.querySelector('.cMeio small').textContent,
  Number(l.dataset.meta), Number(l.dataset.real)]));
const fmtPt = n => Math.round(n).toLocaleString('pt-BR');
const onlineDe = (page, k, rs) => page.evaluate(([k, rs]) => rs.reduce((a, r) => a + ((ONLINE.volume[r] || {})[k] || 0), 0), [k, rs]);
const mdCard = (page, k) => page.evaluate(k => agrega(rotasAtuais()).ind[k].metaDia, k);

describe('Parte K — "Meta batida!"', {skip: pular}, () => {
  test('card, linhas de supervisão e rota, "Neutraliza", total somado e Diretoria; online mostrado e somado; valores iguais', async () => {
    const {page, ctx, erros} = await abre('normal', {entrar: {perfil: 'gc', gc: 'G1'}, antes: fixo()});
    const k = 'VOL REFRIGERANTES', online = rs => onlineDe(page, k, rs);
    await filtra(page, {aba: 'VOLUME'});
    // como hoje: meta do dia > 0 e online abaixo dela = vermelho com "meta do dia X"
    let c = await caixaCard(page, k), md = await mdCard(page, k);
    const onl = await online(['G111', 'G112', 'G121', 'G122', '151']);
    assert.ok(md > onl && onl > 0, `${md} ${onl}`);
    assert.deepEqual([c.cls, c.num, c.rot], ['obox no', fmtPt(onl), `meta do dia ${fmtPt(md)}`]);
    // SV.G1.1 (0 e -5) e a Neutraliza 151 (-1) batidas; SV.G1.2 não; o total da G1 continua > 0
    await poeMetaDia(page, k, {G111: 0, G112: -5, 151: -1});
    await filtra(page, {});
    md = await mdCard(page, k);
    assert.ok(md > 0);
    c = await caixaCard(page, k);
    assert.deepEqual([c.cls, c.num, c.rot], [onl >= md ? 'obox ok' : 'obox no', fmtPt(onl), `meta do dia ${fmtPt(md)}`],
                     'total > 0: como antes (verde só se o online bate)');
    let g = await cascata(page, k, 'VOLUME');
    const sv2 = await page.evaluate(k => agrega(['G121', 'G122']).ind[k], k);
    assert.deepEqual(await meioLinhas(page), [
      ['SV.G1.1 · Supervisor', 'cOn ok', fmtPt(await online(['G111', 'G112'])), 'Meta batida!', g.linhas[0].meta, g.linhas[0].real],
      ['SV.G1.2 · Supervisor', 'cOn no', fmtPt(await online(['G121', 'G122'])), `meta do dia ${fmtPt(sv2.metaDia)}`,
       sv2.meta, sv2.real],
      ['Neutraliza', 'cOn ok', fmtPt(await online(['151'])), 'Meta batida!', g.linhas[2].meta, g.linhas[2].real]]);
    // rotas da SV.G1.1: a G111 (0) e a G112 (-5) batidas, cada uma com o seu online
    await page.click('#dCorpo .cLin[data-i="0"]');
    assert.deepEqual((await meioLinhas(page)).map(l => l.slice(0, 4)),
      [['Rota G111', 'cOn ok', fmtPt(await online(['G111'])), 'Meta batida!'],
       ['Rota G112', 'cOn ok', fmtPt(await online(['G112'])), 'Meta batida!']]);
    await page.keyboard.press('Escape');
    // total somado <= 0 com resíduo de decimais (0,1 + 0,2 - 0,3): card verde, "Meta batida!" e o online de todas as rotas
    await poeMetaDia(page, k, {G111: 0.1, G112: 0.2, G121: -0.3, G122: 0, 151: 0});
    await filtra(page, {});
    md = await mdCard(page, k);
    assert.ok(md !== 0 && Math.abs(md) < 1e-9, `soma com resíduo: ${md}`);
    c = await caixaCard(page, k);
    assert.deepEqual([c.cls, c.num, c.rot], ['obox ok', fmtPt(onl), 'Meta batida!']);
    // os números não mudam: metaDia somada como sempre (sem virar 0), Meta, Real, Diferença e % do card
    await poeMetaDia(page, k, {G111: 0, G112: -5, G121: -40, G122: -60, 151: -1});
    const antes = await page.evaluate(() => JSON.stringify([P, ONLINE]));
    await filtra(page, {});
    const card = await page.evaluate(k => ({b: agrega(rotasAtuais()).ind[k],
      cl: document.querySelector(`.ind[data-k="${k}"] .cl`).textContent.replace(/\s+/g, ' ').trim(),
      big: document.querySelector(`.ind[data-k="${k}"] .big`).textContent}), k);
    assert.equal(card.b.metaDia, -106);
    assert.equal(card.cl, `Meta ${fmtPt(card.b.meta)} Real ${fmtPt(card.b.real)} Diferença ${fmtPt(card.b.real - card.b.meta)}`);
    assert.equal(card.big, `${card.b.onPace ? '▲' : '▼'}${card.b.pctTendencia}%`);
    assert.deepEqual(await caixaCard(page, k), {cls: 'obox ok', num: fmtPt(onl), rot: 'Meta batida!'});
    // Diretoria: só a linha da G1 (meta do dia somada <= 0) muda
    await vaiPara(page, 'dir');
    g = await cascata(page, k, 'VOLUME');
    const linhas = await meioLinhas(page);
    assert.deepEqual(linhas.find(l => l[0] === 'GC.G1 · Goiânia 01').slice(1, 4), ['cOn ok', fmtPt(onl), 'Meta batida!']);
    assert.ok(linhas.filter(l => l[0] !== 'GC.G1 · Goiânia 01').every(l => /^meta do dia /.test(l[3])), 'as outras como antes');
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => JSON.stringify([P, ONLINE])), antes, 'o front não altera nenhum valor do payload');
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('Del Valle Frut e grupo; meta do dia > 0 (verde ao bater) e sem meta do dia como antes', async () => {
    const {page, ctx, erros} = await abre('normal', {entrar: {perfil: 'gc', gc: 'G2'}, antes: fixo()});
    await filtra(page, {aba: 'VOLUME'});
    const dv = 'VOL DEL VALLE FRUT', k = 'VOL REFRIGERANTES';
    const rotas = await page.evaluate(dv => rotasAtuais().filter(r => nodo('', r).indicators[dv]), dv);
    assert.ok(rotas.length >= 4);
    await poeMetaDia(page, dv, Object.fromEntries(rotas.map(r => [r, 0])));
    await filtra(page, {});
    const onlDv = await onlineDe(page, dv, rotas);
    assert.ok(onlDv > 0);
    assert.deepEqual(await caixaCard(page, dv), {cls: 'obox ok', num: fmtPt(onlDv), rot: 'Meta batida!'});
    let g = await cascata(page, dv, 'VOLUME');
    assert.ok((await meioLinhas(page)).every(l => l[1] === 'cOn ok' && l[3] === 'Meta batida!'));
    await page.keyboard.press('Escape');
    // meta do dia > 0 e online acima dela: verde com "meta do dia X" (como hoje)
    const todas = await page.evaluate(() => rotasAtuais());
    await poeMetaDia(page, k, Object.fromEntries(todas.map(r => [r, 1])));
    await filtra(page, {});
    const onl = await onlineDe(page, k, todas);
    assert.ok(onl >= todas.length);
    assert.deepEqual(await caixaCard(page, k), {cls: 'obox ok', num: fmtPt(onl), rot: `meta do dia ${todas.length}`});
    // sem meta do dia (META_RECUPERAVEL_ROTA ausente): "meta do dia —", cinza (como hoje)
    await poeMetaDia(page, k, Object.fromEntries(todas.map(r => [r, null])));
    await filtra(page, {});
    assert.deepEqual(await caixaCard(page, k), {cls: 'obox nd', num: fmtPt(onl), rot: 'meta do dia —'});
    g = await cascata(page, k, 'VOLUME');
    assert.ok((await meioLinhas(page)).every(l => l[1] === 'cOn nd' && l[3] === 'meta do dia —'));
    await page.keyboard.press('Escape');
    // grupo IT+MO: a IT batida (total da IT <= 0), a MO não; o total do grupo segue a soma das duas
    await vaiPara(page, {perfil: 'gc', gc: 'IT+MO'});
    await filtra(page, {aba: 'VOLUME'});
    const it = await page.evaluate(() => rotasDe('IT', ''));
    await poeMetaDia(page, k, Object.fromEntries(it.map(r => [r, -1000])));
    await filtra(page, {});
    assert.ok(await mdCard(page, k) <= 0);
    assert.equal((await caixaCard(page, k)).rot, 'Meta batida!');
    await cascata(page, k, 'VOLUME');
    assert.deepEqual((await meioLinhas(page)).map(l => [l[0].split(' ·')[0], l[3] === 'Meta batida!']),
      [['SV.IT.1', true], ['SV.IT.2', true], ['SV.MO.1', false], ['SV.MO.2', false], ['Neutraliza', true]]);
    await page.keyboard.press('Escape');
    await page.selectOption('#fgc', 'MO');
    assert.match((await caixaCard(page, k)).rot, /^meta do dia \d/);
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('coberturas sem mudança (mesmo com meta 0) e fechamento sem "Meta batida!"', async () => {
    let {page, ctx, erros} = await abre('normal', {entrar: {perfil: 'gc', gc: 'G1'}, antes: fixo()});
    await page.evaluate(() => { for(const r of rotasAtuais()) Object.assign(nodo('', r).indicators['CCTM 2L PET'], {meta: 0}); });
    await filtra(page, {aba: 'ICS_GC'});
    assert.doesNotMatch(await page.textContent('#lista'), /Meta batida/);
    assert.equal((await caixaCard(page, 'CCTM 2L PET')).rot, 'no ritmo');
    await cascata(page, 'CCTM 2L PET', 'ICS_GC');
    assert.ok((await meioLinhas(page)).every(l => l[3] === 'meta do dia 0'), 'cobertura: rótulo de sempre');
    await page.keyboard.press('Escape');
    await ctx.close();
    assert.deepEqual(erros, []);
    // fechamento: metaDia null (mesmo com valores <= 0 nas rotas) -> "online hoje", como antes
    ({page, ctx, erros} = await abre('fech', {entrar: {perfil: 'gc', gc: 'G1'}}));
    const k = 'VOL REFRIGERANTES';
    await poeMetaDia(page, k, Object.fromEntries((await page.evaluate(() => rotasAtuais())).map(r => [r, -5])));
    await filtra(page, {aba: 'VOLUME'});
    assert.deepEqual([(await caixaCard(page, k)).cls, (await caixaCard(page, k)).rot], ['obox nd', 'online hoje']);
    await cascata(page, k, 'VOLUME');
    assert.ok((await meioLinhas(page)).every(l => l[1] === 'cOn nd' && l[3] === 'online hoje'));
    assert.doesNotMatch(await page.textContent('body'), /Meta batida/);
    assert.deepEqual(erros, []);
    await ctx.close();
  });
});
