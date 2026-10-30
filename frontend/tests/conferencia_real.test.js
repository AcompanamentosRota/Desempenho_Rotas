/* Conferência automática da aba Executiva com DADO REAL (Etapa 5; invariantes da seção 7 do pacote de implementação).
   Só roda quando as variáveis de ambiente PAYLOAD_REAL e ONLINE_REAL apontam para os JSONs (uma cópia FORA do
   repositório, ex.: `git show origin/main:frontend/data/payload.json > /tmp/real/payload.json`, idem online.json); sem
   elas, pula sem falhar:

       PAYLOAD_REAL=/tmp/real/payload.json ONLINE_REAL=/tmp/real/online.json node --test frontend/tests/conferencia_real.test.js

   Precisa do pacote "playwright" (local, NODE_PATH ou global) e do Chromium dele. Os arquivos do front são servidos por
   interceptação (sem servidor), com os dois JSONs no lugar de data/. Escopos: a Diretoria, cada gerência com dados (filtro
   da Diretoria), cada grupo de gerências no Total (perfil Gerência) e uma supervisão (perfil Supervisão). As invariantes
   (KPIs = cards das abas, desvio do total = Tendência / Meta - 1 do card de Volume, % da linha de total das coberturas =
   cards do ICS GC / Novos Negócios / Todos a Bordo, Status, somas e "restam" de Sem compra e Agenda, gaveta Sem compra)
   estão em executiva_invariantes.js. Imprime uma tabela-resumo (só totais e códigos; nada de clientes).
   Gavetas com barra de dias (Etapa 6; invariantes em gavetas_invariantes.js): a Diretoria, G1, G2, AP, o grupo IT+MO no
   Total e uma supervisão, cada chip contra a recontagem do payload e do online e as contagens contra os cards; e, em cada
   gerência (e gerência do grupo), supervisão, "Neutraliza" e rota, o "Hoje" e o "Todos" das duas gavetas contra os cards
   (o "Todos" do Sem compra = semCompra). Sem rolagem lateral nem erro no console em 360, 390, 1000 e 1440 px, nos dois
   fundos da entrada.
   Evolução contra o mês anterior (barras pareadas; invariantes em evolucao_invariantes.js): a Diretoria, cada gerência com
   dados (filtro da Diretoria), cada grupo no Total e uma supervisão, com todas as categorias abertas: Real e Meta de cada
   linha = medidor (e agrega() das unidades); % atual e anterior; Δ p.p. com o sinal exato; Σ unidades abertas + rotas fora
   delas (virtuais, "{GC}-EV", ocultas) = total; BAND = MES_ANTERIOR.ROTAS inteira; sem meta anterior = "—"; largura das
   barras = % (até 100). Pula o bloco se o payload não tiver MES_ANTERIOR. Antes x depois contra a main antes do redesenho
   (REF_PRE_EVO), com o mesmo payload: cards, cabeçalho, cascata, Resumo e a Executiva sem o bloco iguais.
   Gaveta "Categoria por unidade" (tocar num medidor; invariantes (a)-(f) em categoria_invariantes.js, as mesmas da Parte AC):
   a Diretoria, cada gerência, cada grupo no Total e uma supervisão, nas 5 categorias; 360, 390, 1000 e 1440 px nos dois fundos
   sem rolagem lateral nem texto cortado; antes x depois contra a main antes da etapa (REF_PRE_CAT), com o mesmo payload.
   Resumo de vendas, bloco "Todos a Bordo 3.0" (invariantes (a)-(d) em resumo_tab_invariantes.js, as mesmas da Parte AF): a
   Diretoria, cada gerência com dados (filtro da Diretoria), cada grupo no Total e uma supervisão, em 1440 e 390 px; e o antes x
   depois contra a main antes do bloco (REF_PRE_TAB), com o mesmo payload: Resumo sem o bloco (padrão e com Novos Negócios),
   Executiva, cards das 4 abas e o 1º nível da cascata iguais (HTML). */
'use strict';
const {test, before, after, describe} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {execSync} = require('node:child_process');
const {confereExecutiva} = require('./executiva_invariantes.js');
const {confereGavetas, leChips} = require('./gavetas_invariantes.js');
const {confereEvolucao, ABRE_TODAS} = require('./evolucao_invariantes.js');
const ROT = require('./rotulos_invariantes.js');
const {confereResumoTab} = require('./resumo_tab_invariantes.js');
const CASC_INV = require('./cascata_invariantes.js');
const {trocaHash, trocaLiberadas, digitaSenha, trocaNomes} = require('./senha_teste.js');

const FRONT = path.resolve(__dirname, '..');
const PAYLOAD = process.env.PAYLOAD_REAL, ONLINE = process.env.ONLINE_REAL;

function carregaPlaywright(){
  try { return require('playwright'); } catch(e) { /* tenta o global */ }
  try { return require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); } catch(e) { return null; }
}
const pw = (PAYLOAD && ONLINE) ? carregaPlaywright() : null;
const pular = !(PAYLOAD && ONLINE) ? 'sem PAYLOAD_REAL e ONLINE_REAL (conferência com dado real só sob demanda)'
  : !(fs.existsSync(PAYLOAD) && fs.existsSync(ONLINE)) ? 'PAYLOAD_REAL ou ONLINE_REAL não existe'
  : !pw ? 'Playwright não instalado' : false;

const TIPOS = {'.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json',
  '.png':'image/png', '.woff2':'font/woff2', '.webmanifest':'application/manifest+json'};
const CHROMIUM = ['/opt/pw-browsers/chromium'].find(p => fs.existsSync(p));
let browser;
before(async () => { if(!pular) browser = await pw.chromium.launch(CHROMIUM ? {executablePath: CHROMIUM} : {}); });
after(async () => { if(browser) await browser.close(); });

// tema = fundo da entrada guardado ('preta' | 'branca'; sem ele, o padrão); troca = {'/js/app.js': () => texto} (front antigo)
async function abre(largura = 1440, tema, troca = {}){
  const ctx = await browser.newContext({viewport: {width: largura, height: 1000}});
  const page = await ctx.newPage();
  if(tema) await page.addInitScript(t => { try { localStorage.setItem('drotas_entrada', t); } catch(e){} }, tema);
  const erros = [];
  page.on('pageerror', e => erros.push(String(e)));
  page.on('console', m => { if(m.type() === 'error') erros.push(m.text()); });
  await page.route('https://painel.test/**', rota => {
    const url = new URL(rota.request().url());
    const arq = url.pathname === '/data/payload.json' ? PAYLOAD : url.pathname === '/data/online.json' ? ONLINE
      : path.join(FRONT, url.pathname);
    if(!troca[url.pathname] && !fs.existsSync(arq)) return rota.fulfill({status: 404, body: ''});
    let body = troca[url.pathname] ? troca[url.pathname]() : fs.readFileSync(arq);
    // senha da Diretoria: hashes de teste; e todas as gerências liberadas na entrada (senha_teste.js)
    if(url.pathname === '/js/config.js') body = trocaNomes(trocaLiberadas(trocaHash(body)));
    rota.fulfill({status: 200, contentType: TIPOS[path.extname(arq)] || 'application/octet-stream', body});
  });
  await page.route(/cdnjs\.cloudflare\.com/, r => r.abort());
  await page.goto('https://painel.test/index.html');
  await page.waitForFunction(() => typeof P !== 'undefined' && P && document.getElementById('carga').hidden);
  return {page, ctx, erros};
}
// entra pela tela de entrada (a casa volta para ela): {perfil: 'dir'} | {perfil: 'gc', gc} | {perfil: 'sv', gc, sv} |
// {perfil: 'rota', gc, rota}
async function entra(page, {perfil, gc, sv, rota}){
  if(await page.isHidden('#entrada')) await page.click('#btnCasa');
  await page.click(`#entrada [data-perfil="${perfil}"]`);
  if(perfil === 'dir') return digitaSenha(page);
  await page.click(`#entOpcoes [data-gc="${gc}"]`);
  if(perfil === 'sv') await page.click(`#entOpcoes [data-sv="${sv}"]`);
  if(perfil === 'rota') await page.click(`#entOpcoes [data-rota="${rota}"]`);
}

describe('Conferência da Executiva com dado real (seção 7)', {skip: pular}, () => {
  for(const largura of [1440, 390])
  test(`${largura} px: Diretoria, cada gerência, cada grupo no Total e uma supervisão: invariantes da seção 7`, async () => {
    const {page, ctx, erros} = await abre(largura);
    const info = await page.evaluate(() => ({gcs: gcsComDados(), grupos: gruposGc().map(g => g.chave).filter(temDados),
      mes: P.MES_LABEL, dia: `${P.DIA_HOJE}/${P.TOTAL_DIAS_UTEIS}`, fech: !!P.FECHAMENTO}));
    const linhas = [];
    await entra(page, {perfil: 'dir'});
    assert.equal(await page.evaluate(() => aba), 'EXEC', 'a Diretoria abre na Executiva');
    linhas.push(await confereExecutiva(page, 'BAND'));
    for(const g of info.gcs){
      await page.selectOption('#fgc', g);
      linhas.push(await confereExecutiva(page, `GC.${g}`));
    }
    for(const g of info.grupos){
      await entra(page, {perfil: 'gc', gc: g});
      assert.equal(await page.evaluate(() => aba), 'EXEC', `${g}: a Gerência abre na Executiva`);
      linhas.push(await confereExecutiva(page, `Total ${g}`));
    }
    const sv = await page.evaluate(() => { const g = gcsComDados()[0]; return {gc: g, sv: svsDaEntrada(g)[0]}; });
    await entra(page, {perfil: 'sv', gc: sv.gc, sv: sv.sv});
    assert.equal(await page.evaluate(() => aba), 'EXEC', 'a Supervisão abre na Executiva');
    linhas.push(await confereExecutiva(page, sv.sv));
    const upd = await page.evaluate(() => (ONLINE || {}).updatedAt);
    assert.deepEqual(erros, []);
    await ctx.close();
    const cab = ['Escopo', 'Base', 'Sem compra', 'Visitas hoje', 'Categ. tend.', 'Cob. no ritmo', 'Desvio Refri (total)',
                 'Status TaB', 'Agendados', 'Sem compra hoje', 'Pediram online', 'Restam', 'Gaveta Sem compra'];
    console.log(`# Conferência com dado real (${largura} px): ${info.mes}, dia útil ${info.dia}${info.fech ? ' (fechamento)' : ''}, online ${upd}`);
    console.log(`# | ${cab.join(' | ')} |`);
    console.log(`# |${cab.map(() => '---').join('|')}|`);
    for(const l of linhas) console.log(`# | ${[l.onde, l.base, l.sem, l.vis, l.cat, l.cob, l.desvio, l.status, l.ag, l.semHoje,
                                              l.ped, l.restam, l.gaveta].join(' | ')} |`);
  });
});

