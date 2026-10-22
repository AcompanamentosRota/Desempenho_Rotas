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
   Evolução contra o mês anterior (Etapa 8c; invariantes em evolucao_invariantes.js): a Diretoria, cada gerência com dados
   (filtro da Diretoria), cada grupo no Total e uma supervisão: Real e Meta do total = medidor; % e Δ p.p.; Σ unidades + rotas
   fora delas (virtuais, "{GC}-EV", ocultas) = total; BAND = MES_ANTERIOR.ROTAS inteira; sem meta anterior = "—". Pula o
   bloco se o payload não tiver MES_ANTERIOR. */
'use strict';
const {test, before, after, describe} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {execSync} = require('node:child_process');
const {confereExecutiva} = require('./executiva_invariantes.js');
const {confereGavetas, leChips} = require('./gavetas_invariantes.js');
const {confereEvolucao} = require('./evolucao_invariantes.js');
const ROT = require('./rotulos_invariantes.js');
const {trocaHash, digitaSenha} = require('./senha_teste.js');

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
    if(url.pathname === '/js/config.js') body = trocaHash(body);     // senha da Diretoria: hashes de teste (senha_teste.js)
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
// (fora das áreas com rolagem própria: a fila de chips rola de lado no celular)
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
        // Evolução contra o mês anterior (Etapa 8c): nenhum texto cortado no bloco, em cada categoria (chips no celular)
        if(await page.evaluate(() => !!P.MES_ANTERIOR)){
          await page.evaluate(() => document.querySelector('.tab[data-g="EXEC"]').click());
          for(const k of await page.evaluate(() => GROUPS.VOLUME)){
            if(largura < 1000) await page.click(`#exEvChips .fchip[data-k="${k}"]`);
            assert.deepEqual(await page.evaluate(ESTOUROS_EVO), [], `${onde} evolução ${k}`);
            assert.ok(await rola(), `${onde} evolução ${k}`);
          }
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

describe('Evolução contra o mês anterior com dado real (Etapa 8c)', {skip: pular}, () => {
  for(const largura of [1440, 390])
  test(`${largura} px: Diretoria, cada gerência, cada grupo no Total e uma supervisão: invariantes (a) a (e)`, async (t) => {
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
    const [novo, velho] = [await abre(1440), await abre(1440, undefined, FRONT_PRE_ROTULOS)];
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
        assert.deepEqual(a, ROT.comNomeNovo(b), `${onde} ${ab}`);
        comp.push(`${ab} (${a.lista.length || 'visão executiva'})`);
        // gavetas: o macro de volume e o 1º card de cada aba de coberturas
        const k = ab === 'VOLUME' ? ROT.K_NOVOS : ab === 'EXEC' ? null : await novo.page.$eval('#lista .ind[data-k]', x => x.dataset.k).catch(() => null);
        if(!k || !(await novo.page.$(`#lista .ind[data-k="${k}"]`))) continue;
        const gav = async p => { await p.click(`#lista .ind[data-k="${k}"]`);
          const t = await p.evaluate(() => [document.getElementById('dTit').textContent, document.getElementById('dCorpo').textContent]);
          await p.keyboard.press('Escape'); return t; };
        assert.deepEqual(await gav(novo.page), ROT.comNomeNovo(await gav(velho.page)), `${onde} ${ab} gaveta ${k}`);
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
