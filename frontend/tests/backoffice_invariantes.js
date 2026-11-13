/* Invariantes do Back Office (Frente 1), usadas pela conferência com DADO REAL (conferencia_real.test.js).

   A recontagem aqui é INDEPENDENTE: lê o payload.json e o online.json como objetos, soma na mão e NÃO usa nenhuma
   função do front (nem agrega, nem NUCLEO, nem realOnline, nem metricas). É isso que dá valor à conferência: se o
   Back Office e esta recontagem baterem, o caminho do front e a leitura crua do dado dizem o mesmo.

   (a) Por gerência e por categoria: Meta, Real, Real + Online e % da tela (os data-* exatos das linhas) = a
       recontagem.
   (b) A soma das 16 gerências = o card da Diretoria (só no teste; o Back Office nunca soma nada). No Todos a Bordo a
       diferença é esperada e é EXATAMENTE o Real das rotas que entram no escopo da BAND e em nenhuma gerência (rota
       de meta 0 com Real numa gerência sem nenhuma rota com meta do item: a BAND soma, a gerência mostra "Exclusivo
       portfólio Full"); a conferência calcula esse valor e exige a igualdade.
   (c) O Excel = a tela, célula a célula (feito no próprio teste, que tem a biblioteca).

   Nada daqui imprime nome ou código de cliente: só totais e códigos de gerência, supervisão e rota. */
'use strict';

const CATS = [['VOLUME', 'Volume'], ['ICS_GC', 'ICS GC'], ['NOVOS_NEG', 'Novos Negócios'], ['INCENTIVO', 'Todos a Bordo']];

/* índice rota -> nó e rota -> gerência, direto do payload */
function indices(P){
  const nodo = {}, gcDe = {};
  for(const gc in P.DATA) for(const sv in P.DATA[gc]) for(const r in P.DATA[gc][sv]){ nodo[r] = P.DATA[gc][sv][r]; gcDe[r] = gc; }
  return {nodo, gcDe};
}
const rotasDaGc = (P, gc) => Object.values(P.DATA[gc] || {}).flatMap(svs => Object.keys(svs));
const ehVolume = (P, k) => (P.GROUPS.VOLUME || []).includes(k) || Object.keys(P.VOLUME_EXTRA || {}).includes(k);
const bloco = (idx, r, k) => ((idx.nodo[r] || {}).indicators || {})[k];
const disponivel = (idx, r, k) => { const b = bloco(idx, r, k); return !!b && !b.unavailable; };

/* categorias da tela: os 5 macros de Volume e os itens de ICS GC (sem a Venda Zero e sem Imperdoáveis quando o
   indicador não tem fonte), Novos Negócios e Todos a Bordo */
function categorias(P, idx, rotas){
  const temFonte = k => rotas.some(r => disponivel(idx, r, k));
  return CATS.map(([g, titulo]) => {
    let itens = (P.GROUPS[g] || []).slice();
    if(g === 'ICS_GC') itens = itens.filter(k => k !== 'VENDAZERO' && !(k === 'IMPERDOAVEIS' && !temFonte(k)));
    return {g, titulo, itens};
  }).filter(c => c.itens.length);
}

/* Todos a Bordo: o escopo só tem o item se alguma rota dele tem meta > 0; aí somam todas as rotas com o item
   disponível (meta 0 com o Real e a oculta das EV* entram). A mesma regra do painel, recontada aqui. */
function rotasInc(P, idx, k, rotas){
  const comMeta = r => { const b = bloco(idx, r, k); return !!b && !b.unavailable && b.meta > 0; };
  return rotas.some(comMeta) ? rotas.filter(r => disponivel(idx, r, k)) : [];
}

/* Soma de um indicador num conjunto de rotas, do jeito mais direto possível. Devolve null quando nenhuma rota tem o
   indicador (a tela mostra "indisponível"). `ro` = Real + online de hoje: no volume, o volume online da rota; nas
   coberturas, os clientes do online que ainda não estavam cobertos (a conta de realMaisOnline). null no fechamento
   e sem online.json, como o realOnline do painel. */