// textos cortados no bloco Evolução (scrollWidth > clientWidth, só o que está à vista)
// (fora das áreas com rolagem própria)
const ESTOUROS_EVO = () => [...document.querySelectorAll('#exEvo, #exEvo *')].filter(el => el.clientWidth > 0 && el.getClientRects().length
  && !/auto|scroll/.test(getComputedStyle(el).overflowX) && el.scrollWidth > el.clientWidth + 1).map(el => `${el.className || el.tagName}: ${el.textContent.trim().slice(0, 40)}`);

// "Hoje" e "Todos" das gavetas Base e Sem compra no filtro atual, contra os cards (números da tela) e o semCompra das rotas
// (instalada na página como window.__gavetaXCards)
const GAVETA_X_CARDS = () => {
  const n = id => { const t = document.getElementById(id).textContent; return /\d/.test(t) ? Number(t.replace(/\D/g, '')) : null; };
  const tot = () => { const v = [...document.querySelectorAll('#dCorpo .vazio')].map(x => x.textContent.match(/^\+ ([\d.]+) clientes/))
    .filter(Boolean); return document.querySelectorAll('#dCorpo .item').length + (v.length ? Number(v[0][1].replace(/\./g, '')) : 0); };
  const le = (id, chip) => { document.getElementById(id).click();
    if(chip) document.querySelector(`#dCorpo .dchip[data-d="${chip}"]`).click(); const x = tot(); fecha(); return x; };
  const rs = rotasAtuais().filter(r => !ehVirtual(r));
  return {cards: {base: n('nBase'), vis: n('xBase'), sem: n('nSem'), semHoje: n('xSem')},
    semRotas: rs.reduce((a, r) => a + (nodo('', r).semCompra || 0), 0), ocultas: rs.filter(r => ehOculta(rotaSv('', r))).length,
    semHojeRotas: rs.reduce((a, r) => a + (VISITAS_DIA.semCompra[r] || 0), 0), semDado: rs.filter(r => VISITAS_DIA.semCompra[r] == null).length,
    gav: {baseHoje: le('cBase'), baseTodos: le('cBase', 'Todos'), semHoje: le('cSem'), semTodos: P.SEM_COMPRA_MES ? le('cSem', 'Todos') : null}};
};

describe('Gavetas com barra de dias com dado real (Etapa 6)', {skip: pular}, () => {
  test('Diretoria, G1, G2, AP, IT+MO no Total e uma supervisão: cada chip x payload/online e x cards; cada unidade: Hoje e Todos x cards', async () => {
    const {page, ctx, erros} = await abre(1440);
    await page.evaluate(`window.__gavetaXCards = ${GAVETA_X_CARDS}`);
    const linhas = [], unidades = [];
    const info = await page.evaluate(() => ({mes: P.MES_LABEL, dia: `${P.DIA_HOJE}/${P.TOTAL_DIAS_UTEIS}`, scm: !!P.SEM_COMPRA_MES}));
    assert.ok(info.scm, 'o payload real traz SEM_COMPRA_MES');
    await entra(page, {perfil: 'dir'});
    linhas.push(await confereGavetas(page, 'BAND'));
    for(const gc of ['G1', 'G2', 'AP', 'IT+MO']){
      if(!(await page.evaluate(gc => temDados(gc), gc))) continue;
      await entra(page, {perfil: 'gc', gc});
      const onde = gc.includes('+') ? `Total ${gc}` : `GC.${gc}`;
      linhas.push(await confereGavetas(page, onde));
      // a gerência (e cada gerência do grupo), cada supervisão, a "Neutraliza" e cada rota: Hoje e Todos das duas gavetas x cards
      const escopos = await page.evaluate(gc => [{gc, sv: '', rota: ''}, ...(gc.includes('+') ? membrosGc(gc) : []).map(g => ({gc: g, sv: '', rota: ''})),
        ...svsEmOrdem(gc).map(sv => ({gc, sv, rota: ''})), ...(rotasNeutraliza(gc).length ? [{gc, sv: 'Neutraliza', rota: ''}] : []),
        ...rotasDe(gc, '').filter(r => !ehVirtual(r)).sort(ordemNatural).map(rota => ({gc, sv: svDaRota(rota), rota}))], gc);
      const conta = {gc: onde, n: 0, rotas: 0, sv: 0, ocultas: 0, semDado: 0, dif: []};
      for(const f of escopos){
        const x = await page.evaluate(f => { sel = {...sel, ...f}; render(); return window.__gavetaXCards(); }, f);
        const u = f.rota ? `rota ${f.rota}` : f.sv ? f.sv : `GC ${f.gc}`;
        conta.n++; if(f.rota) conta.rotas++; else if(f.sv) conta.sv++;
        if(x.ocultas){ conta.ocultas++; continue; }     // (nenhuma nessas gerências: a SV.G3.3 é da G3)
        // card "sem compra hoje" sem número ("sem venda do dia": rota do filtro sem venda no mês): a soma das rotas com dado
        if(x.cards.semHoje == null) conta.semDado++;
        const esp = {baseHoje: x.cards.vis, baseTodos: x.cards.base, semHoje: x.cards.semHoje == null ? x.semHojeRotas : x.cards.semHoje,
                     semTodos: x.cards.sem == null ? x.semRotas : x.cards.sem};
        for(const k of Object.keys(esp)) if(esp[k] !== x.gav[k]) conta.dif.push(`${u} ${k}: gaveta ${x.gav[k]} x card ${esp[k]}`);
        if(x.semRotas !== x.gav.semTodos) conta.dif.push(`${u} semTodos: gaveta ${x.gav.semTodos} x semCompra ${x.semRotas}`);
        if(x.semHojeRotas !== x.gav.semHoje) conta.dif.push(`${u} semHoje: gaveta ${x.gav.semHoje} x soma das rotas ${x.semHojeRotas}`);
      }
      unidades.push(conta);
      assert.equal(conta.ocultas, 0, `${onde}: unidade com oculta`);
      assert.deepEqual(conta.dif, [], `${onde}: gavetas x cards por unidade`);
    }
    const sv = await page.evaluate(() => ({gc: 'G1', sv: svsDaEntrada('G1')[0]}));
    await entra(page, {perfil: 'sv', gc: sv.gc, sv: sv.sv});
    linhas.push(await confereGavetas(page, sv.sv));
    const upd = await page.evaluate(() => (ONLINE || {}).updatedAt);
    assert.deepEqual(erros, []);
    await ctx.close();
    const cab = ['Escopo', 'Rotas ocultas', 'Base (card)', 'Base Todos', 'Visitas hoje (card)', 'Base Hoje', 'Sem compra (card)', 'Sem compra Todos',
                 'Sem compra hoje (card)', 'Sem compra Hoje', 'Riscados no Hoje', 'Seg..Sex (Base/Sem)', 'Clientes de 2+ dias'];
    console.log(`# Gavetas com dado real: ${info.mes}, dia útil ${info.dia}, online ${upd}`);
    console.log(`# | ${cab.join(' | ')} |`);
    console.log(`# |${cab.map(() => '---').join('|')}|`);
    for(const l of linhas) console.log(`# | ${[l.onde, l.ocultas, l.base, l.baseTodos, l.vis, l.baseHoje, l.sem, l.semTodos, l.semHoje, l.semHojeGav,
                                              l.riscHoje, l.dias, l.multi].join(' | ')} |`);
    console.log('# Por unidade (a gerência e as do grupo, supervisões, "Neutraliza" e rotas): Hoje e Todos das duas gavetas x cards');
    for(const u of unidades) console.log(`# | ${u.gc} | ${u.n} unidades (${u.sv} supervisões/Neutraliza, ${u.rotas} rotas) | ` +
      `com o card "sem venda do dia": ${u.semDado} | divergências: ${u.dif.length} |`);
  });

  for(const largura of [360, 390, 1000, 1440])
  test(`${largura} px, fundos preto e branco: sem rolagem lateral nem erro no console (abas, cascata de volume, gavetas com a barra; Evolução sem texto cortado)`, async () => {
    for(const tema of ['preta', 'branca']){
      const {page, ctx, erros} = await abre(largura, tema);
      const rola = () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
      const sv = await page.evaluate(() => svsDaEntrada('G2')[0]);
      for(const e of [{perfil: 'dir'}, {perfil: 'gc', gc: 'IT+MO'}, {perfil: 'sv', gc: 'G2', sv}]){
        await entra(page, e);
        const onde = `${largura} ${tema} ${JSON.stringify(e)}`;
        for(const a of ['EXEC', 'VOLUME', 'ICS_GC', 'NOVOS_NEG', 'INCENTIVO']){
          if(await page.isHidden(`.tab[data-g="${a}"]`)) continue;
          await page.evaluate(a => document.querySelector(`.tab[data-g="${a}"]`).click(), a);
          assert.ok(await rola(), `${onde} ${a}`);
        }
        // Evolução contra o mês anterior (barras pareadas): nenhum texto cortado no bloco, com as categorias fechadas e todas
        // abertas (as unidades embaixo)
        if(await page.evaluate(() => !!P.MES_ANTERIOR)){
          await page.evaluate(() => document.querySelector('.tab[data-g="EXEC"]').click());
          assert.deepEqual(await page.evaluate(ESTOUROS_EVO), [], `${onde} evolução`);
          await page.evaluate(ABRE_TODAS);
          assert.equal(await page.evaluate(() => document.querySelectorAll('#exEvLinhas .evDet:not([hidden])').length), 5, `${onde} evolução aberta`);
          assert.deepEqual(await page.evaluate(ESTOUROS_EVO), [], `${onde} evolução aberta`);
          assert.ok(await rola(), `${onde} evolução aberta`);
        }
        // cascata de volume até os clientes (com a barra) e as gavetas Base / Sem compra em alguns chips
        await page.evaluate(() => document.querySelector('.tab[data-g="VOLUME"]').click());
        await page.click('#lista .ind[data-k="VOL REFRIGERANTES"]');
        while(await page.$('#dCorpo .cLin[data-i]')) await page.click('#dCorpo .cLin[data-i]');
        for(const d of ['Hoje', 'Seg', 'Todos']){ await page.click(`#dLista .dchip[data-d="${d}"]`); assert.ok(await rola(), `${onde} volume ${d}`); }
        await page.keyboard.press('Escape');
        for(const id of ['cBase', 'cSem']){
          await page.evaluate(id => document.getElementById(id).click(), id);
          for(const d of ['Seg', 'Todos', 'Hoje']){ await page.click(`#dCorpo .dchip[data-d="${d}"]`); assert.ok(await rola(), `${onde} ${id} ${d}`); }
          await page.keyboard.press('Escape');
        }
      }
      assert.deepEqual(erros, [], `${largura} ${tema}`);
      await ctx.close();
    }
  });
});

