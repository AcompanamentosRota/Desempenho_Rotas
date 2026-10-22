/* Invariantes do bloco "Evolução contra o mês anterior" da aba Executiva (só Volume; barras pareadas desde o redesenho
   de 22/10/2026), conferidas no navegador com o filtro atual. Usadas pela Parte Z de front.test.js (dado sintético) e por
   conferencia_real.test.js (dado real). Não é um arquivo de teste: só exporta as funções. Abre todas as categorias (o
   clique da própria linha) e confere a linha de cada categoria (o total do escopo) e as unidades abertas embaixo dela. O
   mês anterior é recontado direto de MES_ANTERIOR.ROTAS (sem NUCLEO.mesAnterior) e o mês de referência sai do agrega()
   das rotas (o mesmo dos medidores):
   (a) Real e Meta do mês de referência na linha da categoria = Real e Meta do medidor da mesma categoria (e o texto
       dele); em cada unidade, = agrega() das rotas dela;
   (b) % do mês de referência = Real / Meta e % anterior = Real anterior / Meta anterior; na tela, 1 casa ("—" sem meta);
   (c) Δ p.p. = % atual - % anterior, com seta e cor pelo sinal exato (▲ subiu, ▼ caiu, 0,0 cinza sem seta) e 1 casa;
       unidades por Δ decrescente, as "—" no fim; categorias na ordem de GROUPS.VOLUME, com o rótulo central (rotuloInd);
   (d) Real anterior de cada unidade = a soma direta das rotas dela; Σ unidades (com a linha Neutraliza) + as rotas fora
       das unidades (virtuais, "{GC}-EV", ocultas) = Real anterior da linha da categoria; o mesmo para a Meta; na
       Diretoria com "Todas as gerências", a linha da categoria = a soma de MES_ANTERIOR.ROTAS inteira;
   (e) sem meta anterior na categoria (ou sem meta no mês de referência) = "—" no Δ, cinza; sem meta anterior, "—" no %
       anterior e a barra hachurada vazia;
   (f) largura das barras = o % (limitada a 0-100% da trilha): em cima o mês de referência, embaixo o anterior.
   Devolve uma linha de resumo (só totais e códigos). */
'use strict';
const assert = require('node:assert/strict');

// abre todas as categorias do bloco (clique na própria linha; as abertas ficam)
const ABRE_TODAS = () => document.querySelectorAll('#exEvLinhas .evLin.cat[aria-expanded="false"]').forEach(l => l.click());
const LE_EVO = () => {
  const M = P.MES_ANTERIOR;
  const direto = (rs, k) => { const i = M.IND.indexOf(k), a = {real: 0, meta: 0, n: 0};
    rs.forEach(r => { const x = (M.ROTAS[r] || [])[i]; if(x){ a.real += x[0]; a.meta += x[1]; a.n++; } }); return a; };
  const ctx = ctxInicial(), us = unidadesExec(ctx), todas = rotasAtuais();
  const dentro = new Set(us.flatMap(u => u.rotas));
  const fora = todas.filter(r => !dentro.has(r));
  const n = v => v === '' || v == null ? null : Number(v);
  const le = r => ({u: r.dataset.u, k: r.dataset.k, dpp: n(r.dataset.dpp), pct: n(r.dataset.pct), pctAnt: n(r.dataset.pctAnt),
    real: n(r.dataset.real), meta: n(r.dataset.meta), realAnt: n(r.dataset.realAnt), metaAnt: n(r.dataset.metaAnt),
    nome: r.querySelector('.evTxt').textContent, pa: r.querySelector('.evPA').textContent, pb: r.querySelector('.evPB').textContent,
    d: r.querySelector('.evDN').textContent, pp: (r.querySelector('.evD small') || {}).textContent || '', cls: r.querySelector('.evD').className,
    barras: [...r.querySelectorAll('.evTr i')].map(i => [i.className, parseFloat(i.style.width)]), aria: r.getAttribute('aria-expanded')});
  const agr = rs => { const a = agrega(rs); return Object.fromEntries(GROUPS.VOLUME.map(k => { const b = a.ind[k];
    return [k, b && !b.unavailable && b.meta > 0 ? {real: b.real, meta: b.meta} : null]; })); };
  const agrUs = Object.fromEntries(us.map(u => [u.cod, agr(u.rotas)])), agrTot = agr(todas);
  return {
    vis: !document.getElementById('exEvo').hidden && document.getElementById('exEvo').getClientRects().length > 0,
    band: sel.modo === 'dir' && !sel.dgc, fora: fora.length, unidades: us.map(u => u.cod),
    totCod: (document.querySelector('#exDivs .dRow.tot') || {dataset: {}}).dataset.u || null,
    gauges: Object.fromEntries([...document.querySelectorAll('#exGauges .gCard')].map(g => [g.dataset.k,
      [...g.querySelectorAll('.gMR b')].map(b => b.textContent)])),
    ordem: [...document.querySelectorAll('#exEvLinhas .evLin.cat')].map(l => l.dataset.k),
    rotulos: GROUPS.VOLUME.map(rotuloInd),
    cats: GROUPS.VOLUME.map(k => {
      const cat = document.querySelector(`#exEvLinhas .evLin.cat[data-k="${k}"]`), det = document.getElementById(cat.getAttribute('aria-controls'));
      return {k, b: agrTot[k], tudo: direto(Object.keys(M.ROTAS), k), foraAnt: direto(fora, k), totAnt: direto(todas, k),
        un: Object.fromEntries(us.map(u => [u.cod, {ant: direto(u.rotas, k), atu: agrUs[u.cod][k]}])),
        tot: le(cat), aberta: !det.hidden, detK: det.dataset.k, linhas: [...det.querySelectorAll('.evLin')].map(le)};
    }),
  };
};
const br = (v, c) => v.toLocaleString('pt-BR', {minimumFractionDigits: c, maximumFractionDigits: c});
// o Δ na linha: seta pelo sinal exato e o número com 1 casa e o sinal ("0,0" sem seta com 0; "—" sem dado)
const fmtDpp = d => d === 0 ? '0,0' : `${d > 0 ? '+' : '−'}${br(Math.abs(d), 1)}`;
const textoD = d => d == null ? '—' : `${d > 0 ? '▲ ' : d < 0 ? '▼ ' : ''}${fmtDpp(d)}`;
const pctTxt = v => v == null ? '—' : `${br(v, 1)}%`;
const perto = (a, b, onde) => assert.ok(Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b)), `${onde}: ${a} x ${b}`);
const cheia = p => p == null ? 0 : Math.max(0, Math.min(100, p));

