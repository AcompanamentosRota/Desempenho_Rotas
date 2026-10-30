/* Invariantes do "Abrir por" da aba Executiva (Etapa 5 do pacote v3: canal, clientes, Key Accounts e marca), conferidas no
   navegador com o filtro atual. Usadas pela Parte AI de front.test.js (dado sintético) e por conferencia_real.test.js (dado
   real). Não é um arquivo de teste: só exporta as funções. O esperado é recontado direto do payload (CLIENT_ROSTER, SEGS,
   VOLUME_CLIENTE, REDES_CLIENTE e o nó de cada rota em P.DATA), sem as funções novas do app.js. Universo (decisões da Karen de
   30/10/2026): total e Canal = as rotas do filtro sem as virtuais/EV* (com as ocultas, SV.G3.3); Clientes, Key Accounts e a busca
   = sem as ocultas também. Meta = soma da Meta NEG dos clientes (VOLUME_CLIENTE[r][pv][i][0]), Real = soma do Real ([1]).
   (b) Canal: Σ dos canais (os com Meta NEG > 0, mais os sem ela) = a linha de total (Meta NEG e Real) = todos os clientes do
       escopo; Meta do total / meta oficial (Σ da meta das rotas do filtro) = o X% da nota;
   (c) Clientes: em cada categoria, os 15 de maior Real entre os com Meta NEG (sem as ocultas), cada um com a Meta e o Real do
       VOLUME_CLIENTE; total = o do Canal;
   (d) Key Accounts: Real/Meta de cada KA = soma das lojas dela no escopo; as 15 maiores em Real; nenhuma loja em duas KAs;
   (e) nenhum valor de tendência nesses modos (linhas com data-tend vazio e "Tendência —" na dica; gaveta sem a barra da
       Tendência; detalhe da Evolução sem o mês anterior, com a nota);
   (f) Sem compra, Agenda e Coberturas (e os KPIs, quadros e medidores) iguais em todos os modos;
   Marca: só na Diretoria, com o aviso no lugar das barras, da gaveta e do detalhe da Evolução.
   O "modo padrão idêntico à main" (a) é o antes x depois de cada arquivo de teste. Devolve uma linha de resumo (só totais,
   contagens e o % da meta oficial; nunca nomes ou códigos de clientes). */
'use strict';
const assert = require('node:assert/strict');

