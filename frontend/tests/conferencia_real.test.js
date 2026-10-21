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
   fundos da entrada. */
'use strict';
const {test, before, after, describe} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {execSync} = require('node:child_process');
const {confereExecutiva} = require('./executiva_invariantes.js');
const {confereGavetas, leChips} = require('./gavetas_invariantes.js');

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

// tema = fundo da entrada guardado ('preta' | 'branca'; sem ele, o padrão)
async function abre(largura = 1440, tema){
  const ctx = await browser.newContext({viewport: {width: largura, height: 1000}});
  const page = await ctx.newPage();
  if(tema) await page.addInitScript(t => { try { localStorage.setItem('drotas_entrada', t); } catch(e){} }, tema);
  const erros = [];
  page.on('pageerror', e => erros.push(String(e)));
  page.on('console', m => { if(m.type() === 'error') erros.push(m.text()); });
  await page.route('http://painel.test/**', rota => {
    const url = new URL(rota.request().url());
    const arq = url.pathname === '/data/payload.json' ? PAYLOAD : url.pathname === '/data/online.json' ? ONLINE
      : path.join(FRONT, url.pathname);
    if(!fs.existsSync(arq)) return rota.fulfill({status: 404, body: ''});
    rota.fulfill({status: 200, contentType: TIPOS[path.extname(arq)] || 'application/octet-stream', body: fs.readFileSync(arq)});
  });
  await page.route(/cdnjs\.cloudflare\.com/, r => r.abort());
  await page.goto('http://painel.test/index.html');
  await page.waitForFunction(() => typeof P !== 'undefined' && P && document.getElementById('carga').hidden);
  return {page, ctx, erros};
}
// entra pela tela de entrada (a casa volta para ela): {perfil: 'dir'} | {perfil: 'gc', gc} | {perfil: 'sv', gc, sv}
async function entra(page, {perfil, gc, sv}){
  if(await page.isHidden('#entrada')) await page.click('#btnCasa');
  await page.click(`#entrada [data-perfil="${perfil}"]`);
  if(perfil === 'dir') return;
  await page.click(`#entOpcoes [data-gc="${gc}"]`);
  if(perfil === 'sv') await page.click(`#entOpcoes [data-sv="${sv}"]`);
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
  test(`${largura} px, fundos preto e branco: sem rolagem lateral nem erro no console (abas, cascata de volume, gavetas com a barra)`, async () => {
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