function soma(P, ONLINE, idx, k, rotas){
  const vol = ehVolume(P, k), fech = !!P.FECHAMENTO;
  let meta = 0, real = 0, tend = 0, ro = 0, n = 0;
  for(const r of rotas){
    const b = bloco(idx, r, k);
    if(!b || b.unavailable) continue;
    n++; meta += b.meta || 0; real += b.real || 0;
    if(vol){
      tend += b.tendencia || 0;
      ro += (b.real || 0) + ((((ONLINE.volume || {})[r] || {})[k]) || 0);
    } else {
      const cob = new Set((((P.COBERTOS || {})[r] || {})[k]) || []);
      const hoje = (((ONLINE.clientes || {})[r] || {})[k]) || [];
      ro += (b.real || 0) + hoje.filter(pv => !cob.has(pv)).length;
    }
  }
  if(!n) return null;
  const pct = !meta ? null : vol ? (fech ? Math.round(real / meta * 100) : Math.round(tend / meta * 100))
                                 : Math.round(real / meta * 100);
  return {meta, real, tend: fech ? null : tend, ro: fech || !ONLINE ? null : ro, pct, n};
}

/* lê as linhas do Back Office com os valores exatos (data-*) e o texto de cada célula */
const LE_BO = () => [...document.querySelectorAll('#bo .boCat')].map(sec => ({
  g: sec.dataset.g, k: sec.dataset.k, tit: sec.querySelector('.boCatTit').textContent,
  cab: [...sec.querySelectorAll('thead th')].map(t => t.textContent),
  linhas: [...sec.querySelectorAll('tbody tr')].map(tr => ({
    off: !!tr.querySelector('.boOff'),
    msg: tr.querySelector('.boOff') ? tr.querySelector('.boOff').textContent : '',
    gc: tr.dataset.gc || '',
    nome: (tr.querySelector('.boUn b') || {}).textContent || '',
    meta: tr.dataset.meta === undefined ? null : Number(tr.dataset.meta),
    real: tr.dataset.real === undefined ? null : Number(tr.dataset.real),
    ro: tr.dataset.ro ? Number(tr.dataset.ro) : (tr.dataset.ro === '' ? null : undefined),
    dir: tr.dataset.dir ? Number(tr.dataset.dir) : (tr.dataset.dir === '' ? null : undefined),
    nums: [...tr.querySelectorAll('td.boNum')].map(td => td.textContent),
  })),
}));

const perto = (a, b, tol = 0.05) => a == null && b == null ? true : a != null && b != null && Math.abs(a - b) <= tol;

/* (a) Confere a tela do Back Office (nível Gerência, escopo já escolhido) contra a recontagem independente.
   `gcs` = as gerências do escopo, na ordem. Devolve as linhas da tabela-resumo do PR (só códigos e totais). */