const TOP = 15;
// o esperado do modo `ab` na categoria k, recontado do payload no filtro atual
const ESPERADO_DIM = ([ab, k]) => {
  const i = GROUPS.VOLUME.indexOf(k);
  const dir = sel.modo === 'dir', gc = dir ? sel.dgc : sel.gc, sv = dir ? '' : sel.sv;
  const virt = r => (P.VIRTUAIS_ROTAS || []).includes(r) || (P.EVENTUAIS_ROTAS || []).includes(r);
  const gcs = dir && !gc ? Object.keys(P.DATA) : (gc.includes('+') ? gc.split('+') : [gc]);
  const svDe = r => { for(const g of gcs) for(const s in P.DATA[g] || {}) if(r in P.DATA[g][s]) return s; return ''; };
  let rotas = gcs.flatMap(g => Object.values(P.DATA[g] || {}).flatMap(s => Object.keys(s)));
  if(sv === 'Neutraliza') rotas = rotas.filter(r => (P.NEUTRALIZA_ROTAS || []).includes(r));
  else if(sv) rotas = rotas.filter(r => svDe(r) === sv && !(P.NEUTRALIZA_ROTAS || []).includes(r) && !virt(r));
  const oficial = rotas.reduce((s, r) => { const b = (nodo('', r).indicators || {})[k]; return s + (b && !b.unavailable ? b.meta || 0 : 0); }, 0);
  const vis = rotas.filter(r => !virt(r));
  const oculta = r => { const s = svDe(r); return !(P.GC_SEM_OCULTAS || ['AT']).includes(s.split('.')[1]) && (P.OCULTAS || []).includes(s); };
  const lis = vis.filter(r => !oculta(r));
  const bl = (r, pv) => ((((P.VOLUME_CLIENTE || {})[r] || {})[pv]) || [])[i] || null;
  const clis = rs => rs.flatMap(r => (P.CLIENT_ROSTER[r] || []).map(c => ({r, c, b: bl(r, c[0])})).filter(x => x.b));
  const todos = clis(vis);
  const tot = {meta: todos.reduce((s, x) => s + x.b[0], 0), real: todos.reduce((s, x) => s + x.b[1], 0), n: todos.length};
  const top = ls => ls.filter(l => l.meta > 0).sort((p, q) => q.real - p.real || q.meta - p.meta || String(p.nome).localeCompare(String(q.nome))).slice(0, 15);
  let linhas, semMeta = {meta: 0, real: 0}, dup = 0;
  if(ab === 'canal'){
    const m = {};
    todos.forEach(x => { const s = P.SEGS[x.c[2]] || 'Sem segmento'; (m[s] = m[s] || {nome: s, meta: 0, real: 0}); m[s].meta += x.b[0]; m[s].real += x.b[1]; });
    linhas = Object.values(m).filter(l => l.meta > 0);
    Object.values(m).filter(l => !(l.meta > 0)).forEach(l => { semMeta.meta += l.meta; semMeta.real += l.real; });
  } else if(ab === 'cli'){
    linhas = top(clis(lis).map(x => ({nome: x.c[1], meta: x.b[0], real: x.b[1]})));
  } else {
    const kas = {}, visto = new Set();
    lis.forEach(r => { const gs = (P.REDES_CLIENTE || {})[r] || {};
      for(const key in gs){ (kas[key] = kas[key] || {nome: gs[key].nome, meta: 0, real: 0, lojas: 0});
        gs[key].clientes.forEach(pv => { const id = r + '|' + pv; if(visto.has(id)) dup++; visto.add(id);
          kas[key].lojas++; const b = bl(r, pv); if(b){ kas[key].meta += b[0]; kas[key].real += b[1]; } }); } });
    linhas = top(Object.values(kas));
  }
  return {k, nome: rotuloInd(k), oficial, tot, linhas, semMeta, dup, nCli: todos.length};
};
// o que a tela mostra no modo atual: a Tendência x Meta (uma coluna por categoria) e os blocos que não mudam
const LE_DIVS = () => ({tit: document.getElementById('exTDiv').textContent, sub: document.getElementById('exSDiv').textContent,
  cls: document.getElementById('exDivs').className, nota: (document.querySelector('#exDivs > .exNota') || {}).textContent || '',
  aviso: (document.querySelector('#exDivs .exAviso') || {}).textContent || '',
  dvs: [...document.querySelectorAll('#exDivs .dv')].map(d => ({k: d.dataset.k, oficial: Number(d.dataset.oficial), metaNeg: Number(d.dataset.metaNeg),
    nota: (d.querySelector('.dvNota') || {}).textContent || '',
    rows: [...d.querySelectorAll('.dRow')].map(r => ({u: r.dataset.u, tot: r.classList.contains('tot'), meta: Number(r.dataset.meta),
      real: Number(r.dataset.real), desvio: Number(r.dataset.desvio), tend: r.dataset.tend, dica: r.dataset.dica,
      nome: r.querySelector('.dNome').textContent, val: r.querySelector('.dVal').textContent}))})),
  botoes: [...document.querySelectorAll('#exAbrir .fchip')].map(b => [b.dataset.ab, b.textContent, b.getAttribute('aria-pressed')])});
const FIXOS = () => Object.fromEntries(['exSemc', 'exAgenda', 'exCob', 'exNBase', 'exNSem', 'exNVis', 'exNCat', 'exXCat', 'exFocoTxt',
  'exDiaTxt', 'exGauges'].map(id => [id, document.getElementById(id).innerHTML]));