describe('Evolução contra o mês anterior com dado real (barras pareadas)', {skip: pular}, () => {
  for(const largura of [1440, 390])
  test(`${largura} px: Diretoria, cada gerência, cada grupo no Total e uma supervisão: invariantes (a) a (f), com as unidades abertas`, async (t) => {
    const {page, ctx, erros} = await abre(largura);
    const info = await page.evaluate(() => ({gcs: gcsComDados(), grupos: gruposGc().map(g => g.chave).filter(temDados),
      mes: P.MES_LABEL, dia: `${P.DIA_HOJE}/${P.TOTAL_DIAS_UTEIS}`, fech: !!P.FECHAMENTO, ma: P.MES_ANTERIOR ?
      {mes: P.MES_ANTERIOR.MES_LABEL, dia: `${P.MES_ANTERIOR.DIA_UTIL}/${P.MES_ANTERIOR.TOTAL_DIAS_UTEIS}`, corte: P.MES_ANTERIOR.DATA_CORTE,
       fechado: P.MES_ANTERIOR.FECHADO} : null}));
    if(!info.ma){ await ctx.close(); t.skip('payload sem MES_ANTERIOR'); return; }
    const linhas = [];
    await entra(page, {perfil: 'dir'});
    linhas.push(await confereEvolucao(page, 'BAND'));
    for(const g of info.gcs){
      await page.selectOption('#fgc', g);
      // trocar o filtro recolhe as categorias abertas
      assert.equal(await page.evaluate(() => document.querySelectorAll('#exEvLinhas .evLin.cat[aria-expanded="true"]').length), 0, `GC.${g}: recolhido`);
      linhas.push(await confereEvolucao(page, `GC.${g}`));
    }
    for(const g of info.grupos){
      await entra(page, {perfil: 'gc', gc: g});
      linhas.push(await confereEvolucao(page, `Total ${g}`));
    }
    const sv = await page.evaluate(() => { const g = gcsComDados()[0]; return {gc: g, sv: svsDaEntrada(g)[0]}; });
    await entra(page, {perfil: 'sv', gc: sv.gc, sv: sv.sv});
    linhas.push(await confereEvolucao(page, sv.sv));
    const sub = await page.evaluate(() => document.getElementById('exSEvo').textContent);
    assert.deepEqual(erros, []);
    await ctx.close();
    const ks = ['VOL REFRIGERANTES', 'VOL CERVEJAS', 'VOL STILL', 'VOL AGUA MINERAL', 'VOL DEST+ART+CND'];
    const cab = ['Escopo', 'Unidades (—)', 'Rotas fora', 'Refri: Real ant.', 'Meta ant.', 'Real atual', ...ks.map(k => k.replace('VOL ', 'Δ '))];
    console.log(`# Evolução com dado real (${largura} px): ${info.ma.mes} dia útil ${info.ma.dia} (corte ${info.ma.corte}${info.ma.fechado ? ', fechado' : ''})` +
      ` x ${info.mes} dia útil ${info.dia}${info.fech ? ' (fechamento)' : ''}. Subtítulo: ${sub}`);
    console.log(`# | ${cab.join(' | ')} |`);
    console.log(`# |${cab.map(() => '---').join('|')}|`);
    const n = v => v.toLocaleString('pt-BR');
    for(const l of linhas) console.log(`# | ${[l.onde, `${l.unidades} (${l.nd})`, l.fora, n(l.realAnt), n(l.metaAnt), n(l.real),
                                              ...ks.map(k => l.cats[k])].join(' | ')} |`);
  });
});

/* Ajuste de rótulos com dado real: o macro VOL DEST+ART+CND como "Novos Negócios" (card de Volume com a 2ª linha
   "Dest+Art+Cnd"), o nome da aba EXEC por perfil e as notas menores (invariantes em rotulos_invariantes.js); antes x depois
   contra o front da main antes do ajuste (REF_ROTULOS), com o mesmo payload: textos de cards, cabeçalho, visão executiva,
   gavetas e Resumo iguais, fora o nome novo, a 2ª linha e o nome da aba. */
const REF_ROTULOS = '20728ac';
const FRONT_PRE_ROTULOS = (() => {
  try {
    const arq = f => execSync(`git show ${REF_ROTULOS}:frontend/${f}`, {cwd: path.resolve(FRONT, '..'), stdio: ['ignore', 'pipe', 'ignore']}).toString();
    const fs_ = ['index.html', 'css/app.css', 'js/config.js', 'js/nucleo.js', 'js/app.js', 'js/resumo.js', 'js/ritmo.js', 'js/main.js'];
    return Object.fromEntries(fs_.map(f => { const t = arq(f); return ['/' + f, () => t]; }));
  } catch(e) { return null; }
})();
/* Fronts de antes de 26/10/2026 (REF_ROTULOS, REF_PRE_EVO, REF_PRE_CAT): o Todos a Bordo de hoje soma também a rota oculta
   das EV* com cliente coberto no item (rotasInc; decisão de 26/10), que esses fronts não somam. Para o antes x depois
   comparar só o que a etapa de cada um mudou, os dois fronts recebem o mesmo payload sem os itens do Todos a Bordo nessas
   rotas ocultas (também Cervejas e Cervejas 600ml Retornável, que estão no ICS GC: os dois fronts somam o mesmo). */
const SEM_INC_EV = {'/data/payload.json': (() => { let t = null; return () => {
  if(t) return t;
  const p = JSON.parse(fs.readFileSync(PAYLOAD, 'utf-8')), ev = new Set(p.EVENTUAIS_ROTAS || []), inc = new Set((p.GROUPS || {}).INCENTIVO || []);
  for(const svs of Object.values(p.DATA)) for(const rotas of Object.values(svs)) for(const [r, d] of Object.entries(rotas)) if(ev.has(r))
    for(const k of inc) if(d.indicators[k]){ d.indicators[k] = {meta: null, real: null, pct: null, onPace: null, gap: null, unavailable: true};
      delete ((p.COBERTOS || {})[r] || {})[k]; }
  return (t = JSON.stringify(p));
}; })()};
// perfis: Diretoria, G1, o grupo IT+MO no Total, a 1ª supervisão e a 1ª rota da G2 (pela própria entrada)
const perfisRotulos = page => page.evaluate(() => [{perfil: 'dir'}, {perfil: 'gc', gc: 'G1'}, {perfil: 'gc', gc: 'IT+MO'},
  {perfil: 'sv', gc: 'G2', sv: svsDaEntrada('G2')[0]}, {perfil: 'rota', gc: 'G2', rota: rotasDaEntrada('G2')[0]}].filter(e => !e.gc || temDados(e.gc)));
const ABAS = ['EXEC', 'VOLUME', 'ICS_GC', 'NOVOS_NEG', 'INCENTIVO'];
const vaiAba = (page, a) => page.evaluate(a => { const t = document.querySelector(`.tab[data-g="${a}"]`); if(t.hidden) return false; t.click(); return true; }, a);

