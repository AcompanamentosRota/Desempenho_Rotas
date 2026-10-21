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
  // aba Todos a Bordo: cenários montados sobre o sintético normal e o do fechamento (montaIncentivo); payload antigo sem o
  // grupo INCENTIVO (seminc)
  for(const [nome, origem] of [['inc', 'normal'], ['incfech', 'fech']]){
    const dir = path.join(tmp, nome);
    fs.mkdirSync(dir);
    const pi = JSON.parse(fs.readFileSync(path.join(DADOS[origem], 'payload.json'), 'utf-8'));
    const oi = JSON.parse(fs.readFileSync(path.join(DADOS[origem], 'online.json'), 'utf-8'));
    montaIncentivo(pi, oi);
    fs.writeFileSync(path.join(dir, 'payload.json'), JSON.stringify(pi));
    fs.writeFileSync(path.join(dir, 'online.json'), JSON.stringify(oi));
    DADOS[nome] = dir;
  }
  const seminc = path.join(tmp, 'seminc');
  fs.mkdirSync(seminc);
  const si = JSON.parse(fs.readFileSync(path.join(DADOS.normal, 'payload.json'), 'utf-8'));
  delete si.GROUPS.INCENTIVO;
  fs.writeFileSync(path.join(seminc, 'payload.json'), JSON.stringify(si));
  fs.copyFileSync(path.join(DADOS.normal, 'online.json'), path.join(seminc, 'online.json'));
  DADOS.seminc = seminc;
  // payload de antes da Etapa 1, sem SEM_COMPRA_MES (o publicado até rodar o "Atualizar dados" com o gerador novo)
  const semscm = path.join(tmp, 'semscm');
  fs.mkdirSync(semscm);
  const sc = JSON.parse(fs.readFileSync(path.join(DADOS.normal, 'payload.json'), 'utf-8'));
  delete sc.SEM_COMPRA_MES;
  fs.writeFileSync(path.join(semscm, 'payload.json'), JSON.stringify(sc));
  fs.copyFileSync(path.join(DADOS.normal, 'online.json'), path.join(semscm, 'online.json'));
  DADOS.semscm = semscm;
  // PDF do Resumo: 16 gerências e números grandes (montaGrande)
  const grande = path.join(tmp, 'grande');
  fs.mkdirSync(grande);
  const pgr = JSON.parse(fs.readFileSync(path.join(DADOS.normal, 'payload.json'), 'utf-8'));
  const ogr = JSON.parse(fs.readFileSync(path.join(DADOS.normal, 'online.json'), 'utf-8'));
  montaGrande(pgr, ogr);
  fs.writeFileSync(path.join(grande, 'payload.json'), JSON.stringify(pgr));
  fs.writeFileSync(path.join(grande, 'online.json'), JSON.stringify(ogr));
  DADOS.grande = grande;
  browser = await pw.chromium.launch(CHROMIUM ? {executablePath: CHROMIUM} : {});
});
after(async () => {
  if(browser) await browser.close();
  if(tmp) fs.rmSync(tmp, {recursive: true, force: true});
});

const TIPOS = {'.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json',
  '.png':'image/png', '.woff2':'font/woff2', '.webmanifest':'application/manifest+json'};

/* Abre o painel com os dados `nome` ('normal' | 'fech' | 'semdv' | 'antigo' | 'semsv' | 'grupo' | 'semdados' |
   'semscm');
   devolve {page, erros}.
   `armazenado` = localStorage inicial; `busca` = query string (ex.: link do Resumo); `fuso` = fuso do navegador;
   `antes(page)` roda antes de abrir (ex.: relógio simulado); `entrar` = como entra pela entrada (ver entra()). */
async function abre(nome, {armazenado = {}, largura = 1200, altura = 1000, entrar = 'gc', busca = '', fuso, antes,
                           troca = {}} = {}){
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
    // `troca` = {'/js/config.js': texto => texto alterado} (ex.: CONFIG.INCENTIVO_ATIVO = false)
    const corpo = troca[url.pathname] ? troca[url.pathname](fs.readFileSync(arq, 'utf-8')) : fs.readFileSync(arq);
    rota.fulfill({status: 200, contentType: TIPOS[path.extname(arq)] || 'application/octet-stream', body: corpo});
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

describe('Parte S — SEM_COMPRA_MES (chave nova e opcional do payload)', {skip: pular}, () => {
  /* textos dos cards e das gavetas Base / Sem compra em cada aba (a Etapa 1 não muda nada no front) */
  async function telas(page){
    const out = [];
    for(const aba of ['VOLUME', 'ICS_GC', 'NOVOS_NEG', 'INCENTIVO']){
      if(await page.isHidden(`.tab[data-g="${aba}"]`)) continue;
      await filtra(page, {aba});
      out.push(await page.evaluate(() => [document.querySelector('.cards').innerText, document.getElementById('puxa').innerText,
                                           document.getElementById('lista').innerText]));
    }
    for(const card of ['#cBase', '#cSem']){
      await page.click(card);
      out.push(await page.evaluate(() => [document.getElementById('dTit').textContent, document.getElementById('dSub').textContent,
                                           document.getElementById('dCorpo').innerText]));
      await page.keyboard.press('Escape');
    }
    return out;
  }

  test('payload sem SEM_COMPRA_MES (antigo) abre sem erro e com as mesmas telas do payload com a chave', async () => {
    for(const entrar of ['dir', {perfil: 'gc', gc: 'G1'}, {perfil: 'sv', gc: 'G1', sv: '1'}, {perfil: 'rota', gc: 'G1', rota: 'G111'}]){
      const vistas = [];
      for(const nome of ['normal', 'semscm']){
        const {page, ctx, erros} = await abre(nome, {entrar});
        assert.equal(await page.evaluate(() => 'SEM_COMPRA_MES' in P), nome === 'normal', nome);
        vistas.push(await telas(page));
        assert.deepEqual(erros, [], `${nome} ${JSON.stringify(entrar)}`);
        await ctx.close();
      }
      assert.ok(vistas[0].length >= 5);
      assert.deepEqual(vistas[1], vistas[0], JSON.stringify(entrar));
    }
  });

  test('o sintético traz a lista: tamanho = semCompra e contém o SEM_COMPRA_HOJE', () => {
    const p = JSON.parse(fs.readFileSync(path.join(DADOS.normal, 'payload.json'), 'utf-8'));
    assert.equal(Object.keys(p).at(-1), 'SEM_COMPRA_MES');
    assert.deepEqual(Object.keys(p.SEM_COMPRA_MES), Object.keys(p.SEM_COMPRA_HOJE));
    for(const svs of Object.values(p.DATA)) for(const rotas of Object.values(svs)) for(const [r, d] of Object.entries(rotas)){
      const l = p.SEM_COMPRA_MES[r];
      assert.equal(l == null ? null : l.length, d.semCompra, r);
      for(const pv of p.SEM_COMPRA_HOJE[r] || []) assert.ok(l.includes(pv), r);
    }
  });
});

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

/* ---------- Parte K: "Meta batida!" (volume: meta do dia do nível <= 0; coberturas: Real >= Meta do mês; só rótulo e cor) ---------- */
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

  test('coberturas: "Meta batida!" com Real >= Meta do mês (card, linhas, "Neutraliza", total somado, Diretoria, Novos Negócios)', async () => {
    const {page, ctx, erros} = await abre('normal', {entrar: {perfil: 'gc', gc: 'G1'}, antes: fixo()});
    const k = 'CCTM 2L PET';
    // põe Meta e Real de cobertura nas rotas: {rota: [meta, real]}
    const poeCob = (k, v) => page.evaluate(([k, v]) => { for(const r in v) Object.assign(nodo('', r).indicators[k], {meta: v[r][0], real: v[r][1]}); }, [k, v]);
    const onlCob = (k, rs) => page.evaluate(([k, rs]) => rs.reduce((a, r) => a + (((ONLINE.rotas || {})[r] || {})[k] || 0), 0), [k, rs]);
    // como era antes: "meta do dia" = faltam hoje (ou a fatia do mês); verde e "no ritmo" se o online alcança
    const comoAntes = (k, rs) => page.evaluate(([k, rs]) => {
      const b = agrega(rs).ind[k], fatia = b.meta ? Math.ceil(b.meta / P.TOTAL_DIAS_UTEIS) : 0, md = b.gap > 0 ? b.gap : fatia;
      const onl = rs.reduce((a, r) => a + (((ONLINE.rotas || {})[r] || {})[k] || 0), 0);
      return {md, onl, ok: onl >= md};
    }, [k, rs]);
    // SV.G1.1 (2/2 e 3/2) e a Neutraliza 151 (2/2) alcançaram a meta; SV.G1.2 (1/4 e 1/4) não; a G1 (10/14) também não
    await poeCob(k, {G111: [2, 2], G112: [2, 3], G121: [4, 1], G122: [4, 1], 151: [2, 2]});
    await filtra(page, {aba: 'ICS_GC'});
    const todas = ['G111', 'G112', 'G121', 'G122', '151'];
    let antes = await comoAntes(k, todas), c = await caixaCard(page, k);
    assert.deepEqual([/\bok\b/.test(c.cls), c.num, c.rot], [antes.ok, String(antes.onl), antes.ok ? 'no ritmo' : `meta do dia ${antes.md}`],
                     'total abaixo da meta: como antes');
    await cascata(page, k, 'ICS_GC');
    const sv2 = await comoAntes(k, ['G121', 'G122']);
    assert.deepEqual((await meioLinhas(page)).map(l => l.slice(0, 4)), [
      ['SV.G1.1 · Supervisor', 'cOn ok', String(await onlCob(k, ['G111', 'G112'])), 'Meta batida!'],
      ['SV.G1.2 · Supervisor', sv2.ok ? 'cOn ok' : 'cOn no', String(sv2.onl), `meta do dia ${sv2.md}`],
      ['Neutraliza', 'cOn ok', String(await onlCob(k, ['151'])), 'Meta batida!']]);
    await page.click('#dCorpo .cLin[data-i="0"]');
    assert.deepEqual((await meioLinhas(page)).map(l => [l[0], l[1], l[3]]),
                     [['Rota G111', 'cOn ok', 'Meta batida!'], ['Rota G112', 'cOn ok', 'Meta batida!']]);
    await page.keyboard.press('Escape');
    // total somado alcança a meta (16/14): card verde com "Meta batida!" e o online de todas as rotas; números iguais
    await poeCob(k, {G121: [4, 4], G122: [4, 5]});
    const snap = await page.evaluate(() => JSON.stringify([P, ONLINE]));
    await filtra(page, {});
    await cascata(page, k, 'ICS_GC');
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => JSON.stringify([P, ONLINE])), snap, 'o front não altera nenhum valor do payload');
    c = await caixaCard(page, k);
    assert.deepEqual([c.cls, c.num, c.rot], ['obox ok', String(await onlCob(k, todas)), 'Meta batida!']);
    const card = await page.evaluate(k => ({b: agrega(rotasAtuais()).ind[k],
      cl: document.querySelector(`.ind[data-k="${k}"] .cl`).textContent.replace(/\s+/g, ' ').trim()}), k);
    assert.deepEqual([card.b.meta, card.b.real, card.b.pct], [14, 16, 114]);
    assert.equal(card.cl, 'Meta 14 Real 16 Diferença +2');
    // abaixo da meta (KS TT sem cobertura) e meta 0: como antes; Venda Zero: como antes (revertidos)
    const ks = await comoAntes('KS TT', todas);
    c = await caixaCard(page, 'KS TT');
    assert.deepEqual([/\bok\b/.test(c.cls), c.rot], [ks.ok, ks.ok ? 'no ritmo' : `meta do dia ${ks.md}`]);
    await poeCob('KAPO', Object.fromEntries(todas.map(r => [r, [0, 0]])));
    await filtra(page, {});
    assert.equal((await caixaCard(page, 'KAPO')).rot, 'no ritmo', 'meta 0: como antes');
    c = await caixaCard(page, 'VENDAZERO');
    assert.deepEqual([c.cls, c.rot], ['obox ok', 'revertidos']);
    await cascata(page, 'VENDAZERO', 'ICS_GC');
    assert.ok((await meioLinhas(page)).every(l => l[3] === 'revertidos hoje'));
    await page.keyboard.press('Escape');
    // Novos Negócios também
    const nn = await page.evaluate(() => GROUPS.NOVOS_NEG.find(x => !['VENDAZERO', 'IMPERDOAVEIS'].includes(x)));
    await poeCob(nn, Object.fromEntries(todas.map(r => [r, [3, 3]])));
    await filtra(page, {aba: 'NOVOS_NEG'});
    assert.deepEqual([(await caixaCard(page, nn)).cls, (await caixaCard(page, nn)).rot], ['obox ok', 'Meta batida!']);
    await filtra(page, {aba: 'ICS_GC'});
    // Diretoria: a linha da G1 (16/14)
    await vaiPara(page, 'dir');
    await cascata(page, k, 'ICS_GC');
    const lg1 = (await meioLinhas(page)).find(l => l[0] === 'GC.G1 · Goiânia 01');
    assert.deepEqual([lg1[1], lg1[3]], ['cOn ok', 'Meta batida!']);
    await page.keyboard.press('Escape');
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('fechamento sem "Meta batida!" (volume e coberturas como antes)', async () => {
    const {page, ctx, erros} = await abre('fech', {entrar: {perfil: 'gc', gc: 'G1'}});
    const k = 'VOL REFRIGERANTES';
    // volume: metaDia null no fechamento (mesmo com valores <= 0 nas rotas) -> "online hoje"
    await poeMetaDia(page, k, Object.fromEntries((await page.evaluate(() => rotasAtuais())).map(r => [r, -5])));
    await filtra(page, {aba: 'VOLUME'});
    assert.deepEqual([(await caixaCard(page, k)).cls, (await caixaCard(page, k)).rot], ['obox nd', 'online hoje']);
    await cascata(page, k, 'VOLUME');
    assert.ok((await meioLinhas(page)).every(l => l[1] === 'cOn nd' && l[3] === 'online hoje'));
    await page.keyboard.press('Escape');
    // coberturas: mesmo com Real >= Meta, o rótulo de antes
    await page.evaluate(() => { for(const r of rotasAtuais()) Object.assign(nodo('', r).indicators['CCTM 2L PET'], {meta: 2, real: 3}); });
    await filtra(page, {aba: 'ICS_GC'});
    assert.match((await caixaCard(page, 'CCTM 2L PET')).rot, /^(no ritmo|meta do dia \d+)$/);
    await cascata(page, 'CCTM 2L PET', 'ICS_GC');
    assert.ok((await meioLinhas(page)).every(l => l[1] === 'cOn nd' && l[3] === 'online hoje'));
    await page.keyboard.press('Escape');
    assert.doesNotMatch(await page.textContent('body'), /Meta batida/);
    assert.deepEqual(erros, []);
    await ctx.close();
  });
});

/* Cenário 'grande' (PDF do Resumo): as 16 gerências com dados (a DI ganha uma cópia da PA, rotas DI11..DI22 e
   supervisões SV.DI.n, nomes fictícios como os do sintético), os 5 agrupadores de volume em todas as rotas e números
   grandes: na Diretoria, Meta dia, Online e Faltam com 6-7 dígitos (até ~2,7 milhões) e Reverter com 6. */
function montaGrande(p, o){
  const PORROTA = ['CLIENT_ROSTER', 'CLIENTES_HOJE', 'OPORTUNIDADES_DIA', 'COBERTOS', 'SEM_COMPRA_HOJE', 'COMODATO_ATIVOS',
    'REVERTIDO_HOJE', 'OPORTUNIDADE_HOJE', 'VOLUME_CLIENTE', 'REDES_CLIENTE', 'COMODATO_CLIENTE'];
  const di = s => s.replace(/SV\.PA\./g, 'SV.DI.').replace(/\bPA(\d)/g, 'DI$1');
  p.DATA.DI = JSON.parse(di(JSON.stringify(p.DATA.PA)));
  for(const [sv, nome] of Object.entries(p.NOME_SUPERVISOR)) if(sv.startsWith('SV.PA.')) p.NOME_SUPERVISOR[di(sv)] = di(nome);
  const rotasPa = Object.values(p.DATA.PA).flatMap(rs => Object.keys(rs));
  for(const r of rotasPa){
    for(const k of PORROTA) if(p[k] && r in p[k]) p[k][di(r)] = JSON.parse(JSON.stringify(p[k][r]));
    for(const k of Object.keys(o)) if(o[k] && typeof o[k] === 'object' && r in o[k]) o[k][di(r)] = JSON.parse(JSON.stringify(o[k][r]));
  }
  p.GC_ATIVAS = Object.keys(p.GC_NOMES).filter(g => p.DATA[g]);
  const VOL = ['VOL REFRIGERANTES', 'VOL CERVEJAS', 'VOL STILL', 'VOL AGUA MINERAL', 'VOL DEST+ART+CND'];
  o.volume = o.volume || {};
  for(const svs of Object.values(p.DATA)) for(const rs of Object.values(svs)) for(const [r, d] of Object.entries(rs)){
    const base = d.indicators['VOL REFRIGERANTES'];
    if(base && !base.unavailable && base.meta){
      for(const k of VOL){
        const b = d.indicators[k] = JSON.parse(JSON.stringify(base));
        for(const c of ['meta', 'real', 'tendencia', 'metaDia', 'negRestante', 'metaNegClientes']) if(b[c] != null) b[c] *= 600;
        (o.volume[r] = o.volume[r] || {})[k] = Math.round((b.metaDia || 0) * 0.93);
      }
    }
    for(const [k, b] of Object.entries(d.indicators)) if(!/^VOL /.test(k) && !b.unavailable && b.meta != null) b.meta *= 20000;
  }
  for(const k of ['REVERTIDO_HOJE', 'OPORTUNIDADE_HOJE']) for(const r in p[k]) p[k][r] = (p[k][r] || 1) * 50000;
}

/* ---------- Parte L: aba Todos a Bordo (campanha "Todos a Bordo 3.0", chave INCENTIVO) ---------- */
/* Cenário sobre o sintético (os 5 itens com meta 2 em todas as rotas e Real 0): Heineken e Heineken - 600ml só nas
   gerências FULL (RV, SL, PO, IT, MO, UR, RI) e na G211 (G2 mista); Eisenbahn - 600ml sem meta na G3. Rotas de
   cenário: IT11 com todos os itens batidos (Heineken pela união Real + online: o cliente do Real que comprou de novo
   hoje conta uma vez), IT12 com a Heineken abaixo e o agregado em 110%, G212 sem os itens Heineken (os outros
   batidos) e G311 sem nenhum item com meta. */
// (função, não const: o before() do arquivo monta os cenários antes de chegar a esta linha)
function gcsFull(){ return ['RV', 'SL', 'PO', 'IT', 'MO', 'UR', 'RI']; }
function montaIncentivo(p, o){
  const no = {};
  for(const [gc, svs] of Object.entries(p.DATA)) for(const rotas of Object.values(svs))
    for(const [r, d] of Object.entries(rotas)) no[r] = [gc, d];
  const sem = {meta: null, real: null, pct: null, onPace: null, gap: null, unavailable: true};
  const tira = (r, k) => {
    no[r][1].indicators[k] = {...sem};
    delete (p.COBERTOS[r] || {})[k]; delete (o.clientes[r] || {})[k]; delete (o.rotas[r] || {})[k];
  };
  const poe = (r, k, cob, onl = []) => {
    const d = no[r][1];
    d.indicators[k] = {...d.indicators[k], meta: 2, real: cob.length, unavailable: false};
    (p.COBERTOS[r] = p.COBERTOS[r] || {})[k] = cob;
    if(onl.length){ (o.clientes[r] = o.clientes[r] || {})[k] = onl; (o.rotas[r] = o.rotas[r] || {})[k] = onl.length; }
  };
  for(const r in no){
    const gc = no[r][0];
    for(const k of ['INC HEINEKEN', 'INC HEINEKEN 600ML']) if(!gcsFull().includes(gc) && r !== 'G211') tira(r, k);
    if(gc === 'G3') tira(r, 'INC EISENBAHN 600ML');
  }
  for(const k of p.GROUPS.INCENTIVO) tira('G311', k);
  const pvs = r => p.CLIENT_ROSTER[r].map(c => c[0]);
  const [a, b, c] = pvs('IT11');
  poe('IT11', 'CERVEJAS', [a, b]); poe('IT11', 'INC HEINEKEN', [a], [a, b]); poe('IT11', 'INC EISENBAHN 600ML', [a, b, c]);
  poe('IT11', 'INC HEINEKEN 600ML', [a, b], [c]); poe('IT11', 'CERVEJAS 600ML RETORNAVEL', [a, b]);
  const [d, e, f] = pvs('IT12');
  poe('IT12', 'CERVEJAS', [d, e, f], [999901]); poe('IT12', 'INC HEINEKEN', [d]); poe('IT12', 'INC EISENBAHN 600ML', [d, e]);
  poe('IT12', 'INC HEINEKEN 600ML', [d, e]); poe('IT12', 'CERVEJAS 600ML RETORNAVEL', [d, e]);
  const [g, h] = pvs('G212');
  for(const k of ['CERVEJAS', 'INC EISENBAHN 600ML', 'CERVEJAS 600ML RETORNAVEL']) poe('G212', k, [g, h]);
}
const TITULOS_INC = ['Cervejas', 'Heineken', 'Eisenbahn - 600ml', 'Heineken - 600ml', 'Cervejas 600ml Retornável'];
/* cards da aba Todos a Bordo por chave (data-k; sem meta: data-inc-off) */
const cardsInc = page => page.$$eval('#lista .ind', els => Object.fromEntries(els.map(el => {
  const n = c => el.dataset[c] == null ? null : Number(el.dataset[c]);
  const txt = s => ((el.querySelector(s) || {}).textContent || '').replace(/\s+/g, ' ').trim();
  const ob = el.querySelector('.obox');
  return [el.dataset.k || el.dataset.incOff || '?', {
    off: el.classList.contains('off'), ok: el.classList.contains('ok'), abre: el.hasAttribute('data-k'),
    meta: n('meta'), real: n('real'), ef: n('ef'), big: txt('.big'), acao: txt('.acao'), opo: txt('.opo'),
    semdado: txt('.semdado'), cl: txt('.cl'), html: el.outerHTML,
    obox: ob ? [ob.className.trim(), ob.querySelector('b').textContent, ob.querySelector('span').textContent.trim()] : null}];
})));
// Meta e Real do card (texto da coluna da esquerda)
const metaReal = c => (c.cl.match(/Meta ([\d.]+) Real ([\d.]+)/) || []).slice(1).map(x => Number(x.replace(/\./g, '')));
const terceiroCard = page => page.evaluate(() => [document.getElementById('lRitmo').textContent,
  document.getElementById('nRitmo').textContent, document.getElementById('nRitmo').className.trim(),
  document.getElementById('xRitmo').textContent]);
// linha "Status" do card do topo: null = sem a linha; senão [status, marca, marca verde?]
const statusTopo = page => page.evaluate(() => {
  const el = document.getElementById('stRitmo');
  if(el.hidden || getComputedStyle(el).display === 'none') return null;
  const m = el.querySelector('.stMarca');
  const verde = document.createElement('span');
  verde.style.color = 'var(--verde)'; el.appendChild(verde);
  const cor = getComputedStyle(verde).color; verde.remove();
  return [el.dataset.status, el.textContent.replace(/\s+/g, ' ').trim(), getComputedStyle(m).color === cor];
});
const visivelInc = page => page.isVisible('.tab[data-g="INCENTIVO"]');
/* soma das linhas da gaveta (meta, real) e das notas */
const somaLinhas = g => ['meta', 'real'].map(c => g.reduce((a, l) => a + (l[c] || 0), 0));
const linhasInc = page => page.$$eval('#dCorpo .cLin', ls => ls.map(l => ({nome: l.querySelector('.cNome b').textContent,
  info: l.querySelector('.cNome small').textContent, ok: l.classList.contains('ok'), abre: l.hasAttribute('data-i'),
  meta: Number(l.dataset.meta), real: Number(l.dataset.real), dir: Number(l.dataset.dir), ef: l.dataset.ef,
  meio: l.querySelector('.cMeio').textContent.replace(/\s+/g, ' ').trim(),
  dirTxt: l.querySelector('.cDir').textContent.replace(/\s+/g, ' ').trim()})));
const notasInc = page => page.$$eval('#dCorpo .cNota', ns => ns.map(n => ({meta: Number(n.dataset.meta),
  real: Number(n.dataset.real), texto: n.textContent})));
const COM_ONLINE = {'/js/config.js': t => t.replace('STATUS_INCLUI_ONLINE: false', 'STATUS_INCLUI_ONLINE: true')};