const LE_GAV = () => ({aberta: document.getElementById('drw').classList.contains('on'), tit: document.getElementById('dTit').textContent,
  sub: document.getElementById('dSub').textContent, aviso: !!document.querySelector('#dCorpo .exAviso'),
  nota: (document.querySelector('#dCorpo .cuNota') || {}).textContent || '', b2: document.querySelectorAll('#dCorpo .cuB2').length,
  cards: [...document.querySelectorAll('#dCorpo .cuCard')].map(c => ({u: c.dataset.u, tot: c.classList.contains('cuTot'), meta: Number(c.dataset.meta),
    real: Number(c.dataset.real), tend: c.dataset.tend, st: c.dataset.st, vals: c.querySelector('.cuVals').textContent.replace(/\s+/g, ' ').trim()}))});
const LE_EVO = k => { const d = document.querySelector(`#exEvLinhas .evDet[data-k="${k}"]`);
  return d ? {nota: (d.querySelector('.evNota') || {}).textContent || '', aviso: !!d.querySelector('.exAviso'),
    linhas: [...d.querySelectorAll('.evLin.un')].map(l => ({u: l.dataset.u, pct: l.dataset.pct, ant: l.dataset.pctAnt, dpp: l.dataset.dpp,
      meta: Number(l.dataset.meta), real: Number(l.dataset.real), dTxt: l.querySelector('.evDN').textContent}))} : null; };

const quase = (a, b, onde) => assert.ok(Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b)), `${onde}: ${a} x ${b}`);
const pct1 = v => v.toLocaleString('pt-BR', {minimumFractionDigits: 1, maximumFractionDigits: 1});
const DIM = {canal: 'canal', cli: 'cliente', ka: 'Key Account'};
const clicaAbrir = (page, ab) => page.evaluate(ab => document.querySelector(`#exAbrir .fchip[data-ab="${ab}"]`).click(), ab);
const vaiExec = page => page.evaluate(() => { const t = document.querySelector('.tab[data-g="EXEC"]'); if(!t.classList.contains('on')) t.click(); });

