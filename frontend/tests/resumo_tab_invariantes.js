/* Invariantes do bloco "Todos a Bordo 3.0" do Resumo de vendas (Parte AF do front.test.js e conferencia_real.test.js).
   Regra (decisão da Karen, 29/10/2026): a célula é a do ICS GC no Resumo (celInd: Faltam / Meta dia, Online, % do mês =
   (Real ∪ Online, clientes distintos) / Meta), cada item só com as rotas da coluna que têm meta dele (rotasInc, as mesmas
   do card da aba Todos a Bordo); coluna sem nenhuma: "—".
   confereResumoTab(page, onde), com o painel no escopo a conferir (fora do Resumo):
   (a) o bloco tem os itens de GROUPS.INCENTIVO, na ordem e com o rótulo da aba, e a linha "No ritmo" no fim, em cada faixa;
   (b) as colunas são as do bloco ICS GC;
   (c) cada célula: % e Online = a conta da regra sobre as rotas da coluna; sem rota com meta do item, "—";
   (d) total (1ª coluna) x card da aba com o mesmo filtro: Meta e Real iguais (os da conta), Online = caixa Online do card;
       % = % do card quando o online de hoje não traz cliente novo (senão é maior ou igual: conta os novos);
       item sem meta no escopo: card sem meta e célula "—".
   Devolve um resumo só de totais e códigos (nada de clientes) para a tabela da conferência. */
'use strict';
const assert = require('node:assert/strict');

// lê o bloco: por faixa, os códigos das colunas (sem o nome embaixo) e, por linha, o nome e as células
const LE_BLOCO = () => {
  const bl = document.querySelector('#rsFolha .rs-bloco[data-bloco="tab"]');
  const ths = f => [...f.querySelectorAll('.rs-tab thead th')].map(t => t.firstChild ? t.firstChild.textContent : '');
  const ics = [...document.querySelectorAll('#rsFolha .rs-bloco')].find(b => /ICS GC/.test(b.querySelector('h3').textContent));
  if(!bl) return null;
  return {h3: bl.querySelector('h3').firstChild.textContent.trim(),
    icsTh: ics ? [...ics.querySelectorAll('.rs-faixa')].map(ths) : null,
    faixas: [...bl.querySelectorAll('.rs-faixa')].map(f => ({th: ths(f),
      linhas: [...f.querySelectorAll('.rs-tab tbody tr')].map(tr => [...tr.children].map((td, i) => {
        if(i === 0) return td.textContent;
        const on = td.querySelector('.rs-k.rs-on strong'), sec = td.querySelector('.rs-sec'), m = sec && sec.textContent.match(/(\d+)% do mês/);
        return {txt: td.textContent.replace(/\s+/g, ' ').trim(), onl: on ? Number(on.textContent.replace(/\./g, '')) : null,
                pct: m ? Number(m[1]) : null};
      }))}))};
};
// esperado por coluna (RS.colunas(), na ordem) e item: null = sem rota com meta; senão {meta, real, onl, tot, pct}
const ESPERADO = () => {
  const OC = (ONLINE && ONLINE.clientes) || {};
  return {itens: itensInc(), rotulos: itensInc().map(rotuloInd), cols: RS.colunas().cols.map(c => [c[0], itensInc().map(k => {
    const rs = rotasInc(k, c[1]); if(!rs.length) return null;
    let meta = 0, real = 0, onl = 0, tot = 0;
    rs.forEach(r => { const b = nodo('', r).indicators[k]; if(!b || b.unavailable) return;
      const s = new Set((COBERTOS[r] || {})[k] || []), o = (OC[r] || {})[k] || [];
      meta += b.meta || 0; real += b.real || 0; onl += o.length; o.forEach(i => s.add(i)); tot += s.size; });
    return meta ? {meta, real, onl, tot, pct: Math.round(tot / meta * 100)} : null;
  })])};
};
// cards da aba Todos a Bordo (aba atual): Meta, Real, % e Online por item; sem meta = {off: true}
const LE_CARDS = () => Object.fromEntries(itensInc().map(k => {
  const el = document.querySelector(`#lista .ind[data-k="${k}"]`);
  if(!el) return [k, {off: true}];
  const cl = el.querySelector('.cl').textContent.replace(/\s+/g, ' '), m = cl.match(/Meta ([\d.]+) Real ([\d.]+)/);
  const num = t => Number(String(t).replace(/\./g, ''));
  return [k, {off: false, meta: num(m[1]), real: num(m[2]), pct: num(el.querySelector('.big').textContent.replace(/\D/g, '')),
              onl: num(el.querySelector('.obox b').textContent)}];
}));