describe('Parte L — aba Todos a Bordo', {skip: pular}, () => {
  test('aba "Todos a Bordo" ao lado de Novos Negócios em todos os perfis e visões; sem card Status; oculta com INCENTIVO_ATIVO = false e no payload antigo', async () => {
    let {page, ctx, erros, fonte} = await abre('inc', {entrar: 'dir'});
    assert.deepEqual(await page.$$eval('.tab', ts => ts.map(t => [t.dataset.g, t.textContent])),
                     [['VOLUME', 'Volume'], ['ICS_GC', 'ICS GC'], ['NOVOS_NEG', 'Novos Negócios'], ['INCENTIVO', 'Todos a Bordo']]);
    assert.equal(await page.getAttribute('.tab[data-g="INCENTIVO"]', 'aria-label'), 'Todos a Bordo');
    const ics = await page.evaluate(() => { document.querySelector('.tab[data-g="ICS_GC"]').click();
      return [...document.querySelectorAll('#lista .ind .tit')].map(t => t.textContent); });
    for(const entrar of ['dir', {perfil: 'gc', gc: 'G2'}, {perfil: 'gc', gc: 'IT+MO'}, {perfil: 'sv', gc: 'IT+MO', sv: 'SV.IT.1'},
                         {perfil: 'rota', gc: 'IT+MO', rota: 'IT11'}]){
      if(entrar !== 'dir') await vaiPara(page, entrar);
      assert.ok(await visivelInc(page), JSON.stringify(entrar));
      await filtra(page, {aba: 'INCENTIVO'});
      // começa direto nos cinco cards, sem o card "Status Todos a Bordo 3.0"
      assert.deepEqual(await page.$$eval('#lista .ind .tit', t => t.map(x => x.textContent)), TITULOS_INC, JSON.stringify(entrar));
      assert.equal(await page.$$eval('#lista .incStatus', e => e.length), 0);
      assert.equal((await terceiroCard(page))[0], 'Itens em 100%');
      assert.ok(await statusTopo(page), 'linha Status ' + JSON.stringify(entrar));
      assert.equal(await page.innerHTML('#puxa'), '', 'sem "puxa a média" na aba Todos a Bordo');
    }
    assert.doesNotMatch(await page.textContent('body'), /Incentivo|Status Todos a Bordo|real \+ hoje/);
    // de volta ao ICS GC: o card e a contagem de antes; os itens INC não entram no ICS; sem a linha Status
    await vaiPara(page, 'dir');
    await filtra(page, {aba: 'ICS_GC'});
    assert.equal((await terceiroCard(page))[0], 'Ritmo de coberturas');
    assert.equal(await statusTopo(page), null);
    assert.deepEqual(await page.$$eval('#lista .ind .tit', t => t.map(x => x.textContent)), ics);
    assert.ok(!ics.some(t => /Heineken|600ml$/.test(t)), ics.join('|'));
    // payload novo sem o grupo (payload antigo) com a aba aberta: a aba some e volta para o ICS GC
    await filtra(page, {aba: 'INCENTIVO'});
    fonte.nome = 'seminc';
    await page.evaluate(() => recarregaPayload());
    assert.deepEqual([await visivelInc(page), await page.evaluate(() => aba)], [false, 'ICS_GC']);
    assert.deepEqual(erros, []);
    await ctx.close();
    for(const [nome, troca] of [['inc', {'/js/config.js': t => t.replace('INCENTIVO_ATIVO: true', 'INCENTIVO_ATIVO: false')}],
                                ['seminc', {}]]){
      ({page, ctx, erros} = await abre(nome, {entrar: 'dir', troca}));
      assert.equal(await visivelInc(page), false, nome);
      assert.equal(await page.$$eval('#lista .ind', els => els.length) > 0, true);
      await filtra(page, {aba: 'NOVOS_NEG'});
      assert.ok(await statusTopo(page), 'Novos Negócios com a linha Status também sem a aba ' + nome);
      assert.deepEqual(erros, []);
      await ctx.close();
    }
  });

  test('cards dos itens = cards do ICS GC (função, métricas, régua de ritmo, oportunidades, caixa Online); "Sem meta"', async () => {
    const {page, ctx, erros} = await abre('inc', {entrar: {perfil: 'gc', gc: 'IT+MO'}});
    await page.selectOption('#fgc', 'IT');
    // escopo com meta em todas as rotas: os cards de Cervejas e Cervejas 600ml Retornável são idênticos aos do ICS GC
    await filtra(page, {aba: 'ICS_GC'});
    const ics = await cardsInc(page);
    await filtra(page, {aba: 'INCENTIVO'});
    let c = await cardsInc(page);
    for(const k of ['CERVEJAS', 'CERVEJAS 600ML RETORNAVEL']) assert.equal(c[k].html, ics[k].html, k);
    // mesma estrutura do ICS: Meta, Real, Diferença; % do mês; texto do ritmo; caixa Online; nada de EF/"real + hoje"
    for(const k of Object.keys(c)){
      assert.ok(c[k].abre && c[k].obox && /^Meta \d+ Real \d+ Diferença [-+]?\d+$/.test(c[k].cl), k + ' ' + c[k].cl);
      assert.match(c[k].big, /^[▲▼]\d+%$/);
      assert.match(c[k].acao, /^(faltam \d+ hoje|no ritmo)$/);
      assert.equal(c[k].ef, null);
      assert.doesNotMatch(c[k].html, /real \+ hoje|data-ef/);
    }
    // IT11: Heineken Real 1 de 2 = 50%: verde pela régua do ritmo (>= PACE_ONTEM_PCT), sem contar o online no %
    await vaiPara(page, {perfil: 'rota', gc: 'IT+MO', rota: 'IT11'});
    const pace = await page.evaluate(() => P.PACE_ONTEM_PCT);
    assert.ok(pace <= 50);
    c = await cardsInc(page);
    assert.deepEqual([c['INC HEINEKEN'].cl, c['INC HEINEKEN'].big, c['INC HEINEKEN'].ok, c['INC HEINEKEN'].acao,
                      c['INC HEINEKEN'].opo], ['Meta 2 Real 1 Diferença -1', '▲50%', true, 'no ritmo', 'oportunidades do dia 2']);
    assert.deepEqual(c['INC HEINEKEN'].obox, ['obox ok', '2', 'no ritmo']);
    // Real >= Meta: "Meta batida!" na caixa do Online (regra do ICS); 150% pela conta Real / Meta
    assert.deepEqual([c['INC EISENBAHN 600ML'].big, c['INC EISENBAHN 600ML'].obox], ['▲150%', ['obox ok', '0', 'Meta batida!']]);
    assert.deepEqual([c['INC HEINEKEN 600ML'].big, c['INC HEINEKEN 600ML'].obox], ['▲100%', ['obox ok', '1', 'Meta batida!']]);
    // IT21: Real 0 = 0%, vermelho, "faltam 1 hoje" e meta do dia na caixa do Online
    await vaiPara(page, {perfil: 'rota', gc: 'IT+MO', rota: 'IT21'});
    c = await cardsInc(page);
    assert.deepEqual([c['INC HEINEKEN'].big, c['INC HEINEKEN'].ok, c['INC HEINEKEN'].acao], ['▼0%', false, 'faltam 1 hoje']);
    assert.match(c['INC HEINEKEN'].obox[2], /^meta do dia 1$/);
    // gerência BARRACUDA (AP): Heineken e Heineken - 600ml "Exclusivo portfólio Full"; os outros normais
    await vaiPara(page, {perfil: 'gc', gc: 'AP'});
    c = await cardsInc(page);
    assert.deepEqual(['INC HEINEKEN', 'INC HEINEKEN 600ML'].map(k => [c[k].off, c[k].semdado, c[k].abre]),
                     [[true, 'Exclusivo portfólio Full', false], [true, 'Exclusivo portfólio Full', false]]);
    assert.ok(!c.CERVEJAS.off && !c['INC EISENBAHN 600ML'].off);
    await page.click('.ind[data-inc-off="INC HEINEKEN"]');
    assert.equal(await page.evaluate(() => document.getElementById('drw').classList.contains('on')), false);
    // G3: Eisenbahn - 600ml sem meta = "Sem meta"
    await vaiPara(page, {perfil: 'gc', gc: 'G3'});
    c = await cardsInc(page);
    assert.deepEqual([c['INC EISENBAHN 600ML'].off, c['INC EISENBAHN 600ML'].semdado], [true, 'Sem meta']);
    // G2 mista: só a G211 tem meta de Heineken (as outras rotas ficam fora da soma)
    await vaiPara(page, {perfil: 'gc', gc: 'G2'});
    c = await cardsInc(page);
    const g211 = await page.evaluate(() => nodo('', 'G211').indicators['INC HEINEKEN']);
    assert.deepEqual([c['INC HEINEKEN'].off, ...metaReal(c['INC HEINEKEN'])], [false, g211.meta, g211.real]);
    const semEstilo = h => h.replace(/ style="[^"]*"/g, '');     // encaixa() ajusta a fonte depois de pintar
    assert.equal(semEstilo(c['INC HEINEKEN'].html),
                 await page.evaluate(() => linha('INC HEINEKEN', agrega(['G211']).ind['INC HEINEKEN'], ['G211'])));
    // FULL (IT): todas as rotas da IT com meta, inclusive a Neutraliza I31
    await vaiPara(page, {perfil: 'gc', gc: 'IT+MO'});
    await page.selectOption('#fgc', 'IT');
    c = await cardsInc(page);
    const it = await page.evaluate(() => rotasDe('IT', '').filter(r => temMetaInc('INC HEINEKEN', r)));
    assert.deepEqual(it.sort(), ['I31', 'IT11', 'IT12', 'IT21', 'IT22']);
    assert.deepEqual(metaReal(c['INC HEINEKEN']), [10, 2]);
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('linha "Status" do card do topo: "-" parcial, "✓" verde com todos em 100% (Real >= Meta), sem meta, BARRACUDA fora da conta', async () => {
    const {page, ctx, erros} = await abre('inc', {entrar: {perfil: 'rota', gc: 'IT+MO', rota: 'IT11'}});
    await filtra(page, {aba: 'INCENTIVO'});
    // fonte visivelmente menor que a do rótulo "itens em 100%"
    const tam = await page.evaluate(() => ['lRitmo', 'stRitmo'].map(id => parseFloat(getComputedStyle(document.getElementById(id)).fontSize)));
    assert.ok(tam[1] <= tam[0] - 2, tam.join(' > '));
    // IT11: Heineken com Real 1 de 2 (o online não conta com STATUS_INCLUI_ONLINE = false): 4 / 5, "-"
    assert.deepEqual(await terceiroCard(page), ['Itens em 100%', '4 / 5', 'n no', 'abaixo de 100%']);
    assert.deepEqual(await statusTopo(page), ['parcial', 'Status -', false]);
    // IT12: Heineken abaixo: 4 / 5
    await vaiPara(page, {perfil: 'rota', gc: 'IT+MO', rota: 'IT12'});
    assert.deepEqual((await terceiroCard(page)).slice(1, 3), ['4 / 5', 'n no']);
    assert.deepEqual(await statusTopo(page), ['parcial', 'Status -', false]);
    // G212 (BARRACUDA): os itens Heineken ficam fora da conta; os 3 com meta batidos: "✓" verde
    await vaiPara(page, {perfil: 'rota', gc: 'G2', rota: 'G212'});
    assert.deepEqual(await terceiroCard(page), ['Itens em 100%', '3 / 3', 'n ok', 'todos em 100%']);
    assert.deepEqual(await statusTopo(page), ['ok', 'Status ✓', true]);
    // G311: nenhum item com meta: "0 / 0", sem a linha Status
    await vaiPara(page, {perfil: 'rota', gc: 'G3', rota: 'G311'});
    assert.deepEqual(await terceiroCard(page), ['Itens em 100%', '0 / 0', 'n', 'sem meta']);
    assert.equal(await statusTopo(page), null);
    // gerência BARRACUDA (AP): n = 3 (sem os Heineken); todos batidos depois de pôr Real = Meta: "✓"
    await vaiPara(page, {perfil: 'gc', gc: 'AP'});
    assert.deepEqual(await terceiroCard(page), ['Itens em 100%', '0 / 3', 'n no', 'abaixo de 100%']);
    assert.deepEqual(await statusTopo(page), ['parcial', 'Status -', false]);
    await ritmo(page, 'AP', await page.evaluate(() => rotasDe('AP', '')), 1);
    await filtra(page, {});
    assert.deepEqual(await terceiroCard(page), ['Itens em 100%', '3 / 3', 'n ok', 'todos em 100%']);
    assert.deepEqual(await statusTopo(page), ['ok', 'Status ✓', true]);
    // Diretoria e grupo: a mesma conta sobre o escopo
    await vaiPara(page, 'dir');
    await filtra(page, {aba: 'INCENTIVO'});
    assert.deepEqual(await statusTopo(page), ['parcial', 'Status -', false]);
    assert.equal((await terceiroCard(page))[1], '0 / 5');
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('STATUS_INCLUI_ONLINE = true: item em 100% pela união Real ou online de hoje (clientes distintos)', async () => {
    const {page, ctx, erros} = await abre('inc', {entrar: {perfil: 'rota', gc: 'IT+MO', rota: 'IT11'}, troca: COM_ONLINE});
    await filtra(page, {aba: 'INCENTIVO'});
    // IT11: Heineken Real [a] + online [a, b] = 2 clientes distintos = Meta: 5 / 5, "✓"
    assert.deepEqual((await terceiroCard(page)).slice(1, 3), ['5 / 5', 'n ok']);
    assert.deepEqual(await statusTopo(page), ['ok', 'Status ✓', true]);
    // o card não muda: % pelo Real (50%), como no ICS
    assert.equal((await cardsInc(page))['INC HEINEKEN'].big, '▲50%');
    // IT12: Heineken sem online continua abaixo
    await vaiPara(page, {perfil: 'rota', gc: 'IT+MO', rota: 'IT12'});
    assert.deepEqual(await statusTopo(page), ['parcial', 'Status -', false]);
    // o mesmo cliente do Real comprando de novo hoje não conta duas vezes
    await page.evaluate(() => { ONLINE.clientes.IT12['INC HEINEKEN'] = [...COBERTOS.IT12['INC HEINEKEN']]; render(); });
    assert.deepEqual(await statusTopo(page), ['parcial', 'Status -', false]);
    await page.evaluate(() => { ONLINE.clientes.IT12['INC HEINEKEN'].push(987654); render(); });
    assert.deepEqual(await statusTopo(page), ['ok', 'Status ✓', true]);
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('Novos Negócios: mesma linha "Status" no "Ritmo de coberturas" (contagem e texto iguais); ICS GC e Volume sem ela', async () => {
    let {page, ctx, erros} = await abre('inc', {entrar: {perfil: 'rota', gc: 'IT+MO', rota: 'IT11'}});
    await filtra(page, {aba: 'NOVOS_NEG'});
    const antes = await terceiroCard(page);
    assert.deepEqual([antes[0], antes[3]], ['Ritmo de coberturas', 'abaixo do ritmo']);
    assert.deepEqual(await statusTopo(page), ['parcial', 'Status -', false]);
    for(const a of ['ICS_GC', 'VOLUME']){ await filtra(page, {aba: a}); assert.equal(await statusTopo(page), null, a); }
    // todos os itens de Novos Negócios com Real = Meta: "✓" verde; contagem e texto do ritmo como sempre
    await ritmo(page, 'IT', ['IT11'], 1);
    await filtra(page, {aba: 'NOVOS_NEG'});
    const n = await page.evaluate(() => P.COV_GRUPO.NOVOS_NEG.length);
    assert.deepEqual(await terceiroCard(page), ['Ritmo de coberturas', `${n} / ${n}`, 'n ok', 'dentro do ritmo']);
    assert.deepEqual(await statusTopo(page), ['ok', 'Status ✓', true]);
    await filtra(page, {aba: 'ICS_GC'});
    assert.equal(await statusTopo(page), null);
    // um item abaixo de 100% (mesmo no ritmo): "-"
    await page.evaluate(() => { nodo('', 'IT11').indicators.CAMPARI.real = 1; });
    await filtra(page, {aba: 'NOVOS_NEG'});
    assert.deepEqual(await statusTopo(page), ['parcial', 'Status -', false]);
    assert.deepEqual(erros, []);
    await ctx.close();
    // STATUS_INCLUI_ONLINE = true: o cliente novo do online de hoje completa o item
    ({page, ctx, erros} = await abre('inc', {entrar: {perfil: 'rota', gc: 'IT+MO', rota: 'IT11'}, troca: COM_ONLINE}));
    await ritmo(page, 'IT', ['IT11'], 1);
    await page.evaluate(() => { nodo('', 'IT11').indicators.CAMPARI.real = 1; COBERTOS.IT11.CAMPARI = [111];
      (ONLINE.clientes.IT11 = ONLINE.clientes.IT11 || {}).CAMPARI = [111]; });
    await filtra(page, {aba: 'NOVOS_NEG'});
    assert.deepEqual(await statusTopo(page), ['parcial', 'Status -', false], 'o mesmo cliente não conta duas vezes');
    await page.evaluate(() => { ONLINE.clientes.IT11.CAMPARI.push(222); render(); });
    assert.deepEqual(await statusTopo(page), ['ok', 'Status ✓', true]);
    // Diretoria: a linha também aparece
    await vaiPara(page, 'dir');
    await filtra(page, {aba: 'NOVOS_NEG'});
    assert.deepEqual(await statusTopo(page), ['parcial', 'Status -', false]);
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('cascatas: as do ICS GC (soma das linhas = card), só rotas com meta, até os clientes; grupo com o filtro', async () => {
    const {page, ctx, erros} = await abre('inc', {entrar: 'dir'});
    await filtra(page, {aba: 'INCENTIVO'});
    let c = await cardsInc(page);
    // Diretoria: Heineken só nas gerências com meta (FULL e a G2 mista), soma = card; linhas com o % do mês
    await page.click('.ind[data-k="INC HEINEKEN"]');
    let g = await linhasInc(page);
    assert.deepEqual(g.map(l => l.nome.split(' ·')[0]), ['G2', ...gcsFull()].map(x => 'GC.' + x)
      .sort((a, b) => ORDEM.indexOf(a.slice(3)) - ORDEM.indexOf(b.slice(3))));
    assert.deepEqual(somaLinhas(g), metaReal(c['INC HEINEKEN']));
    assert.ok(g.every(l => l.ef === undefined && /do mês$/.test(l.dirTxt) && l.dir === Math.round(l.real / l.meta * 100)));
    assert.match(await page.textContent('#dTit'), /^Heineken · Diretoria$/);
    assert.match(await page.textContent('#dSub'), /^Meta \d+ · Real \d+ · (faltam \d+ para o ritmo de hoje|no ritmo)$/);
    await page.keyboard.press('Escape');
    // IT (todas as rotas com meta): a cascata de Cervejas é a mesma do ICS GC
    await vaiPara(page, {perfil: 'gc', gc: 'IT+MO'});
    await page.selectOption('#fgc', 'IT');
    const corpo = async aba => { await filtra(page, {aba}); await page.click('.ind[data-k="CERVEJAS"]');
      const h = [await page.textContent('#dTit'), await page.textContent('#dSub'), await page.innerHTML('#dCorpo')];
      await page.click('#dCorpo .cLin[data-i="0"]'); await page.click('#dCorpo .cLin[data-i="0"]');
      h.push(await page.innerHTML('#dCorpo')); await page.keyboard.press('Escape'); return h; };
    assert.deepEqual(await corpo('INCENTIVO'), await corpo('ICS_GC'));
    // RV: supervisões, a linha "Neutraliza" (R31) e a nota da virtual R32: linhas + nota = card
    await vaiPara(page, {perfil: 'gc', gc: 'RV'});
    await filtra(page, {aba: 'INCENTIVO'});
    c = await cardsInc(page);
    for(const k of ['INC HEINEKEN', 'CERVEJAS']){
      await page.click(`.ind[data-k="${k}"]`);
      g = await linhasInc(page);
      const n = await notasInc(page);
      assert.deepEqual(g.map(l => l.nome.split(' ·')[0]), ['SV.RV.1', 'SV.RV.2', 'Neutraliza'], k);
      assert.equal(n.length, 1, k);
      assert.match(n[0].texto, /^Inclui rotas virtuais: Meta \d+ · Real \d+$/);
      assert.deepEqual(somaLinhas([...g, ...n]), metaReal(c[k]), k);
      await page.keyboard.press('Escape');
    }
    // o item desce até os clientes que faltam comprar (chips de dia de visita)
    await page.click('.ind[data-k="INC HEINEKEN"]');
    await page.click('#dCorpo .cLin[data-i="0"]');
    await page.click('#dCorpo .cLin[data-i="0"]');
    assert.ok(await page.$('#dLista .chips'), 'clientes que faltam comprar');
    assert.equal(await page.textContent('#dTit'), 'Heineken · Rota RV11');
    await page.keyboard.press('Escape');
    // G2 mista: só a SV.G2.1 e, nela, só a G211 (rotas sem meta fora das listas)
    await vaiPara(page, {perfil: 'gc', gc: 'G2'});
    await page.click('.ind[data-k="INC HEINEKEN"]');
    g = await linhasInc(page);
    assert.deepEqual(g.map(l => [l.nome.split(' ·')[0], l.info]), [['SV.G2.1', '2 rotas · 1 com meta']]);
    await page.click('#dCorpo .cLin[data-i="0"]');
    assert.deepEqual((await linhasInc(page)).map(l => l.nome), ['Rota G211']);
    await page.keyboard.press('Escape');
    // gerência agrupada: Total = IT + MO; com a MO no seletor, só a MO
    await vaiPara(page, {perfil: 'gc', gc: 'IT+MO'});
    const soma = await page.evaluate(() => ['IT', 'MO'].map(gc => agrega(rotasInc('INC HEINEKEN', rotasDe(gc, ''))).ind['INC HEINEKEN'].meta));
    assert.equal(metaReal((await cardsInc(page))['INC HEINEKEN'])[0], soma[0] + soma[1]);
    await page.selectOption('#fgc', 'MO');
    assert.equal(metaReal((await cardsInc(page))['INC HEINEKEN'])[0], soma[1]);
    await page.click('.ind[data-k="INC HEINEKEN"]');
    assert.ok((await linhasInc(page)).every(l => l.nome.startsWith('SV.MO.') || l.nome === 'Neutraliza'));
    await page.keyboard.press('Escape');
    // perfil Rota: abre direto nos clientes
    await vaiPara(page, {perfil: 'rota', gc: 'IT+MO', rota: 'IT11'});
    await page.click('.ind[data-k="INC HEINEKEN"]');
    assert.ok(await page.$('#dLista .chips'));
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('fechamento do mês: cards e cascata iguais aos do ICS; Status só com o Real (mesmo com STATUS_INCLUI_ONLINE)', async () => {
    const {page, ctx, erros} = await abre('incfech', {entrar: {perfil: 'gc', gc: 'IT+MO'}, troca: COM_ONLINE});
    await page.selectOption('#fgc', 'IT');
    assert.match(await page.textContent('#sub'), /Fechamento/);
    await filtra(page, {aba: 'ICS_GC'});
    const ics = await cardsInc(page);
    await filtra(page, {aba: 'INCENTIVO'});
    const c = await cardsInc(page);
    for(const k of ['CERVEJAS', 'CERVEJAS 600ML RETORNAVEL']) assert.equal(c[k].html, ics[k].html, k);
    assert.doesNotMatch(await page.textContent('#lista'), /Meta batida|mês fechado|real \+ hoje/);
    await page.click('.ind[data-k="INC HEINEKEN"]');
    assert.ok((await linhasInc(page)).every(l => /do mês$/.test(l.dirTxt)));
    await page.keyboard.press('Escape');
    // IT11: Heineken Real 1 de 2; o online de hoje (mês novo) não completa o item: 4 / 5, "-"
    await vaiPara(page, {perfil: 'rota', gc: 'IT+MO', rota: 'IT11'});
    assert.deepEqual((await terceiroCard(page)).slice(1, 3), ['4 / 5', 'n no']);
    assert.deepEqual(await statusTopo(page), ['parcial', 'Status -', false]);
    await vaiPara(page, {perfil: 'rota', gc: 'G2', rota: 'G212'});
    assert.deepEqual(await statusTopo(page), ['ok', 'Status ✓', true]);
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('busca de cliente na aba Todos a Bordo: quadrinhos dos 5 itens; item sem meta na rota do cliente sem quadrinho de compra', async () => {
    const {page, ctx, erros} = await abre('inc', {entrar: {perfil: 'gc', gc: 'IT+MO'}});
    await filtra(page, {aba: 'INCENTIVO'});
    const tiles = async pv => { await page.fill('#q', String(pv)); return page.$$eval('#cli .tile', ts => ts.map(t =>
      [t.querySelector('.t').textContent, t.className.replace('tile', '').trim(), t.querySelector('.e').textContent])); };
    const [a, , c] = await page.evaluate(() => CLIENT_ROSTER.IT11.map(x => x[0]));
    assert.deepEqual(await tiles(a), [['Cervejas', 'ok', 'real'], ['Heineken', 'ok', 'real'], ['Eisenbahn - 600ml', 'ok', 'real'],
      ['Heineken - 600ml', 'ok', 'real'], ['Cerv. 600ml Retorn.', 'ok', 'real']]);
    assert.deepEqual((await tiles(c)).map(t => t[1]), ['no', 'no', 'ok', 'no', 'no']);
    await vaiPara(page, {perfil: 'gc', gc: 'AP'});
    const pv = await page.evaluate(() => CLIENT_ROSTER[rotasDe('AP', '')[0]][0][0]);
    const t = await tiles(pv);
    assert.deepEqual(t.filter(x => x[1] === 'na').map(x => [x[0], x[2]]), [['Heineken', 'só Full'], ['Heineken - 600ml', 'só Full']]);
    assert.deepEqual(erros, []);
    await ctx.close();
  });
});

/* ---------- Parte M — visual: Inter local, escala, estouros, alturas, cabeçalho no celular, contraste ---------- */
// cabeçalho (até o fim das abas) em 390 px: era 295 px antes do ajuste visual; meta: pelo menos 25% menor
const CABECALHO_390_ANTES = 295, LIMITE_CABECALHO_390 = Math.floor(CABECALHO_390_ANTES * 0.75);
// funções de medida injetadas na página (window.__vis)
const INSTALA_MEDIDAS = () => {
  if(window.__vis) return;
  const rolavel = el => /auto|scroll/.test(getComputedStyle(el).overflowX);
  // textos que passam da própria caixa (corte ou estouro): scrollWidth > clientWidth, fora das áreas com rolagem própria;
  // reticencias = aceita as células que cortam com reticências por desenho (nomes da gaveta, como antes do ajuste visual)
  const estouros = (raiz, reticencias) => [...(typeof raiz === 'string' ? document.querySelectorAll(raiz) : [raiz])].flatMap(r =>
    [r, ...r.querySelectorAll('*')]).filter(el => el.clientWidth > 0 && el.getClientRects().length && !rolavel(el) && !el.closest('.sr-only')
      && !(reticencias && getComputedStyle(el).textOverflow === 'ellipsis') && el.scrollWidth > el.clientWidth + 1)
    .map(el => `${el.className || el.tagName}: ${el.textContent.trim().slice(0, 40)} (${el.scrollWidth} > ${el.clientWidth})`);
  const rgba = s => { const m = s.match(/[\d.]+/g).map(Number); return [m[0], m[1], m[2], m.length > 3 ? m[3] : 1]; };
  const mistura = (c, fundo) => [0, 1, 2].map(i => c[i] * c[3] + fundo[i] * (1 - c[3]));
  const lum = c => { const v = c.map(x => { x /= 255; return x <= .03928 ? x / 12.92 : Math.pow((x + .055) / 1.055, 2.4); });
    return .2126 * v[0] + .7152 * v[1] + .0722 * v[2]; };
  // contraste do texto contra o fundo efetivo (camadas de fundo compostas de baixo para cima)
  const contraste = el => {
    const camadas = [];
    for(let e = el; e; e = e.parentElement){
      const b = rgba(getComputedStyle(e).backgroundColor);
      if(b[3] > 0) camadas.push(b);
      if(b[3] >= 1) break;
    }
    let fundo = [255, 255, 255];
    for(const c of camadas.reverse()) fundo = mistura(c, fundo);
    const txt = mistura(rgba(getComputedStyle(el).color), fundo);
    const [a, b] = [lum(txt), lum(fundo)].sort((x, y) => y - x);
    return (a + .05) / (b + .05);
  };
  const contrastes = sels => sels.flatMap(s => [...document.querySelectorAll(s)]
    .filter(el => el.getClientRects().length && el.textContent.trim())
    .map(el => [s, el.textContent.trim().slice(0, 30), Math.round(contraste(el) * 100) / 100]));
  window.__vis = {estouros, contrastes};
};
const medidas = page => page.evaluate(INSTALA_MEDIDAS);
const semRolagemLateral = page => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

describe('Parte M — visual', {skip: pular}, () => {
  // os números grandes da tela principal (.ind .big, .obox b, .card .n) são em Source Serif 4 desde a Etapa 2 (Parte T)
  test('Inter local em todo o sistema (sem CDN de fonte), com fallback de sistema', async () => {
    const {page, ctx, erros} = await abre('normal', {entrar: null});
    const pedidos = [];
    page.on('request', r => pedidos.push(r.url()));
    const naEntrada = await page.evaluate(async () => { await document.fonts.ready;
      return getComputedStyle(document.querySelector('#entTit')).fontFamily; });
    assert.match(naEntrada, /^Inter,/);
    await entra(page, 'gc');
    await page.click('#btnResumo');
    const r = await page.evaluate(async () => {
      await document.fonts.ready;
      const fam = s => getComputedStyle(document.querySelector(s)).fontFamily;
      return {body: fam('body'), sels: ['h1', '.card .l', '.ind .tit', '.ind .cl', '.obox span', '#rsFolha h2', '.rs-k strong', 'select', '.tab']
                .map(s => [s, fam(s)]),
              check: document.fonts.check('600 16px Inter') && document.fonts.check('700 30px Inter'),
              carregadas: [...document.fonts].filter(f => f.family.replace(/["']/g, '') === 'Inter' && f.status === 'loaded').length,
              folhas: [...document.querySelectorAll('link[rel=stylesheet]')].map(l => l.getAttribute('href'))};
    });
    assert.equal(r.body, "Inter, system-ui, -apple-system, \"Segoe UI\", Roboto, sans-serif");
    for(const [s, f] of r.sels) assert.match(f, /^Inter,/, s);
    assert.ok(r.check, 'document.fonts.check');
    assert.ok(r.carregadas >= 1, 'a Inter do próprio site carregou');
    assert.deepEqual(r.folhas, ['css/app.css']);
    assert.ok(pedidos.every(u => !/fonts\.(googleapis|gstatic)|fontsource|jsdelivr|unpkg/.test(u)), pedidos.join(' '));
    assert.ok(fs.existsSync(path.join(FRONT, 'assets', 'fonts', 'OFL.txt')), 'licença OFL junto da fonte');
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  for(const largura of [1280, 390]){
    test(`${largura} px: sem rolagem lateral, nenhum texto cortado nos cards, linhas e listas; alturas iguais por tipo`, async () => {
      const {page, ctx, erros} = await abre('inc', {largura, altura: 900, entrar: {perfil: 'gc', gc: 'IT+MO'}});
      await medidas(page);
      await page.evaluate(() => document.fonts.ready);
      for(const aba of ['VOLUME', 'ICS_GC', 'NOVOS_NEG', 'INCENTIVO']){
        await filtra(page, {aba});
        assert.ok(await semRolagemLateral(page), `${aba}: rolagem lateral`);
        assert.deepEqual(await page.evaluate(() => __vis.estouros('.cards .card, #lista .ind, #puxa, .rsBox, .topo, .barra')), [], aba);
        const alt = await page.evaluate(() => {
          const px = v => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(v));
          const cards = [...document.querySelectorAll('#lista .ind')].map(el => ({top: Math.round(el.getBoundingClientRect().top),
            h: el.getBoundingClientRect().height, tipo: el.classList.contains('off') ? 'off' : el.classList.contains('vol') ? 'vol' : 'cob'}));
          return {cards, minVol: px('--h-card-vol'), minCob: px('--h-card-cob'), minKpi: px('--h-kpi'),
                  kpi: [...document.querySelectorAll('.cards .card')].map(el => el.getBoundingClientRect().height)};
        });
        // mesmo tipo na mesma linha da grade = mesma altura; nenhum card com conteúdo abaixo do mínimo do tipo
        const porLinha = {};
        for(const c of alt.cards) (porLinha[`${c.top}|${c.tipo}`] = porLinha[`${c.top}|${c.tipo}`] || []).push(c.h);
        for(const [k, hs] of Object.entries(porLinha)) assert.ok(Math.max(...hs) - Math.min(...hs) <= 1, `${aba} ${k}: ${hs}`);
        for(const c of alt.cards) if(c.tipo !== 'off') assert.ok(c.h >= (c.tipo === 'vol' ? alt.minVol : alt.minCob) - .5, `${aba} ${c.tipo} ${c.h}`);
        assert.ok(Math.max(...alt.kpi) - Math.min(...alt.kpi) <= 1 && Math.min(...alt.kpi) >= alt.minKpi - .5, `${aba} KPIs ${alt.kpi}`);
        // cascata do 1º card até os clientes: linhas e listas sem texto cortado (a aparência é a de antes do ajuste
        // visual, conferida na Parte N)
        const k = await page.$eval('#lista .ind[data-k]', el => el.dataset.k);
        await page.click(`#lista .ind[data-k="${k}"]`);
        for(let nivel = 0; nivel < 4; nivel++){
          await page.waitForTimeout(50);
          const m = await page.evaluate(() => ({est: __vis.estouros('#drw', true),
            rola: document.getElementById('dCorpo').scrollWidth <= document.getElementById('dCorpo').clientWidth}));
          assert.deepEqual(m.est, [], `${aba} cascata nível ${nivel}`);
          assert.ok(m.rola, `${aba} cascata nível ${nivel}: rolagem lateral`);
          if(!(await page.$('#dCorpo .cLin[data-i]'))) break;
          await page.click('#dCorpo .cLin[data-i]');
        }
        await page.keyboard.press('Escape');
      }
      // busca de cliente (quadrinhos)
      await filtra(page, {aba: 'VOLUME'});
      const pv = await page.evaluate(() => CLIENT_ROSTER[rotasDe(sel.gc, '').find(r => (CLIENT_ROSTER[r] || []).length)][0][0]);
      await page.fill('#q', String(pv));
      assert.deepEqual(await page.evaluate(() => __vis.estouros('#cli')), []);
      assert.ok(await semRolagemLateral(page));
      assert.deepEqual(erros, []);
      await ctx.close();
    });
  }

  // Etapa 3: o topo compacto (abaixo de 1000 px) troca a caixa de ritmo de duas linhas pela linha "Dia útil x/n (p%) ·
  // ritmo hoje h%" e tira a linha da marca (a caixa inteira fica no painel lateral do PC); o limite de altura é o mesmo
  test('390 px: cabeçalho compacto (até o fim das abas) pelo menos 25% menor, com o ritmo numa linha, e a barra sticky', async () => {
    const {page, ctx, erros} = await abre('normal', {largura: 390, altura: 844});
    await page.evaluate(() => document.fonts.ready);
    const r = await page.evaluate(() => {
      const b = s => document.querySelector(s).getBoundingClientRect();
      const tabs = [...document.querySelectorAll('.tab')].filter(t => !t.hidden).map(t => t.getBoundingClientRect());
      const sels = [...document.querySelectorAll('.filtros select')].filter(s => !s.hidden).map(s => Math.round(s.getBoundingClientRect().top));
      const rit = document.getElementById('ritmo');
      return {fim: b('.barra').bottom, h1: parseFloat(getComputedStyle(document.querySelector('.topo h1')).fontSize),
              ritmo: rit.innerText.trim(), marca: document.querySelector('.topo .marca').getClientRects().length, linhasRitmo: Math.round(rit.getBoundingClientRect().height / parseFloat(getComputedStyle(rit).lineHeight)),
              tabsTop: new Set(tabs.map(t => Math.round(t.top))).size, nTabs: tabs.length, sels: new Set(sels).size,
              sub: document.getElementById('sub').textContent, pos: getComputedStyle(document.querySelector('.barra')).position};
    });
    assert.ok(r.fim <= LIMITE_CABECALHO_390, `cabeçalho ${r.fim} px > ${LIMITE_CABECALHO_390}`);
    assert.ok(r.h1 >= 23 && r.h1 <= 26, `título ${r.h1}`);
    assert.match(r.ritmo, /^Dia útil \d+\/\d+ \(\d+%\) · ritmo hoje \d+%$/);
    assert.equal(r.linhasRitmo, 1, `ritmo em ${r.linhasRitmo} linhas`);
    assert.equal(r.marca, 0, 'sem a linha da marca');
    assert.equal(r.tabsTop, 1, 'abas numa linha');
    assert.ok(r.nTabs >= 3);
    assert.equal(r.sels, 1, 'seletores na mesma linha');
    assert.match(r.sub, /Atualização|atualização|Atualizado|·/);
    assert.equal(r.pos, 'sticky');
    await page.mouse.wheel(0, 900);
    await page.waitForFunction(() => scrollY > 300);
    assert.ok(Math.abs(await page.evaluate(() => document.querySelector('.barra').getBoundingClientRect().top)) <= 1, 'barra presa no topo');
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('vermelho só no % abaixo, na Diferença negativa e no "faltam"; Meta, Real e textos de apoio neutros', async () => {
    const {page, ctx, erros} = await abre('normal');
    const gc = await page.evaluate(() => sel.gc);
    const rotas = await page.evaluate(() => rotasDe(sel.gc, ''));
    await ritmo(page, gc, rotas, 0.2);
    for(const aba of ['VOLUME', 'ICS_GC']){
      await filtra(page, {aba});
      const r = await page.evaluate(() => {
        const cor = el => getComputedStyle(el).color;
        const ref = v => { const s = document.createElement('span'); s.style.color = `var(${v})`; document.body.appendChild(s);
          const c = getComputedStyle(s).color; s.remove(); return c; };
        const vermelhos = ['--vermelho', '--vermelho2', '--ruim'].map(ref);
        const card = [...document.querySelectorAll('#lista .ind[data-k]:not(.ok)')].find(el => !el.querySelector('.obox.ok')) ||
          document.querySelector('#lista .ind[data-k]:not(.ok)');
        const q = s => card.querySelector(s);
        return {vermelhos, meta: cor(q('.cl > div:nth-child(1)')), real: cor(q('.cl > div:nth-child(2)')), dif: cor(q('.cl .dif')),
                difNeg: q('.cl .dif').classList.contains('neg'), big: cor(q('.big')), acao: [q('.acao').textContent, cor(q('.acao'))],
                opo: cor(q('.opo')), olab: cor(q('.olab')), txt: ref('--txt'), apoio: ref('--txt-apoio')};
      });
      const ehVermelho = c => r.vermelhos.includes(c);
      assert.ok(!ehVermelho(r.meta) && !ehVermelho(r.real), `${aba}: Meta/Real ${r.meta} ${r.real}`);
      assert.equal(r.meta, r.txt);
      assert.ok(r.difNeg && ehVermelho(r.dif), `${aba}: Diferença negativa em vermelho`);
      assert.ok(ehVermelho(r.big), `${aba}: % abaixo em vermelho`);
      if(/^faltam/.test(r.acao[0])) assert.ok(ehVermelho(r.acao[1]), `${aba}: faltam`);
      else assert.equal(r.acao[1], r.apoio, `${aba}: "${r.acao[0]}" neutro`);
      assert.ok(!ehVermelho(r.opo) && !ehVermelho(r.olab), `${aba}: textos de apoio`);
    }
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  // a gaveta (cascata e listas de clientes) fica fora: mantém os cinzas de antes do ajuste visual (Parte N)
  test('contraste AA (4.5:1) dos textos neutros: painel, Resumo e entrada nos dois fundos', async () => {
    const {page, ctx, erros} = await abre('normal', {entrar: null, largura: 390, altura: 844});
    await medidas(page);
    const baixos = async (sels, onde) => {
      const r = await page.evaluate(s => __vis.contrastes(s), sels);
      assert.ok(r.length > 0, `${onde}: nada medido`);
      const ruins = r.filter(x => x[2] < 4.5);
      assert.deepEqual(ruins, [], onde);
    };
    for(const tema of ['preta', 'branca']){
      if(tema === 'branca') await page.click('#btnTema');
      await baixos(['.entMarca', '.entRod'], `entrada ${tema}`);
      await page.click('#entrada [data-perfil="sv"]');
      await baixos(['.entSub', '.entCab h2', '.entOpcoes button:not(:disabled)'], `caixa ${tema}`);
      await page.click('#entFechar');
    }
    await entra(page, 'gc');
    await medidas(page);
    const gc = await page.evaluate(() => sel.gc);
    await ritmo(page, gc, await page.evaluate(() => rotasDe(sel.gc, '')), 0.2);
    for(const aba of ['VOLUME', 'ICS_GC']){
      await filtra(page, {aba});
      await baixos(['.ind .cl > div:not(.dif)', '.ind .acao:not(.falta)', '.ind .opo', '.ind .olab', '.ind.off .semdado', '.card .l',
        '.card .x', '.puxa .s', '.sub', '.ritmo', '.rodape', '.rodape .fonte', '.creditos', '.rsBox .rsLbl'], `painel ${aba}`);
    }
    await page.click('#btnResumo');
    await baixos(['.rs-sub', '.rs-bloco h3 small', '.rs-k:not(.rs-on) small'], 'Resumo');
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  for(const largura of [1280, 390]){
    test(`${largura} px: entrada, caixas, Resumo e PDF sem estouro (PDF espera a fonte)`, async () => {
      const {page, ctx, erros} = await abre('normal', {entrar: null, largura, altura: 900});
      await medidas(page);
      await page.evaluate(() => document.fonts.ready);
      for(const tema of ['preta', 'branca']){
        if(tema === 'branca') await page.click('#btnTema');
        assert.deepEqual(await page.evaluate(() => __vis.estouros('#entrada')), [], `entrada ${tema}`);
        for(const perfil of ['gc', 'sv']){
          await page.click(`#entrada [data-perfil="${perfil}"]`);
          if(perfil === 'sv') await page.click('#entOpcoes [data-gc="IT+MO"]');
          assert.deepEqual(await page.evaluate(() => __vis.estouros('#entCaixa')), [], `caixa ${perfil} ${tema}`);
          assert.ok(await semRolagemLateral(page));
          await page.click('#entFechar');
        }
      }
      for(const entrar of ['dir', 'gc', {perfil: 'gc', gc: 'IT+MO'}]){
        await entra(page, entrar);
        await medidas(page);
        await page.click('#btnResumo');
        await page.waitForSelector('#rsFolha h2');
        const r = await page.evaluate(() => ({est: __vis.estouros('#rsFolha'),
          larg: [document.getElementById('rsOverlay').scrollWidth, document.getElementById('rsOverlay').clientWidth]}));
        assert.deepEqual(r.est, [], `Resumo ${JSON.stringify(entrar)}`);
        assert.ok(r.larg[0] <= r.larg[1], `Resumo: rolagem lateral ${r.larg}`);
        // PDF: bibliotecas simuladas; a captura acontece com a fonte carregada, no formato do PC e sem estouro
        await page.evaluate(() => {
          window.__pdf = null;
          window.html2canvas = async (el, op) => {
            window.__pdf = {fonte: document.fonts.status, pdf: el.classList.contains('rs-pdf'), est: __vis.estouros(el),
                            larg: [el.scrollWidth, el.clientWidth]};
            if(op.onclone) op.onclone(document);
            const c = document.createElement('canvas'); c.width = el.scrollWidth * 2; c.height = el.scrollHeight * 2; return c;
          };
          window.jspdf = {jsPDF: function(){ return {addPage(){}, addImage(){}, setProperties(){}, output: () => new Blob(['%PDF'])}; }};
        });
        await page.click('#rsImg');
        await page.waitForFunction(() => /PDF salvo/.test(document.getElementById('rsToast').textContent));
        const pdf = await page.evaluate(() => window.__pdf);
        assert.equal(pdf.fonte, 'loaded');
        assert.ok(pdf.pdf);
        assert.deepEqual(pdf.est, [], `PDF ${JSON.stringify(entrar)}`);
        assert.ok(pdf.larg[0] <= pdf.larg[1] + 1, `PDF largura ${pdf.larg}`);
        await page.click('#rsVoltar');
        await page.click('#btnCasa');
      }
      assert.deepEqual(erros, []);
      await ctx.close();
    });
  }
});

/* ---------- Parte T — fonte dos números e cards (Etapa 2): Source Serif 4 local só nos números grandes da tela
   principal; cards com o fundo de antes, faixa lateral na cor do status, escala própria (~12% menor) e grade de 3
   colunas no PC ---------- */
// CSS da main antes da Etapa 2 (21/10/2026), para comparar o fundo dos cards; sem o histórico, o teste é pulado
const REF_ETAPA2 = '2744537';
const CSS_ANTES_ETAPA2 = (() => {
  try { return execSync(`git show ${REF_ETAPA2}:frontend/css/app.css`, {cwd: RAIZ, stdio: ['ignore', 'pipe', 'ignore']}).toString(); }
  catch(e){ return null; }
})();
const SERIF = /^"Source Serif 4", Georgia, "Times New Roman", serif$/;
// estilo dos elementos de cada card (família, tamanho e algarismos) e da própria caixa
const ESTILO_CARDS = () => [...document.querySelectorAll('#lista .ind')].map(el => {
  const cs = e => e ? getComputedStyle(e) : null, c = cs(el);
  const q = s => { const e = el.querySelector(s); if(!e) return null; const x = cs(e);
    return {fam: x.fontFamily, px: parseFloat(x.fontSize), num: x.fontVariantNumeric}; };
  return {k: el.dataset.k || '', off: el.classList.contains('off'), ok: el.classList.contains('ok'), bg: c.backgroundColor,
          faixa: [c.borderLeftWidth, c.borderLeftStyle, c.borderLeftColor], padL: parseFloat(c.paddingLeft),
          tit: q('.tit'), cl: q('.cl > div'), big: q('.big'), seta: q('.big .seta'), acao: q('.acao'), opo: q('.opo'),
          olab: q('.olab'), on: q('.obox b'), onRot: q('.obox span')};
});
// fundos de antes da Etapa 2 (rosa abaixo, verde claro no ritmo, cinza indisponível) e as cores da faixa
const COR = {rosa: 'rgb(251, 238, 238)', menta: 'rgb(233, 244, 239)', off: 'rgb(240, 240, 242)', ruim: 'rgb(156, 28, 28)',
             verde: 'rgb(29, 158, 117)'};

describe('Parte T — fonte dos números e cards (Etapa 2)', {skip: pular}, () => {
  test('Source Serif 4 local (sem CDN), com a licença, e só nos números grandes da tela principal', async () => {
    const pedidos = [];
    const {page, ctx, erros} = await abre('normal', {antes: async p => p.on('request', r => pedidos.push(r.url()))});
    for(const aba of ['VOLUME', 'ICS_GC', 'NOVOS_NEG']){
      await filtra(page, {aba});
      const r = await page.evaluate(async () => {
        await document.fonts.ready;
        const fam = s => [...document.querySelectorAll(s)].map(e => getComputedStyle(e).fontFamily);
        const num = s => [...document.querySelectorAll(s)].map(e => getComputedStyle(e).fontVariantNumeric);
        return {check: document.fonts.check('700 25px "Source Serif 4"'),
                carregada: [...document.fonts].some(f => f.family.replace(/["']/g, '') === 'Source Serif 4' && f.status === 'loaded'),
                serif: ['.ind .big', '.obox b', '.card .n'].map(s => [s, fam(s)]),
                inter: ['body', 'h1', '.sub', '.ritmo', 'select', '.tab', '.card .l', '.card .x', '.card .x b', '.ind .tit', '.ind .cl > div',
                        '.ind .big .seta', '.ind .acao', '.ind .opo', '.ind .olab', '.obox span', '.puxa .t', '#q', '.rodape']
                  .map(s => [s, fam(s)]),
                num: ['.ind .big', '.obox b', '.card .n', '.ind .cl > div', '.card .x b', '.ind .acao'].map(s => [s, num(s)])};
      });
      assert.ok(r.check && r.carregada, `${aba}: Source Serif 4 carregada`);
      for(const [s, fams] of r.serif){
        assert.ok(fams.length > 0, `${aba}: nenhum ${s}`);
        for(const f of fams) assert.match(f, SERIF, `${aba} ${s}`);
      }
      for(const [s, fams] of r.inter) for(const f of fams) assert.match(f, /^Inter,/, `${aba} ${s}`);
      for(const [s, ns] of r.num) for(const n of ns) assert.match(n, /lining-nums tabular-nums/, `${aba} ${s}: ${n}`);
    }
    const serif = pedidos.filter(u => /source-serif/i.test(u));
    assert.deepEqual(serif.map(u => new URL(u).pathname), ['/assets/fonts/source-serif-4-latin-wght-normal.woff2']);
    assert.ok(pedidos.every(u => new URL(u).host === 'painel.test' || /cdnjs\.cloudflare\.com/.test(u)), 'nenhuma fonte de fora');
    for(const f of ['source-serif-4-latin-wght-normal.woff2', 'OFL-source-serif-4.txt'])
      assert.ok(fs.existsSync(path.join(FRONT, 'assets', 'fonts', f)), f);
    const css = fs.readFileSync(path.join(FRONT, 'css', 'app.css'), 'utf-8');
    const face = css.match(/@font-face\{font-family:'Source Serif 4';[^}]*\}/);
    assert.ok(face, '@font-face da Source Serif 4');
    assert.match(face[0], /font-display:swap/);
    assert.match(face[0], /font-weight:200 900/);
    const range = t => t.match(/unicode-range:([^;}]*)/)[1].replace(/\s+/g, '');
    assert.equal(range(face[0]), range(css.match(/@font-face\{font-family:'Inter';[^}]*\}/)[0]), 'mesmo unicode-range latin da Inter');
    // toda fonte do CSS vem de assets/fonts (nada de CDN nem Google Fonts)
    const urls = (css.match(/@font-face\{[^}]*\}/g) || []).flatMap(f => f.match(/url\([^)]*\)/g));
    assert.ok(urls.length >= 6 && urls.every(u => /^url\(\.\.\/assets\/fonts\/[\w-]+\.woff2\)$/.test(u)), urls.join(' '));
    assert.ok(!/fonts\.(googleapis|gstatic)/.test(css + fs.readFileSync(path.join(FRONT, 'index.html'), 'utf-8')));
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('entrada, gaveta, Resumo, PDF do Resumo e Painel de Ritmo continuam em Inter', async () => {
    const {page, ctx, erros} = await abre('normal', {entrar: null});
    const todasInter = sel => page.evaluate(s => [...new Set([...document.querySelectorAll(s)]
      .map(e => getComputedStyle(e).fontFamily))].filter(f => !/^Inter,/.test(f)), sel);
    assert.deepEqual(await todasInter('#entrada, #entrada *'), [], 'entrada');
    await entra(page, 'gc');
    // gaveta: todos os níveis da cascata do 1º card de volume e as listas Base e Sem compra
    await filtra(page, {aba: 'VOLUME'});
    await page.click('#lista .ind[data-k]');
    for(let nivel = 0; nivel < 4; nivel++){
      await page.waitForTimeout(40);
      assert.deepEqual(await todasInter('#drw, #drw *'), [], `gaveta nível ${nivel}`);
      if(!(await page.$('#dCorpo .cLin[data-i]'))) break;
      await page.click('#dCorpo .cLin[data-i]');
    }
    await page.keyboard.press('Escape');
    for(const id of ['cBase', 'cSem']){
      await page.click('#' + id);
      await page.waitForTimeout(40);
      assert.deepEqual(await todasInter('#drw, #drw *'), [], id);
      await page.keyboard.press('Escape');
    }
    // Resumo e o PDF dele (bibliotecas simuladas: a fonte de cada elemento capturado)
    await page.click('#btnResumo');
    await page.waitForSelector('#rsFolha h2');
    assert.deepEqual(await todasInter('#rsFolha, #rsFolha *'), [], 'Resumo');
    await page.evaluate(() => {
      window.__fam = null;
      window.html2canvas = async (el, op) => {
        window.__fam = [...new Set([el, ...el.querySelectorAll('*')].map(e => getComputedStyle(e).fontFamily))];
        if(op.onclone) op.onclone(document);
        const c = document.createElement('canvas'); c.width = 10; c.height = 10; return c;
      };
      window.jspdf = {jsPDF: function(){ return {addPage(){}, addImage(){}, setProperties(){}, output: () => new Blob(['%PDF'])}; }};
    });
    await page.click('#rsImg');
    await page.waitForFunction(() => /PDF salvo/.test(document.getElementById('rsToast').textContent));
    assert.deepEqual((await page.evaluate(() => window.__fam)).filter(f => !/^Inter,/.test(f)), [], 'PDF do Resumo');
    await page.click('#rsVoltar');
    // Painel de Ritmo: a página desenhada fora da tela
    await page.evaluate(() => {
      window.__fam = [];
      window.html2canvas = async el => {
        window.__fam.push(...[el, ...el.querySelectorAll('*')].map(e => getComputedStyle(e).fontFamily));
        const c = document.createElement('canvas'); c.width = 12; c.height = 7; return c;
      };
    });
    await page.click('#btnRitmo');
    await page.waitForFunction(() => !document.getElementById('btnRitmo').hasAttribute('aria-busy') &&
      document.getElementById('rtAviso').textContent !== '');
    const famRt = await page.evaluate(() => window.__fam);
    assert.ok(famRt.length > 0, 'Painel de Ritmo capturado');
    assert.deepEqual([...new Set(famRt)].filter(f => !/^Inter,/.test(f)), [], 'Painel de Ritmo');
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  for(const largura of [1440, 390]){
    test(`${largura} px: fundo dos cards como antes, faixa lateral na cor do status, escala dos cards`, async () => {
      const {page, ctx, erros} = await abre('normal', {largura, altura: 900});
      const gc = await page.evaluate(() => sel.gc);
      const rotas = await page.evaluate(() => rotasDe(sel.gc, ''));
      const vistos = new Set();
      for(const fator of [0.2, 1.5]){
        await ritmo(page, gc, rotas, fator);
        for(const aba of ['VOLUME', 'ICS_GC', 'NOVOS_NEG']){
          await filtra(page, {aba});
          for(const c of await page.evaluate(ESTILO_CARDS)){
            const onde = `${aba} ${c.k} x${fator}`;
            if(c.off){
              vistos.add('off');
              assert.equal(c.bg, COR.off, onde);
              assert.equal(c.faixa[0], '0px', `${onde}: card indisponível sem faixa`);
              assert.equal(c.padL, largura >= 640 ? 15 : 12, onde);
              continue;
            }
            vistos.add(c.ok ? 'ok' : 'no');
            assert.equal(c.bg, c.ok ? COR.menta : COR.rosa, `${onde}: fundo`);
            assert.deepEqual(c.faixa, ['5px', 'solid', c.ok ? COR.verde : COR.ruim], `${onde}: faixa`);
            // o padding esquerdo desconta a faixa: o conteúdo começa onde começava
            assert.equal(c.padL + 5, largura >= 640 ? 15 : 12, `${onde}: padding esquerdo`);
            // escala dos cards (referência: título 15, Meta/Real/Diferença 11,5, % até 25, "no ritmo/faltam" 12,5,
            // oportunidades 11, Online até 19 e rótulos do Online 9,5)
            assert.equal(c.tit.px, 15, onde);
            assert.equal(c.cl.px, 11.5, onde);
            assert.ok(c.big.px <= 25 && c.big.px >= 18, `${onde}: % ${c.big.px}`);
            assert.equal(c.acao.px, 12.5, onde);
            if(c.opo) assert.equal(c.opo.px, 11, onde);
            assert.equal(c.olab.px, 9.5, onde);
            assert.ok(c.on.px <= 19 && c.on.px >= 10, `${onde}: Online ${c.on.px}`);
            assert.equal(c.onRot.px, 9.5, onde);
          }
        }
      }
      assert.ok(vistos.has('ok') && vistos.has('no'), [...vistos].join());
      // grade: 3 colunas em 1440 px; no celular, uma
      const colunas = await page.evaluate(() => getComputedStyle(document.getElementById('lista')).display === 'grid'
        ? getComputedStyle(document.getElementById('lista')).gridTemplateColumns.split(' ').length : 1);
      assert.equal(colunas, largura === 1440 ? 3 : 1);
      assert.deepEqual(erros, []);
      await ctx.close();
    });
  }

  test('fundo dos cards igual ao do front de antes da Etapa 2 (mesmo cenário, CSS da main de 21/10)', {skip: !CSS_ANTES_ETAPA2 && `sem o commit ${REF_ETAPA2}`}, async () => {
    const [novo, velho] = [await abre('normal'), await abre('normal', {troca: {'/css/app.css': () => CSS_ANTES_ETAPA2}})];
    for(const aba of ['VOLUME', 'ICS_GC', 'NOVOS_NEG']){
      for(const {page} of [novo, velho]) await filtra(page, {aba});
      const [a, b] = await Promise.all([novo.page.evaluate(ESTILO_CARDS), velho.page.evaluate(ESTILO_CARDS)]);
      assert.deepEqual(a.map(c => [c.k, c.off, c.ok, c.bg]), b.map(c => [c.k, c.off, c.ok, c.bg]), aba);
      const txt = p => p.$$eval('#lista .ind, .cards .card', els => els.map(e => e.innerText.replace(/\s+/g, ' ').trim()));
      assert.deepEqual(await txt(novo.page), await txt(velho.page), `${aba}: textos dos cards`);
    }
    assert.deepEqual(novo.erros, []);
    await novo.ctx.close(); await velho.ctx.close();
  });

  test('1440 px: Diretoria e grupo em 3 colunas, sem rolagem lateral', async () => {
    for(const [dados, entrar] of [['normal', 'dir'], ['grupo', {perfil: 'gc', gc: 'IT+MO'}]]){
      const {page, ctx, erros} = await abre(dados, {largura: 1440, altura: 900, entrar});
      await medidas(page);
      for(const aba of ['VOLUME', 'ICS_GC', 'NOVOS_NEG']){
        await filtra(page, {aba});
        const r = await page.evaluate(() => ({col: getComputedStyle(document.getElementById('lista')).gridTemplateColumns.split(' ').length,
          tops: new Set([...document.querySelectorAll('#lista .ind')].slice(0, 3).map(e => Math.round(e.getBoundingClientRect().top))).size,
          est: __vis.estouros('.cards .card, #lista .ind')}));
        assert.equal(r.col, 3, `${aba}: colunas`);
        assert.equal(r.tops, 1, `${aba}: os 3 primeiros cards na mesma linha`);
        assert.deepEqual(r.est, [], aba);
        assert.ok(await semRolagemLateral(page), aba);
      }
      assert.deepEqual(erros, []);
      await ctx.close();
    }
  });

  for(const largura of [360, 390]){
    test(`${largura} px: nenhum texto cortado nos cards e nos cards do topo, nos 4 painéis e com números grandes`, async () => {
      for(const [dados, entrar] of [['inc', {perfil: 'gc', gc: 'IT+MO'}], ['grande', 'dir'], ['normal', {perfil: 'sv', gc: 'G2', sv: '1'}]]){
        const {page, ctx, erros} = await abre(dados, {largura, altura: 900, entrar});
        await medidas(page);
        await page.evaluate(() => document.fonts.ready);
        for(const aba of ['VOLUME', 'ICS_GC', 'NOVOS_NEG', 'INCENTIVO']){
          if(!(await page.$(`.tab[data-g="${aba}"]:not([hidden])`))) continue;
          await filtra(page, {aba});
          assert.deepEqual(await page.evaluate(() => __vis.estouros('.cards .card, #lista .ind, #puxa')), [], `${dados} ${aba}`);
          assert.ok(await semRolagemLateral(page), `${dados} ${aba}: rolagem lateral`);
        }
        assert.deepEqual(erros, []);
        await ctx.close();
      }
    });
  }
});

/* ---------- Parte N — cascata (gaveta) com a aparência de antes do ajuste visual, só com a Inter ----------
   Abre o mesmo cenário no front atual e no do commit REF_CASCATA (CSS e app.js de antes do ajuste visual, servidos por
   `troca`) e compara, elemento a elemento dentro da gaveta, o estilo computado. A única diferença aceita é a família
   (Inter no atual). Sem o histórico do git (clone raso), os testes são pulados. */
const REF_CASCATA = '0a59eb4';
const FRONT_ANTIGO = (() => {
  try {
    const css = execSync(`git show ${REF_CASCATA}:frontend/css/app.css`, {cwd: RAIZ, stdio: ['ignore', 'pipe', 'ignore']}).toString();
    const js = execSync(`git show ${REF_CASCATA}:frontend/js/app.js`, {cwd: RAIZ, stdio: ['ignore', 'pipe', 'ignore']}).toString();
    return {'/css/app.css': () => css, '/js/app.js': () => js};
  } catch(e) { return null; }
})();
const PROPS_CASCATA = ['display', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'grid-template-columns', 'column-gap',
  'row-gap', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'margin-top', 'margin-right', 'margin-bottom',
  'margin-left', 'border-top', 'border-right', 'border-bottom', 'border-left', 'border-radius', 'color', 'background-color',
  'min-height', 'min-width', 'white-space', 'overflow-x', 'text-overflow', 'opacity', 'text-transform', 'text-decoration-line',
  'text-align', 'font-variant-numeric'];
// estilo de cada elemento da gaveta, na ordem do DOM: [caminho, {prop: valor}, família, cortado?]
const ASSINA_GAVETA = props => [...document.querySelectorAll('#drw, #drw *')].map(el => {
  const cs = getComputedStyle(el), nome = el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ?
    '.' + el.className.trim().split(/\s+/).join('.') : '');
  const v = {};
  for(const p of props) v[p] = cs.getPropertyValue(p);
  // cortado: passa da própria caixa, fora das áreas com rolagem própria (os chips de dia rolam de lado)
  return [nome, v, cs.fontFamily, el.clientWidth > 0 && el.getClientRects().length > 0 && !/auto|scroll/.test(cs.overflowX)
          && el.scrollWidth > el.clientWidth + 1,
          el.textContent.trim().slice(0, 30)];
});
// colunas da linha de grupo que se sobrepõem (texto invadindo a vizinha)
const INVASOES = () => [...document.querySelectorAll('#dCorpo .cLin')].flatMap(l => {
  const f = [...l.children].map(c => c.getBoundingClientRect()).filter(r => r.width);
  const out = [];
  for(let i = 0; i < f.length; i++) for(let j = i + 1; j < f.length; j++){
    const [a, b] = [f[i], f[j]];
    if(a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) out.push(l.textContent.trim().slice(0, 40));
  }
  return out;
});
// mesmo px com tolerância de arredondamento (grid-template-columns e demais medidas)
const mesmoValor = (a, b) => a === b || (() => {
  const na = a.match(/-?[\d.]+/g), nb = b.match(/-?[\d.]+/g);
  return !!na && !!nb && na.length === nb.length && a.replace(/-?[\d.]+/g, '#') === b.replace(/-?[\d.]+/g, '#') &&
    na.every((x, i) => Math.abs(Number(x) - Number(nb[i])) <= 0.5);
})();
const CENARIOS_CASCATA = [
  {nome: 'Gerência', dados: 'normal', entrar: 'gc', abas: {VOLUME: 2, ICS_GC: 9, NOVOS_NEG: 1}, topo: true},
  {nome: 'Diretoria', dados: 'normal', entrar: 'dir', abas: {VOLUME: 1, ICS_GC: 1}},
  {nome: 'grupo IT+MO', dados: 'grupo', entrar: {perfil: 'gc', gc: 'IT+MO'}, abas: {VOLUME: 1, ICS_GC: 1}},
  {nome: 'Supervisão', dados: 'normal', entrar: {perfil: 'sv', gc: 'G2', sv: '1'}, abas: {VOLUME: 1, ICS_GC: 1}},
  {nome: 'fechamento', dados: 'fech', entrar: 'gc', abas: {VOLUME: 1, ICS_GC: 1}},
  {nome: 'Todos a Bordo', dados: 'inc', entrar: {perfil: 'gc', gc: 'IT+MO'}, abas: {INCENTIVO: 5}},
];

describe('Parte N — cascata como antes do ajuste visual, só com a Inter', {skip: pular || (!FRONT_ANTIGO && `sem o commit ${REF_CASCATA}`)}, () => {
  for(const largura of [1280, 390]){
    test(`${largura} px: todos os níveis da cascata com o estilo do ${REF_CASCATA} (só a família muda), sem texto cortado nem invadindo`, async () => {
      const vistos = new Set(), cortes = new Set();
      for(const c of CENARIOS_CASCATA){
        for(const tema of ['preta', 'branca']){
          if(tema === 'branca' && c.nome !== 'Gerência') continue;     // o fundo da entrada não muda a gaveta: um cenário basta
          const armazenado = {drotas_entrada: tema};
          const [novo, velho] = [await abre(c.dados, {largura, altura: 900, entrar: c.entrar, armazenado}),
                                 await abre(c.dados, {largura, altura: 900, entrar: c.entrar, armazenado, troca: FRONT_ANTIGO})];
          for(const {page} of [novo, velho]){
            // mesma largura útil nas duas versões (a barra de rolagem da gaveta não depende da altura do texto) e sem animação
            await page.addStyleTag({content: '#dCorpo{overflow-y:scroll!important} *{transition:none!important}'});
            await page.evaluate(() => document.fonts.ready);
          }
          // Etapa 3: no PC a gaveta começa à direita do painel lateral (left: var(--lado)). Só a POSIÇÃO muda: o front
          // antigo recebe o mesmo `left` e todo o resto (margens, larguras, colunas, fontes, cores) é comparado igual
          const esq = await novo.page.evaluate(() => ({drw: getComputedStyle(document.getElementById('drw')).left,
            lado: document.querySelector('.lado').getBoundingClientRect().right}));
          if(largura >= 1000) assert.equal(parseFloat(esq.drw), esq.lado, 'a gaveta começa à direita do painel lateral');
          else assert.equal(esq.drw, '0px');
          await velho.page.addStyleTag({content: `#drw{left:${esq.drw}!important}`});
          const confere = async onde => {
            const [a, b] = await Promise.all([novo.page.evaluate(ASSINA_GAVETA, PROPS_CASCATA), velho.page.evaluate(ASSINA_GAVETA, PROPS_CASCATA)]);
            assert.deepEqual(a.map(x => x[0]), b.map(x => x[0]), `${onde}: mesma marcação`);
            a.forEach(([nome, v, fam, cortado, txt], i) => {
              vistos.add(nome);
              assert.match(fam, /^Inter,/, `${onde} ${nome}: família`);
              for(const p of PROPS_CASCATA)
                assert.ok(mesmoValor(v[p], b[i][1][p]), `${onde} ${nome} "${txt}": ${p} = ${v[p]}, antes ${b[i][1][p]}`);
              if(cortado){
                // só as células que já cortavam com reticências antes (nome numa coluna estreita), e cortadas também lá
                assert.equal(v['text-overflow'], 'ellipsis', `${onde} ${nome} "${txt}": texto cortado`);
                assert.ok(b[i][3], `${onde} ${nome} "${txt}": corta com a Inter e não cortava antes`);
                cortes.add(`${nome} "${txt}"`);
              }
            });
            assert.deepEqual(await novo.page.evaluate(INVASOES), [], `${onde}: coluna invadindo a vizinha`);
          };
          // percorre: card -> nível de cima -> ... -> clientes (e o chip "Todos" nas listas de cobertura)
          const desce = async (abrir, onde) => {
            for(const {page} of [novo, velho]) await abrir(page);
            for(let nivel = 0; nivel < 5; nivel++){
              for(const {page} of [novo, velho]) await page.waitForTimeout(30);
              await confere(`${onde} nível ${nivel}`);
              const prox = await novo.page.$('#dCorpo .cLin[data-i]');
              if(!prox) break;
              for(const {page} of [novo, velho]) await page.click('#dCorpo .cLin[data-i]');
            }
            if(await novo.page.$('#dCorpo .dchip[data-d="Todos"]')){
              for(const {page} of [novo, velho]) await page.click('#dCorpo .dchip[data-d="Todos"]');
              await confere(`${onde} chip Todos`);
            }
            if(await novo.page.$('#cVolta')){
              for(const {page} of [novo, velho]) await page.click('#cVolta');
              await confere(`${onde} voltar`);
            }
            for(const {page} of [novo, velho]) await page.keyboard.press('Escape');
          };
          for(const [aba, n] of Object.entries(c.abas)){
            for(const {page} of [novo, velho]) await filtra(page, {aba});
            const ks = (await novo.page.$$eval('#lista .ind[data-k]', els => els.map(e => e.dataset.k))).slice(0, n);
            for(const k of ks) await desce(p => p.click(`#lista .ind[data-k="${k}"]`), `${c.nome} ${tema} ${aba} ${k}`);
          }
          if(c.topo) for(const id of ['cBase', 'cSem']) await desce(p => p.click('#' + id), `${c.nome} ${tema} ${id}`);
          assert.deepEqual(novo.erros, []);
          await novo.ctx.close(); await velho.ctx.close();
        }
      }
      // os tipos de linha e elemento da cascata apareceram na conferência
      for(const t of ['h2', 'div.s', 'button.fechar', 'button.cVolta', 'div.cLin.ok', 'div.cLin.no', 'div.cLin.off', 'span.cOn.ok',
                      'span.cOn', 'span.cOn.nd', 'div.cNota', 'div.cCab', 'div.cCli', 'span.neg', 'span.pos', 'div.item', 'div.item.riscado',
                      'span.tagOnline', 'button.dchip', 'button.dchip.on', 'div.chips', 'div.vazio', 'div.bd'])
        assert.ok([...vistos].some(v => v === t || v.startsWith(t + '.')), `nenhum ${t} conferido`);
      if(cortes.size) console.log(`# ${largura} px: células com reticências (como antes): ${[...cortes].join(' | ')}`);
    });
  }
});

/* ---------- Parte O — Resumo e PDF: sem assinatura, cabeçalho junto do 1º bloco, números grandes ---------- */
/* PDF com as bibliotecas simuladas: a "captura" é a própria folha (onclone recebe o documento real) e o jsPDF anota as
   páginas ([largura, altura] de cada uma). */
const SIMULA_PDF = () => {
  window.__pdf = null;
  // a "captura" pinta o cabeçalho de cinza e os blocos de preto (o resto branco): cada página do PDF diz o que levou
  window.html2canvas = async (el, op) => {
    const rod = !!el.querySelector('.rs-rod') || el.textContent.includes(CONFIG.CREDITOS);
    window.__pdf = {pdf: el.classList.contains('rs-pdf'), rod, larg: el.getBoundingClientRect().width, paginas: [], imgs: [],
                    cel: window.__celulas ? window.__celulas(el) : null};
    if(op.onclone) op.onclone(document);
    const c = document.createElement('canvas'); c.width = op.width * 2; c.height = el.scrollHeight * 2;
    const cx = c.getContext('2d'), top = el.getBoundingClientRect().top;
    cx.fillStyle = '#fff'; cx.fillRect(0, 0, c.width, c.height);
    const pinta = (sel, cor) => el.querySelectorAll(sel).forEach(b => { const r = b.getBoundingClientRect();
      cx.fillStyle = cor; cx.fillRect(0, (r.top - top) * 2, c.width, r.height * 2); });
    pinta('.rs-cab, .rs-atencao', '#888'); pinta('.rs-bloco', '#000');
    return c;
  };
  window.jspdf = {jsPDF: function(o){ window.__pdf.paginas.push(o.format);
    return {addPage(f){ window.__pdf.paginas.push(f); }, addImage(img){ window.__pdf.imgs.push(img); }, setProperties(){},
            output: () => new Blob(['%PDF'])}; }};
};
/* conteúdo de cada imagem de página: fração de linhas com bloco (preto), com cabeçalho (cinza) e em branco */
const CONTEUDO_PAGINAS = imgs => Promise.all(imgs.map(src => new Promise(ok => {
  const im = new Image();
  im.onload = () => {
    const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
    const cx = c.getContext('2d'); cx.drawImage(im, 0, 0);
    const d = cx.getImageData(Math.floor(im.width / 2), 0, 1, im.height).data;
    let bloco = 0, cab = 0;
    for(let y = 0; y < im.height; y++){ const v = d[y * 4]; if(v < 60) bloco++; else if(v > 100 && v < 170) cab++; }
    ok({bloco: bloco / im.height, cab: cab / im.height});
  };
  im.src = src;
})));
async function pdfSimulado(page){
  await page.evaluate(SIMULA_PDF);
  await page.click('#rsImg');
  await page.waitForFunction(() => /PDF salvo/.test(document.getElementById('rsToast').textContent));
  return page.evaluate(() => window.__pdf);
}

describe('Parte O — Resumo e PDF', {skip: pular}, () => {
  test('Resumo sem assinatura (tela e PDF); o rodapé do painel continua', async () => {
    const {page, ctx, erros} = await abre('normal', {entrar: 'dir'});
    assert.match(await page.textContent('#rodape .creditos'), /^Karen Oliveira - Inteligência de Mercado$/);
    for(const entrar of ['dir', 'gc', {perfil: 'gc', gc: 'IT+MO'}, {perfil: 'sv', gc: 'G2', sv: '1'}]){
      await vaiPara(page, entrar);
      await page.click('#btnResumo');
      const r = await page.evaluate(() => {
        const f = document.getElementById('rsFolha'), ult = f.lastElementChild;
        return {rod: !!f.querySelector('.rs-rod'), cred: f.textContent.includes(CONFIG.CREDITOS), ult: ult.className,
                // nada depois do último bloco: a folha acaba no bloco (só o padding de baixo)
                folga: f.getBoundingClientRect().bottom - ult.getBoundingClientRect().bottom};
      });
      assert.deepEqual([r.rod, r.cred, r.ult], [false, false, 'rs-bloco'], JSON.stringify(entrar));
      assert.ok(r.folga <= 16, `folga embaixo ${r.folga}`);
      const pdf = await pdfSimulado(page);
      assert.ok(pdf.pdf);
      assert.equal(pdf.rod, false, `PDF ${JSON.stringify(entrar)}`);
      await page.click('#rsVoltar');
    }
    assert.match(await page.textContent('#rodape .creditos'), /^Karen Oliveira - Inteligência de Mercado$/);
    assert.deepEqual(erros, []);
    await ctx.close();
  });
});

/* Paginação do PDF (RS.paginas) sem navegador: resumo.js roda num contexto vm (a função não usa o DOM). */
describe('Parte O — paginação do PDF (função pura, sem navegador)', () => {
  const vm = require('node:vm');
  const ctxVm = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(FRONT, 'js', 'resumo.js'), 'utf-8') + '\n;globalThis.RS = RS;', ctxVm);
  const paginas = (...a) => JSON.parse(JSON.stringify(ctxVm.RS.paginas(...a)));
  const H0 = 675;                                    // 1200 x 9/16
  // cada página: altura usada no PDF = max(H0, faixa); nenhuma página sem bloco (só cabeçalho) nem sobra só de rodapé
  const confere = (pags, cab, blocos, alt) => {
    for(const [y0, y1] of pags) assert.ok(blocos.some(b => b.t >= y0 && b.b <= y1), `página sem bloco [${y0}, ${y1}]`);
    for(const b of blocos) assert.equal(pags.filter(([y0, y1]) => b.t >= y0 && b.b <= y1).length, 1, `bloco ${b.t}-${b.b}`);
    assert.ok(pags[0][0] <= cab.t, 'o cabeçalho está na 1ª página');
    assert.ok(pags[0][1] >= blocos[0].b, 'o 1º bloco está na 1ª página, junto do cabeçalho');
    assert.ok(pags.at(-1)[1] <= alt, 'a última página não passa da folha');
  };
  const cab = {t: 16, b: 110};

  test('cabeçalho sozinho vira junto com o bloco 1 (bloco 1 maior que o espaço que sobra)', () => {
    const b1 = {t: 124, b: 760}, b2 = {t: 778, b: 1500}, alt = 1512;
    const pags = paginas([cab, b1, b2], H0, alt);
    assert.deepEqual(pags, [[0, 770], [770, 1510]]);
    confere(pags, cab, [b1, b2], alt);
    assert.ok(pags[0][1] - pags[0][0] > H0, 'a 1ª página fica mais alta que H0');
  });
  test('1 bloco: uma página; cabe na altura padrão ou cresce', () => {
    assert.deepEqual(paginas([cab, {t: 124, b: 400}], H0, 412), [[0, 410]]);
    assert.deepEqual(paginas([cab, {t: 124, b: 1400}], H0, 1412), [[0, 1410]]);
  });
  test('2 blocos que cabem juntos: uma página; 3 blocos: quebra só entre blocos', () => {
    const b1 = {t: 124, b: 300}, b2 = {t: 318, b: 600}, b3 = {t: 618, b: 900};
    assert.deepEqual(paginas([cab, b1, b2], H0, 612), [[0, 610]]);
    const pags = paginas([cab, b1, b2, b3], H0, 912);
    assert.deepEqual(pags, [[0, 610], [610, 910]]);
    confere(pags, cab, [b1, b2, b3], 912);
  });
  test('Diretoria: Volume + ICS GC = 2 páginas; com Novos Negócios, 3 (blocos mais altos que a página)', () => {
    const vol = {t: 124, b: 800}, ics = {t: 818, b: 2100}, nov = {t: 2118, b: 2900};
    const p2 = paginas([cab, vol, ics], H0, 2112);
    assert.equal(p2.length, 2);
    confere(p2, cab, [vol, ics], 2112);
    const p3 = paginas([cab, vol, ics, nov], H0, 2912);
    assert.equal(p3.length, 3);
    confere(p3, cab, [vol, ics, nov], 2912);
  });
  test('placa ATENÇÃO conta como cabeçalho; sem blocos não quebra', () => {
    assert.deepEqual(paginas([{t: 16, b: 160}, {t: 174, b: 500}, {t: 518, b: 1000}], H0, 1012), [[0, 510], [510, 1010]]);
    assert.deepEqual(paginas([cab], H0, 122), [[0, 120]]);
    assert.deepEqual(paginas([], H0, 122), [[0, 122]]);
  });
});

describe('Parte O — paginação do PDF no navegador', {skip: pular}, () => {
  for(const largura of [1280, 390]){
    test(`${largura} px: Diretoria = 2 páginas (3 com Novos Negócios); nenhuma página só de cabeçalho ou em branco`, async () => {
      const {page, ctx, erros} = await abre('normal', {entrar: 'dir', largura, altura: 900});
      for(const [entrar, esperado] of [['dir', [2, 3]], ['gc', null], [{perfil: 'gc', gc: 'IT+MO'}, null]]){
        await vaiPara(page, entrar);
        await page.click('#btnResumo');
        for(const nov of [false, true]){
          if(nov) await page.click('#rsOverlay [data-rsb="nov"]');
          const pdf = await pdfSimulado(page);
          const cont = await page.evaluate(CONTEUDO_PAGINAS, pdf.imgs);
          const onde = `${JSON.stringify(entrar)}${nov ? ' + Novos Negócios' : ''}: ${JSON.stringify(cont)}`;
          assert.equal(cont.length, pdf.paginas.length, onde);
          if(esperado) assert.equal(pdf.paginas.length, esperado[nov ? 1 : 0], onde);
          cont.forEach((c, i) => assert.ok(c.bloco > 0.2, `página ${i + 1} sem bloco: ${onde}`));
          // (cinza na emenda preto/branco do JPEG: menos de 1% das linhas)
          assert.ok(cont[0].cab > 0.05, `cabeçalho fora da 1ª página: ${onde}`);
          cont.slice(1).forEach((c, i) => assert.ok(c.cab < 0.01, `cabeçalho repetido na página ${i + 2}: ${onde}`));
          // páginas deitadas (16:9) na largura do PDF, ou mais altas quando o conteúdo pede
          for(const [w, h] of pdf.paginas) assert.ok(h >= Math.round(w * 9 / 16), `${w}x${h} ${onde}`);
        }
        await page.click('#rsOverlay [data-rsb="nov"]');
        await page.click('#rsVoltar');
      }
      assert.deepEqual(erros, []);
      await ctx.close();
    });
  }
});

/* Células das tabelas do Resumo no PDF (folha com .rs-pdf, na página ou no clone do html2canvas): nenhuma célula, caixa
   ou texto cortado (scrollWidth <= clientWidth), número dentro da própria caixa, caixas da célula (M.dia/Faltam/Reverter
   e Online) sem interseção e fonte do número >= 10 px. */
const INSTALA_CELULAS = () => {
  window.__celulas = f => {
    const prob = [], fontes = [], css = el => el.ownerDocument.defaultView.getComputedStyle(el);
    const txt = el => `${el.className || el.tagName} "${el.textContent.trim().slice(0, 30)}"`;
    f.querySelectorAll('.rs-tab th, .rs-tab td').forEach(c => { if(c.scrollWidth > c.clientWidth) prob.push(`${txt(c)} ${c.scrollWidth}>${c.clientWidth}`); });
    f.querySelectorAll('.rs-tab .rs-k').forEach(k => {
      for(const el of [k, ...k.children]) if(el.scrollWidth > el.clientWidth) prob.push(`${txt(el)} ${el.scrollWidth}>${el.clientWidth}`);
      const s = k.querySelector('strong'), rk = k.getBoundingClientRect(), rs = s.getBoundingClientRect();
      if(rs.left < rk.left - .5 || rs.right > rk.right + .5) prob.push(`${txt(s)} fora da caixa`);
      fontes.push(parseFloat(css(s).fontSize));
    });
    f.querySelectorAll('.rs-tab .rs-par').forEach(p => {
      const [a, b] = [...p.children].map(x => x.getBoundingClientRect());
      if(a && b && a.right > b.left + .5) prob.push(`${txt(p)}: caixas se sobrepõem`);
    });
    return {prob, caixas: fontes.length, fonteMin: Math.min(...fontes), fonteMax: Math.max(...fontes),
            largura: f.getBoundingClientRect().width};
  };
};
// estilo computado e tamanho de cada elemento da folha do Resumo (tela)
const FOTO_FOLHA = props => [...document.querySelectorAll('#rsFolha, #rsFolha *')].map(el => {
  const cs = getComputedStyle(el), r = el.getBoundingClientRect();
  return [el.tagName + '.' + el.className, Math.round(r.width), Math.round(r.height), ...props.map(p => cs.getPropertyValue(p))].join('|');
});
// CSS do main antes deste ajuste (a tela do Resumo não pode mudar)
const REF_RESUMO = '2d5419a';
const CSS_ANTES = (() => {
  try { return execSync(`git show ${REF_RESUMO}:frontend/css/app.css`, {cwd: RAIZ, stdio: ['ignore', 'pipe', 'ignore']}).toString(); }
  catch(e) { return null; }
})();
const ENTRADAS_RS = [['Diretoria', 'dir'], ['G1', {perfil: 'gc', gc: 'G1'}], ['IT+MO', {perfil: 'gc', gc: 'IT+MO'}],
                     ['SV.G2.1', {perfil: 'sv', gc: 'G2', sv: '1'}]];

describe('Parte O — números grandes no PDF do Resumo', {skip: pular}, () => {
  for(const largura of [1280, 390]){
    test(`${largura} px: 16 gerências e números grandes; e o pior caso (2.665.000 em todas as caixas): nada cortado no PDF`, async () => {
      const {page, ctx, erros} = await abre('grande', {entrar: 'dir', largura, altura: 900});
      await page.evaluate(INSTALA_CELULAS);
      for(const [nome, entrar] of ENTRADAS_RS){
        await vaiPara(page, entrar);
        await page.click('#btnResumo');
        await page.click('#rsOverlay [data-rsb="nov"]');
        if(nome === 'Diretoria'){
          const r = await page.evaluate(() => ({cols: [...document.querySelector('#rsFolha .rs-bloco').querySelectorAll('.rs-tab thead th:not(.rs-nome)')]
              .filter(th => th.textContent.trim()).length,
            maior: Math.max(...[...document.querySelectorAll('#rsFolha .rs-k strong')].map(s => s.textContent.replace(/\D/g, '').length))}));
          assert.equal(r.cols, 17, 'Diretoria: o total e as 16 gerências');
          assert.ok(r.maior >= 7, `números grandes no cenário (${r.maior} dígitos)`);
        }
        for(const pior of [false, true]){
          if(pior) await page.evaluate(() => document.querySelectorAll('#rsFolha .rs-tab .rs-k strong').forEach(s => { s.textContent = '2.665.000'; }));
          const antes = await page.evaluate(() => document.getElementById('rsFolha').getBoundingClientRect().width);
          const pdf = await pdfSimulado(page);
          const onde = `${nome}${pior ? ' (pior caso)' : ''}`;
          assert.ok(pdf.cel.caixas > 0, onde);
          assert.deepEqual(pdf.cel.prob.slice(0, 5), [], `${onde}: ${JSON.stringify({...pdf.cel, prob: pdf.cel.prob.length})}`);
          assert.ok(pdf.cel.fonteMin >= 10, `${onde}: fonte ${pdf.cel.fonteMin}`);
          // a página do PDF tem a largura da folha capturada
          assert.equal(pdf.paginas[0][0], Math.round(pdf.cel.largura), onde);
          // depois do PDF a tela volta como estava (sem fonte encaixada nem largura do PDF)
          const depois = await page.evaluate(() => ({larg: document.getElementById('rsFolha').getBoundingClientRect().width,
            pdf: document.getElementById('rsFolha').classList.contains('rs-pdf'),
            resto: [...document.querySelectorAll('#rsFolha [data-fit], #rsFolha [style*="font-size"]')].length}));
          assert.deepEqual(depois, {larg: antes, pdf: false, resto: 0}, onde);
        }
        await page.click('#rsOverlay [data-rsb="nov"]');
        await page.click('#rsVoltar');
      }
      assert.deepEqual(erros, []);
      await ctx.close();
    });
  }

  test('a tela do Resumo não muda (celular, tablet, PC): mesmo estilo e tamanho do CSS de antes, também depois do PDF',
       {skip: !CSS_ANTES && `sem o commit ${REF_RESUMO}`}, async () => {
    for(const largura of [390, 800, 1280, 1700]){
      const atual = await abre('grande', {entrar: 'dir', largura, altura: 900});
      const velho = await abre('grande', {entrar: 'dir', largura, altura: 900, troca: {'/css/app.css': () => CSS_ANTES}});
      for(const [nome, entrar] of ENTRADAS_RS){
        const fotos = [];
        for(const {page} of [atual, velho]){
          await vaiPara(page, entrar);
          await page.click('#btnResumo');
          await page.evaluate(() => document.fonts.ready);
          fotos.push(await page.evaluate(FOTO_FOLHA, PROPS_CASCATA));
        }
        assert.equal(fotos[0].length, fotos[1].length, `${largura} ${nome}`);
        const dif = fotos[0].map((f, i) => f === fotos[1][i] ? null : `${f}\n  antes: ${fotos[1][i]}`).filter(Boolean);
        assert.deepEqual(dif.slice(0, 3), [], `${largura} px ${nome}`);
        // depois de gerar o PDF a tela fica igual
        await pdfSimulado(atual.page);
        assert.deepEqual(await atual.page.evaluate(FOTO_FOLHA, PROPS_CASCATA), fotos[0], `${largura} px ${nome} depois do PDF`);
        for(const {page} of [atual, velho]) await page.click('#rsVoltar');
      }
      assert.deepEqual(atual.erros, []);
      await atual.ctx.close(); await velho.ctx.close();
    }
  });
});

/* PDF de verdade: html2canvas e jsPDF (as versões do CONFIG.CDN, mesmo hash SRI) vindos dos pacotes npm instalados
   (local, NODE_PATH ou global), servidos no lugar do cdnjs. Sem os pacotes, o teste é pulado (os de cima simulam). */
const LIBS_PDF = (() => {
  const busca = [RAIZ, ...(process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean)];
  try { busca.push(execSync('npm root -g', {stdio: ['ignore', 'pipe', 'ignore']}).toString().trim()); } catch(e) { /* sem npm */ }
  try {
    return {html2canvas: require.resolve('html2canvas/dist/html2canvas.min.js', {paths: busca}),
            jspdf: require.resolve('jspdf/dist/jspdf.umd.min.js', {paths: busca})};
  } catch(e) { return null; }
})();
describe('Parte O — PDF real (html2canvas + jsPDF)', {skip: pular || (!LIBS_PDF && 'html2canvas/jspdf não instalados (npm)')}, () => {
  for(const largura of [1280, 390]){
    test(`${largura} px: nº de páginas, nenhuma página em branco, células sem corte no clone da captura`, async () => {
      const {page, ctx, erros} = await abre('grande', {entrar: 'dir', largura, altura: 900});
      await page.route(/cdnjs\.cloudflare\.com/, r => {
        const arq = /html2canvas/.test(r.request().url()) ? LIBS_PDF.html2canvas : LIBS_PDF.jspdf;
        r.fulfill({status: 200, contentType: 'text/javascript', body: fs.readFileSync(arq),
                   headers: {'access-control-allow-origin': '*'}});
      });
      await page.evaluate(INSTALA_CELULAS);
      // carrega as bibliotecas como o app (com SRI) e anota o que vai para o PDF: imagens das páginas e células no clone
      await page.evaluate(async () => {
        for(const lib of [CONFIG.CDN.html2canvas, CONFIG.CDN.jspdf]) await new Promise((ok, erro) => {
          const s = document.createElement('script'); s.src = lib.src; s.integrity = lib.integrity; s.crossOrigin = 'anonymous';
          s.onload = ok; s.onerror = erro; document.head.appendChild(s);
        });
        const h2c = window.html2canvas;
        window.html2canvas = (el, op) => h2c(el, {...op, onclone: d => { op.onclone(d); window.__real.cel = window.__celulas(d.getElementById('rsFolha')); }});
        const add = window.jspdf.jsPDF.API.addImage;
        window.jspdf.jsPDF.API.addImage = function(img, ...r){ window.__real.imgs.push(img); return add.call(this, img, ...r); };
      });
      for(const [nome, entrar, esperado] of [['Diretoria', 'dir', [2, 3]], ['G1', {perfil: 'gc', gc: 'G1'}, null],
                                             ['IT+MO', {perfil: 'gc', gc: 'IT+MO'}, null]]){
        await vaiPara(page, entrar);
        await page.click('#btnResumo');
        for(const nov of [false, true]){
          if(nov) await page.click('#rsOverlay [data-rsb="nov"]');
          await page.evaluate(() => { window.__real = {imgs: [], cel: null}; });
          const [baixado] = await Promise.all([page.waitForEvent('download'), page.click('#rsImg')]);
          const bytes = fs.readFileSync(await baixado.path()).toString('latin1');
          const onde = `${nome}${nov ? ' + Novos Negócios' : ''}`;
          assert.match(bytes.slice(0, 5), /^%PDF-/, onde);
          const pags = (bytes.match(/\/Type\s*\/Page\b(?!s)/g) || []).length;
          const real = await page.evaluate(() => window.__real);
          assert.equal(pags, real.imgs.length, onde);
          if(esperado) assert.equal(pags, esperado[nov ? 1 : 0], onde);
          // nenhuma página em branco: cada imagem tem uma fração razoável de pixels escuros (texto, linhas, caixas)
          const tinta = await page.evaluate(imgs => Promise.all(imgs.map(src => new Promise(ok => {
            const im = new Image();
            im.onload = () => { const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
              const cx = c.getContext('2d'); cx.drawImage(im, 0, 0);
              const d = cx.getImageData(0, 0, im.width, im.height).data; let n = 0;
              for(let i = 0; i < d.length; i += 16) if(d[i] < 200 || d[i + 1] < 200 || d[i + 2] < 200) n++;
              ok(n / (d.length / 16)); };
            im.src = src;
          }))), real.imgs);
          tinta.forEach((t, i) => assert.ok(t > 0.02, `${onde}: página ${i + 1} quase em branco (${t})`));
          assert.ok(real.cel && real.cel.caixas > 0, onde);
          assert.deepEqual(real.cel.prob.slice(0, 5), [], `${onde}: ${real.cel.prob.length} problemas no clone ${JSON.stringify({...real.cel, prob: real.cel.prob.slice(0, 4)})}`);
          assert.ok(real.cel.fonteMin >= 10, `${onde}: fonte ${real.cel.fonteMin}`);
        }
        await page.click('#rsOverlay [data-rsb="nov"]');
        await page.click('#rsVoltar');
      }
      assert.deepEqual(erros.filter(e => !/net::ERR_FAILED|cdnjs/.test(e)), []);
      await ctx.close();
    });
  }
});

/* ---------- Parte P — versão do código (script do deploy-pages.yml, sem navegador) ---------- */
const SCRIPT_VERSAO = path.join(RAIZ, '.github', 'scripts', 'versao-front.sh');
const temBash = (() => { try { execFileSync('bash', ['-c', 'command -v sha256sum >/dev/null']); return true; } catch(e) { return false; } })();
describe('Parte P — versão do código (hash de frontend/ sem data/)', {skip: !temBash && 'sem bash/sha256sum'}, () => {
  const versao = (...args) => execFileSync('bash', [SCRIPT_VERSAO, ...args]).toString().trim();
  test('cópia de frontend/: mesmo hash duas vezes; mudar só data/ não muda; mudar um .js muda; --gravar', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drotas-versao-'));
    try {
      const copia = path.join(dir, 'frontend');
      fs.cpSync(FRONT, copia, {recursive: true});
      fs.rmSync(path.join(copia, 'versao.json'), {force: true});
      const v1 = versao(copia), v2 = versao(copia);
      assert.match(v1, /^[0-9a-f]{12}$/);
      assert.equal(v2, v1, 'determinístico');
      assert.equal(versao(FRONT), v1, 'a cópia dá o mesmo hash do original (caminhos relativos)');
      // só dados: o aviso não pode aparecer a cada atualização automática
      fs.mkdirSync(path.join(copia, 'data'), {recursive: true});
      fs.writeFileSync(path.join(copia, 'data', 'payload.json'), '{"outro":"payload"}');
      fs.writeFileSync(path.join(copia, 'data', 'online.json'), '{"outro":"online"}');
      assert.equal(versao(copia), v1, 'dados mudaram, código igual');
      // código: muda
      fs.appendFileSync(path.join(copia, 'js', 'app.js'), '\n// mudança\n');
      const v3 = versao(copia);
      assert.notEqual(v3, v1, 'um .js mudou');
      // --gravar: versao.json e a meta do index.html (o próprio versao.json não entra no hash)
      assert.equal(versao('--gravar', copia), v3);
      const vj = JSON.parse(fs.readFileSync(path.join(copia, 'versao.json'), 'utf-8'));
      assert.equal(vj.versao, v3);
      assert.match(vj.gerado, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
      const html = fs.readFileSync(path.join(copia, 'index.html'), 'utf-8');
      assert.ok(html.includes(`<meta name="versao" content="${v3}">`) && !html.includes('content="dev"'));
      // sem o marcador (já gravado): falha em vez de publicar sem versão
      assert.throws(() => execFileSync('bash', [SCRIPT_VERSAO, '--gravar', copia], {stdio: 'pipe'}));
    } finally { fs.rmSync(dir, {recursive: true, force: true}); }
  });
  test('index.html do repositório com o marcador "dev"; deploy-pages.yml grava a versão antes do upload', () => {
    const html = fs.readFileSync(path.join(FRONT, 'index.html'), 'utf-8');
    assert.equal(html.split('<meta name="versao" content="dev">').length, 2, 'um marcador');
    const yml = fs.readFileSync(path.join(RAIZ, '.github', 'workflows', 'deploy-pages.yml'), 'utf-8');
    const passo = yml.indexOf('versao-front.sh --gravar frontend'), upload = yml.indexOf('upload-pages-artifact');
    assert.ok(passo > 0 && upload > passo, 'passo da versão antes do upload');
    assert.match(yml, /workflow_call:/);
    assert.ok(!fs.existsSync(path.join(FRONT, 'versao.json')), 'versao.json não é versionado');
  });
});

/* ---------- Parte Q — aviso de versão nova do código ---------- */
const VERSAO_LOCAL = 'aaaaaaaaaaaa';
/* Abre o painel com a meta "versao" = `local` ('dev' = como no repositório) e o versao.json do servidor em `srv`
   ({versao, status, atraso}; mutável no meio do teste). Conta os pedidos (versao.json, online, payload) e guarda em
   sessionStorage (sobrevive ao reload) cada fetch com a opção cache. */
async function abreVersao({local = VERSAO_LOCAL, srv = {versao: VERSAO_LOCAL}, antes, standalone, ...resto} = {}){
  const pedidos = [];
  const r = await abre('normal', {...resto,
    troca: local === 'dev' ? {} : {'/index.html': t => t.replace('<meta name="versao" content="dev">', `<meta name="versao" content="${local}">`)},
    antes: async page => {
      page.on('request', q => pedidos.push(new URL(q.url()).pathname));
      await page.route(/\/versao\.json/, async rota => {
        if(srv.atraso) await new Promise(ok => setTimeout(ok, srv.atraso));
        if(srv.status && srv.status !== 200) return rota.fulfill({status: srv.status, body: ''});
        rota.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify({versao: srv.versao, gerado: '2026-10-21T12:00:00Z'})});
      });
      await page.addInitScript(() => {
        const f = window.fetch;
        window.fetch = (u, o) => {
          try { const l = JSON.parse(sessionStorage.getItem('_fetches') || '[]');
            l.push([new URL(String(u), location.href).pathname, (o && o.cache) || '']);
            sessionStorage.setItem('_fetches', JSON.stringify(l)); } catch(e){}
          return f(u, o);
        };
      });
      // "tela inicial": o Chromium não emula display-mode; simula o que a página vê (matchMedia e o
      // navigator.standalone do iPhone)
      if(standalone) await page.addInitScript(() => {
        const mm = window.matchMedia.bind(window);
        window.matchMedia = q => /display-mode:\s*standalone/.test(q)
          ? {matches: true, media: q, onchange: null, addListener(){}, removeListener(){}, addEventListener(){},
             removeEventListener(){}, dispatchEvent(){ return false; }}
          : mm(q);
        Object.defineProperty(navigator, 'standalone', {get: () => true});
      });
      if(antes) await antes(page);
    }});
  const conta = nome => pedidos.filter(p => p.endsWith(nome)).length;
  return {...r, pedidos, conta, srv};
}
const faixa = page => page.evaluate(() => {
  const a = document.getElementById('aviso');
  return {visivel: a.getClientRects().length > 0, txt: document.getElementById('avisoTxt').textContent,
          btn: document.getElementById('avisoAtualizar').textContent, des: document.getElementById('avisoAtualizar').disabled};
});
const esperaPedido = (page, conta, nome, n) => page.waitForFunction(() => true).then(async () => {
  for(let i = 0; i < 100 && conta(nome) < n; i++) await page.waitForTimeout(20);
  assert.ok(conta(nome) >= n, `${nome}: ${conta(nome)} pedidos (esperado ${n})`);
});
// erros de rede que o próprio Chromium registra no console (404 e fetch abortado de propósito); o resto é erro
const semErrosDeRede = erros => erros.filter(e => !/Failed to load resource/.test(e));

/* Etapa 3: abaixo de 1000 px a faixa fica acima do topo (.topo); no PC o cabeçalho é o painel lateral fixo (.topo sem
   caixa) e a faixa fica no alto do conteúdo, à direita do painel, acima do .wrap. `faixaLivre` diz se ela não cobre
   nem é coberta pelo cabeçalho do layout atual. */
const faixaLivre = page => page.evaluate(() => {
  const b = el => el.getBoundingClientRect();
  const av = b(document.getElementById('aviso')), lado = getComputedStyle(document.querySelector('.lado')).position === 'fixed';
  if(!lado) return {lado, ok: av.top >= 0 && av.bottom <= b(document.querySelector('.topo')).top + .5};
  const ld = b(document.querySelector('.lado')), wrap = b(document.querySelector('.wrap'));
  // o ponto do meio da faixa é a própria faixa (nada por cima)
  const meio = document.elementFromPoint((av.left + av.right) / 2, (av.top + av.bottom) / 2);
  return {lado, ok: av.top >= 0 && av.left >= ld.right - .5 && av.bottom <= wrap.top + .5 && av.width > 300 &&
                    !!meio && !!meio.closest('#aviso')};
});

describe('Parte Q — aviso de versão nova', {skip: pular}, () => {
  test('versão igual: sem faixa, mas conferida; o ↻ fica sempre visível, ao lado da casa', async () => {
    const {page, ctx, erros, conta} = await abreVersao();
    await esperaPedido(page, conta, '/versao.json', 1);
    assert.equal((await faixa(page)).visivel, false);
    const r = await page.evaluate(() => {
      const b = id => document.getElementById(id).getBoundingClientRect();
      const ic = document.getElementById('btnRecarga');
      return {vis: ic.getClientRects().length > 0, label: ic.getAttribute('aria-label'), ic: b('btnRecarga'), casa: b('btnCasa'),
              mesmoPai: ic.parentElement === document.getElementById('btnCasa').parentElement};
    });
    assert.ok(r.vis && r.mesmoPai);
    assert.equal(r.label, 'Atualizar o painel');
    assert.ok(r.ic.right <= r.casa.left && Math.abs(r.ic.top - r.casa.top) < 1, 'ao lado (à esquerda) da casa');
    // o pedido fura o cache: no-store e query de tempo
    const f = await page.evaluate(() => JSON.parse(sessionStorage.getItem('_fetches')).filter(x => x[0] === '/versao.json'));
    assert.ok(f.length && f.every(x => x[1] === 'no-store'));
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('versão diferente: faixa acima do cabeçalho; não aparece na entrada (checagem em segundo plano)', async () => {
    const {page, ctx, erros, conta} = await abreVersao({srv: {versao: 'bbbbbbbbbbbb'}, entrar: null});
    await esperaPedido(page, conta, '/versao.json', 1);
    await page.waitForTimeout(100);
    assert.equal((await faixa(page)).visivel, false, 'na entrada, sem faixa');
    await entra(page, 'gc');
    const f = await faixa(page);
    assert.deepEqual([f.visivel, f.txt, f.btn, f.des], [true, 'Nova versão disponível', 'Atualizar', false]);
    assert.ok((await faixaLivre(page)).ok, 'acima do cabeçalho (no PC, à direita do painel lateral), sem cobrir');
    assert.equal(await page.textContent('#avisoDepois'), 'Depois');
    // casa: volta para a entrada, faixa some com ela
    await page.click('#btnCasa');
    assert.equal((await faixa(page)).visivel, false);
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('"Depois" esconde a faixa daquela versão; volta na 1ª verificação depois de 30 min se continuar diferente', async () => {
    const {page, ctx, erros, conta, srv} = await abreVersao({srv: {versao: 'bbbbbbbbbbbb'},
      antes: p => p.clock.install({time: new Date('2026-10-21T13:00:00Z')})});
    await page.waitForFunction(() => !document.getElementById('aviso').hidden);
    await page.click('#avisoDepois');
    assert.equal((await faixa(page)).visivel, false);
    const n = conta('/versao.json');
    await page.clock.runFor('20:00');                  // 4 verificações (online a cada 5 min): continua escondida
    await esperaPedido(page, conta, '/versao.json', n + 4);
    assert.equal((await faixa(page)).visivel, false, 'antes dos 30 min');
    await page.clock.runFor('10:00');                  // verificação dos 30 min (um pouco antes do fim do adiamento)
    await esperaPedido(page, conta, '/versao.json', n + 6);
    assert.equal((await faixa(page)).visivel, false, 'aos 30 min');
    await page.clock.runFor('05:00');                  // a 1ª verificação depois dos 30 min mostra de novo
    await page.waitForFunction(() => !document.getElementById('aviso').hidden);
    // "Depois" de novo e o servidor publica OUTRA versão: aparece já na próxima verificação
    await page.click('#avisoDepois');
    srv.versao = 'cccccccccccc';
    await page.clock.runFor('05:00');
    await page.waitForFunction(() => !document.getElementById('aviso').hidden);
    // servidor volta para a versão do painel: a faixa some sozinha
    srv.versao = VERSAO_LOCAL;
    await page.clock.runFor('05:00');
    await page.waitForFunction(() => document.getElementById('aviso').hidden);
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('"Atualizar": "Atualizando…", baixa tudo com cache reload e recarrega no mesmo acesso; localStorage intacto', async () => {
    const {page, ctx, erros, srv} = await abreVersao({srv: {versao: 'bbbbbbbbbbbb'}, entrar: {perfil: 'sv', gc: 'G2', sv: '1'},
      armazenado: {drotas_entrada: 'branca', outra_chave: 'x'}});
    await page.waitForFunction(() => !document.getElementById('aviso').hidden);
    const antes = await page.evaluate(() => ({...localStorage}));
    assert.ok(antes.drotas_sessao && antes.drotas_entrada === 'branca');
    await page.evaluate(() => { window.__marca = 1; sessionStorage.setItem('_fetches', '[]'); });
    srv.atraso = 400;
    const carregou = page.waitForEvent('load');
    await page.click('#avisoAtualizar');
    const f = await faixa(page);
    assert.deepEqual([f.btn, f.des], ['Atualizando…', true]);
    assert.equal(await page.$eval('#btnRecarga', b => b.disabled), true);
    await carregou;
    await esperaCarga(page);
    srv.atraso = 0;
    const r = await page.evaluate(() => ({marca: window.__marca, tipo: performance.getEntriesByType('navigation')[0].type,
      ls: {...localStorage}, f: JSON.parse(sessionStorage.getItem('_fetches')), acesso: ACESSO && ACESSO.perfil, sv: sel.sv,
      entrada: !document.getElementById('entrada').hidden}));
    assert.equal(r.marca, undefined, 'recarregou');
    assert.equal(r.tipo, 'reload');
    assert.deepEqual(r.ls, antes, 'nenhuma chave do localStorage apagada ou mudada');
    assert.deepEqual([r.entrada, r.acesso, r.sv], [false, 'sv', 'SV.G2.1'], 'reabre no mesmo perfil e contexto');
    const recarregados = new Set(r.f.filter(x => x[1] === 'reload').map(x => x[0]));
    for(const p of ['/index.html', '/css/app.css', '/js/config.js', '/js/app.js', '/js/resumo.js', '/js/main.js',
                    '/manifest.webmanifest', '/versao.json', '/data/payload.json', '/data/online.json'])
      assert.ok(recarregados.has(p), `${p} com cache: 'reload'`);
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('sem conexão ao atualizar: "Sem conexão. Tente de novo." e não recarrega; tentar de novo funciona', async () => {
    const {page, ctx, erros} = await abreVersao({srv: {versao: 'bbbbbbbbbbbb'}});
    await page.waitForFunction(() => !document.getElementById('aviso').hidden);
    await page.evaluate(() => { window.__marca = 1; });
    const corta = rota => rota.request().resourceType() === 'fetch' ? rota.abort('internetdisconnected') : rota.fallback();
    await page.route('**/js/app.js', corta);
    await page.click('#avisoAtualizar');
    await page.waitForFunction(() => document.getElementById('avisoTxt').textContent === 'Sem conexão. Tente de novo.');
    await page.waitForTimeout(300);
    const f = await faixa(page);
    assert.deepEqual([f.visivel, f.btn, f.des], [true, 'Atualizar', false]);
    assert.equal(await page.evaluate(() => window.__marca), 1, 'não recarregou');
    assert.equal(await page.$eval('#btnRecarga', b => b.disabled), false);
    // a verificação seguinte não apaga a mensagem; "Depois" esconde
    await page.evaluate(() => confereVersao());
    assert.equal((await faixa(page)).txt, 'Sem conexão. Tente de novo.');
    // conexão de volta: o ↻ do cabeçalho faz a mesma ação e recarrega
    await page.unroute('**/js/app.js', corta);
    const carregou = page.waitForEvent('load');
    await page.click('#btnRecarga');
    await carregou;
    await esperaCarga(page);
    assert.equal(await page.evaluate(() => window.__marca), undefined);
    assert.deepEqual(semErrosDeRede(erros), []);
    await ctx.close();
  });

  test('meta "dev" (desenvolvimento): aviso desligado, sem pedir versao.json; 404 e JSON inválido: silêncio', async () => {
    let {page, ctx, erros, conta} = await abreVersao({local: 'dev', srv: {versao: 'bbbbbbbbbbbb'}});
    await page.evaluate(() => { puxaOnline(); document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForTimeout(300);
    assert.equal(conta('/versao.json'), 0);
    assert.equal((await faixa(page)).visivel, false);
    assert.equal(await page.isVisible('#btnRecarga'), true, 'o ↻ existe também em desenvolvimento');
    assert.deepEqual(erros, []);
    await ctx.close();
    for(const srv of [{status: 404}, {status: 500}, {versao: ''}]){
      ({page, ctx, erros, conta} = await abreVersao({srv}));
      await esperaPedido(page, conta, '/versao.json', 1);
      await page.evaluate(() => confereVersao());
      await page.waitForTimeout(100);
      assert.equal((await faixa(page)).visivel, false, JSON.stringify(srv));
      assert.deepEqual(semErrosDeRede(erros), [], JSON.stringify(srv));
      await ctx.close();
    }
  });

  test('checagem no puxaOnline (a cada 5 min), no visibilitychange e no pageshow; ao voltar, online já e payload se > 15 min', async () => {
    const {page, ctx, erros, conta} = await abreVersao({antes: p => p.clock.install({time: new Date('2026-10-21T13:00:00Z')})});
    await esperaPedido(page, conta, '/versao.json', 1);
    let n = {v: conta('/versao.json'), o: conta('/online.json'), p: conta('/payload.json')};
    await page.clock.fastForward('05:00');
    await esperaPedido(page, conta, '/versao.json', n.v + 1);
    n = {v: conta('/versao.json'), o: conta('/online.json'), p: conta('/payload.json')};
    // de volta para a aba/app 1 min depois: online e versão já; payload recente (< 15 min) fica
    await page.clock.setSystemTime(new Date('2026-10-21T13:06:00Z'));
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await esperaPedido(page, conta, '/versao.json', n.v + 1);
    await esperaPedido(page, conta, '/online.json', n.o + 1);
    await page.waitForTimeout(100);
    assert.equal(conta('/payload.json'), n.p, 'payload com menos de 15 min não é recarregado');
    // pageshow (volta do bfcache / app reaberto) 20 min depois, sem os temporizadores terem rodado: tudo, com o payload
    n = {v: conta('/versao.json'), o: conta('/online.json'), p: conta('/payload.json')};
    await page.clock.setSystemTime(new Date('2026-10-21T13:26:00Z'));
    await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pageshow', {persisted: true})));
    await esperaPedido(page, conta, '/versao.json', n.v + 1);
    await esperaPedido(page, conta, '/online.json', n.o + 1);
    await esperaPedido(page, conta, '/payload.json', n.p + 1);
    // visibilitychange e pageshow juntos (iPhone): uma vez só
    n = {v: conta('/versao.json'), o: conta('/online.json')};
    await page.clock.setSystemTime(new Date('2026-10-21T13:30:00Z'));
    await page.evaluate(() => { document.dispatchEvent(new Event('visibilitychange'));
      dispatchEvent(new PageTransitionEvent('pageshow', {persisted: true})); });
    await page.waitForTimeout(200);
    assert.deepEqual([conta('/versao.json'), conta('/online.json')], [n.v + 1, n.o + 1]);
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('modo "tela inicial" (display-mode: standalone): faixa e ↻ funcionam', async () => {
    const {page, ctx, erros} = await abreVersao({srv: {versao: 'bbbbbbbbbbbb'}, largura: 390, altura: 844, standalone: true});
    assert.equal(await page.evaluate(() => matchMedia('(display-mode: standalone)').matches), true);
    await page.waitForFunction(() => !document.getElementById('aviso').hidden);
    assert.equal(await page.isVisible('#btnRecarga'), true);
    await page.evaluate(() => { window.__marca = 1; });
    const carregou = page.waitForEvent('load');
    await page.click('#btnRecarga');
    await carregou;
    await esperaCarga(page);
    assert.equal(await page.evaluate(() => window.__marca), undefined, 'o ↻ recarregou');
    assert.equal(await page.evaluate(() => matchMedia('(display-mode: standalone)').matches), true);
    await page.waitForFunction(() => !document.getElementById('aviso').hidden);
    await page.evaluate(() => { window.__marca = 1; });
    const carregou2 = page.waitForEvent('load');
    await page.click('#avisoAtualizar');
    await carregou2;
    await esperaCarga(page);
    assert.equal(await page.evaluate(() => window.__marca), undefined, 'o "Atualizar" da faixa recarregou');
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  for(const largura of [390, 1000, 1280]){
    test(`${largura} px: faixa e ↻ sem rolagem lateral, sem cobrir o cabeçalho; escala tipográfica e contraste nos dois temas`, async () => {
      for(const tema of ['preta', 'branca']){
        const {page, ctx, erros} = await abreVersao({srv: {versao: 'bbbbbbbbbbbb'}, largura, altura: 844,
          armazenado: tema === 'branca' ? {drotas_entrada: 'branca'} : {}});
        await medidas(page);
        await page.evaluate(() => document.fonts.ready);
        await page.waitForFunction(() => !document.getElementById('aviso').hidden);
        assert.ok(await semRolagemLateral(page), `${tema}: rolagem lateral`);
        assert.deepEqual(await page.evaluate(() => __vis.estouros('#aviso, .topo')), [], tema);
        const r = await page.evaluate(() => {
          const b = el => el.getBoundingClientRect();
          const texto = s => { const rg = document.createRange(); rg.selectNodeContents(document.querySelector(s)); return rg.getBoundingClientRect(); };
          const cruza = (a, c) => a.left < c.right && c.left < a.right && a.top < c.bottom && c.top < a.bottom;
          const btns = b(document.querySelector('.topoBtns'));
          const fs = el => getComputedStyle(el).fontSize;
          return {aviso: b(document.getElementById('aviso')), topo: b(document.querySelector('.topo')),
                  cruzaTexto: ['.topo .marca', '.topo h1', '#sub', '#ritmo'].filter(s => cruza(btns, texto(s))),
                  fsAviso: [fs(document.getElementById('avisoTxt')), fs(document.getElementById('avisoAtualizar'))],
                  fsLegenda: getComputedStyle(document.documentElement).getPropertyValue('--fs-legenda').trim(),
                  familia: getComputedStyle(document.getElementById('avisoAtualizar')).fontFamily,
                  branca: document.getElementById('aviso').classList.contains('branca'),
                  contraste: __vis.contrastes(['#avisoTxt', '#avisoAtualizar', '#avisoDepois'])};
        });
        const livre = await faixaLivre(page);
        assert.equal(livre.lado, largura >= 1000, 'painel lateral só a partir de 1000 px');
        assert.ok(livre.ok, `${tema}: faixa acima do cabeçalho (no PC, à direita do painel lateral), sem cobrir`);
        assert.deepEqual(r.cruzaTexto, [], `${tema}: botões do canto sobre o texto do cabeçalho`);
        assert.deepEqual(r.fsAviso, [r.fsLegenda, r.fsLegenda], 'escala tipográfica (--fs-legenda)');
        assert.match(r.familia, /^Inter,/);
        assert.equal(r.branca, tema === 'branca');
        for(const [s, t, c] of r.contraste) assert.ok(c >= 4.5, `${tema} ${s} "${t}": ${c}`);
        assert.equal(r.contraste.length, 3);
        // sem a faixa, os botões do canto também não cobrem o texto
        await page.click('#avisoDepois');
        assert.deepEqual(await page.evaluate(() => {
          const btns = document.querySelector('.topoBtns').getBoundingClientRect();
          return ['.topo .marca', '.topo h1', '#sub', '#ritmo'].filter(s => { const rg = document.createRange();
            rg.selectNodeContents(document.querySelector(s)); const c = rg.getBoundingClientRect();
            return btns.left < c.right && c.left < btns.right && btns.top < c.bottom && c.top < btns.bottom; });
        }), [], tema);
        assert.deepEqual(erros, []);
        await ctx.close();
      }
    });
  }
});

/* ---------- Parte U — layout (Etapa 3): painel lateral no PC (>= 1000 px) e topo compacto no celular ----------
   No PC o <aside class="lado"> é a coluna fixa à esquerda (272 px; recolhida 76 px, só ícones) com o cabeçalho e a
   barra dentro (.topo, .barra e os .hd sem caixa; ordem por `order`); abaixo de 1000 px o aside não tem caixa e o topo
   é o compacto. Nada do conteúdo muda. */
const LADO_ABERTO = 272, LADO_RECOLHIDO = 76;
// cenários de perfil: selects visíveis e o escopo (texto do .subEsc, sem o " · " inicial)
const PERFIS_LAYOUT = [
  {nome: 'Diretoria', dados: 'normal', entrar: 'dir', sels: ['fgc'], esc: /^Diretoria$/},
  {nome: 'Gerência', dados: 'normal', entrar: {perfil: 'gc', gc: 'G2'}, sels: ['fsv', 'frota'], esc: /^Gerência · GC\.G2/},
  {nome: 'grupo IT+MO (Total)', dados: 'grupo', entrar: {perfil: 'gc', gc: 'IT+MO'}, sels: ['fgc', 'fsv', 'frota'],
   esc: /^Gerência · GC\.IT \+ GC\.MO/},
  {nome: 'Supervisão', dados: 'normal', entrar: {perfil: 'sv', gc: 'G2', sv: '1'}, sels: ['frota'], esc: /^Supervisão · GC\.G2.* · SV\.G2\.1/},
  {nome: 'Rota', dados: 'normal', entrar: {perfil: 'rota', gc: 'G2', rota: 'G211'}, sels: [], esc: /^Rota · GC\.G2.* · SV\.G2\.1.* · Rota G211 — /},
];
// estado do layout: selects visíveis, escopo e se ele bate com o filtro (o texto de cada select escolhido está no escopo)
const estadoLayout = page => page.evaluate(() => {
  const vis = el => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const sels = ['fgc', 'fsv', 'frota'].filter(id => vis(document.getElementById(id)));
  const esc = document.querySelector('#sub .subEsc');
  const escopo = esc.textContent.replace(/^ · /, '');
  const faltam = sels.map(id => document.getElementById(id)).filter(s => s.value).map(s => {
    const t = s.selectedOptions[0].textContent.replace(/ · sem dados$/, '');
    // grupo no Total: "Total (GC.IT + GC.MO)" -> "GC.IT + GC.MO"; rota: "Rota G211"
    return (t.match(/^Total \((.*)\)$/) || [, t])[1];
  }).filter(t => !escopo.includes(t));
  return {sels, escopo, escVisivel: vis(esc), faltam, lado: getComputedStyle(document.querySelector('.lado')).position === 'fixed',
          fim: document.querySelector('.barra').getBoundingClientRect().bottom,
          rolagem: document.documentElement.scrollWidth > document.documentElement.clientWidth};
});

describe('Parte U — layout: painel lateral no PC e topo compacto no celular (Etapa 3)', {skip: pular}, () => {
  for(const largura of [1000, 1440]){
    test(`${largura} px: painel lateral fixo com os itens na ordem; conteúdo à direita na largura da tela; sem rolagem lateral`, async () => {
      const {page, ctx, erros} = await abre('inc', {largura, altura: 900, entrar: {perfil: 'gc', gc: 'IT+MO'}});
      await page.evaluate(() => document.fonts.ready);
      const r = await page.evaluate(() => {
        const b = s => document.querySelector(s).getBoundingClientRect();
        const lado = document.querySelector('.lado'), cs = getComputedStyle(lado);
        const vis = s => [...document.querySelectorAll(s)].filter(e => e.getClientRects().length > 0);
        const tabs = vis('.tab');
        const ref = v => { const s = document.createElement('span'); s.style.color = `var(${v})`; document.body.appendChild(s);
          const c = getComputedStyle(s).color; s.remove(); return c; };
        return {pos: cs.position, w: b('.lado').width, h: b('.lado').height, left: b('.lado').left, bg: cs.backgroundColor, preto: ref('--preto'),
                padBody: getComputedStyle(document.body).paddingLeft, wrapL: b('.wrap').left, wrapMax: getComputedStyle(document.querySelector('.wrap')).maxWidth,
                ordem: ['#ladoMenu', '.lado .marca', '.lado h1', '#sub', '.sFil', '#fgc', '.sTab', '.tabs', '#ritmo', '.topoBtns', '#ladoCred']
                  .map(s => [s, Math.round(b(s).top), Math.round(b(s).bottom)]),
                semCaixa: ['.topo', '.barra', '.topo .hd', '.barra .hd'].map(s => getComputedStyle(document.querySelector(s)).display),
                tabs: tabs.map(t => ({g: t.dataset.g, top: Math.round(t.getBoundingClientRect().top), left: Math.round(t.getBoundingClientRect().left),
                  ico: !!t.querySelector('svg.ico') && t.querySelector('svg.ico').getClientRects().length > 0, title: t.title,
                  on: t.classList.contains('on'), bg: getComputedStyle(t).backgroundColor, txt: t.textContent})),
                vermelho: ref('--vermelho'),
                cred: document.getElementById('ladoCred').textContent, creditos: CONFIG.CREDITOS,
                ritmo: vis('#ritmo .ritLongo').length, ritCurto: vis('#ritmo .ritCurto').length,
                rotulos: vis('.lado .rotBtn').map(e => e.textContent), marca: vis('.lado .marca').length};
      });
      assert.equal(r.pos, 'fixed');
      assert.equal(r.w, LADO_ABERTO);
      assert.equal(r.h, 900, 'altura da tela');
      assert.equal(r.left, 0);
      assert.equal(r.bg, r.preto);
      assert.equal(r.padBody, `${LADO_ABERTO}px`);
      assert.ok(r.wrapL >= LADO_ABERTO, `conteúdo em ${r.wrapL}`);
      assert.equal(r.wrapMax, 'none');
      assert.deepEqual(r.semCaixa, ['contents', 'contents', 'contents', 'contents']);
      // menu -> marca -> título -> mês/atualização/escopo -> Filtro -> seletores -> Painéis -> abas -> ritmo -> ↻ e casa -> créditos
      for(let i = 1; i < r.ordem.length; i++)
        assert.ok(r.ordem[i][1] >= r.ordem[i - 1][2] - .5, `${r.ordem[i - 1][0]} antes de ${r.ordem[i][0]}: ${JSON.stringify(r.ordem)}`);
      assert.ok(r.tabs.length >= 4);
      assert.equal(new Set(r.tabs.map(t => t.left)).size, 1, 'abas na vertical');
      assert.equal(new Set(r.tabs.map(t => t.top)).size, r.tabs.length);
      for(const t of r.tabs){
        assert.ok(t.ico, `${t.g}: ícone`);
        assert.equal(t.title, t.txt, `${t.g}: title`);
        if(t.on) assert.equal(t.bg, r.vermelho, 'aba ativa em --vermelho');
      }
      assert.equal(r.tabs.filter(t => t.on).length, 1);
      assert.equal(r.cred, r.creditos);
      assert.equal(r.ritmo, 2, 'caixa de ritmo de hoje (as duas linhas)');
      assert.equal(r.ritCurto, 0);
      assert.deepEqual(r.rotulos, ['Atualizar', 'Entrada']);
      assert.equal(r.marca, 1);
      for(const aba of ['VOLUME', 'ICS_GC', 'NOVOS_NEG', 'INCENTIVO']){
        await page.click(`.tab[data-g="${aba}"]`);
        assert.equal(await page.evaluate(() => aba), aba);
        assert.ok(await semRolagemLateral(page), `${aba}: rolagem lateral`);
        // os cards não passam por baixo do painel
        assert.ok(await page.evaluate(l => [...document.querySelectorAll('#lista .ind, .cards .card, .rsBox, .rodape')]
          .every(el => el.getBoundingClientRect().left >= l), LADO_ABERTO), `${aba}: conteúdo sob o painel`);
      }
      await medidas(page);
      assert.deepEqual(await page.evaluate(() => __vis.estouros('.lado')), []);
      assert.deepEqual(erros, []);
      await ctx.close();
    });
  }

  test('recolher e expandir: só ícones com title, conteúdo e gaveta acompanham, estado guardado no aparelho', async () => {
    const {page, ctx, erros} = await abre('normal', {largura: 1440, altura: 900});
    const sessao = await page.evaluate(() => localStorage.getItem('drotas_sessao'));
    assert.equal(await page.getAttribute('#ladoMenu', 'aria-expanded'), 'true');
    await page.click('#ladoMenu');
    const estado = () => page.evaluate(() => {
      const vis = s => [...document.querySelectorAll(s)].filter(e => e.getClientRects().length > 0);
      return {w: document.querySelector('.lado').getBoundingClientRect().width, pad: getComputedStyle(document.body).paddingLeft,
              wrapL: document.querySelector('.wrap').getBoundingClientRect().left,
              textos: ['.lado h1', '#sub', '.ladoSec', '.filtros', '#ritmo', '#ladoCred', '.tab > span', '.rotBtn', '.marca > span']
                .filter(s => vis(s).length),
              icones: vis('.tab svg.ico, #btnRecarga svg, #btnCasa svg, #ladoMenu svg').length,
              titles: vis('.tab, #btnRecarga, #btnCasa, #ladoMenu').map(e => e.title),
              exp: document.getElementById('ladoMenu').getAttribute('aria-expanded'),
              label: document.getElementById('ladoMenu').getAttribute('aria-label'),
              guardado: localStorage.getItem('drotas_lado'), sessao: localStorage.getItem('drotas_sessao'),
              rolagem: document.documentElement.scrollWidth > document.documentElement.clientWidth};
    });
    let e = await estado();
    assert.equal(e.w, LADO_RECOLHIDO);
    assert.equal(e.pad, `${LADO_RECOLHIDO}px`);
    assert.ok(e.wrapL >= LADO_RECOLHIDO && e.wrapL < LADO_RECOLHIDO + 50);
    assert.deepEqual(e.textos, [], 'recolhido: só os ícones');
    const nTabs = await page.$$eval('.tab', ts => ts.filter(t => !t.hidden).length);
    assert.equal(e.icones, nTabs + 3);
    assert.ok(e.titles.every(Boolean), `title em todos os ícones: ${e.titles}`);
    assert.deepEqual([e.exp, e.label, e.guardado, e.sessao], ['false', 'Abrir o painel', 'recolhido', sessao]);
    assert.equal(e.rolagem, false);
    // as abas funcionam recolhidas; a gaveta começa à direita do painel recolhido
    await page.click('.tab[data-g="VOLUME"]');
    assert.equal(await page.evaluate(() => aba), 'VOLUME');
    await page.click('#lista .ind[data-k]');
    await page.waitForFunction(() => document.getElementById('drw').classList.contains('on'));
    const drw = await page.evaluate(() => ({left: getComputedStyle(document.getElementById('drw')).left,
      x: document.getElementById('drw').getBoundingClientRect().left}));
    assert.equal(drw.left, `${LADO_RECOLHIDO}px`);
    assert.ok(drw.x >= LADO_RECOLHIDO);
    await page.keyboard.press('Escape');
    // recarregou: continua recolhido, no mesmo acesso
    await page.reload();
    await esperaCarga(page);
    e = await estado();
    assert.deepEqual([e.w, e.exp, e.sessao], [LADO_RECOLHIDO, 'false', sessao]);
    assert.equal(await page.evaluate(() => document.getElementById('entrada').hidden), true, 'mesmo acesso, sem entrada');
    // expande
    await page.click('#ladoMenu');
    e = await estado();
    assert.deepEqual([e.w, e.pad, e.exp, e.label, e.guardado, e.sessao], [LADO_ABERTO, `${LADO_ABERTO}px`, 'true', 'Recolher o painel', 'aberto', sessao]);
    assert.ok(e.textos.includes('.lado h1') && e.textos.includes('.filtros'));
    // sem armazenamento no aparelho: recolhe do mesmo jeito, sem erro
    await page.evaluate(() => { Object.defineProperty(window, 'localStorage', {get(){ throw new Error('bloqueado'); }}); });
    await page.click('#ladoMenu');
    assert.equal((await page.evaluate(() => document.querySelector('.lado').getBoundingClientRect().width)), LADO_RECOLHIDO);
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('390 px: o estado recolhido guardado não muda o topo do celular', async () => {
    const {page, ctx, erros} = await abre('normal', {largura: 390, altura: 844, armazenado: {drotas_lado: 'recolhido'}});
    const r = await page.evaluate(() => ({rec: document.body.classList.contains('recolhido'),
      lado: getComputedStyle(document.querySelector('.lado')).display, menu: getComputedStyle(document.getElementById('ladoMenu')).display,
      h1: document.querySelector('.topo h1').getClientRects().length, filtros: document.querySelector('.filtros').getClientRects().length,
      pad: getComputedStyle(document.body).paddingLeft, fim: document.querySelector('.barra').getBoundingClientRect().bottom}));
    assert.deepEqual([r.rec, r.lado, r.menu, r.h1, r.filtros, r.pad], [true, 'contents', 'none', 1, 1, '0px']);
    assert.ok(r.fim <= LIMITE_CABECALHO_390);
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('teclado: menu, seletores, abas, ↻ e casa recebem foco (aberto e recolhido); Enter recolhe e expande', async () => {
    const {page, ctx, erros} = await abre('normal', {largura: 1440, altura: 900});
    const percorre = async () => {
      // começa do início da página (o ponto de partida do Tab fica no body)
      await page.evaluate(() => { document.body.tabIndex = -1; document.body.focus(); document.body.removeAttribute('tabindex'); });
      const vistos = [];
      for(let i = 0; i < 40; i++){
        await page.keyboard.press('Tab');
        const a = await page.evaluate(() => { const el = document.activeElement;
          return el ? (el.id || (el.classList.contains('tab') ? 'tab:' + el.dataset.g : el.tagName)) : ''; });
        if(vistos.includes(a)) break;
        vistos.push(a);
        if(a === 'q') break;           // chegou à busca do conteúdo
      }
      return vistos;
    };
    let v = await percorre();
    for(const id of ['ladoMenu', 'btnRecarga', 'btnCasa', 'fsv', 'frota', 'tab:VOLUME', 'tab:ICS_GC', 'tab:NOVOS_NEG'])
      assert.ok(v.includes(id), `${id} no Tab: ${v}`);
    // foco visível no painel escuro
    await page.focus('.tab[data-g="VOLUME"]');
    await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab');
    const contorno = await page.evaluate(() => { const cs = getComputedStyle(document.activeElement);
      return [document.activeElement.dataset.g, cs.outlineStyle, cs.outlineWidth]; });
    assert.deepEqual(contorno, ['VOLUME', 'solid', '2px']);
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => aba), 'VOLUME', 'Enter na aba');
    // Enter no menu recolhe; recolhido, o Tab ainda chega às abas, ao ↻ e à casa; Enter de novo expande
    await page.focus('#ladoMenu');
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => document.body.classList.contains('recolhido')), true);
    v = await percorre();
    for(const id of ['ladoMenu', 'btnRecarga', 'btnCasa', 'tab:VOLUME', 'tab:ICS_GC'])
      assert.ok(v.includes(id), `recolhido: ${id} no Tab: ${v}`);
    assert.ok(!v.includes('fsv') && !v.includes('frota'), 'recolhido: seletores fora do Tab (ocultos)');
    await page.focus('#ladoMenu');
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => document.body.classList.contains('recolhido')), false);
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  for(const largura of [390, 1440]){
    test(`${largura} px: escopo no ${largura < 1000 ? 'topo' : 'painel lateral'} igual ao filtro em cada perfil (com o grupo no Total); só os seletores do perfil`, async () => {
      for(const c of PERFIS_LAYOUT){
        const {page, ctx, erros} = await abre(c.dados, {largura, altura: 900, entrar: c.entrar});
        await page.evaluate(() => document.fonts.ready);
        const r = await estadoLayout(page);
        assert.equal(r.lado, largura >= 1000);
        assert.deepEqual(r.sels, c.sels, `${c.nome}: seletores`);
        assert.match(r.escopo, c.esc, c.nome);
        assert.deepEqual(r.faltam, [], `${c.nome}: escopo "${r.escopo}" diferente do filtro`);
        // no celular o escopo da Diretoria sai do topo (o seletor logo abaixo mostra); nos perfis travados ele fica
        assert.equal(r.escVisivel, largura >= 1000 || c.nome !== 'Diretoria', `${c.nome}: escopo visível`);
        assert.equal(r.rolagem, false, `${c.nome}: rolagem lateral`);
        if(largura < 1000) assert.ok(r.fim <= LIMITE_CABECALHO_390, `${c.nome}: topo ${r.fim} px > ${LIMITE_CABECALHO_390}`);
        assert.equal(await page.isVisible('.rsBox'), c.nome !== 'Rota', `${c.nome}: Resumo`);
        // mexendo no filtro, o escopo acompanha
        if(c.sels.includes('fgc')){
          const v = await page.$$eval('#fgc option', os => os.filter(o => !o.disabled).map(o => o.value).filter(Boolean)[1]);
          await page.selectOption('#fgc', v);
          const s = await estadoLayout(page);
          assert.deepEqual(s.faltam, [], `${c.nome} -> ${v}: escopo "${s.escopo}"`);
          assert.match(s.escopo, new RegExp(`GC\\.${v}\\b`));
        }
        if(c.sels.includes('fsv')){
          const v = await page.$$eval('#fsv option', os => os.map(o => o.value).filter(Boolean)[0]);
          await page.selectOption('#fsv', v);
          assert.deepEqual((await estadoLayout(page)).faltam, [], `${c.nome} -> ${v}`);
        }
        if(c.sels.includes('frota')){
          const v = await page.$$eval('#frota option', os => os.map(o => o.value).filter(Boolean)[0]);
          await page.selectOption('#frota', v);
          const s = await estadoLayout(page);
          assert.deepEqual(s.faltam, [], `${c.nome} -> rota ${v}`);
          if(largura < 1000) assert.ok(s.fim <= LIMITE_CABECALHO_390, `${c.nome} rota ${v}: topo ${s.fim} px`);
        }
        assert.deepEqual(erros, []);
        await ctx.close();
      }
    });
  }

  for(const largura of [360, 390]){
    test(`${largura} px: topo compacto (título + ↻ e casa; mês + "● dd/mm hh:mm"; "Dia útil x/n (p%) · ritmo hoje h%")`, async () => {
      const {page, ctx, erros} = await abre('normal', {largura, altura: 844});
      await page.evaluate(() => document.fonts.ready);
      await medidas(page);
      const r = await page.evaluate(() => {
        const b = s => document.querySelector(s).getBoundingClientRect();
        const vis = s => [...document.querySelectorAll(s)].filter(e => e.getClientRects().length > 0);
        const tag = document.getElementById('tagUpdEl');
        return {marca: vis('.topo .marca').length, h1: b('.topo h1'), btns: b('.topoBtns'), linhasH1: Math.round(b('.topo h1').height / 32),
                ritmo: document.getElementById('ritmo').innerText.trim(), linhasRitmo: Math.round(b('#ritmo').height / parseFloat(getComputedStyle(document.getElementById('ritmo')).lineHeight)),
                esperado: `Dia útil ${P.DIA_ONTEM}/${P.TOTAL_DIAS_UTEIS} (${P.PACE_ONTEM_PCT}%) · ritmo hoje ${Math.round(P.DIA_HOJE / P.TOTAL_DIAS_UTEIS * 100)}%`,
                tag: tag ? vis('#tagUpdEl > span:not(.pt)').map(e => e.textContent) : null, title: tag && tag.title,
                upd: ONLINE.updatedAt, texto: (statusAtualizado() || {}).texto, mes: P.MES_LABEL,
                sub: document.getElementById('sub').innerText.replace(/\s+/g, ' ').trim(),
                ladoItens: vis('.ladoMenu, .ladoSec, .ladoCred, .tab .ico, .rotBtn').length,
                est: __vis.estouros('.topo, .barra')};
      });
      assert.equal(r.marca, 0, 'sem a linha da marca');
      assert.equal(r.linhasH1, 1);
      assert.ok(Math.abs(r.btns.top - r.h1.top) < 1 && r.btns.left >= r.h1.left, '↻ e casa na linha do título');
      assert.equal(r.ritmo, r.esperado);
      assert.equal(r.linhasRitmo, 1);
      const [d, h] = r.upd.split('T');
      assert.deepEqual(r.tag, [`${d.slice(8, 10)}/${d.slice(5, 7)} ${h.slice(0, 5)}`], 'etiqueta curta');
      assert.equal(r.title, r.texto, 'texto inteiro no title');
      assert.ok(r.sub.startsWith(r.mes), r.sub);
      assert.equal(r.ladoItens, 0, 'itens só do painel lateral ocultos');
      assert.deepEqual(r.est, []);
      assert.ok(await semRolagemLateral(page));
      assert.deepEqual(erros, []);
      await ctx.close();
    });
  }

  for(const largura of [390, 1440]){
    test(`${largura} px: ↻ atualiza mantendo o acesso e o painel; casa volta para a entrada; faixa de versão nova visível (os dois fundos)`, async () => {
      for(const tema of ['preta', 'branca']){
        const {page, ctx, erros} = await abreVersao({srv: {versao: 'bbbbbbbbbbbb'}, largura, altura: 844,
          entrar: {perfil: 'sv', gc: 'G2', sv: '1'}, armazenado: {drotas_entrada: tema, drotas_lado: 'recolhido'}});
        await page.waitForFunction(() => !document.getElementById('aviso').hidden);
        assert.ok((await faixaLivre(page)).ok, `${tema}: faixa visível e sem cobrir (recolhido)`);
        assert.equal(await page.evaluate(() => document.getElementById('aviso').classList.contains('branca')), tema === 'branca');
        if(largura >= 1000){
          await page.click('#ladoMenu');                // aberto: a faixa continua livre
          assert.ok((await faixaLivre(page)).ok, `${tema}: faixa visível e sem cobrir (aberto)`);
        }
        const antes = await page.evaluate(() => ({s: localStorage.getItem('drotas_sessao'), l: localStorage.getItem('drotas_lado'),
          sel: JSON.stringify(sel)}));
        await page.evaluate(() => { window.__marca = 1; });
        const carregou = page.waitForEvent('load');
        await page.click('#btnRecarga');
        await carregou;
        await esperaCarga(page);
        const depois = await page.evaluate(() => ({s: localStorage.getItem('drotas_sessao'), l: localStorage.getItem('drotas_lado'),
          sel: JSON.stringify(sel), marca: window.__marca, entrada: document.getElementById('entrada').hidden,
          perfil: ACESSO && ACESSO.perfil}));
        assert.equal(depois.marca, undefined, 'recarregou');
        assert.deepEqual([depois.s, depois.l, depois.sel, depois.entrada, depois.perfil], [antes.s, antes.l, antes.sel, true, 'sv'],
          `${tema}: mesmo acesso e mesmo painel`);
        await page.click('#btnCasa');
        assert.equal(await page.isVisible('#entrada'), true, 'casa: entrada');
        assert.equal(await page.evaluate(() => localStorage.getItem('drotas_sessao')), null, 'casa apaga o acesso');
        assert.equal(await page.evaluate(() => localStorage.getItem('drotas_lado')), antes.l, 'casa não mexe no painel lateral');
        assert.deepEqual(semErrosDeRede(erros), []);
        await ctx.close();
      }
    });
  }
});

/* ---------- Parte R — Painel de Ritmo em PDF (só dados reais) ---------- */
/* montaRitmo(P, escopo) roda num contexto vm (sem DOM) em que ONLINE, puxaOnline e os campos de hoje (REVERTIDO_HOJE,
   OPORTUNIDADE_HOJE, SEM_COMPRA_HOJE, revertidoHoje, oportunidadeHoje, semDadoHoje) lançam erro ao serem lidos. */
const PROIBIDOS_RITMO = ['REVERTIDO_HOJE', 'OPORTUNIDADE_HOJE', 'SEM_COMPRA_HOJE', 'revertidoHoje', 'oportunidadeHoje', 'semDadoHoje'];
function vigiaRitmo(o){
  return new Proxy(o, {get(t, k, r){
    if(PROIBIDOS_RITMO.includes(k)) throw new Error(`Painel de Ritmo leu ${String(k)}`);
    const v = Reflect.get(t, k, r);
    return v && typeof v === 'object' ? vigiaRitmo(v) : v;
  }});
}
function contextoRitmo(){
  const vm = require('node:vm');
  const ctx = vm.createContext({console});
  for(const k of ['ONLINE', 'puxaOnline', 'REVERTIDO_HOJE', 'OPORTUNIDADE_HOJE', 'SEM_COMPRA_HOJE', 'document', 'window', 'sel', 'ACESSO'])
    Object.defineProperty(ctx, k, {get(){ throw new Error(`Painel de Ritmo leu ${k}`); }});
  const js = ['config.js', 'nucleo.js', 'ritmo.js'].map(f => fs.readFileSync(path.join(FRONT, 'js', f), 'utf-8')).join('\n;\n');
  vm.runInContext(js + '\n;globalThis.montaRitmo = montaRitmo; globalThis.NUCLEO = NUCLEO;', ctx);
  return ctx;
}
// sintético normal (gerado aqui se o before() do arquivo não rodou: a Parte R sem navegador só precisa do Python)
let _sinteticoRitmo = null;
function payloadRitmo(){
  if(!_sinteticoRitmo){
    let dir = DADOS.normal;
    if(!dir){
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drotas-ritmo-'));
      execFileSync('python3', [path.join(FRONT, 'tests', 'sintetico.py'), dir], {cwd: RAIZ});
    }
    _sinteticoRitmo = fs.readFileSync(path.join(dir, 'payload.json'), 'utf-8');
  }
  return JSON.parse(_sinteticoRitmo);
}
const temPython = (() => { try { execFileSync('python3', ['-c', 'import zoneinfo'], {stdio: 'ignore'}); return true; } catch(e) { return false; } })();
// nó de uma rota no payload
const noRitmo = (p, r) => { for(const gc in p.DATA) for(const sv in p.DATA[gc]) if(r in p.DATA[gc][sv]) return p.DATA[gc][sv][r]; };
const COB_RITMO = ['CCTM 2L PET', 'KS TT', 'REFRI SABORES ZERO', 'POWERADE', 'KAPO', 'CERVEJAS', 'CERVEJAS 600ML RETORNAVEL',
  'EISENBAHN', 'ARTD KO', 'VENDAZERO'];
const VOL_RITMO = ['VOL REFRIGERANTES', 'VOL CERVEJAS', 'VOL STILL', 'VOL AGUA MINERAL', 'VOL DEST+ART+CND'];
// páginas do escopo, só os códigos (título sem o "Painel de Ritmo — " e sem o nome)
const codigos = m => m.paginas.map(pg => pg.titulo.replace('Painel de Ritmo — ', '').split(' · ')[0]);
// ritmo.js antes dos ajustes de Venda Zero e "Sem vendedor" (merge do PR #19), para conferir que o resto não mudou
const REF_RITMO = '73a215e';
const RITMO_ANTES = (() => { try { return execSync(`git show ${REF_RITMO}:frontend/js/ritmo.js`, {cwd: RAIZ,
  stdio: ['ignore', 'pipe', 'ignore']}).toString(); } catch(e) { return null; } })();
// esperado no sintético: GC + SV.X.1 + SV.X.2; AT com a SV.AT.3 (sem vendedor, rotas normais AT31/AT32); fora: SV.G1.5,
// SV.G2.5, SV.IT.3, SV.MO.3 (só Neutraliza), SV.AN.4 e SV.RV.3 (Neutraliza + virtuais), SV.G3.3 (oculta), SV.SL.EV ('-EV')
// escopo do filtro atual (ou o dado) -> nome e códigos das páginas, no navegador
const modeloRitmo = (page, escopo) => page.evaluate(e => {
  const m = montaRitmo(P, e || RT.escopoRitmo());
  return {nome: m.nome, codigos: m.paginas.map(pg => pg.titulo.replace('Painel de Ritmo — ', '').split(' · ')[0])};
}, escopo);
const paginasEsperadas = gc => ['GC.' + gc, `SV.${gc}.1`, `SV.${gc}.2`, ...(gc === 'AT' ? ['SV.AT.3'] : [])];

describe('Parte R — Painel de Ritmo: montaRitmo (função pura, sem navegador)', {skip: !temPython && 'sem Python'}, () => {
  const monta = (p, escopo) => JSON.parse(JSON.stringify(contextoRitmo().montaRitmo(vigiaRitmo(p), escopo)));

  test('não lê ONLINE nem os campos de hoje (getters que lançam) e não usa o DOM', () => {
    const p = payloadRitmo();
    const m = monta(p, {tipo: 'band', nome: 'BAND'});
    assert.equal(m.nome, 'BAND');
    assert.ok(m.paginas.length > 0);
    // controle: o vigia de fato lança quando alguém lê um campo de hoje
    assert.throws(() => vigiaRitmo(p).REVERTIDO_HOJE, /leu REVERTIDO_HOJE/);
    assert.throws(() => contextoRitmo().ONLINE, /leu ONLINE/);
  });

  test('escopo: Todas = GC + supervisões de cada gerência na ordem de GC_ATIVAS; gerência; grupo; supervisão', () => {
    const p = payloadRitmo();
    assert.deepEqual(codigos(monta(p, {tipo: 'band'})), p.GC_ATIVAS.filter(g => p.DATA[g]).flatMap(paginasEsperadas));
    assert.deepEqual(codigos(monta(p, {tipo: 'gc', gcs: ['G1'], nome: 'G1'})), ['GC.G1', 'SV.G1.1', 'SV.G1.2']);
    assert.deepEqual(codigos(monta(p, {tipo: 'gc', gcs: ['IT', 'MO'], nome: 'IT+MO'})),
                     ['GC.IT', 'SV.IT.1', 'SV.IT.2', 'GC.MO', 'SV.MO.1', 'SV.MO.2']);
    assert.deepEqual(codigos(monta(p, {tipo: 'gc', gcs: ['IT'], nome: 'IT'})), ['GC.IT', 'SV.IT.1', 'SV.IT.2']);
    assert.deepEqual(codigos(monta(p, {tipo: 'sv', gcs: ['G2'], sv: 'SV.G2.1', nome: 'SV.G2.1'})), ['SV.G2.1']);
    assert.deepEqual(codigos(monta(p, {tipo: 'sv', gcs: ['IT', 'MO'], sv: 'SV.MO.2', nome: 'SV.MO.2'})), ['SV.MO.2']);
    // gerência sem dados: ignorada
    assert.deepEqual(codigos(monta(p, {tipo: 'gc', gcs: ['PA', 'DI'], nome: 'PA+DI'})), ['GC.PA', 'SV.PA.1', 'SV.PA.2']);
    // SV.G3.3 (oculta) não tem página nem coluna
    assert.deepEqual(codigos(monta(p, {tipo: 'sv', gcs: ['G3'], sv: 'SV.G3.3'})), []);
  });

  test('Neutraliza, virtuais, "-EV" e SV.G3.3 fora das colunas e dentro do total do GC (mesma agregação dos cards)', () => {
    const p = payloadRitmo();
    const m = monta(p, {tipo: 'band'});
    const pag = t => m.paginas.find(pg => pg.titulo.includes('— ' + t));
    const cols = t => pag(t).colunas.map(c => c.codigo);
    assert.deepEqual(cols('GC.G3'), ['GC.G3', 'SV.G3.1', 'SV.G3.2']);
    assert.deepEqual(cols('GC.AN'), ['GC.AN', 'SV.AN.1', 'SV.AN.2']);
    assert.deepEqual(cols('GC.SL'), ['GC.SL', 'SV.SL.1', 'SV.SL.2']);
    assert.deepEqual(cols('GC.AT'), ['GC.AT', 'SV.AT.1', 'SV.AT.2', 'SV.AT.3']);
    assert.deepEqual(cols('SV.AT.3'), ['SV.AT.3', 'Rota AT31', 'Rota AT32']);          // a 431 (Neutraliza) fica fora
    assert.deepEqual(cols('SV.PO.2'), ['SV.PO.2', 'Rota PO21', 'Rota PO22']);          // a O21 (Neutraliza) fica fora
    assert.deepEqual(cols('SV.AT.1'), ['SV.AT.1', 'Rota 411', 'Rota AT12']);          // na AT a 411 é normal
    // o total do GC soma todas as rotas da gerência (Neutraliza, virtuais, eventuais e ocultas incluídas)
    const todas = gc => Object.values(p.DATA[gc]).flatMap(rs => Object.keys(rs));
    for(const [gc, extras] of [['G3', ['331']], ['AN', ['A41', 'A42', 'A43', 'A44']], ['SL', ['SL-EV']], ['G1', ['151']]]){
      const c0 = pag('GC.' + gc).colunas[0];
      assert.deepEqual(c0.rotas, todas(gc));
      for(const r of extras) assert.ok(c0.rotas.includes(r), `${gc}: ${r} no total`);
      // números = os do card (NUCLEO.agrega das mesmas rotas): Refrigerantes pela tendência e CCTM 2L Pet pelo ritmo
      let meta = 0, tend = 0, mc = 0, rc = 0;
      for(const r of todas(gc)){ const b = noRitmo(p, r).indicators['VOL REFRIGERANTES']; if(b && !b.unavailable){ meta += b.meta; tend += b.tendencia; }
        const c = noRitmo(p, r).indicators['CCTM 2L PET']; if(c && !c.unavailable){ mc += c.meta; rc += c.real; } }
      assert.equal(c0.vol[0].valor, Math.round(tend / meta * 100) + '%', gc);
      assert.equal(c0.cob[0].valor, Math.round(rc / mc * 100) + '%', gc);
    }
    // SL: o Real dos clientes em rota EV* (SL-EV) entra no total, não na soma das supervisões
    const sl = pag('GC.SL').colunas, semEv = Object.values(p.DATA.SL).flatMap(rs => Object.keys(rs)).filter(r => r !== 'SL-EV');
    let meta = 0, tend = 0;
    for(const r of semEv){ const b = noRitmo(p, r).indicators['VOL REFRIGERANTES']; meta += b.meta; tend += b.tendencia; }
    assert.notEqual(sl[0].vol[0].valor, Math.round(tend / meta * 100) + '%', 'SL-EV muda o total da SL');
  });

  test('"Puxando a média": a coluna com menos coberturas no ritmo; empate pelo menor código; sem linha se todas no ritmo', () => {
    const p = payloadRitmo();
    const puxa = (q, t) => monta(q, {tipo: 'gc', gcs: ['G1']}).paginas.find(pg => pg.titulo.includes('— ' + t)).puxa;
    // sintético: todas as colunas com 2/10 -> empate, o menor código
    assert.equal(puxa(p, 'GC.G1'), 'Puxando a média pra baixo: SV.G1.1 · Supervisor — 2/10 no ritmo');
    assert.equal(puxa(p, 'SV.G1.1'), 'Puxando a média pra baixo: Rota G111 — 2/10 no ritmo');
    // G111 com todas as coberturas no ritmo: puxa a G112; SV.G1.1 inteira no ritmo: o GC aponta a SV.G1.2
    const bate = (q, r) => { for(const k of COB_RITMO){ const b = noRitmo(q, r).indicators[k]; if(b.unavailable) continue;
      if(k === 'VENDAZERO') b.real = 0; else b.real = b.meta; } };
    bate(p, 'G111');
    assert.equal(puxa(p, 'SV.G1.1'), 'Puxando a média pra baixo: Rota G112 — 2/10 no ritmo');
    bate(p, 'G112');
    assert.equal(puxa(p, 'SV.G1.1'), '', 'todas no ritmo: sem a linha');
    assert.equal(puxa(p, 'GC.G1'), 'Puxando a média pra baixo: SV.G1.2 · Supervisor — 2/10 no ritmo');
    // supervisão com uma rota só: a coluna da rota existe e pode puxar a média
    const q = payloadRitmo(); delete q.DATA.G1['SV.G1.1'].G112;
    assert.equal(puxa(q, 'SV.G1.1'), 'Puxando a média pra baixo: Rota G111 — 2/10 no ritmo');
  });

  // n itens de cobertura com dado na rota, os primeiros `ok` no ritmo (Real = Meta; Venda Zero zerada), os demais abaixo
  // e o resto sem dado
  const poe = (q, r, ok, n) => COB_RITMO.forEach((k, i) => {
    const d = noRitmo(q, r).indicators;
    if(i >= n){ d[k] = {unavailable: true}; return; }
    const b = d[k] = {...d[k], meta: 10, unavailable: false};
    b.real = k === 'VENDAZERO' ? (i < ok ? 0 : 20) : (i < ok ? 10 : 0);
  });

  test('"Puxando a média" pela QUANTIDADE no ritmo, não pela proporção: 7/8 aponta antes de 8/10 (rotas e supervisões)', () => {
    // (a Venda Zero é o 10º item: sem dado em 7/8; abaixo do ritmo em 8/10)
    const p = payloadRitmo();
    poe(p, 'G112', 7, 8);          // 7/8 = 87,5%
    poe(p, 'G111', 8, 10);         // 8/10 = 80%: proporção menor, mas mais itens no ritmo
    const pg = monta(p, {tipo: 'sv', gcs: ['G1'], sv: 'SV.G1.1'}).paginas[0];
    const cont = c => pg.colunas.find(x => x.codigo === 'Rota ' + c).contaCob;
    assert.deepEqual([cont('G111'), cont('G112')], [{ok: 8, n: 10}, {ok: 7, n: 8}]);
    assert.equal(pg.puxa, 'Puxando a média pra baixo: Rota G112 — 7/8 no ritmo');
    // o mesmo entre supervisões, na página do GC: SV.G1.2 com 7/8 e SV.G1.1 com 8/10
    const q = payloadRitmo();
    for(const r of ['G111', 'G112']) poe(q, r, 8, 10);
    for(const r of ['G121', 'G122']) poe(q, r, 7, 8);
    const gc = monta(q, {tipo: 'gc', gcs: ['G1']}).paginas[0];
    assert.deepEqual(gc.colunas.slice(1).map(c => [c.codigo, c.contaCob.ok, c.contaCob.n]), [['SV.G1.1', 8, 10], ['SV.G1.2', 7, 8]]);
    assert.equal(gc.puxa, 'Puxando a média pra baixo: SV.G1.2 · Supervisor — 7/8 no ritmo');
    // empate na quantidade (7/8 contra 7/10): desempata quem tem mais itens fora do ritmo (7/10: 3 fora), não o código
    const e = payloadRitmo();
    poe(e, 'G111', 7, 8); poe(e, 'G112', 7, 10);
    assert.equal(monta(e, {tipo: 'sv', gcs: ['G1'], sv: 'SV.G1.1'}).paginas[0].puxa, 'Puxando a média pra baixo: Rota G112 — 7/10 no ritmo');
  });

  test('"Puxando a média": desempate pelo nº fora do ritmo (n - x), depois pelo código; sem linha só com todos em x = n', () => {
    // SV.PA.1 com 5 rotas (PA11..PA15; cópias da PA11 no sintético)
    const sv5 = () => { const q = payloadRitmo(), s = q.DATA.PA['SV.PA.1'];
      for(const r of ['PA13', 'PA14', 'PA15']) s[r] = JSON.parse(JSON.stringify(s.PA11));
      return q; };
    const pagSv = q => monta(q, {tipo: 'sv', gcs: ['PA'], sv: 'SV.PA.1'}).paginas[0];
    const contas = pg => pg.colunas.slice(1).map(c => `${c.codigo} ${c.contaCob.ok}/${c.contaCob.n}`);
    // caso real (SV.PA.1): P11 8/8, P12 8/10, P13 9/10, P14 9/10, P15 8/10 -> a P12 (a linha sumia: o empate ia para a P11)
    let q = sv5();
    [[8, 8], [8, 10], [9, 10], [9, 10], [8, 10]].forEach(([ok, n], i) => poe(q, `PA1${i + 1}`, ok, n));
    let pg = pagSv(q);
    assert.deepEqual(contas(pg), ['Rota PA11 8/8', 'Rota PA12 8/10', 'Rota PA13 9/10', 'Rota PA14 9/10', 'Rota PA15 8/10']);
    assert.equal(pg.puxa, 'Puxando a média pra baixo: Rota PA12 — 8/10 no ritmo');
    // x único menor: ganha mesmo com menos itens fora que outra (6/8: 2 fora; 7/10: 3 fora)
    q = sv5();
    [[9, 10], [6, 8], [7, 10], [8, 10], [9, 10]].forEach(([ok, n], i) => poe(q, `PA1${i + 1}`, ok, n));
    assert.equal(pagSv(q).puxa, 'Puxando a média pra baixo: Rota PA12 — 6/8 no ritmo');
    // empate de x com n diferentes: o de mais fora do ritmo (7/10 antes de 7/9 e 7/8)
    q = sv5();
    [[7, 8], [7, 9], [9, 10], [7, 10], [8, 10]].forEach(([ok, n], i) => poe(q, `PA1${i + 1}`, ok, n));
    assert.equal(pagSv(q).puxa, 'Puxando a média pra baixo: Rota PA14 — 7/10 no ritmo');
    // empate total (mesmo x e n): o menor código
    q = sv5();
    [[9, 10], [8, 10], [9, 10], [8, 10], [8, 10]].forEach(([ok, n], i) => poe(q, `PA1${i + 1}`, ok, n));
    assert.equal(pagSv(q).puxa, 'Puxando a média pra baixo: Rota PA12 — 8/10 no ritmo');
    // todos com x = n (ninguém fora do ritmo): sem a linha
    q = sv5();
    [[8, 8], [10, 10], [9, 9], [8, 8], [10, 10]].forEach(([ok, n], i) => poe(q, `PA1${i + 1}`, ok, n));
    assert.equal(pagSv(q).puxa, '');
    // página do GC (supervisões): SV.PA.1 8/8 e SV.PA.2 8/10 -> a SV.PA.2; as duas 8/8 -> sem a linha
    const gcPa = (a, b) => { const g = payloadRitmo();
      for(const r of ['PA11', 'PA12']) poe(g, r, ...a);
      for(const r of ['PA21', 'PA22']) poe(g, r, ...b);
      return monta(g, {tipo: 'gc', gcs: ['PA']}).paginas[0]; };
    let gc = gcPa([8, 8], [8, 10]);
    assert.deepEqual(contas(gc), ['SV.PA.1 8/8', 'SV.PA.2 8/10']);
    assert.equal(gc.puxa, 'Puxando a média pra baixo: SV.PA.2 · Supervisor — 8/10 no ritmo');
    assert.equal(gcPa([8, 9], [8, 9]).puxa, 'Puxando a média pra baixo: SV.PA.1 · Supervisor — 8/9 no ritmo');
    assert.equal(gcPa([8, 8], [8, 8]).puxa, '');
  });

  test('"Sem vendedor" no subtítulo da coluna e no título (maiúsculas, minúsculas, vazio); os demais nomes como antes', () => {
    const p = payloadRitmo();
    // sintético: SV.AT.3 = "ROTA SEM VENDEDOR"
    assert.equal(p.NOME_SUPERVISOR['SV.AT.3'], 'ROTA SEM VENDEDOR');
    const at = monta(p, {tipo: 'gc', gcs: ['AT']}).paginas;
    assert.equal(at.find(pg => pg.sv === 'SV.AT.3').titulo, 'Painel de Ritmo — SV.AT.3 · Sem vendedor');
    assert.deepEqual(at[0].colunas.find(c => c.codigo === 'SV.AT.3').nome, 'Sem vendedor');
    p.NOME_SUPERVISOR['SV.G1.1'] = 'rota sem vendedor';
    p.NOME_SUPERVISOR['SV.G1.2'] = '';
    noRitmo(p, 'G111').consultor = 'ROTA SEM VENDEDOR';
    noRitmo(p, 'G112').consultor = 'Rota Sem  Vendedor';
    noRitmo(p, 'G121').consultor = '';
    noRitmo(p, 'G122').consultor = 'JOSÉ CARLOS DA SILVA';
    const m = monta(p, {tipo: 'gc', gcs: ['G1']}).paginas;
    assert.deepEqual(m.map(pg => pg.titulo), ['Painel de Ritmo — GC.G1 · Goiânia 01', 'Painel de Ritmo — SV.G1.1 · Sem vendedor',
      'Painel de Ritmo — SV.G1.2 · Sem vendedor']);
    assert.deepEqual(m[0].colunas.map(c => c.nome), ['Goiânia 01', 'Sem vendedor', 'Sem vendedor']);
    assert.deepEqual(m[1].colunas.map(c => [c.codigo, c.nome]), [['SV.G1.1', 'Sem vendedor'], ['Rota G111', 'Sem vendedor'],
      ['Rota G112', 'Sem vendedor']]);
    assert.deepEqual(m[2].colunas.map(c => [c.codigo, c.nome]), [['SV.G1.2', 'Sem vendedor'], ['Rota G121', 'Sem vendedor'],
      ['Rota G122', 'José']]);
    // supervisão sem entrada em NOME_SUPERVISOR: também "Sem vendedor"; "Puxando" de supervisão usa o mesmo nome
    delete p.NOME_SUPERVISOR['SV.G1.1'];
    const g = monta(p, {tipo: 'gc', gcs: ['G1']}).paginas;
    assert.equal(g[1].titulo, 'Painel de Ritmo — SV.G1.1 · Sem vendedor');
    assert.equal(g[0].puxa, 'Puxando a média pra baixo: SV.G1.1 · Sem vendedor — 2/10 no ritmo');
  });

  test('páginas de supervisão inalteradas em relação à versão anterior (fora Venda Zero e "Sem vendedor")', {skip: !RITMO_ANTES && `sem o commit ${REF_RITMO}`}, () => {
    const vm = require('node:vm');
    const ctx = vm.createContext({console});
    vm.runInContext(['config.js', 'nucleo.js'].map(f => fs.readFileSync(path.join(FRONT, 'js', f), 'utf-8')).join('\n;\n') +
      '\n;' + RITMO_ANTES + '\n;globalThis.montaRitmo = montaRitmo;', ctx);
    const p = payloadRitmo();
    const nv = t => t.replace(/sem vendedor/gi, 'Sem vendedor');
    const limpa = m => m.paginas.map(pg => ({...pg, titulo: nv(pg.titulo), puxa: nv(pg.puxa), colunas: pg.colunas.map(c => ({...c, nome: undefined, cob: c.cob.slice(0, 9)}))}));
    for(const escopo of [{tipo: 'band', nome: 'BAND'}, {tipo: 'sv', gcs: ['G2'], sv: 'SV.G2.1'}])
      assert.deepEqual(JSON.parse(JSON.stringify(limpa(monta(p, escopo)))), JSON.parse(JSON.stringify(limpa(ctx.montaRitmo(p, escopo)))));
  });

  test('células: x / 5 e x / 10, verde/vermelho (tendência >= 100; onPace), Meta dia, Meta batida! (volume e cobertura), faltam, reverter e "—"', () => {
    const p = payloadRitmo();
    const r = 'G111', d = noRitmo(p, r).indicators, base = d['VOL REFRIGERANTES'];
    // os 5 macros com meta: tendência 120, 100, 99, 150% e 50%; meta do dia 12.345,6 / 0 / -3 / null / 7
    VOL_RITMO.forEach((k, i) => { d[k] = {...base, meta: 1000, real: 400, tendencia: [1200, 1000, 990, 1500, 500][i],
      metaDia: [12345.6, 0, -3, null, 7][i], unavailable: false}; });
    // coberturas: meta 100; Real 33 (= ritmo de ontem, 33%), 32, 100; KS TT sem meta (indisponível); Venda Zero 3/5
    Object.assign(d['CCTM 2L PET'], {meta: 100, real: 33}); Object.assign(d['REFRI SABORES ZERO'], {meta: 100, real: 32});
    Object.assign(d['POWERADE'], {meta: 100, real: 100}); d['KS TT'] = {unavailable: true};
    Object.assign(d['VENDAZERO'], {meta: 3, real: 5, unavailable: false});
    const pg = monta(p, {tipo: 'sv', gcs: ['G1'], sv: 'SV.G1.1'}).paginas[0];
    const c = pg.colunas.find(x => x.codigo === 'Rota ' + r);
    assert.deepEqual(c.vol.map(x => x && [x.ok, x.seta, x.valor, x.sub]), [
      [true, '▲', '120%', 'Meta dia 12.346'], [true, '▲', '100%', 'Meta batida!'], [false, '▼', '99%', 'Meta batida!'],
      [true, '▲', '150%', 'Meta dia —'], [false, '▼', '50%', 'Meta dia 7']]);
    assert.deepEqual(c.contaVol, {ok: 3, n: 5});
    const cob = k => c.cob[COB_RITMO.indexOf(k)];
    // 33% = PACE_ONTEM_PCT: no ritmo; a meta do dia é a da caixa do card (o que falta para o ritmo de hoje: 39 - 33)
    assert.equal(p.PACE_ONTEM_PCT, 33);
    assert.deepEqual(cob('CCTM 2L PET'), {ok: true, seta: '▲', valor: '33%', sub: 'Meta dia 6', falta: false});
    assert.deepEqual(cob('REFRI SABORES ZERO'), {ok: false, seta: '▼', valor: '32%', sub: 'faltam 7', falta: true});
    // meta do mês alcançada (Real >= Meta): "Meta batida!", também acima de 100%
    assert.deepEqual(cob('POWERADE'), {ok: true, seta: '▲', valor: '100%', sub: 'Meta batida!', falta: false});
    // no ritmo sem a meta batida e sem gap: a fatia do mês, teto(100 / 21)
    Object.assign(d['KAPO'], {meta: 100, real: 60});
    const kapo = monta(p, {tipo: 'sv', gcs: ['G1'], sv: 'SV.G1.1'}).paginas[0].colunas.find(x => x.codigo === 'Rota ' + r).cob[4];
    assert.deepEqual(kapo, {ok: true, seta: '▲', valor: '60%', sub: 'Meta dia 5', falta: false});
    Object.assign(d['KAPO'], {meta: 100, real: 130});
    assert.equal(monta(p, {tipo: 'sv', gcs: ['G1'], sv: 'SV.G1.1'}).paginas[0].colunas.find(x => x.codigo === 'Rota ' + r).cob[4].sub, 'Meta batida!');
    assert.equal(cob('KS TT'), null, 'sem meta: "—"');
    // Venda Zero: "reverter N" com N (o gap) como valor principal, sem percentual; ▼ vermelho com N > 0
    assert.deepEqual(cob('VENDAZERO'), {ok: false, seta: '▼', valor: '2', sub: 'reverter', falta: false});
    assert.equal(c.contaCob.n, 9);
    // Venda Zero zerada: verde
    Object.assign(d['VENDAZERO'], {meta: 3, real: 3});
    const vz = monta(p, {tipo: 'sv', gcs: ['G1'], sv: 'SV.G1.1'}).paginas[0].colunas.find(x => x.codigo === 'Rota ' + r).cob[9];
    assert.deepEqual(vz, {ok: true, seta: '▲', valor: '0', sub: 'reverter', falta: false});
    // supervisão e GC: o gap da mesma agregação dos cards (a Neutraliza não tem Venda Zero); nunca percentual
    Object.assign(d['VENDAZERO'], {meta: 3, real: 4300});
    const pgs = monta(p, {tipo: 'gc', gcs: ['G1']}).paginas;
    for(const pg of pgs) for(const col of pg.colunas){
      const x = col.cob[9];
      assert.ok(x && !/%/.test(x.valor) && x.sub === 'reverter' && /^\d{1,3}(\.\d{3})*$/.test(x.valor), `${pg.titulo} ${col.codigo}: ${JSON.stringify(x)}`);
      assert.equal(x.seta, x.ok ? '▲' : '▼');
      assert.equal(x.ok, x.valor === '0');
    }
    const g = pgs[0].colunas.find(x => x.codigo === 'SV.G1.1').cob[9];
    assert.deepEqual([g.ok, g.seta], [false, '▼']);
    const vz2 = noRitmo(p, 'G112').indicators.VENDAZERO;
    assert.equal(g.valor, Math.ceil(4300 + vz2.real - 3 - vz2.meta).toLocaleString('pt-BR'));
    // volume sem meta no escopo: "—"
    const q = payloadRitmo();
    assert.equal(monta(q, {tipo: 'sv', gcs: ['G1'], sv: 'SV.G1.1'}).paginas[0].colunas[0].vol[1], null, 'Cervejas sem meta');
  });

  test('cabeçalho: título com o primeiro nome, subtítulo com DIA_ONTEM_NOME (e sem ele), formato pt-BR', () => {
    const p = payloadRitmo();
    p.NOME_SUPERVISOR['SV.G1.1'] = 'MARIA DAS DORES';
    const m = monta(p, {tipo: 'gc', gcs: ['G1']});
    assert.equal(m.paginas[0].titulo, 'Painel de Ritmo — GC.G1 · Goiânia 01');
    assert.equal(m.paginas[1].titulo, 'Painel de Ritmo — SV.G1.1 · Maria');
    assert.deepEqual([p.DATA_ONTEM, p.DIA_ONTEM_NOME], ['2026-10-09', 'sexta-feira']);
    assert.equal(m.paginas[0].subtitulo, 'Gerência → Supervisões · outubro/26 · dados reais até sexta-feira 09/10 ' +
      '(dia útil 7/21, 33%) · faltas miram terça-feira (dia 8/21, 38%)');
    assert.equal(m.paginas[1].subtitulo, 'Supervisor → Rotas · outubro/26 · dados reais até sexta-feira 09/10 ' +
      '(dia útil 7/21, 33%) · faltas miram terça-feira (dia 8/21, 38%)');
    // payload antigo, sem DATA_ONTEM / DIA_ONTEM_NOME
    delete p.DATA_ONTEM; delete p.DIA_ONTEM_NOME;
    assert.equal(monta(p, {tipo: 'gc', gcs: ['G1']}).paginas[0].subtitulo, 'Gerência → Supervisões · outubro/26 · ' +
      'dados reais até o dia útil 7/21 (33%) · faltas miram terça-feira (dia 8/21, 38%)');
    // colunas: GC com o nome da praça, supervisão com o primeiro nome, rota com o primeiro nome do consultor
    const c = m.paginas[1].colunas.map(x => [x.codigo, x.nome, !!x.foco]);
    assert.deepEqual(c, [['SV.G1.1', 'Maria', true], ['Rota G111', 'Consultor', false], ['Rota G112', 'Consultor', false]]);
    assert.ok(m.paginas.every(pg => !pg.compacto));
  });
});

/* 9 colunas e números grandes: SV.G1.1 com 8 rotas (página da SV = 9 colunas) e a G2 com 8 supervisões (página do GC
   = 9 colunas); nomes compridos e valores de 6-7 dígitos. */
function montaRitmo9(p){
  const copia = o => JSON.parse(JSON.stringify(o));
  const g1 = p.DATA.G1['SV.G1.1'];
  for(let i = 3; i <= 8; i++){
    const d = copia(g1.G111); d.consultor = i === 8 ? 'ROTA SEM VENDEDOR' : `MAXIMILIANO ALCÂNTARA ${i}`;
    g1['G11' + i] = d;
  }
  const g2 = p.DATA.G2;
  for(const n of [3, 4, 6, 7, 8, 9]){
    g2[`SV.G2.${n}`] = {[`G2${n}1`]: copia(g2['SV.G2.1'].G211)};
    p.NOME_SUPERVISOR[`SV.G2.${n}`] = 'BARTOLOMEU SILVA';
  }
  for(const svs of [p.DATA.G1, p.DATA.G2]) for(const rs of Object.values(svs)) for(const d of Object.values(rs)){
    const base = d.indicators['VOL REFRIGERANTES'];
    if(!base || base.unavailable) continue;
    for(const k of VOL_RITMO){
      const b = d.indicators[k] = copia(base);
      for(const c of ['meta', 'real', 'tendencia', 'negRestante']) if(b[c] != null) b[c] *= 4000;
      b.metaDia = 1234567.4;
    }
    for(const [k, b] of Object.entries(d.indicators)) if(!/^VOL /.test(k) && !b.unavailable && b.meta != null){ b.meta *= 50000; b.real *= 7; }
  }
}

describe('Parte R — Painel de Ritmo no navegador', {skip: pular}, () => {
  before(() => {
    const dir = path.join(tmp, 'ritmo9');
    fs.mkdirSync(dir, {recursive: true});
    const p = JSON.parse(fs.readFileSync(path.join(DADOS.normal, 'payload.json'), 'utf-8'));
    montaRitmo9(p);
    fs.writeFileSync(path.join(dir, 'payload.json'), JSON.stringify(p));
    fs.copyFileSync(path.join(DADOS.normal, 'online.json'), path.join(dir, 'online.json'));
    DADOS.ritmo9 = dir;
  });
  // bibliotecas simuladas: anota as páginas, o texto do botão a cada página (progresso) e o tamanho do que foi capturado
  const SIMULA_RITMO = () => {
    window.__rt = {paginas: [], botao: [], capturas: [], props: null, imgs: 0};
    window.html2canvas = async (el, op) => {
      const r = el.getBoundingClientRect();
      window.__rt.botao.push(document.getElementById('btnRitmo').textContent);
      window.__rt.capturas.push({w: r.width, h: r.height, escala: op.scale, titulo: el.querySelector('h2').textContent,
        assinatura: el.textContent.includes(CONFIG.CREDITOS) || !!el.querySelector('.rs-rod')});
      const c = document.createElement('canvas'); c.width = 12; c.height = 7; return c;
    };
    window.jspdf = {jsPDF: function(o){ window.__rt.paginas.push(o.format);
      return {addPage(f){ window.__rt.paginas.push(f); }, addImage(){ window.__rt.imgs++; },
              setProperties(pr){ window.__rt.props = pr; }, output: () => new Blob(['%PDF'])}; }};
  };
  // durante a exportação, ONLINE e os campos de hoje lançam erro se lidos
  const BLINDA = () => {
    const erro = n => new Proxy({}, {get(){ throw new Error('Painel de Ritmo leu ' + n); }});
    window.__guarda = {ONLINE, REVERTIDO_HOJE, OPORTUNIDADE_HOJE, SEM_COMPRA_HOJE};
    ONLINE = erro('ONLINE'); REVERTIDO_HOJE = erro('REVERTIDO_HOJE'); OPORTUNIDADE_HOJE = erro('OPORTUNIDADE_HOJE');
    SEM_COMPRA_HOJE = erro('SEM_COMPRA_HOJE');
    for(const k of ['REVERTIDO_HOJE', 'OPORTUNIDADE_HOJE', 'SEM_COMPRA_HOJE'])
      Object.defineProperty(P, k, {configurable: true, get(){ throw new Error('Painel de Ritmo leu P.' + k); }});
  };
  const DESBLINDA = () => {
    ({ONLINE, REVERTIDO_HOJE, OPORTUNIDADE_HOJE, SEM_COMPRA_HOJE} = window.__guarda);
    for(const k of ['REVERTIDO_HOJE', 'OPORTUNIDADE_HOJE', 'SEM_COMPRA_HOJE'])
      Object.defineProperty(P, k, {configurable: true, writable: true, value: window.__guarda[k]});
  };
  const fimExport = page => page.waitForFunction(() => !document.getElementById('btnRitmo').hasAttribute('aria-busy') &&
    document.getElementById('rtAviso').textContent !== '');
  async function exportaSimulado(page, {aceita = true} = {}){
    await page.evaluate(SIMULA_RITMO);
    await page.evaluate(() => { document.getElementById('rtAviso').textContent = ''; });
    let dialogo = null;
    const responde = d => { dialogo = d.message(); aceita ? d.accept() : d.dismiss(); };
    page.on('dialog', responde);
    await page.evaluate(BLINDA);
    const baixou = page.waitForEvent('download', {timeout: 60000}).catch(() => null);
    await page.click('#btnRitmo');
    if(aceita) await fimExport(page); else await page.waitForTimeout(200);
    await page.evaluate(DESBLINDA);
    page.off('dialog', responde);
    const dl = aceita ? await baixou : null;
    return {dialogo, arquivo: dl && dl.suggestedFilename(), rt: await page.evaluate(() => window.__rt),
            aviso: await page.textContent('#rtAviso'), botao: await page.textContent('#btnRitmo')};
  }
  const modelo = modeloRitmo;

  test('botão ao lado de "Gerar resumo de vendas"; perfil Rota sem botão; fechamento desabilitado com a dica', async () => {
    for(const largura of [1280, 390]){
      const {page, ctx, erros} = await abre('normal', {largura, altura: 900, entrar: 'gc'});
      const r = await page.evaluate(() => {
        const a = document.getElementById('btnResumo'), b = document.getElementById('btnRitmo'), box = document.querySelector('.rsBox');
        const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
        return {irmao: a.nextElementSibling === b, texto: b.textContent, desab: b.disabled, ladoALado: Math.abs(ra.top - rb.top) < 2,
                abaixo: rb.top >= ra.bottom - 1, estouro: box.scrollWidth - box.clientWidth, cortado: b.scrollWidth - b.clientWidth,
                larguraPag: document.documentElement.scrollWidth - innerWidth, fs: getComputedStyle(b).fontSize,
                fsResumo: getComputedStyle(a).fontSize, fam: getComputedStyle(b).fontFamily};
      });
      assert.equal(r.irmao, true);
      assert.equal(r.texto, 'Painel de ritmo');
      assert.equal(r.desab, false);
      assert.ok(largura === 1280 ? r.ladoALado : r.abaixo, `${largura}: ${JSON.stringify(r)}`);
      assert.ok(r.estouro <= 0 && r.cortado <= 0 && r.larguraPag <= 0, `${largura}: sem estouro ${JSON.stringify(r)}`);
      assert.equal(r.fs, r.fsResumo, 'mesma escala do botão do Resumo (--fs-valor)');
      assert.match(r.fam, /^Inter,/);
      // fundo branco da entrada não muda a barra; perfil Rota: sem a barra (sem Resumo e sem o Painel de Ritmo)
      await vaiPara(page, {perfil: 'rota', gc: 'G1', rota: 'G111'});
      assert.equal(await page.isVisible('#btnRitmo'), false);
      await vaiPara(page, {perfil: 'sv', gc: 'G2', sv: '1'});
      assert.equal(await page.isVisible('#btnRitmo'), true);
      assert.deepEqual(erros, []);
      await ctx.close();
    }
    const {page, ctx, erros} = await abre('fech', {entrar: 'dir'});
    const f = await page.evaluate(() => { const b = document.getElementById('btnRitmo'); return {d: b.disabled, t: b.title, a: b.getAttribute('aria-label')}; });
    assert.deepEqual(f, {d: true, t: 'Indisponível durante o fechamento', a: 'Painel de ritmo — Indisponível durante o fechamento'});
    await page.evaluate(SIMULA_RITMO);
    await page.evaluate(() => RT.exporta());          // nem pela função: nada é gerado
    assert.deepEqual(await page.evaluate(() => window.__rt.paginas), []);
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('escopo pelo filtro: Diretoria, gerência, grupo (Total e uma delas), supervisão, Neutraliza', async () => {
    const {page, ctx, erros} = await abre('normal', {entrar: 'dir'});
    const p = JSON.parse(fs.readFileSync(path.join(DADOS.normal, 'payload.json'), 'utf-8'));
    let m = await modelo(page);
    assert.equal(m.nome, 'BAND');
    assert.deepEqual(m.codigos, p.GC_ATIVAS.filter(g => p.DATA[g]).flatMap(paginasEsperadas));
    await page.selectOption('#fgc', 'G3');
    assert.deepEqual(await modelo(page), {nome: 'G3', codigos: ['GC.G3', 'SV.G3.1', 'SV.G3.2']});
    await vaiPara(page, {perfil: 'gc', gc: 'G1'});
    assert.deepEqual(await modelo(page), {nome: 'G1', codigos: ['GC.G1', 'SV.G1.1', 'SV.G1.2']});
    await page.selectOption('#fsv', 'SV.G1.2');
    assert.deepEqual(await modelo(page), {nome: 'SV.G1.2', codigos: ['SV.G1.2']});
    await page.selectOption('#fsv', 'Neutraliza');      // a "Neutraliza" não tem página: vale a gerência
    assert.deepEqual(await modelo(page), {nome: 'G1', codigos: ['GC.G1', 'SV.G1.1', 'SV.G1.2']});
    await vaiPara(page, {perfil: 'gc', gc: 'IT+MO'});
    assert.deepEqual(await modelo(page), {nome: 'IT+MO', codigos: ['GC.IT', 'SV.IT.1', 'SV.IT.2', 'GC.MO', 'SV.MO.1', 'SV.MO.2']});
    await page.selectOption('#fgc', 'MO');
    assert.deepEqual(await modelo(page), {nome: 'MO', codigos: ['GC.MO', 'SV.MO.1', 'SV.MO.2']});
    await vaiPara(page, {perfil: 'sv', gc: 'G2', sv: '1'});
    assert.deepEqual(await modelo(page), {nome: 'SV.G2.1', codigos: ['SV.G2.1']});
    await page.selectOption('#frota', 'G212');           // rota no filtro da supervisão: a página da supervisão
    assert.deepEqual(await modelo(page), {nome: 'SV.G2.1', codigos: ['SV.G2.1']});
    await vaiPara(page, {perfil: 'rota', gc: 'G1', rota: 'G111'});
    assert.equal(await page.evaluate(() => RT.escopoRitmo()), null);
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('PDF (bibliotecas simuladas): nº de páginas = escopo, progresso, confirmação na Diretoria, nome e propriedades, sem online', async () => {
    const {page, ctx, erros} = await abre('normal', {entrar: {perfil: 'gc', gc: 'G1'}});
    const hoje = await page.evaluate(() => { const a = agoraSP(); return `${a.ano}${String(a.mes).padStart(2, '0')}${String(a.dia).padStart(2, '0')}`; });
    let r = await exportaSimulado(page);
    assert.equal(r.dialogo, null, 'gerência: sem confirmação');
    assert.equal(r.rt.paginas.length, 3);
    assert.equal(r.rt.imgs, 3);
    assert.deepEqual(r.rt.paginas, [[1280, 720], [1280, 720], [1280, 720]]);
    assert.deepEqual(r.rt.botao, ['Gerando 1/3', 'Gerando 2/3', 'Gerando 3/3']);
    assert.ok(r.rt.capturas.every(c => c.w === 1280 && c.h === 720 && c.escala === 1.5 && !c.assinatura), JSON.stringify(r.rt.capturas));
    assert.deepEqual(r.rt.capturas.map(c => c.titulo), ['Painel de Ritmo — GC.G1 · Goiânia 01',
      'Painel de Ritmo — SV.G1.1 · Supervisor', 'Painel de Ritmo — SV.G1.2 · Supervisor']);
    assert.equal(r.arquivo, `Painel_Ritmo_G1_${hoje}.pdf`);
    assert.deepEqual(r.rt.props, {title: 'Painel de Ritmo · G1', author: 'Comercial Bandeirantes'});
    assert.equal(r.aviso, `PDF salvo: Painel_Ritmo_G1_${hoje}.pdf`);
    assert.equal(r.botao, 'PDF salvo');
    assert.equal(await page.isDisabled('#btnRitmo'), false);
    assert.equal(await page.$('.rt-palco'), null, 'a página fora da tela é removida');
    // supervisão: uma página, arquivo com o código dela
    await page.selectOption('#fsv', 'SV.G1.2');
    r = await exportaSimulado(page);
    assert.deepEqual([r.rt.paginas.length, r.arquivo], [1, `Painel_Ritmo_SV.G1.2_${hoje}.pdf`]);
    // grupo
    await vaiPara(page, {perfil: 'gc', gc: 'IT+MO'});
    r = await exportaSimulado(page);
    assert.deepEqual([r.rt.paginas.length, r.arquivo, r.rt.props.title], [6, `Painel_Ritmo_IT+MO_${hoje}.pdf`, 'Painel de Ritmo · IT+MO']);
    // Diretoria "Todas": confirmação "Exportar N páginas?"; cancelar não gera nada
    await vaiPara(page, 'dir');
    const n = (await modelo(page)).codigos.length;
    r = await exportaSimulado(page, {aceita: false});
    assert.equal(r.dialogo, `Exportar ${n} páginas?`);
    assert.deepEqual(r.rt.paginas, []);
    r = await exportaSimulado(page);
    assert.equal(r.dialogo, `Exportar ${n} páginas?`);
    assert.equal(r.rt.paginas.length, n);
    assert.equal(r.rt.botao.at(-1), `Gerando ${n}/${n}`);
    assert.equal(r.arquivo, `Painel_Ritmo_BAND_${hoje}.pdf`);
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('sem conexão para as bibliotecas: mensagem clara, botão volta, nada trava', async () => {
    const {page, ctx, erros} = await abre('normal', {entrar: {perfil: 'gc', gc: 'G1'}});
    assert.equal(await page.evaluate(() => typeof window.html2canvas), 'undefined');
    await page.click('#btnRitmo');           // o cdnjs é abortado em abre()
    await fimExport(page);
    assert.equal(await page.textContent('#rtAviso'), 'Sem conexão para gerar o PDF');
    assert.equal(await page.textContent('#btnRitmo'), 'Sem conexão para gerar o PDF');
    assert.equal(await page.isDisabled('#btnRitmo'), false);
    assert.equal(await page.$('.rt-palco'), null);
    // a mensagem some e o botão volta ao texto normal; o painel segue respondendo
    await page.waitForFunction(() => document.getElementById('btnRitmo').textContent === 'Painel de ritmo', null, {timeout: 8000});
    await page.click('#lista .ind[data-k]');
    assert.ok(await page.isVisible('#drw.on'));
    assert.deepEqual(erros.filter(e => !/net::ERR_FAILED|cdnjs/.test(e)), []);
    await ctx.close();
  });

  test('desenho: páginas 1280x720, até 9 colunas sem texto cortado (modo compacto), números grandes, sem assinatura', async () => {
    const {page, ctx, erros} = await abre('ritmo9', {entrar: 'dir'});
    await page.evaluate(() => document.fonts.ready);
    for(const [escopo, alvo, ncols] of [[{tipo: 'gc', gcs: ['G1'], nome: 'G1'}, 'SV.G1.1', 9], [{tipo: 'gc', gcs: ['G2'], nome: 'G2'}, 'GC.G2', 9],
                                        [{tipo: 'gc', gcs: ['G1'], nome: 'G1'}, 'GC.G1', 3]]){
      const r = await page.evaluate(([escopo, alvo]) => {
        const pg = montaRitmo(P, escopo).paginas.find(x => x.titulo.includes('— ' + alvo));
        const palco = document.createElement('div'); palco.className = 'rt-palco'; palco.style.left = '0';
        palco.innerHTML = RT.desenhaPagina(pg); document.body.appendChild(palco); encaixa(palco);
        const el = palco.firstElementChild, b = el.getBoundingClientRect(), tab = el.querySelector('.rt-tab').getBoundingClientRect();
        const cortados = [...el.querySelectorAll('*')].filter(x => !/^(TR|TBODY|THEAD|TABLE|COLGROUP|COL)$/.test(x.tagName) &&
          (x.scrollWidth > x.clientWidth + 0.5 || x.scrollHeight > x.clientHeight + 1)).map(x => `${x.className}: ${x.textContent.slice(0, 30)}`);
        const fontes = [...el.querySelectorAll('[data-fit]')].map(x => parseFloat(getComputedStyle(x).fontSize));
        const out = {w: b.width, h: b.height, base: tab.bottom - b.top, cols: Number(el.dataset.colunas), compacto: el.classList.contains('rt-compacto'),
          cortados, fonteMin: Math.min(...fontes), texto: el.textContent, assinatura: el.textContent.includes(CONFIG.CREDITOS) || !!el.querySelector('.rs-rod'),
          verdes: el.querySelectorAll('td.rt-ok').length, vermelhos: el.querySelectorAll('td.rt-no').length,
          corPctNo: (el.querySelector('td.rt-no .rt-v') || {}).nodeType ? getComputedStyle(el.querySelector('td.rt-no .rt-v')).color : '',
          corMeta: getComputedStyle(el.querySelector('td .rt-s:not(.rt-falta)')).color,
          // linha da Venda Zero: "N" + "reverter", sem percentual; ▲ verde com 0, ▼ vermelho com N > 0
          vz: [...[...el.querySelectorAll('tbody tr')].find(tr => tr.firstElementChild.textContent === 'Venda Zero (KO)').children].slice(1)
            .map(td => [td.className, td.querySelector('.rt-v').textContent, (td.querySelector('.rt-s') || {}).textContent,
                        getComputedStyle(td.querySelector('.rt-v')).color])};
        palco.remove();
        return out;
      }, [escopo, alvo]);
      const onde = `${alvo} (${ncols} colunas)`;
      assert.deepEqual([r.w, r.h], [1280, 720], onde);
      assert.ok(r.base <= 720 - 8, `${onde}: a tabela cabe na página (${r.base})`);
      assert.equal(r.cols, ncols, onde);
      assert.equal(r.compacto, ncols >= 7, onde);
      assert.deepEqual(r.cortados, [], `${onde}: texto cortado`);
      assert.ok(r.fonteMin >= 7, `${onde}: fonte ${r.fonteMin}`);
      assert.equal(r.assinatura, false, onde);
      assert.ok(r.verdes > 0 && r.vermelhos > 0, onde);
      assert.equal(r.corPctNo, 'rgb(198, 40, 40)', `${onde}: % abaixo em vermelho`);
      assert.equal(r.corMeta, 'rgb(94, 94, 101)', `${onde}: meta sem cor de alerta`);
      assert.equal(r.vz.length, ncols, onde);
      for(const [cls, v, sub, cor] of r.vz){
        assert.ok(!v.includes('%') && sub === 'reverter', `${onde}: Venda Zero ${v} ${sub}`);
        assert.ok(cls === 'rt-ok' ? /^▲0$/.test(v) && cor === 'rgb(20, 107, 79)' : /^▼[\d.]+$/.test(v) && cor === 'rgb(198, 40, 40)', `${onde}: ${cls} ${v} ${cor}`);
      }
      for(const t of ['VOLUME — TENDÊNCIA DO MÊS', 'NA TENDÊNCIA', 'COBERTURAS — ICS GC', 'NO RITMO', 'COMERCIAL BANDEIRANTES',
                      'Refrigerantes', 'Dest+Art+Cnd', 'Refri Sab. Zero', 'Cerv. 600ml Ret.', 'Venda Zero (KO)'])
        assert.ok(r.texto.includes(t), `${onde}: ${t}`);
      if(alvo === 'SV.G1.1') assert.ok(r.texto.includes('Sem vendedor'), `${onde}: rota sem vendedor`);
      if(ncols === 9) assert.ok(/Meta dia 1\.234\.567/.test(r.texto) && /5 \/ 5/.test(r.texto), `${onde}: números grandes e x / 5`);
    }
    assert.deepEqual(erros, []);
    await ctx.close();
  });
});

describe('Parte R — Painel de Ritmo: PDF real (html2canvas + jsPDF)', {skip: pular || (!LIBS_PDF && 'html2canvas/jspdf não instalados (npm)')}, () => {
  test('nº de páginas, nenhuma em branco, 1280x720, propriedades; tamanho típico (1 GC com SVs e as 16)', async () => {
    const {page, ctx, erros} = await abre('normal', {entrar: {perfil: 'gc', gc: 'G1'}, altura: 900});
    await page.route(/cdnjs\.cloudflare\.com/, r => {
      const arq = /html2canvas/.test(r.request().url()) ? LIBS_PDF.html2canvas : LIBS_PDF.jspdf;
      r.fulfill({status: 200, contentType: 'text/javascript', body: fs.readFileSync(arq), headers: {'access-control-allow-origin': '*'}});
    });
    await page.evaluate(async () => {
      for(const lib of [CONFIG.CDN.html2canvas, CONFIG.CDN.jspdf]) await new Promise((ok, erro) => {
        const s = document.createElement('script'); s.src = lib.src; s.integrity = lib.integrity; s.crossOrigin = 'anonymous';
        s.onload = ok; s.onerror = erro; document.head.appendChild(s);
      });
      const add = window.jspdf.jsPDF.API.addImage;
      window.__imgs = [];
      window.jspdf.jsPDF.API.addImage = function(img, ...r){ window.__imgs.push(img); return add.call(this, img, ...r); };
    });
    for(const [nome, entrar] of [['G1', null], ['BAND', 'dir']]){
      if(entrar) await vaiPara(page, entrar);
      const n = (await modeloRitmo(page)).codigos.length;
      await page.evaluate(() => { window.__imgs = []; });
      if(nome === 'BAND') page.once('dialog', d => d.accept());     // só a Diretoria "Todas" confirma
      const [baixado] = await Promise.all([page.waitForEvent('download', {timeout: 300000}), page.click('#btnRitmo')]);
      const arq = await baixado.path(), bytes = fs.readFileSync(arq).toString('latin1');
      assert.match(bytes.slice(0, 5), /^%PDF-/, nome);
      assert.equal((bytes.match(/\/Type\s*\/Page\b(?!s)/g) || []).length, n, nome);
      // 1280x720 px = 960x540 pt
      const caixas = bytes.match(/\/MediaBox \[[^\]]*\]/g) || [];
      assert.ok(caixas.length === n && caixas.every(c => /0 0 960\.?0* 540\.?0*\]/.test(c)), `${nome}: ${caixas.slice(0, 2)}`);
      assert.match(bytes, /\/Title \(Painel de Ritmo/, nome);
      assert.match(bytes, /\/Author \(Comercial Bandeirantes\)/, nome);
      const tinta = await page.evaluate(imgs => Promise.all(imgs.map(src => new Promise(ok => {
        const im = new Image();
        im.onload = () => { const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
          const cx = c.getContext('2d'); cx.drawImage(im, 0, 0);
          const d = cx.getImageData(0, 0, im.width, im.height).data; let k = 0;
          for(let i = 0; i < d.length; i += 16) if(d[i] < 200 || d[i + 1] < 200 || d[i + 2] < 200) k++;
          ok([im.width, im.height, k / (d.length / 16)]); };
        im.src = src;
      }))), await page.evaluate(() => window.__imgs));
      assert.equal(tinta.length, n, nome);
      tinta.forEach(([w, h, t], i) => { assert.deepEqual([w, h], [1920, 1080], `${nome} página ${i + 1}`);
        assert.ok(t > 0.02, `${nome}: página ${i + 1} quase em branco (${t})`); });
      const kb = Math.round(fs.statSync(arq).size / 1024);
      console.log(`# Painel de Ritmo ${nome}: ${n} páginas, ${kb} KB (${Math.round(kb / n)} KB/página)`);
      await page.waitForFunction(() => !document.getElementById('btnRitmo').hasAttribute('aria-busy'));
    }
    assert.deepEqual(erros.filter(e => !/net::ERR_FAILED|cdnjs/.test(e)), []);
    await ctx.close();
  });
});