// confere os modos no filtro atual (aba Executiva); devolve {onde, cats: {k: resumo}} (só totais, contagens e o % da meta oficial)
async function confereDimensoes(page, onde, {gaveta = true, evolucao = true} = {}){
  await vaiExec(page);
  await clicaAbrir(page, 'nivel');
  const fixos = await page.evaluate(FIXOS), dir = await page.evaluate(() => sel.modo === 'dir');
  const padrao = await page.evaluate(LE_DIVS);
  const nivTxt = padrao.botoes[0][1];
  // botões: o nível do filtro (padrão, marcado) · Canal · Marca (só na Diretoria) · Clientes · Key Accounts
  assert.deepEqual(padrao.botoes.map(b => b[0]), ['nivel', 'canal', ...(dir ? ['marca'] : []), 'cli', 'ka'], `${onde}: botões`);
  assert.deepEqual(padrao.botoes.slice(1).map(b => b[1]), ['Canal', ...(dir ? ['Marca'] : []), 'Clientes', 'Key Accounts'], `${onde}: rótulos`);
  assert.deepEqual(padrao.botoes.map(b => b[2]), padrao.botoes.map((b, i) => String(i === 0)), `${onde}: aria-pressed no padrão`);
  assert.match(padrao.tit, new RegExp(`por ${nivTxt.toLowerCase()}$`), `${onde}: título do padrão`);
  const cats = {}, ks = await page.evaluate(() => GROUPS.VOLUME), evoOn = evolucao && await page.evaluate(() => !document.getElementById('exEvo').hidden);
  for(const ab of ['canal', 'cli', 'ka', ...(dir ? ['marca'] : [])]){
    await clicaAbrir(page, ab);
    const t = await page.evaluate(LE_DIVS), o = `${onde} ${ab}`;
    assert.equal(t.botoes.find(b => b[2] === 'true')[0], ab, `${o}: botão marcado`);
    // (f) os blocos que não dependem do "Abrir por" ficam iguais
    assert.deepEqual(await page.evaluate(FIXOS), fixos, `${o}: Sem compra, Agenda, Coberturas, KPIs e medidores iguais`);
    if(ab === 'marca'){
      assert.equal(t.aviso, 'Marca: depende da descoberta no Datasphere', `${o}: aviso`);
      assert.equal(t.dvs.length, 0, `${o}: sem barras`);
      continue;
    }
    assert.equal(t.tit, `Realizado x Meta NEG por ${DIM[ab]}`, `${o}: título`);
    assert.match(t.sub, /Real ÷ Meta NEG − 1/, `${o}: subtítulo`);
    assert.match(t.nota, new RegExp(`Tendência por ${DIM[ab]} depende de dado novo`), `${o}: nota da tendência`);
    if(ab !== 'canal') assert.match(t.nota, /15 maiores em volume/, `${o}: nota dos 15 maiores`);
    for(const d of t.dvs){
      const e = await page.evaluate(ESPERADO_DIM, [ab, d.k]), oc = `${o} ${d.k}`;
      const tot = d.rows.filter(r => r.tot), us = d.rows.filter(r => !r.tot);
      // total = todos os clientes do escopo (o mesmo nos três modos)
      if(e.tot.meta > 0){
        assert.equal(tot.length, 1, `${oc}: uma linha de total`);
        quase(tot[0].meta, e.tot.meta, `${oc}: Meta NEG do total`);
        quase(tot[0].real, e.tot.real, `${oc}: Real do total`);
      }
      quase(d.oficial, e.oficial, `${oc}: meta oficial`);
      assert.equal(d.nota, `Meta = soma da Meta NEG dos clientes (${e.oficial > 0 ? pct1(e.tot.meta / e.oficial * 100) + '%' : '—'} da meta oficial em ${e.nome})`, `${oc}: nota do %`);
      // (b) / (c) / (d): as linhas = as recontadas
      assert.equal(us.length, e.linhas.length, `${oc}: número de linhas`);
      assert.ok(us.length <= TOP || ab === 'canal', `${oc}: no máximo ${TOP}`);
      const chave = l => `${l.meta.toFixed(4)}|${l.real.toFixed(4)}`;
      assert.deepEqual(us.map(chave).sort(), e.linhas.map(chave).sort(), `${oc}: Meta NEG e Real de cada linha`);
      assert.deepEqual(us.map(r => r.u).sort(), e.linhas.map(l => l.nome).sort(), `${oc}: nomes das linhas`);
      if(ab === 'canal'){
        quase(us.reduce((s, r) => s + r.meta, 0) + e.semMeta.meta, tot[0].meta, `${oc}: Σ Meta NEG dos canais = total`);
        quase(us.reduce((s, r) => s + r.real, 0) + e.semMeta.real, tot[0].real, `${oc}: Σ Real dos canais = total`);
      }
      if(ab === 'ka') assert.equal(e.dup, 0, `${oc}: loja em duas KAs`);
      // desvio = Real ÷ Meta NEG − 1, do maior para o menor; (e) sem tendência
      d.rows.forEach(r => quase(r.desvio, r.real / r.meta - 1, `${oc} desvio`));
      for(let j = 1; j < d.rows.length; j++) assert.ok(d.rows[j - 1].desvio >= d.rows[j].desvio, `${oc}: ordem`);
      assert.ok(d.rows.every(r => r.tend === '' && /Tendência —/.test(r.dica)), `${oc}: sem tendência`);
      cats[d.k] = cats[d.k] || {pctOf: e.oficial > 0 ? pct1(e.tot.meta / e.oficial * 100) : '—', nCli: e.nCli};
      cats[d.k][ab] = us.length;
      // gaveta da categoria (medidor) no mesmo modo: os mesmos números, sem a barra da Tendência
      if(gaveta && d.k === ks[0] && e.tot.meta > 0 && !(await page.$eval(`#exGauges .gCard[data-k="${d.k}"]`, g => g.classList.contains('off')))){
        await page.click(`#exGauges .gCard[data-k="${d.k}"]`);
        const g = await page.evaluate(LE_GAV);
        assert.ok(g.aberta, `${oc}: gaveta`);
        assert.equal(g.tit, `${e.nome} por ${DIM[ab]}`, `${oc}: título da gaveta`);
        assert.equal(g.b2, 0, `${oc}: gaveta sem a barra da Tendência`);
        assert.ok(g.cards.every(c => c.tend === '' && c.st !== 'tend'), `${oc}: gaveta sem tendência`);
        const [gt, ...gu] = g.cards;
        assert.ok(gt.tot, `${oc}: total primeiro`);
        quase(gt.meta, e.tot.meta, `${oc}: gaveta Meta NEG do total`); quase(gt.real, e.tot.real, `${oc}: gaveta Real do total`);
        assert.deepEqual(gu.map(chave).sort(), e.linhas.map(chave).sort(), `${oc}: gaveta = as linhas`);
        assert.ok(gu.every(c => c.st === (c.real >= c.meta ? 'bat' : 'abx')), `${oc}: cor`);
        assert.ok(g.nota.includes('Meta NEG'), `${oc}: nota da gaveta`);
        await page.keyboard.press('Escape');
        // padrão de novo continua com os cartões de unidade (com a Tendência, fora do fechamento)
      }
      // detalhe da Evolução: só o mês atual
      if(evoOn && d.k === ks[0]){
        await page.evaluate(k => { const el = document.querySelector(`#exEvLinhas .evLin.cat[data-k="${k}"]`); if(el.getAttribute('aria-expanded') !== 'true') el.click(); }, d.k);
        const ev = await page.evaluate(LE_EVO, d.k);
        assert.ok(ev, `${oc}: detalhe da Evolução`);
        assert.equal(ev.nota, `O mês anterior por ${DIM[ab]} depende de dado novo. % = Real ÷ Meta NEG dos clientes.`, `${oc}: nota da Evolução`);
        assert.deepEqual(ev.linhas.map(chave).sort(), e.linhas.map(chave).sort(), `${oc}: Evolução = as linhas`);
        assert.ok(ev.linhas.every(l => l.ant === '' && l.dpp === '' && l.dTxt === '—'), `${oc}: sem o mês anterior`);
        ev.linhas.forEach(l => quase(Number(l.pct), l.real / l.meta * 100, `${oc}: % atual`));
      }
    }
  }
  if(dir){
    // marca: gaveta e Evolução com o aviso
    await clicaAbrir(page, 'marca');
    const k = ks[0];
    if(gaveta && !(await page.$eval(`#exGauges .gCard[data-k="${k}"]`, g => g.classList.contains('off')))){
      await page.click(`#exGauges .gCard[data-k="${k}"]`);
      const g = await page.evaluate(LE_GAV);
      assert.ok(g.aberta && g.aviso && g.cards.length === 0, `${onde} marca: gaveta com o aviso`);
      await page.keyboard.press('Escape');
    }
    if(evoOn){
      const ev = await page.evaluate(LE_EVO, k);
      assert.ok(ev && ev.aviso && !ev.linhas.length, `${onde} marca: Evolução com o aviso`);
    }
  }
  // volta ao padrão: igual ao de antes
  await clicaAbrir(page, 'nivel');
  assert.deepEqual(await page.evaluate(LE_DIVS), padrao, `${onde}: padrão de volta`);
  return {onde, cats};
}

module.exports = {confereDimensoes, ESPERADO_DIM, LE_DIVS, LE_GAV, LE_EVO, FIXOS, clicaAbrir, TOP};