// uma linha (categoria ou unidade): (b), (c) na linha, (e) e (f); devolve se tem Δ
function confereLinha(l, lo){
  const temB = l.meta > 0, temA = l.metaAnt > 0, ok = temB && temA;
  if(temB) perto(l.pct, l.real / l.meta * 100, `${lo}: % atual`); else assert.equal(l.pct, null, `${lo}: % atual sem meta`);
  if(temA) perto(l.pctAnt, l.realAnt / l.metaAnt * 100, `${lo}: % anterior`); else assert.equal(l.pctAnt, null, `${lo}: % anterior sem meta`);
  assert.equal(l.pa, pctTxt(l.pct), `${lo}: % atual na tela`);
  assert.equal(l.pb, pctTxt(l.pctAnt), `${lo}: % anterior na tela`);
  if(!ok){
    assert.deepEqual([l.dpp, l.d, l.pp], [null, '—', ''], `${lo}: sem meta = "—"`);
    assert.match(l.cls, /\bnd\b/, lo);
  } else {
    perto(l.dpp, l.pct - l.pctAnt, `${lo}: Δ p.p.`);
    assert.equal(l.d, textoD(l.dpp), `${lo}: Δ na tela`);
    assert.equal(l.pp, 'p.p.', lo);
    assert.match(l.cls, l.dpp > 0 ? /\bpos\b/ : l.dpp < 0 ? /\bneg\b/ : /\bzero\b/, `${lo}: cor pelo sinal exato`);
  }
  // (f) duas barras: em cima o mês de referência (sólida), embaixo o anterior (hachurada); largura = % limitado a 100
  assert.deepEqual(l.barras.map(b => b[0]), ['atu', 'ant'], `${lo}: barras`);
  assert.ok(Math.abs(l.barras[0][1] - cheia(l.pct)) < 0.006, `${lo}: barra atual ${l.barras[0][1]} x ${l.pct}`);
  assert.ok(Math.abs(l.barras[1][1] - cheia(l.pctAnt)) < 0.006, `${lo}: barra anterior ${l.barras[1][1]} x ${l.pctAnt}`);
  return ok;
}