async function confereBackOffice(page, P, ONLINE, gcs, onde){
  const assert = require('node:assert/strict');
  const idx = indices(P);
  const tabelas = await page.evaluate(LE_BO);
  const resumo = [];
  const cats = categorias(P, idx, gcs.flatMap(g => rotasDaGc(P, g)));
  assert.deepEqual(tabelas.map(t => `${t.g}/${t.k}`), cats.flatMap(c => c.itens.map(k => `${c.g}/${k}`)),
    `${onde}: as categorias da tela, na ordem do painel`);
  for(const t of tabelas){
    const inc = t.g === 'INCENTIVO';
    /* No nível Gerência é sempre uma linha por gerência do escopo, na ordem, sem total e sem soma: a gerência sem
       nenhuma rota com meta do item do Todos a Bordo entra com a linha "Exclusivo portfólio Full" / "Sem meta", como
       o card da aba (ex.: a G3, que é BARRACUDA, no Heineken). */
    assert.equal(t.linhas.length, gcs.length, `${onde} ${t.g}/${t.k}: uma linha por gerência (sem total)`);
    assert.deepEqual(t.linhas.map(l => l.gc || null).filter(Boolean),
      gcs.filter(g => t.linhas.some(l => l.gc === g)), `${onde} ${t.g}/${t.k}: gerências na ordem do escopo`);
    for(const l of t.linhas) if(l.off && inc)
      assert.equal(rotasInc(P, idx, t.k, rotasDaGc(P, l.gc || '')).length, 0,
        `${onde} ${t.g}/${t.k}: linha sem dado só onde não há rota com meta do item`);
    for(const l of t.linhas){
      if(l.off) continue;                       // "indisponível", "sem dados" ou "Exclusivo portfólio Full"
      const rs = inc ? rotasInc(P, idx, t.k, rotasDaGc(P, l.gc)) : rotasDaGc(P, l.gc);
      const s = soma(P, ONLINE, idx, t.k, rs);
      assert.ok(s, `${onde} ${t.g}/${t.k} ${l.gc}: a recontagem tem dado`);
      assert.ok(perto(l.meta, s.meta), `${onde} ${t.g}/${t.k} ${l.gc}: Meta ${l.meta} x ${s.meta}`);
      assert.ok(perto(l.real, s.real), `${onde} ${t.g}/${t.k} ${l.gc}: Real ${l.real} x ${s.real}`);
      assert.ok(perto(l.ro, s.ro), `${onde} ${t.g}/${t.k} ${l.gc}: Real + Online ${l.ro} x ${s.ro}`);
      assert.equal(l.dir, s.pct, `${onde} ${t.g}/${t.k} ${l.gc}: %`);
      resumo.push({onde, cat: t.k, gc: l.gc, meta: s.meta, real: s.real, ro: s.ro, pct: s.pct});
    }
  }
  return resumo;
}

/* (b) Reconciliação: a soma das gerências x o card da Diretoria (BAND). No Todos a Bordo a diferença esperada é o
   Real das rotas que entram no escopo da BAND e em nenhuma gerência. Devolve as linhas da tabela do PR. */
function reconcilia(P, ONLINE, gcs){
  const idx = indices(P);
  const todas = gcs.flatMap(g => rotasDaGc(P, g));
  const linhas = [];
  for(const c of categorias(P, idx, todas)) for(const k of c.itens){
    const inc = c.g === 'INCENTIVO';
    const band = soma(P, ONLINE, idx, k, inc ? rotasInc(P, idx, k, todas) : todas);
    let real = 0, ro = 0, meta = 0, algum = false;
    const naGc = new Set();
    for(const g of gcs){
      const rs = inc ? rotasInc(P, idx, k, rotasDaGc(P, g)) : rotasDaGc(P, g);
      rs.forEach(r => naGc.add(r));
      const s = soma(P, ONLINE, idx, k, rs);
      if(!s) continue;
      algum = true; meta += s.meta; real += s.real; if(s.ro != null) ro += s.ro;
    }
    if(!band || !algum) continue;
    // o que a BAND soma e nenhuma gerência soma (só acontece no Todos a Bordo)
    const fora = inc ? rotasInc(P, idx, k, todas).filter(r => !naGc.has(r)) : [];
    const sFora = fora.length ? soma(P, ONLINE, idx, k, fora) : null;
    linhas.push({cat: k, grupo: c.g, meta, metaBand: band.meta, real, realBand: band.real,
      ro: band.ro == null ? null : ro, roBand: band.ro, fora: fora.length, realFora: sFora ? sFora.real : 0,
      rotasFora: fora.slice(0, 8)});
  }
  return linhas;
}

module.exports = {CATS, indices, rotasDaGc, categorias, rotasInc, soma, LE_BO, confereBackOffice, reconcilia, perto};