describe('Ajuste de rótulos com dado real (Novos Negócios, aba por perfil, notas)', {skip: pular}, () => {
  for(const largura of [1440, 390])
  test(`${largura} px, fundos preto e branco: 2ª linha só no card de Volume, nenhum "${ROT.SUB}" fora dela, nome da aba, notas AA`, async () => {
    for(const tema of ['preta', 'branca']){
      const {page, ctx, erros} = await abre(largura, tema);
      const linhas = [];
      for(const e of await perfisRotulos(page)){
        await entra(page, e);
        const onde = `${largura} ${tema} ${e.perfil}${e.gc ? ' ' + e.gc : ''}${e.sv ? ' ' + e.sv : ''}${e.rota ? ' ' + e.rota : ''}`;
        const a = await page.evaluate(ROT.ABA_EXEC_PAGINA);
        if(e.perfil === 'rota') assert.equal(a.visivel, false, onde);
        else assert.deepEqual([a.visivel, a.span, a.title, a.aria, a.abTit], [true, ...Array(4).fill(ROT.NOME_EXEC[e.perfil])], onde);
        for(const ab of ABAS){
          if(!await vaiAba(page, ab)) continue;
          assert.deepEqual(await page.evaluate(ROT.RASTRO_PAGINA, ROT.SUB), [], `${onde} ${ab}`);
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${onde} ${ab}: rolagem lateral`);
        }
        await vaiAba(page, 'VOLUME');
        const cs = await page.evaluate(ROT.CARDS_VOLUME_PAGINA, ROT.K_NOVOS);
        const nn = cs.find(x => x.k === ROT.K_NOVOS || (x.off && x.tit === ROT.NOVOS));
        assert.ok(nn && nn.sub === ROT.SUB, `${onde}: card ${ROT.NOVOS}`);
        assert.deepEqual(cs.filter(x => x !== nn && x.sub).map(x => x.k), [], `${onde}: outro card com a 2ª linha`);
        if(!nn.off){
          assert.ok(nn.sFs < nn.tFs && nn.sLum > nn.tLum && nn.sContraste >= 4.5, `${onde}: estilo ${JSON.stringify(nn)}`);
          const vol = cs.filter(x => x.vol), porLinha = {};
          for(const x of vol) (porLinha[x.topo] = porLinha[x.topo] || []).push(x.h);
          for(const hs of Object.values(porLinha)) assert.ok(Math.max(...hs) - Math.min(...hs) <= 1, `${onde}: alturas ${hs}`);
        }
        await page.click(`#lista .ind[data-k="${ROT.K_NOVOS}"]`).catch(() => {});
        if(await page.isVisible('#drw')){
          assert.ok((await page.textContent('#dTit')).startsWith(ROT.NOVOS + ' · '), `${onde}: gaveta`);
          assert.deepEqual(await page.evaluate(ROT.RASTRO_PAGINA, ROT.SUB), [], `${onde} gaveta`);
          await page.keyboard.press('Escape');
        }
        if(e.perfil !== 'rota'){
          await page.click('#btnResumo');
          assert.deepEqual(await page.evaluate(ROT.RASTRO_PAGINA, ROT.SUB), [], `${onde} Resumo`);
          await page.click('#rsVoltar');
          const rt = await page.evaluate(() => { const m = montaRitmo(P, RT.escopoRitmo());
            return JSON.stringify(m) + m.paginas.map(pg => { const x = RT.desenhaPagina(pg); return typeof x === 'string' ? x : x.outerHTML; }).join(''); });
          assert.ok(!rt.includes(ROT.SUB) && rt.includes(ROT.NOVOS), `${onde}: Painel de Ritmo`);
        }
        const notas = await page.evaluate(ROT.NOTAS_PAGINA);
        for(const [n, v] of Object.entries(notas)) assert.ok(v.contraste >= 4.5, `${onde}: ${n} contraste ${v.contraste}`);
        linhas.push([onde, a.visivel ? a.span : '(sem aba)', nn.off ? 'indisponível' : `${nn.sFs}px x ${nn.tFs}px, ${nn.sContraste.toFixed(2)}:1`,
          Object.entries(notas).map(([n, v]) => `${n} ${v.fs}px ${v.contraste.toFixed(1)}:1`).join(', ')]);
      }
      assert.deepEqual(erros, [], `${largura} ${tema}`);
      await ctx.close();
      console.log(`# Rótulos com dado real (${largura} px, fundo ${tema})`);
      console.log('# | Perfil | Aba EXEC | 2ª linha (tamanho x título, contraste) | Notas (tamanho, contraste) |');
      console.log('# |---|---|---|---|');
      for(const l of linhas) console.log(`# | ${l.join(' | ')} |`);
    }
  });

  test('antes x depois com o mesmo payload real: cards, cabeçalho, visão executiva, gavetas e Resumo iguais aos da main (fora o nome novo, a 2ª linha e o nome da aba); notas menores', {skip: !FRONT_PRE_ROTULOS && `sem o commit ${REF_ROTULOS}`}, async () => {
    const [novo, velho] = [await abre(1440, undefined, SEM_INC_EV), await abre(1440, undefined, {...FRONT_PRE_ROTULOS, ...SEM_INC_EV})];
    const linhas = [];
    for(const e of await perfisRotulos(novo.page)){
      for(const {page} of [novo, velho]) await entra(page, e);
      const onde = `${e.perfil}${e.gc ? ' ' + e.gc : ''}${e.sv ? ' ' + e.sv : ''}${e.rota ? ' ' + e.rota : ''}`;
      const comp = [];
      for(const ab of ABAS){
        const [ta, tb] = [await vaiAba(novo.page, ab), await vaiAba(velho.page, ab)];
        assert.equal(ta, tb, `${onde} ${ab}`);
        if(!ta) continue;
        const [a, b] = [await novo.page.evaluate(ROT.TEXTOS_TELA_PAGINA), await velho.page.evaluate(ROT.TEXTOS_TELA_PAGINA)];
        assert.deepEqual(ROT.desfazAE(a), ROT.comNomeNovo(b), `${onde} ${ab}`);
        comp.push(`${ab} (${a.lista.length || 'visão executiva'})`);
        // gavetas: o macro de volume e o 1º card de cada aba de coberturas
        const k = ab === 'VOLUME' ? ROT.K_NOVOS : ab === 'EXEC' ? null : await novo.page.$eval('#lista .ind[data-k]', x => x.dataset.k).catch(() => null);
        if(!k || !(await novo.page.$(`#lista .ind[data-k="${k}"]`))) continue;
        // (no front atual, o texto da gaveta com a cascata desfeita do que a Etapa 3 do pacote v3 trocou: CASC_INV.desfazCasc)
        const gav = async (p, desfaz) => { await p.click(`#lista .ind[data-k="${k}"]`);
          const html = await p.innerHTML('#dCorpo');
          const t = await p.evaluate(h => { const d = document.createElement('div'); d.innerHTML = h;
            return [document.getElementById('dTit').textContent, d.textContent]; }, desfaz ? CASC_INV.desfazCasc(html) : html);
          await p.keyboard.press('Escape'); return t; };
        assert.deepEqual(await gav(novo.page, true), ROT.comNomeNovo(await gav(velho.page)), `${onde} ${ab} gaveta ${k}`);
        comp.push(`gaveta ${k}`);
      }
      if(e.perfil !== 'rota'){
        const rs = async p => { await p.click('#btnResumo'); const t = await p.evaluate(() => document.getElementById('rsFolha').textContent);
          await p.click('#rsVoltar'); return t; };
        assert.equal(await rs(novo.page), ROT.comNomeNovo([await rs(velho.page)])[0], `${onde} Resumo`);
        comp.push('Resumo');
      }
      linhas.push([onde, comp.join(', ')]);
    }
    const [na, nb] = [await novo.page.evaluate(ROT.NOTAS_PAGINA), await velho.page.evaluate(ROT.NOTAS_PAGINA)];
    for(const n of Object.keys(nb)) assert.ok(na[n].fs < nb[n].fs, `${n}: ${na[n].fs} x ${nb[n].fs}`);
    assert.deepEqual([...novo.erros, ...velho.erros], []);
    for(const {ctx} of [novo, velho]) await ctx.close();
    console.log('# Antes x depois (main antes do ajuste x branch), mesmo payload real: tudo igual fora o nome novo, a 2ª linha e o nome da aba');
    console.log('# | Perfil | Comparado |');
    console.log('# |---|---|');
    for(const l of linhas) console.log(`# | ${l.join(' | ')} |`);
    console.log(`# Notas (main -> branch): ${Object.keys(nb).map(n => `${n} ${nb[n].fs} -> ${na[n].fs}px`).join(', ')}`);
  });
});

/* Antes x depois do redesenho da Evolução (barras pareadas) com dado real: o front da main antes desta etapa (REF_PRE_EVO;
   só index.html, app.css e app.js mudaram) x o atual, com o mesmo payload real: a Executiva sem o bloco, o cabeçalho e os
   cards de Volume, ICS GC, Novos Negócios e Todos a Bordo, a cascata dos 2 primeiros cards de cada aba até os clientes e o
   Resumo, iguais (HTML). */
const REF_PRE_EVO = '7674ca2';
const FRONT_PRE_EVO = (() => {
  try {
    const arq = f => execSync(`git show ${REF_PRE_EVO}:frontend/${f}`, {cwd: path.resolve(FRONT, '..'), stdio: ['ignore', 'pipe', 'ignore']}).toString();
    return Object.fromEntries(['index.html', 'css/app.css', 'js/app.js'].map(f => { const t = arq(f); return ['/' + f, () => t]; }));
  } catch(e) { return null; }
})();
// a Executiva sem o bloco "Evolução contra o mês anterior" e o comentário dele (com os espaços em volta)
const SEM_EVO = () => { const c = document.getElementById('exec').cloneNode(true);
  [...c.childNodes].filter(n => n.nodeType === 8 && /Evolução/.test(n.data))
    .forEach(n => { n.previousSibling.remove(); n.nextSibling.remove(); n.remove(); });
  c.querySelector('#exEvo').remove();
  return c.innerHTML; };
const TELA_ABA = () => ({topo: document.getElementById('abaTopo').innerHTML, lista: document.getElementById('lista').innerHTML,
  n: document.querySelectorAll('#lista .ind').length});

describe('Antes x depois do redesenho da Evolução com dado real', {skip: pular || (!FRONT_PRE_EVO && `sem o commit ${REF_PRE_EVO}`)}, () => {
  test('Diretoria, G1, IT+MO, a 1ª supervisão e a 1ª rota da G2: Executiva sem o bloco, cabeçalho, cards, cascata e Resumo iguais aos da main', async () => {
    const [novo, velho] = [await abre(1440, undefined, SEM_INC_EV), await abre(1440, undefined, {...FRONT_PRE_EVO, ...SEM_INC_EV})];
    const linhas = [];
    for(const e of await perfisRotulos(novo.page)){
      for(const {page} of [novo, velho]) await entra(page, e);
      const onde = `${e.perfil}${e.gc ? ' ' + e.gc : ''}${e.sv ? ' ' + e.sv : ''}${e.rota ? ' ' + e.rota : ''}`;
      const comp = [];
      if(e.perfil !== 'rota'){
        for(const {page} of [novo, velho]) await vaiAba(page, 'EXEC');
        assert.equal(ROT.desfazAE(await novo.page.evaluate(SEM_EVO)), await velho.page.evaluate(SEM_EVO), `${onde}: Executiva sem o bloco`);
        comp.push('Executiva sem o bloco');
      }
      for(const ab of ['VOLUME', 'ICS_GC', 'NOVOS_NEG', 'INCENTIVO']){
        const [ta, tb] = [await vaiAba(novo.page, ab), await vaiAba(velho.page, ab)];
        assert.equal(ta, tb, `${onde} ${ab}`);
        if(!ta) continue;
        const [a, b] = [await novo.page.evaluate(TELA_ABA), await velho.page.evaluate(TELA_ABA)];
        assert.deepEqual(CASC_INV.desfazCasc(ROT.desfazAE(a)), b, `${onde} ${ab}: cabeçalho e cards`);
        let niveis = 0;
        const ks = (await novo.page.$$eval('#lista .ind[data-k]', els => els.map(x => x.dataset.k))).slice(0, 2);
        for(const k of ks){
          for(const {page} of [novo, velho]) await page.click(`#lista .ind[data-k="${k}"]`);
          for(let nivel = 0; nivel < 5; nivel++){
            assert.equal(CASC_INV.desfazCasc(await novo.page.innerHTML('#drw')), await velho.page.innerHTML('#drw'), `${onde} ${ab} ${k}: cascata nível ${nivel}`);
            niveis++;
            // (na Diretoria a gerência abre direto a lista de clientes desde a Etapa 3 do pacote v3: só o 1º nível)
            if(e.perfil === 'dir' || !(await novo.page.$('#dCorpo .cLin[data-i]'))) break;
            for(const {page} of [novo, velho]) await page.click('#dCorpo .cLin[data-i]');
          }
          for(const {page} of [novo, velho]) await page.keyboard.press('Escape');
        }
        comp.push(`${ab} (${a.n} cards, ${niveis} telas de cascata)`);
      }
      if(e.perfil !== 'rota'){
        for(const {page} of [novo, velho]) await page.click('#btnResumo');
        assert.equal(await novo.page.innerHTML('#rsFolha'), await velho.page.innerHTML('#rsFolha'), `${onde}: Resumo`);
        for(const {page} of [novo, velho]) await page.click('#rsVoltar');
        comp.push('Resumo');
      }
      linhas.push([onde, comp.join(', ')]);
    }
    assert.deepEqual([...novo.erros, ...velho.erros], []);
    for(const {ctx} of [novo, velho]) await ctx.close();
    console.log(`# Antes x depois (main ${REF_PRE_EVO} x branch), mesmo payload real: tudo igual fora o bloco da Evolução`);
    console.log('# | Perfil | Comparado (igual) |');
    console.log('# |---|---|');
    for(const l of linhas) console.log(`# | ${l.join(' | ')} |`);
  });
});

/* Gaveta "Categoria por unidade" da Executiva com dado real (invariantes (a)-(f) em categoria_invariantes.js, as mesmas da
   Parte AC): a Diretoria, cada gerência com dados (filtro da Diretoria), cada grupo no Total e uma supervisão, nas 5 categorias;
   em 360, 390, 1000 e 1440 px, nos dois fundos, sem rolagem lateral nem texto cortado (g); e o antes x depois contra a main antes
   da etapa (REF_PRE_CAT), com o mesmo payload: Executiva, cabeçalho e cards das 4 abas, cascata, gavetas Base e Sem compra e
   Resumo iguais (HTML). Imprime tabelas-resumo só de totais e códigos. */
const CAT = require('./categoria_invariantes.js');
const REF_PRE_CAT = 'ec60a88';
const FRONT_PRE_CAT = (() => {
  try {
    const arq = f => execSync(`git show ${REF_PRE_CAT}:frontend/${f}`, {cwd: path.resolve(FRONT, '..'), stdio: ['ignore', 'pipe', 'ignore']}).toString();
    return Object.fromEntries(['index.html', 'css/app.css', 'js/app.js'].map(f => { const t = arq(f); return ['/' + f, () => t]; }));
  } catch(e) { return null; }
})();
const KS_VOL = ['VOL REFRIGERANTES', 'VOL CERVEJAS', 'VOL STILL', 'VOL AGUA MINERAL', 'VOL DEST+ART+CND'];
const CURTO_VOL = {'VOL REFRIGERANTES': 'Refri', 'VOL CERVEJAS': 'Cervejas', 'VOL STILL': 'Still', 'VOL AGUA MINERAL': 'Água',
                   'VOL DEST+ART+CND': 'Novos Neg.'};

describe('Gaveta "Categoria por unidade" com dado real', {skip: pular}, () => {
  for(const largura of [1440, 390])
  test(`${largura} px: Diretoria, cada gerência, cada grupo no Total e uma supervisão, nas 5 categorias: invariantes (a) a (f)`, async () => {
    const {page, ctx, erros} = await abre(largura);
    const info = await page.evaluate(() => ({gcs: gcsComDados(), grupos: gruposGc().map(g => g.chave).filter(temDados),
      mes: P.MES_LABEL, dia: `${P.DIA_HOJE}/${P.TOTAL_DIAS_UTEIS}`, fech: !!P.FECHAMENTO}));
    const linhas = [];
    await entra(page, {perfil: 'dir'});
    linhas.push(await CAT.confereCategoria(page, 'BAND'));
    for(const g of info.gcs){
      await page.selectOption('#fgc', g);
      linhas.push(await CAT.confereCategoria(page, `GC.${g}`));
    }
    for(const g of info.grupos){
      await entra(page, {perfil: 'gc', gc: g});
      linhas.push(await CAT.confereCategoria(page, `Total ${g}`));
    }
    const sv = await page.evaluate(() => { const g = gcsComDados()[0]; return {gc: g, sv: svsDaEntrada(g)[0]}; });
    await entra(page, {perfil: 'sv', gc: sv.gc, sv: sv.sv});
    linhas.push(await CAT.confereCategoria(page, sv.sv));
    const upd = await page.evaluate(() => (ONLINE || {}).updatedAt);
    assert.deepEqual(erros, []);
    await ctx.close();
    // por categoria: unidades na gaveta (verde/âmbar/vermelho), % real e % tendência do total, unidades sem meta e rotas fora
    const cel = c => c === 'sem meta' ? 'sem meta' : `${c.n} (${c.bat}/${c.am}/${c.abx})${c.neutra ? ' +N' : ''} · ${c.pct}%` +
      (c.tend == null ? '' : ` / ${c.tend}%`) + (c.semMeta ? ` · ${c.semMeta} s/meta` : '') + (c.fora ? ` · ${c.fora} fora` : '');
    console.log(`# Gaveta Categoria por unidade com dado real (${largura} px): ${info.mes}, dia útil ${info.dia}${info.fech ? ' (fechamento)' : ''}, online ${upd}`);
    console.log('# Cada célula: unidades na gaveta (verde/âmbar/vermelho; +N = com a linha Neutraliza) · % real / % tendência do total' +
      ' · unidades sem meta na categoria · rotas fora das unidades (virtuais, -EV)');
    console.log(`# | Escopo | ${KS_VOL.map(k => CURTO_VOL[k]).join(' | ')} |`);
    console.log(`# |---|${KS_VOL.map(() => '---').join('|')}|`);
    for(const l of linhas) console.log(`# | ${l.onde} | ${KS_VOL.map(k => cel(l.cats[k])).join(' | ')} |`);
  });

  for(const largura of [360, 390, 1000, 1440])
  test(`${largura} px, fundos preto e branco: a gaveta das 5 categorias sem rolagem lateral nem texto cortado, sem erro no console (g)`, async () => {
    for(const tema of ['preta', 'branca']){
      const {page, ctx, erros} = await abre(largura, tema);
      const sv = await page.evaluate(() => svsDaEntrada('G2')[0]);
      for(const e of [{perfil: 'dir'}, {perfil: 'gc', gc: 'IT+MO'}, {perfil: 'gc', gc: 'AT'}, {perfil: 'sv', gc: 'G2', sv}]){
        await entra(page, e);
        const onde = `${largura} ${tema} ${JSON.stringify(e)}`;
        for(const k of KS_VOL){
          if(await page.$eval(`#exGauges .gCard[data-k="${k}"]`, g => g.classList.contains('off'))) continue;
          await page.click(`#exGauges .gCard[data-k="${k}"]`);
          await page.waitForTimeout(260);
          assert.ok(await page.evaluate(() => document.getElementById('drw').classList.contains('on')), `${onde} ${k}: abre`);
          assert.deepEqual(await page.evaluate(CAT.CORTES_CAT), [], `${onde} ${k}: texto cortado`);
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${onde} ${k}: rolagem lateral`);
          await page.keyboard.press('Escape');
        }
      }
      assert.deepEqual(erros, [], `${largura} ${tema}`);
      await ctx.close();
    }
  });

  test('antes x depois (main antes da etapa, mesmo payload real): Executiva, cabeçalho e cards das 4 abas, cascata, gavetas Base e Sem compra e Resumo iguais', {skip: !FRONT_PRE_CAT && `sem o commit ${REF_PRE_CAT}`}, async () => {
    const [novo, velho] = [await abre(1440, undefined, SEM_INC_EV), await abre(1440, undefined, {...FRONT_PRE_CAT, ...SEM_INC_EV})];
    const linhas = [];
    const gaveta = async (p, abrir) => { await abrir(p); const h = await p.innerHTML('#drw'); await p.keyboard.press('Escape'); return h; };
    const clica = id => p => p.evaluate(id => document.getElementById(id).click(), id);
    for(const e of await perfisRotulos(novo.page)){
      for(const {page} of [novo, velho]) await entra(page, e);
      const onde = `${e.perfil}${e.gc ? ' ' + e.gc : ''}${e.sv ? ' ' + e.sv : ''}${e.rota ? ' ' + e.rota : ''}`;
      const comp = [];
      if(e.perfil !== 'rota'){
        for(const {page} of [novo, velho]) await vaiAba(page, 'EXEC');
        assert.equal(ROT.desfazAE(await novo.page.innerHTML('#exec')), await velho.page.innerHTML('#exec'), `${onde}: Executiva`);
        for(const id of ['exBase', 'exSem', 'exVis'])
          assert.equal(await gaveta(novo.page, clica(id)), await gaveta(velho.page, clica(id)), `${onde}: gaveta do KPI ${id}`);
        comp.push('Executiva (HTML) e as gavetas dos KPIs');
      }
      for(const ab of ['VOLUME', 'ICS_GC', 'NOVOS_NEG', 'INCENTIVO']){
        const [ta, tb] = [await vaiAba(novo.page, ab), await vaiAba(velho.page, ab)];
        assert.equal(ta, tb, `${onde} ${ab}`);
        if(!ta) continue;
        const [a, b] = [await novo.page.evaluate(TELA_ABA), await velho.page.evaluate(TELA_ABA)];
        assert.deepEqual(CASC_INV.desfazCasc(ROT.desfazAE(a)), b, `${onde} ${ab}: cabeçalho e cards`);
        let niveis = 0;
        const ks = (await novo.page.$$eval('#lista .ind[data-k]', els => els.map(x => x.dataset.k))).slice(0, 2);
        for(const k of ks){
          for(const {page} of [novo, velho]) await page.click(`#lista .ind[data-k="${k}"]`);
          for(let nivel = 0; nivel < 5; nivel++){
            assert.equal(CASC_INV.desfazCasc(await novo.page.innerHTML('#drw')), await velho.page.innerHTML('#drw'), `${onde} ${ab} ${k}: cascata nível ${nivel}`);
            niveis++;
            // (na Diretoria a gerência abre direto a lista de clientes desde a Etapa 3 do pacote v3: só o 1º nível)
            if(e.perfil === 'dir' || !(await novo.page.$('#dCorpo .cLin[data-i]'))) break;
            for(const {page} of [novo, velho]) await page.click('#dCorpo .cLin[data-i]');
          }
          for(const {page} of [novo, velho]) await page.keyboard.press('Escape');
        }
        for(const id of ['cBase', 'cSem'])
          assert.equal(await gaveta(novo.page, clica(id)), await gaveta(velho.page, clica(id)), `${onde} ${ab}: gaveta ${id}`);
        comp.push(`${ab} (${a.n} cards, ${niveis} telas de cascata, Base e Sem compra)`);
      }
      if(e.perfil !== 'rota'){
        for(const {page} of [novo, velho]) await page.click('#btnResumo');
        assert.equal(await novo.page.innerHTML('#rsFolha'), await velho.page.innerHTML('#rsFolha'), `${onde}: Resumo`);
        for(const {page} of [novo, velho]) await page.click('#rsVoltar');
        comp.push('Resumo');
      }
      linhas.push([onde, comp.join(', ')]);
    }
    assert.deepEqual([...novo.erros, ...velho.erros], []);
    for(const {ctx} of [novo, velho]) await ctx.close();
    console.log(`# Antes x depois (main ${REF_PRE_CAT} x branch), mesmo payload real: tudo igual (a gaveta nova só abre no medidor)`);
    console.log('# | Perfil | Comparado (igual) |');
    console.log('# |---|---|');
    for(const l of linhas) console.log(`# | ${l.join(' | ')} |`);
  });
});

/* Ajustes visuais da Executiva e nome na Diretoria (Parte AE de front.test.js), com dado real: antes x depois contra a main
   antes da etapa (REF_PRE_AE), com o mesmo payload, em 1440 e 390 px: a Executiva inteira (KPIs, medidores, Tendência x
   Meta, Sem compra, Agenda, Coberturas e Evolução) igual em HTML, tirando só o que a etapa acrescenta (ROT.desfazAE: a
   linha "faltam" do medidor, os data-meta/data-real dele, o rótulo e o placeholder da busca; zebra e hachura são só CSS);
   cabeçalho e cards das 4 abas, cascata e Resumo iguais. A invariante "Meta − Real = faltam" está em confereExecutiva. */
const REF_PRE_AE = '783ba5d';
const FRONT_PRE_AE = (() => {
  try {
    const arq = f => execSync(`git show ${REF_PRE_AE}:frontend/${f}`, {cwd: path.resolve(FRONT, '..'), stdio: ['ignore', 'pipe', 'ignore']}).toString();
    return Object.fromEntries(['index.html', 'css/app.css', 'js/app.js'].map(f => { const t = arq(f); return ['/' + f, () => t]; }));
  } catch(e) { return null; }
})();
describe('Ajustes visuais da Executiva com dado real: antes x depois', {skip: pular || (!FRONT_PRE_AE && `sem o commit ${REF_PRE_AE}`)}, () => {
  for(const largura of [1440, 390])
  test(`${largura} px: Diretoria, G1, IT+MO, a 1ª supervisão e a 1ª rota da G2: Executiva, abas, cascata e Resumo iguais aos da main`, async () => {
    const [novo, velho] = [await abre(largura), await abre(largura, undefined, FRONT_PRE_AE)];
    const linhas = [];
    for(const e of await perfisRotulos(novo.page)){
      for(const {page} of [novo, velho]) await entra(page, e);
      const onde = `${e.perfil}${e.gc ? ' ' + e.gc : ''}${e.sv ? ' ' + e.sv : ''}${e.rota ? ' ' + e.rota : ''}`;
      const comp = [];
      if(e.perfil !== 'rota'){
        for(const {page} of [novo, velho]) await vaiAba(page, 'EXEC');
        // todas as categorias da Evolução abertas nos dois
        for(const {page} of [novo, velho])
          await page.evaluate(() => document.querySelectorAll('#exEvLinhas .evLin.cat[aria-expanded="false"]').forEach(el => el.click()));
        const [a, b] = [await novo.page.innerHTML('#exec'), await velho.page.innerHTML('#exec')];
        assert.equal(ROT.desfazAE(a), b, `${onde}: Executiva`);
        const nf = (a.match(/class="gFalta/g) || []).length;
        comp.push(`Executiva (HTML; ${nf} linhas "faltam")`);
      }
      for(const ab of ['VOLUME', 'ICS_GC', 'NOVOS_NEG', 'INCENTIVO']){
        const [ta, tb] = [await vaiAba(novo.page, ab), await vaiAba(velho.page, ab)];
        assert.equal(ta, tb, `${onde} ${ab}`);
        if(!ta) continue;
        const [a, b] = [await novo.page.evaluate(TELA_ABA), await velho.page.evaluate(TELA_ABA)];
        assert.deepEqual(CASC_INV.desfazCasc(ROT.desfazAE(a)), b, `${onde} ${ab}: cabeçalho e cards`);
        let niveis = 0;
        const ks = (await novo.page.$$eval('#lista .ind[data-k]', els => els.map(x => x.dataset.k))).slice(0, 2);
        for(const k of ks){
          for(const {page} of [novo, velho]) await page.click(`#lista .ind[data-k="${k}"]`);
          for(let nivel = 0; nivel < 5; nivel++){
            assert.equal(CASC_INV.desfazCasc(await novo.page.innerHTML('#drw')), await velho.page.innerHTML('#drw'), `${onde} ${ab} ${k}: cascata nível ${nivel}`);
            niveis++;
            // (na Diretoria a gerência abre direto a lista de clientes desde a Etapa 3 do pacote v3: só o 1º nível)
            if(e.perfil === 'dir' || !(await novo.page.$('#dCorpo .cLin[data-i]'))) break;
            for(const {page} of [novo, velho]) await page.click('#dCorpo .cLin[data-i]');
          }
          for(const {page} of [novo, velho]) await page.keyboard.press('Escape');
        }
        comp.push(`${ab} (${a.n} cards, ${niveis} telas de cascata)`);
      }
      if(e.perfil !== 'rota'){
        for(const {page} of [novo, velho]) await page.click('#btnResumo');
        assert.equal(await novo.page.innerHTML('#rsFolha'), await velho.page.innerHTML('#rsFolha'), `${onde}: Resumo`);
        for(const {page} of [novo, velho]) await page.click('#rsVoltar');
        comp.push('Resumo');
      }
      linhas.push([onde, comp.join(', ')]);
    }
    assert.deepEqual([...novo.erros, ...velho.erros], []);
    for(const {ctx} of [novo, velho]) await ctx.close();
    console.log(`# Antes x depois (main ${REF_PRE_AE} x branch), ${largura} px, mesmo payload real: tudo igual fora a linha "faltam" e o rótulo da busca`);
    console.log('# | Perfil | Comparado (igual) |');
    console.log('# |---|---|');
    for(const l of linhas) console.log(`# | ${l.join(' | ')} |`);
  });

  for(const largura of [360, 390, 1000, 1440])
  test(`${largura} px, fundos preto e branco: Executiva e abas sem rolagem lateral nem erro, zebra e hachura aplicadas`, async () => {
    for(const tema of ['preta', 'branca']){
      const {page, ctx, erros} = await abre(largura, tema);
      for(const e of [{perfil: 'dir'}, {perfil: 'gc', gc: 'IT+MO'}]){
        await entra(page, e);
        for(const ab of ['EXEC', 'VOLUME', 'ICS_GC', 'NOVOS_NEG', 'INCENTIVO']){
          if(!(await vaiAba(page, ab))) continue;
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
            `${largura} ${tema} ${e.perfil} ${ab}: rolagem lateral`);
        }
        await vaiAba(page, 'EXEC');
        const r = await page.evaluate(() => ({
          tot: getComputedStyle(document.querySelector('#exCob tbody tr.tot td')).backgroundColor,
          par: getComputedStyle(document.querySelector('#exCob tbody tr:nth-child(2) td')).backgroundColor,
          atu: (document.querySelector('#exEvo:not([hidden]) .evTr .atu') ? getComputedStyle(document.querySelector('#exEvo .evTr .atu')).backgroundImage : 'sem Evolução')}));
        assert.equal(r.tot, 'rgb(228, 228, 232)');
        assert.equal(r.par, 'rgb(246, 246, 248)');
        assert.ok(/repeating-linear-gradient|sem Evolução/.test(r.atu), r.atu);
      }
      assert.deepEqual(erros, [], `${largura} ${tema}`);
      await ctx.close();
    }
  });
});

describe('Resumo de vendas: bloco Todos a Bordo 3.0 com dado real', {skip: pular}, () => {
  for(const largura of [1440, 390])
  test(`${largura} px: Diretoria, cada gerência, cada grupo no Total e uma supervisão: células = regra do ICS só nas rotas com meta; total x cards da aba; "—" sem meta`, async () => {
    const {page, ctx, erros} = await abre(largura);
    const info = await page.evaluate(() => ({gcs: gcsComDados(), grupos: gruposGc().map(g => g.chave).filter(temDados), ativo: incentivoAtivo(),
      mes: P.MES_LABEL, dia: `${P.DIA_HOJE}/${P.TOTAL_DIAS_UTEIS}`, fech: !!P.FECHAMENTO}));
    assert.ok(info.ativo, 'o payload real traz GROUPS.INCENTIVO');
    const linhas = [];
    await entra(page, {perfil: 'dir'});
    linhas.push(await confereResumoTab(page, 'BAND'));
    // gerências sem nenhuma rota com meta de Heineken (BARRACUDA): "—" na coluna delas na Diretoria
    const barracuda = await page.evaluate(() => gcsComDados().filter(g => !rotasInc('INC HEINEKEN', rotasDe(g, '')).length).map(g => 'GC.' + g));
    const hein = (linhas[0].semMeta['Heineken'] || []);
    assert.deepEqual(hein.filter(c => c.startsWith('GC.')), barracuda, 'Diretoria: Heineken "—" exatamente nas BARRACUDA');
    for(const g of info.gcs){
      await page.selectOption('#fgc', g);
      linhas.push(await confereResumoTab(page, `GC.${g}`));
    }
    for(const g of info.grupos){
      await entra(page, {perfil: 'gc', gc: g});
      linhas.push(await confereResumoTab(page, `Total ${g}`));
    }
    const sv = await page.evaluate(() => { const g = gcsComDados()[0]; return {gc: g, sv: svsDaEntrada(g)[0]}; });
    await entra(page, {perfil: 'sv', gc: sv.gc, sv: sv.sv});
    linhas.push(await confereResumoTab(page, sv.sv));
    const upd = await page.evaluate(() => (ONLINE || {}).updatedAt);
    assert.deepEqual(erros, []);
    await ctx.close();
    const nomes = linhas[0].itens.map(x => x[0]);
    console.log(`# Resumo, bloco Todos a Bordo com dado real (${largura} px): ${info.mes}, dia útil ${info.dia}${info.fech ? ' (fechamento)' : ''}, online ${upd}`);
    console.log(`# Heineken "—" na Diretoria (BARRACUDA): ${barracuda.join(' ') || 'nenhuma'}`);
    const cab = ['Escopo', 'Colunas', 'Células', '"—"', ...nomes.map(n => `${n}: bloco / card / online`)];
    console.log(`# | ${cab.join(' | ')} |`);
    console.log(`# |${cab.map(() => '---').join('|')}|`);
    for(const l of linhas) console.log(`# | ${[l.onde, l.colunas, l.celulas, l.tracos, ...l.itens.map(x => `${x[1]} / ${x[2]} / ${x[3]}`)].join(' | ')} |`);
  });
});

/* Antes x depois do bloco Todos a Bordo no Resumo: a main antes da etapa (index.html, CSS e resumo.js) com o mesmo payload */
const REF_PRE_TAB = '9f82f15';
const FRONT_PRE_TAB = (() => {
  try {
    const arq = f => execSync(`git show ${REF_PRE_TAB}:frontend/${f}`, {cwd: path.resolve(FRONT, '..'), stdio: ['ignore', 'pipe', 'ignore']}).toString();
    return Object.fromEntries(['index.html', 'css/app.css', 'js/resumo.js'].map(f => { const t = arq(f); return ['/' + f, () => t]; }));
  } catch(e) { return null; }
})();
describe('Resumo: bloco Todos a Bordo com dado real: antes x depois', {skip: pular || (!FRONT_PRE_TAB && `sem o commit ${REF_PRE_TAB}`)}, () => {
  for(const largura of [1440, 390])
  test(`${largura} px: Diretoria, G1, IT+MO, a 1ª supervisão e a 1ª rota da G2: Resumo sem o bloco, Executiva, cards e cascata iguais aos da main`, async () => {
    const [novo, velho] = [await abre(largura), await abre(largura, undefined, FRONT_PRE_TAB)];
    const linhas = [];
    for(const e of await perfisRotulos(novo.page)){
      for(const {page} of [novo, velho]) await entra(page, e);
      const onde = `${e.perfil}${e.gc ? ' ' + e.gc : ''}${e.sv ? ' ' + e.sv : ''}${e.rota ? ' ' + e.rota : ''}`;
      const comp = [];
      if(e.perfil !== 'rota'){
        for(const {page} of [novo, velho]) await vaiAba(page, 'EXEC');
        assert.equal(await novo.page.innerHTML('#exec'), await velho.page.innerHTML('#exec'), `${onde}: Executiva`);
        comp.push('Executiva');
      }
      for(const ab of ['VOLUME', 'ICS_GC', 'NOVOS_NEG', 'INCENTIVO']){
        const [ta, tb] = [await vaiAba(novo.page, ab), await vaiAba(velho.page, ab)];
        assert.equal(ta, tb, `${onde} ${ab}`);
        if(!ta) continue;
        const [a, b] = [await novo.page.evaluate(TELA_ABA), await velho.page.evaluate(TELA_ABA)];
        assert.deepEqual(a, b, `${onde} ${ab}: cabeçalho e cards`);
        const k = await novo.page.evaluate(() => (document.querySelector('#lista .ind[data-k]') || {dataset: {}}).dataset.k);
        if(k){
          for(const {page} of [novo, velho]) await page.click(`#lista .ind[data-k="${k}"]`);
          assert.equal(await novo.page.innerHTML('#drw'), await velho.page.innerHTML('#drw'), `${onde} ${ab}: cascata`);
          for(const {page} of [novo, velho]) await page.keyboard.press('Escape');
        }
        comp.push(`${ab} (${a.n} cards)`);
      }
      if(e.perfil !== 'rota'){
        for(const {page} of [novo, velho]) await page.click('#btnResumo');
        assert.equal(await novo.page.innerHTML('#rsFolha'), await velho.page.innerHTML('#rsFolha'), `${onde}: Resumo (padrão)`);
        for(const {page} of [novo, velho]) await page.click('#rsOverlay [data-rsb="nov"]');
        assert.equal(await novo.page.innerHTML('#rsFolha'), await velho.page.innerHTML('#rsFolha'), `${onde}: Resumo com Novos Negócios`);
        for(const {page} of [novo, velho]) await page.click('#rsOverlay [data-rsb="nov"]');
        for(const {page} of [novo, velho]) await page.click('#rsVoltar');
        comp.push('Resumo (padrão e com Novos Negócios)');
      }
      linhas.push([onde, comp.join(', ')]);
    }
    assert.deepEqual([...novo.erros, ...velho.erros], []);
    for(const {ctx} of [novo, velho]) await ctx.close();
    console.log(`# Antes x depois (main ${REF_PRE_TAB} x branch), ${largura} px, mesmo payload real: tudo igual sem o bloco marcado`);
    console.log('# | Perfil | Comparado (igual) |');
    console.log('# |---|---|');
    for(const l of linhas) console.log(`# | ${l.join(' | ')} |`);
  });
});

/* Cascata com Dif (Real + Online), selo de meta batida e cards com Real + online (Etapa 3 do pacote v3; invariantes (a)-(g) em
   cascata_invariantes.js, as mesmas da Parte AG): em cada aba (Volume, ICS GC, Novos Negócios, Todos a Bordo) e cada card, a
   Diretoria (gerências; a 1ª gerência abre direto a lista de clientes), uma gerência pelo filtro da Diretoria (supervisões e as
   rotas da 1ª), o grupo IT+MO no Total e uma supervisão; ordenação por %, Dif e Online (2º clique inverte; volta ao código)
   na Diretoria e na gerência; (f) a "Diferença" de cada card da Gerência G1 (= (Real + online) − Meta) = a Dif da linha GC.G1
   da cascata da Diretoria; sem rolagem lateral nem erro em 360, 390, 1000 e 1440 px com a cascata e a lista abertas. Antes x depois contra
   a main antes da etapa (REF_PRE_CASC), com o mesmo payload: Executiva, Resumo e Venda Zero idênticos; cards e cascata
   iguais depois de desfeito só o que a etapa trocou (CASC_INV.desfazCasc: a Diferença do card volta a Real − Meta). Imprime totais e códigos (nada de clientes). */
const REF_PRE_CASC = '515b1e9';
const FRONT_PRE_CASC = (() => {
  try {
    const arq = f => execSync(`git show ${REF_PRE_CASC}:frontend/${f}`, {cwd: path.resolve(FRONT, '..'), stdio: ['ignore', 'pipe', 'ignore']}).toString();
    return Object.fromEntries(['index.html', 'css/app.css', 'js/app.js'].map(f => { const t = arq(f); return ['/' + f, () => t]; }));
  } catch(e) { return null; }
})();
const ABAS_CASC = ['VOLUME', 'ICS_GC', 'NOVOS_NEG', 'INCENTIVO'];
const cardsK = page => page.$$eval('#lista .ind[data-k]', els => els.map(e => e.dataset.k));

describe('Cascata com Dif (Real + Online) e cards com Real + online, com dado real (Etapa 3 do pacote v3)', {skip: pular}, () => {
  for(const largura of [1440, 390])
  test(`${largura} px: invariantes (a)-(e) e (g) na Diretoria, uma gerência, IT+MO e uma supervisão; ordenação; (f) card x linha`, async () => {
    const {page, ctx, erros} = await abre(largura);
    const info = await page.evaluate(() => ({gc: gcsComDados().includes('G1') ? 'G1' : gcsComDados()[0], grupo: gruposGc().map(g => g.chave).find(temDados),
      mes: P.MES_LABEL, dia: `${P.DIA_HOJE}/${P.TOTAL_DIAS_UTEIS}`, fech: !!P.FECHAMENTO, upd: (ONLINE || {}).updatedAt}));
    const res = [], listas = [];
    const percorre = async (onde, {desce = 0, ordem = false, lista = false} = {}) => {
      for(const ab of ABAS_CASC){
        if(!await vaiAba(page, ab)) continue;
        for(const k of await cardsK(page)){
          await page.click(`#lista .ind[data-k="${k}"]`);
          res.push(await CASC_INV.confereNivel(page, `${onde} ${ab} ${k}`));
          if(ordem && k !== 'VENDAZERO' && (ab === 'VOLUME' || ab === 'ICS_GC')) await CASC_INV.confereOrdem(page, `${onde} ${k}`);
          for(let n = 0; n < desce && await page.$('#dCorpo .cLin[data-i]'); n++){
            await page.click('#dCorpo .cLin[data-i]');
            if(await page.$('#dCorpo .cLin')) res.push(await CASC_INV.confereNivel(page, `${onde} ${ab} ${k} nível ${n + 1}`));
          }
          if(lista && await page.$('#dCorpo .cLin[data-i]')){
            await page.click('#dCorpo .cLin[data-i]');
            assert.equal(await page.evaluate(() => CASC.pilha[CASC.pilha.length - 1].nivel), 'cli', `${onde} ${k}: GC > Clientes`);
            if(k.startsWith('VOL ')) listas.push(await CASC_INV.confereLista(page, `${onde} ${k} ${await page.textContent('#dTit')}`));
          }
          await page.keyboard.press('Escape');
        }
      }
    };
    await entra(page, {perfil: 'dir'});
    await percorre('BAND', {ordem: true, lista: true});
    // (f) Diretoria: Dif de cada linha GC.<gc> por card
    const difDir = {};
    for(const ab of ['VOLUME', 'ICS_GC', 'NOVOS_NEG', 'INCENTIVO']){
      if(!await vaiAba(page, ab)) continue;
      for(const k of await cardsK(page)){
        if(k === 'VENDAZERO') continue;
        await page.click(`#lista .ind[data-k="${k}"]`);
        difDir[`${ab}|${k}`] = await page.evaluate(gc => { const l = [...document.querySelectorAll('#dCorpo .cLin')].find(x =>
          ((x.querySelector('.cNomeL b') || x.querySelector('b')).textContent).startsWith(`GC.${gc} ·`));
          return l ? (l.querySelector('.cDif b') || {}).textContent || null : null; }, info.gc);
        await page.keyboard.press('Escape');
      }
    }
    await page.selectOption('#fgc', info.gc);
    await percorre(`GC.${info.gc}`, {desce: 1, ordem: true});
    if(info.grupo){ await entra(page, {perfil: 'gc', gc: info.grupo}); await percorre(`Total ${info.grupo}`); }
    const sv = await page.evaluate(gc => svsDaEntrada(gc)[0], info.gc);
    await entra(page, {perfil: 'sv', gc: info.gc, sv});
    await percorre(sv, {desce: 1});
    // (f) Gerência: linha "Real + online" de cada card = Dif da linha da gerência na cascata da Diretoria
    await entra(page, {perfil: 'gc', gc: info.gc});
    let nF = 0;
    for(const ab of ['VOLUME', 'ICS_GC', 'NOVOS_NEG', 'INCENTIVO']){
      if(!await vaiAba(page, ab)) continue;
      // a "Diferença" do card (= (Real + online) − Meta desde 29/10/2026; sem online, Real − Meta)
      const ro = await page.$$eval('#lista .ind[data-k]', els => els.map(el => { const d = el.querySelector('.cl .dif');
        return [el.dataset.k, d && d.dataset.ro != null ? d.textContent : null]; }));
      for(const [k, t] of ro){
        const d = difDir[`${ab}|${k}`];
        if(d === undefined) continue;
        assert.equal(t, d == null || d === '—' ? null : `Diferença ${d}`, `(f) ${info.gc} ${ab} ${k}`);
        nF++;
      }
    }
    assert.deepEqual(erros, []);
    await ctx.close();
    console.log(`# Cascata com Real + Online, dado real (${largura} px): ${info.mes}, dia útil ${info.dia}${info.fech ? ' (fechamento)' : ''}, online ${info.upd}`);
    console.log(`# (f) card x linha da cascata da Diretoria: ${nF} cards da Gerência ${info.gc} conferidos`);
    console.log('# | Escopo · indicador | Nível | Linhas | Com selo | Real + online > Real | Meta / Real do card |');
    console.log('# |---|---|---|---|---|---|');
    const f = n => n == null ? '—' : (Math.round(n * 10) / 10).toLocaleString('pt-BR');
    for(const r of res) console.log(`# | ${r.onde} | ${r.nivel} | ${r.linhas} | ${r.selos} | ${r.comOnline} | ${r.card ? `${f(r.card.meta)} / ${f(r.card.real)}` : '—'} |`);
    console.log('# | Lista de clientes (GC > Clientes) | Clientes exibidos | Com online |');
    console.log('# |---|---|---|');
    for(const l of listas) console.log(`# | ${l.onde} | ${l.clientes} | ${l.comOnline} |`);
  });

  test('360, 390, 1000 e 1440 px: cascata, cabeçalho/chips e lista de clientes sem rolagem lateral nem texto cortado; sem erro', async () => {
    const corte = () => [...document.querySelectorAll('#drw *')].filter(el => el.clientWidth > 0 && el.getClientRects().length
      && !/auto|scroll/.test(getComputedStyle(el).overflowX) && getComputedStyle(el).textOverflow !== 'ellipsis'
      && el.scrollWidth > el.clientWidth + 1).map(el => `${el.className}: ${el.textContent.trim().slice(0, 30)}`);
    for(const largura of [360, 390, 1000, 1440]){
      for(const tema of ['preta', 'branca']){
        const {page, ctx, erros} = await abre(largura, tema);
        await entra(page, {perfil: 'dir'});
        for(const ab of ABAS_CASC){
          if(!await vaiAba(page, ab)) continue;
          for(const k of await cardsK(page)){
            await page.click(`#lista .ind[data-k="${k}"]`);
            assert.deepEqual(await page.evaluate(corte), [], `${largura} ${tema} ${k}: gerências`);
            const pc = await page.evaluate(() => ({cab: !!(document.querySelector('#dCorpo .cOrd') || {}).offsetParent,
              chips: !!(document.querySelector('#dCorpo .cOrdCh') || {}).offsetParent}));
            if(k !== 'VENDAZERO') assert.deepEqual(pc, {cab: largura >= 1000, chips: largura < 1000}, `${largura} ${k}`);
            await page.click('#dCorpo .cLin[data-i]');
            assert.deepEqual(await page.evaluate(corte), [], `${largura} ${tema} ${k}: lista`);
            assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${largura} ${k}`);
            await page.keyboard.press('Escape');
          }
        }
        assert.deepEqual(erros, [], `${largura} ${tema}`);
        await ctx.close();
      }
    }
  });

  test('antes x depois (main antes da etapa, mesmo payload real): Executiva, Resumo e Venda Zero idênticos; cards e cascata iguais fora o que a etapa trocou',
       {skip: !FRONT_PRE_CASC && `sem o commit ${REF_PRE_CASC}`}, async () => {
    const [novo, velho] = [await abre(1440), await abre(1440, undefined, FRONT_PRE_CASC)];
    const linhas = [];
    for(const e of await perfisRotulos(novo.page)){
      for(const {page} of [novo, velho]) await entra(page, e);
      const onde = `${e.perfil}${e.gc ? ' ' + e.gc : ''}${e.sv ? ' ' + e.sv : ''}${e.rota ? ' ' + e.rota : ''}`;
      const comp = [];
      if(e.perfil !== 'rota'){
        for(const {page} of [novo, velho]) await vaiAba(page, 'EXEC');
        assert.equal(await novo.page.innerHTML('#exec'), await velho.page.innerHTML('#exec'), `${onde}: Executiva`);
        comp.push('Executiva');
      }
      let telas = 0, vz = 0;
      for(const ab of ABAS_CASC){
        const [ta, tb] = [await vaiAba(novo.page, ab), await vaiAba(velho.page, ab)];
        assert.equal(ta, tb, `${onde} ${ab}`);
        if(!ta) continue;
        const [a, b] = [await novo.page.evaluate(TELA_ABA), await velho.page.evaluate(TELA_ABA)];
        assert.deepEqual(CASC_INV.desfazCasc(a), b, `${onde} ${ab}: cabeçalho e cards (com a Diferença de antes)`);
        for(const k of await cardsK(novo.page)){
          for(const {page} of [novo, velho]) await page.click(`#lista .ind[data-k="${k}"]`);
          for(let nivel = 0; nivel < 5; nivel++){
            const [hn, hv] = [await novo.page.innerHTML('#drw'), await velho.page.innerHTML('#drw')];
            if(k === 'VENDAZERO'){ assert.equal(hn, hv, `${onde} Venda Zero nível ${nivel}`); vz++; }
            else assert.equal(CASC_INV.desfazCasc(hn), hv, `${onde} ${ab} ${k}: cascata nível ${nivel}`);
            telas++;
            if(e.perfil === 'dir' || !(await novo.page.$('#dCorpo .cLin[data-i]'))) break;
            for(const {page} of [novo, velho]) await page.click('#dCorpo .cLin[data-i]');
          }
          for(const {page} of [novo, velho]) await page.keyboard.press('Escape');
        }
        comp.push(`${ab} (${a.n} cards)`);
      }
      comp.push(`${telas} telas de cascata (${vz} da Venda Zero, HTML idêntico)`);
      if(e.perfil !== 'rota'){
        for(const {page} of [novo, velho]) await page.click('#btnResumo');
        assert.equal(await novo.page.innerHTML('#rsFolha'), await velho.page.innerHTML('#rsFolha'), `${onde}: Resumo`);
        for(const {page} of [novo, velho]) await page.click('#rsVoltar');
        comp.push('Resumo');
      }
      linhas.push([onde, comp.join(', ')]);
    }
    assert.deepEqual([...novo.erros, ...velho.erros], []);
    for(const {ctx} of [novo, velho]) await ctx.close();
    console.log(`# Antes x depois (main ${REF_PRE_CASC} x branch), mesmo payload real: Executiva, Resumo e Venda Zero idênticos; cards e cascata iguais fora a etapa`);
    console.log('# | Perfil | Comparado (igual) |');
    console.log('# |---|---|');
    for(const l of linhas) console.log(`# | ${l.join(' | ')} |`);
  });
});
