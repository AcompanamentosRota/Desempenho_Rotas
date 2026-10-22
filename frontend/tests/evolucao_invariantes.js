/* Invariantes do bloco "Evolução contra o mês anterior" da aba Executiva (Etapa 8c, só Volume), conferidas no navegador
   com o filtro atual. Usadas pela Parte Z de front.test.js (dado sintético) e por conferencia_real.test.js (dado real).
   Não é um arquivo de teste: só exporta a função. O mês anterior é recontado direto de MES_ANTERIOR.ROTAS (sem
   NUCLEO.mesAnterior) e o mês de referência sai do agrega() das rotas (o mesmo dos medidores):
   (a) Real e Meta do mês de referência na linha de total = Real e Meta do medidor da mesma categoria (e o texto dele);
   (b) % = Real / Meta (atual e anterior) e Δ p.p. = % atual - % anterior; na tela, 1 casa com o sinal ("0,0" com 0);
       cor pelo sinal exato (a unidade p.p. fica na legenda); ordem decrescente das linhas com Δ, as "—" no fim;
   (c) Real anterior de cada unidade = a soma direta das rotas dela; Σ unidades (com a linha Neutraliza) + as rotas fora das
       unidades (virtuais, "{GC}-EV", ocultas) = Real anterior do total; o mesmo para a Meta;
   (d) na Diretoria com "Todas as gerências": total BAND anterior = a soma de MES_ANTERIOR.ROTAS inteira;
   (e) unidade sem meta anterior (ou sem meta no mês de referência) na categoria = "—" sem barra.
   Devolve uma linha de resumo (só totais e códigos). */
'use strict';
const assert = require('node:assert/strict');

const LE_EVO = () => {
  const M = P.MES_ANTERIOR;
  const direto = (rs, k) => { const i = M.IND.indexOf(k), a = {real: 0, meta: 0, n: 0};
    rs.forEach(r => { const x = (M.ROTAS[r] || [])[i]; if(x){ a.real += x[0]; a.meta += x[1]; a.n++; } }); return a; };
  const ctx = ctxInicial(), us = unidadesExec(ctx), todas = rotasAtuais();
  const dentro = new Set(us.flatMap(u => u.rotas));
  const fora = todas.filter(r => !dentro.has(r));
  const n = v => v === '' || v == null ? null : Number(v);
  return {
    vis: !document.getElementById('exEvo').hidden && document.getElementById('exEvo').getClientRects().length > 0,
    band: sel.modo === 'dir' && !sel.dgc, fora: fora.length,
    gauges: Object.fromEntries([...document.querySelectorAll('#exGauges .gCard')].map(g => [g.dataset.k,
      [...g.querySelectorAll('.gMR b')].map(b => b.textContent)])),
    cats: GROUPS.VOLUME.map(k => {
      const b = agrega(todas).ind[k], dv = document.querySelector(`#exEvDivs .dv[data-k="${k}"]`);
      return {k, b: b && !b.unavailable ? {real: b.real, meta: b.meta} : null,
        tudo: direto(Object.keys(M.ROTAS), k), foraAnt: direto(fora, k), totAnt: direto(todas, k),
        un: Object.fromEntries(us.map(u => [u.cod, direto(u.rotas, k)])),
        linhas: [...dv.querySelectorAll('.dRow')].map(r => ({u: r.dataset.u, tot: r.classList.contains('tot'),
          dpp: n(r.dataset.dpp), pct: n(r.dataset.pct), pctAnt: n(r.dataset.pctAnt), real: n(r.dataset.real), meta: n(r.dataset.meta),
          realAnt: n(r.dataset.realAnt), metaAnt: n(r.dataset.metaAnt), txt: r.querySelector('.dVal').textContent,
          cls: r.querySelector('.dVal').className, lado: r.querySelector('.dN i') ? 'N' : r.querySelector('.dP i') ? 'P' : ''}))};
    }),
  };
};
const br = (v, c) => v.toLocaleString('pt-BR', {minimumFractionDigits: c, maximumFractionDigits: c});
// o Δ na linha: só o número, 1 casa e o sinal ("0,0" com 0); a unidade (p.p.) fica na legenda e na dica
const fmtDpp = d => d === 0 ? '0,0' : `${d > 0 ? '+' : '−'}${br(Math.abs(d), 1)}`;
const perto = (a, b, onde) => assert.ok(Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b)), `${onde}: ${a} x ${b}`);