async function confereResumoTab(page, onde){
  const abaAntes = await page.evaluate(() => aba);
  await page.click('#btnResumo');
  if(await page.getAttribute('#rsOverlay [data-rsb="tab"]', 'aria-pressed') !== 'true') await page.click('#rsOverlay [data-rsb="tab"]');
  const t = await page.evaluate(LE_BLOCO), esp = await page.evaluate(ESPERADO);
  await page.click('#rsVoltar');
  assert.ok(t, `${onde}: sem o bloco`);
  assert.equal(t.h3, 'Todos a Bordo 3.0', onde);
  // (a) e (b)
  for(const f of t.faixas) assert.deepEqual(f.linhas.map(l => l[0]), [...esp.rotulos, 'No ritmo'], `${onde}: linhas`);
  assert.deepEqual(t.faixas.map(f => f.th), t.icsTh, `${onde}: colunas do ICS GC`);
  // (c)
  const cel = {};
  t.faixas.forEach(f => f.th.forEach((h, j) => { if(j && h) cel[h] = f.linhas.map(l => l[j]); }));
  assert.ok(cel[esp.cols[0][0]], `${onde}: coluna do total`);
  const r = {onde, colunas: Object.keys(cel).length, celulas: 0, tracos: 0, semMeta: {}, itens: []};
  for(const [cod, itens] of esp.cols.filter(c => cel[c[0]])){
    itens.forEach((e, i) => {
      const c = cel[cod][i], nm = esp.rotulos[i];
      if(!e){ assert.equal(c.txt, '—', `${onde} ${cod} ${nm}: sem rota com meta = "—"`); r.tracos++;
        (r.semMeta[nm] = r.semMeta[nm] || []).push(cod); return; }
      assert.deepEqual([c.pct, c.onl], [e.pct, e.onl], `${onde} ${cod} ${nm}: % e Online`);
      r.celulas++;
    });
  }
  // (d) total x cards da aba Todos a Bordo
  await page.evaluate(() => document.querySelector('.tab[data-g="INCENTIVO"]').click());
  const cards = await page.evaluate(LE_CARDS);
  esp.itens.forEach((k, i) => {
    const c = cards[k], e = esp.cols[0][1][i], nm = esp.rotulos[i];
    if(!e){ assert.ok(c.off, `${onde} ${nm}: célula "—" e card sem meta`); r.itens.push([nm, '—', '—', '—']); return; }
    assert.ok(!c.off, `${onde} ${nm}: card com meta`);
    assert.deepEqual([c.meta, c.real], [e.meta, e.real], `${onde} ${nm}: Meta e Real do total = card`);
    assert.equal(c.onl, e.onl, `${onde} ${nm}: Online do total = caixa Online do card`);
    if(e.tot === e.real) assert.equal(e.pct, c.pct, `${onde} ${nm}: sem cliente novo no online, % = card`);
    else assert.ok(e.pct >= c.pct, `${onde} ${nm}: com cliente novo no online, % >= card`);
    r.itens.push([nm, `${e.pct}%`, `${c.pct}%`, e.onl]);
  });
  await page.evaluate(a => { const t = document.querySelector(`.tab[data-g="${a}"]`); if(t && !t.hidden) t.click(); }, abaAntes);
  r.difCard = r.itens.filter(x => x[1] !== x[2]).length;
  return r;
}

module.exports = {confereResumoTab, LE_BLOCO, ESPERADO};