async function confereEvolucao(page, onde){
  await page.evaluate(() => document.querySelector('.tab[data-g="EXEC"]').click());
  await page.evaluate(ABRE_TODAS);
  const ev = await page.evaluate(LE_EVO);
  assert.ok(ev.vis, `${onde}: bloco visível`);
  assert.deepEqual(ev.ordem, ['VOL REFRIGERANTES', 'VOL CERVEJAS', 'VOL STILL', 'VOL AGUA MINERAL', 'VOL DEST+ART+CND'], `${onde}: ordem fixa`);
  const res = {onde, cats: {}};
  for(const [i, c] of ev.cats.entries()){
    const o = `${onde} ${c.k}`, tot = c.tot, uns = c.linhas;
    assert.equal(tot.nome, ev.rotulos[i], `${o}: rótulo central`);
    assert.ok(c.aberta && c.detK === c.k && tot.aria === 'true', `${o}: aberta`);
    if(ev.totCod) assert.equal(tot.u, ev.totCod, `${o}: o mesmo total da Tendência x Meta`);
    // (a) mês de referência = medidor (total) e agrega() de cada unidade
    if(c.b){
      assert.equal(tot.real, c.b.real, `${o}: Real do total x agrega`);
      assert.equal(tot.meta, c.b.meta, `${o}: Meta do total x agrega`);
      assert.deepEqual(ev.gauges[c.k], [Math.round(tot.meta).toLocaleString('pt-BR'), Math.round(tot.real).toLocaleString('pt-BR')],
        `${o}: Meta | Real do medidor`);
    } else assert.deepEqual([tot.real, tot.meta], [null, null], `${o}: sem meta no escopo`);
    // as unidades do escopo (as da Tendência x Meta), cada uma uma vez
    assert.deepEqual(uns.map(l => l.u).sort(), [...ev.unidades].sort(), `${o}: unidades`);
    for(const l of uns){
      const d = c.un[l.u], lo = `${o} ${l.u}`;
      assert.equal(l.k, c.k, lo);
      if(d.atu){ assert.equal(l.real, d.atu.real, `${lo}: Real x agrega`); assert.equal(l.meta, d.atu.meta, `${lo}: Meta x agrega`); }
      else assert.deepEqual([l.real, l.meta], [null, null], `${lo}: sem meta`);
      // (d) anterior por unidade = soma direta das rotas
      perto(l.realAnt == null ? 0 : l.realAnt, d.ant.n ? d.ant.real : 0, `${lo}: Real anterior`);
      perto(l.metaAnt == null ? 0 : l.metaAnt, d.ant.n ? d.ant.meta : 0, `${lo}: Meta anterior`);
    }
    // (d) Σ unidades + rotas fora = total; total = payload; BAND = MES_ANTERIOR.ROTAS inteira
    const soma = f => uns.reduce((s, l) => s + (l[f] || 0), 0);
    perto(soma('realAnt') + c.foraAnt.real, tot.realAnt || 0, `${o}: Σ Real anterior das unidades + rotas fora x total`);
    perto(soma('metaAnt') + c.foraAnt.meta, tot.metaAnt || 0, `${o}: Σ Meta anterior das unidades + rotas fora x total`);
    perto(tot.realAnt || 0, c.totAnt.real, `${o}: Real anterior do total x payload`);
    if(ev.band){ perto(tot.realAnt, c.tudo.real, `${o}: BAND Real anterior`); perto(tot.metaAnt, c.tudo.meta, `${o}: BAND Meta anterior`); }
    // (b), (c), (e), (f): a linha da categoria e cada unidade; unidades por Δ decrescente, "—" no fim
    confereLinha(tot, `${o} total`);
    let antes = Infinity, viuNd = false;
    for(const l of uns){
      const ok = confereLinha(l, `${o} ${l.u}`);
      if(!ok){ viuNd = true; continue; }
      assert.ok(!viuNd, `${o} ${l.u}: linha com Δ depois de um "—"`);
      assert.ok(l.dpp <= antes, `${o} ${l.u}: ordem decrescente`);
      antes = l.dpp;
    }
    res.cats[c.k] = tot.dpp == null ? '—' : `${tot.d} p.p. (${tot.pb} → ${tot.pa})`;
    if(c.k === 'VOL REFRIGERANTES') Object.assign(res, {realAnt: Math.round(tot.realAnt || 0), metaAnt: Math.round(tot.metaAnt || 0),
      real: Math.round(tot.real || 0), unidades: uns.length, nd: uns.filter(l => l.dpp == null).length});
  }
  res.fora = ev.fora;
  return res;
}

module.exports = {confereEvolucao, confereLinha, LE_EVO, ABRE_TODAS, fmtDpp, textoD, pctTxt};