async function confereEvolucao(page, onde){
  await page.evaluate(() => document.querySelector('.tab[data-g="EXEC"]').click());
  const ev = await page.evaluate(LE_EVO);
  assert.ok(ev.vis, `${onde}: bloco visível`);
  const res = {onde, cats: {}};
  for(const c of ev.cats){
    const o = `${onde} ${c.k}`, tot = c.linhas.find(l => l.tot), uns = c.linhas.filter(l => !l.tot);
    assert.ok(tot, `${o}: linha de total`);
    // (a) total do mês de referência = medidor
    if(c.b && c.b.meta > 0){
      assert.equal(tot.real, c.b.real, `${o}: Real do total x agrega`);
      assert.equal(tot.meta, c.b.meta, `${o}: Meta do total x agrega`);
      assert.deepEqual(ev.gauges[c.k], [Math.round(tot.meta).toLocaleString('pt-BR'), Math.round(tot.real).toLocaleString('pt-BR')],
        `${o}: Meta | Real do medidor`);
    }
    // (c) anterior por unidade = soma direta; Σ unidades + fora = total
    for(const l of uns){
      const d = c.un[l.u];
      assert.ok(d, `${o}: unidade ${l.u}`);
      perto(l.realAnt == null ? 0 : l.realAnt, d.n ? d.real : 0, `${o} ${l.u}: Real anterior`);
      perto(l.metaAnt == null ? 0 : l.metaAnt, d.n ? d.meta : 0, `${o} ${l.u}: Meta anterior`);
    }
    const soma = f => uns.reduce((s, l) => s + (l[f] || 0), 0);
    perto(soma('realAnt') + c.foraAnt.real, tot.realAnt || 0, `${o}: Σ Real anterior das unidades + rotas fora x total`);
    perto(soma('metaAnt') + c.foraAnt.meta, tot.metaAnt || 0, `${o}: Σ Meta anterior das unidades + rotas fora x total`);
    perto(tot.realAnt || 0, c.totAnt.real, `${o}: Real anterior do total x payload`);
    // (d) BAND = MES_ANTERIOR.ROTAS inteira
    if(ev.band){ perto(tot.realAnt, c.tudo.real, `${o}: BAND Real anterior`); perto(tot.metaAnt, c.tudo.meta, `${o}: BAND Meta anterior`); }
    // (b) e (e)
    let antes = Infinity, viuNd = false;
    for(const l of c.linhas){
      const lo = `${o} ${l.u}`;
      const ok = l.meta > 0 && l.metaAnt > 0;
      if(!ok){
        viuNd = true;
        assert.deepEqual([l.txt, l.dpp, l.lado], ['—', null, ''], `${lo}: sem meta = "—"`);
        assert.match(l.cls, /\bnd\b/, lo);
        continue;
      }
      assert.ok(!viuNd, `${lo}: linha com Δ depois de um "—"`);
      perto(l.pct, l.real / l.meta * 100, `${lo}: % atual`);
      perto(l.pctAnt, l.realAnt / l.metaAnt * 100, `${lo}: % anterior`);
      perto(l.dpp, l.pct - l.pctAnt, `${lo}: Δ p.p.`);
      assert.equal(l.txt, fmtDpp(l.dpp), `${lo}: Δ na tela`);
      assert.match(l.cls, l.dpp > 0 ? /\bpos\b/ : l.dpp < 0 ? /\bneg\b/ : /\bzero\b/, `${lo}: cor pelo sinal exato`);
      assert.equal(l.lado, l.dpp > 0 ? 'P' : l.dpp < 0 ? 'N' : '', `${lo}: lado da barra`);
      assert.ok(l.dpp <= antes, `${lo}: ordem decrescente`);
      antes = l.dpp;
    }
    res.cats[c.k] = tot.dpp == null ? '—' : `${tot.txt} p.p. (${br(tot.pctAnt, 1)}% → ${br(tot.pct, 1)}%)`;
    if(c.k === 'VOL REFRIGERANTES') Object.assign(res, {realAnt: Math.round(tot.realAnt || 0), metaAnt: Math.round(tot.metaAnt || 0),
      real: Math.round(tot.real || 0), unidades: uns.length, nd: uns.filter(l => l.dpp == null).length});
  }
  res.fora = ev.fora;
  return res;
}

module.exports = {confereEvolucao, LE_EVO, fmtDpp};
