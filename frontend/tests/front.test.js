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
const {SENHAS_TESTE, hashTeste, HASHES_TESTE, trocaHash, trocaLiberadas, digitaSenha, NOMES_TESTE, trocaNomes} =
  require('./senha_teste.js');

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
  // cobertura dos clientes de rotas eventuais (EV*): o 'inc' com a SL-EV coberta em CCTM 2L Pet (ICS GC), Campari (Novos
  // Negócios) e Heineken (Todos a Bordo; a SL é Full) e uma AP-EV só com Heineken (a AP não tem meta do item), como o
  // gerador monta (meta 0, só o Real)
  const evcob = path.join(tmp, 'evcob');
  fs.mkdirSync(evcob);
  const pe = JSON.parse(fs.readFileSync(path.join(DADOS.inc, 'payload.json'), 'utf-8'));
  const cobEv = (no, r, k, pvs) => {
    no.indicators[k] = {meta: 0, real: pvs.length, pct: null, onPace: false, gap: 0, unavailable: false};
    (pe.COBERTOS[r] = pe.COBERTOS[r] || {})[k] = pvs;
  };
  const slev = pe.DATA.SL['SV.SL.EV']['SL-EV'], apev = JSON.parse(JSON.stringify(slev));
  cobEv(slev, 'SL-EV', 'CCTM 2L PET', [99001, 99002]);
  cobEv(slev, 'SL-EV', 'CAMPARI', [99001]);
  cobEv(slev, 'SL-EV', 'INC HEINEKEN', [99003]);
  cobEv(apev, 'AP-EV', 'INC HEINEKEN', [99004]);
  pe.DATA.AP['SV.AP.EV'] = {'AP-EV': apev};
  pe.VIRTUAIS_ROTAS.push('AP-EV');
  pe.EVENTUAIS_ROTAS.push('AP-EV');
  fs.writeFileSync(path.join(evcob, 'payload.json'), JSON.stringify(pe));
  fs.copyFileSync(path.join(DADOS.inc, 'online.json'), path.join(evcob, 'online.json'));
  DADOS.evcob = evcob;
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
  // aba Executiva (Parte W): o cenário do Todos a Bordo com clientes sem compra no mês (o sintético compra tudo)
  const exec = path.join(tmp, 'exec');
  fs.mkdirSync(exec);
  const pex = JSON.parse(fs.readFileSync(path.join(DADOS.inc, 'payload.json'), 'utf-8'));
  const oex = JSON.parse(fs.readFileSync(path.join(DADOS.inc, 'online.json'), 'utf-8'));
  montaSemCompra(pex);
  fs.writeFileSync(path.join(exec, 'payload.json'), JSON.stringify(pex));
  fs.writeFileSync(path.join(exec, 'online.json'), JSON.stringify(oex));
  DADOS.exec = exec;
  // gavetas com barra de dias (Parte X): o 'exec' com dias de visita variados (montaDias; no sintético todos são "Seg - Qui")
  const dias = path.join(tmp, 'dias');
  fs.mkdirSync(dias);
  const pdi = JSON.parse(fs.readFileSync(path.join(DADOS.exec, 'payload.json'), 'utf-8'));
  montaDias(pdi);
  fs.writeFileSync(path.join(dias, 'payload.json'), JSON.stringify(pdi));
  fs.copyFileSync(path.join(DADOS.exec, 'online.json'), path.join(dias, 'online.json'));
  DADOS.dias = dias;
  const diasscm = path.join(tmp, 'diasscm');      // o mesmo, sem SEM_COMPRA_MES (payload de antes da Etapa 1)
  fs.mkdirSync(diasscm);
  delete pdi.SEM_COMPRA_MES;
  fs.writeFileSync(path.join(diasscm, 'payload.json'), JSON.stringify(pdi));
  fs.copyFileSync(path.join(DADOS.exec, 'online.json'), path.join(diasscm, 'online.json'));
  DADOS.diasscm = diasscm;
  // PDF do Resumo: 16 gerências e números grandes (montaGrande)
  const grande = path.join(tmp, 'grande');
  fs.mkdirSync(grande);
  const pgr = JSON.parse(fs.readFileSync(path.join(DADOS.normal, 'payload.json'), 'utf-8'));
  const ogr = JSON.parse(fs.readFileSync(path.join(DADOS.normal, 'online.json'), 'utf-8'));
  montaGrande(pgr, ogr);
  fs.writeFileSync(path.join(grande, 'payload.json'), JSON.stringify(pgr));
  fs.writeFileSync(path.join(grande, 'online.json'), JSON.stringify(ogr));
  DADOS.grande = grande;
  // Evolução contra o mês anterior (Parte Z): MES_ANTERIOR sintética (montaMesAnterior) sobre o 'exec', o 'grupo', o 'grande'
  // e o fechamento do Todos a Bordo ('incfech', com FECHADO: true)
  const semevo = path.join(tmp, 'semevo');      // o 'exec' sem MES_ANTERIOR (payload antigo ou com a consulta falhando)
  fs.mkdirSync(semevo);
  const pse = JSON.parse(fs.readFileSync(path.join(DADOS.exec, 'payload.json'), 'utf-8'));
  delete pse.MES_ANTERIOR;
  fs.writeFileSync(path.join(semevo, 'payload.json'), JSON.stringify(pse));
  fs.copyFileSync(path.join(DADOS.exec, 'online.json'), path.join(semevo, 'online.json'));
  DADOS.semevo = semevo;
  for(const [nome, origem, fechado] of [['evo', 'exec', false], ['evogrupo', 'grupo', false], ['evogrande', 'grande', false],
                                         ['evofech', 'incfech', true]]){
    const dir = path.join(tmp, nome);
    fs.mkdirSync(dir);
    const pe = JSON.parse(fs.readFileSync(path.join(DADOS[origem], 'payload.json'), 'utf-8'));
    montaMesAnterior(pe, fechado);
    fs.writeFileSync(path.join(dir, 'payload.json'), JSON.stringify(pe));
    fs.copyFileSync(path.join(DADOS[origem], 'online.json'), path.join(dir, 'online.json'));
    DADOS[nome] = dir;
  }
  // Parte AA: os 5 macros de volume com dado (o sintético só traz Refrigerantes e Água Mineral) e a evolução deles
  for(const [nome, origem, fechado] of [['vol5', 'exec', false], ['vol5fech', 'incfech', true]]){
    const dir = path.join(tmp, nome);
    fs.mkdirSync(dir);
    const pv = JSON.parse(fs.readFileSync(path.join(DADOS[origem], 'payload.json'), 'utf-8'));
    montaVolume5(pv);
    montaMesAnterior(pv, fechado);
    fs.writeFileSync(path.join(dir, 'payload.json'), JSON.stringify(pv));
    fs.copyFileSync(path.join(DADOS[origem], 'online.json'), path.join(dir, 'online.json'));
    DADOS[nome] = dir;
  }
  // Parte AI ("Abrir por" e busca da Executiva): o 'vol5' com Meta NEG e Real por cliente nos 5 macros e Key Accounts
  // fictícias (montaDim; o sintético só traz Refrigerantes por cliente e uma rede só)
  const dim = path.join(tmp, 'dim');
  fs.mkdirSync(dim);
  const pdm = JSON.parse(fs.readFileSync(path.join(DADOS.vol5, 'payload.json'), 'utf-8'));
  montaDim(pdm);
  fs.writeFileSync(path.join(dim, 'payload.json'), JSON.stringify(pdm));
  fs.copyFileSync(path.join(DADOS.vol5, 'online.json'), path.join(dim, 'online.json'));
  DADOS.dim = dim;
  browser = await pw.chromium.launch(CHROMIUM ? {executablePath: CHROMIUM} : {});
});
after(async () => {
  if(browser) await browser.close();
  if(tmp) fs.rmSync(tmp, {recursive: true, force: true});
});

const TIPOS = {'.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json',
  '.png':'image/png', '.woff2':'font/woff2', '.webmanifest':'application/manifest+json'};

/* Abre o painel com os dados `nome` ('normal' | 'fech' | 'semdv' | 'antigo' | 'semsv' | 'grupo' | 'semdados' | 'evcob' |
   'semscm' | 'inc' | 'incfech' | 'seminc' | 'grande' | 'exec' | 'dias' | 'diasscm' | 'evo' | 'evogrupo' | 'evogrande' |
   'evofech' | 'semevo' | 'vol5' | 'vol5fech' | 'dim');
   devolve {page, erros}.
   `armazenado` = localStorage inicial; `busca` = query string (ex.: link do Resumo); `fuso` = fuso do navegador;
   `antes(page)` roda antes de abrir (ex.: relógio simulado); `entrar` = como entra pela entrada (ver entra()); `aba` = a
   aba depois de entrar (padrão ICS GC, a aba inicial de antes da Executiva; null = fica na aba inicial do perfil);
   `liberadas` = CONFIG.GC_LIBERADAS servido (padrão null = todas; 'config' = a do config.js; ver trocaLiberadas);
   `nomes` = CONFIG.DIRETORIA_NOMES servido (padrão {} = só "Diretoria"; NOMES_TESTE = os nomes fictícios das senhas de teste). */
async function abre(nome, {armazenado = {}, largura = 1200, altura = 1000, entrar = 'gc', busca = '', fuso, antes,
                           troca = {}, toque = false, aba = 'ICS_GC', liberadas = null, nomes = {}} = {}){
  // toque = tela de toque (page.tap; os ponteiros chegam como pointerType 'touch')
  const ctx = await browser.newContext({viewport: {width: largura, height: altura}, ...(fuso ? {timezoneId: fuso} : {}),
                                        ...(toque ? {hasTouch: true} : {})});
  const page = await ctx.newPage();
  const erros = [], fonte = {nome};     // fonte.nome pode mudar no meio do teste (payload novo)
  page.on('pageerror', e => erros.push(String(e)));
  page.on('console', m => { if(m.type() === 'error') erros.push(m.text()); });
  // https: contexto seguro, como o GitHub Pages (a senha da Diretoria usa crypto.subtle, que o http não tem)
  await page.route('https://painel.test/**', rota => {
    const url = new URL(rota.request().url());
    let arq = url.pathname.startsWith('/data/') ? path.join(DADOS[fonte.nome], url.pathname.slice(6))
                                                 : path.join(FRONT, url.pathname);
    if(!fs.existsSync(arq)) return rota.fulfill({status: 404, body: ''});
    // `troca` = {'/js/config.js': texto => texto alterado} (ex.: CONFIG.INCENTIVO_ATIVO = false)
    let corpo = troca[url.pathname] ? troca[url.pathname](fs.readFileSync(arq, 'utf-8')) : fs.readFileSync(arq);
    // senha da Diretoria: o config.js servido leva os hashes das senhas de teste (senha_teste.js), nunca as reais; e as
    // gerências liberadas na entrada de `liberadas`
    if(url.pathname === '/js/config.js') corpo = trocaNomes(trocaLiberadas(trocaHash(corpo), liberadas), nomes);
    rota.fulfill({status: 200, contentType: TIPOS[path.extname(arq)] || 'application/octet-stream', body: corpo});
  });
  // bibliotecas do PDF (CDN) não são usadas nos testes
  await page.route(/cdnjs\.cloudflare\.com/, r => r.abort());
  // só na 1ª carga da aba (um reload não deve regravar o acesso guardado)
  await page.addInitScript(itens => { try { if(!sessionStorage.getItem('_teste')){ sessionStorage.setItem('_teste', '1');
    for(const k in itens) localStorage.setItem(k, itens[k]); } } catch(e){} }, armazenado);
  if(antes) await antes(page);
  await page.goto('https://painel.test/index.html' + busca);
  await esperaCarga(page);
  // sem acesso guardado a página abre na entrada; entrar = 'gc' | 'dir' | {perfil, ...} entra, null fica na entrada
  if(entrar) await entra(page, entrar, aba);
  return {page, ctx, erros, fonte};
}
module.exports = {abre};

/* Espera o payload e o fim da tela de carga (entrada, acesso guardado ou link do Resumo já resolvidos): os cards da aba
   ou, na Executiva (aba inicial desde a Etapa 5), os medidores desenhados.
   P é 'let' de script clássico: existe no escopo global, mas não em window. */
const esperaCarga = page => page.waitForFunction(() => typeof P !== 'undefined' && P &&
  (document.querySelector('#lista').innerHTML !== '' || (document.querySelector('#exGauges') || {}).innerHTML) &&
  document.getElementById('carga').hidden);
/* vai para uma aba pela barra (se ela existe e não é a ativa) e espera o render */
const vaiAba = (page, aba) => page.evaluate(aba => {
  const t = document.querySelector(`.tab[data-g="${aba}"]`);
  if(t && !t.hidden && !t.classList.contains('on')) t.click();
}, aba);
/* Entra pela tela de entrada, por seleção: {perfil: 'dir'} | {perfil: 'gc', gc} | {perfil: 'sv', gc, sv} |
   {perfil: 'rota', gc, rota}, com gc = sigla ou chave de grupo ('IT+MO'; a sigla de uma gerência agrupada escolhe o
   grupo dela, como faria o usuário), sv = código (SV.G2.1) ou só o número ('1') e rota = código; 'dir' = Diretoria;
   'gc' = Gerência na primeira gerência com dados (onde a Gerência abria antes).
   Desde a Etapa 5 o painel abre na Executiva (Rota: no Volume); `aba` (padrão ICS GC, a aba inicial de antes, de onde os
   testes anteriores partem) vai para essa aba depois de entrar; null = fica na aba inicial do perfil. */
async function entra(page, entrar, aba = 'ICS_GC'){
  if(entrar === 'dir') entrar = {perfil: 'dir'};
  if(entrar === 'gc') entrar = {perfil: 'gc', gc: await page.evaluate(() => primeiraGc())};
  const {perfil, gc = '', sv = '', rota = ''} = entrar;
  if(await page.isVisible('#entCaixa')) await page.click('#entFechar');     // de volta aos quatro botões
  await page.click(`#entrada [data-perfil="${perfil}"]`);
  if(perfil === 'dir') await digitaSenha(page);
  else {
    const opcao = await page.$$eval('#entOpcoes [data-gc]', (bs, gc) => ((bs.find(b => b.dataset.gc === gc)
      || bs.find(b => b.dataset.gc.split('+').includes(gc))) || {dataset: {gc}}).dataset.gc, gc);
    await page.click(`#entOpcoes [data-gc="${opcao}"]`);
    if(perfil === 'sv') await page.click(`#entOpcoes [data-sv="${/^\d+$/.test(sv) ? `SV.${gc}.${Number(sv)}` : sv}"]`);
    if(perfil === 'rota') await page.click(`#entOpcoes [data-rota="${rota}"]`);
  }
  if(aba) await vaiAba(page, aba);
}
/* volta para a entrada pela casa e entra de novo */
async function vaiPara(page, entrar, aba){
  await page.click('#btnCasa');
  await entra(page, entrar, aba);
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
/* abre a gaveta de um card do topo (Base, Sem compra) pelo clique do próprio elemento: desde a Etapa 4 os dois só
   aparecem com supervisão ou rota no filtro, mas a gaveta é a mesma em qualquer escopo */
const abreCardTopo = (page, id) => page.evaluate(id => document.getElementById(id).click(), id.replace(/^#/, ''));
const opcoes = page => page.evaluate(() => ({
  sv: [...document.querySelectorAll('#fsv option')].map(o => o.value).filter(Boolean),
  rota: [...document.querySelectorAll('#frota option')].map(o => o.value).filter(Boolean),
}));
/* Põe o real de todos os indicadores das rotas em `fator` x meta (cobertura e tendência de volume). */
/* "puxa a média" (quadro de destaque desde a Etapa 4: título, nome em vermelho, "x de n indicadores no ritmo"): devolve
   "<título>: <nome>" (o texto de antes) ou '' sem o quadro */
const puxaTxt = page => page.evaluate(() => { const t = document.querySelector('#puxa .t'), b = document.querySelector('#puxa .s b');
  return t ? `${t.textContent}: ${b.textContent}` : ''; });
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
    assert.match(await puxaTxt(page), /Supervisão que mais puxa a média para baixo: SV\.G1\.1/);
    // AT: a 411 entra na comparação das rotas da SV.AT.1
    await ritmo(page, 'AT', ['AT12'], 1);
    await ritmo(page, 'AT', ['411'], 0);
    await filtra(page, {gc: 'AT', sv: 'SV.AT.1'});
    assert.match(await puxaTxt(page), /Rota que mais puxa a média para baixo: Rota 411/);
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
/* Diretoria: desde a Etapa 3 do pacote v3 a linha da gerência na cascata abre direto a lista de clientes dela; as supervisões
   da gerência (com a linha "Neutraliza" e as notas das virtuais/EV*) são a mesma cascata (ctxGerencia) que a Diretoria abre
   com a gerência no filtro. Confere a lista de clientes na linha e abre as supervisões pelo filtro. */
async function supervisoesNaDiretoria(page, gc, k, aba){
  const g0 = await lerGaveta(page), i = g0.linhas.findIndex(l => l.nome.startsWith(`GC.${gc} ·`));
  await page.click(`#dCorpo .cLin[data-i="${i}"]`);
  assert.equal(await page.evaluate(() => CASC.pilha[CASC.pilha.length - 1].nivel), 'cli', `GC.${gc}: lista de clientes`);
  await page.keyboard.press('Escape');
  await page.selectOption('#fgc', gc);
  return cascata(page, k, aba);
}

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
    await page.route('https://painel.test/**', r => {
      const u = new URL(r.request().url());
      const a = u.pathname.startsWith('/data/') ? path.join(DADOS.normal, u.pathname.slice(6)) : path.join(FRONT, u.pathname);
      fs.existsSync(a) ? r.fulfill({status: 200, body: fs.readFileSync(a), contentType: TIPOS[path.extname(a)]})
                       : r.fulfill({status: 404, body: ''});
    });
    await page.goto('https://painel.test/index.html');
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
    g = await supervisoesNaDiretoria(page, 'AN', k, 'VOLUME');
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
    g = await supervisoesNaDiretoria(page, 'SL', k, 'VOLUME');
    assert.deepEqual(g.nota.map(n => n.texto), ['Inclui clientes de rotas eventuais (EV*): Real 120']);
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('cobertura dos clientes de rotas eventuais (EV*): Real no total da gerência (ICS GC, Novos Negócios e Todos a Bordo), com nota', async () => {
    const {page, ctx, erros} = await abre('evcob');
    // diferença do total da gerência com e sem a rota oculta: [Meta, Real]
    const dif = (k, inc) => page.evaluate(([k, inc]) => {
      const todas = inc ? rotasInc(k, rotasAtuais()) : rotasAtuais(), normais = todas.filter(r => !ehEventual(r));
      const a = agrega(todas).ind[k], b = agrega(normais).ind[k];
      return [a.meta - b.meta, a.real - b.real];
    }, [k, inc]);
    const notas = g => g.nota.map(n => [n.texto, n.meta, n.real]);
    await filtra(page, {gc: 'SL', aba: 'ICS_GC'});
    assert.deepEqual(await dif('CCTM 2L PET'), [0, 2]);
    let g = await cascata(page, 'CCTM 2L PET', 'ICS_GC');
    assert.deepEqual(notas(g), [['Inclui clientes de rotas eventuais (EV*): Real 2', 0, 2]]);
    const card = await page.evaluate(() => agrega(rotasAtuais()).ind['CCTM 2L PET']);
    assert.equal(g.linhas.filter(l => !l.off).reduce((a, l) => a + l.real, 0) + 2, card.real, 'linhas + nota = card (Real)');
    assert.ok(Math.abs(somaMeta(g.linhas) - card.meta) < 1e-6, 'sem meta');
    await page.keyboard.press('Escape');
    assert.deepEqual(await dif('CAMPARI'), [0, 1]);
    g = await cascata(page, 'CAMPARI', 'NOVOS_NEG');
    assert.deepEqual(notas(g), [['Inclui clientes de rotas eventuais (EV*): Real 1', 0, 1]]);
    await page.keyboard.press('Escape');
    // Todos a Bordo: a oculta soma junto das rotas com meta do item (a SL é Full)
    await filtra(page, {aba: 'INCENTIVO'});
    assert.deepEqual(await page.evaluate(() => rotasInc('INC HEINEKEN', rotasAtuais()).filter(ehEventual)), ['SL-EV']);
    assert.deepEqual(await dif('INC HEINEKEN', true), [0, 1]);
    const tot = await page.evaluate(() => agrega(rotasInc('INC HEINEKEN', rotasAtuais())).ind['INC HEINEKEN']);
    assert.deepEqual(metaReal((await cardsInc(page))['INC HEINEKEN']), [tot.meta, tot.real]);
    await page.click('.ind[data-k="INC HEINEKEN"]');
    assert.deepEqual(notas(await lerGaveta(page)), [['Inclui clientes de rotas eventuais (EV*): Real 1', 0, 1]]);
    await page.keyboard.press('Escape');
    // AP (sem meta de Heineken): o cliente EV* coberto não cria o card; continua "Exclusivo portfólio Full"
    await filtra(page, {gc: 'AP', aba: 'INCENTIVO'});
    assert.deepEqual(await page.evaluate(() => rotasInc('INC HEINEKEN', rotasAtuais())), []);
    const ap = (await cardsInc(page))['INC HEINEKEN'];
    assert.deepEqual([ap.off, ap.semdado], [true, 'Exclusivo portfólio Full']);
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
    g = await supervisoesNaDiretoria(page, 'AN', 'VOL REFRIGERANTES', 'VOLUME');
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
    assert.match(await puxaTxt(page), /Gerência que mais puxa a média para baixo: GC\.MO · Morrinhos/);
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
    assert.match(await puxaTxt(page), /Supervisão que mais puxa a média para baixo: SV\.G2\.1/);
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
  /* textos dos cards e das gavetas Base / Sem compra em cada aba. Desde a Etapa 6 a chave só muda a gaveta Sem compra: com
     ela, a barra de dias (os outros dias e o "Todos" vêm do SEM_COMPRA_MES); sem ela, só o "Hoje", sem a barra. As gavetas
     abrem no "Hoje" e, fora da barra, são as mesmas nos dois payloads. */
  async function telas(page){
    const out = [];
    for(const aba of ['VOLUME', 'ICS_GC', 'NOVOS_NEG', 'INCENTIVO']){
      if(await page.isHidden(`.tab[data-g="${aba}"]`)) continue;
      await filtra(page, {aba});
      out.push(await page.evaluate(() => [document.getElementById('abaTopo').innerText, document.getElementById('puxa').innerText,
                                           document.getElementById('lista').innerText]));
    }
    const barras = [];
    for(const card of ['#cBase', '#cSem']){
      await abreCardTopo(page, card);
      barras.push(await page.$$eval('#dCorpo .dchip', bs => bs.map(b => b.dataset.d + (b.classList.contains('on') ? '*' : '')).join(' ')));
      out.push(await page.evaluate(() => [document.getElementById('dTit').textContent, document.getElementById('dSub').textContent,
        [...document.getElementById('dCorpo').children].filter(x => !x.classList.contains('chips')).map(x => x.innerText).join('\n')]));
      await page.keyboard.press('Escape');
    }
    return {out, barras};
  }

  test('payload sem SEM_COMPRA_MES (antigo) abre sem erro e com as mesmas telas do payload com a chave (Sem compra só no "Hoje")', async () => {
    const BARRA = 'Hoje* Seg Ter Qua Qui Sex Todos';
    for(const entrar of ['dir', {perfil: 'gc', gc: 'G1'}, {perfil: 'sv', gc: 'G1', sv: '1'}, {perfil: 'rota', gc: 'G1', rota: 'G111'}]){
      const vistas = [];
      for(const nome of ['normal', 'semscm']){
        const {page, ctx, erros} = await abre(nome, {entrar});
        assert.equal(await page.evaluate(() => 'SEM_COMPRA_MES' in P), nome === 'normal', nome);
        const v = await telas(page);
        // Base: barra nos dois; Sem compra: com a chave, a barra no "Hoje"; sem ela, nenhuma (só o "Hoje")
        assert.deepEqual(v.barras, [BARRA, nome === 'normal' ? BARRA : ''], `${nome} ${JSON.stringify(entrar)}: barras`);
        vistas.push(v.out);
        assert.deepEqual(erros, [], `${nome} ${JSON.stringify(entrar)}`);
        await ctx.close();
      }
      assert.ok(vistas[0].length >= 5);
      assert.deepEqual(vistas[1], vistas[0], JSON.stringify(entrar));
    }
  });

  test('o sintético traz a lista: tamanho = semCompra e contém o SEM_COMPRA_HOJE', () => {
    const p = JSON.parse(fs.readFileSync(path.join(DADOS.normal, 'payload.json'), 'utf-8'));
    // a última, antes só da MES_ANTERIOR (opcional, Etapa 8b; o front ainda não lê)
    assert.equal(Object.keys(p).filter(k => k !== 'MES_ANTERIOR').at(-1), 'SEM_COMPRA_MES');
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
      // clientes de volume: Meta, Real, Online (Etapa 3 do pacote v3), Dif. Abs e %, do mais negativo para o mais positivo
      await page.click('#dCorpo .cLin[data-i="0"]');
      await page.click('#dCorpo .cLin[data-i="0"]');
      g = await lerGaveta(page);
      assert.deepEqual(await page.$$eval('#dCorpo .cCab span', s => s.map(x => x.textContent)),
                       ['Cliente', 'Meta', 'Real', 'Online', 'Dif. Abs', '%']);
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
      g = await supervisoesNaDiretoria(page, 'G1', k, 'VOLUME');
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
/* acesso guardado em 'drotas_sessao' (dia = null: sem o campo), no formato atual (v: 2, desde a senha da Diretoria; o
   formato antigo, sem v, está na Parte AB) */
const sessao = (a, dia = DIA) => JSON.stringify({gc: '', sv: '', rota: '', ...a, ...(dia ? {dia} : {}), v: 2});
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
  // desde 22/10/2026 a Diretoria pede senha (Parte AB); o único campo da entrada é o dela, só com a caixa da Diretoria aberta
  test('quatro botões; Diretoria pela senha, sem usuário; nenhum campo de texto fora da caixa da Diretoria', async () => {
    const {page, ctx, erros} = await abre('normal', {entrar: null, antes: fixo()});
    assert.deepEqual(await page.$$eval('#entBotoes button', bs => bs.map(b => b.textContent)),
                     ['DIRETORIA', 'GERÊNCIA', 'SUPERVISÃO', 'ROTA']);
    let e = await estado(page);
    assert.deepEqual([e.entrada, e.msg, e.guardado, e.acesso], [true, '', null, null]);
    assert.equal((await caixa(page)).campos, 0, 'sem campo de texto');
    assert.doesNotMatch(await page.textContent('#entrada'), /usu[aá]rio|senha|DICOM/i);
    await page.click('#entrada [data-perfil="dir"]');
    assert.equal((await caixa(page)).campos, 2, 'só o formulário e o campo da senha');
    await digitaSenha(page);
    e = await estado(page);
    assert.ok(!e.entrada);
    assert.deepEqual([e.sel, e.filtros, e.resumo], [['dir', '', '', ''], ['fgc'], true]);
    assert.equal(await page.inputValue('#fgc'), '', '"Todas as gerências"');
    assert.match(e.sub, /· Diretoria$/);
    assert.deepEqual(e.guardado, {perfil: 'dir', gc: '', sv: '', rota: '', dia: DIA, v: 2});
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
    assert.deepEqual(e.guardado, {perfil: 'gc', gc: 'G2', sv: '', rota: '', dia: DIA, v: 2});
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
    assert.deepEqual(e.guardado, {perfil: 'gc', gc: 'IT+MO', sv: '', rota: '', dia: DIA, v: 2});
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
    assert.match(await puxaTxt(page), /Supervisão que mais puxa a média para baixo: SV\.MO\.2/);
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
      assert.deepEqual((await estado(page)).guardado, {perfil: 'gc', gc: 'IT+MO', sv: '', rota: '', dia: DIA, v: 2});
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
                     [false, ['gc', 'MO', 'SV.MO.1', ''], ['frota'], {perfil: 'sv', gc: 'MO', sv: 'SV.MO.1', rota: '', dia: DIA, v: 2}]);
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
    assert.match(await puxaTxt(page), /Rota que mais puxa a média para baixo: Rota G211/);
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
      [false, ['gc', 'G2', 'SV.G2.1', 'G211'], [], false, {perfil: 'rota', gc: 'G2', sv: 'SV.G2.1', rota: 'G211', dia: DIA, v: 2}]);
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
                                                       {perfil: 'rota', gc: 'MO', sv: 'SV.MO.2', rota: 'MO21', dia: DIA, v: 2}]);
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
      assert.deepEqual(JSON.parse(await guardadoTxt(page)), {...guardado, dia: DIA, v: 2});
      // mexe nos filtros livres e abre a cascata: ao recarregar, voltam ao padrão
      if(login.perfil === 'dir') await page.selectOption('#fgc', 'IT');
      if(login.perfil === 'gc') await page.selectOption('#fsv', 'SV.G2.2');
      if(login.perfil === 'sv') await page.selectOption('#frota', 'IT22');
      await page.click('.ind[data-k]');
      await page.reload();
      await esperaCarga(page);
      let e = await estado(page);
      assert.ok(!e.entrada, login.perfil);
      assert.deepEqual([e.sel, e.filtros, e.guardado], [ctxSel, filtros, {...guardado, dia: DIA, v: 2}], login.perfil);
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
    const guardado = {perfil: 'gc', gc: 'IT+MO', sv: '', rota: '', dia: DIA, v: 2};
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
      assert.deepEqual((await estado(page)).guardado, {perfil: 'gc', gc: 'UR+RI', sv: '', rota: '', dia: '2026-10-14', v: 2});
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

/* ---------- Parte Y — entrada com logos (Etapa 7): Coca-Cola Bandeirantes | linha vermelha | elmo com "Comercial
   Bandeirantes", uma versão de cada imagem para cada fundo (data-tema = o tema da entrada; o CSS mostra só a do fundo
   atual). O comportamento da entrada não muda (Partes D e I). ---------- */
const LOGOS = {preta: ['coca-bandeirantes-fundo-escuro.png', 'elmo-branco.png'],
               branca: ['coca-bandeirantes-fundo-claro.png', 'elmo-preto.png']};
// imagens, linha, texto e posições da faixa das logos (só o que está visível)
const leLogos = page => page.evaluate(() => {
  const ent = document.getElementById('entrada');
  const vis = el => el.getClientRects().length > 0;
  const caixa = el => { const b = el.getBoundingClientRect(); return {l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, h: b.height}; };
  const ref = v => { const s = document.createElement('span'); s.style.color = `var(${v})`; document.body.appendChild(s);
    const c = getComputedStyle(s).color; s.remove(); return c; };
  const txt = ent.querySelector('.entElmoTxt'), cs = getComputedStyle(txt), sep = ent.querySelector('.entSep');
  return {
    tema: ent.classList.contains('branca') ? 'branca' : 'preta',
    imgs: [...ent.querySelectorAll('.entLogos img')].filter(vis).map(i => ({arq: new URL(i.currentSrc).pathname,
      alt: i.getAttribute('alt'), tema: i.dataset.tema, coca: i.classList.contains('entCoca'), completa: i.complete,
      nw: i.naturalWidth, nh: i.naturalHeight, ...caixa(i)})),
    ocultas: [...ent.querySelectorAll('.entLogos img')].filter(i => !vis(i)).map(i => [i.dataset.tema, getComputedStyle(i).display]),
    sep: {...caixa(sep), larg: getComputedStyle(sep).width, cor: getComputedStyle(sep).backgroundColor, vermelho: ref('--vermelho'),
          aria: sep.getAttribute('aria-hidden')},
    elmo: {...caixa(ent.querySelector('.entElmo')), role: ent.querySelector('.entElmo').getAttribute('role'),
           label: ent.querySelector('.entElmo').getAttribute('aria-label')},
    txt: {...caixa(txt), linhas: txt.innerText.split('\n'), cor: cs.color, preto: ref('--preto'), fam: cs.fontFamily,
          peso: cs.fontWeight, tam: cs.fontSize, lh: cs.lineHeight, ls: cs.letterSpacing, alinh: cs.textAlign},
    h1: caixa(ent.querySelector('h1')), botoes: caixa(document.getElementById('entBotoes')),
    tela: [innerWidth, innerHeight], rolagem: [document.documentElement.scrollWidth, document.documentElement.clientWidth,
      ent.scrollWidth, ent.clientWidth],
    marcaAntiga: ent.querySelectorAll('.entMarca').length,
  };
});

describe('Parte Y — entrada com logos (Etapa 7)', {skip: pular}, () => {
  test('imagens certas em cada fundo (arquivo, carregada), alt e aria; o sol/lua troca as duas e a cor do texto', async () => {
    const pedidos = [];
    const {page, ctx, erros} = await abre('normal', {entrar: null, largura: 1440, antes: async p => p.on('request', r => pedidos.push(r.url()))});
    for(const [i, tema] of ['preta', 'branca', 'preta'].entries()){
      if(i) await page.click('#btnTema');
      await page.waitForFunction(() => [...document.querySelectorAll('#entrada .entLogos img')]
        .filter(i => i.getClientRects().length).every(i => i.complete && i.naturalWidth > 0));
      const r = await leLogos(page);
      assert.equal(r.tema, tema);
      assert.deepEqual(r.imgs.map(i => i.arq), LOGOS[tema].map(a => `/assets/${a}`), `${tema}: imagens visíveis`);
      assert.ok(r.imgs.every(i => i.completa && i.nw > 0 && i.nh > 0 && i.tema === tema), `${tema}: carregadas`);
      assert.deepEqual(r.imgs.map(i => [i.coca, i.alt]), [[true, 'Coca-Cola Bandeirantes'], [false, '']], 'alt da logo; elmo decorativo');
      assert.deepEqual(r.ocultas, [tema === 'preta' ? 'branca' : 'preta', tema === 'preta' ? 'branca' : 'preta'].map(t => [t, 'none']),
                       `${tema}: as do outro fundo ficam ocultas`);
      assert.deepEqual([r.elmo.role, r.elmo.label], ['img', 'Comercial Bandeirantes']);
      assert.equal(r.sep.aria, 'true');
      assert.equal(r.txt.cor, tema === 'preta' ? 'rgb(255, 255, 255)' : r.txt.preto, `${tema}: cor do texto`);
      assert.equal(r.marcaAntiga, 0, 'sem a linha antiga (elmo pequeno + texto)');
    }
    // as quatro imagens vêm do próprio site (assets/), sem pedido para fora
    const pngs = pedidos.filter(u => /\.png$/.test(new URL(u).pathname)).map(u => new URL(u).pathname);
    for(const a of [...LOGOS.preta, ...LOGOS.branca]) assert.ok(pngs.includes(`/assets/${a}`), a);
    assert.ok(pedidos.every(u => new URL(u).host === 'painel.test' || /cdnjs\.cloudflare\.com/.test(u)));
    for(const a of [...LOGOS.preta, ...LOGOS.branca]){
      const b = fs.readFileSync(path.join(FRONT, 'assets', a));
      assert.equal(b.subarray(1, 4).toString('latin1'), 'PNG', a);
      // proporção dos originais do pacote (560x251 e 140x263), sem redimensionar
      assert.deepEqual([b.readUInt32BE(16), b.readUInt32BE(20)], a.startsWith('coca') ? [560, 251] : [140, 263], a);
    }
    // o fundo guardado (branca) já abre com as imagens do fundo branco
    const outra = await abre('normal', {entrar: null, armazenado: {drotas_entrada: 'branca'}});
    await outra.page.waitForFunction(() => [...document.querySelectorAll('#entrada .entLogos img')]
      .filter(i => i.getClientRects().length).every(i => i.complete && i.naturalWidth > 0));
    assert.deepEqual((await leLogos(outra.page)).imgs.map(i => i.arq), LOGOS.branca.map(a => `/assets/${a}`));
    assert.deepEqual([...erros, ...outra.erros], []);
    await outra.ctx.close();
    await ctx.close();
  });

  for(const largura of [360, 390, 1440]){
    test(`${largura} px: logos lado a lado sem distorção, linha vermelha, texto em duas linhas, tudo na tela, nos dois fundos`, async () => {
      const {page, ctx, erros} = await abre('normal', {entrar: null, largura, altura: largura < 1000 ? 844 : 900});
      await medidas(page);
      const pequena = largura <= 380;
      for(const tema of ['preta', 'branca']){
        if(tema === 'branca') await page.click('#btnTema');
        await page.waitForFunction(() => [...document.querySelectorAll('#entrada .entLogos img')]
          .filter(i => i.getClientRects().length).every(i => i.complete && i.naturalWidth > 0));
        await page.evaluate(() => document.fonts.ready);
        const r = await leLogos(page), onde = `${largura} ${tema}`;
        const [coca, elmo] = r.imgs;
        // altura pedida (62/40 px; 52/34 px em <= 380 px) e a proporção do arquivo (sem distorção)
        assert.ok(Math.abs(coca.h - (pequena ? 52 : 62)) < .5, `${onde}: logo com ${coca.h} px`);
        assert.ok(Math.abs(elmo.h - (pequena ? 34 : 40)) < .5, `${onde}: elmo com ${elmo.h} px`);
        for(const i of r.imgs) assert.ok(Math.abs((i.w / i.h) / (i.nw / i.nh) - 1) < .01, `${onde} ${i.arq}: ${i.w}x${i.h} de ${i.nw}x${i.nh}`);
        // lado a lado: logo | linha | elmo, alinhados pelo meio, acima do título
        assert.ok(coca.r <= r.sep.l && r.sep.r <= r.elmo.l, `${onde}: ordem ${coca.r} ${r.sep.l} ${r.sep.r} ${r.elmo.l}`);
        const meio = c => (c.t + c.b) / 2;
        assert.ok(Math.abs(meio(coca) - meio(r.sep)) < 1.5 && Math.abs(meio(r.elmo) - meio(r.sep)) < 1.5, `${onde}: alinhamento vertical`);
        assert.ok(Math.max(coca.b, r.sep.b, r.elmo.b) <= r.h1.t, `${onde}: acima de "Desempenho de Rotas"`);
        assert.ok(Math.abs((coca.l + r.elmo.r) / 2 - (r.h1.l + r.h1.r) / 2) < 1.5, `${onde}: centralizadas como o título`);
        // linha vermelha fina: 1,5 px, --vermelho, ~64 px de altura
        assert.equal(r.sep.larg, '1.5px');
        assert.equal(r.sep.cor, r.sep.vermelho);
        assert.ok(Math.abs(r.sep.h - 64) < .5, `${onde}: linha com ${r.sep.h} px`);
        // "COMERCIAL" / "BANDEIRANTES" embaixo do elmo, centralizado: Inter 800, 9,5 px, line-height 1.08, .015em
        assert.deepEqual(r.txt.linhas, ['COMERCIAL', 'BANDEIRANTES'], onde);
        assert.match(r.txt.fam, /^Inter,/);
        assert.deepEqual([r.txt.peso, r.txt.tam, r.txt.alinh], ['800', '9.5px', 'center'], onde);
        assert.ok(Math.abs(parseFloat(r.txt.lh) - 9.5 * 1.08) < .01, `${onde}: line-height ${r.txt.lh}`);
        assert.ok(Math.abs(parseFloat(r.txt.ls) - 9.5 * .015) < .01, `${onde}: letter-spacing ${r.txt.ls}`);
        assert.ok(r.txt.t >= elmo.b - .5 && Math.abs((r.txt.l + r.txt.r) / 2 - (elmo.l + elmo.r) / 2) < 1, `${onde}: texto embaixo do elmo`);
        // nada fora da tela, sem rolagem lateral e sem texto cortado
        for(const c of [coca, elmo, r.sep, r.txt, r.h1, r.botoes]) assert.ok(c.l >= 0 && c.r <= r.tela[0], `${onde}: fora da tela`);
        assert.ok(r.rolagem[0] <= r.rolagem[1] && r.rolagem[2] <= r.rolagem[3], `${onde}: rolagem lateral ${r.rolagem}`);
        assert.deepEqual(await page.evaluate(() => __vis.estouros('#entrada')), [], onde);
        // contraste do texto (AA 4,5:1) no fundo preto e no branco
        const c = await page.evaluate(() => __vis.contrastes(['.entElmoTxt']));
        assert.equal(c.length, 1);
        assert.ok(c[0][2] >= 4.5, `${onde}: contraste ${c[0][2]}`);
      }
      assert.deepEqual(erros, []);
      await ctx.close();
    });
  }

  test('entrada funciona como antes nos dois fundos: os quatro perfis (e o grupo), acesso guardado, casa; aba inicial do perfil (Etapa 5)', async () => {
    for(const tema of ['preta', 'branca']){
      const {page, ctx, erros} = await abre('grupo', {entrar: null, armazenado: {drotas_entrada: tema}, antes: fixo()});
      for(const [entrar, acesso] of [['dir', ['dir', '', '', '']], [{perfil: 'gc', gc: 'G2'}, ['gc', 'G2', '', '']],
          [{perfil: 'gc', gc: 'IT+MO'}, ['gc', 'IT+MO', '', '']], [{perfil: 'sv', gc: 'G2', sv: '1'}, ['sv', 'G2', 'SV.G2.1', '']],
          [{perfil: 'rota', gc: 'G2', rota: 'G211'}, ['rota', 'G2', 'SV.G2.1', 'G211']]]){
        await page.reload();
        await esperaCarga(page);
        assert.ok(await page.isVisible('#entrada'), `${tema}: na entrada`);
        await entra(page, entrar, null);
        const e = await estado(page);
        assert.ok(!e.entrada, `${tema} ${acesso[0]}: entrou`);
        assert.deepEqual(e.acesso, acesso, tema);
        assert.deepEqual(e.guardado, {perfil: acesso[0], gc: acesso[1], sv: acesso[2], rota: acesso[3], dia: DIA, v: 2});
        // aba inicial (Etapa 5): Executiva na Diretoria, na Gerência e na Supervisão; Volume na Rota (que não tem a Executiva)
        const inicial = acesso[0] === 'rota' ? 'VOLUME' : 'EXEC';
        assert.equal(await page.$eval('.tab.on', t => t.dataset.g), inicial, `${tema} ${acesso[0]}: aba inicial`);
        // recarregar reabre o mesmo acesso sem a entrada, na mesma aba inicial; a casa volta para ela com o fundo escolhido
        await page.reload();
        await esperaCarga(page);
        assert.deepEqual((await estado(page)).acesso, acesso, `${tema}: acesso guardado`);
        assert.equal(await page.$eval('.tab.on', t => t.dataset.g), inicial, `${tema} ${acesso[0]}: aba inicial ao recarregar`);
        await page.click('#btnCasa');
        const v = await estado(page);
        assert.deepEqual([v.entrada, v.guardado], [true, null], `${tema}: casa`);
        assert.equal((await leLogos(page)).tema, tema);
      }
      assert.deepEqual(erros, []);
      await ctx.close();
    }
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
    // (Diferença = (Real + online de hoje) − Meta desde 29/10/2026, pedido da Karen)
    assert.equal(card.cl, `Meta ${fmtPt(card.b.meta)} Real ${fmtPt(card.b.real)} Diferença ${fmtPt(card.b.real + onl - card.b.meta)}`);
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
    // Diferença = (Real + online de hoje, clientes distintos) − Meta: 16 + 5 clientes novos online − 14
    assert.equal(card.cl, 'Meta 14 Real 16 Diferença +7');
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
    // (o selo "✓ META BATIDA" da linha da cascata, Etapa 3 do pacote v3, vale no fechamento com Real >= Meta: a caixa não muda)
    assert.doesNotMatch(await page.textContent('body'), /Meta batida!/);
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
  // % da linha: .cDir até a Etapa 3 do pacote v3; desde então .cPct ("real da meta" no lugar de "do mês")
  dirTxt: (l.querySelector('.cPct') || l.querySelector('.cDir')).textContent.replace(/\s+/g, ' ').trim()})));
const notasInc = page => page.$$eval('#dCorpo .cNota', ns => ns.map(n => ({meta: Number(n.dataset.meta),
  real: Number(n.dataset.real), texto: n.textContent})));
const COM_ONLINE = {'/js/config.js': t => t.replace('STATUS_INCLUI_ONLINE: false', 'STATUS_INCLUI_ONLINE: true')};

// desde a Etapa 5, entrar de novo (casa + entrada) abre na aba inicial do perfil: vaiPara(..., 'INCENTIVO') continua nesta aba
describe('Parte L — aba Todos a Bordo', {skip: pular}, () => {
  test('aba "Todos a Bordo" ao lado de Novos Negócios em todos os perfis e visões; sem card Status; oculta com INCENTIVO_ATIVO = false e no payload antigo', async () => {
    let {page, ctx, erros, fonte} = await abre('inc', {entrar: 'dir'});
    // desde a Etapa 5 a Executiva é a primeira aba da barra (Parte W); Todos a Bordo continua ao lado de Novos Negócios
    assert.deepEqual(await page.$$eval('.tab', ts => ts.map(t => [t.dataset.g, t.textContent])),
                     [['EXEC', 'Diretoria'], ['VOLUME', 'Volume'], ['ICS_GC', 'ICS GC'], ['NOVOS_NEG', 'Novos Negócios'],
                      ['INCENTIVO', 'Todos a Bordo']]);
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
    await vaiPara(page, {perfil: 'rota', gc: 'IT+MO', rota: 'IT11'}, 'INCENTIVO');
    const pace = await page.evaluate(() => P.PACE_ONTEM_PCT);
    assert.ok(pace <= 50);
    c = await cardsInc(page);
    assert.deepEqual([c['INC HEINEKEN'].cl, c['INC HEINEKEN'].big, c['INC HEINEKEN'].ok, c['INC HEINEKEN'].acao,
                      c['INC HEINEKEN'].opo], ['Meta 2 Real 1 Diferença 0', '▲50%', true, 'no ritmo', 'oportunidades do dia 2']);
    // (Diferença = (Real + online de hoje) − Meta: Real [a] + online [a, b] = 2 clientes distintos; o % continua só o Real)
    assert.deepEqual(c['INC HEINEKEN'].obox, ['obox ok', '2', 'no ritmo']);
    // Real >= Meta: "Meta batida!" na caixa do Online (regra do ICS); 150% pela conta Real / Meta
    assert.deepEqual([c['INC EISENBAHN 600ML'].big, c['INC EISENBAHN 600ML'].obox], ['▲150%', ['obox ok', '0', 'Meta batida!']]);
    assert.deepEqual([c['INC HEINEKEN 600ML'].big, c['INC HEINEKEN 600ML'].obox], ['▲100%', ['obox ok', '1', 'Meta batida!']]);
    // IT21: Real 0 = 0%, vermelho, "faltam 1 hoje" e meta do dia na caixa do Online
    await vaiPara(page, {perfil: 'rota', gc: 'IT+MO', rota: 'IT21'}, 'INCENTIVO');
    c = await cardsInc(page);
    assert.deepEqual([c['INC HEINEKEN'].big, c['INC HEINEKEN'].ok, c['INC HEINEKEN'].acao], ['▼0%', false, 'faltam 1 hoje']);
    assert.match(c['INC HEINEKEN'].obox[2], /^meta do dia 1$/);
    // gerência BARRACUDA (AP): Heineken e Heineken - 600ml "Exclusivo portfólio Full"; os outros normais
    await vaiPara(page, {perfil: 'gc', gc: 'AP'}, 'INCENTIVO');
    c = await cardsInc(page);
    assert.deepEqual(['INC HEINEKEN', 'INC HEINEKEN 600ML'].map(k => [c[k].off, c[k].semdado, c[k].abre]),
                     [[true, 'Exclusivo portfólio Full', false], [true, 'Exclusivo portfólio Full', false]]);
    assert.ok(!c.CERVEJAS.off && !c['INC EISENBAHN 600ML'].off);
    await page.click('.ind[data-inc-off="INC HEINEKEN"]');
    assert.equal(await page.evaluate(() => document.getElementById('drw').classList.contains('on')), false);
    // G3: Eisenbahn - 600ml sem meta = "Sem meta"
    await vaiPara(page, {perfil: 'gc', gc: 'G3'}, 'INCENTIVO');
    c = await cardsInc(page);
    assert.deepEqual([c['INC EISENBAHN 600ML'].off, c['INC EISENBAHN 600ML'].semdado], [true, 'Sem meta']);
    // G2 mista: só a G211 tem meta de Heineken (as outras rotas ficam fora da soma)
    await vaiPara(page, {perfil: 'gc', gc: 'G2'}, 'INCENTIVO');
    c = await cardsInc(page);
    const g211 = await page.evaluate(() => nodo('', 'G211').indicators['INC HEINEKEN']);
    assert.deepEqual([c['INC HEINEKEN'].off, ...metaReal(c['INC HEINEKEN'])], [false, g211.meta, g211.real]);
    const semEstilo = h => h.replace(/ style="[^"]*"/g, '');     // encaixa() ajusta a fonte depois de pintar
    assert.equal(semEstilo(c['INC HEINEKEN'].html),
                 await page.evaluate(() => linha('INC HEINEKEN', agrega(['G211']).ind['INC HEINEKEN'], ['G211'])));
    // FULL (IT): todas as rotas da IT com meta, inclusive a Neutraliza I31
    await vaiPara(page, {perfil: 'gc', gc: 'IT+MO'}, 'INCENTIVO');
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
    await vaiPara(page, {perfil: 'rota', gc: 'IT+MO', rota: 'IT12'}, 'INCENTIVO');
    assert.deepEqual((await terceiroCard(page)).slice(1, 3), ['4 / 5', 'n no']);
    assert.deepEqual(await statusTopo(page), ['parcial', 'Status -', false]);
    // G212 (BARRACUDA): os itens Heineken ficam fora da conta; os 3 com meta batidos: "✓" verde
    await vaiPara(page, {perfil: 'rota', gc: 'G2', rota: 'G212'}, 'INCENTIVO');
    assert.deepEqual(await terceiroCard(page), ['Itens em 100%', '3 / 3', 'n ok', 'todos em 100%']);
    assert.deepEqual(await statusTopo(page), ['ok', 'Status ✓', true]);
    // G311: nenhum item com meta: "0 / 0", sem a linha Status
    await vaiPara(page, {perfil: 'rota', gc: 'G3', rota: 'G311'}, 'INCENTIVO');
    assert.deepEqual(await terceiroCard(page), ['Itens em 100%', '0 / 0', 'n', 'sem meta']);
    assert.equal(await statusTopo(page), null);
    // gerência BARRACUDA (AP): n = 3 (sem os Heineken); todos batidos depois de pôr Real = Meta: "✓"
    await vaiPara(page, {perfil: 'gc', gc: 'AP'}, 'INCENTIVO');
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
    await vaiPara(page, {perfil: 'rota', gc: 'IT+MO', rota: 'IT12'}, 'INCENTIVO');
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
    assert.ok(g.every(l => l.ef === undefined && /real da meta$/.test(l.dirTxt) && l.dir === Math.round(l.real / l.meta * 100)));
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
    await vaiPara(page, {perfil: 'gc', gc: 'G2'}, 'INCENTIVO');
    await page.click('.ind[data-k="INC HEINEKEN"]');
    g = await linhasInc(page);
    assert.deepEqual(g.map(l => [l.nome.split(' ·')[0], l.info]), [['SV.G2.1', '2 rotas · 1 com meta']]);
    await page.click('#dCorpo .cLin[data-i="0"]');
    assert.deepEqual((await linhasInc(page)).map(l => l.nome), ['Rota G211']);
    await page.keyboard.press('Escape');
    // gerência agrupada: Total = IT + MO; com a MO no seletor, só a MO
    await vaiPara(page, {perfil: 'gc', gc: 'IT+MO'}, 'INCENTIVO');
    const soma = await page.evaluate(() => ['IT', 'MO'].map(gc => agrega(rotasInc('INC HEINEKEN', rotasDe(gc, ''))).ind['INC HEINEKEN'].meta));
    assert.equal(metaReal((await cardsInc(page))['INC HEINEKEN'])[0], soma[0] + soma[1]);
    await page.selectOption('#fgc', 'MO');
    assert.equal(metaReal((await cardsInc(page))['INC HEINEKEN'])[0], soma[1]);
    await page.click('.ind[data-k="INC HEINEKEN"]');
    assert.ok((await linhasInc(page)).every(l => l.nome.startsWith('SV.MO.') || l.nome === 'Neutraliza'));
    await page.keyboard.press('Escape');
    // perfil Rota: abre direto nos clientes
    await vaiPara(page, {perfil: 'rota', gc: 'IT+MO', rota: 'IT11'}, 'INCENTIVO');
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
    assert.ok((await linhasInc(page)).every(l => /real da meta$/.test(l.dirTxt)));
    await page.keyboard.press('Escape');
    // IT11: Heineken Real 1 de 2; o online de hoje (mês novo) não completa o item: 4 / 5, "-"
    await vaiPara(page, {perfil: 'rota', gc: 'IT+MO', rota: 'IT11'}, 'INCENTIVO');
    assert.deepEqual((await terceiroCard(page)).slice(1, 3), ['4 / 5', 'n no']);
    assert.deepEqual(await statusTopo(page), ['parcial', 'Status -', false]);
    await vaiPara(page, {perfil: 'rota', gc: 'G2', rota: 'G212'}, 'INCENTIVO');
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
    await vaiPara(page, {perfil: 'gc', gc: 'AP'}, 'INCENTIVO');
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
        assert.deepEqual(await page.evaluate(() => __vis.estouros('#abaTopo, #lista .ind, #puxa, .rsBox, .topo, .barra')), [], aba);
        const alt = await page.evaluate(() => {
          const px = v => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(v));
          const cards = [...document.querySelectorAll('#lista .ind')].map(el => ({top: Math.round(el.getBoundingClientRect().top),
            h: el.getBoundingClientRect().height, tipo: el.classList.contains('off') ? 'off' : el.classList.contains('vol') ? 'vol' : 'cob'}));
          return {cards, minVol: px('--h-card-vol'), minCob: px('--h-card-cob'), minKpi: px('--h-kpi'),
                  kpi: [...document.querySelectorAll('#abaTopo .card')].filter(el => el.getClientRects().length)
                    .map(el => ({top: Math.round(el.getBoundingClientRect().top), h: el.getBoundingClientRect().height}))};
        });
        // mesmo tipo na mesma linha da grade = mesma altura; nenhum card com conteúdo abaixo do mínimo do tipo
        const porLinha = {};
        for(const c of alt.cards) (porLinha[`${c.top}|${c.tipo}`] = porLinha[`${c.top}|${c.tipo}`] || []).push(c.h);
        for(const [k, hs] of Object.entries(porLinha)) assert.ok(Math.max(...hs) - Math.min(...hs) <= 1, `${aba} ${k}: ${hs}`);
        for(const c of alt.cards) if(c.tipo !== 'off') assert.ok(c.h >= (c.tipo === 'vol' ? alt.minVol : alt.minCob) - .5, `${aba} ${c.tipo} ${c.h}`);
        // cards do topo (o de ritmo; Base e Sem compra com supervisão ou rota): mesma altura na mesma linha, nenhum abaixo do mínimo
        assert.ok(alt.kpi.length > 0, `${aba}: nenhum card do topo`);
        const kpiLinha = {};
        for(const c of alt.kpi) (kpiLinha[c.top] = kpiLinha[c.top] || []).push(c.h);
        for(const [k, hs] of Object.entries(kpiLinha)) assert.ok(Math.max(...hs) - Math.min(...hs) <= 1, `${aba} KPIs ${k}: ${hs}`);
        assert.ok(Math.min(...alt.kpi.map(c => c.h)) >= alt.minKpi - .5, `${aba} KPIs ${JSON.stringify(alt.kpi)}`);
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
      // Etapa 7: a linha .entMarca virou as logos; o texto "Comercial Bandeirantes" é o .entElmoTxt
      await baixos(['.entElmoTxt', '.entRod'], `entrada ${tema}`);
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
      await abreCardTopo(page, id);
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
      const txt = p => p.$$eval('#lista .ind', els => els.map(e => e.innerText.replace(/\s+/g, ' ').trim()));
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
          est: __vis.estouros('#abaTopo, #lista .ind')}));
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
          assert.deepEqual(await page.evaluate(() => __vis.estouros('#abaTopo, #lista .ind, #puxa')), [], `${dados} ${aba}`);
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
   (Inter no atual). Sem o histórico do git (clone raso), os testes são pulados.
   Etapa 3 do pacote v3 (mudança autorizada pela Karen, só nos itens 4 a 8 do pedido): (1) a linha da cascata de todas as
   abas menos a Venda Zero (.cLin.v3: Nome | Meta · Real | % | Dif (Real + Online) | Online · meta do dia, selo .cSelo e o
   fundo .bat), o cabeçalho de colunas (.cOrd) e os chips "Ordenar:" (.cOrdCh) e a lista de clientes de volume com a coluna
   Online (.cCab.v3/.cCli.v3) são classes novas, todas dentro de um `.v3`: ficam FORA da comparação (no front de antes, saem
   as linhas .cLin que não são .off e o .cCab/.cCli que elas substituem); a caixa do Online da linha nova (.cMeio > *) é
   comparada com a de antes; (2) no PC (>= 1000 px), com a cascata aberta (#drw[data-casc]), a gaveta tem max-width 860 px
   (não é comparada) e o padding do .drwCab e do .corpo é menor: só esses paddings ficam fora; (3) na Diretoria a gerência
   abre direto a lista de clientes (o front de antes abria as supervisões): o cenário confere só o 1º nível. Linhas sem dados
   (.cLin.off), nota das virtuais, botão de voltar, barra de dias, Venda Zero inteira, listas de cobertura, Base e Sem compra
   continuam conferidos como sempre. */
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
// fora = seletor dos elementos que não entram (os da Etapa 3 do pacote v3, ver acima)
const ASSINA_GAVETA = ({props, fora}) => [...document.querySelectorAll('#drw, #drw *')].filter(el => !fora || !el.closest(fora)).map(el => {
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
  // (ICS_GC: 11 = até a Venda Zero, a única cascata com a linha de antes desde a Etapa 3 do pacote v3; `prepara` põe a AN12
  // acima da meta de Venda Zero, para ter linha .cLin.no nela: no sintético a Venda Zero está toda no ritmo)
  {nome: 'Gerência', dados: 'normal', entrar: 'gc', abas: {VOLUME: 2, ICS_GC: 11, NOVOS_NEG: 1}, topo: true,
   prepara: p => p.evaluate(() => { nodo('', 'AN12').indicators.VENDAZERO.real = 5; render(); })},
  // soTopo: na Diretoria a gerência abre direto a lista de clientes (Etapa 3 do pacote v3); o front de antes abria as supervisões
  {nome: 'Diretoria', dados: 'normal', entrar: 'dir', abas: {VOLUME: 1, ICS_GC: 1}, soTopo: true},
  {nome: 'grupo IT+MO', dados: 'grupo', entrar: {perfil: 'gc', gc: 'IT+MO'}, abas: {VOLUME: 1, ICS_GC: 1}},
  {nome: 'Supervisão', dados: 'normal', entrar: {perfil: 'sv', gc: 'G2', sv: '1'}, abas: {VOLUME: 1, ICS_GC: 1}},
  {nome: 'fechamento', dados: 'fech', entrar: 'gc', abas: {VOLUME: 1, ICS_GC: 1}},
  {nome: 'Todos a Bordo', dados: 'inc', entrar: {perfil: 'gc', gc: 'IT+MO'}, abas: {INCENTIVO: 5}},
  // Etapa 6: barra de dias com clientes sem compra no mês e dias de visita variados (gavetas Base e Sem compra cheias)
  {nome: 'barra de dias', dados: 'dias', entrar: {perfil: 'sv', gc: 'G2', sv: '1'}, abas: {VOLUME: 1}, topo: true},
];

describe('Parte N — cascata como antes do ajuste visual, só com a Inter', {skip: pular || (!FRONT_ANTIGO && `sem o commit ${REF_CASCATA}`)}, () => {
  for(const largura of [1280, 390]){
    test(`${largura} px: todos os níveis da cascata com o estilo do ${REF_CASCATA} (só a família muda), sem texto cortado nem invadindo`, async () => {
      const vistos = new Set(), cortes = new Set(), espelhos = new Set(), caixas = new Set();
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
          if(c.prepara) for(const {page} of [novo, velho]) await c.prepara(page);
          // Etapa 6: a barra de dias (o chipsHtml de sempre) entrou na lista de clientes de volume e nas gavetas Base e Sem
          // compra, onde o front do 0a59eb4 não tinha barra. Nesses casos: (a) fora da barra, a marcação é a do 0a59eb4 (só no
          // estado que o 0a59eb4 também tem: `soNovo` = um chip que ele não tinha); (b) a marcação inteira do atual vai para a
          // gaveta do 0a59eb4 (com o CSS dele; os nós dele voltam depois, com os eventos) e o estilo de CADA elemento, barra
          // inclusive, é comparado com o de lá, como no resto
          const semBarraAntes = async () => !!(await novo.page.$('#dCorpo .chips')) && !(await velho.page.$('#dCorpo .chips'));
          const confere = async (onde, soNovo = false) => {
            const espelho = await semBarraAntes();
            // Etapa 3 do pacote v3: o conteúdo novo (.v3) fica fora; no front de antes, as linhas e a lista que ele substitui
            const v3 = !!(await novo.page.$('#dCorpo .v3'));
            const foraNovo = '.v3', foraVelho = v3 ? '.v3, .cLin:not(.off), .cCab, .cCli' : '.v3';
            const casc = largura >= 1000 && !!(await novo.page.$('#drw[data-casc]'));
            if(v3) await confereCaixaV3(onde);
            let [a, b] = await Promise.all([novo.page.evaluate(ASSINA_GAVETA, {props: PROPS_CASCATA, fora: foraNovo}),
                                            velho.page.evaluate(ASSINA_GAVETA, {props: PROPS_CASCATA, fora: foraVelho})]);
            if(espelho){
              if(!soNovo) assert.deepEqual(a.map(x => x[0]).filter(n => !/^(div\.chips|button\.dchip)(\.|$)/.test(n)), b.map(x => x[0]),
                                           `${onde}: mesma marcação do ${REF_CASCATA} fora da barra de dias`);
              const html = await novo.page.$eval('#dCorpo', el => el.innerHTML);
              await velho.page.evaluate(html => { const c = document.getElementById('dCorpo');
                window.__nosAntes = [...c.childNodes]; c.innerHTML = html; }, html);
              b = await velho.page.evaluate(ASSINA_GAVETA, {props: PROPS_CASCATA, fora: foraNovo});
              await velho.page.evaluate(() => { document.getElementById('dCorpo').replaceChildren(...window.__nosAntes); });
              espelhos.add(await novo.page.evaluate(() => document.querySelector('#dCorpo .cCli, #dCorpo .cCab') ? 'volume'
                : document.getElementById('dTit').textContent));
            }
            assert.deepEqual(a.map(x => x[0]), b.map(x => x[0]), `${onde}: mesma marcação`);
            a.forEach(([nome, v, fam, cortado, txt], i) => {
              vistos.add(nome);
              assert.match(fam, /^Inter,/, `${onde} ${nome}: família`);
              for(const p of PROPS_CASCATA){
                // gaveta da cascata no PC: o padding do cabeçalho e do corpo é menor (Etapa 3 do pacote v3)
                // (e a margem automática da gaveta, que centraliza os 860 px)
                if(casc && /^padding-/.test(p) && /^div\.(drwCab|corpo)(\.|$)/.test(nome)) continue;
                if(casc && /^margin-(left|right)$/.test(p) && /^div\.drw(\.|$)/.test(nome)) continue;
                // (a linha sem dados é a de antes, com as mesmas frações; só a largura em px muda com a gaveta mais larga)
                if(casc && p === 'grid-template-columns' && /^div\.cLin\.off(\.|$)/.test(nome)) continue;
                assert.ok(mesmoValor(v[p], b[i][1][p]), `${onde} ${nome} "${txt}": ${p} = ${v[p]}, antes ${b[i][1][p]}`);
              }
              if(cortado){
                // só as células que já cortavam com reticências antes (nome numa coluna estreita), e cortadas também lá
                assert.equal(v['text-overflow'], 'ellipsis', `${onde} ${nome} "${txt}": texto cortado`);
                assert.ok(b[i][3], `${onde} ${nome} "${txt}": corta com a Inter e não cortava antes`);
                cortes.add(`${nome} "${txt}"`);
              }
            });
            assert.deepEqual(await novo.page.evaluate(INVASOES), [], `${onde}: coluna invadindo a vizinha`);
          };
          // a caixa do Online da linha nova (.cLin.v3 .cMeio > *) com o estilo da de antes (mesma classe, mesmo cenário)
          const CAIXAS = ({props, sel}) => [...document.querySelectorAll(sel)].map(el => {
            const cs = getComputedStyle(el), v = {};
            for(const p of props) v[p] = cs.getPropertyValue(p);
            return [el.tagName.toLowerCase() + '.' + el.className.trim().split(/\s+/).join('.'), v];
          });
          const confereCaixaV3 = async onde => {
            const props = PROPS_CASCATA.filter(p => p !== 'text-align');
            const novas = await novo.page.evaluate(CAIXAS, {props, sel: '#dCorpo .cLin.v3 .cMeio > *'});
            const antes = new Map(await velho.page.evaluate(CAIXAS, {props, sel: '#dCorpo .cLin .cMeio > *'}));
            for(const [nome, v] of novas){
              if(!antes.has(nome)) continue;
              caixas.add(nome);
              for(const p of props) assert.ok(mesmoValor(v[p], antes.get(nome)[p]), `${onde} caixa ${nome}: ${p} = ${v[p]}, antes ${antes.get(nome)[p]}`);
            }
          };
          // percorre: card -> nível de cima -> ... -> clientes (e os chips "Todos" e "Seg" das listas de clientes; no front do
          // 0a59eb4 só onde ele já tinha a barra, a das coberturas)
          const desce = async (abrir, onde) => {
            for(const {page} of [novo, velho]) await abrir(page);
            for(let nivel = 0; nivel < 5; nivel++){
              for(const {page} of [novo, velho]) await page.waitForTimeout(30);
              await confere(`${onde} nível ${nivel}`);
              const prox = await novo.page.$('#dCorpo .cLin[data-i]');
              if(!prox || c.soTopo) break;
              for(const {page} of [novo, velho]) await page.click('#dCorpo .cLin[data-i]');
            }
            for(const d of ['Todos', 'Seg']){
              const chip = `#dCorpo .dchip[data-d="${d}"]`;
              if(!(await novo.page.$(chip))) continue;
              const antes = !!(await velho.page.$(chip));
              await novo.page.click(chip);
              if(antes) await velho.page.click(chip);
              await confere(`${onde} chip ${d}`, !antes);
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
          if(c.topo) for(const id of ['cBase', 'cSem']) await desce(p => abreCardTopo(p, id), `${c.nome} ${tema} ${id}`);
          assert.deepEqual(novo.erros, []);
          await novo.ctx.close(); await velho.ctx.close();
        }
      }
      // os tipos de linha e elemento da cascata apareceram na conferência
      // (Etapa 3 do pacote v3: .cLin.ok/.no conferidas são as da Venda Zero; .cCab/.cCli e os .pos/.neg delas saíram da
      // comparação, ver acima; a caixa do Online das linhas novas, com o estilo da de antes)
      for(const t of ['h2', 'div.s', 'button.fechar', 'button.cVolta', 'div.cLin.ok', 'div.cLin.no', 'div.cLin.off', 'span.cOn.ok',
                      'span.cOn', 'div.cNota', 'div.item', 'div.item.riscado',
                      'span.tagOnline', 'button.dchip', 'button.dchip.on', 'div.chips', 'div.vazio', 'div.bd'])
        assert.ok([...vistos].some(v => v === t || v.startsWith(t + '.')), `nenhum ${t} conferido`);
      for(const t of ['span.cOn.ok', 'span.cOn.no', 'span.cOn.nd'])
        assert.ok(caixas.has(t), `caixa ${t} da linha nova não conferida`);
      // a barra de dias nova (Etapa 6) foi conferida contra o CSS do 0a59eb4 nas três listas e nos estados de cada gaveta
      for(const t of ['volume', 'Visitas de hoje', 'Clientes da base', 'Sem compra hoje', 'Sem compra'])
        assert.ok(espelhos.has(t), `barra de dias de "${t}" não conferida`);
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
        assert.ok(await page.evaluate(l => [...document.querySelectorAll('#lista .ind, #abaTopo .card, #abaTopo .busca, .rsBox, .rodape')]
          .filter(el => el.getClientRects().length)
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

/* ---------- Parte V — cabeçalho das abas (Etapa 4) ----------
   Nome da aba + etiqueta do dia com a caixa de comentário (mouse, teclado e toque); linha de resumo com o card de ritmo,
   o "puxa a média" (quadro de destaque) e a busca; Base e Sem compra só com supervisão (ou "Neutraliza") ou rota no
   filtro, com três cards lado a lado sem o "puxa a média" (a Rota); filtro rápido dos cards. Os números do cabeçalho, os
   cards e a ficha da busca são comparados com o front de antes da Etapa 4 (index.html, CSS e app.js do REF_ETAPA4,
   servidos por `troca`; sem o histórico do git, esse teste é pulado). */
const REF_ETAPA4 = 'a70a2c3';
const FRONT_ETAPA3 = (() => {
  try {
    const arq = f => execSync(`git show ${REF_ETAPA4}:frontend/${f}`, {cwd: RAIZ, stdio: ['ignore', 'pipe', 'ignore']}).toString();
    const [html, css, js] = ['index.html', 'css/app.css', 'js/app.js'].map(arq);
    return {'/index.html': () => html, '/css/app.css': () => css, '/js/app.js': () => js};
  } catch(e) { return null; }
})();
// números do cabeçalho da aba, lidos do mesmo jeito nos dois fronts
const CABECALHO = () => {
  const $ = id => document.getElementById(id), txt = id => $(id).textContent.replace(/\s+/g, ' ').trim();
  const t = document.querySelector('#puxa .t'), s = document.querySelector('#puxa .s');
  let puxa = null;
  if(t){
    // antes: "<Nível> que mais puxa a média para baixo: <b>nome</b>" e "x de n indicadores na meta"; agora: o título, o
    // nome em vermelho e "x de n indicadores no ritmo"
    const m = s.textContent.match(/(\d+) de (\d+) indicadores/);
    puxa = {quem: t.textContent.match(/^(\S+) que mais puxa a média para baixo/)[1],
            nome: (s.querySelector('b') || t.querySelector('b')).textContent, ok: +m[1], tot: +m[2]};
  }
  const st = $('stRitmo'), semHoje = $('xSem').querySelector('b.no');
  return {rotulo: txt('lRitmo'), n: txt('nRitmo'), cls: $('nRitmo').className.trim(), x: txt('xRitmo'),
          status: st.hidden ? null : st.textContent.replace(/\s+/g, ' ').trim(), puxa,
          base: txt('nBase'), lSem: txt('lSem'), sem: txt('nSem'), semCls: $('nSem').className.trim(),
          visitas: ($('xBase').querySelector('b') || {}).textContent, semHoje: semHoje ? semHoje.textContent : txt('xSem'),
          // (com a Diferença de antes, Real − Meta: desde 29/10/2026 o card mostra (Real + online) − Meta; trocada só para a
          // leitura, pelos valores exatos do div, e devolvida depois)
          lista: (() => { const ds = [...document.querySelectorAll('#lista .ind .dif[data-ro]')].map(el => {
              const s = [el.textContent, el.className], d = Number(el.dataset.real) - Number(el.dataset.meta);
              el.textContent = `Diferença ${d > 0 ? '+' : ''}${(el.hasAttribute('data-vol') ? Math.round(d) : d).toLocaleString('pt-BR')}`;
              el.className = `dif ${d >= 0 ? 'pos' : 'neg'}`; return [el, s]; });
            const l = [...document.querySelectorAll('#lista .ind')].map(e => e.innerText.replace(/\s+/g, ' ').trim());
            ds.forEach(([el, s]) => { el.textContent = s[0]; el.className = s[1]; }); return l; })()};
};
// mesma variedade de ritmo nos dois fronts: as rotas, em ordem, com 0, 50% e 150% da meta (coberturas e tendência)
const variedade = page => page.evaluate(() => Object.keys(ROTA_IDX).sort().forEach((r, i) => {
  for(const b of Object.values(nodo('', r).indicators)){
    if(b.unavailable || b.meta == null) continue;
    const f = [0, 0.5, 1.5][i % 3];
    b.real = b.meta * f;
    if(b.tendencia != null) b.tendencia = b.meta * f;
  }
}));
const geometria = page => page.evaluate(() => {
  const b = s => { const e = document.querySelector(s); return e && e.getClientRects().length ? e.getBoundingClientRect().toJSON() : null; };
  return {base: b('#cBase'), sem: b('#cSem'), rit: b('#cRitmo'), puxa: b('#puxa'), busca: b('#abaTopo .busca'), cli: b('#cli'),
          chips: b('#abFil'), lista: b('#lista'), sec: b('#abaTopo'), st: b('#stRitmo'), tit: document.getElementById('abTit').textContent,
          aba: document.querySelector(`.tab[data-g="${aba}"]`).title, rotulo: document.getElementById('lRitmo').textContent};
});
const perto = (a, b, tol = 1) => Math.abs(a - b) <= tol;

describe('Parte V — cabeçalho das abas (Etapa 4)', {skip: pular}, () => {
  const PERFIS_V = [
    {nome: 'Diretoria', entrar: 'dir', base: false},
    {nome: 'Gerência G1', entrar: {perfil: 'gc', gc: 'G1'}, base: false},
    {nome: 'grupo IT+MO', entrar: {perfil: 'gc', gc: 'IT+MO'}, base: false},
    {nome: 'Gerência G1 · Neutraliza no filtro', entrar: {perfil: 'gc', gc: 'G1'}, sv: 'Neutraliza', base: true},
    {nome: 'Gerência G2 · SV.G2.1 no filtro', entrar: {perfil: 'gc', gc: 'G2'}, sv: 'SV.G2.1', base: true},
    {nome: 'Supervisão', entrar: {perfil: 'sv', gc: 'G2', sv: '1'}, base: true},
    {nome: 'Rota', entrar: {perfil: 'rota', gc: 'G2', rota: 'G211'}, base: true},
  ];

  test('números do cabeçalho iguais aos do front de antes (ritmo x / n, "puxa a média", Base, Sem compra, visitas); cards e ficha da busca iguais', {skip: !FRONT_ETAPA3 && `sem o commit ${REF_ETAPA4}`}, async () => {
    const vistos = new Set();
    for(const c of PERFIS_V){
      const [novo, velho] = [await abre('inc', {entrar: c.entrar, largura: 1280}),
                             await abre('inc', {entrar: c.entrar, largura: 1280, troca: FRONT_ETAPA3})];
      for(const {page} of [novo, velho]){
        await variedade(page);
        if(c.sv) await filtra(page, {gc: await page.evaluate(() => sel.gc), sv: c.sv});
      }
      for(const aba of ['VOLUME', 'ICS_GC', 'NOVOS_NEG', 'INCENTIVO']){
        for(const {page} of [novo, velho]) await filtra(page, {aba});
        const onde = `${c.nome} ${aba}`;
        const [a, b] = [await novo.page.evaluate(CABECALHO), await velho.page.evaluate(CABECALHO)];
        // só o rótulo do card de ritmo do Volume muda ("Categorias na tendência", mesma regra) e, desde o ajuste de rótulos,
        // o nome do card do macro VOL DEST+ART+CND ("Novos Negócios" com a 2ª linha "Dest+Art+Cnd")
        assert.deepEqual(a, {...b, rotulo: aba === 'VOLUME' ? 'Categorias na tendência' : b.rotulo,
          lista: b.lista.map(t => t.replace(/^Dest\+Art\+Cnd /, 'Novos Negócios Dest+Art+Cnd '))}, onde);
        if(a.puxa) vistos.add(a.puxa.quem);
        if(a.status) vistos.add('status');
        // Base e Sem compra só com supervisão (ou "Neutraliza") ou rota no filtro
        assert.deepEqual([await novo.page.isVisible('#cBase'), await novo.page.isVisible('#cSem')], [c.base, c.base], onde);
      }
      // busca: a mesma ficha (a lógica não mudou), agora logo abaixo da linha de resumo
      for(const aba of ['VOLUME', 'ICS_GC', 'INCENTIVO']){
        for(const {page} of [novo, velho]) await filtra(page, {aba});
        const pv = await novo.page.evaluate(() => { const r = rotasVisiveis().find(x => (CLIENT_ROSTER[x] || []).length);
          return r ? String(CLIENT_ROSTER[r][0][0]) : ''; });
        for(const {page} of [novo, velho]) await page.fill('#q', pv);
        const cli = p => p.evaluate(() => document.getElementById('cli').innerHTML.replace(/ style="[^"]*"/g, ''));
        const [x, y] = [await cli(novo.page), await cli(velho.page)];
        assert.match(x, /class="cli"/, `${c.nome} ${aba}: ficha`);
        assert.equal(...igualRotulo(x, y), `${c.nome} ${aba}: ficha do cliente`);
        for(const {page} of [novo, velho]) await page.fill('#q', '');
      }
      assert.deepEqual(novo.erros, [], c.nome);
      await novo.ctx.close(); await velho.ctx.close();
    }
    for(const t of ['Gerência', 'Supervisão', 'Rota', 'status']) assert.ok(vistos.has(t), `nenhum caso com ${t}`);
  });

  for(const largura of [1440, 390]){
    test(`${largura} px: título da aba, linha de resumo (ritmo | "puxa a média" | busca), Base e Sem compra só com supervisão ou rota, Rota com 3 cards, Todos a Bordo com Status, ficha logo abaixo`, async () => {
      const pc = largura >= 1000;
      for(const c of [{nome: 'Diretoria', entrar: 'dir', base: false, zera: () => rotasDe('G1', '')},
                      {nome: 'Gerência', entrar: {perfil: 'gc', gc: 'G1'}, base: false, zera: () => rotasDe('G1', 'SV.G1.1')},
                      {nome: 'Supervisão', entrar: {perfil: 'sv', gc: 'G2', sv: '1'}, base: true, zera: () => ['G211']},
                      {nome: 'Rota', entrar: {perfil: 'rota', gc: 'G2', rota: 'G211'}, base: true, zera: () => []}]){
        const {page, ctx, erros} = await abre('inc', {largura, altura: 900, entrar: c.entrar});
        await medidas(page);
        // todas as rotas no ritmo e uma unidade zerada: "puxa a média" nas abas de volume e coberturas (menos na Rota)
        await ritmo(page, '', await page.evaluate(() => Object.keys(ROTA_IDX)), 1);
        await ritmo(page, '', await page.evaluate(`(${c.zera})()`), 0);
        for(const aba of ['VOLUME', 'ICS_GC', 'NOVOS_NEG', 'INCENTIVO']){
          await filtra(page, {aba});
          const onde = `${c.nome} ${aba}`, g = await geometria(page);
          assert.equal(g.tit, g.aba, `${onde}: título`);
          const temPuxa = aba !== 'INCENTIVO' && c.nome !== 'Rota';
          assert.equal(!!g.puxa, temPuxa, `${onde}: "puxa a média"`);
          assert.equal(!!g.base && !!g.sem, c.base, `${onde}: Base e Sem compra`);
          if(!c.base) assert.ok(!g.base && !g.sem, `${onde}: sem Base e Sem compra`);
          if(c.base && !temPuxa){
            // três cards lado a lado (Base, Sem compra e o de ritmo) e a busca sozinha na linha de baixo
            assert.ok(perto(g.base.top, g.rit.top) && perto(g.sem.top, g.rit.top), `${onde}: 3 cards na mesma linha`);
            assert.ok(g.base.right <= g.sem.left && g.sem.right <= g.rit.left, `${onde}: Base | Sem compra | ritmo`);
            assert.ok(perto(g.base.width, g.rit.width) && perto(g.sem.width, g.rit.width), `${onde}: mesma largura`);
            assert.ok(g.busca.top >= g.rit.bottom && perto(g.busca.width, g.sec.width), `${onde}: busca na linha de baixo`);
          } else {
            if(c.base) assert.ok(g.base.bottom <= g.rit.top && perto(g.base.top, g.sem.top), `${onde}: Base e Sem compra acima da linha`);
            if(temPuxa) assert.ok(perto(g.puxa.top, g.rit.top) && g.puxa.left >= g.rit.right, `${onde}: ritmo | puxa`);
            if(pc){
              // 260 px | 1fr | 1.1fr
              assert.ok(perto(g.rit.width, 260), `${onde}: card de ritmo ${g.rit.width}`);
              assert.ok(perto(g.busca.top, g.rit.top) && g.busca.left >= (temPuxa ? g.puxa : g.rit).right, `${onde}: busca na linha`);
              if(temPuxa) assert.ok(g.busca.width > g.puxa.width, `${onde}: 1fr | 1.1fr`);
            } else {
              assert.ok(g.busca.top >= g.rit.bottom && perto(g.busca.width, g.sec.width), `${onde}: busca na linha inteira abaixo`);
            }
          }
          if(temPuxa){
            const p = await page.evaluate(() => { const b = document.querySelector('#puxa .s b'), ref = document.createElement('span');
              ref.style.color = 'var(--vermelho2)'; document.body.appendChild(ref); const v = getComputedStyle(ref).color; ref.remove();
              return {fi: document.querySelector('#puxa .fi').textContent, t: document.querySelector('#puxa .t').textContent,
                      s: document.querySelector('#puxa .s').textContent, cor: getComputedStyle(b).color, vermelho: v}; });
            assert.equal(p.fi, '!');
            assert.match(p.t, /^(Gerência|Supervisão|Rota) que mais puxa a média para baixo$/, onde);
            assert.match(p.s, /^.+ · \d+ de \d+ indicadores no ritmo$/, onde);
            assert.equal(p.cor, p.vermelho, `${onde}: nome em vermelho`);
          }
          // Todos a Bordo: "Itens em 100%" com a linha Status (os itens com meta no escopo)
          if(aba === 'INCENTIVO') assert.ok(g.rotulo === 'Itens em 100%' && g.st, `${onde}: Status`);
          else assert.equal(g.rotulo, aba === 'VOLUME' ? 'Categorias na tendência' : 'Ritmo de coberturas', onde);
          assert.ok(g.chips.top >= Math.max(g.busca.bottom, g.rit.bottom) && g.lista.top >= g.chips.bottom, `${onde}: filtro acima da grade`);
          assert.deepEqual(await page.evaluate(() => __vis.estouros('#abaTopo')), [], onde);
          assert.ok(await semRolagemLateral(page), `${onde}: rolagem lateral`);
        }
        // a ficha do cliente abre logo abaixo da linha de resumo (acima do filtro e da grade)
        await filtra(page, {aba: 'VOLUME'});
        const pv = await page.evaluate(() => String(CLIENT_ROSTER[rotasVisiveis().find(x => (CLIENT_ROSTER[x] || []).length)][0][0]));
        await page.fill('#q', pv);
        const g = await geometria(page);
        assert.ok(g.cli && g.cli.top >= Math.max(g.busca.bottom, g.rit.bottom) && g.cli.bottom <= g.chips.top, `${c.nome}: ficha abaixo da linha`);
        assert.deepEqual(await page.evaluate(() => __vis.estouros('#abaTopo')), [], `${c.nome}: ficha`);
        assert.ok(await semRolagemLateral(page));
        assert.deepEqual(erros, [], c.nome);
        await ctx.close();
      }
    });
  }

  test('etiqueta do dia e caixa de comentário: PC (mouse acompanhando o cursor, teclado, ESC) e celular (toque, toque fora, rolar); um div.dica só', async () => {
    let {page, ctx, erros} = await abre('normal', {largura: 1440, altura: 900});
    const esperado = await page.evaluate(() => { const T = P.TOTAL_DIAS_UTEIS;
      return {pc: `Dia útil ${P.DIA_HOJE} de ${T} · Semana ${P.SEMANA_NUM}`, cel: `${P.DIA_SEMANA} · Sem. ${P.SEMANA_NUM}`,
        linhas: [`${P.DIA_SEMANA} · dia útil ${P.DIA_HOJE} de ${T}`, `Real até ontem: dia útil ${P.DIA_ONTEM}/${T} (${P.PACE_ONTEM_PCT}%)`,
                 `Para entrar no ritmo hoje: ${Math.round(P.DIA_HOJE / T * 100)}%`, `Semana N°${P.SEMANA_NUM} (${P.SEMANA_TIPO})`,
                 `Dias úteis pela frente, com hoje: ${T - P.DIA_HOJE + 1}`]}; });
    const estado = () => page.evaluate(() => {
      const ds = document.querySelectorAll('.dica'), d = ds[0], cs = d && getComputedStyle(d), r = d && d.getBoundingClientRect();
      const pil = document.getElementById('pilDia'), vis = s => [...pil.querySelectorAll(s)].filter(e => e.getClientRects().length).map(e => e.textContent);
      return {n: ds.length, on: !!d && d.classList.contains('on') && cs.visibility === 'visible',
              linhas: d ? d.innerText.split('\n').map(x => x.trim()).filter(Boolean) : [],
              emFoco: [...document.querySelectorAll('.emFoco')].map(e => e.id), foco: !!document.querySelector('#pilDia.foco, .dica.foco'),
              desc: pil.getAttribute('aria-describedby'), etiqueta: vis('.pdL, .pdC'), i: vis('.pdI'),
              css: d && {pos: cs.position, bg: cs.backgroundColor, cor: cs.color, fs: cs.fontSize, raio: cs.borderRadius,
                         role: d.getAttribute('role'), id: d.id},
              caixa: r && {l: r.left, t: r.top, r: r.right, b: r.bottom}, estilo: d && [parseFloat(d.style.left), parseFloat(d.style.top)],
              pil: pil.getBoundingClientRect().toJSON(), vw: innerWidth, vh: innerHeight};
    });
    let e = await estado();
    assert.deepEqual([e.etiqueta, e.i, e.on], [[esperado.pc], ['i'], false]);
    // mouse: aparece com o cursor em cima e acompanha; some ao sair
    const box = await page.locator('#pilDia').boundingBox();
    await page.mouse.move(box.x + 12, box.y + box.height / 2);
    e = await estado();
    assert.ok(e.on, 'hover: dica aberta');
    assert.deepEqual(e.linhas, esperado.linhas);
    assert.deepEqual(e.css, {pos: 'fixed', bg: 'rgb(28, 28, 30)', cor: 'rgb(255, 255, 255)', fs: '12px', raio: '9px', role: 'tooltip', id: 'dica'});
    assert.deepEqual([e.n, e.emFoco, e.foco, e.desc], [1, ['pilDia'], false, 'dica']);
    assert.ok(e.caixa.l >= 8 && e.caixa.r <= e.vw - 8 && e.caixa.t >= 8 && e.caixa.b <= e.vh - 8, JSON.stringify(e.caixa));
    // acompanha o cursor (16 px abaixo dele; a etiqueta fica no canto direito, então a caixa encosta na margem e anda na vertical)
    const y0 = e.estilo[1];
    assert.ok(perto(y0, box.y + box.height / 2 + 16), `16 px abaixo do cursor: ${y0}`);
    await page.mouse.move(box.x + 12, box.y + box.height - 3);
    e = await estado();
    assert.ok(e.on && perto(e.estilo[1] - y0, box.height / 2 - 3), `acompanha o cursor: ${y0} -> ${e.estilo[1]}`);
    // tons claros para o fundo escuro: vermelho (.v) e verde (.g)
    const cores = await page.evaluate(() => { const d = document.querySelector('.dica'), g = document.createElement('b');
      g.className = 'g'; d.appendChild(g); const c = [getComputedStyle(d.querySelector('.v')).color, getComputedStyle(g).color]; g.remove(); return c; });
    assert.deepEqual(cores, ['rgb(255, 154, 154)', 'rgb(127, 224, 189)']);
    await page.mouse.move(box.x - 300, box.y + 300);
    e = await estado();
    assert.deepEqual([e.on, e.emFoco, e.desc], [false, [], null], 'saiu: dica fechada');
    // teclado: no foco (Shift+Tab a partir da busca), abaixo da etiqueta; ESC e blur fecham
    await page.focus('#q');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'pilDia');
    e = await estado();
    assert.ok(e.on && e.caixa.t >= e.pil.bottom, 'foco: dica abaixo da etiqueta');
    assert.deepEqual(e.linhas, esperado.linhas);
    await page.keyboard.press('Escape');
    assert.equal((await estado()).on, false, 'ESC');
    await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab');
    assert.equal((await estado()).on, true, 'foco de novo');
    await page.focus('#q');
    assert.equal((await estado()).on, false, 'blur');
    assert.equal((await estado()).n, 1, 'um div.dica só');
    assert.deepEqual(erros, []);
    await ctx.close();
    // celular (toque): "Quarta-feira · Sem. 3"; abre e fecha no toque; toque fora e rolar a página fecham
    ({page, ctx, erros} = await abre('normal', {largura: 390, altura: 844, toque: true}));
    e = await estado();
    assert.deepEqual(e.etiqueta, [esperado.cel]);
    await page.tap('#pilDia');
    e = await estado();
    assert.ok(e.on, 'toque: abre');
    assert.deepEqual([e.linhas, e.emFoco], [esperado.linhas, ['pilDia']]);
    assert.ok(e.caixa.l >= 8 && e.caixa.r <= e.vw - 8, `dentro da tela: ${JSON.stringify(e.caixa)}`);
    await page.tap('#pilDia');
    assert.equal((await estado()).on, false, 'toque de novo: fecha');
    await page.tap('#pilDia');
    assert.equal((await estado()).on, true);
    await page.tap('#abTit');
    assert.equal((await estado()).on, false, 'toque fora: fecha');
    await page.tap('#pilDia');
    assert.equal((await estado()).on, true);
    await page.evaluate(() => scrollBy(0, 200));
    await page.waitForFunction(() => !document.querySelector('.dica').classList.contains('on'));
    assert.deepEqual((await estado()).emFoco, [], 'rolar: fecha');
    assert.deepEqual(erros, []);
    await ctx.close();
    // fechamento do mês: o calendário já está fechado, sem "dias úteis pela frente"
    ({page, ctx, erros} = await abre('fech', {largura: 1440, altura: 900}));
    await page.focus('#pilDia');
    e = await estado();
    assert.ok(e.on && e.linhas.length === 4 && !e.linhas.some(l => /pela frente/.test(l)), e.linhas.join(' | '));
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('filtro rápido dos cards: Todos · Abaixo · No ritmo só mostram e ocultam (ordem e cores iguais), .off só em Todos, chip sem card desabilitado, volta para Todos ao trocar de aba', async () => {
    const {page, ctx, erros} = await abre('normal', {largura: 1440, altura: 900, entrar: {perfil: 'gc', gc: 'G1'}});
    const rotas = await page.evaluate(() => rotasDe('G1', ''));
    await ritmo(page, 'G1', rotas, 1);
    // quatro coberturas do ICS abaixo do ritmo e a KAPO indisponível em todas as rotas (card .off)
    await page.evaluate(rotas => rotas.forEach(r => { const ind = nodo('', r).indicators;
      for(const k of ['CCTM 2L PET', 'KS TT', 'REFRI SABORES ZERO', 'CERVEJAS']) if(ind[k] && !ind[k].unavailable) ind[k].real = 0;
      ind.KAPO = {unavailable: true}; }), rotas);
    await filtra(page, {aba: 'ICS_GC'});
    const cards = () => page.evaluate(() => [...document.querySelectorAll('#lista .ind')].map(el => ({
      k: el.dataset.k || el.querySelector('.tit').textContent, off: el.classList.contains('off'), ok: el.classList.contains('ok'),
      vis: el.getClientRects().length > 0, bg: getComputedStyle(el).backgroundColor, faixa: getComputedStyle(el).borderLeftColor})));
    const chips = () => page.$$eval('#abFil .fchip', bs => bs.map(b => [b.dataset.f, b.textContent.replace(/\s+/g, ' ').trim(),
      b.getAttribute('aria-pressed'), b.disabled]));
    const antes = await cards();
    const abaixo = antes.filter(c => !c.off && !c.ok), noRitmo = antes.filter(c => c.ok);
    assert.ok(antes.some(c => c.off) && abaixo.length && noRitmo.length, JSON.stringify(antes.map(c => [c.k, c.off, c.ok])));
    assert.ok(antes.every(c => c.vis));
    assert.deepEqual(await chips(), [['todos', `Todos ${antes.length}`, 'true', false], ['abaixo', `Abaixo ${abaixo.length}`, 'false', false],
                                     ['ritmo', `No ritmo ${noRitmo.length}`, 'false', false]]);
    // só mostra e oculta: mesmos cards, na mesma ordem, com as mesmas cores; o .off só em "Todos"
    const confere = async (f, esperados) => {
      const d = await cards();
      assert.deepEqual(d.map(c => [c.k, c.off, c.ok, c.bg, c.faixa]), antes.map(c => [c.k, c.off, c.ok, c.bg, c.faixa]), `${f}: ordem e cores`);
      assert.deepEqual(d.filter(c => c.vis).map(c => c.k), esperados.map(c => c.k), f);
      assert.deepEqual((await chips()).map(c => c[2]), ['todos', 'abaixo', 'ritmo'].map(x => String(x === f)), `${f}: aria-pressed`);
    };
    await page.click('#abFil [data-f="abaixo"]');
    await confere('abaixo', abaixo);
    await page.click('#abFil [data-f="ritmo"]');
    await confere('ritmo', noRitmo);
    // uma atualização (online novo) mantém o filtro
    await page.evaluate(() => render());
    await confere('ritmo', noRitmo);
    await page.click('#abFil [data-f="todos"]');
    await confere('todos', antes);
    // trocar de aba volta para "Todos" (também ao voltar para a aba de antes)
    await page.click('#abFil [data-f="abaixo"]');
    await page.click('.tab[data-g="VOLUME"]');
    assert.equal((await chips())[0][2], 'true', 'Volume: Todos');
    assert.ok((await cards()).every(c => c.vis));
    await page.click('.tab[data-g="ICS_GC"]');
    await confere('todos', antes);
    // tudo no ritmo: "Abaixo" sem card fica desabilitado; o filtro escolhido sem card volta para "Todos"
    await page.click('#abFil [data-f="abaixo"]');
    await ritmo(page, 'G1', rotas, 1);
    await filtra(page, {});
    const ch = await chips();
    assert.deepEqual(ch[1], ['abaixo', 'Abaixo 0', 'false', true]);
    assert.equal(ch[0][2], 'true');
    assert.ok((await cards()).every(c => c.vis));
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  for(const largura of [360, 1000]){
    test(`${largura} px: cabeçalho da aba sem texto cortado nem rolagem lateral em todos os perfis e abas`, async () => {
      for(const [dados, entrar] of [['inc', 'dir'], ['inc', {perfil: 'gc', gc: 'IT+MO'}], ['inc', {perfil: 'sv', gc: 'G2', sv: '1'}],
                                    ['inc', {perfil: 'rota', gc: 'G2', rota: 'G211'}], ['grande', 'dir'], ['fech', 'gc']]){
        const {page, ctx, erros} = await abre(dados, {largura, altura: 900, entrar});
        await medidas(page);
        for(const aba of ['VOLUME', 'ICS_GC', 'NOVOS_NEG', 'INCENTIVO']){
          if(!(await page.$(`.tab[data-g="${aba}"]:not([hidden])`))) continue;
          await filtra(page, {aba});
          const onde = `${dados} ${JSON.stringify(entrar)} ${aba}`;
          assert.deepEqual(await page.evaluate(() => __vis.estouros('#abaTopo')), [], onde);
          assert.ok(await semRolagemLateral(page), `${onde}: rolagem lateral`);
        }
        assert.deepEqual(erros, []);
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
      // desde o ajuste de rótulos o macro VOL DEST+ART+CND se chama "Novos Negócios"
      assert.deepEqual(JSON.parse(JSON.stringify(limpa(monta(p, escopo)))),
                       JSON.parse(JSON.stringify(limpa(ctx.montaRitmo(p, escopo))).replace(/Dest\+Art\+Cnd/g, 'Novos Negócios')));
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
                      'Refrigerantes', 'Novos Negócios', 'Refri Sab. Zero', 'Cerv. 600ml Ret.', 'Venda Zero (KO)'])
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

/* ---------- Parte W — aba Executiva (Etapa 5) ----------
   Aba inicial de Diretoria, Gerência (e grupo) e Supervisão; a Rota não tem (abre no Volume). Unidades = os grupos da
   cascata (gerências; supervisões + "Neutraliza"; rotas), total BAND ou o código do filtro; virtuais, EV* e gerências sem
   dados fora das listas e dentro dos totais. Invariantes da seção 7 (executiva_invariantes.js, as mesmas da conferência
   com dado real), ordem e sinal das barras, caixa de comentário, categoria em análise, fechamento do mês, Evolução oculta,
   layout (1440, 1000, 390 e 360 px) e, comparando com o front da main antes da Etapa 5 (REF_ETAPA5, servido por `troca`),
   cards, cascata, Resumo e Painel de Ritmo iguais. Cenário 'exec' = o do Todos a Bordo com clientes sem compra no mês
   (montaSemCompra; o sintético compra tudo). */
const {confereExecutiva} = require('./executiva_invariantes.js');
const REF_ETAPA5 = '321b0ea';
const FRONT_ETAPA4 = (() => {
  try {
    const arq = f => execSync(`git show ${REF_ETAPA5}:frontend/${f}`, {cwd: RAIZ, stdio: ['ignore', 'pipe', 'ignore']}).toString();
    const [html, css, js, cfg] = ['index.html', 'css/app.css', 'js/app.js', 'js/config.js'].map(arq);
    // o resumo.js e o ritmo.js servidos são os atuais: o config.js antigo ganha o rotuloFront de agora com o rótulo de antes
    const shim = `\n;function rotuloFront(k, r){ return k === 'VOL DEST+ART+CND' ? 'Dest+Art+Cnd' : (r || k); }\n`;
    return {'/index.html': () => html, '/css/app.css': () => css, '/js/app.js': () => js, '/js/config.js': () => cfg + shim};
  } catch(e) { return null; }
})();

/* clientes sem compra no mês: por rota, na ordem dos códigos, 4 casos que se repetem — os dois últimos clientes (só o do
   meio agendado hoje, sem pedido online); os dois primeiros (agendados hoje, o primeiro com pedido online); nenhum; o
   primeiro (agendado, com pedido online). semCompra, compraram, SEM_COMPRA_MES, SEM_COMPRA_HOJE e VISITAS_DIA.semCompra
   ficam coerentes entre si (as virtuais e a rota oculta das EV*, sem dado de compra, ficam como estão). */
function montaSemCompra(p){
  const rotas = [];
  for(const gc in p.DATA) for(const sv in p.DATA[gc]) for(const r in p.DATA[gc][sv]) rotas.push([r, p.DATA[gc][sv][r]]);
  rotas.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0).forEach(([r, n], i) => {
    const cs = p.CLIENT_ROSTER[r] || [];
    if(!cs.length || n.compraram == null) return;
    const sem = [[1, 2], [0, 1], [], [0]][i % 4].filter(j => j < cs.length).map(j => cs[j]);
    n.semCompra = sem.length;
    n.compraram = cs.length - sem.length;
    p.SEM_COMPRA_MES[r] = sem.map(c => c[0]).sort((a, b) => a - b);
    p.SEM_COMPRA_HOJE[r] = sem.filter(c => c[4] === 1).map(c => c[0]);
    p.VISITAS_DIA.semCompra[r] = p.SEM_COMPRA_HOJE[r].length;
  });
}
// estado da tela: aba ativa, abas visíveis, Executiva/cards à vista e o que sobra do cabeçalho das abas
const telaExec = page => page.evaluate(() => {
  const vis = s => !!document.querySelector(s) && document.querySelector(s).getClientRects().length > 0;
  return {aba, tabs: [...document.querySelectorAll('.tab')].filter(t => !t.hidden).map(t => t.dataset.g),
    on: document.querySelector('.tab.on').dataset.g, exec: vis('#exec'), lista: vis('#lista'), tit: document.getElementById('abTit').textContent,
    pil: vis('#pilDia'), topo: ['#abBase', '#abRes', '#abFil', '#cli', '#q'].filter(vis)};
});
const linhasDiv = (page, k) => page.evaluate(k => [...document.querySelectorAll(`#exDivs .dv[data-k="${k}"] .dRow`)].map(r => {
  const i = r.querySelector('.dEixo i');
  return {u: r.dataset.u, d: Number(r.dataset.desvio), meta: Number(r.dataset.meta), real: Number(r.dataset.real),
    tot: r.classList.contains('tot'), val: r.querySelector('.dVal').textContent, cls: r.querySelector('.dVal').className,
    lado: r.querySelector('.dN i') ? 'N' : r.querySelector('.dP i') ? 'P' : '', w: i ? parseFloat(i.style.width) : 0};
}), k);
const VOL_EXEC = ['VOL REFRIGERANTES', 'VOL CERVEJAS', 'VOL STILL', 'VOL AGUA MINERAL', 'VOL DEST+ART+CND'];

/* Ajuste de rótulos (Parte AA): onde o front antigo mostra "Dest+Art+Cnd" o atual mostra "Novos Negócios" (no card de Volume,
   com a 2ª linha .tsub "Dest+Art+Cnd"). As comparações com fronts antigos tiram a 2ª linha do atual e trocam o nome no antigo;
   o resto continua igual, byte a byte. Desde os ajustes visuais da Executiva (Parte AE) o atual também perde a linha
   "faltam X para a meta" / "meta batida · +X" do medidor (.gFalta) e os data-meta/data-real do .gCard. */
/* Desde a Etapa 3 do pacote v3 o atual também desfaz a linha "Real + online" dos cards e a cascata nova (linha .cLin.v3,
   cabeçalho/chips de ordenação, lista de clientes com Online): CASC_INV.desfazCasc. */
const igualSemFalta = (novo, velho) => [require('./cascata_invariantes.js').desfazCasc(require('./rotulos_invariantes.js').desfazAE(novo)), velho];
const igualRotulo = (novo, velho) => {
  novo = require('./cascata_invariantes.js').desfazCasc(novo);
  const tiraSub = t => t.replace(/<div class=\\?"tsub\\?">[^<]*<\/div>/g, '').replace(/Novos Negócios(\s|\\n)+Dest\+Art\+Cnd/g, 'Novos Negócios');
  const j = (o, f) => typeof o === 'string' ? f(o) : JSON.parse(f(JSON.stringify(o)));
  return [j(require('./rotulos_invariantes.js').desfazAE(novo), tiraSub), j(velho, t => t.replace(/Dest\+Art\+Cnd/g, 'Novos Negócios'))];
};
describe('Parte W — aba Executiva (Etapa 5)', {skip: pular}, () => {
  test('aba inicial: Executiva na Diretoria, na Gerência (e no grupo) e na Supervisão; a Rota não tem e abre no Volume; rota no filtro tira a aba', async () => {
    for(const [dados, entrar, inicial] of [['exec', 'dir', 'EXEC'], ['exec', {perfil: 'gc', gc: 'G1'}, 'EXEC'],
        ['grupo', {perfil: 'gc', gc: 'IT+MO'}, 'EXEC'], ['exec', {perfil: 'sv', gc: 'G2', sv: '1'}, 'EXEC'],
        ['exec', {perfil: 'rota', gc: 'G2', rota: 'G211'}, 'VOLUME']]){
      const onde = JSON.stringify(entrar);
      const {page, ctx, erros} = await abre(dados, {entrar, aba: null});
      let e = await telaExec(page);
      assert.equal(e.aba, inicial, onde);
      assert.equal(e.on, inicial, onde);
      if(inicial === 'EXEC'){
        assert.equal(e.tabs[0], 'EXEC', `${onde}: primeira aba da barra`);
        assert.ok(e.exec && !e.lista, `${onde}: Executiva no lugar dos cards`);
        // do cabeçalho da aba ficam só o título e a etiqueta do dia (sem busca, cards do topo nem filtro rápido)
        // o título da aba é o nome dela, pelo perfil (Diretoria, Gerencial — também no grupo —, Supervisão)
        const nomeExec = {dir: 'Diretoria', gc: 'Gerencial', sv: 'Supervisão'}[entrar === 'dir' ? 'dir' : entrar.perfil];
        assert.deepEqual([e.tit, e.pil, e.topo], [nomeExec, true, []], onde);
        assert.equal(await page.getAttribute('.tab[data-g="EXEC"]', 'title'), nomeExec);
      } else {
        assert.ok(!e.tabs.includes('EXEC') && !e.exec && e.lista, `${onde}: sem a Executiva`);
        assert.equal(e.tit, 'Volume');
      }
      // outra aba e recarregar (acesso guardado) ou a casa e entrar de novo: de volta à aba inicial do perfil
      await vaiAba(page, 'ICS_GC');
      await page.reload();
      await esperaCarga(page);
      assert.equal((await telaExec(page)).aba, inicial, `${onde}: recarregar`);
      await vaiAba(page, 'NOVOS_NEG');
      await vaiPara(page, entrar, null);
      assert.equal((await telaExec(page)).aba, inicial, `${onde}: casa`);
      assert.deepEqual(erros, [], onde);
      await ctx.close();
    }
    // Gerência: uma rota no filtro tira a Executiva (o painel vai ao Volume); "Todas rotas" traz a aba de volta
    const {page, ctx, erros} = await abre('exec', {entrar: {perfil: 'gc', gc: 'G2'}, aba: null});
    await page.selectOption('#frota', 'G211');
    let e = await telaExec(page);
    assert.ok(!e.tabs.includes('EXEC') && e.aba === 'VOLUME' && !e.exec && e.lista, 'rota no filtro');
    await page.selectOption('#frota', '');
    e = await telaExec(page);
    assert.ok(e.tabs.includes('EXEC') && e.aba === 'VOLUME', 'sem rota: a aba volta (o painel fica no Volume)');
    await vaiAba(page, 'EXEC');
    assert.ok((await telaExec(page)).exec);
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('unidades = grupos da cascata (Diretoria, uma gerência, grupo no Total, supervisão, "Neutraliza"); total BAND ou o código; virtuais, EV* e gerência sem dados fora das listas e dentro dos totais', async () => {
    const casos = [
      {nome: 'Diretoria', dados: 'exec', entrar: 'dir', esperado: null},
      {nome: 'Diretoria · AN (virtuais A42-A44)', dados: 'exec', entrar: 'dir', dgc: 'AN', esperado: ['GC.AN', 'SV.AN.1', 'SV.AN.2', 'Neutraliza'],
       fora: ['A42', 'A43', 'A44']},
      {nome: 'Gerência G1', dados: 'exec', entrar: {perfil: 'gc', gc: 'G1'}, esperado: ['GC.G1', 'SV.G1.1', 'SV.G1.2', 'Neutraliza']},
      {nome: 'Gerência SL (clientes em EV*)', dados: 'exec', entrar: {perfil: 'gc', gc: 'SL'}, esperado: ['GC.SL', 'SV.SL.1', 'SV.SL.2'],
       fora: ['SL-EV']},
      {nome: 'grupo IT+MO no Total', dados: 'grupo', entrar: {perfil: 'gc', gc: 'IT+MO'},
       esperado: ['GC.IT+MO', 'SV.IT.1', 'SV.IT.2', 'SV.MO.1', 'SV.MO.2', 'Neutraliza'], fora: ['I32', 'MO-EV']},
      {nome: 'Supervisão', dados: 'exec', entrar: {perfil: 'sv', gc: 'G2', sv: '1'}, esperado: ['SV.G2.1', 'Rota G211', 'Rota G212']},
      {nome: '"Neutraliza" no filtro', dados: 'exec', entrar: {perfil: 'gc', gc: 'G1'}, sv: 'Neutraliza', esperado: ['Neutraliza', 'Rota 151']},
    ];
    for(const c of casos){
      const {page, ctx, erros} = await abre(c.dados, {entrar: c.entrar, aba: null});
      if(c.dgc) await page.selectOption('#fgc', c.dgc);
      if(c.sv) await page.selectOption('#fsv', c.sv);
      // Diretoria: as gerências com dados, na ordem do painel (a DI, sem dados, fica fora)
      const esperado = c.esperado || await page.evaluate(() => ['BAND', ...gcsComDados().map(g => 'GC.' + g)]);
      if(!c.esperado) assert.ok(!esperado.includes('GC.DI'), 'DI sem dados');
      const r = await page.evaluate(() => ({
        tabela: [...document.querySelectorAll('#exCob tbody tr')].map(t => t.dataset.u),
        tot: [...document.querySelectorAll('#exCob tbody tr.tot')].map(t => t.dataset.u),
        sem: [...document.querySelectorAll('#exSemc .hRow')].map(t => t.dataset.u),
        ag: [...document.querySelectorAll('#exAgenda .hRow')].map(t => t.dataset.u),
        divs: [...document.querySelectorAll('#exDivs .dv[data-k="VOL REFRIGERANTES"] .dRow')].map(t => t.dataset.u),
        sub: ['exTDiv', 'exTSem', 'exTAg', 'exTCob'].map(id => document.getElementById(id).textContent),
        base: [...document.querySelectorAll('#exSemc .hRow')].map(t => [t.classList.contains('tot'), Number(t.dataset.base)]),
        kpiBase: document.getElementById('exNBase').textContent}));
      // tabela de coberturas: total primeiro e as unidades na ordem da cascata (pelo código, "Neutraliza" por último)
      assert.deepEqual(r.tabela, esperado, `${c.nome}: tabela`);
      assert.deepEqual(r.tot, [esperado[0]], `${c.nome}: linha de total`);
      for(const [lista, nome] of [[r.sem, 'Sem compra'], [r.ag, 'Agenda'], [r.divs, 'Tendência x Meta']])
        assert.deepEqual([...lista].sort(), [...esperado].sort(), `${c.nome}: ${nome}`);
      const nivel = esperado[1].startsWith('GC.') ? 'gerência' : esperado[1].startsWith('SV.') || esperado[1] === 'Neutraliza' ? 'supervisão' : 'rota';
      assert.deepEqual(r.sub, [`Tendência x Meta por ${nivel}`, `Sem compra por ${nivel}`, `Agenda de hoje por ${nivel}`, `Coberturas por ${nivel}`]);
      // a base das unidades soma a do total (virtuais e EV* não têm clientes) e o total é o KPI
      const somaBase = r.base.filter(x => !x[0]).reduce((s, x) => s + x[1], 0), totBase = r.base.find(x => x[0])[1];
      assert.equal(somaBase, totBase, `${c.nome}: Σ base`);
      assert.equal(totBase.toLocaleString('pt-BR'), r.kpiBase);
      // virtuais e EV*: fora das listas, dentro do total (o total menos as unidades = as rotas de fora, pelo agrega())
      if(c.fora){
        for(const k of ['VOL REFRIGERANTES', 'VOL AGUA MINERAL']){
          const ls = await linhasDiv(page, k), tot = ls.find(x => x.tot), un = ls.filter(x => !x.tot);
          const fora = await page.evaluate(([rs, k]) => { const b = agrega(rs).ind[k]; return b && !b.unavailable ? {meta: b.meta, real: b.real} : {meta: 0, real: 0}; }, [c.fora, k]);
          assert.ok(fora.real > 0, `${c.nome} ${k}: as rotas de fora têm Real`);
          for(const m of ['meta', 'real'])
            assert.ok(Math.abs(tot[m] - un.reduce((s, x) => s + x[m], 0) - fora[m]) < 1e-6, `${c.nome} ${k} ${m}: total = unidades + virtuais/EV*`);
        }
      }
      assert.ok(!(await page.textContent('#exec')).match(/A4[234]\b|I32|-EV\b/), `${c.nome}: nenhuma virtual ou EV* nas listas`);
      assert.deepEqual(erros, [], c.nome);
      await ctx.close();
    }
  });

  test('invariantes da seção 7 com o sintético: KPIs = cards das abas, desvio do total, coberturas e Status = cards, Sem compra e Agenda (somas, restam, gaveta)', async () => {
    const vistos = [];
    for(const c of [{dados: 'exec', entrar: 'dir'}, {dados: 'exec', entrar: 'dir', dgc: 'AT'},
                    {dados: 'exec', entrar: {perfil: 'gc', gc: 'G2'}}, {dados: 'exec', entrar: {perfil: 'gc', gc: 'IT+MO'}},
                    {dados: 'exec', entrar: {perfil: 'sv', gc: 'G2', sv: '1'}},
                    {dados: 'exec', entrar: {perfil: 'gc', gc: 'G1'}, sv: 'Neutraliza'},
                    {dados: 'grupo', entrar: {perfil: 'gc', gc: 'IT+MO'}}, {dados: 'fech', entrar: {perfil: 'gc', gc: 'G1'}},
                    {dados: 'incfech', entrar: 'dir'}]){
      const onde = `${c.dados} ${JSON.stringify(c.entrar)}${c.dgc ? ' ' + c.dgc : ''}${c.sv ? ' ' + c.sv : ''}`;
      const {page, ctx, erros} = await abre(c.dados, {entrar: c.entrar, aba: null});
      await variedade(page);
      if(c.dgc) await page.selectOption('#fgc', c.dgc);
      if(c.sv) await page.selectOption('#fsv', c.sv);
      vistos.push(await confereExecutiva(page, onde));
      assert.deepEqual(erros, [], onde);
      await ctx.close();
    }
    // o cenário tem o que conferir: sem compra no mês, sem compra hoje, pedidos online e "restam" fora do fechamento
    assert.ok(vistos.some(l => Number(String(l.sem).replace(/\D/g, '')) > 0 && l.restam > 0 && l.ped > 0), JSON.stringify(vistos));
  });

  test('Tendência x Meta: ordem decrescente com o total no meio (BAND / código), barra do lado do sinal, escala por categoria (mínimo 10%), sinal exato (−0,03% vermelho com o card em 100%), unidade sem meta fora', async () => {
    const {page, ctx, erros} = await abre('exec', {entrar: 'dir', aba: null, largura: 1440});
    // cada gerência com uma tendência diferente (de 70% a 126% da meta), igual nas categorias
    const tend = f => page.evaluate(f => { gcsComDados().forEach((g, i) => rotasDe(g, '').forEach(r => {
      for(const b of Object.values(nodo('', r).indicators)) if(b.tendencia != null && b.meta) b.tendencia = b.meta * eval(f)(i);
    })); render(); }, f);
    await tend('i => 0.7 + 0.04 * i');
    for(const k of ['VOL REFRIGERANTES', 'VOL AGUA MINERAL']){
      const ls = await linhasDiv(page, k);
      for(let i = 1; i < ls.length; i++) assert.ok(ls[i - 1].d >= ls[i].d, `${k}: ordem decrescente`);
      const t = ls.findIndex(x => x.tot);
      assert.equal(ls[t].u, 'BAND');
      assert.equal(ls.filter(x => x.tot).length, 1);
      assert.ok(t > 0 && t < ls.length - 1, `${k}: total no meio da ordenação (${t} de ${ls.length})`);
      for(const x of ls){
        const pos = x.d >= 0;
        assert.equal(x.lado, pos ? 'P' : 'N', `${k} ${x.u}: lado`);
        assert.match(x.cls, pos ? /\bpos\b/ : /\bneg\b/);
        assert.equal(x.val, `${pos ? '+' : '−'}${Math.abs(x.d * 100).toLocaleString('pt-BR', {minimumFractionDigits: 1, maximumFractionDigits: 1})}%`);
      }
      // escala da categoria: a maior barra ocupa a metade inteira
      const max = Math.max(...ls.map(x => Math.abs(x.d)));
      for(const x of ls) assert.ok(Math.abs(x.w - Math.abs(x.d) / max * 100) < 0.01, `${k} ${x.u}: largura ${x.w}`);
    }
    // categoria sem meta no escopo (o sintético só tem Refrigerantes e Água Mineral): fora das barras e medidor sem meta
    const semMeta = await page.evaluate(() => ({linhas: document.querySelectorAll('#exDivs .dv[data-k="VOL CERVEJAS"] .dRow').length,
      txt: document.querySelector('#exDivs .dv[data-k="VOL CERVEJAS"]').textContent,
      gauge: document.querySelector('#exGauges .gCard[data-k="VOL CERVEJAS"]').className,
      role: document.querySelector('#exGauges .gCard[data-k="VOL CERVEJAS"]').getAttribute('role')}));
    assert.deepEqual([semMeta.linhas, /Sem meta neste escopo/.test(semMeta.txt), semMeta.gauge, semMeta.role], [0, true, 'gCard off', null]);
    // escala mínima de 10%: todas perto da meta (de 98% a 101,5%)
    await tend('i => 0.98 + 0.0025 * i');
    const perto100 = await linhasDiv(page, 'VOL REFRIGERANTES');
    for(const x of perto100) assert.ok(Math.abs(x.w - Math.abs(x.d) / 0.1 * 100) < 0.01, `escala mínima: ${x.u} ${x.w}`);
    // sinal exato: G1 com tendência de 99,97% da meta -> −0,03%: vermelho na Executiva com o card do Volume verde em 100%
    await page.selectOption('#fgc', 'G1');
    await page.evaluate(() => { rotasDe('G1', '').forEach(r => { const b = nodo('', r).indicators['VOL REFRIGERANTES'];
      b.tendencia = b.meta * 0.9997; }); render(); });
    const g1 = await linhasDiv(page, 'VOL REFRIGERANTES');
    const tot = g1.find(x => x.tot);
    assert.equal(tot.u, 'GC.G1');
    assert.ok(tot.d < 0 && tot.d > -0.001, String(tot.d));
    assert.deepEqual([tot.val, tot.lado], ['−0,0%', 'N']);
    assert.match(tot.cls, /\bneg\b/);
    const pill = await page.$eval('#exGauges .gCard[data-k="VOL REFRIGERANTES"] .pill', p => [p.textContent, p.className]);
    assert.deepEqual(pill, ['↓ 0,03%', 'pill neg']);
    await vaiAba(page, 'VOLUME');
    const card = await page.$eval('#lista .ind[data-k="VOL REFRIGERANTES"]', el => [el.classList.contains('ok'), el.querySelector('.big').textContent]);
    assert.deepEqual(card, [true, '▲100%'], 'o card continua verde em 100% (regra do card)');
    await vaiAba(page, 'EXEC');
    // unidade sem meta na categoria fica fora dela (e continua nas outras)
    await page.evaluate(() => { rotasNormais('G1', 'SV.G1.2').forEach(r => { nodo('', r).indicators['VOL REFRIGERANTES'] = {unavailable: true}; }); render(); });
    assert.ok(!(await linhasDiv(page, 'VOL REFRIGERANTES')).some(x => x.u === 'SV.G1.2'), 'SV.G1.2 fora de Refrigerantes');
    assert.ok((await linhasDiv(page, 'VOL AGUA MINERAL')).some(x => x.u === 'SV.G1.2'), 'SV.G1.2 em Água Mineral');
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('categoria em análise: medidor e chip escolhem (mouse e teclado); Foco do fechamento e Meta do dia seguem a categoria; no celular só a coluna dela', async () => {
    let {page, ctx, erros} = await abre('exec', {entrar: {perfil: 'gc', gc: 'G1'}, aba: null, largura: 1440});
    const cat = () => page.evaluate(() => ({sel: [...document.querySelectorAll('#exGauges .gCard.sel')].map(g => g.dataset.k),
      press: [...document.querySelectorAll('#exGauges .gCard[aria-pressed="true"]')].map(g => g.dataset.k),
      chip: [...document.querySelectorAll('#exChips .fchip.on')].map(g => g.dataset.k),
      dv: [...document.querySelectorAll('#exDivs .dv')].filter(d => d.getClientRects().length).map(d => d.dataset.k),
      dvSel: [...document.querySelectorAll('#exDivs .dv.sel')].map(d => d.dataset.k), chips: document.getElementById('exChips').getClientRects().length > 0,
      foco: document.getElementById('exFocoTxt').textContent, dia: document.getElementById('exDiaTxt').textContent,
      ativo: document.activeElement && document.activeElement.dataset.k}));
    let c = await cat();
    assert.deepEqual([c.sel, c.press, c.chip, c.dvSel], [['VOL REFRIGERANTES'], ['VOL REFRIGERANTES'], ['VOL REFRIGERANTES'], ['VOL REFRIGERANTES']]);
    assert.match(c.foco, /^Refrigerantes /);
    assert.match(c.dia, /^Refrigerantes: /);
    // PC: as 5 categorias lado a lado, sem os chips
    assert.deepEqual([c.dv, c.chips], [VOL_EXEC, false]);
    // desde a gaveta "Categoria por unidade" o medidor também abre a gaveta da categoria (foco no ×); ao fechar, o foco volta
    // ao medidor escolhido (Parte AC)
    const fechaGavetaCat = async tit => {
      assert.equal(await page.evaluate(() => document.getElementById('drw').classList.contains('on') && document.getElementById('dTit').textContent), tit);
      await page.keyboard.press('Escape');
    };
    await page.click('#exGauges .gCard[data-k="VOL AGUA MINERAL"]');
    await fechaGavetaCat('Água Mineral por supervisão');
    c = await cat();
    assert.deepEqual([c.sel, c.dvSel, c.ativo], [['VOL AGUA MINERAL'], ['VOL AGUA MINERAL'], 'VOL AGUA MINERAL']);
    assert.match(c.foco, /^Água Mineral /);
    assert.match(c.dia, /^Água Mineral: /);
    // teclado: Enter no medidor
    await page.focus('#exGauges .gCard[data-k="VOL REFRIGERANTES"]');
    await page.keyboard.press('Enter');
    await fechaGavetaCat('Refrigerantes por supervisão');
    c = await cat();
    assert.deepEqual([c.sel, c.ativo], [['VOL REFRIGERANTES'], 'VOL REFRIGERANTES']);
    // os textos dos quadros com números conhecidos: tendências e meta do dia por supervisão, online igual em todas as rotas
    await page.evaluate(() => {
      const fat = {'SV.G1.1': 0.5, 'SV.G1.2': 0.8, Neutraliza: 1.2};
      for(const r of rotasDe('G1', '')){
        const b = nodo('', r).indicators['VOL REFRIGERANTES'], sv = ehNeutraliza(r) ? 'Neutraliza' : rotaSv('', r);
        b.tendencia = b.meta * fat[sv];
        b.metaDia = {'SV.G1.1': 50, 'SV.G1.2': 500, Neutraliza: 0}[sv];
        ((ONLINE.volume[r] = ONLINE.volume[r] || {}))['VOL REFRIGERANTES'] = 100;
      }
      render();
    });
    const esperado = await page.evaluate(() => {
      const f = rs => { const b = agrega(rs).ind['VOL REFRIGERANTES']; return b.meta - b.tendencia; };
      const f1 = f(rotasNormais('G1', 'SV.G1.1')), f2 = f(rotasNormais('G1', 'SV.G1.2')), t = agrega(rotasDe('G1', '')).ind['VOL REFRIGERANTES'];
      return `Refrigerantes está em ${t.pctTendencia}% de tendência; faltam ${fmt0(t.meta - t.tendencia)} para a meta. ` +
        `A supervisão SV.G1.1 concentra ${Math.round(f1 / (f1 + f2) * 100)}% dessa falta (${fmt0(f1)}).`;
    });
    c = await cat();
    assert.equal(c.foco, esperado);
    assert.equal(c.dia, 'Refrigerantes: online de hoje 500 contra meta do dia de 1.100 (45%). 2 de 3 supervisões já alcançaram a meta do dia.');
    // na tendência: "no caminho da meta"; meta do dia batida no escopo
    await page.evaluate(() => { for(const r of rotasDe('G1', '')){ const b = nodo('', r).indicators['VOL REFRIGERANTES'];
      b.tendencia = b.meta * 1.1; b.metaDia = 0; } render(); });
    c = await cat();
    assert.match(c.foco, /^Refrigerantes está em 110% de tendência: no caminho da meta\.$/);
    assert.equal(c.dia, 'Refrigerantes: meta do dia já batida neste escopo. Online de hoje: 500.');
    assert.equal(await page.$eval('#exGauges .gCard[data-k="VOL REFRIGERANTES"] .gDia', e => e.textContent), 'meta do dia batida');
    assert.deepEqual(erros, []);
    await ctx.close();
    // celular: só a coluna da categoria em análise, com os chips; o chip troca a categoria (e o medidor marcado)
    ({page, ctx, erros} = await abre('exec', {entrar: {perfil: 'gc', gc: 'G1'}, aba: null, largura: 390, altura: 844}));
    c = await cat();
    assert.deepEqual([c.dv, c.chips], [['VOL REFRIGERANTES'], true]);
    await page.click('#exChips .fchip[data-k="VOL AGUA MINERAL"]');
    c = await cat();
    assert.deepEqual([c.dv, c.chip, c.sel, c.ativo], [['VOL AGUA MINERAL'], ['VOL AGUA MINERAL'], ['VOL AGUA MINERAL'], 'VOL AGUA MINERAL']);
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('caixa de comentário nas linhas (barras, Sem compra, Agenda): mouse acompanhando, teclado com ESC, toque abre/fecha, toque fora e rolar fecham; um div.dica; emFoco', async () => {
    const estado = page => page.evaluate(() => {
      const ds = document.querySelectorAll('.dica'), d = ds[0];
      return {n: ds.length, on: !!d && d.classList.contains('on') && getComputedStyle(d).visibility === 'visible',
        linhas: d ? d.innerText.split('\n').map(x => x.trim()).filter(Boolean) : [], pos: d ? [parseFloat(d.style.left), parseFloat(d.style.top)] : [],
        emFoco: [...document.querySelectorAll('.emFoco')].map(e => e.dataset.u || e.id), desc: [...document.querySelectorAll('[aria-describedby="dica"]')].length};
    });
    let {page, ctx, erros} = await abre('exec', {entrar: {perfil: 'gc', gc: 'G1'}, aba: null, largura: 1440});
    const div = page.locator('#exDivs .dv.sel .dRow[data-u="SV.G1.1"]'), box = await div.boundingBox();
    await page.mouse.move(box.x + 20, box.y + box.height / 2);
    let e = await estado(page);
    const d = await page.evaluate(() => { const b = agrega(rotasNormais('G1', 'SV.G1.1')).ind['VOL REFRIGERANTES'];
      const dv = b.tendencia / b.meta - 1;
      return ['Refrigerantes · SV.G1.1', `Meta ${fmt0(b.meta)}`, `Real ${fmt0(b.real)} (${b.pctReal}%)`, `Tendência ${fmt0(b.tendencia)}`,
              `Desvio ${dv >= 0 ? '+' : '−'}${Math.abs(dv * 100).toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 2})}%`]; });
    assert.ok(e.on, 'hover: dica aberta');
    assert.deepEqual(e.linhas, d);
    assert.deepEqual([e.n, e.emFoco, e.desc], [1, ['SV.G1.1'], 1]);
    const x0 = e.pos[0];
    await page.mouse.move(box.x + 60, box.y + box.height / 2);
    e = await estado(page);
    assert.ok(e.on && perto(e.pos[0] - x0, 40), `acompanha o cursor: ${x0} -> ${e.pos[0]}`);
    await page.mouse.move(5, 5);
    assert.deepEqual([(await estado(page)).on, (await estado(page)).emFoco], [false, []], 'saiu: fecha');
    // Sem compra e Agenda: os textos da caixa
    for(const [sel, re] of [['#exSemc .hRow.tot', /^GC\.G1 \| [\d.]+ sem compra de [\d.]+ clientes na base \| Compraram no mês: [\d.]+$/],
                            ['#exAgenda .hRow.tot', /^GC\.G1 \| [\d.]+ clientes agendados hoje \| Já compraram no mês: [\d.]+ \| Sem compra no mês: [\d.]+ \| Pediram online hoje: [\d.]+ \| Restam: [\d.]+$/]]){
      // rolar fecha a caixa: a linha fica à vista antes (e o evento de rolagem passa) de o mouse chegar nela
      await page.locator(sel).scrollIntoViewIfNeeded();
      await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
      const b = await page.locator(sel).boundingBox();
      await page.mouse.move(b.x + 30, b.y + b.height / 2);
      e = await estado(page);
      assert.ok(e.on, sel);
      assert.match(e.linhas.join(' | '), re);
      await page.mouse.move(5, 5);
    }
    // teclado: a linha recebe o foco (Tab) e a caixa abre; ESC e blur fecham
    await page.focus('#exAgenda .hRow.tot');
    await page.keyboard.press('Tab');
    e = await estado(page);
    assert.ok(e.on && e.emFoco.length === 1, 'Tab: dica da próxima linha');
    await page.keyboard.press('Escape');
    assert.equal((await estado(page)).on, false, 'ESC');
    await page.keyboard.press('Shift+Tab');
    assert.equal((await estado(page)).on, true, 'foco de novo');
    await page.focus('#exGauges .gCard.sel');
    assert.equal((await estado(page)).on, false, 'blur');
    assert.equal((await estado(page)).n, 1, 'um div.dica só');
    assert.deepEqual(erros, []);
    await ctx.close();
    // toque (celular): abre e fecha no toque; toque fora e rolar fecham
    ({page, ctx, erros} = await abre('exec', {entrar: {perfil: 'gc', gc: 'G1'}, aba: null, largura: 390, altura: 844, toque: true}));
    const linha = '#exSemc .hRow[data-u="SV.G1.1"]';
    await page.locator(linha).scrollIntoViewIfNeeded();
    await page.tap(linha);
    e = await estado(page);
    assert.ok(e.on && e.emFoco[0] === 'SV.G1.1', 'toque: abre');
    await page.tap(linha);
    assert.equal((await estado(page)).on, false, 'toque de novo: fecha');
    await page.tap(linha);
    assert.equal((await estado(page)).on, true);
    await page.tap('#exTSem');
    assert.equal((await estado(page)).on, false, 'toque fora: fecha');
    await page.tap(linha);
    assert.equal((await estado(page)).on, true);
    await page.evaluate(() => scrollBy(0, 120));
    await page.waitForFunction(() => !document.querySelector('.dica').classList.contains('on'));
    assert.deepEqual((await estado(page)).emFoco, [], 'rolar: fecha');
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('fechamento do mês: medidores e barras pelo realizado ("Realizado x Meta"), sem "Meta do dia" e sem "Agenda de hoje"', async () => {
    const {page, ctx, erros} = await abre('fech', {entrar: {perfil: 'gc', gc: 'G1'}, aba: null, largura: 1440});
    assert.equal((await telaExec(page)).aba, 'EXEC');
    const r = await page.evaluate(() => ({fech: !!P.FECHAMENTO, dia: document.getElementById('exDia').getClientRects().length,
      ag: document.getElementById('exAg').getClientRects().length, agLinhas: document.querySelectorAll('#exAgenda .hRow').length,
      tDiv: document.getElementById('exTDiv').textContent, sDiv: document.getElementById('exSDiv').textContent,
      gTend: [...document.querySelectorAll('#exGauges .gTend small')].map(e => e.textContent),
      gDia: document.querySelectorAll('#exGauges .gDia:not(.gSem)').length, foco: document.getElementById('exFocoTxt').textContent,
      semc: document.getElementById('exSemc').getClientRects().length,
      dupla: getComputedStyle(document.querySelector('.dupla')).gridTemplateColumns.split(' ').length}));
    assert.ok(r.fech);
    assert.deepEqual([r.dia, r.ag, r.agLinhas, r.gDia], [0, 0, 0, 0], 'sem Meta do dia nem Agenda');
    assert.equal(r.tDiv, 'Realizado x Meta por supervisão');
    assert.match(r.sDiv, /Real ÷ Meta − 1/);
    assert.ok(r.gTend.length > 0 && r.gTend.every(t => t === 'Realizado x Meta'), r.gTend.join());
    assert.match(r.foco, /^Refrigerantes fechou o mês em \d+% da meta/);
    assert.ok(r.semc > 0 && r.dupla === 1, 'Sem compra sozinho na linha');
    // o desvio é Real / Meta - 1 (agrega(), sem tendência no fechamento)
    for(const x of await linhasDiv(page, 'VOL REFRIGERANTES')){
      const b = await page.evaluate(u => { const rs = u === 'GC.G1' ? rotasDe('G1', '') : u === 'Neutraliza' ? rotasNeutraliza('G1') : rotasNormais('G1', u);
        const i = agrega(rs).ind['VOL REFRIGERANTES']; return {d: i.real / i.meta - 1, tend: i.tendencia}; }, x.u);
      assert.equal(b.tend, null);
      assert.ok(Math.abs(x.d - b.d) < 1e-12, `${x.u}: ${x.d} x ${b.d}`);
    }
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('Evolução contra o mês anterior oculta com payload sem MES_ANTERIOR (o bloco entrou na Etapa 8c; Parte Z)', async () => {
    const {page, ctx, erros} = await abre('semevo', {entrar: 'dir', aba: null});
    const r = await page.evaluate(() => ({flag: CONFIG.EVOLUCAO_ATIVA, chave: !!P.MES_ANTERIOR, txt: document.getElementById('exec').innerText,
      blocos: [...document.querySelectorAll('#exec .bloco h3')].filter(h => h.getClientRects().length).map(h => h.textContent)}));
    assert.equal(r.flag, true);
    assert.equal(r.chave, false);
    assert.doesNotMatch(r.txt, /Evolução|mês anterior/);
    assert.deepEqual(r.blocos, ['Categorias', 'Tendência x Meta por gerência', 'Sem compra por gerência', 'Agenda de hoje por gerência',
                                'Coberturas por gerência']);
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  for(const largura of [1440, 1000, 390, 360]){
    test(`${largura} px: KPIs, quadros, medidores, barras, Sem compra | Agenda e tabela de coberturas sem texto cortado nem rolagem lateral; fontes; contraste; cabeçalho do celular`, async () => {
      const pc = largura >= 1000;
      for(const [dados, entrar] of [['grande', 'dir'], ['exec', {perfil: 'gc', gc: 'IT+MO'}], ['exec', {perfil: 'sv', gc: 'G2', sv: '1'}]]){
        const onde = `${dados} ${JSON.stringify(entrar)}`;
        const {page, ctx, erros} = await abre(dados, {largura, altura: 900, entrar, aba: null});
        await medidas(page);
        await page.evaluate(() => document.fonts.ready);
        await page.evaluate(() => encaixa());
        assert.ok(await semRolagemLateral(page), `${onde}: rolagem lateral`);
        assert.deepEqual(await page.evaluate(() => __vis.estouros('#exec, #abaTopo')), [], onde);
        const g = await page.evaluate(() => {
          const tops = s => [...document.querySelectorAll(s)].filter(e => e.getClientRects().length).map(e => Math.round(e.getBoundingClientRect().top));
          const rola = document.querySelector('#exec .rolaX'), un = document.querySelector('#exCob tbody th.un');
          const tabs = document.querySelector('.tabs'), on = document.querySelector('.tab.on').getBoundingClientRect(), tb = tabs.getBoundingClientRect();
          return {kpi: tops('#exec .exKpis .card'), focos: tops('#exFocos .foco, .exFocos .foco'), gauges: tops('#exGauges .gCard'),
            divs: tops('#exDivs .dv'), dupla: tops('.dupla > .bloco:not([hidden])'),
            sticky: getComputedStyle(un).position, rolaTabela: rola.scrollWidth > rola.clientWidth + 1,
            barra: document.querySelector('.barra').getBoundingClientRect().bottom,
            tabsTop: new Set([...document.querySelectorAll('.tab')].filter(t => !t.hidden).map(t => Math.round(t.getBoundingClientRect().top))).size,
            ativaVisivel: on.left >= tb.left - 1 && on.right <= tb.right + 1};
        });
        const linhas = a => new Set(a).size;
        assert.equal(g.kpi.length, 4);
        assert.equal(linhas(g.kpi), pc ? 1 : 2, `${onde}: KPIs em ${pc ? '4 colunas' : '2 colunas'}`);
        assert.equal(linhas(g.focos), pc ? 1 : 2, `${onde}: quadros`);
        // medidores: 5 por linha a partir de 1200 px, 3 entre 700 e 1199 px (à direita do painel lateral), 2 no celular
        assert.equal(linhas(g.gauges), largura >= 1200 ? 1 : pc ? 2 : 3, `${onde}: medidores`);
        assert.equal(linhas(g.dupla), pc ? 1 : 2, `${onde}: Sem compra | Agenda`);
        if(largura >= 1200) assert.equal(g.divs.length && linhas(g.divs), 1, `${onde}: 5 colunas de barras`);
        if(!pc) assert.equal(g.divs.length, 1, `${onde}: uma categoria por vez no celular`);
        // tabela de coberturas: 1140 px no mínimo, rolando dentro do bloco (a página não rola de lado), 1ª coluna presa
        assert.equal(g.sticky, 'sticky', `${onde}: 1ª coluna fixa`);
        assert.ok(g.rolaTabela, `${onde}: rolagem da tabela dentro do bloco`);
        if(!pc){
          assert.ok(g.barra <= LIMITE_CABECALHO_390, `${onde}: cabeçalho ${g.barra} px > ${LIMITE_CABECALHO_390}`);
          assert.equal(g.tabsTop, 1, `${onde}: abas numa linha`);
        }
        assert.ok(g.ativaVisivel, `${onde}: aba ativa à vista`);
        // fontes: Source Serif 4 só nos números dos KPIs e no % dos medidores; o resto em Inter; algarismos alinhados
        const f = await page.evaluate(() => {
          const fam = s => [...document.querySelectorAll(s)].map(e => getComputedStyle(e).fontFamily);
          return {serif: ['#exec .card .n', '#exec .gPct'].map(s => [s, fam(s)]),
                  inter: ['#exec .card .l', '#exec .card .x', '.exFocos h3', '.exFocos p', '.bCab h3', '.gTit', '.gPct small', '.gMR b',
                          '.gTend b', '.pill', '.gDia', '.dNome', '.dVal', '.hNome', '.hVal', '.tCob th', '.tCob td', '.legenda'].map(s => [s, fam(s)]),
                  num: getComputedStyle(document.getElementById('exec')).fontVariantNumeric};
        });
        for(const [s, fams] of f.serif){ assert.ok(fams.length, s); for(const x of fams) assert.match(x, SERIF, s); }
        for(const [s, fams] of f.inter) for(const x of fams) assert.match(x, /^Inter,/, s);
        assert.match(f.num, /lining-nums tabular-nums/);
        // contraste AA dos textos neutros
        const baixos = (await page.evaluate(s => __vis.contrastes(s), ['.bCab .s', '.gTit', '.gPct small', '.gMR small', '.gMR b', '.gTend small',
          '.gDia', '.dNome', '.hNome', '.legenda', '.tCob thead th', '.tCob .nd', '#exec .card .l', '#exec .card .x', '.exFocos p'])).filter(x => x[2] < 4.5);
        assert.deepEqual(baixos, [], `${onde}: contraste`);
        assert.deepEqual(erros, [], onde);
        await ctx.close();
      }
    });
  }

  test('antes x depois (main antes da Etapa 5): cards, cabeçalho, cascata, Resumo e Painel de Ritmo iguais nas abas de indicadores', {skip: !FRONT_ETAPA4 && `sem o commit ${REF_ETAPA5}`}, async () => {
    for(const entrar of ['dir', {perfil: 'gc', gc: 'G1'}, {perfil: 'gc', gc: 'IT+MO'}, {perfil: 'sv', gc: 'G2', sv: '1'},
                         {perfil: 'rota', gc: 'G2', rota: 'G211'}]){
      const onde = JSON.stringify(entrar);
      const [novo, velho] = [await abre('exec', {entrar, largura: 1280}), await abre('exec', {entrar, largura: 1280, troca: FRONT_ETAPA4})];
      for(const {page} of [novo, velho]) await variedade(page);
      for(const aba of ['VOLUME', 'ICS_GC', 'NOVOS_NEG', 'INCENTIVO']){
        for(const {page} of [novo, velho]) await filtra(page, {aba});
        const [a, b] = [await novo.page.evaluate(CABECALHO), await velho.page.evaluate(CABECALHO)];
        assert.deepEqual(...igualRotulo(a, b), `${onde} ${aba}: cabeçalho e cards`);
        // cascata do 1º card (1º nível) igual (na Rota, o 1º nível é a lista de clientes; a de volume tem, desde a Etapa 6, a
        // barra de dias, que fica fora da comparação)
        const k = await novo.page.$eval('#lista .ind[data-k]', el => el.dataset.k);
        const gav = async p => { await p.click(`#lista .ind[data-k="${k}"]`); const h = await p.evaluate(vol => { const d = document.getElementById('drw').cloneNode(true);
          if(vol) d.querySelectorAll('#dLista > .chips').forEach(x => x.remove()); return d.innerHTML; }, aba === 'VOLUME'); await p.keyboard.press('Escape'); return h; };
        assert.equal(...igualRotulo(await gav(novo.page), await gav(velho.page)), `${onde} ${aba}: cascata de ${k}`);
      }
      // gavetas Base e Sem compra iguais (desde a Etapa 6 com a barra de dias, que abre no "Hoje": sem a barra, a gaveta de antes)
      for(const id of ['cBase', 'cSem']){
        const gav = async p => { await abreCardTopo(p, id); const h = await p.evaluate(() => { const d = document.getElementById('drw').cloneNode(true);
          d.querySelectorAll('#dCorpo > .chips').forEach(x => x.remove()); return d.innerHTML; }); await p.keyboard.press('Escape'); return h; };
        assert.equal(...igualRotulo(await gav(novo.page), await gav(velho.page)), `${onde}: gaveta ${id}`);
      }
      if(entrar.perfil !== 'rota'){
        // Resumo de vendas (a folha) e Painel de Ritmo (escopo e o modelo das páginas, só payload) iguais
        const rs = async p => { await p.click('#btnResumo'); await p.waitForSelector('#rsFolha h2'); const h = await p.innerHTML('#rsFolha');
          await p.click('#rsVoltar'); return h; };
        assert.equal(...igualRotulo(await rs(novo.page), await rs(velho.page)), `${onde}: Resumo`);
        const rt = p => p.evaluate(() => JSON.stringify(montaRitmo(P, RT.escopoRitmo())));
        assert.equal(...igualRotulo(await rt(novo.page), await rt(velho.page)), `${onde}: Painel de Ritmo`);
      }
      assert.deepEqual(novo.erros, [], onde);
      await novo.ctx.close(); await velho.ctx.close();
    }
  });
});

/* ---------- Parte X — gavetas com barra de dias (Etapa 6) ----------
   A lista de clientes de volume da cascata e as gavetas Base (card Base e KPIs Base e Visitas hoje da Executiva) e Sem
   compra (card e KPI Sem compra) com a barra de dias das listas de cobertura (chipsHtml; a regra noDia): padrões "Todos"
   (volume), "Hoje" (Base) e "Hoje" (Sem compra). "Hoje" = as listas de sempre (CLIENTES_HOJE e SEM_COMPRA_HOJE); um dia =
   DIAS[c[3]] contém o dia, então o cliente com mais de um dia de visita ("Seg - Qui") aparece em cada um deles e uma vez
   no "Todos"; "Todos" = a base / o SEM_COMPRA_MES; riscado + "Venda Online" para quem comprou online hoje (QUALQUER).
   Contagens contra os cards: as listas de clientes não mostram as supervisões ocultas (SV.G3.3, regra de sempre), então
   a diferença, quando há, é exatamente a delas. Cenários: 'dias' = o 'exec' (clientes sem compra no mês) com dias de
   visita variados (montaDias); 'diasscm' = o mesmo sem SEM_COMPRA_MES. Antes x depois contra a main antes da Etapa 6
   (REF_ETAPA6, servida por `troca`; sem o histórico do git, esse teste é pulado). */
const REF_ETAPA6 = 'aceacc4';
const FRONT_ETAPA5 = (() => {
  try {
    const arq = f => execSync(`git show ${REF_ETAPA6}:frontend/${f}`, {cwd: RAIZ, stdio: ['ignore', 'pipe', 'ignore']}).toString();
    const [html, css, js] = ['index.html', 'css/app.css', 'js/app.js'].map(arq);
    return {'/index.html': () => html, '/css/app.css': () => css, '/js/app.js': () => js};
  } catch(e) { return null; }
})();
/* Dias de visita variados (no sintético todos são "Seg - Qui"): em cada rota, os clientes na ordem do roster ficam "Seg -
   Qui" (dois dias), "Ter" e "Qua - Sex"; DIAS só ganha valores no fim (tabela de índice). A visita de hoje (c[4]) não muda. */
function montaDias(p){
  const idx = d => { if(!p.DIAS.includes(d)) p.DIAS.push(d); return p.DIAS.indexOf(d); };
  const dias = ['Seg - Qui', 'Ter', 'Qua - Sex'].map(idx);
  for(const [r, cs] of Object.entries(p.CLIENT_ROSTER)){
    const dia = {};
    cs.forEach((c, j) => { c[3] = dias[j % 3]; dia[c[0]] = c[3]; });
    for(const c of p.CLIENTES_HOJE[r] || []) c[3] = dia[c[0]];
  }
}
/* leitura da gaveta (LE_GAV), recontagem do payload e do online (ESPERADO_X) e a leitura de cada chip (leChips): as mesmas
   da conferência com dado real (gavetas_invariantes.js) */
const {LE_GAV, ESPERADO: ESPERADO_X, leChips, CHIPS: CHIPS_X, semTag, numSub} = require('./gavetas_invariantes.js');
// clientes de volume na gaveta: nome, rota e Dif. Abs (data-dif) de cada linha
const LE_VOL = () => ({on: (document.querySelector('#dLista .dchip.on') || {dataset: {}}).dataset.d || null,
  chips: [...document.querySelectorAll('#dLista .dchip')].map(b => b.dataset.d), cab: !!document.querySelector('#dLista .cCab'),
  lin: [...document.querySelectorAll('#dLista .cCli')].map(el => ({nome: el.querySelector('.nm').textContent,
    r: el.querySelector('.sb').textContent.match(/rota (\S+)/)[1], dif: Number(el.dataset.dif)})),
  vazio: [...document.querySelectorAll('#dLista .vazio')].map(v => v.textContent)});
// dia de visita e visita hoje de cada cliente pelo nome (roster da rota)
const DIA_CLI = () => Object.fromEntries(Object.entries(CLIENT_ROSTER).flatMap(([r, cs]) => cs.map(c => [`${r}|${c[1]}`,
  {dias: (DIAS[c[3]] || '').split(' - '), hoje: c[4] === 1}])));

describe('Parte X — gavetas com barra de dias (Etapa 6)', {skip: pular}, () => {
  test('padrões: Volume em "Todos"; Base e Sem compra em "Hoje" pelos cards e pelos KPIs da Executiva; títulos por chip', async () => {
    const {page, ctx, erros} = await abre('dias', {entrar: 'dir', aba: null});
    assert.equal(await page.evaluate(() => aba), 'EXEC');
    const kpis = [['exBase', 'Visitas de hoje', 'Clientes da base'], ['exVis', 'Visitas de hoje', 'Clientes da base'],
                  ['exSem', 'Sem compra hoje', 'Sem compra']];
    const cards = [['cBase', 'Visitas de hoje', 'Clientes da base'], ['cSem', 'Sem compra hoje', 'Sem compra']];
    const confere = async (id, hoje, outro, onde) => {
      await page.click('#' + id);
      let g = await page.evaluate(LE_GAV);
      assert.deepEqual([g.tit, g.on, g.chips], [hoje, 'Hoje', CHIPS_X], `${onde} ${id}: padrão "Hoje"`);
      for(const d of ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Todos', 'Hoje']){
        await page.click(`#dCorpo .dchip[data-d="${d}"]`);
        g = await page.evaluate(LE_GAV);
        assert.deepEqual([g.tit, g.on], [d === 'Hoje' ? hoje : outro, d], `${onde} ${id} ${d}`);
        assert.equal(await page.$$eval('#dCorpo .dchip[aria-pressed="true"]', bs => bs.map(b => b.dataset.d).join()), d, `${onde} ${id} ${d}: aria-pressed`);
      }
      await page.keyboard.press('Escape');
      // ao reabrir, o padrão de novo
      await page.click('#' + id);
      assert.equal((await page.evaluate(LE_GAV)).on, 'Hoje', `${onde} ${id}: reaberta`);
      await page.keyboard.press('Escape');
    };
    for(const [id, hoje, outro] of kpis) await confere(id, hoje, outro, 'Diretoria (Executiva)');
    // cards do topo: com uma supervisão (perfil Supervisão) ficam à vista
    await vaiPara(page, {perfil: 'sv', gc: 'G2', sv: '1'}, 'VOLUME');
    for(const [id, hoje, outro] of cards){
      assert.ok(await page.isVisible('#' + id), id);
      await confere(id, hoje, outro, 'Supervisão (card)');
    }
    // Volume: clientes da cascata (supervisão -> rota -> clientes) em "Todos" = a lista inteira, como antes
    await page.click('#lista .ind[data-k="VOL REFRIGERANTES"]');
    await page.click('#dCorpo .cLin[data-i="0"]');
    const dia = await page.evaluate(DIA_CLI);
    const todos = await page.evaluate(LE_VOL);
    assert.deepEqual([todos.on, todos.chips, todos.cab], ['Todos', CHIPS_X, true]);
    assert.ok(todos.lin.length > 1);
    for(let i = 1; i < todos.lin.length; i++) assert.ok(todos.lin[i - 1].dif <= todos.lin[i].dif, 'Dif. Abs crescente');
    for(const d of CHIPS_X){
      await page.click(`#dLista .dchip[data-d="${d}"]`);
      const v = await page.evaluate(LE_VOL);
      assert.equal(v.on, d);
      // a mesma lista, na mesma ordem, só com os clientes do dia
      const esperado = todos.lin.filter(x => { const c = dia[`${x.r}|${x.nome}`]; return d === 'Todos' || (d === 'Hoje' ? c.hoje : c.dias.includes(d)); });
      assert.deepEqual(v.lin, esperado, `volume ${d}`);
      assert.deepEqual(v.vazio, esperado.length ? [] : ['Ninguém neste filtro.'], `volume ${d}: vazio`);
    }
    // voltar e abrir a rota de novo: a barra volta ao padrão "Todos"
    await page.click('#cVolta');
    await page.click('#dCorpo .cLin[data-i="0"]');
    assert.equal((await page.evaluate(LE_VOL)).on, 'Todos');
    await page.keyboard.press('Escape');
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  const ESCOPOS_X = [
    {nome: 'Diretoria', entrar: 'dir', ocultas: true},
    {nome: 'Gerência G1', entrar: {perfil: 'gc', gc: 'G1'}},
    {nome: 'G1 · Neutraliza no filtro', entrar: {perfil: 'gc', gc: 'G1'}, sv: 'Neutraliza'},
    {nome: 'Gerência G3 (com a oculta SV.G3.3)', entrar: {perfil: 'gc', gc: 'G3'}, ocultas: true},
    {nome: 'grupo IT+MO no Total', entrar: {perfil: 'gc', gc: 'IT+MO'}},
    {nome: 'grupo IT+MO · GC.MO', entrar: {perfil: 'gc', gc: 'IT+MO'}, gc: 'MO'},
    {nome: 'Supervisão SV.G2.1', entrar: {perfil: 'sv', gc: 'G2', sv: '1'}},
    {nome: 'Rota G211', entrar: {perfil: 'rota', gc: 'G2', rota: 'G211'}},
  ];
  test('contagens = cards (Hoje = visitas hoje e sem compra hoje; Todos = base e semCompra), dias, riscado e "Venda Online" em 8 escopos', async () => {
    const vistos = new Set();
    for(const c of ESCOPOS_X){
      const {page, ctx, erros} = await abre('dias', {entrar: c.entrar, aba: 'VOLUME'});
      if(c.gc) await page.selectOption('#fgc', c.gc);
      if(c.sv) await filtra(page, {gc: await page.evaluate(() => sel.gc), sv: c.sv});
      const e = await page.evaluate(ESPERADO_X);
      assert.equal(e.ocultas.n > 0, !!c.ocultas, `${c.nome}: supervisão oculta no escopo`);
      const b = await leChips(page, () => abreCardTopo(page, 'cBase')), s = await leChips(page, () => abreCardTopo(page, 'cSem'));
      assert.deepEqual([b.padrao.on, s.padrao.on], ['Hoje', 'Hoje'], c.nome);
      for(const d of CHIPS_X){
        const onde = `${c.nome} ${d}`;
        assert.deepEqual(semTag(b[d].itens), e.base[d].map(({r, pv, risc}) => ({r, pv, risc})), `${onde}: Base`);
        assert.deepEqual(semTag(s[d].itens), e.sem[d].map(({r, pv, risc}) => ({r, pv, risc})), `${onde}: Sem compra`);
        // riscado <-> "Venda Online" (comprou online hoje, QUALQUER)
        for(const x of [...b[d].itens, ...s[d].itens]){
          assert.equal(x.tag, x.risc ? 'Venda Online' : '', `${onde}: tag de ${x.pv}`);
          vistos.add(x.risc ? 'riscado' : 'normal');
        }
        // o subtítulo traz o número da lista
        assert.equal(numSub(b[d].sub), b[d].itens.length, `${onde}: subtítulo Base "${b[d].sub}"`);
        assert.equal(numSub(s[d].sub), s[d].itens.length, `${onde}: subtítulo Sem compra "${s[d].sub}"`);
      }
      // contagens x cards: a diferença é só a das rotas ocultas (fora das listas de clientes, dentro dos cards)
      assert.equal(b.Hoje.itens.length, e.cards.vis - e.ocultas.vis, `${c.nome}: Hoje = visitas hoje do card Base`);
      assert.equal(s.Hoje.itens.length, e.cards.semHoje - e.ocultas.semHoje, `${c.nome}: Hoje = sem compra hoje do card`);
      assert.equal(s.Todos.itens.length, e.cards.sem - e.ocultas.sem, `${c.nome}: Todos = semCompra do card`);
      assert.equal(s.Todos.itens.length, e.semRotas, `${c.nome}: Todos = soma do semCompra das rotas`);
      assert.equal(b.Todos.itens.length, e.cards.base - e.ocultas.base, `${c.nome}: Todos = base do card`);
      if(!c.ocultas) assert.deepEqual([b.Hoje.itens.length, s.Hoje.itens.length, s.Todos.itens.length, b.Todos.itens.length],
                                      [e.cards.vis, e.cards.semHoje, e.cards.sem, e.cards.base], `${c.nome}: igual aos cards`);
      else assert.ok(e.ocultas.base > 0 && e.ocultas.vis > 0, `${c.nome}: a oculta tem clientes`);
      // cliente com mais de um dia de visita ("Seg - Qui"): em cada um dos dias dele, em nenhum outro, e uma vez no Todos
      for(const [nome, g] of [['Base', b], ['Sem compra', s]]){
        const multi = (nome === 'Base' ? e.base : e.sem).Todos.filter(x => x.dias === 'Seg - Qui');
        // na Base toda rota tem um (o 1º cliente); no Sem compra, só onde ele ficou sem compra (montaSemCompra)
        if(nome === 'Base') assert.ok(multi.length, `${c.nome} ${nome}: há cliente de dois dias`);
        if(!multi.length) continue;
        for(const m of multi){
          const em = CHIPS_X.filter(d => d !== 'Hoje' && g[d].itens.some(x => x.r === m.r && x.pv === m.pv));
          assert.deepEqual(em, ['Seg', 'Qui', 'Todos'], `${c.nome} ${nome}: ${m.r}/${m.pv}`);
          assert.equal(g.Todos.itens.filter(x => x.r === m.r && x.pv === m.pv).length, 1);
        }
        vistos.add(`${nome} multi`);
      }
      // títulos e as listas vazias
      assert.deepEqual([b.Hoje.tit, b.Seg.tit, b.Todos.tit, s.Hoje.tit, s.Seg.tit, s.Todos.tit],
                       ['Visitas de hoje', 'Clientes da base', 'Clientes da base', 'Sem compra hoje', 'Sem compra', 'Sem compra']);
      assert.match(s.Todos.sub, /^[\d.]+ de [\d.]+ clientes da base · nenhum faturamento no mês$/, c.nome);
      assert.match(s.Seg.sub, /^[\d.]+ de [\d.]+ clientes com visita na Seg · nenhum faturamento no mês$/, c.nome);
      assert.match(b.Seg.sub, /^[\d.]+ clientes com visita na Seg$/, c.nome);
      assert.match(b.Todos.sub, /^[\d.]+ clientes na base$/, c.nome);
      for(const d of CHIPS_X) for(const [g, vazio] of [[b, d === 'Hoje' ? 'Nenhuma visita agendada.' : 'Ninguém neste filtro.'],
          [s, d === 'Hoje' || d === 'Todos' ? 'Todo mundo já comprou.' : 'Ninguém neste filtro.']])
        assert.deepEqual(g[d].vazio, g[d].itens.length ? [] : [vazio], `${c.nome} ${d}: vazio`);
      assert.deepEqual(erros, [], c.nome);
      await ctx.close();
    }
    for(const t of ['riscado', 'normal', 'Base multi', 'Sem compra multi']) assert.ok(vistos.has(t), `nenhum caso ${t}`);
  });

  test('Todos do Sem compra = semCompra de cada rota, supervisão e gerência (G2 e o grupo IT+MO); a Executiva abre a mesma gaveta', async () => {
    for(const gc of ['G2', 'IT+MO']){
      const {page, ctx, erros} = await abre('dias', {entrar: {perfil: 'gc', gc}, aba: 'VOLUME'});
      const escopos = await page.evaluate(gc => [{gc, sv: '', rota: ''}, ...membrosGc(gc).map(g => ({gc: g, sv: '', rota: ''})),
        ...svsEmOrdem(gc).map(sv => ({gc, sv, rota: ''})), ...rotasDe(gc, '').filter(r => !ehVirtual(r)).map(rota => ({gc, sv: svDaRota(rota), rota}))], gc);
      let comSem = 0;
      for(const f of escopos){
        await filtra(page, f);
        const onde = `${f.gc} ${f.sv} ${f.rota}`;
        const n = await page.evaluate(() => ({card: document.getElementById('nSem').textContent,
          soma: rotasAtuais().filter(r => !ehVirtual(r)).reduce((a, r) => a + (nodo('', r).semCompra || 0), 0)}));
        await abreCardTopo(page, 'cSem');
        await page.click('#dCorpo .dchip[data-d="Todos"]');
        const g = await page.evaluate(LE_GAV);
        await page.keyboard.press('Escape');
        assert.equal(String(g.itens.length), n.card.replace(/\./g, ''), `${onde}: Todos x card`);
        assert.equal(g.itens.length, n.soma, `${onde}: Todos x semCompra`);
        if(g.itens.length) comSem++;
      }
      assert.ok(comSem > 3, `${gc}: escopos com sem compra`);
      // Executiva: o KPI Sem compra abre a mesma gaveta do card (com a barra), o KPI Base e o Visitas hoje, a da Base
      await filtra(page, {gc, sv: '', rota: ''});
      await vaiAba(page, 'EXEC');
      for(const [kpi, card] of [['exSem', 'cSem'], ['exBase', 'cBase'], ['exVis', 'cBase']]){
        const a = await leChips(page, () => page.click('#' + kpi)), b = await leChips(page, () => abreCardTopo(page, card));
        assert.deepEqual(a, b, `${gc}: ${kpi} = ${card}`);
      }
      assert.deepEqual(erros, [], gc);
      await ctx.close();
    }
  });

  test('payload sem SEM_COMPRA_MES: Sem compra só no "Hoje" (sem a barra), a mesma lista; Base com a barra', async () => {
    for(const entrar of ['dir', {perfil: 'gc', gc: 'IT+MO'}, {perfil: 'sv', gc: 'G2', sv: '1'}, {perfil: 'rota', gc: 'G2', rota: 'G211'}]){
      const v = {};
      for(const nome of ['dias', 'diasscm']){
        const {page, ctx, erros} = await abre(nome, {entrar, aba: 'VOLUME'});
        v[nome] = {b: await leChips(page, () => abreCardTopo(page, 'cBase')), s: await leChips(page, () => abreCardTopo(page, 'cSem'))};
        assert.deepEqual(erros, [], `${nome} ${JSON.stringify(entrar)}`);
        await ctx.close();
      }
      const {dias, diasscm} = v, onde = JSON.stringify(entrar);
      assert.deepEqual(diasscm.s.padrao.chips, [], `${onde}: sem a barra`);
      assert.deepEqual(Object.keys(diasscm.s), ['padrao']);
      // o "Hoje" de sempre: título, subtítulo e itens iguais aos do payload com a chave
      assert.deepEqual({...diasscm.s.padrao, chips: CHIPS_X, on: 'Hoje'}, dias.s.Hoje, `${onde}: Sem compra hoje`);
      assert.deepEqual(diasscm.b, dias.b, `${onde}: Base igual`);
    }
  });

  test('fechamento do mês: barra nas duas gavetas, "Hoje" de padrão; Todos = semCompra do card (mês fechado)', async () => {
    const {page, ctx, erros} = await abre('fech', {entrar: {perfil: 'gc', gc: 'G1'}, aba: 'VOLUME'});
    assert.ok(await page.evaluate(() => P.FECHAMENTO));
    const b = await leChips(page, () => abreCardTopo(page, 'cBase')), s = await leChips(page, () => abreCardTopo(page, 'cSem'));
    assert.deepEqual([b.padrao.on, s.padrao.on, b.padrao.tit, s.padrao.tit], ['Hoje', 'Hoje', 'Visitas de hoje', 'Sem compra hoje']);
    const card = await page.evaluate(() => ({sem: document.getElementById('nSem').textContent, base: document.getElementById('nBase').textContent}));
    assert.equal(String(s.Todos.itens.length), card.sem.replace(/\./g, ''));
    assert.equal(String(b.Todos.itens.length), card.base.replace(/\./g, ''));
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('limite das listas fora do "Hoje" (CONFIG.LIMITE_LISTA): "+ N clientes"; o "Hoje" vem inteiro; o subtítulo traz o total', async () => {
    const troca = {'/js/config.js': t => t.replace(/LIMITE_LISTA: \d+/, 'LIMITE_LISTA: 5')};
    const {page, ctx, erros} = await abre('dias', {entrar: 'dir', aba: 'VOLUME', troca});
    assert.equal(await page.evaluate(() => CONFIG.LIMITE_LISTA), 5);
    const e = await page.evaluate(ESPERADO_X);
    const b = await leChips(page, () => abreCardTopo(page, 'cBase')), s = await leChips(page, () => abreCardTopo(page, 'cSem'));
    assert.ok(e.base.Hoje.length > 5 && e.sem.Hoje.length > 5, 'listas maiores que o limite');
    for(const [g, esp, nome] of [[b, e.base, 'Base'], [s, e.sem, 'Sem compra']]){
      assert.equal(g.Hoje.itens.length, esp.Hoje.length, `${nome}: Hoje inteiro`);
      assert.deepEqual(g.Hoje.vazio, []);
      for(const d of CHIPS_X.slice(1)){
        const n = esp[d].length, onde = `${nome} ${d}`;
        assert.deepEqual(semTag(g[d].itens), esp[d].slice(0, 5).map(({r, pv, risc}) => ({r, pv, risc})), onde);
        assert.deepEqual(g[d].vazio, n > 5 ? [`+ ${n - 5} clientes — filtre por rota para ver todos.`] : n ? [] : g[d].vazio, onde);
        assert.equal(numSub(g[d].sub), n, `${onde}: subtítulo com o total`);
      }
    }
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  for(const largura of [360, 390, 1000, 1440]){
    test(`${largura} px: gavetas com a barra sem rolagem lateral nem texto cortado; a barra rola dentro dela`, async () => {
      for(const tema of ['preta', 'branca']){
        const {page, ctx, erros} = await abre('dias', {entrar: 'dir', aba: 'VOLUME', largura, altura: 800, armazenado: {drotas_entrada: tema}});
        await medidas(page);
        for(const [abrir, chip] of [[() => abreCardTopo(page, 'cBase'), 'Todos'], [() => abreCardTopo(page, 'cSem'), 'Seg'],
                                    [() => abreCardTopo(page, 'cSem'), 'Hoje']]){
          await abrir();
          await page.click(`#dCorpo .dchip[data-d="${chip}"]`);
          const onde = `${largura} ${tema} ${chip}`;
          const m = await page.evaluate(() => {
            const d = document.getElementById('drw').getBoundingClientRect(), b = document.querySelector('#dCorpo .chips').getBoundingClientRect();
            return {d: d.toJSON(), b: b.toJSON(), rola: getComputedStyle(document.querySelector('#dCorpo .chips')).overflowX,
                    estouros: __vis.estouros('#drw', true)};
          });
          assert.ok(await semRolagemLateral(page), `${onde}: rolagem lateral`);
          assert.ok(m.b.left >= m.d.left - 0.5 && m.b.right <= m.d.right + 0.5, `${onde}: a barra dentro da gaveta`);
          assert.equal(m.rola, 'auto', onde);
          assert.deepEqual(m.estouros, [], onde);
          await page.keyboard.press('Escape');
        }
        assert.deepEqual(erros, [], `${largura} ${tema}`);
        await ctx.close();
      }
    });
  }

  test('antes x depois (main antes da Etapa 6): cabeçalho, cards, cascata, Executiva, Resumo e Painel de Ritmo iguais; gavetas sem a barra iguais', {skip: !FRONT_ETAPA5 && `sem o commit ${REF_ETAPA6}`}, async () => {
    // HTML da gaveta, sem a barra de dias da lista de volume e das gavetas Base / Sem compra (as das coberturas ficam)
    const gaveta = (p, semBarra) => p.evaluate(semBarra => { const d = document.getElementById('drw').cloneNode(true);
      if(semBarra) d.querySelectorAll('#dCorpo > .chips, #dLista > .chips').forEach(x => x.remove()); return d.innerHTML; }, semBarra);
    for(const entrar of ['dir', {perfil: 'gc', gc: 'G1'}, {perfil: 'gc', gc: 'IT+MO'}, {perfil: 'sv', gc: 'G2', sv: '1'},
                         {perfil: 'rota', gc: 'G2', rota: 'G211'}]){
      const onde = JSON.stringify(entrar);
      const [novo, velho] = [await abre('dias', {entrar, largura: 1280, aba: null}), await abre('dias', {entrar, largura: 1280, aba: null, troca: FRONT_ETAPA5})];
      for(const {page} of [novo, velho]) await variedade(page);
      if(entrar.perfil !== 'rota'){
        for(const {page} of [novo, velho]){ await vaiAba(page, 'VOLUME'); await vaiAba(page, 'EXEC'); }
        // a Executiva sem o bloco "Evolução contra o mês anterior" (Etapa 8c; o 0a59eb4.. Etapa 5 não tinha), e o comentário dele
        const semEvo = () => { const c = document.getElementById('exec').cloneNode(true);
          [...c.childNodes].filter(n => n.nodeType === 8 && /Evolução/.test(n.data))
            .forEach(n => { n.previousSibling.remove(); n.nextSibling.remove(); n.remove(); });
          c.querySelector('#exEvo').remove();
          return c.innerHTML; };
        assert.equal(...igualRotulo(await novo.page.evaluate(semEvo), await velho.page.innerHTML('#exec')), `${onde}: Executiva`);
      }
      for(const aba of ['VOLUME', 'ICS_GC', 'NOVOS_NEG', 'INCENTIVO']){
        for(const {page} of [novo, velho]) await filtra(page, {aba});
        assert.deepEqual(...igualRotulo(await novo.page.evaluate(CABECALHO), await velho.page.evaluate(CABECALHO)), `${onde} ${aba}: cabeçalho e cards`);
        assert.equal(...igualRotulo(await novo.page.innerHTML('#lista'), await velho.page.innerHTML('#lista')), `${onde} ${aba}: cards`);
        // cascata dos 2 primeiros cards, do 1º nível até os clientes
        const ks = (await novo.page.$$eval('#lista .ind[data-k]', els => els.map(e => e.dataset.k))).slice(0, 2);
        for(const k of ks){
          for(const {page} of [novo, velho]) await page.click(`#lista .ind[data-k="${k}"]`);
          for(let nivel = 0; nivel < 5; nivel++){
            // a barra nova é só a da lista de volume; as das coberturas (ICS GC, Novos Negócios, Todos a Bordo) já existiam
            const vol = aba === 'VOLUME';
            assert.equal(...igualRotulo(await gaveta(novo.page, vol), await gaveta(velho.page, vol)), `${onde} ${aba} ${k} nível ${nivel}`);
            if(entrar === 'dir' || !(await novo.page.$('#dCorpo .cLin[data-i]'))) break;  // Diretoria: GC > Clientes (Etapa 3 do pacote v3)
            for(const {page} of [novo, velho]) await page.click('#dCorpo .cLin[data-i]');
          }
          for(const {page} of [novo, velho]) await page.keyboard.press('Escape');
        }
      }
      // gavetas Base e Sem compra: no "Hoje" (padrão), sem a barra, as de antes
      for(const id of ['cBase', 'cSem']){
        const g = async p => { await abreCardTopo(p, id); const h = await gaveta(p, true); await p.keyboard.press('Escape'); return h; };
        assert.equal(...igualRotulo(await g(novo.page), await g(velho.page)), `${onde}: gaveta ${id}`);
      }
      if(entrar.perfil !== 'rota'){
        const rs = async p => { await p.click('#btnResumo'); await p.waitForSelector('#rsFolha h2'); const h = await p.innerHTML('#rsFolha');
          await p.click('#rsVoltar'); return h; };
        assert.equal(...igualRotulo(await rs(novo.page), await rs(velho.page)), `${onde}: Resumo`);
        const rt = p => p.evaluate(() => JSON.stringify(montaRitmo(P, RT.escopoRitmo())));
        assert.equal(...igualRotulo(await rt(novo.page), await rt(velho.page)), `${onde}: Painel de Ritmo`);
      }
      assert.deepEqual(novo.erros, [], onde);
      await novo.ctx.close(); await velho.ctx.close();
    }
  });
});

/* ---------- Parte Z — Evolução contra o mês anterior (Etapa 8c, só Volume; barras pareadas desde 22/10/2026) ----------
   Uma linha por categoria no total do escopo (barra sólida = mês de referência, hachurada = mês anterior, trilhas de 0 a 100%
   com a marca de 100%; % atual, % anterior e Δ p.p.); clicar abre as unidades logo abaixo. Invariantes (a) a (f) em
   evolucao_invariantes.js (as mesmas da conferência com dado real); antes x depois contra a main antes do redesenho.
   MES_ANTERIOR sintética no formato do gerador (backend/gerador/mes_anterior.py): todas as rotas do payload na ordem dele,
   um par [Real até o corte, Meta do mês anterior] por macro de volume, null onde a rota não tem o indicador (o sintético
   do back-end já traz a chave, com outros números; esta a substitui). No sintético só Refrigerantes e Água Mineral têm meta
   (as outras 3 categorias saem "—" em todas as linhas). Cenários: a AN sem Refrigerantes no mês anterior (gerência "—"), a G211 sem Refrigerantes (rota null), a G3 com Água Mineral igual ao mês
   de referência (Δ exatamente 0, cinza), a G212 com Água Mineral 12 x a meta (Δ de 4 dígitos) e as demais com fatores variados (Δ dos dois sinais). A rota oculta das EV* (SL-EV,
   MO-EV no 'grupo') entra com meta 0, como no gerador. */
function montaMesAnterior(p, fechado){
  // os 5 macros (VOL_EXEC, declarado mais abaixo: o before() roda antes de chegar nele)
  const IND = ['VOL REFRIGERANTES', 'VOL CERVEJAS', 'VOL STILL', 'VOL AGUA MINERAL', 'VOL DEST+ART+CND'], rotas = [];
  for(const gc in p.DATA) for(const sv in p.DATA[gc]) for(const r in p.DATA[gc][sv]) rotas.push([gc, r, p.DATA[gc][sv][r]]);
  const ROTAS = {};
  rotas.forEach(([gc, r, n], i) => {
    ROTAS[r] = IND.map((k, j) => {
      const b = n.indicators[k];
      if(!b || b.unavailable || b.meta == null) return null;
      if(gc === 'AN' && k === 'VOL REFRIGERANTES') return null;
      if(r === 'G211' && k === 'VOL REFRIGERANTES') return null;
      if(gc === 'G3' && k === 'VOL AGUA MINERAL') return [b.real, b.meta];
      // Real anterior 12 x a meta: Δ de 4 dígitos (−1.1xx,x) na rota e na SV.G2.1 (largura da coluna do valor)
      if(r === 'G212' && k === 'VOL AGUA MINERAL') return [Math.round(b.meta * 12 * 10) / 10, b.meta];
      const f = 0.6 + ((i + j) % 5) * 0.12, g = 0.9 + (j % 3) * 0.05;
      return [Math.round(b.real * f * 10) / 10, Math.round(b.meta * g * 10) / 10];
    });
  });
  p.MES_ANTERIOR = fechado
    ? {MES_LABEL: 'Agosto/26', DIA_UTIL: 21, TOTAL_DIAS_UTEIS: 21, DATA_CORTE: '2026-08-31', FECHADO: true, IND, ROTAS}
    : {MES_LABEL: 'Setembro/26', DIA_UTIL: p.DIA_ONTEM, TOTAL_DIAS_UTEIS: 22, DATA_CORTE: '2026-09-11', FECHADO: false, IND, ROTAS};
}
/* antes x depois do redesenho: o front da main antes desta etapa (REF_PRE_EVO), servido por `troca` (só index.html, app.css e
   app.js mudaram) */
const REF_PRE_EVO = '7674ca2';
const FRONT_PRE_EVO = (() => {
  try {
    const arq = f => execSync(`git show ${REF_PRE_EVO}:frontend/${f}`, {cwd: RAIZ, stdio: ['ignore', 'pipe', 'ignore']}).toString();
    const [html, css, js] = ['index.html', 'css/app.css', 'js/app.js'].map(arq);
    return {'/index.html': () => html, '/css/app.css': () => css, '/js/app.js': () => js};
  } catch(e) { return null; }
})();
const linhasEvo = (page, k) => page.evaluate(k => {
  const n = v => v === '' || v == null ? null : Number(v);
  const le = r => ({u: r.dataset.u, dpp: n(r.dataset.dpp), pct: n(r.dataset.pct), pctAnt: n(r.dataset.pctAnt), realAnt: n(r.dataset.realAnt),
    pa: r.querySelector('.evPA').textContent, pb: r.querySelector('.evPB').textContent, d: r.querySelector('.evDN').textContent,
    cls: r.querySelector('.evD').className, w: [...r.querySelectorAll('.evTr i')].map(i => parseFloat(i.style.width))});
  const cat = document.querySelector(`#exEvLinhas .evLin.cat[data-k="${k}"]`);
  return {tot: le(cat), aria: cat.getAttribute('aria-expanded'), aberta: !document.getElementById(cat.getAttribute('aria-controls')).hidden,
    us: [...document.getElementById(cat.getAttribute('aria-controls')).querySelectorAll('.evLin')].map(le)};
}, k);
const evoVisivel = page => page.evaluate(() => { const e = document.getElementById('exEvo');
  return !e.hidden && e.getClientRects().length > 0; });
// categorias abertas (aria-expanded = true e a lista de unidades à vista), na ordem
const evoAbertas = page => page.evaluate(() => [...document.querySelectorAll('#exEvLinhas .evLin.cat')].filter(l => {
  const det = document.getElementById(l.getAttribute('aria-controls'));
  if((l.getAttribute('aria-expanded') === 'true') !== !det.hidden) throw new Error(`aria-expanded x lista: ${l.dataset.k}`);
  return !det.hidden && det.getClientRects().length > 0;
}).map(l => l.dataset.k));
const catEvo = k => `#exEvLinhas .evLin.cat[data-k="${k}"]`;
const dicaAberta = page => page.evaluate(() => { const d = document.getElementById('dica');
  return d && d.classList.contains('on') ? d.textContent : null; });
// rótulos dos dois meses na legenda (sem o "Δ" e a dica de abrir)
const legendaEvo = page => page.evaluate(() => [...document.querySelectorAll('#exEvLeg > span')].map(s => s.textContent));

describe('Parte Z — Evolução contra o mês anterior em barras pareadas', {skip: pular}, () => {
  const {confereEvolucao, ABRE_TODAS, textoD} = require('./evolucao_invariantes.js');

  test('oculto sem MES_ANTERIOR e com CONFIG.EVOLUCAO_ATIVA = false; visível nos perfis com Executiva, depois de "Coberturas"; a Rota não tem', async () => {
    const semFlag = {'/js/config.js': t => t.replace('EVOLUCAO_ATIVA: true', 'EVOLUCAO_ATIVA: false')};
    for(const [dados, troca, vis] of [['semevo', {}, false], ['evo', semFlag, false], ['evo', {}, true]]){
      const onde = `${dados} ${Object.keys(troca).length ? 'flag false' : ''}`;
      const {page, ctx, erros} = await abre(dados, {entrar: 'dir', aba: null, troca});
      assert.equal(await evoVisivel(page), vis, onde);
      const blocos = await page.evaluate(() => [...document.querySelectorAll('#exec .bloco h3')].filter(h => h.getClientRects().length)
        .map(h => h.textContent));
      assert.deepEqual(blocos, ['Categorias', 'Tendência x Meta por gerência', 'Sem compra por gerência', 'Agenda de hoje por gerência',
        'Coberturas por gerência', ...(vis ? ['Evolução contra o mês anterior'] : [])], onde);
      if(!vis) assert.deepEqual(await page.evaluate(() => [document.getElementById('exEvLinhas').innerHTML, document.getElementById('exEvLeg').innerHTML]),
        ['', ''], onde);
      // o desenho antigo saiu: sem os chips de categoria e sem as colunas divergentes
      assert.deepEqual(await page.evaluate(() => [!!document.getElementById('exEvChips'), !!document.getElementById('exEvDivs'),
        document.querySelectorAll('#exEvo .dRow, #exEvo .dv, #exEvo .fchip').length]), [false, false, 0], onde);
      assert.deepEqual(erros, [], onde);
      await ctx.close();
    }
    for(const [dados, entrar, vis] of [['evo', {perfil: 'gc', gc: 'G1'}, true], ['evogrupo', {perfil: 'gc', gc: 'IT+MO'}, true],
        ['evo', {perfil: 'sv', gc: 'G2', sv: '1'}, true], ['evo', {perfil: 'rota', gc: 'G2', rota: 'G211'}, false]]){
      const onde = JSON.stringify(entrar);
      const {page, ctx, erros} = await abre(dados, {entrar, aba: null});
      assert.equal(await evoVisivel(page), vis, onde);
      if(!vis) assert.ok(!(await telaExec(page)).tabs.includes('EXEC'), `${onde}: sem a Executiva`);
      else assert.equal(await page.evaluate(() => [...document.querySelectorAll('#exec > .bloco, #exec > .dupla')].at(-1).id), 'exEvo', onde);
      assert.deepEqual(erros, [], onde);
      await ctx.close();
    }
  });

  test('subtítulo e legenda: normal, mês anterior limitado e fechamento x fechamento; sem "(a implementar)"', async () => {
    let {page, ctx, erros} = await abre('evo', {entrar: 'dir', aba: null});
    const p = await page.evaluate(() => ({s: document.getElementById('exSEvo').textContent, t: document.getElementById('exTEvo').textContent,
      o: P.DIA_ONTEM, data: P.DATA_ONTEM, T: P.TOTAL_DIAS_UTEIS, m: P.MES_LABEL, d: P.MES_ANTERIOR.DIA_UTIL}));
    assert.equal(p.t, 'Evolução contra o mês anterior');
    assert.equal(p.d, p.o, 'o sintético compara o mesmo dia útil');
    // o mês de referência pelo DIA_ONTEM (o Real é até ontem) e o anterior pela DATA_CORTE (dd/mm)
    assert.equal(p.s, `% real até ontem: ${p.m} (dia útil ${p.o} de ${p.T}) contra Setembro/26 no mesmo dia útil (até 11/09).`);
    assert.match(p.data, /^\d{4}-\d{2}-\d{2}$/);
    const ontem = `${p.data.slice(8, 10)}/${p.data.slice(5, 7)}`;
    const leg = await legendaEvo(page);
    assert.deepEqual(leg.slice(0, 3), [`${p.m} até ${ontem}`, 'Setembro/26 no mesmo dia útil (até 11/09)', '100% da meta']);
    assert.equal(leg[3], `Δ = ${p.m} − Setembro/26, em pontos percentuais (p.p.): ▲ subiu, ▼ caiu`);
    assert.equal(leg[4], 'Clique ou toque numa categoria para abrir por gerência');
    assert.doesNotMatch(await page.textContent('#exEvo'), /implementar/);
    // mês anterior com menos dias úteis que o DIA_ONTEM: vale ele inteiro
    const lim = await page.evaluate(() => { P.MES_ANTERIOR.DIA_UTIL = P.DIA_ONTEM - 1; P.MES_ANTERIOR.TOTAL_DIAS_UTEIS = P.DIA_ONTEM - 1; render();
      return [document.getElementById('exSEvo').textContent, document.querySelectorAll('#exEvLeg > span')[1].textContent, P.DIA_ONTEM - 1]; });
    assert.deepEqual(lim.slice(0, 2), [`% real até ontem: ${p.m} (dia útil ${p.o} de ${p.T}) contra Setembro/26 inteiro (${lim[2]} dias úteis, até 11/09).`,
      `Setembro/26 inteiro (${lim[2]} dias úteis, até 11/09)`]);
    assert.deepEqual(erros, []);
    await ctx.close();
    ({page, ctx, erros} = await abre('evofech', {entrar: {perfil: 'gc', gc: 'G1'}, aba: null}));
    const f = await page.evaluate(() => ({s: document.getElementById('exSEvo').textContent, m: P.MES_LABEL, fech: !!P.FECHAMENTO}));
    assert.ok(f.fech);
    assert.equal(f.s, `% real: ${f.m} (fechado) contra Agosto/26 (fechado).`);
    assert.deepEqual((await legendaEvo(page)).slice(0, 3), [`${f.m} (fechado)`, 'Agosto/26 (fechado)', '100% da meta']);
    await confereEvolucao(page, 'fechamento GC.G1');
    await page.evaluate(s => document.querySelector(s).scrollIntoView({block: 'center'}), catEvo('VOL REFRIGERANTES'));
    await page.waitForTimeout(100);
    await page.hover(catEvo('VOL REFRIGERANTES'));
    assert.match(await dicaAberta(page), new RegExp(`^Refrigerantes · GC\\.G1Agosto/26 \\(fechado\\): Real .*${f.m} \\(fechado\\): Real `));
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('uma linha por categoria (ordem fixa, rótulo central "Novos Negócios"), duas barras hachuradas (a atual em --ruim), a marca de 100% e a legenda', async () => {
    const {page, ctx, erros} = await abre('vol5', {entrar: 'dir', aba: null, largura: 1440});
    const r = await page.evaluate(() => {
      const cor = v => { const e = document.createElement('i'); e.style.background = v; document.body.append(e); const c = getComputedStyle(e).backgroundColor; e.remove(); return c; };
      const linhas = [...document.querySelectorAll('#exEvLinhas .evLin.cat')].map(l => {
        const trs = [...l.querySelectorAll('.evTr')], ba = l.querySelector('.evBarras'), mk = getComputedStyle(ba, '::after');
        const rb = ba.getBoundingClientRect(), rt = trs.map(t => t.getBoundingClientRect());
        return {k: l.dataset.k, nome: l.querySelector('.evTxt').textContent, sub: !!l.querySelector('.tsub'),
          trilhas: trs.length, barras: trs.map(t => t.querySelector('i').className),
          // desde os ajustes visuais (Parte AE) a barra de cima também é hachurada, em --ruim
          solida: getComputedStyle(trs[0].querySelector('i')).backgroundColor, hachuraAtu: getComputedStyle(trs[0].querySelector('i')).backgroundImage,
          hachura: getComputedStyle(trs[1].querySelector('i')).backgroundImage,
          marca: {conteudo: mk.content, w: mk.width, cor: mk.backgroundColor, direita: rb.right - parseFloat(mk.right) - parseFloat(mk.width),
                  fimTrilhas: rt.map(t => t.right), topo: rb.top + parseFloat(mk.top), base: rb.bottom - parseFloat(mk.bottom),
                  trilhasY: [rt[0].top, rt[1].bottom]},
          val: [l.querySelector('.evPA').textContent, l.querySelector('.evPB').textContent], seta: !!l.querySelector('svg.evSeta')};
      });
      const lg = [...document.querySelectorAll('#exEvLeg .lg')].map(i => [i.className, getComputedStyle(i).backgroundColor, getComputedStyle(i).backgroundImage]);
      return {linhas, lg, ruim: cor('var(--ruim)'), preto: cor('var(--preto)'), txt: document.getElementById('exEvo').textContent,
        rot: GROUPS.VOLUME.map(rotuloInd)};
    });
    assert.deepEqual(r.linhas.map(l => l.k), VOL_EXEC);
    assert.deepEqual(r.linhas.map(l => l.nome), ['Refrigerantes', 'Cervejas', 'Still', 'Água Mineral', 'Novos Negócios']);
    assert.deepEqual(r.linhas.map(l => l.nome), r.rot);
    assert.match(await page.getAttribute(catEvo('VOL DEST+ART+CND'), 'aria-label'), /^Novos Negócios: .* Detalhe por gerência$/);
    assert.ok(!r.txt.includes('Dest+Art+Cnd'), 'sem a 2ª linha do card');
    for(const l of r.linhas){
      assert.deepEqual([l.trilhas, l.barras, l.sub, l.seta], [2, ['atu', 'ant'], false, true], l.k);
      assert.equal(l.solida, 'rgba(0, 0, 0, 0)', `${l.k}: barra de cima sem fundo sólido`);
      assert.ok(l.hachuraAtu.startsWith(`repeating-linear-gradient(135deg, ${r.ruim} 0px`), `${l.k}: barra de cima hachurada em --ruim`);
      assert.match(l.hachura, /repeating-linear-gradient/, `${l.k}: barra de baixo hachurada`);
      // marca preta de 100% no fim das duas trilhas, cobrindo as duas
      assert.deepEqual([l.marca.conteudo, l.marca.w, l.marca.cor], ['""', '2px', r.preto], l.k);
      for(const f of l.marca.fimTrilhas) assert.ok(Math.abs(l.marca.direita - f) <= 0.5, `${l.k}: marca no fim da trilha (${l.marca.direita} x ${f})`);
      assert.ok(l.marca.topo <= l.marca.trilhasY[0] && l.marca.base >= l.marca.trilhasY[1], `${l.k}: marca nas duas trilhas`);
      assert.ok(l.val.every(v => /^\d[\d.]*,\d%$/.test(v)), `${l.k}: ${l.val}`);
    }
    assert.deepEqual(r.lg.map(x => x[0]), ['lg evAtu', 'lg evAnt', 'lg evCem']);
    assert.ok(r.lg[0][2].startsWith(`repeating-linear-gradient(135deg, ${r.ruim} 0px`), 'legenda do mês atual hachurada');
    assert.match(r.lg[1][2], /repeating-linear-gradient/);
    assert.equal(r.lg[2][1], r.preto);
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('% acima de 100: barra cheia até o fim da trilha e o número com o valor real (atual e anterior)', async () => {
    const {page, ctx, erros} = await abre('evo', {entrar: {perfil: 'sv', gc: 'G2', sv: '1'}, aba: null});
    // G212 com Água Mineral do mês anterior em 12 x a meta (montaMesAnterior)
    await page.click(catEvo('VOL AGUA MINERAL'));
    const g212 = (await linhasEvo(page, 'VOL AGUA MINERAL')).us.find(x => x.u === 'Rota G212');
    assert.ok(g212.pctAnt > 1000, `${g212.pctAnt}`);
    assert.equal(g212.w[1], 100);
    assert.equal(g212.pb, `${g212.pctAnt.toLocaleString('pt-BR', {minimumFractionDigits: 1, maximumFractionDigits: 1})}%`);
    assert.match(g212.pb, /^1\.\d{3},\d%$/);
    // mês de referência em 112% da meta em Água Mineral (todas as rotas)
    await page.evaluate(() => { for(const g of Object.keys(P.DATA)) for(const s of Object.keys(P.DATA[g])) for(const n of Object.values(P.DATA[g][s])){
      const b = n.indicators['VOL AGUA MINERAL']; if(b && !b.unavailable && b.meta) b.real = b.meta * 1.12; } render(); });
    const ag = await linhasEvo(page, 'VOL AGUA MINERAL');
    assert.equal(ag.aberta, true, 'o redesenho não recolhe');
    assert.equal(ag.tot.pa, '112,0%');
    assert.equal(ag.tot.w[0], 100);
    for(const u of ag.us.filter(x => x.pct != null)) assert.deepEqual([u.pa, u.w[0]], ['112,0%', 100], u.u);
    await confereEvolucao(page, 'SV.G2.1 com 112%');
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('abrir e recolher: mouse, Enter e Espaço; aria-expanded e seta; mais de uma aberta; o online não recolhe; trocar filtro e perfil recolhe', async () => {
    const {page, ctx, erros} = await abre('evo', {entrar: 'dir', aba: null, largura: 1440});
    assert.deepEqual(await evoAbertas(page), [], 'começa recolhido');
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('#exEvLinhas .evLin.cat')].map(l =>
      [l.getAttribute('role'), l.tabIndex, l.getAttribute('aria-expanded'), document.getElementById(l.getAttribute('aria-controls')).dataset.k === l.dataset.k])),
      VOL_EXEC.map(() => ['button', 0, 'false', true]));
    // a seta gira em 0,15 s: lê depois da transição
    const seta = async k => { await page.waitForTimeout(250);
      return page.evaluate(s => getComputedStyle(document.querySelector(s + ' .evSeta')).transform, catEvo(k)); };
    const fechada = await seta('VOL REFRIGERANTES');
    // mouse
    await page.click(catEvo('VOL REFRIGERANTES'));
    assert.deepEqual(await evoAbertas(page), ['VOL REFRIGERANTES']);
    assert.notEqual(await seta('VOL REFRIGERANTES'), fechada, 'a seta gira');
    // Enter numa outra: as duas abertas
    await page.focus(catEvo('VOL AGUA MINERAL'));
    await page.keyboard.press('Enter');
    assert.deepEqual(await evoAbertas(page), ['VOL REFRIGERANTES', 'VOL AGUA MINERAL']);
    // Espaço recolhe (sem rolar a página)
    await page.focus(catEvo('VOL REFRIGERANTES'));
    const y = await page.evaluate(() => scrollY);
    await page.keyboard.press(' ');
    assert.deepEqual(await evoAbertas(page), ['VOL AGUA MINERAL']);
    assert.equal(await page.evaluate(() => scrollY), y, 'Espaço não rola');
    assert.equal(await seta('VOL REFRIGERANTES'), fechada);
    // o redesenho do online (puxaOnline -> render) e a troca da categoria em análise não recolhem
    await page.evaluate(() => { render(); escolheCat('VOL AGUA MINERAL', 'exGauges'); });
    assert.deepEqual(await evoAbertas(page), ['VOL AGUA MINERAL']);
    // outras abas e a volta: continua
    await vaiAba(page, 'VOLUME'); await vaiAba(page, 'EXEC');
    assert.deepEqual(await evoAbertas(page), ['VOL AGUA MINERAL']);
    // trocar o filtro da Diretoria recolhe; voltar para "Todas" também
    await page.selectOption('#fgc', 'G1');
    assert.deepEqual(await evoAbertas(page), []);
    await page.click(catEvo('VOL REFRIGERANTES'));
    assert.deepEqual(await evoAbertas(page), ['VOL REFRIGERANTES']);
    await page.selectOption('#fgc', '');
    assert.deepEqual(await evoAbertas(page), []);
    // trocar de perfil (casa e entrada) recolhe, também voltando para o mesmo perfil
    await page.evaluate(ABRE_TODAS);
    assert.equal((await evoAbertas(page)).length, 5);
    await vaiPara(page, {perfil: 'gc', gc: 'G1'}, null);
    assert.deepEqual(await evoAbertas(page), []);
    await page.click(catEvo('VOL REFRIGERANTES'));
    // na Gerência: trocar a supervisão do filtro recolhe
    const sv = (await opcoes(page)).sv[0];
    await page.selectOption('#fsv', sv);
    assert.deepEqual(await evoAbertas(page), [], `filtro ${sv}`);
    await page.click(catEvo('VOL REFRIGERANTES'));
    await vaiPara(page, {perfil: 'gc', gc: 'G1'}, null);
    assert.deepEqual(await evoAbertas(page), [], 'a mesma Gerência de novo');
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('unidades por escopo (Diretoria, uma gerência, gerência com EV*, grupo no Total, supervisão, "Neutraliza"): invariantes (a) a (f), ordem por Δ e "—" no fim', async () => {
    const casos = [
      {nome: 'BAND', dados: 'evo', entrar: 'dir', niv: 'gerência'},
      {nome: 'Diretoria · AN (virtuais)', dados: 'evo', entrar: 'dir', dgc: 'AN', fora: 3, niv: 'supervisão'},
      {nome: 'GC.G1', dados: 'evo', entrar: {perfil: 'gc', gc: 'G1'}, niv: 'supervisão'},
      {nome: 'GC.SL (EV*)', dados: 'evo', entrar: {perfil: 'gc', gc: 'SL'}, fora: 1, niv: 'supervisão'},
      {nome: 'Total IT+MO', dados: 'evogrupo', entrar: {perfil: 'gc', gc: 'IT+MO'}, fora: 2, niv: 'supervisão'},
      {nome: 'SV.G2.1', dados: 'evo', entrar: {perfil: 'sv', gc: 'G2', sv: '1'}, niv: 'rota'},
      {nome: 'Neutraliza', dados: 'evo', entrar: {perfil: 'gc', gc: 'G1'}, sv: 'Neutraliza', niv: 'rota'},
    ];
    for(const c of casos){
      const {page, ctx, erros} = await abre(c.dados, {entrar: c.entrar, aba: null});
      if(c.dgc) await page.selectOption('#fgc', c.dgc);
      if(c.sv) await page.selectOption('#fsv', c.sv);
      const r = await confereEvolucao(page, c.nome);
      if(c.fora) assert.equal(r.fora, c.fora, `${c.nome}: rotas fora das unidades (virtuais / EV*)`);
      // as mesmas unidades e o mesmo total da Tendência x Meta (a Evolução também lista as sem meta, com "—")
      const u = await page.evaluate(() => ({evo: [...document.querySelectorAll('#exEvDet0 .evLin')].map(x => x.dataset.u),
        tot: document.querySelector('#exEvLinhas .evLin.cat').dataset.u, div: [...document.querySelectorAll('#exDivs .dv[data-k="VOL REFRIGERANTES"] .dRow')]
          .filter(x => !x.classList.contains('tot')).map(x => x.dataset.u),
        divTot: (document.querySelector('#exDivs .dv[data-k="VOL REFRIGERANTES"] .dRow.tot') || {dataset: {}}).dataset.u,
        uns: unidadesExec(ctxInicial()).map(x => x.cod), rot: document.getElementById('exEvDet0').getAttribute('aria-label'),
        dica: document.querySelectorAll('#exEvDet0 .evLin[tabindex="0"][data-dica]').length}));
      assert.equal(u.tot, u.divTot, `${c.nome}: linha de total`);
      assert.deepEqual([...u.evo].sort(), [...u.uns].sort(), `${c.nome}: unidades`);
      assert.ok(u.div.every(x => u.evo.includes(x)), `${c.nome}: Tendência x Meta contida`);
      assert.equal(u.rot, `Refrigerantes por ${c.niv}`, c.nome);
      assert.equal(u.dica, u.evo.length, `${c.nome}: cada unidade com a caixa de comentário`);
      if(c.nome === 'BAND') assert.equal(u.tot, 'BAND');
      if(c.nome === 'Total IT+MO') assert.equal(u.tot, 'GC.IT+MO');
      if(c.nome === 'SV.G2.1') assert.ok(u.evo.every(x => /^Rota /.test(x)), u.evo.join());
      assert.deepEqual(erros, [], c.nome);
      await ctx.close();
    }
  });

  test('Δ com seta e cor: ▲ verde subiu, ▼ vermelho caiu, 0,0 cinza sem seta, "—" cinza sem meta anterior (no fim); rota null', async () => {
    const {page, ctx, erros} = await abre('evo', {entrar: 'dir', aba: null});
    await page.evaluate(ABRE_TODAS);
    const cores = await page.evaluate(() => { const c = v => { const e = document.createElement('i'); e.style.color = v; document.body.append(e);
      const x = getComputedStyle(e).color; e.remove(); return x; }; return {pos: c('var(--verdeE)'), neg: c('var(--vermelho2)'), cinza: c('var(--txt-apoio)')}; });
    const corD = (k, u) => page.evaluate(([k, u]) => getComputedStyle(document.querySelector(`#exEvLinhas .evDet[data-k="${k}"] .evLin[data-u="${u}"] .evD`)).color, [k, u]);
    // AN sem Refrigerantes no mês anterior: "—" no % anterior e no Δ, barra hachurada vazia, na última posição
    const refri = await linhasEvo(page, 'VOL REFRIGERANTES');
    const an = refri.us.find(x => x.u === 'GC.AN');
    assert.deepEqual([an.pb, an.d, an.dpp, an.realAnt, an.w[1]], ['—', '—', null, null, 0]);
    assert.match(an.cls, /\bnd\b/);
    assert.equal(refri.us.at(-1).u, 'GC.AN');
    assert.equal(await corD('VOL REFRIGERANTES', 'GC.AN'), cores.cinza);
    // G3 com Água Mineral igual à do mês de referência: Δ 0, "0,0" sem seta, cinza
    const agua = await linhasEvo(page, 'VOL AGUA MINERAL'), g3 = agua.us.find(x => x.u === 'GC.G3');
    assert.deepEqual([g3.dpp, g3.d], [0, '0,0']);
    assert.match(g3.cls, /\bzero\b/);
    assert.equal(await corD('VOL AGUA MINERAL', 'GC.G3'), cores.cinza);
    // subiu e caiu: seta, sinal e cor pelo valor exato, nas linhas e nas categorias
    const todas = (await Promise.all(VOL_EXEC.map(k => linhasEvo(page, k)))).flatMap((x, i) => [x.tot, ...x.us].map(l => ({...l, k: VOL_EXEC[i]})));
    const com = todas.filter(x => x.dpp != null && x.dpp !== 0);
    assert.deepEqual([...new Set(com.map(x => Math.sign(x.dpp)))].sort(), [-1, 1], 'o cenário tem Δ dos dois sinais');
    for(const x of com){
      assert.equal(x.d, textoD(x.dpp), `${x.k} ${x.u}`);
      assert.match(x.d, x.dpp > 0 ? /^▲ \+/ : /^▼ −/, `${x.k} ${x.u}`);
      assert.match(x.cls, x.dpp > 0 ? /\bpos\b/ : /\bneg\b/, `${x.k} ${x.u}`);
    }
    const sobe = com.find(x => x.dpp > 0 && x.u !== 'BAND'), desce = com.find(x => x.dpp < 0 && x.u !== 'BAND');
    assert.equal(await corD(sobe.k, sobe.u), cores.pos);
    assert.equal(await corD(desce.k, desce.u), cores.neg);
    // categoria sem meta no escopo (Still, no sintético): "—" na linha e em todas as unidades
    const still = await linhasEvo(page, 'VOL STILL');
    assert.ok([still.tot, ...still.us].every(x => x.d === '—' && x.pa === '—' && x.dpp == null), 'Still: "—"');
    // G211 sem Refrigerantes no mês anterior: a SV.G2.1 só com a G212; a rota "—" no fim
    await vaiPara(page, {perfil: 'sv', gc: 'G2', sv: '1'}, null);
    await page.click(catEvo('VOL REFRIGERANTES'));
    const sv = await linhasEvo(page, 'VOL REFRIGERANTES');
    const g212 = await page.evaluate(() => P.MES_ANTERIOR.ROTAS.G212[0][0]);
    assert.equal(sv.tot.realAnt, g212);
    const g211 = sv.us.find(x => x.u === 'Rota G211');
    assert.deepEqual([g211.d, g211.pb, g211.realAnt], ['—', '—', null]);
    assert.equal(sv.us.at(-1).u, 'Rota G211');
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('caixa de comentário no hover, no teclado e no toque (categoria e unidade)', async () => {
    let {page, ctx, erros} = await abre('evo', {entrar: 'dir', aba: null, largura: 1440});
    const m = await page.evaluate(() => P.MES_LABEL);
    const cat = catEvo('VOL REFRIGERANTES');
    // rolar fecha a caixa: a linha vai para a tela antes (o hover não rola mais)
    await page.evaluate(s => document.querySelector(s).scrollIntoView({block: 'center'}), cat);
    await page.waitForTimeout(100);
    await page.hover(cat);
    assert.match(await dicaAberta(page), new RegExp(`^Refrigerantes · BANDSetembro/26 até 11/09: Real [\\d.]+ \\([\\d.]+,\\d% da meta [\\d.]+\\)` +
      `${m}: Real [\\d.]+ \\([\\d.]+,\\d% da meta [\\d.]+\\)Δ [+−][\\d.]+,\\d p\\.p\\. · Real [+−][\\d.]+,\\d%$`));
    assert.ok(await page.evaluate(s => document.querySelector(s).classList.contains('emFoco'), cat));
    // a dica fala dos mesmos números da linha
    const l = await linhasEvo(page, 'VOL REFRIGERANTES');
    const t = await dicaAberta(page);
    assert.ok(t.includes(`(${l.tot.pb} da meta`) && t.includes(`(${l.tot.pa} da meta`) && t.includes(`Δ ${l.tot.d.replace(/^[▲▼] /, '')} p.p.`), t);
    // o clique abre e a dica continua; a unidade também tem a dica
    await page.click(cat);
    assert.deepEqual(await evoAbertas(page), ['VOL REFRIGERANTES']);
    const un = '#exEvDet0 .evLin[data-u="GC.G1"]';
    await page.hover(un);
    assert.match(await dicaAberta(page), /^Refrigerantes · GC\.G1Setembro\/26 até 11\/09: Real/);
    await page.mouse.move(5, 5);
    assert.equal(await dicaAberta(page), null, 'some ao sair');
    // teclado: foco mostra, ESC fecha (a linha já à vista: rolar a página fecha a caixa, regra do componente)
    await page.evaluate(s => document.querySelector(s).scrollIntoView({block: 'center'}), catEvo('VOL AGUA MINERAL'));
    await page.waitForTimeout(100);
    await page.focus(catEvo('VOL AGUA MINERAL'));
    assert.match(await dicaAberta(page), /^Água Mineral · BAND/);
    await page.keyboard.press('Escape');
    assert.equal(await dicaAberta(page), null, 'ESC fecha');
    await page.evaluate(s => document.querySelector(s).scrollIntoView({block: 'center'}), un);
    await page.waitForTimeout(100);
    await page.focus(un);
    assert.match(await dicaAberta(page), /^Refrigerantes · GC\.G1/);
    assert.deepEqual(erros, []);
    await ctx.close();
    // toque: o toque abre a categoria e mostra a dica; o 2º toque recolhe e fecha
    ({page, ctx, erros} = await abre('evo', {entrar: 'dir', aba: null, largura: 390, toque: true}));
    await page.evaluate(s => document.querySelector(s).scrollIntoView({block: 'center'}), cat);
    await page.tap(cat);
    assert.match(await dicaAberta(page), /^Refrigerantes · BAND/);
    assert.deepEqual(await evoAbertas(page), ['VOL REFRIGERANTES']);
    await page.tap(cat);
    assert.equal(await dicaAberta(page), null, 'o 2º toque fecha');
    assert.deepEqual(await evoAbertas(page), []);
    await page.tap(cat);
    await page.tap('#exEvDet0 .evLin[data-u="GC.G1"]');
    assert.match(await dicaAberta(page), /^Refrigerantes · GC\.G1/);
    assert.deepEqual(await evoAbertas(page), ['VOL REFRIGERANTES'], 'tocar na unidade não recolhe');
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  for(const largura of [1440, 1200, 1000, 390, 360]){
    test(`${largura} px: sem rolagem lateral nem texto cortado (todas as categorias abertas, com Δ de 4 dígitos); Inter e Source Serif 4 só no %; Δ ${largura >= 700 ? 'na linha' : 'embaixo do valor'}`, async () => {
      for(const [dados, entrar] of [['evogrande', 'dir'], ['evogrupo', {perfil: 'gc', gc: 'IT+MO'}], ['evo', {perfil: 'sv', gc: 'G2', sv: '1'}],
                                    ['evofech', 'dir'], ['vol5', 'dir']]){
        const onde = `${largura} ${dados} ${JSON.stringify(entrar)}`;
        const {page, ctx, erros} = await abre(dados, {largura, altura: 900, entrar, aba: null});
        await medidas(page);
        await page.evaluate(() => document.fonts.ready);
        assert.ok(await evoVisivel(page), onde);
        await page.evaluate(ABRE_TODAS);
        assert.ok(await semRolagemLateral(page), `${onde}: rolagem lateral`);
        assert.deepEqual(await page.evaluate(() => __vis.estouros('#exEvo')), [], onde);
        const r = await page.evaluate(() => {
          const fam = e => getComputedStyle(e).fontFamily;
          const todos = [...document.querySelectorAll('#exEvo, #exEvo *')].filter(e => !(e instanceof SVGElement));
          const box = e => e.getBoundingClientRect();
          const lin = [...document.querySelectorAll('#exEvo .evLin')].filter(l => l.getClientRects().length).map(l => {
            const pa = box(l.querySelector('.evPA')), d = box(l.querySelector('.evD')), ba = box(l.querySelector('.evBarras')), li = box(l);
            return {abaixo: d.top >= pa.bottom - 0.5, dentro: d.right <= li.right + 0.5 && pa.right <= li.right + 0.5 && ba.left >= li.left - 0.5};
          });
          return {serif: [...new Set(todos.filter(e => /Serif/.test(fam(e))).map(e => e.className))],
            semInter: todos.filter(e => !/Serif/.test(fam(e)) && !/^Inter/.test(fam(e))).map(e => e.className),
            lin, n: lin.length, sub: (() => { const e = document.getElementById('exSEvo'); return e.scrollWidth <= e.clientWidth; })()};
        });
        assert.deepEqual(r.serif, ['evPA'], `${onde}: serifa só no % do mês de referência`);
        assert.deepEqual(r.semInter, [], `${onde}: o resto em Inter`);
        assert.ok(r.sub, `${onde}: subtítulo`);
        assert.ok(r.n > 5, onde);
        assert.ok(r.lin.every(x => x.dentro), `${onde}: tudo dentro da linha`);
        assert.ok(r.lin.every(x => x.abaixo === (largura < 700)), `${onde}: Δ ${largura < 700 ? 'embaixo do valor' : 'ao lado'}`);
        // contraste AA (4,5:1) dos textos do bloco: nomes, os dois %, o Δ e a legenda
        const baixo = (await page.evaluate(() => __vis.contrastes(['#exEvo .evTxt', '#exEvo .evPA', '#exEvo .evPB', '#exEvo .evDN',
          '#exEvo .evD small', '#exEvLeg > span', '#exSEvo']))).filter(c => c[2] < 4.5);
        assert.deepEqual(baixo, [], `${onde}: contraste`);
        assert.deepEqual(erros, [], onde);
        await ctx.close();
      }
    });
  }

  test('antes x depois (main antes do redesenho, mesmo payload): cards, cabeçalho, cascata, Resumo e a Executiva sem o bloco iguais', {skip: !FRONT_PRE_EVO && `sem o commit ${REF_PRE_EVO}`}, async () => {
    // a Executiva sem o bloco "Evolução contra o mês anterior" (o único redesenhado) e o comentário dele
    const semEvo = () => { const c = document.getElementById('exec').cloneNode(true);
      [...c.childNodes].filter(n => n.nodeType === 8 && /Evolução/.test(n.data))
        .forEach(n => { n.previousSibling.remove(); n.nextSibling.remove(); n.remove(); });
      c.querySelector('#exEvo').remove();
      return c.innerHTML; };
    const vistos = [];
    for(const entrar of ['dir', {perfil: 'gc', gc: 'G1'}, {perfil: 'gc', gc: 'IT+MO'}, {perfil: 'sv', gc: 'G2', sv: '1'},
                         {perfil: 'rota', gc: 'G2', rota: 'G211'}]){
      const onde = JSON.stringify(entrar);
      const [novo, velho] = [await abre('vol5', {entrar, largura: 1280, aba: null}), await abre('vol5', {entrar, largura: 1280, aba: null, troca: FRONT_PRE_EVO})];
      for(const {page} of [novo, velho]) await variedade(page);
      if(entrar.perfil !== 'rota'){
        for(const {page} of [novo, velho]){ await vaiAba(page, 'VOLUME'); await vaiAba(page, 'EXEC'); }
        assert.equal(...igualSemFalta(await novo.page.evaluate(semEvo), await velho.page.evaluate(semEvo)), `${onde}: Executiva sem o bloco`);
        vistos.push(`${onde} EXEC`);
      }
      for(const aba of ['VOLUME', 'ICS_GC', 'NOVOS_NEG', 'INCENTIVO']){
        for(const {page} of [novo, velho]) await filtra(page, {aba});
        assert.deepEqual(await novo.page.evaluate(CABECALHO), await velho.page.evaluate(CABECALHO), `${onde} ${aba}: cabeçalho e cards`);
        assert.equal(require('./cascata_invariantes.js').desfazCasc(await novo.page.innerHTML('#lista')), await velho.page.innerHTML('#lista'), `${onde} ${aba}: cards`);
        // cascata dos 2 primeiros cards, do 1º nível até os clientes
        const ks = (await novo.page.$$eval('#lista .ind[data-k]', els => els.map(e => e.dataset.k))).slice(0, 2);
        for(const k of ks){
          for(const {page} of [novo, velho]) await page.click(`#lista .ind[data-k="${k}"]`);
          for(let nivel = 0; nivel < 5; nivel++){
            assert.equal(require('./cascata_invariantes.js').desfazCasc(await novo.page.innerHTML('#drw')), await velho.page.innerHTML('#drw'), `${onde} ${aba} ${k}: cascata nível ${nivel}`);
            if(entrar === 'dir' || !(await novo.page.$('#dCorpo .cLin[data-i]'))) break;  // Diretoria: GC > Clientes (Etapa 3 do pacote v3)
            for(const {page} of [novo, velho]) await page.click('#dCorpo .cLin[data-i]');
          }
          for(const {page} of [novo, velho]) await page.keyboard.press('Escape');
        }
        vistos.push(`${onde} ${aba}`);
      }
      if(entrar.perfil !== 'rota'){
        for(const {page} of [novo, velho]) await page.click('#btnResumo');
        assert.equal(await novo.page.innerHTML('#rsFolha'), await velho.page.innerHTML('#rsFolha'), `${onde}: Resumo`);
        for(const {page} of [novo, velho]) await page.click('#rsVoltar');
      }
      assert.deepEqual([...novo.erros, ...velho.erros], [], onde);
      for(const {ctx} of [novo, velho]) await ctx.close();
    }
    assert.ok(vistos.length >= 24, vistos.join(', '));
  });
});

/* ---------- Parte AA — rótulos: "Novos Negócios" no macro de volume, nome da aba EXEC por perfil, notas menores ----------
   O macro VOL DEST+ART+CND aparece como CONFIG.ROTULO_VOLUME_NOVOS em todo o painel; CONFIG.ROTULO_VOLUME_SUB ("Dest+Art+Cnd")
   só como 2ª linha do card da aba Volume. A aba/grupo de coberturas "Novos Negócios" (NOVOS_NEG) não muda. Antes x depois
   contra o front de REF_ROTULOS (main antes do ajuste), com o mesmo payload. */
const ROT = require('./rotulos_invariantes.js');
const VOL_AA = ['VOL REFRIGERANTES', 'VOL CERVEJAS', 'VOL STILL', 'VOL AGUA MINERAL', 'VOL DEST+ART+CND'];
const REF_ROTULOS = '20728ac';
const FRONT_PRE_ROTULOS = (() => {
  try {
    const arq = f => execSync(`git show ${REF_ROTULOS}:frontend/${f}`, {cwd: RAIZ, stdio: ['ignore', 'pipe', 'ignore']}).toString();
    const fs_ = ['index.html', 'css/app.css', 'js/config.js', 'js/nucleo.js', 'js/app.js', 'js/resumo.js', 'js/ritmo.js', 'js/main.js'];
    return Object.fromEntries(fs_.map(f => { const t = arq(f); return ['/' + f, () => t]; }));
  } catch(e) { return null; }
})();
const PERFIS_AA = [
  {nome: 'Diretoria', entrar: 'dir', perfil: 'dir'},
  {nome: 'Gerência G1', entrar: {perfil: 'gc', gc: 'G1'}, perfil: 'gc'},
  {nome: 'grupo IT+MO', entrar: {perfil: 'gc', gc: 'IT+MO'}, perfil: 'gc'},
  {nome: 'Supervisão', entrar: {perfil: 'sv', gc: 'G2', sv: '1'}, perfil: 'sv'},
  {nome: 'Rota', entrar: {perfil: 'rota', gc: 'G2', rota: 'G211'}, perfil: 'rota'},
];
const {TEXTOS_TELA_PAGINA: TEXTOS_TELA} = ROT;
// o que os ajustes visuais da Executiva (Parte AE) acrescentam de propósito (ROT.desfazAE)
const semAjustesAE = ROT.desfazAE;
// os macros de volume sem dado no sintético ganham o bloco de Refrigerantes da rota em escala (os % ficam iguais)
function montaVolume5(p){
  const fat = {'VOL CERVEJAS': .6, 'VOL STILL': .3, 'VOL AGUA MINERAL': .4, 'VOL DEST+ART+CND': .15};
  for(const gc in p.DATA) for(const sv in p.DATA[gc]) for(const r in p.DATA[gc][sv]){
    const ind = p.DATA[gc][sv][r].indicators, b = ind['VOL REFRIGERANTES'];
    if(!b || b.unavailable) continue;
    for(const [k, f] of Object.entries(fat)){
      if(ind[k] && !ind[k].unavailable) continue;
      const c = JSON.parse(JSON.stringify(b));
      for(const x in c) if(typeof c[x] === 'number' && !/^pct/.test(x)) c[x] = Math.round(c[x] * f * 10) / 10;
      ind[k] = c;
    }
  }
}
const {semNaN, comNomeNovo} = ROT;

describe('Parte AA — rótulo "Novos Negócios" do volume, aba por perfil e notas menores', {skip: pular}, () => {
  for(const largura of [1440, 390]){
    test(`card de Volume "${ROT.NOVOS}" com a 2ª linha "${ROT.SUB}" (menor, mais clara, AA) em todos os perfis; os outros 4 sem ela (${largura} px)`, async () => {
      const {page, ctx, erros} = await abre('vol5', {entrar: 'dir', largura, aba: 'VOLUME'});
      for(const c of PERFIS_AA){
        await vaiPara(page, c.entrar, 'VOLUME');
        for(const fator of [0.2, 3]){        // fundo rosa (abaixo) e verde claro (no ritmo)
          await page.evaluate(([k, f]) => { for(const r of Object.keys(P.DATA).flatMap(g => Object.values(P.DATA[g]).flatMap(Object.values)))
            if(r.indicators && r.indicators[k] && !r.indicators[k].unavailable){ const b = r.indicators[k];
              b.real = b.meta * f / 3; if(b.tendencia != null) b.tendencia = b.meta * f; } render(); }, [ROT.K_NOVOS, fator]);
          const cs = await page.evaluate(ROT.CARDS_VOLUME_PAGINA, ROT.K_NOVOS), onde = `${c.nome} ${largura} fator ${fator}`;
          const vol = cs.filter(x => x.vol), nn = vol.find(x => x.k === ROT.K_NOVOS);
          // os 5 macros (na G2 também o Del Valle Frut, sem a linha)
          for(const k of VOL_AA) assert.ok(vol.some(x => x.k === k), `${onde}: card ${k}`);
          assert.ok(nn, `${onde}: card ${ROT.NOVOS}`);
          assert.deepEqual([nn.tit, nn.sub, nn.sVisivel, nn.sDepois], [ROT.NOVOS, ROT.SUB, true, true], onde);
          assert.ok(nn.sFs < nn.tFs && nn.sFs >= 10.5 && nn.sFs <= 11.5, `${onde}: tamanho ${nn.sFs} x ${nn.tFs}`);
          assert.equal(nn.sPeso, '400', onde);
          assert.ok(nn.sLum > nn.tLum, `${onde}: 2ª linha mais clara`);
          assert.ok(nn.sContraste >= 4.5, `${onde}: contraste ${nn.sContraste.toFixed(2)}`);
          assert.deepEqual(cs.filter(x => x !== nn).map(x => x.sub), cs.filter(x => x !== nn).map(() => null), `${onde}: só um card com a linha`);
          // a linha extra não deforma a grade: cards de volume da mesma linha com a mesma altura; nenhum abaixo da mínima
          const porLinha = {};
          for(const x of vol) (porLinha[x.topo] = porLinha[x.topo] || []).push(x.h);
          for(const hs of Object.values(porLinha)) assert.ok(Math.max(...hs) - Math.min(...hs) <= 1, `${onde}: alturas ${hs}`);
          const hMin = Math.min(...vol.filter(x => x !== nn).map(x => x.h));
          assert.ok(nn.h - hMin <= 1, `${onde}: card ${ROT.NOVOS} ${nn.h} x ${hMin}`);
        }
      }
      assert.deepEqual(erros, []);
      await ctx.close();
    });
  }

  test(`nenhum "${ROT.SUB}" visível fora da 2ª linha do card: abas, visão executiva, gaveta, Resumo e Painel de Ritmo só com "${ROT.NOVOS}"`, async () => {
    for(const dados of ['vol5', 'vol5fech']){
      const {page, ctx, erros} = await abre(dados, {entrar: 'dir', largura: 1440, aba: null});
      for(const c of PERFIS_AA){
        await vaiPara(page, c.entrar, null);
        for(const aba of ['EXEC', 'VOLUME', 'ICS_GC', 'NOVOS_NEG', 'INCENTIVO']){
          if(!await page.evaluate(a => { const t = document.querySelector(`.tab[data-g="${a}"]`); return !t.hidden; }, aba)) continue;
          await filtra(page, {aba});
          const onde = `${dados} ${c.nome} ${aba}`;
          // dicas da visão executiva e das linhas: todas com o nome novo
          assert.deepEqual(await page.evaluate(ROT.RASTRO_PAGINA, ROT.SUB), [], onde);
          if(aba === 'EXEC'){
            const t = await page.evaluate(() => document.getElementById('exec').textContent);
            assert.ok(t.includes(ROT.NOVOS), `${onde}: medidor/linhas com ${ROT.NOVOS}`);
            // categoria em análise = o macro: Foco do fechamento, Meta do dia e Tendência x Meta com o nome novo
            await page.evaluate(k => escolheCat(k, 'exGauges'), ROT.K_NOVOS);
            const f = await page.evaluate(() => [document.getElementById('exFocoTxt').textContent, document.getElementById('exDiaTxt').textContent,
              document.querySelector('#exDivs .dv.sel h4').textContent]);
            assert.ok(f[0].startsWith(ROT.NOVOS) && f[2] === ROT.NOVOS, `${onde}: ${f}`);
            if(dados === 'vol5') assert.ok(f[1].startsWith(ROT.NOVOS), `${onde}: ${f[1]}`);
            assert.deepEqual(await page.evaluate(ROT.RASTRO_PAGINA, ROT.SUB), [], `${onde} (categoria ${ROT.NOVOS})`);
          }
          if(aba === 'VOLUME'){
            const g = await cascata(page, ROT.K_NOVOS, 'VOLUME');
            assert.ok(g.tit.startsWith(`${ROT.NOVOS} · `), `${onde}: gaveta ${g.tit}`);
            assert.equal(await page.$$eval('#drw .tsub', e => e.length), 0, `${onde}: gaveta só com o nome`);
            assert.deepEqual(await page.evaluate(ROT.RASTRO_PAGINA, ROT.SUB), [], `${onde} gaveta`);
            await page.click('#dX');
          }
        }
        if(c.perfil !== 'rota'){
          await page.click('#btnResumo');
          const r = await page.evaluate(() => document.getElementById('rsFolha').innerText);
          if(dados === 'vol5') assert.ok(r.includes(ROT.NOVOS), `${dados} ${c.nome}: Resumo`);
          assert.deepEqual(await page.evaluate(ROT.RASTRO_PAGINA, ROT.SUB), [], `${dados} ${c.nome} Resumo`);
          await page.click('#rsVoltar');
        }
        // Painel de Ritmo: modelo (função pura) e páginas desenhadas
        const rt = await page.evaluate(() => { const e = RT.escopoRitmo(); if(!e) return null;
          const m = montaRitmo(P, e), html = m.paginas.map(pg => { const x = RT.desenhaPagina(pg); return typeof x === 'string' ? x : x.outerHTML; }).join('');
          return {m: JSON.stringify(m), html}; });
        if(c.perfil === 'rota') assert.equal(rt, null);
        else for(const [n, t] of Object.entries(rt)){
          assert.ok(!t.includes(ROT.SUB), `${dados} ${c.nome}: Painel de Ritmo (${n})`);
          assert.ok(t.includes(ROT.NOVOS), `${dados} ${c.nome}: Painel de Ritmo (${n}) com ${ROT.NOVOS}`);
        }
      }
      assert.deepEqual(erros, []);
      await ctx.close();
    }
  });

  for(const largura of [1440, 390]){
    test(`nome da aba EXEC por perfil: Diretoria, Gerencial (também no grupo), Supervisão; a Rota sem a aba (${largura} px)`, async () => {
      const {page, ctx, erros} = await abre('vol5', {entrar: 'dir', largura, aba: null});
      for(const c of PERFIS_AA){
        await vaiPara(page, c.entrar, null);
        const a = await page.evaluate(ROT.ABA_EXEC_PAGINA), onde = `${c.nome} ${largura}`;
        if(c.perfil === 'rota'){ assert.equal(a.visivel, false, onde); continue; }
        const n = ROT.NOME_EXEC[c.perfil];
        assert.deepEqual([a.visivel, a.on, a.span, a.title, a.aria, a.abTit], [true, true, n, n, n, n], onde);
        // painel lateral (PC) ou topo do celular: o rótulo visível do botão; o recolhido guarda o nome no title
        assert.equal(await page.evaluate(() => document.querySelector('.tab[data-g="EXEC"]').innerText.trim()), n, onde);
        // a aba de coberturas "Novos Negócios" continua com o nome dela
        assert.equal(await page.getAttribute('.tab[data-g="NOVOS_NEG"]', 'title'), 'Novos Negócios');
        await filtra(page, {aba: 'VOLUME'});
        assert.equal(await page.textContent('#abTit'), 'Volume', onde);
        await filtra(page, {aba: 'EXEC'});
        assert.equal(await page.textContent('#abTit'), n, onde);
      }
      if(largura === 1440){
        await vaiPara(page, PERFIS_AA[3].entrar, null);
        await page.click('#ladoMenu');                 // recolhido: só os ícones, o nome no title
        assert.equal(await page.getAttribute('.tab[data-g="EXEC"]', 'title'), 'Supervisão');
      }
      assert.deepEqual(erros, []);
      await ctx.close();
    });
  }

  test('antes x depois (mesmo payload): cards, cabeçalho, visão executiva, gavetas e Resumo iguais aos da main, exceto o nome novo, a 2ª linha e o nome da aba', {skip: !FRONT_PRE_ROTULOS && `sem o commit ${REF_ROTULOS}`}, async () => {
    const vistos = [];
    for(const c of PERFIS_AA){
      const [novo, velho] = [await abre('vol5', {entrar: c.entrar, largura: 1280, aba: null}),
                             await abre('vol5', {entrar: c.entrar, largura: 1280, aba: null, troca: FRONT_PRE_ROTULOS})];
      for(const aba of ['EXEC', 'VOLUME', 'ICS_GC', 'NOVOS_NEG', 'INCENTIVO']){
        const tem = await novo.page.evaluate(a => !document.querySelector(`.tab[data-g="${a}"]`).hidden, aba);
        assert.equal(await velho.page.evaluate(a => !document.querySelector(`.tab[data-g="${a}"]`).hidden, aba), tem);
        if(!tem) continue;
        for(const {page} of [novo, velho]) await filtra(page, {aba});
        const onde = `${c.nome} ${aba}`;
        const [a, b] = [await novo.page.evaluate(TEXTOS_TELA), await velho.page.evaluate(TEXTOS_TELA)];
        assert.deepEqual(semAjustesAE(a), comNomeNovo(b), onde);
        assert.ok(a.lista.length || a.exec, onde);
        vistos.push(onde);
        // gavetas: o macro de volume e o 1º card de coberturas da aba (Novos Negócios: Campari...)
        const ks = await novo.page.$$eval('#lista .ind[data-k]', e => e.map(x => x.dataset.k));
        for(const k of aba === 'VOLUME' ? [ROT.K_NOVOS] : aba === 'EXEC' ? [] : ks.slice(0, 1)){
          const [ga, gb] = [await cascata(novo.page, k, aba), await cascata(velho.page, k, aba)];
          // texto da gaveta; no atual, com a cascata desfeita do que a Etapa 3 do pacote v3 trocou (desfazCasc)
          const texto = (p, desfaz) => p.innerHTML('#drw').then(h => p.evaluate(h => { const d = document.createElement('div');
            d.innerHTML = h; return d.textContent.replace(/\s+/g, ' ').trim(); }, desfaz ? require('./cascata_invariantes.js').desfazCasc(h) : h));
          const [ta, tb] = [await texto(novo.page, true), await texto(velho.page)];
          assert.deepEqual(semNaN([ga, ta]), comNomeNovo([gb, tb]), `${onde} gaveta ${k}`);
          for(const {page} of [novo, velho]) await page.click('#dX');
        }
      }
      if(c.perfil !== 'rota'){
        for(const {page} of [novo, velho]) await page.click('#btnResumo');
        const [ra, rb] = [await novo.page.evaluate(() => document.getElementById('rsFolha').innerText),
                          await velho.page.evaluate(() => document.getElementById('rsFolha').innerText)];
        assert.equal(ra, comNomeNovo([rb])[0], `${c.nome} Resumo`);
      }
      assert.deepEqual([...novo.erros, ...velho.erros], []);
      for(const {ctx} of [novo, velho]) await ctx.close();
    }
    assert.ok(vistos.length >= 20, vistos.join(', '));
  });

  for(const largura of [1440, 390]){
    test(`notas menores que as da main (rodapé, crédito, legendas da visão executiva), com contraste AA; notas da gaveta iguais (${largura} px)`, {skip: !FRONT_PRE_ROTULOS && `sem o commit ${REF_ROTULOS}`}, async () => {
      const [novo, velho] = [await abre('evo', {entrar: 'dir', largura, aba: null}),
                             await abre('evo', {entrar: 'dir', largura, aba: null, troca: FRONT_PRE_ROTULOS})];
      const [a, b] = [await novo.page.evaluate(ROT.NOTAS_PAGINA), await velho.page.evaluate(ROT.NOTAS_PAGINA)];
      const esperadas = largura >= 1000 ? ['rodape', 'creditos', 'legenda', 'ladoCred'] : ['rodape', 'creditos', 'legenda'];
      assert.deepEqual(Object.keys(a).sort(), esperadas.slice().sort());
      for(const n of esperadas){
        assert.ok(a[n].fs < b[n].fs && a[n].fs >= b[n].fs - 1.01 && a[n].fs >= b[n].fs * 0.9 - 0.01, `${n}: ${a[n].fs} x ${b[n].fs}`);
        assert.ok(a[n].contraste >= 4.5, `${n}: contraste ${a[n].contraste.toFixed(2)}`);
      }
      // notas da gaveta (rotas virtuais e eventuais) e o resto da cascata: mesmo tamanho de letra que na main
      for(const {page} of [novo, velho]){ await vaiPara(page, {perfil: 'gc', gc: 'IT+MO'}, 'VOLUME'); await page.click('.ind[data-k="VOL REFRIGERANTES"]'); }
      // (fora a linha nova da cascata e o cabeçalho/chips de ordenação da Etapa 3 do pacote v3, .v3, e as linhas que ela substitui)
      const fsGaveta = fora => [...document.querySelectorAll('#drw, #drw *')].filter(e => !e.closest(fora)).map(e => getComputedStyle(e).fontSize);
      assert.deepEqual(await novo.page.evaluate(fsGaveta, '.v3'), await velho.page.evaluate(fsGaveta, '.cLin:not(.off)'));
      assert.deepEqual([...novo.erros, ...velho.erros], []);
      for(const {ctx} of [novo, velho]) await ctx.close();
    });
  }
});

/* ---------- Parte AB: senha da Diretoria (controle de acesso interno, NÃO é segurança) ----------
   As senhas reais nunca ficam no repositório: o config.js servido leva os hashes das senhas FICTÍCIAS de senha_teste.js
   (trocaHash, em abre()). */
const MSG_SENHA_DIR = 'Digite a senha para entrar na Diretoria';
// caixa de senha: visível, título, mensagem, valor do campo, foco e atributos do campo
const caixaSenha = page => page.evaluate(() => {
  const c = document.getElementById('entCaixa'), i = document.getElementById('entSenha'), a = document.activeElement || {};
  const m = document.getElementById('entSenhaMsg');
  return {vis: !c.hidden, tit: document.getElementById('entCaixaTit').textContent, campo: !!i,
    valor: i ? i.value : null, msg: m ? m.textContent : null, papel: m ? m.getAttribute('role') : null,
    foco: a.id || a.textContent, voltar: document.getElementById('entVoltar').hidden ? null : document.getElementById('entVoltar').textContent,
    attrs: i ? ['type', 'autocomplete', 'autocapitalize', 'aria-label'].map(n => i.getAttribute(n)) : null,
    entrar: [...c.querySelectorAll('button[type="submit"]')].map(b => b.textContent)};
});
// tenta uma senha (Enter ou o botão "Entrar") e espera a resposta (mensagem ou saída da entrada)
async function tentaSenha(page, senha, como = 'enter'){
  await page.fill('#entSenha', senha);
  await page.evaluate(() => { const m = document.getElementById('entSenhaMsg'); if(m) m.textContent = ''; });
  if(como === 'enter') await page.press('#entSenha', 'Enter'); else await page.click('#entEntrar');
  await page.waitForFunction(() => document.getElementById('entrada').hidden
    || (document.getElementById('entSenhaMsg') || {}).textContent);
}

describe('Parte AB — senha da Diretoria', {skip: pular}, () => {
  test('config.js: dois hashes SHA-256 hex minúsculos (64), nada além dos hashes; a conta do teste = hashSenha do front', async () => {
    const cfg = fs.readFileSync(path.join(FRONT, 'js', 'config.js'), 'utf-8');
    const m = cfg.match(/DIRETORIA_SENHAS_HASH:\s*\[([^\]]*)\]/);
    assert.ok(m, 'CONFIG.DIRETORIA_SENHAS_HASH');
    const hashes = [...m[1].matchAll(/'([^']*)'/g)].map(x => x[1]);
    assert.equal(hashes.length, 2);
    for(const h of hashes) assert.match(h, /^[0-9a-f]{64}$/);
    assert.notEqual(hashes[0], hashes[1]);
    assert.match(cfg, /NÃO é segurança/);
    const {page, ctx, erros} = await abre('normal', {entrar: null, antes: fixo()});
    // o front servido leva os hashes de teste; a função dele dá o mesmo hash que o teste (normalização inclusive)
    assert.deepEqual(await page.evaluate(() => CONFIG.DIRETORIA_SENHAS_HASH), HASHES_TESTE);
    for(const s of [...SENHAS_TESTE, '  ' + SENHAS_TESTE[0].toLowerCase() + ' ', 'Ação ÚNICA'])
      assert.equal(await page.evaluate(s => hashSenha(s), s), hashTeste(s), s);
    assert.equal(hashTeste(' abc '), hashTeste('ABC'));
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('DIRETORIA abre a caixa com o campo Senha (foco nele) e "Entrar"; GERÊNCIA, SUPERVISÃO e ROTA sem senha', async () => {
    const {page, ctx, erros} = await abre('normal', {entrar: null, antes: fixo()});
    assert.deepEqual(await page.$$eval('#entBotoes button', bs => bs.map(b => b.textContent)),
                     ['DIRETORIA', 'GERÊNCIA', 'SUPERVISÃO', 'ROTA']);
    await page.click('#entrada [data-perfil="dir"]');
    let c = await caixaSenha(page);
    assert.deepEqual([c.vis, c.tit, c.campo, c.valor, c.msg, c.papel, c.foco, c.voltar, c.entrar],
                     [true, 'DIRETORIA', true, '', '', 'alert', 'entSenha', '← Voltar', ['Entrar']]);
    assert.deepEqual(c.attrs, ['password', 'off', 'off', 'Senha']);
    assert.equal(await page.getAttribute('#entCaixa', 'role'), 'dialog');
    assert.equal(await page.getAttribute('#entCaixa', 'aria-modal'), 'true');
    let e = await estado(page);
    assert.deepEqual([e.entrada, e.guardado, e.acesso], [true, null, null], 'ainda na entrada');
    // os outros perfis: a caixa de seleção de sempre, sem campo
    for(const perfil of ['gc', 'sv', 'rota']){
      await page.keyboard.press('Escape');
      await page.click(`#entrada [data-perfil="${perfil}"]`);
      assert.deepEqual([(await caixa(page)).campos, (await caixa(page)).voltar], [0, false], perfil);
    }
    await page.keyboard.press('Escape');
    for(const [entrar, perfil] of [[{perfil: 'gc', gc: 'G2'}, 'gc'], [{perfil: 'sv', gc: 'G2', sv: '1'}, 'sv'],
                                   [{perfil: 'rota', gc: 'G2', rota: 'G211'}, 'rota']]){
      await page.click(`#entrada [data-perfil="${perfil}"]`);
      assert.equal(await page.isVisible('#entSenha'), false, perfil);
      await page.keyboard.press('Escape');
      await entra(page, entrar, null);
      e = await estado(page);
      assert.deepEqual([e.entrada, e.acesso[0], e.guardado.v], [false, perfil, 2], perfil);
      await page.click('#btnCasa');
    }
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('incorreta, vazia e só espaços: "Senha incorreta" (alert), campo limpo, foco nele, fica na entrada', async () => {
    const {page, ctx, erros} = await abre('normal', {entrar: null, antes: fixo()});
    await page.click('#entrada [data-perfil="dir"]');
    for(const [senha, como] of [['errada', 'enter'], ['', 'enter'], ['   ', 'botao'], [SENHAS_TESTE[0] + 'x', 'botao'],
                                ['Teste Painel', 'enter']]){
      await tentaSenha(page, senha, como);
      const c = await caixaSenha(page);
      assert.deepEqual([c.vis, c.msg, c.papel, c.valor, c.foco], [true, 'Senha incorreta', 'alert', '', 'entSenha'], JSON.stringify(senha));
      const e = await estado(page);
      assert.deepEqual([e.entrada, e.guardado, e.acesso], [true, null, null]);
    }
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('as duas senhas, em minúsculas e com espaços nas pontas, por Enter ou "Entrar": entra na Diretoria; sessão v:2 sem senha nem hash', async () => {
    const {page, ctx, erros} = await abre('normal', {entrar: null, antes: fixo()});
    const casos = [[SENHAS_TESTE[0], 'enter'], [SENHAS_TESTE[1], 'botao'], [SENHAS_TESTE[0].toLowerCase(), 'enter'],
                   [SENHAS_TESTE[1].toUpperCase(), 'botao'], ['  ' + SENHAS_TESTE[1] + '\t ', 'enter'], [' ' + SENHAS_TESTE[0] + ' ', 'botao']];
    for(const [senha, como] of casos){
      await page.click('#entrada [data-perfil="dir"]');
      await tentaSenha(page, senha, como);
      const e = await estado(page);
      assert.ok(!e.entrada, JSON.stringify(senha));
      assert.deepEqual([e.sel, e.filtros, e.acesso], [['dir', '', '', ''], ['fgc'], ['dir', '', '', '']]);
      assert.equal(await page.inputValue('#fgc'), '', '"Todas as gerências"');
      assert.match(e.sub, /· Diretoria$/);
      assert.deepEqual(e.guardado, {perfil: 'dir', gc: '', sv: '', rota: '', dia: DIA, v: 2});
      const txt = await guardadoTxt(page);
      for(const s of [...SENHAS_TESTE, ...HASHES_TESTE]) assert.ok(!txt.toUpperCase().includes(s.toUpperCase()), 'sem senha nem hash');
      assert.equal(await page.evaluate(() => document.getElementById('entSenha')), null, 'a caixa fechou (campo descartado)');
      assert.equal(await page.isVisible('#entCaixa'), false);
      await page.click('#btnCasa');
    }
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('ESC, × e "← Voltar" fecham a caixa (foco de volta no DIRETORIA); Tab preso na caixa; campo novo a cada abertura', async () => {
    const {page, ctx, erros} = await abre('normal', {entrar: null, antes: fixo()});
    for(const fecha of [p => p.keyboard.press('Escape'), p => p.click('#entFechar'), p => p.click('#entVoltar')]){
      await page.click('#entrada [data-perfil="dir"]');
      await page.fill('#entSenha', 'qualquer');
      await fecha(page);
      assert.equal(await page.isVisible('#entCaixa'), false);
      assert.equal(await page.evaluate(() => document.activeElement.dataset.perfil), 'dir');
      assert.deepEqual([(await estado(page)).entrada, (await estado(page)).guardado], [true, null]);
      await page.click('#entrada [data-perfil="dir"]');
      assert.deepEqual([(await caixaSenha(page)).valor, (await caixaSenha(page)).msg], ['', ''], 'campo novo');
      await page.keyboard.press('Escape');
    }
    // Tab: campo -> Entrar -> × -> ← Voltar -> campo (e o Shift+Tab ao contrário), sem sair da caixa
    await page.click('#entrada [data-perfil="dir"]');
    const focos = [];
    for(let i = 0; i < 5; i++){ await page.keyboard.press('Tab'); focos.push(await page.evaluate(() => document.activeElement.id)); }
    assert.deepEqual(focos, ['entEntrar', 'entFechar', 'entVoltar', 'entSenha', 'entEntrar']);
    await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Shift+Tab');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'entVoltar');
    // setas no campo não pulam para o botão
    await page.focus('#entSenha');
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'entSenha');
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('recarregar não pede a senha; a casa e a virada das 05:00 voltam à entrada e pedem de novo', async () => {
    const {page, ctx, erros} = await abre('normal', {entrar: null, antes: fixo(new Date('2026-10-14T07:58:00Z'))});
    await entra(page, 'dir', null);
    assert.deepEqual((await estado(page)).guardado, {perfil: 'dir', gc: '', sv: '', rota: '', dia: '2026-10-13', v: 2});
    await page.reload();
    await esperaCarga(page);
    let e = await estado(page);
    assert.deepEqual([e.entrada, e.acesso && e.acesso[0]], [false, 'dir'], 'reabre sem senha');
    assert.equal(await page.isVisible('#entCaixa'), false);
    // casa: apaga e pede a senha
    await page.click('#btnCasa');
    e = await estado(page);
    assert.deepEqual([e.entrada, e.guardado], [true, null]);
    await page.click('#entrada [data-perfil="dir"]');
    assert.equal((await caixaSenha(page)).campo, true, 'pede a senha depois da casa');
    await tentaSenha(page, SENHAS_TESTE[1]);
    assert.equal((await estado(page)).entrada, false);
    // virada às 05:00 de Brasília com o painel aberto (ao voltar para a aba) e ao recarregar
    await page.clock.setFixedTime(new Date('2026-10-14T08:00:00Z'));
    await page.evaluate(() => confereDia());
    e = await estado(page);
    assert.deepEqual([e.entrada, e.msg, e.guardado], [true, REINICIADO, null]);
    await page.click('#entrada [data-perfil="dir"]');
    assert.equal((await caixaSenha(page)).campo, true, 'pede a senha depois da virada');
    await tentaSenha(page, SENHAS_TESTE[0]);
    assert.deepEqual((await estado(page)).guardado, {perfil: 'dir', gc: '', sv: '', rota: '', dia: '2026-10-14', v: 2});
    await page.evaluate(s => localStorage.setItem('drotas_sessao', s), sessao({perfil: 'dir', v: 2}, '2026-10-13'));
    await page.reload();
    await esperaCarga(page);
    e = await estado(page);
    assert.deepEqual([e.entrada, e.msg, e.guardado], [true, REINICIADO, null]);
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('sessão de Diretoria antiga (sem v) é descartada com o aviso; Gerência, Supervisão e Rota antigas continuam', async () => {
    const antiga = a => JSON.stringify({gc: '', sv: '', rota: '', ...a, dia: DIA});      // formato de antes, sem v
    for(const s of [antiga({perfil: 'dir'}), JSON.stringify({perfil: 'dir', gc: '', sv: '', rota: '', dia: DIA, v: 1}),
                    JSON.stringify({perfil: 'dir', gc: '', sv: '', rota: ''})]){
      const {page, ctx, erros} = await abre('normal', {entrar: null, antes: fixo(), armazenado: {drotas_sessao: s}});
      const e = await estado(page);
      assert.deepEqual([e.entrada, e.msg, e.guardado, e.acesso], [true, MSG_SENHA_DIR, null, null], s);
      await page.click('#entrada [data-perfil="dir"]');
      assert.equal((await caixaSenha(page)).campo, true);
      await tentaSenha(page, SENHAS_TESTE[0]);
      assert.deepEqual((await estado(page)).guardado, {perfil: 'dir', gc: '', sv: '', rota: '', dia: DIA, v: 2});
      assert.deepEqual(erros, []);
      await ctx.close();
    }
    for(const [a, esperado] of [[{perfil: 'gc', gc: 'G2'}, ['gc', 'G2', '', '']],
                                [{perfil: 'gc', gc: 'IT+MO'}, ['gc', 'IT+MO', '', '']],
                                [{perfil: 'sv', gc: 'G2', sv: 'SV.G2.1'}, ['gc', 'G2', 'SV.G2.1', '']],
                                [{perfil: 'rota', gc: 'G2', rota: 'G211'}, ['gc', 'G2', 'SV.G2.1', 'G211']]]){
      const s = antiga(a);
      const {page, ctx, erros} = await abre('normal', {entrar: null, antes: fixo(), armazenado: {drotas_sessao: s}});
      const e = await estado(page);
      assert.deepEqual([e.entrada, e.msg, e.sel], [false, '', esperado], s);
      assert.equal(await guardadoTxt(page), s, 'o guardado antigo não é reescrito ao reabrir');
      assert.deepEqual(erros, []);
      await ctx.close();
    }
  });

  test('sem crypto.subtle (endereço não seguro): "Abra o painel pelo endereço seguro (https)" e não entra', async () => {
    const semCripto = p => p.addInitScript(() => {
      try { Object.defineProperty(Crypto.prototype, 'subtle', {get(){ return undefined; }, configurable: true}); } catch(e){}
    });
    const {page, ctx, erros} = await abre('normal', {entrar: null, antes: async p => { await fixo()(p); await semCripto(p); }});
    assert.equal(await page.evaluate(() => typeof crypto.subtle), 'undefined');
    await page.click('#entrada [data-perfil="dir"]');
    for(const senha of [SENHAS_TESTE[0], SENHAS_TESTE[1], '']){
      await tentaSenha(page, senha);
      const c = await caixaSenha(page);
      assert.deepEqual([c.vis, c.msg, c.valor, c.foco], [true, 'Abra o painel pelo endereço seguro (https)', '', 'entSenha']);
      const e = await estado(page);
      assert.deepEqual([e.entrada, e.guardado, e.acesso], [true, null, null]);
    }
    // os outros perfis entram normalmente
    await page.keyboard.press('Escape');
    await entra(page, {perfil: 'gc', gc: 'G2'}, null);
    assert.equal((await estado(page)).entrada, false);
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('?resumo= continua sem pedir senha nem mexer no acesso', async () => {
    const {page, ctx, erros} = await abre('normal', {entrar: null, antes: fixo(), busca: '?resumo=vol,ics&modo=dir'});
    assert.match(await page.textContent('#rsFolha h2'), /^Resumo de vendas/);
    assert.equal(await page.isVisible('#entSenha'), false);
    assert.equal(await guardadoTxt(page), null);
    await page.click('#rsVoltar');
    const e = await estado(page);
    assert.deepEqual([e.entrada, e.msg, e.guardado], [true, '', null]);
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  for(const largura of [360, 390, 1440])
  test(`${largura} px: caixa de senha nos dois fundos sem rolagem lateral, dentro da tela, sem erro`, async () => {
    const {page, ctx, erros} = await abre('normal', {entrar: null, antes: fixo(), largura, altura: largura < 1000 ? 740 : 900});
    for(const tema of ['preta', 'branca']){
      if(await page.evaluate(() => temaEntrada()) !== tema) await page.click('#btnTema');
      await page.click('#entrada [data-perfil="dir"]');
      await tentaSenha(page, 'errada');
      const m = await page.evaluate(() => {
        const r = el => el.getBoundingClientRect(), d = document.documentElement;
        const ids = ['entSenha', 'entEntrar', 'entSenhaMsg', 'entVoltar', 'entFechar'];
        return {rolagem: [d.scrollWidth, d.clientWidth, document.getElementById('entrada').scrollWidth,
                          document.getElementById('entrada').clientWidth],
          fora: ids.filter(id => { const b = r(document.getElementById(id)); return b.left < 0 || b.right > innerWidth || b.width === 0; }),
          fonte: parseFloat(getComputedStyle(document.getElementById('entSenha')).fontSize),
          cor: [getComputedStyle(document.getElementById('entSenha')).color, getComputedStyle(document.getElementById('entSenha')).backgroundColor]};
      });
      assert.ok(m.rolagem[0] <= m.rolagem[1] && m.rolagem[2] <= m.rolagem[3], `${tema}: ${m.rolagem}`);
      assert.deepEqual(m.fora, [], tema);
      assert.ok(m.fonte >= 16, 'campo com 16 px (sem zoom no iPhone)');
      assert.notEqual(m.cor[0], m.cor[1], 'texto do campo visível');
      await page.keyboard.press('Escape');
    }
    await entra(page, 'dir', null);
    const r = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    assert.ok(r[0] <= r[1], `${r}`);
    assert.deepEqual(erros, []);
    await ctx.close();
  });
});

/* ---------- Parte AC — gaveta "Categoria por unidade" na Executiva (tocar num medidor do bloco "Categorias") ----------
   Cenários: 'vol5'/'vol5fech' (os 5 macros de volume com dado), 'exec' (só Refrigerantes e Água Mineral: as outras sem meta)
   e 'grupo' (IT+MO com a virtual I32 e a eventual MO-EV). Invariantes (a)-(f) em categoria_invariantes.js (as mesmas da
   conferência com dado real); antes x depois contra a main antes da etapa (REF_PRE_CAT, via `git show`), com o mesmo payload. */
const CAT = require('./categoria_invariantes.js');
const REF_PRE_CAT = 'ec60a88';
const FRONT_PRE_CAT = (() => {
  try {
    const arq = f => execSync(`git show ${REF_PRE_CAT}:frontend/${f}`, {cwd: RAIZ, stdio: ['ignore', 'pipe', 'ignore']}).toString();
    const [html, css, js] = ['index.html', 'css/app.css', 'js/app.js'].map(arq);
    return {'/index.html': () => html, '/css/app.css': () => css, '/js/app.js': () => js};
  } catch(e) { return null; }
})();
/* status por gerência (na ordem de GC_ATIVAS), em todas as categorias de volume: [Real, Tendência] em fração da meta, com um
   pouco de diferença entre as rotas; o padrão dá verde (Real 108%), âmbar (Real 60%, tendência 103%) e vermelho (Real 50%,
   tendência 90%) */
const variaCat = (page, fs = [[1.08, 1.2], [0.6, 1.03], [0.5, 0.9]]) => page.evaluate(fs => {
  gcsComDados().forEach((g, i) => rotasDe(g, '').forEach((r, j) => {
    const [fr, ft] = fs[i % fs.length];
    for(const k of GROUPS.VOLUME){ const b = nodo('', r).indicators[k];
      if(!b || b.unavailable || !b.meta) continue;
      b.real = b.meta * fr * (1 + 0.01 * j);
      if(b.tendencia != null) b.tendencia = b.meta * ft * (1 + 0.01 * j); }
  }));
  render(); }, fs);
// fixa [Real, Tendência] (fração da meta) de uma categoria nas rotas dadas
const fixaCat = (page, k, rotas, fr, ft) => page.evaluate(([k, rotas, fr, ft]) => { rotas.forEach(r => { const b = nodo('', r).indicators[k];
  b.real = b.meta * fr; if(ft != null) b.tendencia = b.meta * ft; }); render(); }, [k, rotas, fr, ft]);
const abreCat = (page, k) => page.click(`#exGauges .gCard[data-k="${k}"]`);
const gavetaAberta = page => page.evaluate(() => document.getElementById('drw').classList.contains('on'));
const estadoDica = page => page.evaluate(() => { const d = document.querySelector('.dica');
  return {n: document.querySelectorAll('.dica').length, on: !!d && d.classList.contains('on') && getComputedStyle(d).visibility === 'visible',
    linhas: d ? d.innerText.split('\n').map(x => x.trim()).filter(Boolean) : [], pos: d ? [parseFloat(d.style.left), parseFloat(d.style.top)] : [],
    emFoco: [...document.querySelectorAll('.emFoco')].map(e => e.dataset.u || e.id)}; });
// estilo do "cromo" da gaveta (moldura, cabeçalho, título, subtítulo, ×, corpo): o mesmo em qualquer conteúdo
const CROMO = props => ['#drw', '.drwCab', '#dTit', '#dSub', '#dX', '#dCorpo'].map(s => { const cs = getComputedStyle(document.querySelector(s));
  return [s, Object.fromEntries(props.map(p => [p, cs.getPropertyValue(p)]))]; });

describe('Parte AC — gaveta "Categoria por unidade" na Executiva', {skip: pular}, () => {
  test('Diretoria: tocar em Refrigerantes abre "Refrigerantes por gerência": tabela com o total no topo + uma linha por gerência com meta, do maior para o menor % real; totais = card de Volume; cores pela regra; as 5 categorias', async () => {
    const {page, ctx, erros} = await abre('vol5', {entrar: 'dir', aba: null, largura: 1440});
    await variaCat(page);
    // a RI sem meta de Refrigerantes (Real fica no total): fora da lista dela e das contas por unidade
    await page.evaluate(() => { rotasDe('RI', '').forEach(r => { nodo('', r).indicators['VOL REFRIGERANTES'].meta = 0; }); render(); });
    await abreCat(page, 'VOL REFRIGERANTES');
    const g = await page.evaluate(CAT.LE_GAVETA);
    const gcs = await page.evaluate(() => gcsComDados());
    assert.equal(g.tit, 'Refrigerantes por gerência');
    assert.equal(g.sub, `Real até ontem ÷ Meta · cor pela tendência do SAC · ${gcs.length - 1} gerências · ordenado por % da meta`);
    assert.deepEqual([g.linhas[0].tot, g.linhas[0].cod, g.linhas[0].info, g.linhas[0].u, g.linhas[0].title],
      [true, 'BAND', `${gcs.length} gerências`, 'BAND', `BAND · Diretoria · ${gcs.length} gerências`]);
    const us = g.linhas.slice(1);
    assert.deepEqual(us.map(c => c.u).sort(), gcs.filter(x => x !== 'RI').map(x => 'GC.' + x).sort(), 'uma por gerência com meta (a RI fora)');
    for(let i = 1; i < us.length; i++) assert.ok(us[i - 1].real / us[i - 1].meta >= us[i].real / us[i].meta, `ordem ${us[i - 1].u} ${us[i].u}`);
    // só o código na célula, com "N supervisões"; o nome com a praça no title
    const an = us.find(c => c.u === 'GC.AN');
    assert.deepEqual([an.cod, an.info, an.title], ['GC.AN', '2 supervisões', 'GC.AN · Anápolis · 2 supervisões']);
    // as três cores aparecem: verde (Real >= Meta), âmbar (Real < Meta e tendência >= 100) e vermelho
    const porSt = s => us.filter(c => c.st === s);
    assert.ok(porSt('bat').length && porSt('tend').length && porSt('abx').length, us.map(c => c.st).join());
    for(const c of porSt('bat')) assert.ok(c.real >= c.meta, c.u);
    for(const c of porSt('tend')) assert.ok(c.real < c.meta && c.pctTend >= 100, c.u);
    for(const c of porSt('abx')) assert.ok(c.real < c.meta && c.pctTend < 100, c.u);
    // totais = card de Volume com o mesmo filtro
    await page.keyboard.press('Escape');
    await vaiAba(page, 'VOLUME');
    const card = await page.$eval('#lista .ind[data-k="VOL REFRIGERANTES"]', el => [el.querySelector('.cl').innerText.split('\n').slice(0, 2).join(' '),
      el.querySelector('.big').textContent.replace(/[▲▼]/, ''), el.querySelector('.opo').textContent]);
    assert.deepEqual(card, [`Meta ${g.linhas[0].metaTxt} Real ${g.linhas[0].realTxt}`, `${g.linhas[0].pctTend}%`, `${g.linhas[0].pct}% real`]);
    await vaiAba(page, 'EXEC');
    // invariantes (a)-(f) nas 5 categorias
    const r = await CAT.confereCategoria(page, 'Diretoria');
    assert.deepEqual(Object.keys(r.cats), VOL_AA);
    assert.ok(Object.values(r.cats).every(c => c !== 'sem meta'), JSON.stringify(r.cats));
    assert.equal(r.cats['VOL REFRIGERANTES'].semMeta, 1, 'RI sem meta de Refrigerantes');
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('gerência: supervisões + "Neutraliza" por último (mesmo com o maior %); total com o nome da gerência; virtuais e EV* fora da lista e dentro do total', async () => {
    const {page, ctx, erros} = await abre('vol5', {entrar: {perfil: 'gc', gc: 'G1'}, aba: null, largura: 1440});
    await variaCat(page);
    await fixaCat(page, 'VOL REFRIGERANTES', ['151'], 2, 2.1);         // a Neutraliza com o maior % real
    await abreCat(page, 'VOL REFRIGERANTES');
    let g = await page.evaluate(CAT.LE_GAVETA);
    assert.equal(g.tit, 'Refrigerantes por supervisão');
    assert.equal(g.sub, 'Real até ontem ÷ Meta · cor pela tendência do SAC · 3 supervisões · ordenado por % da meta');
    assert.deepEqual(g.linhas.map(c => [c.u, c.cod, c.info, c.title]).slice(0, 1), [['GC.G1', 'GC.G1', '2 supervisões', 'GC.G1 · Goiânia 01 · 2 supervisões']]);
    assert.deepEqual(g.linhas.slice(1).map(c => c.u).slice(-1), ['Neutraliza']);
    assert.deepEqual(g.linhas.find(c => c.u === 'Neutraliza').info, '1 rota');
    assert.ok(g.linhas.find(c => c.u === 'Neutraliza').pct > Math.max(...g.linhas.slice(1, -1).map(c => c.pct)), 'Neutraliza com o maior %, mas por último');
    assert.equal(g.linhas.find(c => c.u === 'Neutraliza').st, 'bat');
    await page.keyboard.press('Escape');
    const linhas = [await CAT.confereCategoria(page, 'G1')];
    // AN (Diretoria com a gerência no filtro): as virtuais A42-A44 fora da lista e dentro do total; SL: clientes em EV*
    for(const [gc, fora] of [['AN', ['A42', 'A43', 'A44']], ['SL', ['SL-EV']]]){
      await vaiPara(page, 'dir', null);
      await page.selectOption('#fgc', gc);
      await abreCat(page, 'VOL REFRIGERANTES');
      g = await page.evaluate(CAT.LE_GAVETA);
      assert.ok(g.linhas[0].title.startsWith(gc === 'AN' ? 'GC.AN · Anápolis · ' : 'GC.SL · São Luís · '), g.linhas[0].title);
      assert.equal(g.linhas[0].cod, 'GC.' + gc);
      assert.ok(!g.linhas.some(c => fora.some(r => c.u.includes(r))), `${gc}: ${fora} fora da lista`);
      const esp = await page.evaluate(CAT.ESPERADO, 'VOL REFRIGERANTES');
      assert.ok(esp.fora.real > 0 && esp.nFora === fora.length, `${gc}: rotas fora com Real ${JSON.stringify(esp.fora)}`);
      await page.keyboard.press('Escape');
      linhas.push(await CAT.confereCategoria(page, gc));
    }
    assert.ok(linhas.every(l => l.cats['VOL REFRIGERANTES'].n >= 2));
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('grupo IT+MO no Total ("GC.IT + GC.MO", as supervisões das duas + "Neutraliza"), uma gerência do grupo, supervisão -> rotas e "Neutraliza" no filtro -> rotas', async () => {
    let {page, ctx, erros} = await abre('grupo', {entrar: {perfil: 'gc', gc: 'IT+MO'}, aba: null, largura: 1440});
    await abreCat(page, 'VOL REFRIGERANTES');
    let g = await page.evaluate(CAT.LE_GAVETA);
    assert.equal(g.tit, 'Refrigerantes por supervisão');
    assert.deepEqual([g.linhas[0].cod, g.linhas[0].info, g.linhas[0].u], ['GC.IT + GC.MO', '4 supervisões', 'GC.IT+MO']);
    assert.deepEqual(g.linhas.slice(1).map(c => c.u).sort(), ['Neutraliza', 'SV.IT.1', 'SV.IT.2', 'SV.MO.1', 'SV.MO.2']);
    assert.equal(g.linhas[g.linhas.length - 1].u, 'Neutraliza');
    assert.ok(!(await page.textContent('#dCorpo')).match(/I32|MO-EV/), 'virtual e EV* fora da lista');
    await page.keyboard.press('Escape');
    await CAT.confereCategoria(page, 'IT+MO');
    // uma gerência do grupo no seletor
    await page.selectOption('#fgc', 'IT');
    await abreCat(page, 'VOL REFRIGERANTES');
    g = await page.evaluate(CAT.LE_GAVETA);
    assert.deepEqual([g.linhas[0].cod, g.linhas[0].u, g.linhas[0].title.split(' · ').slice(0, 2).join(' · ')], ['GC.IT', 'GC.IT', 'GC.IT · Itumbiara']);
    await page.keyboard.press('Escape');
    await CAT.confereCategoria(page, 'IT');
    assert.deepEqual(erros, []);
    await ctx.close();
    // supervisão -> rotas ("N clientes"); total "SV.G2.1 · nome" com "N rotas"
    ({page, ctx, erros} = await abre('vol5', {entrar: {perfil: 'sv', gc: 'G2', sv: '1'}, aba: null}));
    await abreCat(page, 'VOL AGUA MINERAL');
    g = await page.evaluate(CAT.LE_GAVETA);
    const esp = await page.evaluate(() => ({nome: rotuloSv('SV.G2.1'), base: ['G211', 'G212'].map(r => `${nodo('', r).baseTotal} clientes`)}));
    assert.equal(g.tit, 'Água Mineral por rota');
    assert.deepEqual([g.linhas[0].title, g.linhas[0].info, g.linhas[0].u, g.linhas[0].cod], [`${esp.nome} · 2 rotas`, '2 rotas', 'SV.G2.1', 'SV.G2.1']);
    assert.deepEqual(g.linhas.slice(1).map(c => c.u).sort(), ['Rota G211', 'Rota G212']);
    assert.deepEqual(['Rota G211', 'Rota G212'].map(u => g.linhas.find(c => c.u === u).info), esp.base);
    await page.keyboard.press('Escape');
    await CAT.confereCategoria(page, 'SV.G2.1');
    assert.deepEqual(erros, []);
    await ctx.close();
    // "Neutraliza" no filtro da Gerência: as rotas Neutraliza
    ({page, ctx, erros} = await abre('vol5', {entrar: {perfil: 'gc', gc: 'G1'}, aba: null}));
    await page.selectOption('#fsv', 'Neutraliza');
    await abreCat(page, 'VOL REFRIGERANTES');
    g = await page.evaluate(CAT.LE_GAVETA);
    assert.deepEqual([g.tit, g.linhas[0].title.split(' · ').slice(0, 2).join(' · '), g.linhas[0].cod, g.linhas.slice(1).map(c => c.u)],
      ['Refrigerantes por rota', 'Neutraliza · G1', 'Neutraliza', ['Rota 151']]);
    await page.keyboard.press('Escape');
    await CAT.confereCategoria(page, 'Neutraliza G1');
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('Faltam "N" e "+X"; Real = Meta verde ("+0"); tendência de 99,6% = 100% âmbar (o pctTendencia do card); dica com os números', async () => {
    const {page, ctx, erros} = await abre('vol5', {entrar: {perfil: 'gc', gc: 'G1'}, aba: null, largura: 1440});
    const k = 'VOL REFRIGERANTES';
    const rs = await page.evaluate(() => ({s1: rotasNormais('G1', 'SV.G1.1'), s2: rotasNormais('G1', 'SV.G1.2')}));
    await fixaCat(page, k, rs.s1, 1, 1.2);                 // Real = Meta
    await fixaCat(page, k, rs.s2, 0.5, 0.996);             // tendência 99,6% -> pctTendencia 100
    await fixaCat(page, k, ['151'], 1.234, 1.3);           // Real 123,4% da meta
    await abreCat(page, k);
    const g = await page.evaluate(CAT.LE_GAVETA), c = u => g.linhas.find(x => x.u === u);
    const m1 = c('SV.G1.1'), mn = c('Neutraliza');
    assert.deepEqual([m1.st, m1.faltTxt, m1.faltCls], ['bat', '+0', 'ctFalt ok']);
    assert.deepEqual([mn.st, mn.faltTxt, mn.pctTxt], ['bat', `+${Math.round(mn.real - mn.meta).toLocaleString('pt-BR')}`, '123%']);
    const s2 = c('SV.G1.2');
    assert.deepEqual([s2.st, s2.pctTend, s2.tendTxt, s2.faltTxt, s2.faltCls], ['tend', 100, '100%', Math.round(s2.meta - s2.real).toLocaleString('pt-BR'), 'ctFalt no']);
    // como o card de Volume (verde em 100%), mesmo com o desvio exato da Tendência x Meta abaixo de 0
    assert.ok(s2.tend < s2.meta);
    // caixa de comentário: Meta / Real até ontem (X%) / Online (· meta do dia) / Tendência (Y%)
    const dica = await page.evaluate(() => { const rs = rotasNormais('G1', 'SV.G1.2'), b = agrega(rs).ind['VOL REFRIGERANTES'];
      return ['Refrigerantes · SV.G1.2', `Meta ${fmt0(b.meta)}`, `Real até ontem ${fmt0(b.real)} (${b.pctReal}%)`,
              `Online ${fmt0(onlineVol(rs, 'VOL REFRIGERANTES'))}${b.metaDia == null ? '' : ` · meta do dia ${metaBatida(b.metaDia) ? 'batida' : fmt0(b.metaDia)}`}`,
              `Tendência ${fmt0(b.tendencia)} (${b.pctTendencia}%)`]; });
    const box = await page.locator('#dCorpo .ctLin[data-u="SV.G1.2"]').boundingBox();
    await page.mouse.move(box.x + 40, box.y + box.height / 2);
    assert.deepEqual((await estadoDica(page)).linhas, dica);
    await page.keyboard.press('Escape');
    await CAT.confereCategoria(page, 'G1 limites');
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('categoria sem meta no escopo não abre (medidor "sem meta neste escopo", sem papel de botão); fechar (ESC, ×, toque fora) mantém a categoria em análise e devolve o foco ao medidor', async () => {
    const {page, ctx, erros} = await abre('exec', {entrar: {perfil: 'gc', gc: 'G1'}, aba: null, largura: 1440});
    // 'exec': só Refrigerantes e Água Mineral têm dado
    for(const k of ['VOL CERVEJAS', 'VOL STILL', 'VOL DEST+ART+CND']){
      const m = await page.$eval(`#exGauges .gCard[data-k="${k}"]`, g => [g.className, g.getAttribute('role'), g.getAttribute('tabindex'), g.textContent]);
      assert.deepEqual(m.slice(0, 3), ['gCard off', null, null], k);
      assert.match(m[3], /sem meta neste escopo/);
      await abreCat(page, k);
      assert.equal(await gavetaAberta(page), false, `${k}: não abre`);
      assert.equal(await page.evaluate(() => catAtual()), 'VOL REFRIGERANTES', `${k}: não vira a categoria em análise`);
    }
    // fechar de três jeitos: a categoria em análise fica e o foco volta ao medidor
    for(const como of ['Escape', '#dX', '#back']){
      await abreCat(page, 'VOL REFRIGERANTES');
      assert.equal(await gavetaAberta(page), true, como);
      if(como === 'Escape') await page.keyboard.press('Escape');
      else if(como === '#dX') await page.click('#dX');
      else await page.click('#back', {position: {x: 1430, y: 6}});     // fora da gaveta (o fundo escuro)
      const e = await page.evaluate(() => ({on: document.getElementById('drw').classList.contains('on'), cat: catAtual(),
        sel: [...document.querySelectorAll('#exGauges .gCard.sel')].map(g => g.dataset.k), foco: document.activeElement.dataset.k}));
      assert.deepEqual(e, {on: false, cat: 'VOL REFRIGERANTES', sel: ['VOL REFRIGERANTES'], foco: 'VOL REFRIGERANTES'}, como);
    }
    // teclado: Enter e Espaço no medidor abrem a gaveta da categoria (e a escolhem)
    for(const tecla of ['Enter', ' ']){
      await page.focus('#exGauges .gCard[data-k="VOL AGUA MINERAL"]');
      await page.keyboard.press(tecla);
      assert.deepEqual([await gavetaAberta(page), await page.textContent('#dTit'), await page.evaluate(() => catAtual())],
        [true, 'Água Mineral por supervisão', 'VOL AGUA MINERAL'], `tecla ${JSON.stringify(tecla)}`);
      assert.equal(await page.evaluate(() => document.activeElement.id), 'dX', 'o foco vai para o fechar');
      await page.keyboard.press('Escape');
      assert.equal(await page.evaluate(() => document.activeElement.dataset.k), 'VOL AGUA MINERAL');
      await page.focus('#exGauges .gCard[data-k="VOL REFRIGERANTES"]');
      await page.keyboard.press('Enter');
      await page.keyboard.press('Escape');
    }
    // meta 0 no escopo (a G1 inteira sem meta de Água Mineral): o medidor fica "sem meta" e não abre
    await page.evaluate(() => { rotasDe('G1', '').forEach(r => { nodo('', r).indicators['VOL AGUA MINERAL'].meta = 0; }); render(); });
    assert.match(await page.textContent('#exGauges .gCard[data-k="VOL AGUA MINERAL"]'), /sem meta neste escopo/);
    await abreCat(page, 'VOL AGUA MINERAL');
    assert.equal(await gavetaAberta(page), false, 'meta 0: não abre');
    // os chips do celular só escolhem (não abrem a gaveta)
    await page.setViewportSize({width: 390, height: 844});
    await page.click('#exChips .fchip[data-k="VOL AGUA MINERAL"]');
    assert.deepEqual([await gavetaAberta(page), await page.evaluate(() => catAtual())], [false, 'VOL AGUA MINERAL']);
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('fechamento do mês: verde (Real >= Meta) ou vermelho, sem âmbar e sem a barra de Tendência; subtítulo "Realizado ÷ Meta"; legenda de 2 cores; dica sem Tendência', async () => {
    const {page, ctx, erros} = await abre('vol5fech', {entrar: 'dir', aba: null, largura: 1440});
    await variaCat(page, [[1.04, null], [0.97, null], [0.8, null]]);
    await abreCat(page, 'VOL REFRIGERANTES');
    const g = await page.evaluate(CAT.LE_GAVETA);
    assert.match(g.sub, /^Realizado ÷ Meta · cor pelo realizado · \d+ gerências · ordenado por % da meta$/);
    assert.ok(g.linhas.every(c => c.st !== 'tend' && c.tendTxt == null && c.tend == null), g.linhas.map(c => c.st).join());
    assert.ok(g.linhas.some(c => c.st === 'bat') && g.linhas.some(c => c.st === 'abx'));
    assert.deepEqual(g.leg.map(x => x[1]), ['meta batida (Real ≥ Meta)', 'abaixo da meta']);
    assert.ok(g.linhas.every(c => /Realizado <b>/.test(c.dica) && /Online hoje <b>/.test(c.dica) && !/Tendência/.test(c.dica)));
    // 7 colunas: sem a Tendência e com "Online hoje"; selo só pelo Real (o online de hoje é de outro mês)
    assert.deepEqual(g.cab.map(c => c.t.replace(/[↓↑]/g, '')), ['#', 'Gerência', 'Meta', 'Real', '% Real', 'Online hoje', 'Faltam']);
    assert.ok(g.linhas.every(c => c.bat === (c.real >= c.meta)), 'selo pelo Real no fechamento');
    await page.keyboard.press('Escape');
    await CAT.confereCategoria(page, 'Diretoria (fechamento)');
    await page.selectOption('#fgc', 'G1');
    await CAT.confereCategoria(page, 'G1 (fechamento)');
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test(`rótulo central: "${ROT.NOVOS} por gerência" (sem "${ROT.SUB}" na gaveta nem nas dicas); perfil Rota sem a Executiva`, async () => {
    let {page, ctx, erros} = await abre('vol5', {entrar: 'dir', aba: null});
    await abreCat(page, ROT.K_NOVOS);
    assert.equal(await page.textContent('#dTit'), `${ROT.NOVOS} por gerência`);
    assert.deepEqual(await page.evaluate(ROT.RASTRO_PAGINA, ROT.SUB), []);
    assert.ok((await page.evaluate(CAT.LE_GAVETA)).linhas.every(c => c.dica.startsWith(`<div class="t">${ROT.NOVOS} · `)));
    assert.deepEqual(erros, []);
    await ctx.close();
    ({page, ctx, erros} = await abre('vol5', {entrar: {perfil: 'rota', gc: 'G2', rota: 'G211'}, aba: null}));
    assert.deepEqual(await page.evaluate(() => [document.querySelector('.tab[data-g="EXEC"]').hidden, document.getElementById('exec').hidden, aba]),
      [true, true, 'VOLUME']);
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('caixa de comentário: mouse (acompanha o cursor), teclado (Tab a partir do ×, pelos títulos, ESC) e toque (abre/fecha, toque fora e rolar a lista fecham); um div.dica; emFoco', async () => {
    let {page, ctx, erros} = await abre('vol5', {entrar: 'dir', aba: null, largura: 1440});
    await variaCat(page);
    await abreCat(page, 'VOL REFRIGERANTES');
    await page.waitForTimeout(300);           // a gaveta termina de abrir (a linha não se mexe mais)
    const box = await page.locator('#dCorpo .ctLin[data-u="GC.G2"]').boundingBox();
    await page.mouse.move(box.x + 30, box.y + box.height / 2);
    let e = await estadoDica(page);
    assert.ok(e.on && e.n === 1, 'hover: dica aberta');
    assert.deepEqual(e.emFoco, ['GC.G2']);
    assert.match(e.linhas[0], /^Refrigerantes · GC\.G2$/);
    assert.deepEqual(e.linhas.slice(1).map(l => l.split(' ')[0]), ['Meta', 'Real', 'Online', 'Tendência']);
    const p1 = e.pos;
    await page.mouse.move(box.x + 220, box.y + box.height / 2);
    assert.ok((await estadoDica(page)).pos[0] > p1[0], 'acompanha o cursor');
    await page.mouse.move(5, 5);
    assert.equal((await estadoDica(page)).on, false, 'sai: fecha');
    // teclado: o foco começa no ×; Tab passa pelos 4 títulos que ordenam e vai à linha de total e à seguinte
    await page.keyboard.press('Escape');
    await page.focus('#exGauges .gCard[data-k="VOL REFRIGERANTES"]');
    await page.keyboard.press('Enter');
    for(const col of ['pct', 'onl', 'falt', 'tend']){
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.activeElement.dataset.col), col, `Tab: título ${col}`);
    }
    await page.keyboard.press('Tab');
    e = await estadoDica(page);
    assert.ok(e.on, 'foco: dica aberta');
    assert.deepEqual(e.emFoco, ['BAND']);
    assert.match(e.linhas[0], /^Refrigerantes · BAND$/);
    await page.keyboard.press('Tab');
    const seg = await page.evaluate(() => document.activeElement.dataset.u);
    assert.deepEqual((await estadoDica(page)).emFoco, [seg]);
    await page.keyboard.press('Shift+Tab');
    assert.deepEqual((await estadoDica(page)).emFoco, ['BAND']);
    await page.keyboard.press('Escape');
    assert.deepEqual([(await estadoDica(page)).on, await gavetaAberta(page)], [false, false], 'ESC fecha a dica e a gaveta');
    assert.deepEqual(erros, []);
    await ctx.close();
    // toque (celular)
    // (altura menor: a tabela é mais baixa que os cartões de antes e a lista precisa rolar)
    ({page, ctx, erros} = await abre('vol5', {entrar: 'dir', aba: null, largura: 390, altura: 520, toque: true}));
    await page.tap('#exGauges .gCard[data-k="VOL REFRIGERANTES"]');
    assert.equal(await gavetaAberta(page), true);
    await page.tap('#dCorpo .ctLin[data-u="BAND"]');
    assert.ok((await estadoDica(page)).on, 'toque abre');
    await page.tap('#dCorpo .ctLin[data-u="BAND"]');
    assert.equal((await estadoDica(page)).on, false, '2º toque fecha');
    await page.tap('#dCorpo .ctLin[data-u="BAND"]');
    await page.tap('.drwCab h2');
    assert.equal((await estadoDica(page)).on, false, 'toque fora fecha');
    const segundo = await page.$eval('#dCorpo .ctLin:nth-child(2)', el => el.dataset.u);
    await page.tap(`#dCorpo .ctLin[data-u="${segundo}"]`);
    assert.ok((await estadoDica(page)).on);
    await page.evaluate(() => { const c = document.getElementById('dCorpo'); c.scrollTop += 120; });
    await page.waitForTimeout(80);
    assert.equal((await estadoDica(page)).on, false, 'rolar a lista fecha');
    assert.equal(await gavetaAberta(page), true, 'a gaveta continua aberta');
    assert.equal(await page.evaluate(() => document.querySelectorAll('.dica').length), 1);
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  for(const largura of [360, 390, 800, 1000, 1440])
  test(`${largura} px, fundos preto e branco: tabela (8 colunas; abaixo de 700 px sem #, Meta e Real), faixa de 4 px, total no topo (fundo --ct-tot, 11 px, negrito), zebra e hover, fontes, selo só "✓" no celular, sem rolagem lateral nem texto cortado; cromo da gaveta = o da cascata`, async () => {
    for(const tema of ['preta', 'branca']){
      const {page, ctx, erros} = await abre('vol5', {entrar: 'dir', aba: null, largura, altura: 900, armazenado: {drotas_entrada: tema}});
      await page.addStyleTag({content: '*{transition:none!important}'});
      await variaCat(page);
      const cores = await page.evaluate(CAT.CORES);
      for(const [e, k] of [['dir', 'VOL REFRIGERANTES'], [{perfil: 'gc', gc: 'IT+MO'}, 'VOL CERVEJAS'], [{perfil: 'sv', gc: 'G2', sv: '1'}, ROT.K_NOVOS]]){
        if(e !== 'dir') await vaiPara(page, e, null);
        const onde = `${largura} ${tema} ${JSON.stringify(e)} ${k}`;
        await abreCat(page, k);
        await page.waitForTimeout(250);
        assert.deepEqual(await page.evaluate(CAT.CORTES_CAT), [], `${onde}: texto cortado`);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${onde}: rolagem lateral`);
        await page.mouse.move(2, 2);
        const g = await page.evaluate(CAT.LE_GAVETA);
        const cel = largura < 700;
        assert.deepEqual(g.cab.filter(c => c.vis).map(c => c.cls), cel ? ['ctU', 'ctPct', 'ctOnl', 'ctFalt', 'ctTend'] : ['ctN', 'ctU', 'ctMeta', 'ctReal', 'ctPct', 'ctOnl', 'ctFalt', 'ctTend'], `${onde}: colunas à vista`);
        assert.ok(g.linhas.every(l => l.nCel === (cel ? 5 : 8)), `${onde}: células à vista`);
        assert.ok(g.linhas.every(l => l.faixa[1] === 4 && l.faixa[0] === cores[l.st]), `${onde}: faixa de 4 px na cor do status`);
        const m = await page.evaluate(() => {
          const cs = s => getComputedStyle(typeof s === 'string' ? document.querySelector(s) : s);
          const ls = [...document.querySelectorAll('#dCorpo .ctLin')], t = ls[0], u = ls.find(l => !l.classList.contains('ctTot'));
          const zeb = ls.slice(1).filter(l => !l.classList.contains('ctBat')).map(l => [[...l.parentNode.children].indexOf(l) % 2 === 1, cs(l.children[1]).backgroundColor]);
          const seloT = document.querySelector('#dCorpo .ctSeloT');
          return {tab: [cs('.ctTab').fontSize, cs('.ctTab').fontFamily, cs('.ctTab').fontVariantNumeric], cab: [cs('.ctTab thead th').fontSize, cs('.ctTab thead th').fontWeight],
            tot: [cs(t.children[1]).backgroundColor, cs(t.querySelector('.ctCod')).fontSize, cs(t.children[1]).fontWeight, cs(t.querySelector('.ctPct')).fontSize],
            un: [cs(u.querySelector('.ctCod')).fontSize, cs(u.querySelector('.ctCod')).fontWeight, cs(u.querySelector('.ctMeta')).fontSize],
            zeb, selo: seloT ? [document.querySelector('#dCorpo .ctSelo').innerText.trim(), cs(seloT).display] : null,
            fam: [...new Set([...document.querySelectorAll('#dCorpo .cuGav, #dCorpo .cuGav *')].map(x => cs(x).fontFamily))]};
        });
        assert.deepEqual(m.tab.slice(0, 1).concat(m.tab.slice(2)), ['12px', 'lining-nums tabular-nums'], onde);
        assert.ok(m.fam.length === 1 && /^Inter,/.test(m.fam[0]), `${onde}: ${m.fam}`);
        assert.deepEqual(m.cab, ['10px', '700'], `${onde}: cabeçalho`);
        assert.deepEqual(m.tot, ['rgb(227, 227, 232)', '11px', '700', '11px'], `${onde}: linha de total`);
        assert.deepEqual(m.un, ['12px', '700', '12px'], `${onde}: linha de unidade`);
        // zebra leve: 2ª, 4ª... linha do corpo (o total é a 1ª; sem selo) em --ct-zebra, as outras brancas
        for(const [zebra, bg] of m.zeb) assert.equal(bg, zebra ? 'rgb(247, 247, 249)' : 'rgb(255, 255, 255)', `${onde}: zebra`);
        if(m.selo) assert.deepEqual(m.selo, cel ? ['✓', 'none'] : ['✓ META BATIDA', 'inline'], `${onde}: selo`);
        // hover: um tom acima
        if(largura >= 1000){
          const box = await page.locator('#dCorpo .ctLin:not(.ctTot):not(.ctBat)').first().boundingBox();
          if(box){
            await page.mouse.move(box.x + 20, box.y + box.height / 2);
            assert.equal(await page.$eval('#dCorpo .ctLin:not(.ctTot):not(.ctBat)', l => getComputedStyle(l.children[1]).backgroundColor), 'rgb(236, 236, 239)', `${onde}: hover`);
            await page.mouse.move(2, 2);
          }
        }
        // o cromo da gaveta (moldura, cabeçalho, ×, corpo) é o mesmo da cascata. Desde a Etapa 3 do pacote v3 a cascata das
        // abas de volume e coberturas tem, no PC, a gaveta mais larga e com menos padding (#drw[data-casc]); as gavetas Base, Sem
        // compra e a cascata da Venda Zero ficaram com o cromo de sempre: a comparação é com a da Base (aba Volume)
        const cromo = await page.evaluate(CROMO, PROPS_CASCATA);
        await page.keyboard.press('Escape');
        await vaiAba(page, 'VOLUME');
        await abreCardTopo(page, 'cBase');
        await page.waitForTimeout(250);
        assert.equal(await page.$('#drw[data-casc]'), null, 'Base sem a gaveta larga');
        assert.deepEqual(await page.evaluate(CROMO, PROPS_CASCATA), cromo, `${onde}: cromo da gaveta`);
        await page.keyboard.press('Escape');
        await vaiAba(page, 'EXEC');
      }
      assert.deepEqual(erros, [], `${largura} ${tema}`);
      await ctx.close();
    }
  });

  test('antes x depois (main antes da etapa, mesmo payload): Executiva, cabeçalho e cards das 4 abas, cascata, gavetas Base e Sem compra e Resumo iguais', {skip: !FRONT_PRE_CAT && `sem o commit ${REF_PRE_CAT}`}, async () => {
    for(const dados of ['vol5', 'vol5fech']){
      const [novo, velho] = [await abre(dados, {entrar: 'dir', aba: null}), await abre(dados, {entrar: 'dir', aba: null, troca: FRONT_PRE_CAT})];
      for(const c of PERFIS_AA){
        for(const {page} of [novo, velho]) await vaiPara(page, c.entrar, null);
        const onde = `${dados} ${c.nome}`;
        if(c.perfil !== 'rota'){
          for(const {page} of [novo, velho]) await vaiAba(page, 'EXEC');
          // a linha "faltam" do medidor e os data-meta/data-real dele (Parte AE) fora da comparação
          assert.equal(...igualSemFalta(await novo.page.innerHTML('#exec'), await velho.page.innerHTML('#exec')), `${onde}: Executiva`);
          for(const id of ['exBase', 'exSem', 'exVis']){
            const gav = async p => { await p.evaluate(id => document.getElementById(id).click(), id); const h = await p.innerHTML('#drw'); await p.keyboard.press('Escape'); return h; };
            assert.equal(await gav(novo.page), await gav(velho.page), `${onde}: gaveta do KPI ${id}`);
          }
        }
        for(const ab of ['VOLUME', 'ICS_GC', 'NOVOS_NEG', 'INCENTIVO']){
          for(const {page} of [novo, velho]) await vaiAba(page, ab);
          // (sem o botão "Clientes" da Etapa 4 do pacote v3, que o front de lá não tem)
          const tela = p => p.evaluate(() => ({topo: document.getElementById('abaTopo').innerHTML
            .replace(/\s*<button class="abCli"[^>]*>[\s\S]*?<\/button>/, ''), lista: document.getElementById('lista').innerHTML}));
          assert.deepEqual(...igualSemFalta(await tela(novo.page), await tela(velho.page)), `${onde} ${ab}: cabeçalho e cards`);
          const ks = (await novo.page.$$eval('#lista .ind[data-k]', els => els.map(x => x.dataset.k))).slice(0, 2);
          for(const k of ks){
            for(const {page} of [novo, velho]) await page.click(`#lista .ind[data-k="${k}"]`);
            for(let nivel = 0; nivel < 5; nivel++){
              assert.equal(require('./cascata_invariantes.js').desfazCasc(await novo.page.innerHTML('#drw')), await velho.page.innerHTML('#drw'), `${onde} ${ab} ${k}: cascata nível ${nivel}`);
              if(c.perfil === 'dir' || !(await novo.page.$('#dCorpo .cLin[data-i]'))) break;  // Diretoria: GC > Clientes (Etapa 3 do pacote v3)
              for(const {page} of [novo, velho]) await page.click('#dCorpo .cLin[data-i]');
            }
            for(const {page} of [novo, velho]) await page.keyboard.press('Escape');
          }
          for(const id of ['cBase', 'cSem']){
            const gav = async p => { await abreCardTopo(p, id); const h = await p.innerHTML('#drw'); await p.keyboard.press('Escape'); return h; };
            assert.equal(await gav(novo.page), await gav(velho.page), `${onde} ${ab}: gaveta ${id}`);
          }
        }
        if(c.perfil !== 'rota'){
          for(const {page} of [novo, velho]) await page.click('#btnResumo');
          assert.equal(await novo.page.innerHTML('#rsFolha'), await velho.page.innerHTML('#rsFolha'), `${onde}: Resumo`);
          for(const {page} of [novo, velho]) await page.click('#rsVoltar');
        }
      }
      assert.deepEqual([...novo.erros, ...velho.erros], [], dados);
      for(const {ctx} of [novo, velho]) await ctx.close();
    }
  });
});

/* ---------- Parte AD: gerências liberadas na entrada (CONFIG.GC_LIBERADAS, 27/10/2026) ----------
   Gerência, Supervisão e Rota só abrem nas gerências da lista (grupo: com as duas); as demais ficam na caixa desabilitadas
   ("· em breve") e um acesso guardado delas volta para a entrada. A Diretoria vê todas. Os outros testes servem o
   config.js com todas liberadas (trocaLiberadas); aqui, a lista do config.js ('config') ou uma lista do teste. */
const LIBERADAS = ['G1', 'G2', 'G3', 'AP', 'IT', 'MO'];
const ABREM = ['AP', 'G1', 'G2', 'G3', 'IT+MO'];
describe('Parte AD — gerências liberadas na entrada', {skip: pular}, () => {
  test('config.js: só G1, G2, G3, AP e IT+MO abrem por Gerência, Supervisão e Rota; as demais "em breve"; a Diretoria vê todas', async () => {
    const {page, ctx, erros} = await abre('normal', {entrar: null, antes: fixo(), liberadas: 'config'});
    assert.deepEqual(await page.evaluate(() => CONFIG.GC_LIBERADAS), LIBERADAS);
    for(const perfil of ['gc', 'sv', 'rota']){
      await page.click(`#entrada [data-perfil="${perfil}"]`);
      const c = await caixa(page);
      assert.deepEqual(c.gcs, OPCOES_GC.map(([g, r]) => ABREM.includes(g) ? [g, r, false] : [g, r + ' · em breve', true]), perfil);
      assert.equal(c.foco, 'AP', `${perfil}: foco na primeira opção liberada`);
      // travada não abre (nem a 2ª etapa)
      for(const g of ['AN', 'PA+DI', 'UR+RI']) await page.$eval(`#entOpcoes [data-gc="${g}"]`, b => b.click());
      const d = await caixa(page);
      assert.deepEqual([d.vis, d.sub, (await estado(page)).acesso], [true, 'Escolha a gerência', null], perfil);
      await page.click('#entFechar');
    }
    for(const [entrar, sel] of [[{perfil: 'gc', gc: 'G3'}, ['gc', 'G3', '', '']], [{perfil: 'gc', gc: 'IT+MO'}, ['gc', 'IT+MO', '', '']],
      [{perfil: 'sv', gc: 'AP', sv: '1'}, ['gc', 'AP', 'SV.AP.1', '']], [{perfil: 'sv', gc: 'IT+MO', sv: 'SV.MO.1'}, ['gc', 'MO', 'SV.MO.1', '']],
      [{perfil: 'rota', gc: 'G1', rota: 'G111'}, ['gc', 'G1', 'SV.G1.1', 'G111']]]){
      if(!(await estado(page)).entrada) await page.click('#btnCasa');
      await entra(page, entrar, null);
      const e = await estado(page);
      assert.deepEqual([e.entrada, e.sel], [false, sel], JSON.stringify(entrar));
    }
    // Diretoria: as 16 no filtro (só a DI, sem dados, desabilitada) e qualquer uma abre
    await vaiPara(page, 'dir', null);
    assert.deepEqual((await opcoesGc(page)).filter(o => o[2]).map(o => o[0]), ['DI']);
    await page.selectOption('#fgc', 'AN');
    assert.deepEqual((await estado(page)).sel, ['dir', 'AN', '', '']);
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('acesso guardado: o de gerência travada volta para a entrada; o das liberadas e o da Diretoria reabrem', async () => {
    const TRAVADOS = [{perfil: 'gc', gc: 'AN'}, {perfil: 'gc', gc: 'PA+DI'}, {perfil: 'sv', gc: 'SL', sv: 'SV.SL.1'},
                      {perfil: 'sv', gc: 'RI', sv: 'SV.RI.1'}, {perfil: 'rota', gc: 'PO', rota: 'PO11'}];
    for(const a of TRAVADOS){
      for(const liberadas of [null, 'config']){      // com todas liberadas o acesso vale: quem trava é a lista
        const {page, ctx, erros} = await abre('normal', {entrar: null, antes: fixo(), liberadas,
                                                         armazenado: {drotas_sessao: sessao(a)}});
        const e = await estado(page);
        if(liberadas) assert.deepEqual([e.entrada, e.msg, e.guardado, e.acesso], [true, INDISPONIVEL, null, null], JSON.stringify(a));
        else assert.equal(e.entrada, false, JSON.stringify(a));
        assert.deepEqual(erros, []);
        await ctx.close();
      }
    }
    for(const [a, sel] of [[{perfil: 'gc', gc: 'G2'}, ['gc', 'G2', '', '']], [{perfil: 'gc', gc: 'IT+MO'}, ['gc', 'IT+MO', '', '']],
      [{perfil: 'sv', gc: 'MO', sv: 'SV.MO.1'}, ['gc', 'MO', 'SV.MO.1', '']], [{perfil: 'rota', gc: 'AP', rota: 'AP11'}, ['gc', 'AP', 'SV.AP.1', 'AP11']],
      [{perfil: 'dir'}, ['dir', '', '', '']]]){
      const {page, ctx, erros} = await abre('normal', {entrar: null, antes: fixo(), liberadas: 'config',
                                                       armazenado: {drotas_sessao: sessao(a)}});
      const e = await estado(page);
      assert.deepEqual([e.entrada, e.sel], [false, sel], JSON.stringify(a));
      assert.deepEqual(erros, []);
      await ctx.close();
    }
  });

  test('grupo só com as duas liberadas; travada sem dados = "em breve", liberada sem dados = "sem dados"', async () => {
    {
      const {page, ctx, erros} = await abre('normal', {entrar: null, antes: fixo(), liberadas: ['G1', 'IT'],
                                                       armazenado: {drotas_sessao: sessao({perfil: 'sv', gc: 'IT', sv: 'SV.IT.1'})}});
      let e = await estado(page);
      assert.deepEqual([e.entrada, e.msg, e.guardado], [true, INDISPONIVEL, null], 'supervisão da IT com a MO travada');
      await page.click('#entrada [data-perfil="sv"]');
      const c = await caixa(page);
      assert.deepEqual(c.gcs.filter(o => !o[2]).map(o => o[0]), ['G1']);
      assert.deepEqual(c.gcs.find(o => o[0] === 'IT+MO'), ['IT+MO', GRUPO_IT_MO + ' · em breve', true]);
      assert.deepEqual(erros, []);
      await ctx.close();
    }
    const {page, ctx, erros} = await abre('semdados', {entrar: null, antes: fixo(), liberadas: 'config'});
    await page.click('#entrada [data-perfil="gc"]');
    const c = await caixa(page);
    assert.deepEqual(c.gcs.find(o => o[0] === 'G3'), ['G3', ROTULO('G3') + ' · sem dados', true]);
    assert.deepEqual(c.gcs.find(o => o[0] === 'PA+DI'), ['PA+DI', 'GC.PA + GC.DI · Palmas + Dianópolis · em breve', true]);
    assert.deepEqual(c.gcs.filter(o => !o[2]).map(o => o[0]), ['AP', 'G1', 'G2', 'IT+MO']);
    assert.deepEqual(erros, []);
    await ctx.close();
  });
});

/* ---------- Parte AE: ajustes visuais da Executiva e nome na Diretoria (Etapa 1 do pacote v3) ---------- */
describe('Parte AE — zebra das coberturas, Evolução hachurada, rótulo da busca, nome na Diretoria e "faltam" no medidor', {skip: pular}, () => {
  const fundo = (page, s) => page.$eval(s, el => getComputedStyle(el).backgroundColor);
  const espera = page => page.waitForTimeout(250);      // transição de .12s do fundo das linhas

  test('coberturas por unidade: linhas alternadas (inclusive a coluna fixa), total mais escuro e em negrito, hover um tom acima', async () => {
    const {page, ctx, erros} = await abre('evo', {entrar: 'dir', aba: null, largura: 1440});
    const n = await page.$$eval('#exCob tbody tr', trs => trs.length);
    assert.ok(n >= 4, `${n} linhas`);
    const tr = i => `#exCob tbody tr:nth-child(${i})`;
    assert.ok(await page.$eval(tr(1), el => el.classList.contains('tot')), 'total na 1ª linha');
    await page.mouse.move(0, 0);
    for(const [s, peso] of [[`${tr(1)} th.un`, '700'], [`${tr(1)} td`, '800']]){
      assert.equal(await fundo(page, s), 'rgb(228, 228, 232)', `total ${s}`);
      assert.equal(await page.$eval(s, el => getComputedStyle(el).fontWeight), peso, `negrito ${s}`);
    }
    for(let i = 2; i <= n; i++){
      const par = i % 2 === 0;
      assert.equal(await fundo(page, `${tr(i)} td`), par ? 'rgb(246, 246, 248)' : 'rgba(0, 0, 0, 0)', `linha ${i} td`);
      assert.equal(await fundo(page, `${tr(i)} th.un`), par ? 'rgb(246, 246, 248)' : 'rgb(255, 255, 255)', `linha ${i} nome`);
    }
    for(const [i, cor] of [[2, 'rgb(236, 236, 239)'], [3, 'rgb(236, 236, 239)'], [1, 'rgb(217, 217, 222)']]){
      await page.hover(`${tr(i)} td`);
      await espera(page);
      assert.equal(await fundo(page, `${tr(i)} td`), cor, `hover linha ${i}`);
      assert.equal(await fundo(page, `${tr(i)} th.un`), cor, `hover linha ${i} (nome)`);
    }
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('Evolução: barra do mês atual hachurada em --ruim (mais densa nas unidades), legenda igual; larguras e números como antes', async () => {
    const {page, ctx, erros} = await abre('evo', {entrar: 'dir', aba: null, largura: 1440});
    await page.click('#exEvLinhas .evLin.cat');
    const r = await page.evaluate(() => {
      const st = s => { const el = document.querySelector(s), c = getComputedStyle(el);
        return {img: c.backgroundImage, cor: c.backgroundColor, w: el.style.width}; };
      return {cat: st('.evLin.cat .evTr .atu'), catAnt: st('.evLin.cat .evTr .ant'), un: st('.evDet:not([hidden]) .evLin.un .evTr .atu'),
              unAnt: st('.evDet:not([hidden]) .evLin.un .evTr .ant'), leg: st('#exEvLeg .lg.evAtu'),
              legTxt: [...document.querySelectorAll('#exEvLeg span')].map(s => s.textContent)};
    });
    for(const [k, v] of Object.entries({cat: r.cat, un: r.un, leg: r.leg})){
      assert.match(v.img, /repeating-linear-gradient\(135deg, rgb\(156, 28, 28\) 0px, rgb\(156, 28, 28\) 1\.5px, rgba\(0, 0, 0, 0\) 1\.5px/, k);
      assert.equal(v.cor, 'rgba(0, 0, 0, 0)', `${k}: sem fundo sólido`);
    }
    assert.match(r.cat.img, /4px\)$/, 'categoria: passo de 4 px');
    assert.match(r.un.img, /3px\)$/, 'unidade: passo de 3 px (mais densa)');
    assert.match(r.catAnt.img, /4px\)$/);
    assert.match(r.unAnt.img, /3px\)$/);
    assert.match(r.cat.w, /^\d+(\.\d+)?%$/);
    assert.equal(r.legTxt.length, 5);
    assert.match(r.legTxt[2], /^100% da meta$/);
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('card de busca das quatro abas: rótulo "Busca por cliente" (caixa alta, cor de apoio) e o novo placeholder; a busca funciona', async () => {
    const {page, ctx, erros} = await abre('inc', {entrar: 'gc', aba: null, largura: 1440});
    for(const aba of ['VOLUME', 'ICS_GC', 'NOVOS_NEG', 'INCENTIVO']){
      await vaiAba(page, aba);
      const r = await page.evaluate(() => {
        const l = document.querySelector('.busca .buscaRot'), c = getComputedStyle(l);
        return {txt: l.textContent, para: l.htmlFor, vis: l.getClientRects().length > 0, tt: c.textTransform, cor: c.color,
                ph: document.getElementById('q').placeholder};
      });
      assert.deepEqual(r, {txt: 'Busca por cliente', para: 'q', vis: true, tt: 'uppercase', cor: 'rgb(94, 94, 101)',
                           ph: 'Digite nome, código ou rede'}, aba);
    }
    const cod = await page.evaluate(() => { for(const r of rotasDe(sel.gc, '')){ const c = CLIENT_ROSTER[r];
      if(c && c.length) return String(c[0][0]); } return ''; });
    assert.ok(cod, 'um cliente da base');
    await page.fill('#q', cod);
    await page.waitForFunction(() => document.getElementById('cli').innerHTML !== '');
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('Diretoria: o nome da senha no cabeçalho (PC e celular); recarregar mantém; casa limpa; sem nome no mapa, só "Diretoria"', async () => {
    const subTxt = page => page.evaluate(() => document.getElementById('sub').innerText.replace(/\s+/g, ' ').trim());
    const guardado = page => page.evaluate(() => localStorage.getItem('drotas_sessao'));
    for(const [i, largura] of [[0, 1440], [1, 390]]){
      const {page, ctx, erros} = await abre('normal', {entrar: null, nomes: NOMES_TESTE, largura, altura: 844});
      await page.click('#entrada [data-perfil="dir"]');
      await digitaSenha(page, SENHAS_TESTE[i]);
      const nome = NOMES_TESTE[HASHES_TESTE[i]];
      assert.match(await subTxt(page), new RegExp(`Diretoria · ${nome}$`), `${largura}: #sub`);
      const s = await guardado(page);
      assert.equal(JSON.parse(s).quem, nome);
      for(const proibido of [SENHAS_TESTE[0], SENHAS_TESTE[1], HASHES_TESTE[0], HASHES_TESTE[1]])
        assert.ok(!s.toUpperCase().includes(proibido.toUpperCase()), 'acesso guardado sem senha nem hash');
      if(largura === 390){
        // Parte M: o cabeçalho continua até 221 px; com uma gerência no seletor, só "Diretoria · nome" (sem a gerência)
        assert.ok(await page.evaluate(() => document.querySelector('.barra').getBoundingClientRect().bottom) <= LIMITE_CABECALHO_390);
        await page.evaluate(() => { sel = {...sel, dgc: P.GC_ATIVAS[0]}; render(); });
        assert.match(await subTxt(page), new RegExp(`Diretoria · ${nome}$`), '390: sem a gerência do seletor');
        assert.ok(await page.evaluate(() => document.querySelector('.barra').getBoundingClientRect().bottom) <= LIMITE_CABECALHO_390);
      } else {
        await page.evaluate(() => { sel = {...sel, dgc: P.GC_ATIVAS[0]}; render(); });
        assert.match(await subTxt(page), new RegExp(`Diretoria · ${nome} · GC\\.`), '1440: com a gerência do seletor');
      }
      await page.reload();
      await esperaCarga(page);
      assert.equal(await page.isVisible('#entrada'), false);
      assert.match(await subTxt(page), new RegExp(`Diretoria · ${nome}`), 'recarregar mantém o nome');
      await page.click('#btnCasa');
      assert.equal(await guardado(page), null, 'casa apaga o acesso');
      assert.ok(!(await page.evaluate(() => document.getElementById('sub').textContent)).includes(nome) ||
                await page.isVisible('#entrada'));
      assert.deepEqual(erros, []);
      await ctx.close();
    }
    // hash sem nome no mapa: só "Diretoria" (PC e celular, como antes: no celular o escopo some)
    for(const largura of [1440, 390]){
      const {page, ctx, erros} = await abre('normal', {entrar: null, nomes: {[HASHES_TESTE[0]]: NOMES_TESTE[HASHES_TESTE[0]]}, largura});
      await page.click('#entrada [data-perfil="dir"]');
      await digitaSenha(page, SENHAS_TESTE[1]);
      const t = await subTxt(page);
      if(largura === 1440) assert.match(t, /Diretoria$/);
      else assert.ok(!/Diretoria/.test(t), t);
      assert.equal(JSON.parse(await guardado(page)).quem, undefined);
      assert.deepEqual(erros, []);
      await ctx.close();
    }
    // nome guardado que não é do mapa (alterado à mão): não aparece
    const {page, ctx, erros} = await abre('normal', {entrar: null, nomes: NOMES_TESTE, antes: fixo(), largura: 1440,
      armazenado: {drotas_sessao: sessao({perfil: 'dir', quem: '<b>Outro</b>'})}});
    assert.equal(await page.isVisible('#entrada'), false);
    assert.match(await subTxt(page), /Diretoria$/);
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('medidor: "faltam X para a meta" = Meta - Real; "meta batida · +X" com Real >= Meta; sem meta, sem a linha; fechamento', async () => {
    const f0 = v => Math.round(v).toLocaleString('pt-BR');
    const le = page => page.$$eval('#exGauges .gCard', gs => gs.map(g => { const f = g.querySelector('.gFalta');
      return {k: g.dataset.k, off: g.classList.contains('off'), meta: Number(g.dataset.meta), real: Number(g.dataset.real),
        txt: f && f.textContent, ok: !!(f && f.classList.contains('ok')), cor: f && getComputedStyle(f).color,
        peso: f && getComputedStyle(f).fontWeight, fs: f && getComputedStyle(f).fontSize,
        ordem: f ? [...g.children].map(c => c.className.baseVal != null ? 'svg' : c.className) : []}; }));
    for(const nome of ['evo', 'evofech']){
      const {page, ctx, erros} = await abre(nome, {entrar: {perfil: 'gc', gc: 'G1'}, aba: null, largura: 1440});
      let gs = await le(page);
      assert.ok(gs.some(g => g.off) && gs.some(g => !g.off), `${nome}: medidores com e sem meta`);
      for(const g of gs){
        if(g.off){ assert.equal(g.txt, null, `${nome} ${g.k}: sem meta, sem linha`); continue; }
        assert.ok(g.real < g.meta, `${nome} ${g.k}: o sintético fica abaixo da meta`);
        assert.equal(g.txt, `faltam ${f0(g.meta - g.real)} para a meta`);
        assert.deepEqual([g.ok, g.cor, g.peso, g.fs], [false, 'rgb(198, 40, 40)', '700', '10.5px']);
        assert.deepEqual(g.ordem.slice(0, 5), ['gTit', 'svg', 'gPct', 'gFalta', 'gMR'], 'entre o % e Meta | Real');
      }
      await ritmo(page, 'G1', await page.evaluate(() => rotasDe('G1', '')), 1.25);
      await page.evaluate(() => render());
      gs = await le(page);
      for(const g of gs.filter(x => !x.off)){
        assert.equal(g.txt, `meta batida · +${f0(g.real - g.meta)}`, `${nome} ${g.k}`);
        assert.deepEqual([g.ok, g.cor], [true, 'rgb(20, 107, 79)']);
      }
      assert.deepEqual(erros, []);
      await ctx.close();
    }
  });

  test('360, 390, 1000 e 1440 px: Executiva e abas sem rolagem lateral nem erro, com o nome da Diretoria', async () => {
    for(const largura of [360, 390, 1000, 1440]){
      const {page, ctx, erros} = await abre('evo', {entrar: null, nomes: NOMES_TESTE, largura, altura: 900});
      await page.click('#entrada [data-perfil="dir"]');
      await digitaSenha(page, SENHAS_TESTE[0]);
      for(const aba of ['EXEC', 'VOLUME', 'ICS_GC']){
        await vaiAba(page, aba);
        const r = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
        assert.ok(r[0] <= r[1], `${largura} ${aba}: rolagem lateral ${r}`);
      }
      assert.deepEqual(erros, []);
      await ctx.close();
    }
  });
});

/* ---------- Parte AF — Resumo de vendas: bloco "Todos a Bordo 3.0" (opcional, desmarcado) ---------- */
/* Botão "Todos a Bordo" (data-rsb="tab") nos dois grupos .rsChips, depois de "Novos Neg.", só com a aba Todos a Bordo
   (incentivoAtivo()). Bloco: uma linha por item de GROUPS.INCENTIVO (ordem e rótulo da aba), as colunas do bloco ICS GC e a
   célula do ICS (celInd: Faltam / Meta dia, Online, % do mês = (Real ∪ Online, clientes distintos) / Meta), cada célula só
   com as rotas da coluna com meta do item (rotasInc, as mesmas do card); sem nenhuma: "—". Cenário 'inc' (montaIncentivo):
   Heineken e Heineken - 600ml só nas FULL e na G211; Eisenbahn - 600ml sem meta na G3; IT11 com Heineken Real [a] e online
   [a, b] (o % do Resumo conta b; o do card, não). */
const {confereResumoTab} = require('./resumo_tab_invariantes.js');
// tabela do bloco (todas as faixas): códigos das colunas e, por linha, nome + células (texto, Online e %)
const blocoTab = page => page.evaluate(LE_BLOCO_TAB);
const LE_BLOCO_TAB = require('./resumo_tab_invariantes.js').LE_BLOCO;
const chipsRs = page => page.$$eval('.rsChips', gs => gs.map(g => [...g.querySelectorAll('button')]
  .map(b => [b.dataset.rsb, b.textContent, b.hidden || getComputedStyle(b).display === 'none', b.getAttribute('aria-pressed')])));

describe('Parte AF — Resumo: bloco Todos a Bordo 3.0', {skip: pular}, () => {
  test('botão nos dois grupos depois de "Novos Neg.", desmarcado; ausente sem a aba (payload sem INCENTIVO ou INCENTIVO_ATIVO = false)', async () => {
    let {page, ctx, erros} = await abre('inc', {entrar: 'dir'});
    const esperado = [['vol', 'Volume', false, 'true'], ['ics', 'ICS GC', false, 'true'], ['nov', 'Novos Neg.', false, 'false'],
                      ['tab', 'Todos a Bordo', false, 'false']];
    assert.deepEqual(await chipsRs(page), [esperado, esperado]);
    await page.click('#btnResumo');
    assert.equal(await blocoTab(page), null, 'padrão: sem o bloco');
    assert.equal(await page.$$eval('#rsFolha .rs-bloco', b => b.length), 2);
    await page.click('#rsOverlay [data-rsb="tab"]');
    assert.deepEqual((await chipsRs(page)).map(g => g[3][3]), ['true', 'true'], 'os dois grupos marcados');
    assert.equal(await page.$$eval('#rsFolha .rs-bloco', b => b.length), 3);
    // o bloco é o último; desmarcar tira o bloco e devolve a folha de antes (HTML igual)
    assert.equal(await page.$eval('#rsFolha', f => f.lastElementChild.dataset.bloco), 'tab');
    await page.click('#rsOverlay [data-rsb="tab"]');
    const sem = await page.innerHTML('#rsFolha');
    await page.click('#rsVoltar'); await page.click('#btnResumo');
    assert.equal(await page.innerHTML('#rsFolha'), sem);
    assert.deepEqual(erros, []);
    await ctx.close();
    for(const [nome, troca] of [['seminc', {}], ['inc', {'/js/config.js': t => t.replace('INCENTIVO_ATIVO: true', 'INCENTIVO_ATIVO: false')}]]){
      ({page, ctx, erros} = await abre(nome, {entrar: 'dir', troca}));
      const g = await chipsRs(page);
      assert.deepEqual(g.map(x => x.map(b => b[2])), [[false, false, false, true], [false, false, false, true]], nome);
      await page.click('#btnResumo');
      assert.equal(await blocoTab(page), null, nome);
      // link com "tab" num payload sem a aba: o bloco não é desenhado e o link gerado não leva "tab"
      await ctx.close();
      ({page, ctx, erros} = await abre(nome, {entrar: null, troca, busca: '?resumo=vol,tab&gc=G2'}));
      assert.equal(await blocoTab(page), null, `${nome}: link com tab`);
      assert.equal(await page.$$eval('#rsFolha .rs-bloco', b => b.length), 1, `${nome}: só o Volume`);
      const link = await page.evaluate(() => new Promise(ok => { navigator.share = async d => ok(d.url); document.getElementById('rsLink').click(); }));
      assert.match(link, /\?resumo=vol&gc=G2$/, nome);
      // só "tab" no link: sem o bloco, o ICS GC fica ligado (um bloco sempre ligado)
      await ctx.close();
      ({page, ctx, erros} = await abre(nome, {entrar: null, troca, busca: '?resumo=tab&gc=G2'}));
      assert.equal(await page.$$eval('#rsFolha .rs-bloco h3', b => b.map(x => x.firstChild.textContent.trim())).then(x => x.join('|')),
                   'Coberturas — ICS GC', nome);
      assert.deepEqual(erros, [], nome);
      await ctx.close();
    }
  });

  test('marcado: os 5 itens (ordem e rótulo da aba), colunas do ICS GC, "No ritmo"; cada célula = regra do ICS só nas rotas com meta; total = cards; "—" sem meta', async () => {
    const {page, ctx, erros} = await abre('inc', {entrar: 'dir'});
    const res = [];
    for(const [onde, entrar] of [['BAND', 'dir'], ['GC.G2', {perfil: 'gc', gc: 'G2'}], ['GC.G3', {perfil: 'gc', gc: 'G3'}],
                                 ['Total IT+MO', {perfil: 'gc', gc: 'IT+MO'}], ['SV.IT.1', {perfil: 'sv', gc: 'IT+MO', sv: 'SV.IT.1'}]]){
      await vaiPara(page, entrar);
      res.push([onde, await confereResumoTab(page, onde)]);
    }
    const r = Object.fromEntries(res);
    // Diretoria: Heineken e Heineken - 600ml com "—" nas gerências sem meta (as BARRACUDA do cenário) e valor nas FULL e na G2
    await vaiPara(page, 'dir');
    await page.click('#btnResumo');
    const t = await blocoTab(page);
    assert.deepEqual(t.faixas[0].linhas.map(l => l[0]), [...TITULOS_INC, 'No ritmo']);
    const col = {}; t.faixas.forEach(f => f.th.forEach((h, j) => { if(j && h) col[h] = f.linhas.map(l => l[j]); }));
    for(const g of ['GC.AP', 'GC.G1', 'GC.G3']) assert.deepEqual([col[g][1].txt, col[g][3].txt], ['—', '—'], g);
    for(const g of ['GC.G2', 'GC.IT', 'GC.RV']) assert.ok(col[g][1].pct != null && col[g][3].pct != null, g);
    assert.equal(col['GC.G3'][2].txt, '—', 'Eisenbahn - 600ml sem meta na G3');
    // G3: a coluna da supervisão da G311 (sem nenhum item) continua (é coluna do ICS) e o "No ritmo" conta só os itens com meta
    assert.ok(r['GC.G3'].tracos > 0 && r['BAND'].tracos > 0);
    // IT11 (online traz cliente novo em Heineken): o % do Resumo (Real ∪ Online) passa o do card
    assert.ok(r['SV.IT.1'].difCard > 0 && r['Total IT+MO'].difCard > 0, JSON.stringify(r));
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('células iguais às do ICS GC nos itens dele (escopo com meta em todas as rotas), também no fechamento', async () => {
    for(const nome of ['inc', 'incfech']){
      const {page, ctx, erros} = await abre(nome, {entrar: {perfil: 'gc', gc: 'IT+MO'}});
      await page.selectOption('#fgc', 'IT');
      await page.click('#btnResumo');
      await page.click('#rsOverlay [data-rsb="tab"]');
      const linhas = await page.evaluate(() => [...document.querySelectorAll('#rsFolha .rs-bloco')].map(b =>
        Object.fromEntries([...b.querySelectorAll('.rs-tab tbody tr')].map(tr => [tr.firstChild.textContent, [...tr.children].slice(1).map(td => td.innerHTML)]))));
      const ics = linhas[1], tab = linhas[2];
      assert.deepEqual(tab['Cervejas'], ics['Cervejas'], nome);
      assert.deepEqual(tab['Cervejas 600ml Retornável'], ics['Cerv. 600ml Ret.'], nome);
      if(nome === 'incfech') assert.match(await page.textContent('#rsFolha h3'), /fechamento/);
      assert.deepEqual(erros, [], nome);
      await ctx.close();
    }
  });

  test('link ?resumo= com e sem "tab"; o link gerado leva "tab" só com o bloco marcado', async () => {
    let {page, ctx, erros} = await abre('inc', {entrar: null, busca: '?resumo=vol,ics,tab&gc=G2'});
    assert.ok(await blocoTab(page), 'link com tab: bloco');
    assert.deepEqual((await chipsRs(page)).map(g => g[3][3]), ['true', 'true']);
    let link = await page.evaluate(() => new Promise(ok => { navigator.share = async d => ok(d.url); document.getElementById('rsLink').click(); }));
    assert.match(link, /\?resumo=vol,ics,tab&gc=G2$/);
    await ctx.close();
    ({page, ctx, erros} = await abre('inc', {entrar: null, busca: '?resumo=vol,ics&gc=G2'}));
    assert.equal(await blocoTab(page), null, 'link antigo sem tab: sem o bloco');
    link = await page.evaluate(() => new Promise(ok => { navigator.share = async d => ok(d.url); document.getElementById('rsLink').click(); }));
    assert.match(link, /\?resumo=vol,ics&gc=G2$/);
    ({page, ctx, erros} = await abre('inc', {entrar: null, busca: '?resumo=tab&modo=dir'}));
    assert.deepEqual(await page.$$eval('#rsFolha .rs-bloco', b => b.map(x => x.dataset.bloco || '')), ['tab']);
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('PDF (simulado): o bloco é um átomo; cabeçalho só na 1ª página, nenhuma página sem bloco; sem assinatura', async () => {
    for(const largura of [1280, 390]){
      const {page, ctx, erros} = await abre('inc', {entrar: 'dir', largura, altura: 900});
      for(const entrar of ['dir', {perfil: 'gc', gc: 'IT+MO'}]){
        await vaiPara(page, entrar);
        await page.click('#btnResumo');
        if(await page.getAttribute('#rsOverlay [data-rsb="tab"]', 'aria-pressed') !== 'true') await page.click('#rsOverlay [data-rsb="tab"]');
        const pdf = await pdfSimulado(page);
        const cont = await page.evaluate(CONTEUDO_PAGINAS, pdf.imgs);
        const onde = `${largura} ${JSON.stringify(entrar)}: ${JSON.stringify(cont)}`;
        assert.ok(pdf.pdf && !pdf.rod, onde);
        cont.forEach((c, i) => assert.ok(c.bloco > 0.2, `página ${i + 1} sem bloco: ${onde}`));
        // (com o 3º bloco a 1ª página fica mais alta: o cabeçalho ocupa uma fração menor dela)
        assert.ok(cont[0].cab > 0.01, onde);
        cont.slice(1).forEach((c, i) => assert.ok(c.cab < 0.01, `cabeçalho repetido na página ${i + 2}: ${onde}`));
        for(const [w, h] of pdf.paginas) assert.ok(h >= Math.round(w * 9 / 16), onde);
        // o bloco inteiro numa página (nunca cortado entre duas)
        const at = await page.evaluate(() => { const f = document.getElementById('rsFolha'), t0 = f.getBoundingClientRect().top;
          return [...f.querySelectorAll('.rs-bloco')].map(b => { const r = b.getBoundingClientRect(); return [r.top - t0, r.bottom - t0]; }); });
        assert.equal(at.length, 3, onde);
        await page.click('#rsVoltar');
      }
      assert.deepEqual(erros, []);
      await ctx.close();
    }
  });

  test('PDF real (html2canvas + jsPDF): com o bloco, uma página a mais que sem ele; nenhuma página em branco nem célula cortada',
       {skip: !LIBS_PDF && 'html2canvas/jspdf não instalados (npm)'}, async () => {
    const {page, ctx, erros} = await abre('inc', {entrar: 'dir', largura: 1280, altura: 900});
    await page.route(/cdnjs\.cloudflare\.com/, r => {
      const arq = /html2canvas/.test(r.request().url()) ? LIBS_PDF.html2canvas : LIBS_PDF.jspdf;
      r.fulfill({status: 200, contentType: 'text/javascript', body: fs.readFileSync(arq), headers: {'access-control-allow-origin': '*'}});
    });
    await page.evaluate(INSTALA_CELULAS);
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
    await page.click('#btnResumo');
    const pags = [];
    for(const tab of [false, true]){
      if(tab) await page.click('#rsOverlay [data-rsb="tab"]');
      await page.evaluate(() => { window.__real = {imgs: [], cel: null}; });
      const [baixado] = await Promise.all([page.waitForEvent('download'), page.click('#rsImg')]);
      const bytes = fs.readFileSync(await baixado.path()).toString('latin1');
      const n = (bytes.match(/\/Type\s*\/Page\b(?!s)/g) || []).length, real = await page.evaluate(() => window.__real);
      assert.equal(n, real.imgs.length);
      const tinta = await page.evaluate(imgs => Promise.all(imgs.map(src => new Promise(ok => {
        const im = new Image();
        im.onload = () => { const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
          const cx = c.getContext('2d'); cx.drawImage(im, 0, 0);
          const d = cx.getImageData(0, 0, im.width, im.height).data; let k = 0;
          for(let i = 0; i < d.length; i += 16) if(d[i] < 200 || d[i + 1] < 200 || d[i + 2] < 200) k++;
          ok(k / (d.length / 16)); };
        im.src = src;
      }))), real.imgs);
      tinta.forEach((t, i) => assert.ok(t > 0.02, `tab=${tab}: página ${i + 1} quase em branco (${t})`));
      assert.deepEqual(real.cel.prob.slice(0, 5), [], `tab=${tab}`);
      pags.push(n);
    }
    // Diretoria: Volume + ICS GC = 2 páginas; o bloco Todos a Bordo (um átomo) vai para uma página própria
    assert.deepEqual(pags, [2, 3]);
    assert.deepEqual(erros.filter(e => !/net::ERR_FAILED|cdnjs/.test(e)), []);
    await ctx.close();
  });

  test('360, 390, 1000 e 1440 px: os 4 botões sem texto cortado nem rolagem lateral (painel e barra do Resumo)', async () => {
    for(const largura of [360, 390, 1000, 1440]){
      const {page, ctx, erros} = await abre('inc', {entrar: {perfil: 'gc', gc: 'IT+MO'}, largura, altura: 900});
      const corte = sel => page.$$eval(sel, bs => bs.filter(b => b.offsetWidth && (b.scrollWidth > b.clientWidth + 1 || b.scrollHeight > b.clientHeight + 1))
        .map(b => `${b.dataset.rsb} ${b.scrollWidth}>${b.clientWidth}`));
      assert.deepEqual(await corte('.rsBox .rsChips button'), [], `${largura} painel`);
      const larg = await page.$$eval('.rsBox .rsChips button', bs => bs.map(b => Math.round(b.getBoundingClientRect().width)));
      // no celular, uma linha de botões iguais; no PC, cada um com a largura do texto (pelo menos)
      if(largura < 1000) assert.equal(new Set(larg).size, 1, `${largura}: botões da mesma largura ${larg}`);
      await page.click('#btnResumo');
      await page.click('#rsOverlay [data-rsb="tab"]');
      assert.deepEqual(await corte('#rsOverlay .rsChips button'), [], `${largura} barra`);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${largura}`);
      assert.deepEqual(erros, []);
      await ctx.close();
    }
  });
});

/* ---------- Parte AG — cascata com Dif (Real + Online), selo de meta batida e cards com Diferença (Real + online) (Etapa 3 do pacote v3) ----------
   Cards de Volume e coberturas (também os do Todos a Bordo): "Diferença" = (Real + online de hoje) − Meta (realOnline; pedido
   da Karen de 29/10/2026, no lugar da 4ª linha "Real + online ±X"); na Venda Zero, no fechamento e sem online, Real − Meta. Cascata (menos a Venda Zero): Nome | Meta · Real | % | Dif (Real + Online) | Online
   · meta do dia; cabeçalho de colunas só no PC (>= 1000 px) e chips "Ordenar:" só no celular; ordem padrão = a do código;
   ordenar por %, Dif ou Online (2º clique inverte), "Neutraliza" e grupos sem dados no fim; selo "✓ META BATIDA" com Real +
   online >= Meta (coberturas: clientes distintos). Diretoria: a gerência abre direto a lista de clientes dela (todas as abas).
   Lista de clientes de volume com a coluna Online (Real = só o faturado; Dif. Abs e % como antes). Invariantes em
   cascata_invariantes.js (as mesmas da conferência com dado real). Antes x depois contra a main antes da etapa (REF_PRE_CASC). */
const CASC_INV = require('./cascata_invariantes.js');
const REF_PRE_CASC = '515b1e9';
const FRONT_PRE_CASC = (() => {
  try {
    const ler = a => execSync(`git show ${REF_PRE_CASC}:frontend/${a}`, {cwd: RAIZ, stdio: ['ignore', 'pipe', 'ignore']}).toString();
    const out = {};
    for(const a of ['js/app.js', 'css/app.css', 'js/config.js', 'js/nucleo.js', 'js/resumo.js', 'js/ritmo.js', 'js/main.js', 'index.html']){
      const t = ler(a); out['/' + a] = () => t;
    }
    return out;
  } catch(e) { return null; }
})();
// a gaveta aberta está sem rolagem lateral e sem texto cortado (fora das áreas com rolagem própria e das reticências)
const CORTES_GAVETA = () => [...document.querySelectorAll('#drw *')].filter(el => el.clientWidth > 0 && el.getClientRects().length
  && !/auto|scroll/.test(getComputedStyle(el).overflowX) && getComputedStyle(el).textOverflow !== 'ellipsis'
  && el.scrollWidth > el.clientWidth + 1).map(el => `${el.className}: ${el.textContent.trim().slice(0, 30)}`);
// "Diferença" de cada card: texto, classe e se é a de Real + online (data-ro, com os valores exatos)
const cardDif = page => page.$$eval('#lista .ind', els => Object.fromEntries(els.map(el => { const d = el.querySelector('.cl .dif');
  return [el.dataset.k || el.dataset.incOff || '?', d ? {txt: d.textContent, cls: d.className, ro: d.dataset.ro == null ? null : Number(d.dataset.ro)} : null]; })));
// Diferença esperada, recontada do payload e do online: volume = Real + Σ online; cobertura = Σ (Real + |online ∖ COBERTOS|)
// por rota (clientes distintos); sem online (ou na Venda Zero): Real − Meta, como antes
const DIF_ESPERADA = rotasDe => {
  const out = {};
  [...document.querySelectorAll('#lista .ind[data-k]')].forEach(el => {
    const k = el.dataset.k;
    if(k === 'VENDAZERO') return;          // a Venda Zero tem a linha de sempre (cor invertida); conferida à parte
    const rs = rotasDe(k), b = agrega(rs).ind[k], vol = ehVolume(k);
    const com = !!ONLINE && !P.FECHAMENTO;
    const ro = !com ? null : vol ? b.real + rs.reduce((s, r) => s + ((ONLINE.volume[r] || {})[k] || 0), 0)
      : rs.reduce((s, r) => { const x = nodo('', r).indicators[k]; if(!x || x.unavailable) return s;
          const cob = new Set((COBERTOS[r] || {})[k] || []);
          return s + x.real + (((ONLINE.clientes[r] || {})[k]) || []).filter(pv => !cob.has(pv)).length; }, 0);
    const d = (ro == null ? b.real : ro) - b.meta, v = vol ? Math.round(d) : d;
    out[k] = {txt: `Diferença ${d > 0 ? '+' : ''}${v.toLocaleString('pt-BR')}`, cls: `dif ${d >= 0 ? 'pos' : 'neg'}`, ro};
  });
  return out;
};

describe('Parte AG — cascata com Dif (Real + Online), selo e cards com Diferença (Real + online)', {skip: pular}, () => {
  test('cards: "Diferença" = (Real + online de hoje) − Meta no Volume e nas coberturas; Venda Zero como antes', async () => {
    const {page, ctx, erros} = await abre('normal', {entrar: {perfil: 'gc', gc: 'G1'}, largura: 1440, aba: 'VOLUME'});
    let comOnline = 0;
    for(const aba of ['VOLUME', 'ICS_GC', 'NOVOS_NEG']){
      await filtra(page, {aba});
      const esp = await page.evaluate(`(${DIF_ESPERADA})(() => rotasAtuais())`), got = await cardDif(page);
      for(const [k, e] of Object.entries(esp)) assert.deepEqual(got[k], e, `${aba} ${k}`);
      comOnline += Object.values(esp).filter(e => e.ro != null).length;
      // uma linha só (Meta, Real, Diferença), sem a 4ª linha; alturas iguais por tipo e nada estourando
      assert.deepEqual(await page.$$eval('#lista .ind .cl', els => [...new Set(els.map(el => el.children.length))]), [3], aba);
      const alt = await page.$$eval('#lista .ind:not(.off)', els => els.map(el => [el.classList.contains('vol'), Math.round(el.getBoundingClientRect().height)]));
      for(const tipo of [true, false]){ const hs = alt.filter(x => x[0] === tipo).map(x => x[1]); assert.ok(new Set(hs).size <= 1, `${aba}: alturas ${hs}`); }
      assert.deepEqual(await page.$$eval('#lista .ind .cl', els => els.filter(el => el.scrollWidth > el.clientWidth + 1).map(el => el.textContent)), []);
    }
    assert.ok(comOnline > 5, 'cards com online');
    // Venda Zero: Real − Meta, sem os valores de Real + online
    await filtra(page, {aba: 'ICS_GC'});
    const vz = (await cardDif(page)).VENDAZERO, bvz = await page.evaluate(() => agrega(rotasAtuais()).ind.VENDAZERO);
    const dvz = bvz.real - bvz.meta;
    assert.deepEqual(vz, {txt: `Diferença ${dvz > 0 ? '+' : ''}${dvz.toLocaleString('pt-BR', {maximumFractionDigits: 1})}`,
                          cls: `dif ${dvz <= 0 ? 'pos' : 'neg'}`, ro: null}, 'Venda Zero como antes');
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('cards: Diferença = Real − Meta (como antes) no fechamento (incfech) e sem online.json; Todos a Bordo com as rotas com meta do item', async () => {
    let {page, ctx, erros} = await abre('incfech', {entrar: {perfil: 'gc', gc: 'IT+MO'}, aba: 'VOLUME'});
    for(const aba of ['VOLUME', 'ICS_GC', 'NOVOS_NEG', 'INCENTIVO']){
      await filtra(page, {aba});
      assert.equal(await page.$$eval('#lista .ind .dif[data-ro]', e => e.length), 0, `fechamento ${aba}`);
      const esp = await page.evaluate(`(${DIF_ESPERADA})(k => aba === 'INCENTIVO' ? rotasInc(k, rotasAtuais()) : rotasAtuais())`), got = await cardDif(page);
      for(const [k, e] of Object.entries(esp)) assert.deepEqual(got[k], e, `fechamento ${aba} ${k}`);
    }
    assert.deepEqual(erros, []);
    await ctx.close();
    ({page, ctx, erros} = await abre('inc', {entrar: {perfil: 'gc', gc: 'IT+MO'}, aba: 'INCENTIVO'}));
    const esp = await page.evaluate(`(${DIF_ESPERADA})(k => rotasInc(k, rotasAtuais()))`), got = await cardDif(page);
    for(const [k, e] of Object.entries(esp)) assert.deepEqual(got[k], e, k);
    assert.ok(Object.values(esp).some(e => e.ro != null));
    // sem online.json: Real − Meta (e a cascata mostra "—" / "sem online")
    await page.evaluate(() => { ONLINE = null; render(); });
    await filtra(page, {aba: 'VOLUME'});
    assert.equal(await page.$$eval('#lista .ind .dif[data-ro]', e => e.length), 0, 'sem online');
    const sem = await page.evaluate(`(${DIF_ESPERADA})(() => rotasAtuais())`), gs = await cardDif(page);
    for(const [k, e] of Object.entries(sem)) assert.deepEqual(gs[k], e, `sem online ${k}`);
    await page.click('#lista .ind[data-k]');
    await CASC_INV.confereNivel(page, 'sem online');
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('cascata: 5 colunas, cabeçalho só >= 1000 px e chips só < 1000 px; Venda Zero como antes; invariantes (a)-(e)', async () => {
    for(const largura of [1440, 1000, 390, 360]){
      const {page, ctx, erros} = await abre('normal', {entrar: {perfil: 'gc', gc: 'G1'}, largura, altura: 900});
      for(const aba of ['VOLUME', 'ICS_GC', 'NOVOS_NEG']){
        await filtra(page, {aba});
        for(const k of await page.$$eval('#lista .ind[data-k]', els => els.map(e => e.dataset.k))){
          await page.click(`#lista .ind[data-k="${k}"]`);
          const r = await CASC_INV.confereNivel(page, `${largura} ${k}`);
          const vis = await page.evaluate(() => ({cab: (document.querySelector('#dCorpo .cOrd') || {}).offsetParent != null,
            chips: (document.querySelector('#dCorpo .cOrdCh') || {}).offsetParent != null}));
          if(k === 'VENDAZERO') assert.deepEqual(vis, {cab: false, chips: false}, 'Venda Zero sem ordenação');
          else assert.deepEqual(vis, {cab: largura >= 1000, chips: largura < 1000}, `${largura} ${k}`);
          if(k !== 'VENDAZERO' && r.linhas){
            // cabeçalho: nível | Meta · Real | % tendência / % real da meta | Dif (Real + Online) | Online · meta do dia
            const cab = await page.$$eval('#dCorpo .cOrd > *', els => els.map(e => e.textContent.trim()));
            assert.deepEqual(cab, ['Supervisão', 'Meta · Real', k.startsWith('VOL ') ? '% tendência' : '% real da meta',
                                   'Dif (Real + Online)', 'Online · meta do dia']);
            assert.deepEqual(await page.$$eval('#dCorpo .cOrdCh > *', els => els.map(e => e.textContent.trim())),
                             ['Ordenar:', 'Código', '%', 'Dif', 'Online']);
            // no PC as colunas das linhas e do cabeçalho alinham (mesmo x de início)
            if(largura >= 1000){
              const xs = await page.evaluate(() => [document.querySelector('#dCorpo .cOrd'), document.querySelector('#dCorpo .cLin.v3')]
                .map(el => [...el.children].map(c => Math.round(c.getBoundingClientRect().left))));
              xs[0].forEach((x, i) => assert.ok(Math.abs(x - xs[1][i]) <= 1, `${largura} ${k}: coluna ${i} ${x} x ${xs[1][i]}`));
            }
          }
          assert.deepEqual(await page.evaluate(CORTES_GAVETA), [], `${largura} ${k}: texto cortado`);
          // desce um nível (rotas) e confere de novo
          if(await page.$('#dCorpo .cLin[data-i]')){
            await page.click('#dCorpo .cLin[data-i]');
            if(await page.$('#dCorpo .cLin')) await CASC_INV.confereNivel(page, `${largura} ${k} rotas`);
          }
          await page.keyboard.press('Escape');
        }
      }
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${largura}: rolagem lateral`);
      assert.deepEqual(erros, []);
      await ctx.close();
    }
  });

  test('ordem: padrão = código, % / Dif / Online decrescente e invertido, "Neutraliza" no fim; vale até fechar a gaveta', async () => {
    for(const largura of [1280, 390]){
      const {page, ctx, erros} = await abre('normal', {entrar: {perfil: 'gc', gc: 'G1'}, largura, aba: 'VOLUME'});
      await page.click('#lista .ind[data-k="VOL REFRIGERANTES"]');
      const nomes = () => page.$$eval('#dCorpo .cLin', els => els.map(e => (e.querySelector('.cNomeL b') || e.querySelector('b')).textContent));
      const codigo = await nomes();
      assert.equal(codigo[codigo.length - 1], 'Neutraliza', 'Neutraliza por último');
      await CASC_INV.confereOrdem(page, `${largura} G1`);
      // escolhe % decrescente, desce para as rotas e volta: a ordem continua; reabrir volta ao código
      const alvo = largura >= 1000 ? '#dCorpo .cOrdB[data-o="pct"]' : '#dCorpo .cOrdCh .fchip[data-o="pct"]';
      await page.click(alvo);
      const porPct = await nomes();
      assert.equal(porPct[porPct.length - 1], 'Neutraliza');
      assert.equal(await page.evaluate(() => document.activeElement.dataset.o), 'pct', 'o foco volta ao título');
      await page.click('#dCorpo .cLin[data-i]');
      const rotas = await page.$$eval('#dCorpo .cLin', els => els.map(e => Number(e.dataset.dir)));
      assert.deepEqual(rotas, [...rotas].sort((a, b) => b - a), 'rotas também por % decrescente');
      await page.click('#cVolta');
      assert.deepEqual(await nomes(), porPct, 'descer e voltar mantém a ordem');
      await page.keyboard.press('Escape');
      await page.click('#lista .ind[data-k="VOL REFRIGERANTES"]');
      assert.deepEqual(await nomes(), codigo, 'ao abrir de novo, a ordem do código');
      assert.deepEqual(erros, []);
      await ctx.close();
    }
  });

  test('selo "✓ META BATIDA": Real + online >= Meta (coberturas: clientes distintos); sem selo com o cliente coberto comprando de novo', async () => {
    const {page, ctx, erros} = await abre('normal', {entrar: {perfil: 'gc', gc: 'G1'}, largura: 1280, aba: 'ICS_GC'});
    // KS TT: G111 com meta 3 e Real 1 (cliente a); caso 1: online [a, b, c] -> 1 + 2 = 3 >= 3 (selo); caso 2: online [a]
    // (o mesmo cliente) -> 1 + 0 < 3, sem selo, mesmo com Real + caixa do Online = 2 ... e caso 3: online [a, a2] em que a2
    // também já está coberto: Real 2, caixa 2, Real + caixa 4 >= 3 mas clientes distintos = 2 < 3
    const caso = (cob, onl) => page.evaluate(([cob, onl]) => {
      const k = 'CCTM 2L PET', rs = ['G111', 'G112', 'G121', 'G122'];
      for(const r of rs){
        const b = nodo('', r).indicators[k], pvs = CLIENT_ROSTER[r].map(c => c[0]);
        Object.assign(b, {meta: 3, real: cob.length, unavailable: false});
        COBERTOS[r] = {...(COBERTOS[r] || {}), [k]: cob.map(i => pvs[i])};
        ONLINE.clientes[r] = {...(ONLINE.clientes[r] || {}), [k]: onl.map(i => pvs[i])};
        ONLINE.rotas[r] = {...(ONLINE.rotas[r] || {}), [k]: onl.length};
      }
      render();
    }, [cob, onl]);
    const abreSv = async () => { await page.click('#lista .ind[data-k="CCTM 2L PET"]'); };
    const linhas = () => page.evaluate(CASC_INV.LE_CASCATA);
    await caso([0], [0, 1, 2]);
    await abreSv();
    let c = await linhas();
    assert.ok(c.linhas.filter(l => !l.off && !l.fim).every(l => l.bat && l.selo === '✓ Meta batida' && l.ro === 6 && l.meta === 6), 'caso 1: selo');
    const sel = await page.$eval('#dCorpo .cLin.bat', el => { const cs = getComputedStyle(el), s = getComputedStyle(el.querySelector('.cSelo'));
      return [cs.backgroundColor, cs.borderLeftColor, s.backgroundColor, s.color, s.fontSize, s.textTransform]; });
    assert.deepEqual(sel, ['rgb(238, 248, 242)', 'rgb(29, 158, 117)', 'rgb(29, 158, 117)', 'rgb(255, 255, 255)', '9.5px', 'uppercase']);
    await CASC_INV.confereNivel(page, 'caso 1');
    await page.keyboard.press('Escape');
    await caso([0], [0]);
    await abreSv();
    c = await linhas();
    assert.ok(c.linhas.filter(l => !l.off && !l.fim).every(l => !l.bat && !l.selo && l.ro === 2 && l.real === 2 && l.onl === 2), 'caso 2: sem selo');
    await CASC_INV.confereNivel(page, 'caso 2');
    await page.keyboard.press('Escape');
    await caso([0, 1], [0, 1]);
    await abreSv();
    c = await linhas();
    const l = c.linhas[0];
    assert.ok(l.real + l.onl >= l.meta && l.ro < l.meta && !l.bat, `caso 3: Real ${l.real} + caixa ${l.onl} >= Meta ${l.meta}, distintos ${l.ro}`);
    assert.equal(l.difTxt, '-2');
    assert.equal(l.difSub, '67% da meta com online');
    await CASC_INV.confereNivel(page, 'caso 3');
    await page.keyboard.press('Escape');
    // volume: Real + online de hoje >= Meta numa supervisão -> selo; a caixa do Online continua com a regra de antes
    await page.evaluate(() => { for(const r of ['G111', 'G112']) ONLINE.volume[r] = {...ONLINE.volume[r], 'VOL REFRIGERANTES': 5000}; render(); });
    await filtra(page, {aba: 'VOLUME'});
    await page.click('#lista .ind[data-k="VOL REFRIGERANTES"]');
    c = await linhas();
    assert.ok(c.linhas.find(x => x.nome.startsWith('SV.G1.1')).bat, 'volume: selo na SV.G1.1');
    await CASC_INV.confereNivel(page, 'volume');
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('fechamento: % realizado, Dif "—" com "sem online no fechamento", selo com Real >= Meta; lista com Online "—"', async () => {
    const {page, ctx, erros} = await abre('fech', {entrar: {perfil: 'gc', gc: 'G1'}, largura: 1280, aba: 'VOLUME'});
    await page.click('#lista .ind[data-k="VOL REFRIGERANTES"]');
    await CASC_INV.confereNivel(page, 'fechamento');
    assert.equal(await page.$eval('#dCorpo .cOrdB[data-o="pct"]', b => b.textContent.trim()), '% realizado');
    while(await page.$('#dCorpo .cLin[data-i]')) await page.click('#dCorpo .cLin[data-i]');
    await CASC_INV.confereLista(page, 'fechamento');
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('Diretoria: a gerência abre direto a lista de clientes (todas as abas); Gerência e Supervisão com a cascata completa', async () => {
    const {page, ctx, erros} = await abre('inc', {entrar: 'dir', largura: 1280, aba: 'VOLUME'});
    for(const aba of ['VOLUME', 'ICS_GC', 'NOVOS_NEG', 'INCENTIVO']){
      await filtra(page, {aba});
      for(const k of await page.$$eval('#lista .ind[data-k]', els => els.map(e => e.dataset.k))){
        await page.click(`#lista .ind[data-k="${k}"]`);
        assert.equal(await page.evaluate(() => CASC.pilha[0].nivel), 'gc');
        await CASC_INV.confereNivel(page, `Diretoria ${k}`);
        const g = await page.$eval('#dCorpo .cLin[data-i]', el => (el.querySelector('.cNomeL b') || el.querySelector('b')).textContent);
        await page.click('#dCorpo .cLin[data-i]');
        const st = await page.evaluate(() => ({nivel: CASC.pilha[1].nivel, tit: document.getElementById('dTit').textContent,
          volta: document.getElementById('cVolta').textContent, lista: !!document.getElementById('dLista'),
          chips: !!document.querySelector('#dCorpo .dchip'), linhas: document.querySelectorAll('#dCorpo .cLin').length}));
        assert.deepEqual([st.nivel, st.volta, st.lista, st.chips, st.linhas], ['cli', '← Gerências', true, true, 0], `${aba} ${k}`);
        assert.ok(st.tit.endsWith(g), `${k}: título "${st.tit}" com a gerência ${g}`);
        if(k.startsWith('VOL ')) await CASC_INV.confereLista(page, `Diretoria ${k} ${g}`);
        await page.keyboard.press('Escape');
      }
    }
    // a Executiva (unidadesExec) continua com as supervisões como filho da gerência
    assert.deepEqual(await page.evaluate(() => [...new Set(unidadesExec(ctxInicial()).map(u => u.filho.nivel))]), ['sv']);
    // Gerência: gerência -> supervisões -> rotas -> clientes; Supervisão: rotas -> clientes
    for(const [entrar, niveis] of [[{perfil: 'gc', gc: 'G2'}, ['sv', 'rota', 'cli']], [{perfil: 'sv', gc: 'G2', sv: '1'}, ['rota', 'cli']]]){
      await vaiPara(page, entrar, 'ICS_GC');
      await page.click('#lista .ind[data-k]');
      const vistos = [await page.evaluate(() => CASC.pilha[0].nivel)];
      while(await page.$('#dCorpo .cLin[data-i]')){
        await page.click('#dCorpo .cLin[data-i]');
        vistos.push(await page.evaluate(() => CASC.pilha[CASC.pilha.length - 1].nivel));
      }
      assert.deepEqual(vistos, niveis, entrar.perfil);
      await page.keyboard.press('Escape');
    }
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('lista de clientes de volume: Cliente | Meta | Real (faturado) | Online | Dif. Abs | %; Dif = Real + Online − Meta; sem rolagem lateral', async () => {
    for(const largura of [1440, 1000, 390, 360]){
      const {page, ctx, erros} = await abre('normal', {entrar: {perfil: 'rota', gc: 'G1', rota: 'G111'}, largura, aba: null});
      await page.click('#lista .ind[data-k="VOL REFRIGERANTES"]');
      const r = await CASC_INV.confereLista(page, `${largura}`);
      assert.ok(r.clientes > 0 && r.comOnline > 0, `${largura}: com cliente online`);
      const tit = await page.$$eval('#dCorpo .cCab span', s => s.map(x => x.title));
      assert.deepEqual(tit.slice(4), ['(Real + Online) − Meta', '(Real + Online) ÷ Meta']);
      // celular: nome em cima (largura toda) e os 5 números embaixo, alinhados ao cabeçalho (sem o rótulo "Cliente")
      const geo = await page.evaluate(() => {
        const cab = document.querySelector('#dCorpo .cCab'), cli = document.querySelector('#dCorpo .cCli');
        const sp = el => [...el.children].filter(c => c.tagName === 'SPAN' && c.offsetParent).map(c => Math.round(c.getBoundingClientRect().right));
        const n = cli.querySelector('.cCliN').getBoundingClientRect(), x = cli.querySelector('span').getBoundingClientRect();
        return {cab: sp(cab), cli: sp(cli), duas: n.bottom <= x.top + 1, cliente: !!cab.querySelector('.cCabN').offsetParent};
      });
      assert.deepEqual(geo.cab.slice(-5), geo.cli, `${largura}: colunas alinhadas ao cabeçalho`);
      assert.equal(geo.duas, largura < 1000, `${largura}: duas linhas no celular`);
      assert.equal(geo.cliente, largura >= 1000, `${largura}: rótulo "Cliente" só no PC`);
      assert.deepEqual(await page.evaluate(CORTES_GAVETA), [], `${largura}: texto cortado`);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
      assert.deepEqual(erros, []);
      await ctx.close();
    }
  });

  test(`antes x depois (${REF_PRE_CASC}): Executiva, Resumo, Venda Zero e números da cascata iguais; cards só com a linha nova`,
       {skip: !FRONT_PRE_CASC && `sem o commit ${REF_PRE_CASC}`}, async () => {
    for(const [dados, entrar] of [['inc', 'dir'], ['inc', {perfil: 'gc', gc: 'G1'}], ['grupo', {perfil: 'gc', gc: 'IT+MO'}], ['fech', 'gc']]){
      const [novo, velho] = [await abre(dados, {entrar, aba: null, largura: 1280}),
                             await abre(dados, {entrar, aba: null, largura: 1280, troca: FRONT_PRE_CASC})];
      const quem = `${dados} ${JSON.stringify(entrar)}`;
      const lerExec = p => p.evaluate(() => document.getElementById('exec').innerHTML);
      assert.equal(await lerExec(novo.page), await lerExec(velho.page), `${quem}: Executiva`);
      for(const aba of ['VOLUME', 'ICS_GC', 'NOVOS_NEG', 'INCENTIVO']){
        for(const {page} of [novo, velho]) await filtra(page, {aba});
        const cards = p => p.innerHTML('#lista');
        assert.equal(CASC_INV.desfazCasc(await cards(novo.page)), await cards(velho.page), `${quem} ${aba}: cards (sem a linha nova)`);
        // cascata: desfeito só o que a etapa trocou (desfazCasc), o HTML de cada nível = o de antes; a Venda Zero inteira igual.
        // Na Diretoria só o 1º nível (lá a gerência abre direto a lista de clientes)
        for(const k of (await novo.page.$$eval('#lista .ind[data-k]', els => els.map(e => e.dataset.k)))){
          for(const {page} of [novo, velho]) await page.click(`#lista .ind[data-k="${k}"]`);
          for(let nivel = 0; nivel < 5; nivel++){
            const [hn, hv] = [await novo.page.innerHTML('#drw'), await velho.page.innerHTML('#drw')];
            if(k === 'VENDAZERO') assert.equal(hn, hv, `${quem} Venda Zero nível ${nivel}`);
            else assert.equal(CASC_INV.desfazCasc(hn), hv, `${quem} ${k}: cascata nível ${nivel}`);
            if(entrar === 'dir' || !(await novo.page.$('#dCorpo .cLin[data-i]'))) break;
            for(const {page} of [novo, velho]) await page.click('#dCorpo .cLin[data-i]');
          }
          for(const {page} of [novo, velho]) await page.keyboard.press('Escape');
        }
      }
      if(await novo.page.$('#btnResumo:not([hidden])')){
        for(const {page} of [novo, velho]) await page.click('#btnResumo');
        assert.equal(await novo.page.innerHTML('#rsFolha'), await velho.page.innerHTML('#rsFolha'), `${quem}: Resumo`);
      }
      assert.deepEqual(novo.erros, []);
      await novo.ctx.close(); await velho.ctx.close();
    }
  });
});

/* Parte AH — botão "Clientes" por agrupador, com busca (Etapa 4 do pacote v3). Invariantes (a)-(d) em
   frontend/tests/clientes_invariantes.js (as mesmas da conferência com dado real). */
const CLI_INV = require('./clientes_invariantes.js');
// estado do botão e da gaveta "Clientes"
const LE_CLI = () => {
  const b = document.getElementById('btnClientes'), cab = document.querySelector('.abCab');
  return {visivel: !!b && !b.hidden && b.getClientRects().length > 0, texto: b ? b.textContent.trim() : null,
          antesDoDia: !!b && b.parentElement === cab && b.nextElementSibling === document.getElementById('pilDia'),
          aberta: document.getElementById('drw').classList.contains('on'), tit: document.getElementById('dTit').textContent,
          sub: document.getElementById('dSub').textContent, q: (document.getElementById('cliQ') || {}).value,
          ks: [...document.querySelectorAll('#cliKs .dchip')].map(e => [e.dataset.k, e.textContent, e.getAttribute('aria-pressed')]),
          dia: (document.querySelector('#dLista .dchip.on') || {dataset: {}}).dataset.d || null,
          linhas: document.querySelectorAll('#dLista > .cCli, #dLista > .item').length,
          vazio: [...document.querySelectorAll('#dLista > .vazio')].map(v => v.textContent)};
};
const buscaCli = (page, q) => page.evaluate(q => { const i = document.getElementById('cliQ'); i.value = q; i.dispatchEvent(new Event('input')); }, q);
const ABAS_CLI = ['VOLUME', 'ICS_GC', 'NOVOS_NEG', 'INCENTIVO'];

describe('Parte AH — botão "Clientes" por agrupador, com busca', {skip: pular}, () => {
  test('botão nas 4 abas (antes da etiqueta do dia), fora da Executiva; perfil Rota com o botão; estilo e ícone', async () => {
    const {page, ctx, erros} = await abre('inc', {entrar: {perfil: 'gc', gc: 'G1'}, aba: null, largura: 1440});
    assert.equal(await page.evaluate(() => aba), 'EXEC');
    assert.equal((await page.evaluate(LE_CLI)).visivel, false, 'Executiva sem o botão');
    for(const ab of ABAS_CLI){
      await filtra(page, {aba: ab});
      const e = await page.evaluate(LE_CLI);
      assert.deepEqual([e.visivel, e.texto, e.antesDoDia], [true, 'Clientes', true], ab);
    }
    const est = await page.evaluate(() => {
      const b = document.getElementById('btnClientes'), cs = getComputedStyle(b), svg = b.querySelector('svg');
      const v = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
      const rgb = c => { const d = document.createElement('i'); d.style.color = c; document.body.appendChild(d);
        const x = getComputedStyle(d).color; d.remove(); return x; };
      return {borda: cs.borderTopColor, linha: rgb(v('--linha')), fundo: cs.backgroundColor, raio: parseFloat(cs.borderTopLeftRadius),
              traco: getComputedStyle(svg.querySelector('path')).stroke, cor: cs.color, preto: rgb(v('--preto')),
              ariaSvg: svg.getAttribute('aria-hidden'), fam: cs.fontFamily, tam: cs.fontSize, leg: v('--fs-legenda')};
    });
    assert.equal(est.borda, est.linha, 'borda --linha');
    assert.equal(est.fundo, 'rgb(255, 255, 255)', 'fundo branco');
    assert.ok(est.raio >= 999, 'arredondado');
    assert.equal(est.traco, est.cor, 'traço currentColor');
    assert.equal(est.ariaSvg, 'true');
    assert.match(est.fam, /^Inter,/);
    assert.equal(est.tam, est.leg, 'tamanho pela variável');
    await page.hover('#btnClientes');
    await page.waitForTimeout(250);     // a transição da borda (.12s)
    assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('btnClientes')).borderTopColor), est.preto, 'hover --preto');
    // perfil Rota: sem Executiva, o botão no Volume e nas demais abas
    await vaiPara(page, {perfil: 'rota', gc: 'G1', rota: 'G111'}, null);
    for(const ab of ABAS_CLI){
      await filtra(page, {aba: ab});
      assert.equal((await page.evaluate(LE_CLI)).visivel, true, `Rota ${ab}`);
    }
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('gaveta: título "Clientes · <agrupador>", subtítulo "<aba> · <resumo do card>", um botão por agrupador; cascata sem o campo', async () => {
    const {page, ctx, erros} = await abre('inc', {entrar: {perfil: 'gc', gc: 'G2'}, largura: 1440, aba: 'VOLUME'});
    for(const ab of ABAS_CLI){
      await filtra(page, {aba: ab});
      await page.click('#btnClientes');
      const e = await page.evaluate(LE_CLI);
      const esp = await page.evaluate(() => {
        const ks = aba === 'INCENTIVO' ? itensInc().filter(k => rotasInc(k, rotasAtuais()).length)
          : [...document.querySelectorAll('#lista .ind[data-k]')].map(x => x.dataset.k);
        const rs = k => aba === 'INCENTIVO' ? rotasInc(k, rotasAtuais()) : rotasAtuais();
        return {ks, rot: ks.map(k => rotuloInd(k)), tit: `Clientes · ${rotuloInd(ks[0])}`,
                sub: `${document.querySelector(`.tab[data-g="${aba}"]`).title} · ${resumoInd(ks[0], agrega(rs(ks[0])).ind[ks[0]])}`};
      });
      assert.deepEqual(e.ks.map(x => x[0]), esp.ks, `${ab}: agrupadores`);
      assert.deepEqual(e.ks.map(x => x[1]), esp.rot, `${ab}: rótulos`);
      assert.deepEqual(e.ks.map(x => x[2]), esp.ks.map((k, i) => String(i === 0)), `${ab}: o 1º marcado`);
      assert.deepEqual([e.aberta, e.tit, e.sub, e.q], [true, esp.tit, esp.sub, ''], ab);
      if(ab === 'VOLUME') assert.ok(esp.ks.includes('VOL DEL VALLE FRUT'), 'Del Valle Frut na G2, como no card');
      if(ab === 'ICS_GC') assert.ok(esp.ks.includes('VENDAZERO'), 'Venda Zero no ICS GC');
      // a busca: arredondada, com a lupa, type=search, placeholder e aria-label
      const b = await page.evaluate(() => { const i = document.getElementById('cliQ');
        return {tipo: i.type, ph: i.placeholder, aria: i.getAttribute('aria-label'), lupa: !!i.parentElement.querySelector('svg'),
                raio: parseFloat(getComputedStyle(i).borderTopLeftRadius), antes: !!(i.parentElement.compareDocumentPosition(
                  document.getElementById('cliKs')) & Node.DOCUMENT_POSITION_FOLLOWING)}; });
      assert.deepEqual(b, {tipo: 'search', ph: 'Buscar cliente (nome ou PV)', aria: b.aria, lupa: true, raio: b.raio, antes: true});
      assert.ok(b.aria && b.raio >= 999, 'aria-label e arredondado');
      // trocar de agrupador troca o título e o subtítulo
      if(esp.ks.length > 1){
        await page.click(`#cliKs .dchip[data-k="${esp.ks[1]}"]`);
        const e2 = await page.evaluate(LE_CLI);
        assert.equal(e2.tit, `Clientes · ${esp.rot[1]}`);
        assert.deepEqual(e2.ks.map(x => x[2]), esp.ks.map((k, i) => String(i === 1)));
      }
      await page.keyboard.press('Escape');
      // a cascata continua sem o campo de busca
      await page.click('#lista .ind[data-k]');
      assert.equal(await page.$('#cliQ'), null, `${ab}: cascata sem busca`);
      await page.keyboard.press('Escape');
    }
    // Volume na Diretoria: os 5 macros (o Del Valle Frut fica fora da Diretoria, como o card)
    await vaiPara(page, 'dir', 'VOLUME');
    await page.click('#btnClientes');
    assert.deepEqual((await page.evaluate(LE_CLI)).ks.map(x => x[0]), await page.evaluate(() => GROUPS.VOLUME.filter(k => !agrega(rotasAtuais()).ind[k].unavailable)));
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  for(const dados of ['inc', 'incfech', 'grupo']){
    test(`${dados}: lista do botão = cascata (mesmos clientes, ordem e números) na Diretoria, gerência, supervisão e rota; Todos a Bordo só com meta; busca`, async () => {
      const {page, ctx, erros} = await abre(dados, {entrar: 'dir', largura: 1440, aba: 'VOLUME',
        troca: {'/js/config.js': CLI_INV.semLimite}});
      const escopos = dados === 'grupo' ? [{perfil: 'gc', gc: 'IT+MO'}, {perfil: 'sv', gc: 'IT', sv: 'SV.IT.1'}]
        : ['dir', {perfil: 'gc', gc: 'G2'}, {perfil: 'sv', gc: 'G1', sv: 'SV.G1.1'}, {perfil: 'rota', gc: 'IT', rota: 'IT11'}];
      let n = 0;
      for(const e of escopos){
        if(e !== 'dir') await vaiPara(page, e, 'VOLUME');
        for(const ab of ABAS_CLI){
          await filtra(page, {aba: ab});
          const r = await CLI_INV.confereAba(page, `${dados} ${JSON.stringify(e)} ${ab}`);
          n += Object.values(r.porK).reduce((a, x) => a + x.n, 0);
        }
      }
      assert.ok(n > 50, `linhas conferidas: ${n}`);
      // Diretoria com uma gerência no filtro
      if(dados === 'inc'){
        await vaiPara(page, 'dir', 'ICS_GC');
        await page.evaluate(() => { sel.dgc = 'G2'; render(); });
        await CLI_INV.confereAba(page, `${dados} Diretoria G2 ICS_GC`);
      }
      assert.deepEqual(erros, []);
      await ctx.close();
    });
  }

  test('Todos a Bordo: só as rotas com meta do item (G2: Heineken só na G211)', async () => {
    const {page, ctx, erros} = await abre('inc', {entrar: {perfil: 'gc', gc: 'G2'}, largura: 1440, aba: 'INCENTIVO'});
    await page.click('#btnClientes');
    const rotasDe = k => page.evaluate(k => { const b = document.querySelector(`#cliKs .dchip[data-k="${k}"]`); if(!b) return null; b.click();
      document.querySelector('#dLista .dchip[data-d="Todos"]').click();
      return [...new Set([...document.querySelectorAll('#dLista > .item .sb')].map(s => s.textContent.match(/· rota (\S+)/)[1]))]; }, k);
    const esp = await page.evaluate(() => Object.fromEntries(itensInc().map(k => [k, rotasListas().filter(r => temMetaInc(k, r))])));
    assert.deepEqual(esp['INC HEINEKEN'], ['G211']);
    for(const [k, rs] of Object.entries(esp)){
      const got = await rotasDe(k);
      if(!rs.length){ assert.equal(got, null, `${k}: sem botão sem rota com meta`); continue; }
      assert.ok(got.every(r => rs.includes(r)), `${k}: ${got}`);
    }
    assert.ok((await page.evaluate(() => rotasListas().length)) > 1);
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('busca: por PV (exatamente 1 linha), por parte do nome, sem acento e sem caixa; sem resultado "Ninguém neste filtro."', async () => {
    const {page, ctx, erros} = await abre('inc', {entrar: {perfil: 'gc', gc: 'G1'}, largura: 1440, aba: 'ICS_GC'});
    // um nome com acento por aba (fictícios) e as buscas que têm de achá-lo
    const NOMES = {VOLUME: ['PADARIA SÃO JOÃO TESTE', ['sao joao', 'SAO JOÃO', 'padaria s', '  joão  ']],
                   ICS_GC: ['EMPÓRIO CONCEIÇÃO TESTE', ['emporio', 'CONCEICAO', 'pório conc', ' Conceição ']]};
    for(const ab of ['VOLUME', 'ICS_GC']){
      await filtra(page, {aba: ab});
      await page.click('#btnClientes');
      await page.click('#dLista .dchip[data-d="Todos"]');
      // um cliente da lista ganha um nome com acento (fictício), na base e nas listas
      const pv = await page.evaluate(novo => { const el = document.querySelector('#dLista > .cCli, #dLista > .item');
        const nome = (el.querySelector('.nm .tagOnline') ? el.querySelector('.nm').firstChild.textContent.replace(/ $/, '') : el.querySelector('.nm').firstChild.textContent), rota = el.querySelector('.sb').textContent.match(/· rota (\S+)/)[1];
        const c = CLIENT_ROSTER[rota].find(c => c[1] === nome); c[1] = novo;
        (CLIENTES_HOJE[rota] || []).forEach(x => { if(x[0] === c[0]) x[1] = c[1]; }); pintaClientes(); return c[0]; }, NOMES[ab][0]);
      const total = (await page.evaluate(LE_CLI)).linhas;
      assert.ok(total > 3, `${ab}: ${total}`);
      await buscaCli(page, String(pv));
      assert.equal((await page.evaluate(LE_CLI)).linhas, 1, `${ab}: PV`);
      for(const q of NOMES[ab][1]){
        await buscaCli(page, q);
        const e = await page.evaluate(LE_CLI);
        assert.equal(e.linhas, 1, `${ab}: "${q}"`);
        assert.ok((await page.textContent('#dLista .nm')).startsWith(NOMES[ab][0]), `${ab}: "${q}"`);
      }
      await buscaCli(page, '');
      const comTeste = await page.$$eval('#dLista > .cCli .nm, #dLista > .item .nm', els => els.filter(e => /^CLIENTE TESTE/.test(e.textContent)).length);
      assert.ok(comTeste > 1 && comTeste < total, `${ab}: ${comTeste}`);
      await buscaCli(page, 'cliente teste');
      assert.equal((await page.evaluate(LE_CLI)).linhas, comTeste, `${ab}: parte do nome`);
      await buscaCli(page, 'xyz nada');
      const v = await page.evaluate(LE_CLI);
      assert.deepEqual([v.linhas, v.vazio], [0, ['Ninguém neste filtro.']], `${ab}: sem resultado`);
      await buscaCli(page, '');
      assert.equal((await page.evaluate(LE_CLI)).linhas, total, `${ab}: busca vazia = lista inteira`);
      await page.keyboard.press('Escape');
    }
    // Venda Zero: pelo nome do cliente do equipamento
    await page.click('#btnClientes');
    await page.click('#cliKs .dchip[data-k="VENDAZERO"]');
    await page.click('#dLista .dchip[data-d="Todos"]');
    const vz = await page.evaluate(() => { const l = rotasListas().flatMap(r => (VENDAZERO_CLIENTES[r] || []).map(e => e)); return l.length ? l[0] : null; });
    if(vz){
      await buscaCli(page, String(vz.pv));
      const e = await page.evaluate(LE_CLI), esp = await page.evaluate(pv => rotasListas().flatMap(r => VENDAZERO_CLIENTES[r] || [])
        .filter(x => String(x.pv).includes(pv)).length, String(vz.pv));
      assert.equal(e.linhas, esp, 'Venda Zero por PV');
    }
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('busca além do limite da lista: procura na lista inteira; o "+ N clientes" conta só os que casam', async () => {
    const LIM = 4;
    const {page, ctx, erros} = await abre('inc', {entrar: 'dir', largura: 1440, aba: 'ICS_GC',
      troca: {'/js/config.js': t => t.replace(/LIMITE_LISTA:\s*\d+/, `LIMITE_LISTA: ${LIM}`)}});
    // a mesma tela sem limite, para ler a lista inteira
    const sem = await abre('inc', {entrar: 'dir', largura: 1440, aba: 'ICS_GC', troca: {'/js/config.js': CLI_INV.semLimite}});
    assert.equal(await page.evaluate(() => CONFIG.LIMITE_LISTA), LIM);
    const leInteira = async ab => { await filtra(sem.page, {aba: ab}); await sem.page.click('#btnClientes');
      await sem.page.click('#dLista .dchip[data-d="Todos"]');
      const r = await sem.page.evaluate(() => [...document.querySelectorAll('#dLista > .cCli, #dLista > .item')].map(el => {
        const nome = (el.querySelector('.nm .tagOnline') ? el.querySelector('.nm').firstChild.textContent.replace(/ $/, '') : el.querySelector('.nm').firstChild.textContent), rota = el.querySelector('.sb').textContent.match(/· rota (\S+)/)[1];
        return [nome, rota, CLIENT_ROSTER[rota].find(c => c[1] === nome)[0]]; }));
      await sem.page.keyboard.press('Escape'); return r; };
    for(const ab of ['VOLUME', 'ICS_GC']){
      const inteira = await leInteira(ab);
      await filtra(page, {aba: ab});
      await page.click('#btnClientes');
      await page.click('#dLista .dchip[data-d="Todos"]');
      assert.ok(inteira.length > LIM * 3, `${ab}: ${inteira.length}`);
      let e = await page.evaluate(LE_CLI);
      assert.equal(e.linhas, LIM);
      assert.deepEqual(e.vazio, [`+ ${inteira.length - LIM} clientes — filtre por rota para ver todos.`]);
      const [nome, , pv] = inteira[inteira.length - 1];
      await buscaCli(page, String(pv));
      e = await page.evaluate(LE_CLI);
      assert.deepEqual([e.linhas, e.vazio], [1, []], `${ab}: o último da lista inteira pelo PV`);
      assert.equal(await page.evaluate(() => document.querySelector('#dLista .nm').firstChild.textContent.trim()), nome);
      // parte do nome que casa com muitos: o aviso conta só os que casam
      const q = 'cliente teste 100';
      const casam = inteira.filter(([n]) => n.toLowerCase().includes(q)).length;
      assert.ok(casam > LIM && casam < inteira.length, `${ab}: ${casam}`);
      await buscaCli(page, q);
      e = await page.evaluate(LE_CLI);
      assert.deepEqual([e.linhas, e.vazio], [LIM, [`+ ${casam - LIM} clientes — filtre por rota para ver todos.`]], `${ab}: aviso`);
      await page.keyboard.press('Escape');
    }
    assert.deepEqual([...erros, ...sem.erros], []);
    await ctx.close(); await sem.ctx.close();
  });

  test('a busca e o dia continuam ao trocar de agrupador e de dia; reabrir começa do zero', async () => {
    const {page, ctx, erros} = await abre('dias', {entrar: {perfil: 'gc', gc: 'G1'}, largura: 1440, aba: 'ICS_GC'});
    await page.click('#btnClientes');
    let e = await page.evaluate(LE_CLI);
    assert.equal(e.dia, 'Hoje', 'coberturas começam no Hoje, como na cascata');
    const ks = e.ks.map(x => x[0]);
    await page.click('#dLista .dchip[data-d="Ter"]');
    await buscaCli(page, 'cliente teste 10');
    const conta = () => page.evaluate(() => { const casa = buscaCasa(document.getElementById('cliQ').value);
      return [...document.querySelectorAll('#dLista > .item')].every(el => casa(Number(el.querySelector('.bd').textContent.slice(3)),
        (el.querySelector('.nm .tagOnline') ? el.querySelector('.nm').firstChild.textContent.replace(/ $/, '') : el.querySelector('.nm').firstChild.textContent))); });
    for(const k of ks){
      await page.click(`#cliKs .dchip[data-k="${k}"]`);
      e = await page.evaluate(LE_CLI);
      assert.deepEqual([e.q, e.dia], ['cliente teste 10', 'Ter'], k);
      if(k !== 'VENDAZERO') assert.ok(await conta(), `${k}: só os que casam`);
    }
    // trocar o dia mantém a busca
    await page.click(`#cliKs .dchip[data-k="${ks[0]}"]`);
    await page.click('#dLista .dchip[data-d="Qua"]');
    e = await page.evaluate(LE_CLI);
    assert.deepEqual([e.q, e.dia], ['cliente teste 10', 'Qua']);
    assert.ok(await conta());
    const dias = await page.evaluate(() => [...document.querySelectorAll('#dLista > .item .sb')].map(s => s.textContent));
    assert.ok(dias.every(s => /Qua/.test(s)), 'só quem visita na Qua');
    // Volume: o dia escolhido segue para os macros
    await page.keyboard.press('Escape');
    await filtra(page, {aba: 'VOLUME'});
    await page.click('#btnClientes');
    e = await page.evaluate(LE_CLI);
    assert.deepEqual([e.q, e.dia], ['', 'Todos'], 'reabrir: sem busca, o dia padrão do Volume');
    await page.click('#dLista .dchip[data-d="Seg"]');
    await buscaCli(page, 'teste');
    await page.click(`#cliKs .dchip[data-k="${e.ks[1][0]}"]`);
    e = await page.evaluate(LE_CLI);
    assert.deepEqual([e.q, e.dia], ['teste', 'Seg']);
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  for(const largura of [360, 390, 1000, 1440]){
    test(`${largura} px: sem rolagem lateral (abas e gaveta), nada cortado no cabeçalho e na busca, console sem erro`, async () => {
      const {page, ctx, erros} = await abre('inc', {entrar: {perfil: 'gc', gc: 'IT+MO'}, largura, altura: 820, aba: 'VOLUME'});
      for(const ab of ABAS_CLI){
        await filtra(page, {aba: ab});
        assert.ok(await semRolagemLateral(page), `${ab}: rolagem lateral`);
        const cab = await page.evaluate(() => { const b = document.getElementById('btnClientes').getBoundingClientRect(),
          c = document.querySelector('.abCab').getBoundingClientRect(), p = document.getElementById('pilDia').getBoundingClientRect();
          return {dentro: b.left >= c.left - 0.5 && b.right <= c.right + 0.5 && p.right <= c.right + 0.5,
                  corta: [...document.querySelectorAll('.abCab > *')].filter(el => el.scrollWidth > el.clientWidth + 1).length}; });
        assert.deepEqual(cab, {dentro: true, corta: 0}, `${ab}: cabeçalho`);
        await page.click('#btnClientes');
        const g = await page.evaluate(() => { const i = document.getElementById('cliQ'), d = document.getElementById('drw');
          const ri = i.getBoundingClientRect(), rd = d.getBoundingClientRect();
          return {dentro: ri.left >= rd.left && ri.right <= rd.right + 0.5, larg: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
                  corpo: document.getElementById('dCorpo').scrollWidth <= document.getElementById('dCorpo').clientWidth + 1}; });
        assert.deepEqual(g, {dentro: true, larg: true, corpo: true}, `${ab}: gaveta`);
        await page.keyboard.press('Escape');
      }
      assert.deepEqual(erros, []);
      await ctx.close();
    });
  }
});

/* ---------- Parte AI — Executiva: cabeçalho fixo, "Abrir por" e busca (Etapa 5 do pacote v3) ----------
   Cabeçalho da Executiva sticky (PC: no alto do conteúdo; celular: logo abaixo da .barra, pela altura medida dela) com o título,
   os botões "Abrir por" (nível do filtro · Canal · Marca só na Diretoria · Clientes · Key Accounts), a busca e a etiqueta do dia.
   Invariantes dos modos (b)-(f) e da marca em frontend/tests/dimensoes_invariantes.js (as mesmas da conferência com dado real);
   (a) = o antes x depois contra a main antes da etapa (REF_PRE_ABRIR), com o mesmo payload: a Executiva no modo padrão e as
   abas iguais (HTML). Variante 'dim' (montaDim): Meta NEG e Real por cliente nos 5 macros (alguns clientes sem Meta NEG numa
   categoria, um sem nenhuma) e 18 Key Accounts FICTÍCIAS ("KA FICTICIA nn"), cada loja numa só. */
function montaDim(p){
  let n = 0;
  p.REDES_CLIENTE = {};
  for(const r of Object.keys(p.CLIENT_ROSTER)){
    const vc = p.VOLUME_CLIENTE[r] = p.VOLUME_CLIENTE[r] || {};
    for(const c of p.CLIENT_ROSTER[r]){
      const bl = [];
      for(let i = 0; i < 5; i++){
        const meta = (n + i) % 7 === 0 ? 0 : 20 + ((n * 37 + i * 11) % 300);
        const real = meta ? Math.round(meta * (0.4 + ((n + i * 3) % 9) / 10) * 10) / 10 : 5;
        bl.push(n === 1 || (n + i) % 11 === 0 ? null : [meta, real, meta ? Math.round(real / meta * 100) : 0, 0]);
      }
      vc[c[0]] = [...bl, ...((vc[c[0]] || []).slice(5))];      // o Del Valle Frut (6º bloco, G2) fica
      if(n % 3 === 0){
        const nome = `KA FICTICIA ${String((n / 3) % 18).padStart(2, '0')}`, g = (p.REDES_CLIENTE[r] = p.REDES_CLIENTE[r] || {});
        (g[nome] = g[nome] || {nome, clientes: []}).clientes.push(c[0]);
      }
      n++;
    }
  }
}
const DIMI = require('./dimensoes_invariantes.js');
const REF_PRE_ABRIR = '0f6fbfe';
const FRONT_PRE_ABRIR = (() => {
  try {
    const arq = f => execSync(`git show ${REF_PRE_ABRIR}:frontend/${f}`, {cwd: RAIZ, stdio: ['ignore', 'pipe', 'ignore']}).toString();
    const [html, css, js] = ['index.html', 'css/app.css', 'js/app.js'].map(arq);
    return {'/index.html': () => html, '/css/app.css': () => css, '/js/app.js': () => js};
  } catch(e) { return null; }
})();
// posição do cabeçalho da Executiva e da barra; o que está no meio do cabeçalho (nada do conteúdo por trás)
const LE_CAB_EX = () => {
  const b = s => { const el = document.querySelector(s); return el && el.getClientRects().length ? el.getBoundingClientRect() : null; };
  const a = b('#abaTopo'), cs = getComputedStyle(document.getElementById('abaTopo'));
  const dentro = [[0.5, 0.5], [0.05, 0.5], [0.95, 0.5]].map(([x, y]) => { const el = document.elementFromPoint(a.left + a.width * x, a.top + a.height * y);
    return !!el && !!el.closest('#abaTopo'); });
  const pc = matchMedia('(min-width:1000px)').matches;
  return {top: a.top, bottom: a.bottom, h: a.height, left: a.left, right: a.right, barra: pc ? 0 : b('.barra').bottom, pos: cs.position,
    fundo: cs.backgroundColor, sombra: cs.boxShadow, dentro, tit: b('#abTit'), abrir: b('#exAbrir'), campo: b('#exCampo'), lupa: b('#exLupa'),
    dia: b('#pilDia'), wrap: b('.wrap'), scroll: scrollY};
};

describe('Parte AI — Executiva: cabeçalho fixo, "Abrir por" e busca', {skip: pular}, () => {
  for(const largura of [1440, 1000, 390, 360]){
    test(`${largura} px: cabeçalho fixo visível depois de rolar (PC no alto; celular abaixo da barra), sem conteúdo por trás`, async () => {
      const {page, ctx, erros} = await abre('dim', {entrar: 'dir', largura, altura: 800, aba: null});
      const pc = largura >= 1000;
      for(const y of [0, 900, 2400]){
        await page.evaluate(y => scrollTo(0, y), y);
        await page.waitForTimeout(60);
        const c = await page.evaluate(LE_CAB_EX), onde = `${largura} y=${y}`;
        assert.equal(c.pos, 'sticky', onde);
        if(y > 0){
          assert.ok(c.scroll > 0, `${onde}: rolou`);
          assert.ok(Math.abs(c.top - (pc ? 0 : c.barra)) < 1, `${onde}: topo ${c.top} x ${pc ? 0 : c.barra}`);
          assert.deepEqual(c.dentro, [true, true, true], `${onde}: nada do conteúdo por trás do cabeçalho`);
        }
        assert.equal(c.fundo, await page.evaluate(() => { const s = document.createElement('i'); s.style.color = 'var(--papel)';
          document.body.appendChild(s); const x = getComputedStyle(s).color; s.remove(); return x; }), `${onde}: fundo --papel`);
        assert.notEqual(c.sombra, 'none', `${onde}: sombra`);
        // o cabeçalho cobre a largura da .wrap (com a sobra lateral)
        assert.ok(c.left <= c.wrap.left + 0.5 && c.right >= c.wrap.right - 0.5, `${onde}: largura`);
        if(pc){
          // uma linha: título · botões · busca · etiqueta do dia
          const meio = r => (r.top + r.bottom) / 2;
          assert.ok(!c.lupa, `${onde}: no PC, sem a lupa solta`);
          for(const [n, r] of [['botões', c.abrir], ['busca', c.campo], ['etiqueta', c.dia]]) assert.ok(Math.abs(meio(r) - meio(c.tit)) < 6, `${onde}: ${n} na linha do título`);
          assert.ok(c.tit.right <= c.abrir.left && c.abrir.right <= c.campo.left && c.campo.right <= c.dia.left, `${onde}: ordem`);
        } else {
          // linha 1: título · lupa · etiqueta; linha 2: os botões; o campo só com a lupa
          assert.ok(c.lupa && !c.campo, `${onde}: só a lupa`);
          assert.ok(Math.abs(c.lupa.top - c.tit.top) < 12 && c.lupa.right <= c.dia.left + 0.5, `${onde}: lupa na linha 1`);
          assert.ok(c.abrir.top >= c.tit.bottom - 0.5, `${onde}: botões na linha 2`);
        }
      }
      if(!pc){
        // a lupa abre o campo numa linha própria (entre a linha 1 e os botões) e fecha de novo
        await page.click('#exLupa');
        let c = await page.evaluate(LE_CAB_EX);
        assert.ok(c.campo && c.campo.top >= c.tit.bottom - 0.5 && c.abrir.top >= c.campo.bottom - 0.5, 'campo numa linha própria');
        assert.equal(await page.evaluate(() => document.activeElement.id), 'exQ', 'foco no campo');
        assert.equal(await page.getAttribute('#exLupa', 'aria-expanded'), 'true');
        await page.click('#exLupa');
        assert.equal((await page.evaluate(LE_CAB_EX)).campo, null, 'fecha');
        // a altura da barra é medida de novo no resize e na troca de filtro
        await page.setViewportSize({width: largura === 390 ? 360 : 390, height: 800});
        await page.selectOption('#fgc', 'G1');
        await page.evaluate(() => scrollTo(0, 1500));
        await page.waitForTimeout(250);
        c = await page.evaluate(LE_CAB_EX);
        assert.ok(Math.abs(c.top - c.barra) < 1, `depois do resize e do filtro: ${c.top} x ${c.barra}`);
      }
      // fora da Executiva o cabeçalho é o de sempre (sem o bloco novo e sem sticky)
      await vaiAba(page, 'VOLUME');
      assert.deepEqual(await page.evaluate(() => [!!document.getElementById('exFer'), getComputedStyle(document.getElementById('abaTopo')).position]), [false, 'static']);
      assert.ok(await semRolagemLateral(page));
      assert.deepEqual(erros, []);
      await ctx.close();
    });
  }

  test('Parte M continua: cabeçalho até o fim das abas <= 221 px em 390 px, na Executiva', async () => {
    const {page, ctx, erros} = await abre('dim', {entrar: {perfil: 'gc', gc: 'G1'}, largura: 390, aba: null});
    assert.equal(await page.evaluate(() => aba), 'EXEC');
    assert.ok(await page.evaluate(() => document.querySelector('.barra').getBoundingClientRect().bottom) <= LIMITE_CABECALHO_390);
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('cada botão troca os três lugares (Tendência x Meta, gaveta da categoria e Evolução); ≤ 15 por categoria; notas; Sem compra, Agenda e Coberturas iguais; invariantes (b)-(f)', async () => {
    const {page, ctx, erros} = await abre('dim', {entrar: 'dir', largura: 1440, aba: null});
    const linhas = [];
    linhas.push(await DIMI.confereDimensoes(page, 'BAND'));
    await page.selectOption('#fgc', 'G2');
    linhas.push(await DIMI.confereDimensoes(page, 'GC.G2 (Diretoria)'));
    for(const e of [{perfil: 'gc', gc: 'G3'}, {perfil: 'gc', gc: 'IT+MO'}, {perfil: 'sv', gc: 'G1', sv: '1'}]){
      await vaiPara(page, e, null);
      linhas.push(await DIMI.confereDimensoes(page, JSON.stringify(e)));
    }
    // a BAND da variante tem mais de 15 clientes e de 15 Key Accounts com Meta NEG em cada categoria: o corte vale
    for(const k in linhas[0].cats) assert.deepEqual([linhas[0].cats[k].cli, linhas[0].cats[k].ka], [15, 15], `BAND ${k}: 15 maiores`);
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('Marca só na Diretoria, com o aviso (sem números) na Tendência x Meta, na gaveta e na Evolução; entrada volta ao padrão', async () => {
    const {page, ctx, erros} = await abre('dim', {entrar: 'dir', largura: 1440, aba: null});
    const botoes = () => page.$$eval('#exAbrir .fchip', bs => bs.map(b => b.textContent));
    assert.deepEqual(await botoes(), ['Gerência', 'Canal', 'Marca', 'Clientes', 'Key Accounts']);
    await DIMI.clicaAbrir(page, 'marca');
    const t = await page.evaluate(DIMI.LE_DIVS);
    assert.equal(t.aviso, 'Marca: depende da descoberta no Datasphere');
    assert.ok(!/\d/.test(await page.$eval('#exDivs', el => el.textContent)), 'sem números');
    await page.click('#exGauges .gCard[role="button"]');
    const g = await page.evaluate(DIMI.LE_GAV);
    assert.ok(g.aberta && g.aviso && !g.cards.length && /por marca$/.test(g.tit), 'gaveta com o aviso');
    await page.keyboard.press('Escape');
    // filtro de gerência na Diretoria: o 1º botão vira "Supervisão" e a Marca continua
    await page.selectOption('#fgc', 'G1');
    assert.deepEqual(await botoes(), ['Supervisão', 'Canal', 'Marca', 'Clientes', 'Key Accounts']);
    // a casa e uma nova entrada voltam ao padrão; Gerência e Supervisão sem a Marca
    await vaiPara(page, {perfil: 'gc', gc: 'G1'}, null);
    assert.deepEqual(await botoes(), ['Supervisão', 'Canal', 'Clientes', 'Key Accounts']);
    assert.equal(await page.$eval('#exAbrir .fchip.on', b => b.dataset.ab), 'nivel');
    await vaiPara(page, {perfil: 'sv', gc: 'G1', sv: '1'}, null);
    assert.deepEqual(await botoes(), ['Rota', 'Canal', 'Clientes', 'Key Accounts']);
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('(a) modo padrão idêntico à main antes da etapa (mesmo payload): Executiva, gaveta da categoria, Evolução aberta e as 4 abas; depois de passar pelos modos também', {skip: !FRONT_PRE_ABRIR && `sem o commit ${REF_PRE_ABRIR}`}, async () => {
    for(const largura of [1440, 390]){
      const [novo, velho] = [await abre('dim', {entrar: 'dir', largura, aba: null}), await abre('dim', {entrar: 'dir', largura, aba: null, troca: FRONT_PRE_ABRIR})];
      for(const e of [{perfil: 'dir'}, {perfil: 'gc', gc: 'G2'}, {perfil: 'gc', gc: 'IT+MO'}, {perfil: 'sv', gc: 'G3', sv: '1'}]){
        for(const {page} of [novo, velho]) await vaiPara(page, e, null);
        const onde = `${largura} ${JSON.stringify(e)}`;
        const exec = async p => { await p.evaluate(() => document.querySelectorAll('#exEvLinhas .evLin.cat').forEach(el => el.click()));
          const h = await p.innerHTML('#exec'); await p.evaluate(() => document.querySelectorAll('#exEvLinhas .evLin.cat').forEach(el => el.click())); return h; };
        assert.equal(await exec(novo.page), await exec(velho.page), `${onde}: Executiva`);
        assert.equal(await novo.page.textContent('#abTit'), await velho.page.textContent('#abTit'), `${onde}: título`);
        // passa pelos modos e volta: igual de novo
        for(const ab of ['canal', 'cli', 'ka', 'nivel']) await DIMI.clicaAbrir(novo.page, ab);
        assert.equal(await exec(novo.page), await exec(velho.page), `${onde}: Executiva depois dos modos`);
        const k = await novo.page.$eval('#exGauges .gCard[role="button"]', g => g.dataset.k);
        // a gaveta virou tabela na Etapa 6 do pacote v3 (de propósito): os números de cada unidade (cartão de lá, linha daqui), o
        // título e o subtítulo (sem a ordem) iguais
        const gav = async p => { await p.click(`#exGauges .gCard[data-k="${k}"]`);
          const h = await p.evaluate(() => ({tit: dTit.textContent, sub: dSub.textContent.replace(/ · ordenado por .*$/, ''),
            un: [...document.querySelectorAll('#dCorpo .cuCard, #dCorpo .ctLin')].map(c => ['u', 'st', 'meta', 'real', 'tend', 'pct', 'pctTend'].map(x => c.dataset[x]))}));
          await p.keyboard.press('Escape'); return h; };
        assert.deepEqual(await gav(novo.page), await gav(velho.page), `${onde}: gaveta da categoria (números)`);
        for(const ab of ['VOLUME', 'ICS_GC', 'NOVOS_NEG', 'INCENTIVO']){
          for(const {page} of [novo, velho]) await vaiAba(page, ab);
          const tela = p => p.evaluate(() => ({topo: document.getElementById('abaTopo').outerHTML, lista: document.getElementById('lista').innerHTML}));
          assert.deepEqual(await tela(novo.page), await tela(velho.page), `${onde} ${ab}: cabeçalho e cards`);
        }
        for(const {page} of [novo, velho]) await vaiAba(page, 'EXEC');
      }
      assert.deepEqual([novo.erros, velho.erros], [[], []]);
      await novo.ctx.close(); await velho.ctx.close();
    }
  });

  test('busca: por nome, PV e Key Account no filtro atual (sem as ocultas), até 12 sugestões, etiqueta "KEY ACCOUNT"; ficha do cliente e da KA', async () => {
    const {page, ctx, erros} = await abre('dim', {entrar: 'dir', largura: 1440, aba: null});
    const busca = (q) => page.evaluate(q => { const i = document.getElementById('exQ'); i.value = q; i.dispatchEvent(new Event('input')); }, q);
    const sug = () => page.$$eval('#exSug .sugItem', els => els.map(e => ({nm: e.querySelector('.nm').childNodes[0].textContent,
      tag: (e.querySelector('.tagRedeSug') || {}).textContent || '', meta: e.querySelector('.meta').textContent,
      caixa: e.querySelector('.tagRedeSug') ? getComputedStyle(e.querySelector('.tagRedeSug')).textTransform : ''})));
    // nome (sem acento e sem diferença de maiúsculas): no máximo 12
    await busca('cliente teste');
    let s = await sug();
    assert.equal(s.length, 12, 'até 12 sugestões');
    // Key Account: etiqueta e "N lojas"; no máximo 4 KAs antes dos clientes
    await busca('fictícia');
    s = await sug();
    assert.ok(s.length === 12 && s.every(x => x.tag === 'Key Account' && x.caixa === 'uppercase' && /^\d+ lojas?$/.test(x.meta)), 'KAs com a etiqueta');
    // PV: o cliente
    const alvo = await page.evaluate(() => { const r = rotasListas().find(r => (CLIENT_ROSTER[r] || []).length > 1); const c = CLIENT_ROSTER[r][1];
      return {r, pv: c[0], nome: c[1], seg: SEGS[c[2]], dia: DIAS[c[3]], kstt: ['LANCHONETE', 'RESTAURANTE', 'BOTECO', 'PADARIAS'].includes(SEGS[c[2]].toUpperCase())}; });
    await busca(String(alvo.pv));
    s = await sug();
    assert.deepEqual(s[0], {nm: alvo.nome, tag: '', meta: `PV ${alvo.pv} · rota ${alvo.r}`, caixa: ''});
    // ocultas fora: um cliente da SV.G3.3 (rota 331) não aparece; filtro de gerência: só os dela
    const pv331 = await page.evaluate(() => CLIENT_ROSTER['331'][0][0]);
    await busca(String(pv331));
    assert.ok(!(await sug()).some(x => x.meta.includes('rota 331')), 'oculta fora da busca');
    await page.selectOption('#fgc', 'G1');
    await busca('cliente teste');
    assert.ok((await sug()).every(x => /rota G1/.test(x.meta)), 'só a G1');
    await page.selectOption('#fgc', '');
    // ficha do cliente: título, subtítulo, 5 cartões sem a Tendência, quadrinhos de ICS GC e Novos Negócios
    await busca(String(alvo.pv));
    await page.click('#exSug .sugItem');
    let f = await page.evaluate(() => ({aberta: document.getElementById('drw').classList.contains('on'), tit: dTit.textContent, sub: dSub.textContent,
      secs: [...document.querySelectorAll('#dCorpo .fxSec')].map(h => h.textContent), b2: document.querySelectorAll('#dCorpo .cuB2').length,
      cards: [...document.querySelectorAll('#dCorpo .cuCard')].map(c => ({u: c.dataset.u, st: c.dataset.st, meta: c.dataset.meta, real: c.dataset.real,
        cls: c.className, vals: c.querySelector('.cuVals').textContent.replace(/\s+/g, ' ').trim()})),
      ics: [...document.querySelectorAll('#dCorpo .fxCob[data-g="ICS_GC"] .tile')].map(t => [t.className, t.querySelector('.e').textContent]),
      nn: document.querySelectorAll('#dCorpo .fxCob[data-g="NOVOS_NEG"] .tile').length}));
    const esp = await page.evaluate(a => ({bl: P.VOLUME_CLIENTE[a.r][a.pv].slice(0, 5), ka: Object.values(P.REDES_CLIENTE[a.r] || {}).find(g => g.clientes.includes(a.pv)),
      rot: GROUPS.VOLUME.map(rotuloInd), nIcs: P.COV_GRUPO.ICS_GC.length, nNn: P.COV_GRUPO.NOVOS_NEG.length}), alvo);
    assert.ok(f.aberta);
    assert.equal(f.tit, alvo.nome);
    assert.equal(f.sub, [`PV ${alvo.pv}`, alvo.seg, `rota ${alvo.r}`, `visita ${alvo.dia}`, esp.ka ? esp.ka.nome : ''].filter(Boolean).join(' · '));
    assert.deepEqual(f.secs, ['Volume do mês', 'ICS GC', 'Novos Negócios']);
    assert.equal(f.b2, 0, 'sem a barra de tendência');
    assert.deepEqual(f.cards.map(c => c.u), esp.rot, 'um cartão por categoria');
    f.cards.forEach((c, i) => { const b = esp.bl[i];
      if(b && b[0] > 0){ assert.deepEqual([Number(c.meta), Number(c.real), c.st], [b[0], b[1], b[1] >= b[0] ? 'bat' : 'abx'], c.u); assert.match(c.vals, /^Meta NEG /, c.u); }
      else { assert.equal(c.st, 'semneg', c.u); assert.match(c.cls, /\bcuSemNeg\b/); assert.match(c.vals, /^Meta NEG — Real /, c.u); } });
    assert.equal(f.ics.length, esp.nIcs);
    assert.equal(f.nn, esp.nNn);
    const ks = f.ics[P_KSTT_IDX(await page.evaluate(() => P.COV_GRUPO.ICS_GC))];
    assert.deepEqual(ks[1] === 'não elegível', !alvo.kstt, 'KS TT fora dos 4 segmentos = não elegível');
    await page.keyboard.press('Escape');
    // cliente sem Meta NEG em nenhuma categoria: os 5 cartões cinza
    const sem = await page.evaluate(() => { for(const r of rotasListas()) for(const c of CLIENT_ROSTER[r] || []){ const b = (P.VOLUME_CLIENTE[r] || {})[c[0]];
      if(b && b.slice(0, 5).every(x => !x || !(x[0] > 0))) return c[0]; } return null; });
    assert.ok(sem, 'a variante tem um cliente sem Meta NEG');
    await busca(String(sem));
    await page.click('#exSug .sugItem');
    assert.deepEqual(await page.$$eval('#dCorpo .cuCard', cs => cs.map(c => c.dataset.st)), Array(5).fill('semneg'));
    // faixa cinza neutra (não vermelha nem verde)
    const faixa = await page.$eval('#dCorpo .cuCard', c => getComputedStyle(c).borderLeftColor);
    assert.equal(faixa, await page.evaluate(() => { const s = document.createElement('i'); s.style.color = 'var(--linha-forte)'; document.body.appendChild(s);
      const x = getComputedStyle(s).color; s.remove(); return x; }));
    await page.keyboard.press('Escape');
    // ficha da Key Account: "Key Account · N lojas no filtro atual", soma das lojas, "x/y lojas"
    await busca('KA FICTICIA 03');
    await page.click('#exSug .sugItem');
    const kaEsp = await page.evaluate(() => { const ms = []; for(const r of rotasListas()){ const g = (P.REDES_CLIENTE[r] || {})['KA FICTICIA 03']; if(g) g.clientes.forEach(pv => ms.push([r, pv])); }
      const soma = i => ms.reduce((s, [r, pv]) => { const b = (P.VOLUME_CLIENTE[r] || {})[pv]; const x = b && b[i]; return x ? [s[0] + x[0], s[1] + x[1]] : s; }, [0, 0]);
      return {n: ms.length, vol: GROUPS.VOLUME.map((k, i) => soma(i))}; });
    f = await page.evaluate(() => ({tit: dTit.textContent, sub: dSub.textContent,
      cards: [...document.querySelectorAll('#dCorpo .cuCard')].map(c => [Number(c.dataset.meta) || 0, Number(c.dataset.real) || 0]),
      tiles: [...document.querySelectorAll('#dCorpo .fxCob .tile .e')].map(e => e.textContent)}));
    assert.deepEqual([f.tit, f.sub], ['KA FICTICIA 03', `Key Account · ${kaEsp.n} lojas no filtro atual`]);
    f.cards.forEach((c, i) => { if(kaEsp.vol[i][0] > 0){ assert.ok(Math.abs(c[0] - kaEsp.vol[i][0]) < 1e-6 && Math.abs(c[1] - kaEsp.vol[i][1]) < 1e-6, `KA ${i}`); } });
    assert.ok(f.tiles.every(t => /^\d+\/\d+ lojas$|^não elegível$|^sem venda$/.test(t)), 'x/y lojas');
    // a ficha usa só classes de conteúdo (novas ou existentes); o cromo da gaveta é o de sempre (Parte N)
    const cls = await page.evaluate(() => [...new Set([...document.querySelectorAll('#dCorpo *')].flatMap(el => [...el.classList]))]);
    const OK = new Set(['fxFicha', 'fxSec', 'cuGav', 'cuGrade', 'cuCard', 'cuBat', 'cuAbx', 'cuFech', 'cuSemNeg', 'cuCab', 'cuNome', 'cuSub', 'cuPct',
      'cuVals', 'cuBar', 'cuB1', 'cuRot', 'cuTr', 'cuVal', 'cuNota', 'grid13', 'fxCob', 'tile', 'ok', 'no', 'na', 'nd', 'parcial', 't', 'e']);
    assert.deepEqual(cls.filter(c => !OK.has(c)), [], 'classes da ficha');
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  for(const largura of [360, 390, 1000, 1440]){
    test(`${largura} px: cada modo, a gaveta e a ficha sem rolagem lateral nem texto cortado no cabeçalho; nomes com a largura do pedido; console sem erro`, async () => {
      const {page, ctx, erros} = await abre('dim', {entrar: 'dir', largura, altura: 820, aba: null});
      await medidas(page);
      for(const ab of ['nivel', 'canal', 'marca', 'cli', 'ka']){
        await DIMI.clicaAbrir(page, ab);
        assert.ok(await semRolagemLateral(page), `${ab}: rolagem lateral`);
        assert.deepEqual(await page.evaluate(() => __vis.estouros('#abaTopo .abCab > :not(.exFer), #exTDiv, #exSDiv')), [], `${ab}: cortes`);
        if(ab === 'canal' || ab === 'cli' || ab === 'ka'){
          const w = await page.$eval('#exDivs .dv.sel .dRow .dNome', el => el.getBoundingClientRect().width);
          assert.ok(Math.abs(w - (ab === 'canal' ? 96 : 118)) < 1, `${ab}: largura do nome ${w}`);
          assert.equal(await page.$eval('#exDivs .dv.sel .dRow .dNome', el => getComputedStyle(el).textOverflow), 'ellipsis');
        }
        if(ab !== 'nivel'){
          await page.click('#exGauges .gCard[role="button"]');
          await page.waitForTimeout(260);
          assert.ok(await page.evaluate(() => document.getElementById('dCorpo').scrollWidth <= document.getElementById('dCorpo').clientWidth + 1), `${ab}: gaveta`);
          await page.keyboard.press('Escape');
        }
      }
      if(largura < 1000) await page.click('#exLupa');
      await page.fill('#exQ', 'fictícia');
      assert.ok(await semRolagemLateral(page), 'sugestões');
      const sg = await page.evaluate(() => { const b = document.getElementById('exSug').getBoundingClientRect(); return b.left >= -0.5 && b.right <= innerWidth + 0.5; });
      assert.ok(sg, 'sugestões dentro da tela');
      await page.click('#exSug .sugItem');
      await page.waitForTimeout(260);
      assert.ok(await page.evaluate(() => document.getElementById('dCorpo').scrollWidth <= document.getElementById('dCorpo').clientWidth + 1), 'ficha');
      assert.ok(await semRolagemLateral(page));
      assert.deepEqual(erros, []);
      await ctx.close();
    });
  }
});
// posição do KS TT no grupo ICS GC (a ficha mostra os quadrinhos na ordem do grupo)
function P_KSTT_IDX(ics){ return ics.indexOf('KS TT'); }

/* ---------- Parte AJ — Executiva: tabela da categoria (selo, Online) e escopo do nível acima (Etapa 6 do pacote v3) ----------
   O botão de escopo fica no cabeçalho fixo da Executiva, antes do "Abrir por": Gerência "GC.<dela> | BAND" (grupo: "GC.IT + GC.MO
   | BAND"), Supervisão "SV.<dela> | GC.<dela>"; Diretoria e Rota sem ele. Com o nível de cima marcado a Executiva inteira (KPIs,
   quadros, medidores, Tendência x Meta, Sem compra, Agenda, Coberturas, Evolução e a gaveta da categoria) é a da Diretoria "Todas"
   (BAND) ou a da Gerência da mesma gerência (GC): o mesmo HTML. As outras abas, o Resumo, o Painel de Ritmo e o acesso guardado
   continuam no acesso; o filtro lateral de supervisão/rota não altera a Executiva no nível de cima; cada entrada começa no
   escopo do acesso. A tabela da gaveta tem as invariantes de categoria_invariantes.js (Parte AC), conferidas aqui no escopo de
   cima também. */
const LE_ESC = () => { const b = document.getElementById('exEsc');
  return {no: !!b && !!b.closest('#abaTopo'), hidden: !b || b.hidden, traco: !!document.querySelector('#abaTopo .exTraco:not([hidden])'),
    bts: b ? [...b.querySelectorAll('.fchip')].map(x => [x.textContent, x.getAttribute('aria-pressed'), x.classList.contains('on')]) : []}; };
const clicaEsc = (page, i) => page.evaluate(i => document.querySelector(`#exEsc .fchip[data-esc="${i}"]`).click(), i);
const htmlExec = page => page.innerHTML('#exec');
const gavetaCat = async (page, k) => { await page.click(`#exGauges .gCard[data-k="${k}"]`); await page.mouse.move(1, 1);
  const h = await page.innerHTML('#drw'); await page.keyboard.press('Escape'); return h; };
// cabeçalho, cards e #sub de uma aba (atributos em ordem alfabética: a ordem do DOM depende do histórico de hidden/data-*)
const telaAba = (page, ab) => page.evaluate(ab => { document.querySelector(`.tab[data-g="${ab}"]`).click();
  const canon = n => n.nodeType === 3 ? n.data : n.nodeType !== 1 ? '' : `<${n.localName}${[...n.attributes].map(a => ` ${a.name}="${a.value}"`).sort().join('')}>` +
    [...n.childNodes].map(canon).join('') + `</${n.localName}>`;
  return {topo: canon(document.getElementById('abaTopo')), lista: canon(document.getElementById('lista')), sub: canon(document.getElementById('sub'))}; }, ab);

describe('Parte AJ — Executiva: tabela da categoria e escopo do nível acima', {skip: pular}, () => {
  test('Gerência: botão "GC.G1 | BAND"; BAND = Diretoria "Todas" (Executiva e gaveta iguais); outras abas, Resumo, Ritmo e o acesso guardado no acesso; filtro lateral não altera; nova entrada volta ao escopo do acesso', async () => {
    const {page, ctx, erros} = await abre('vol5', {entrar: 'dir', aba: null, largura: 1440});
    await variaCat(page);
    assert.deepEqual(await page.evaluate(LE_ESC), {no: true, hidden: true, traco: false, bts: []}, 'Diretoria sem o botão');
    const dir = {exec: await htmlExec(page), gav: await gavetaCat(page, 'VOL REFRIGERANTES')};
    await vaiPara(page, {perfil: 'gc', gc: 'G1'}, null);
    assert.deepEqual(await page.evaluate(LE_ESC), {no: true, hidden: false, traco: true, bts: [['GC.G1', 'true', true], ['BAND', 'false', false]]});
    // títulos dos botões: os nomes inteiros
    assert.deepEqual(await page.$$eval('#exEsc .fchip', bs => bs.map(b => b.title)), ['GC.G1 · Goiânia 01', 'BAND · todas as gerências']);
    const g1 = {exec: await htmlExec(page), gav: await gavetaCat(page, 'VOL REFRIGERANTES'), sessao: await page.evaluate(() => localStorage.getItem('drotas_sessao')),
      abas: {}, ritmo: await page.evaluate(() => JSON.stringify(RT.escopoRitmo()))};
    for(const ab of ['VOLUME', 'ICS_GC', 'NOVOS_NEG', 'INCENTIVO']) g1.abas[ab] = await telaAba(page, ab);
    await page.click('#btnResumo');
    g1.resumo = await page.innerHTML('#rsFolha');
    await page.click('#rsVoltar');
    await vaiAba(page, 'EXEC');
    assert.equal(await htmlExec(page), g1.exec, 'de volta à Executiva, no escopo do acesso');
    // BAND: a Executiva e a gaveta da categoria da Diretoria "Todas"
    await clicaEsc(page, 1);
    assert.deepEqual((await page.evaluate(LE_ESC)).bts, [['GC.G1', 'false', false], ['BAND', 'true', true]]);
    assert.equal(await page.evaluate(() => document.activeElement.dataset.esc), '1', 'o foco fica no botão');
    assert.equal(await htmlExec(page), dir.exec, 'BAND = Diretoria "Todas"');
    assert.equal(await gavetaCat(page, 'VOL REFRIGERANTES'), dir.gav, 'gaveta da categoria = a da Diretoria');
    assert.deepEqual(await page.$$eval('#exAbrir .fchip', bs => bs.map(b => b.textContent)), ['Gerência', 'Canal', 'Clientes', 'Key Accounts'],
      '"Abrir por" pelo nível (Marca só na Diretoria)');
    assert.deepEqual(await page.evaluate(() => [document.querySelector('.tab[data-g="EXEC"] span').textContent, document.getElementById('abTit').textContent]),
      ['Gerencial', 'Gerencial'], 'o nome da aba continua o do perfil');
    // invariantes da tabela no escopo de cima (BAND)
    const r = await CAT.confereCategoria(page, 'G1 em BAND', {ordena: false});
    assert.equal(r.cats['VOL REFRIGERANTES'].n, await page.evaluate(() => gcsComDados().length), 'uma linha por gerência');
    assert.equal(await page.evaluate(() => ctxInicial().nivel), 'gc');
    await page.evaluate(() => { catExec = 'VOL REFRIGERANTES'; render(); });     // a conferência passou pelas 5 categorias
    // outras abas, Resumo, Painel de Ritmo e o acesso guardado: no acesso (GC.G1)
    for(const ab of ['VOLUME', 'ICS_GC', 'NOVOS_NEG', 'INCENTIVO']) assert.deepEqual(await telaAba(page, ab), g1.abas[ab], `${ab}: no acesso`);
    await page.click('#btnResumo');
    assert.equal(await page.innerHTML('#rsFolha'), g1.resumo, 'Resumo no acesso');
    await page.click('#rsVoltar');
    assert.equal(await page.evaluate(() => JSON.stringify(RT.escopoRitmo())), g1.ritmo, 'Painel de Ritmo no acesso');
    assert.equal(await page.evaluate(() => localStorage.getItem('drotas_sessao')), g1.sessao, 'acesso guardado igual');
    // de volta à Executiva: o escopo marcado continua (BAND)
    await vaiAba(page, 'EXEC');
    assert.equal(await htmlExec(page), dir.exec, 'BAND mantido ao voltar à Executiva');
    // filtro lateral de supervisão: não altera a Executiva em BAND; vale ao voltar para GC.G1
    await page.selectOption('#fsv', 'SV.G1.1');
    assert.equal(await htmlExec(page), dir.exec, 'filtro lateral não altera a Executiva em BAND');
    await clicaEsc(page, 0);
    assert.equal(await page.$eval('#exAbrir .fchip', b => b.textContent), 'Rota', 'GC.G1 com a supervisão do filtro: por rota');
    await page.selectOption('#fsv', '');
    assert.equal(await htmlExec(page), g1.exec, 'GC.G1 sem filtro = o de antes');
    // nova entrada (casa): começa no escopo do acesso
    await clicaEsc(page, 1);
    await vaiPara(page, {perfil: 'gc', gc: 'G1'}, null);
    assert.deepEqual((await page.evaluate(LE_ESC)).bts.map(b => b[1]), ['true', 'false'], 'nova entrada: GC.G1');
    assert.equal(await htmlExec(page), g1.exec);
    // reabrir a página (acesso guardado) também começa no escopo do acesso
    await clicaEsc(page, 1);
    await page.reload();
    await esperaCarga(page);
    assert.deepEqual((await page.evaluate(LE_ESC)).bts.map(b => b[1]), ['true', 'false'], 'reabrir: GC.G1');
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('grupo: "GC.IT + GC.MO | BAND"; Supervisão: "SV.G2.1 | GC.G2" e GC = Gerência G2 (Executiva e gaveta iguais; outras abas na supervisão); Rota sem a Executiva', async () => {
    let {page, ctx, erros} = await abre('grupo', {entrar: {perfil: 'gc', gc: 'IT+MO'}, aba: null, largura: 1440});
    assert.deepEqual((await page.evaluate(LE_ESC)).bts, [['GC.IT + GC.MO', 'true', true], ['BAND', 'false', false]]);
    await page.evaluate(() => { document.querySelector('.tab[data-g="EXEC"]').click(); });
    const dirG = await (async () => { await clicaEsc(page, 1); const h = await htmlExec(page); await clicaEsc(page, 0); return h; })();
    // Supervisão de uma gerência do grupo: GC = a gerência dela (GC.MO), não o grupo
    await vaiPara(page, {perfil: 'gc', gc: 'IT+MO'}, null);
    await page.selectOption('#fgc', 'MO');
    const gavMo = await gavetaCat(page, 'VOL REFRIGERANTES');
    const mo = {gav: gavMo, exec: await htmlExec(page)};
    await vaiPara(page, {perfil: 'sv', gc: 'MO', sv: '1'}, null);
    assert.deepEqual((await page.evaluate(LE_ESC)).bts, [['SV.MO.1', 'true', true], ['GC.MO', 'false', false]]);
    await clicaEsc(page, 1);
    assert.equal(await htmlExec(page), mo.exec, 'SV.MO.1 em GC = Gerência MO');
    assert.equal(await gavetaCat(page, 'VOL REFRIGERANTES'), mo.gav, 'gaveta = a da Gerência MO');
    // a Gerência do grupo em BAND = a Diretoria "Todas" deste payload
    await page.click('#btnCasa');
    await entra(page, 'dir', null);
    assert.equal(await htmlExec(page), dirG, 'grupo em BAND = Diretoria "Todas"');
    assert.deepEqual(erros, []);
    await ctx.close();
    ({page, ctx, erros} = await abre('vol5', {entrar: {perfil: 'gc', gc: 'G2'}, aba: null, largura: 1440}));
    await variaCat(page);
    const gav2 = await gavetaCat(page, 'VOL AGUA MINERAL');      // (escolhe a categoria em análise: Água Mineral)
    const g2 = {gav: gav2, exec: await htmlExec(page)};
    await vaiPara(page, {perfil: 'sv', gc: 'G2', sv: '1'}, null);
    assert.deepEqual((await page.evaluate(LE_ESC)).bts, [['SV.G2.1', 'true', true], ['GC.G2', 'false', false]]);
    const sv = {exec: await htmlExec(page), abas: {}};
    for(const ab of ['VOLUME', 'ICS_GC', 'NOVOS_NEG', 'INCENTIVO']) sv.abas[ab] = await telaAba(page, ab);
    await vaiAba(page, 'EXEC');
    await clicaEsc(page, 1);
    assert.equal(await htmlExec(page), g2.exec, 'SV.G2.1 em GC = Gerência G2');
    assert.equal(await gavetaCat(page, 'VOL AGUA MINERAL'), g2.gav, 'gaveta = a da Gerência G2');
    assert.equal(await page.$eval('.tab[data-g="EXEC"] span', s => s.textContent), 'Supervisão');
    await CAT.confereCategoria(page, 'SV.G2.1 em GC', {ordena: false});
    await page.evaluate(() => { catExec = 'VOL AGUA MINERAL'; render(); });
    for(const ab of ['VOLUME', 'ICS_GC', 'NOVOS_NEG', 'INCENTIVO']) assert.deepEqual(await telaAba(page, ab), sv.abas[ab], `${ab}: na supervisão`);
    await vaiAba(page, 'EXEC');
    // de volta para SV.G2.1: o de antes
    await clicaEsc(page, 0);
    assert.equal(await htmlExec(page), sv.exec);
    // Rota: sem a Executiva (e sem o cabeçalho fixo)
    await vaiPara(page, {perfil: 'rota', gc: 'G2', rota: 'G211'}, null);
    assert.deepEqual(await page.evaluate(() => [document.querySelector('.tab[data-g="EXEC"]').hidden, !!document.querySelector('#abaTopo #exEsc'), aba]),
      [true, false, 'VOLUME']);
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  test('tabela: selo "✓ Meta batida" com Real + Online >= Meta (caso forçado; Real < Meta mantém o status pela tendência); Online verde/vermelho pela meta do dia; sem cor sem meta do dia; total fixo ao reordenar', async () => {
    const {page, ctx, erros} = await abre('vol5', {entrar: {perfil: 'gc', gc: 'G1'}, aba: null, largura: 1440});
    const k = 'VOL REFRIGERANTES';
    const rs = await page.evaluate(() => ({s1: rotasNormais('G1', 'SV.G1.1'), s2: rotasNormais('G1', 'SV.G1.2')}));
    await fixaCat(page, k, rs.s1, 0.9, 1.1);       // Real 90%: âmbar
    await fixaCat(page, k, rs.s2, 0.5, 0.8);       // Real 50%: vermelho
    // SV.G1.1: online de 15% da meta (Real + Online = 105%) e meta do dia de 10% (online acima); SV.G1.2: online de 1% e meta
    // do dia de 10% (abaixo); a Neutraliza sem meta do dia
    await page.evaluate(([k, s1, s2]) => {
      ONLINE = ONLINE || {}; ONLINE.volume = ONLINE.volume || {};
      const poe = (rs, fo, fm) => rs.forEach(r => { const b = nodo('', r).indicators[k]; (ONLINE.volume[r] = ONLINE.volume[r] || {})[k] = b.meta * fo; b.metaDia = b.meta * fm; });
      poe(s1, 0.15, 0.1); poe(s2, 0.01, 0.1);
      nodo('', '151').indicators[k].metaDia = null;
      render(); }, [k, rs.s1, rs.s2]);
    await abreCat(page, k);
    await page.mouse.move(1, 1);
    const g = await page.evaluate(CAT.LE_GAVETA), c = u => g.linhas.find(x => x.u === u);
    const s1 = c('SV.G1.1'), s2 = c('SV.G1.2'), cores = await page.evaluate(CAT.CORES);
    assert.ok(s1.real < s1.meta && s1.real + s1.onl >= s1.meta, 'caso forçado');
    assert.deepEqual([s1.bat, s1.selo, s1.st, /\bctBat\b/.test(s1.cls), s1.bg], [true, '✓ Meta batida', 'tend', true, cores.batBg], 'selo com Real + Online');
    assert.deepEqual([s1.onlCls, s1.corOnl], ['ctOnl ok', cores.verdeE], 'online acima da meta do dia: verde');
    assert.deepEqual([s2.bat, s2.selo, s2.st, s2.onlCls, s2.corOnl], [false, null, 'abx', 'ctOnl no', cores.vermelho2], 'sem selo; online abaixo: vermelho');
    // a ordem por Online (decrescente) e por Faltam; o total fica no topo; "Neutraliza" no fim
    let r = await CAT.clicaOrd(page, 'onl');
    assert.ok(r.linhas[0].tot && r.linhas[1].u === 'SV.G1.1' && r.linhas[r.linhas.length - 1].u === 'Neutraliza', r.linhas.map(x => x.u).join());
    r = await CAT.clicaOrd(page, 'onl');
    assert.ok(r.linhas[0].tot && r.linhas[1].u === 'SV.G1.2', 'online crescente');
    r = await CAT.clicaOrd(page, 'falt');
    assert.ok(r.linhas[0].tot && r.linhas[1].u === 'SV.G1.2', 'mais falta primeiro');
    assert.deepEqual(r.linhas.slice(1).map(x => x.n), r.linhas.slice(1).map((x, i) => String(i + 1)), 'numeração segue a ordem');
    // dica com o online e a meta do dia
    assert.match(s1.dica, /Online <b>[\d.]+<\/b> · meta do dia [\d.]+/);
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  for(const largura of [360, 390, 1000, 1440])
  test(`${largura} px, fundos preto e branco: botão de escopo (PC: na linha do título, antes do "Abrir por", com o traço; celular: linha própria), sem rolagem lateral; gaveta em BAND sem rolagem; abas da barra iguais (Parte M)`, async () => {
    for(const tema of ['preta', 'branca']){
      const {page, ctx, erros} = await abre('vol5', {entrar: {perfil: 'gc', gc: 'G1'}, aba: null, largura, altura: 900, armazenado: {drotas_entrada: tema}});
      for(const e of [{perfil: 'gc', gc: 'G1'}, {perfil: 'sv', gc: 'G2', sv: '1'}]){
        await vaiPara(page, e, null);
        const onde = `${largura} ${tema} ${e.perfil}`;
        const m = await page.evaluate(() => { const b = s => { const el = document.querySelector(s); return el && el.getClientRects().length ? el.getBoundingClientRect().toJSON() : null; };
          return {tit: b('#abTit'), esc: b('#exEsc'), traco: b('.exTraco'), abrir: b('#exAbrir'), barra: b('.barra')}; });
        const meio = r => (r.top + r.bottom) / 2;
        assert.ok(m.esc, `${onde}: botão à vista`);
        if(largura >= 1000){
          assert.ok(Math.abs(meio(m.esc) - meio(m.tit)) < 6 && m.esc.right <= m.traco.left && m.traco.right <= m.abrir.left, `${onde}: título · escopo | Abrir por`);
        } else {
          assert.equal(m.traco, null, `${onde}: sem o traço no celular`);
          assert.ok(m.esc.top >= m.tit.bottom - 1 && m.esc.bottom <= m.abrir.top + 1, `${onde}: linha própria entre o título e o "Abrir por"`);
        }
        assert.ok(await semRolagemLateral(page), `${onde}: rolagem lateral`);
        await clicaEsc(page, 1);
        assert.ok(await semRolagemLateral(page), `${onde}: rolagem lateral no nível acima`);
        await page.click('#exGauges .gCard[role="button"]');
        await page.waitForTimeout(260);
        assert.deepEqual(await page.evaluate(CAT.CORTES_CAT), [], `${onde}: gaveta`);
        assert.ok(await semRolagemLateral(page), `${onde}: gaveta sem rolagem lateral`);
        await page.keyboard.press('Escape');
      }
      assert.deepEqual(erros, [], `${largura} ${tema}`);
      await ctx.close();
    }
  });
});
