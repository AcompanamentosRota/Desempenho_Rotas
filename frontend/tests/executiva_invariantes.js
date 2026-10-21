/* Invariantes da aba Executiva (seção 7 do pacote de implementação), conferidas no navegador com o filtro atual.
   Usadas pela Parte W de front.test.js (dado sintético) e por conferencia_real.test.js (dado real). Não é um arquivo de
   teste: só exporta a função. Nada aqui recalcula a regra por fora: compara a Executiva com os cards das abas, com a
   gaveta Sem compra e com uma recontagem direta do payload e do online (agenda).
   - KPIs Base, Sem compra e Visitas hoje = cards Base, Sem compra e "visitas hoje" com o mesmo filtro; "Categorias na
     tendência" = card do Volume; "Coberturas no ritmo" = cards do ICS GC + Novos Negócios;
   - Tendência x Meta: desvio da linha de total = Tendência / Meta - 1 (no fechamento, Real / Meta - 1) do agrega() das rotas
     do filtro (o do card de Volume); o % e a Meta do card batem; ordem decrescente; o medidor mostra a meta do dia e o
     online da caixa Online do card;
   - coberturas: % da linha de total = % dos cards do ICS GC, Novos Negócios e Todos a Bordo ("—" = card sem meta); Status =
     "x / n itens em 100%" da aba Todos a Bordo;
   - Sem compra: soma das unidades = total = KPI; % = sem compra / base;
   - Agenda: soma das unidades = total; restam = sem compra hoje - pediram online hoje (por linha e recontado do payload e do
     online); "sem compra hoje" do total = itens da gaveta Sem compra; "pediram" = os riscados (Venda Online) dela.
   Devolve uma linha de resumo (só totais e códigos de unidade). */
'use strict';
const assert = require('node:assert/strict');

// lê a Executiva do filtro atual (aba ativa: Executiva)
const LE_EXEC = () => {
  const t = id => document.getElementById(id).textContent.trim();
  return {
    k: catAtual(), fech: !!P.FECHAMENTO,
    kpi: {base: t('exNBase'), sem: t('exNSem'), vis: t('exNVis'), cat: t('exNCat'), cob: t('exXCat')},
    gauges: [...document.querySelectorAll('#exGauges .gCard')].map(g => ({k: g.dataset.k,
      dia: (g.querySelector('.gDia') || {}).textContent || ''})),
    totDesvio: [...document.querySelectorAll('#exDivs .dv')].map(dv => {
      const r = dv.querySelector('.dRow.tot');
      return {k: dv.dataset.k, d: r ? Number(r.dataset.desvio) : null, txt: r ? r.querySelector('.dVal').textContent : null,
              ordem: [...dv.querySelectorAll('.dRow')].map(x => Number(x.dataset.desvio))};
    }),
    // por grupo e item (o mesmo item pode estar em dois grupos: Artd KO; Cervejas e Cervejas 600ml Ret. no Todos a Bordo)
    cob: Object.fromEntries([...document.querySelectorAll('#exCob tbody tr.tot td')].map(td => [`${td.dataset.g}|${td.dataset.k}`,
      td.textContent.trim()])),
    sem: [...document.querySelectorAll('#exSemc .hRow')].map(x => ({u: x.dataset.u, tot: x.classList.contains('tot'),
      base: Number(x.dataset.base), sem: Number(x.dataset.sem), txt: x.querySelector('.hVal').textContent.trim()})),
    ag: [...document.querySelectorAll('#exAgenda .hRow')].map(x => ({u: x.dataset.u, tot: x.classList.contains('tot'),
      ag: Number(x.dataset.ag), sem: Number(x.dataset.sem), ped: Number(x.dataset.ped), restam: Number(x.dataset.restam)})),
    // recontagem direta (payload + online): rotas das listas de clientes com dado de compra no mês
    agendaP: (() => { let sem = 0, ped = 0;
      rotasListas().forEach(r => { const sch = SEM_COMPRA_HOJE[r]; if(sch == null) return; const on = new Set(onlineIds(r));
        sem += sch.length; ped += sch.filter(pv => on.has(pv)).length; });
      return {sem, ped, restam: sem - ped}; })(),
    // desvio do total pelo agrega() das rotas do filtro (o do card de Volume)
    desvioP: Object.fromEntries(GROUPS.VOLUME.map(c => { const b = agrega(rotasAtuais()).ind[c];
      return [c, b && !b.unavailable && b.meta > 0 ? {d: (P.FECHAMENTO ? b.real : b.tendencia) / b.meta - 1,
        pct: P.FECHAMENTO ? b.pctReal : b.pctTendencia, meta: Math.round(b.meta).toLocaleString('pt-BR')} : null]; })),
  };
};
// lê os cards da aba ativa: % (sem a seta), Meta, caixa Online; card do topo (ritmo) e Base/Sem compra
const LE_ABA = () => {
  const t = id => document.getElementById(id).textContent.trim();
  return {
    nBase: t('nBase'), nSem: t('nSem'), xBase: t('xBase'), ritmo: t('nRitmo'),
    cards: Object.fromEntries([...document.querySelectorAll('#lista .ind')].map(el => {
      const k = el.dataset.k || el.dataset.incOff;
      if(!k) return [null, null];
      if(el.classList.contains('off')) return [k, {off: true}];
      const big = el.querySelector('.big').cloneNode(true); big.querySelector('.seta').remove();
      return [k, {pct: big.textContent.trim(), meta: el.querySelector('.cl > div').textContent.trim(),
        on: el.querySelector('.obox b').textContent.trim(), onRot: el.querySelector('.obox span').textContent.trim()}];
    }).filter(([k]) => k)),
  };
};
const vaiAba = (page, aba) => page.evaluate(aba => document.querySelector(`.tab[data-g="${aba}"]`).click(), aba);
const num = t => Number(String(t).replace(/[^\d-]/g, ''));
const br1 = v => v.toLocaleString('pt-BR', {minimumFractionDigits: 1, maximumFractionDigits: 1});
const xn = s => s.replace(/\s/g, '').split('/').map(Number);

async function confereExecutiva(page, onde){
  await vaiAba(page, 'EXEC');
  const ex = await page.evaluate(LE_EXEC);
  const abas = {};
  for(const a of ['VOLUME', 'ICS_GC', 'NOVOS_NEG', 'INCENTIVO']){
    if(await page.isHidden(`.tab[data-g="${a}"]`)) continue;
    await vaiAba(page, a);
    abas[a] = await page.evaluate(LE_ABA);
  }
  await vaiAba(page, 'EXEC');
  // a gaveta Sem compra hoje pelo próprio KPI
  await page.evaluate(() => document.getElementById('exSem').click());
  const gav = await page.evaluate(() => ({itens: document.querySelectorAll('#dCorpo .item').length,
    riscados: document.querySelectorAll('#dCorpo .item.riscado').length, tit: document.getElementById('dTit').textContent}));
  await page.keyboard.press('Escape');
  assert.equal(gav.tit, 'Sem compra hoje', `${onde}: gaveta do KPI Sem compra`);
  const V = abas.VOLUME;
  // KPIs = cards das abas
  assert.equal(ex.kpi.base, V.nBase, `${onde}: Base`);
  assert.equal(ex.kpi.sem, V.nSem, `${onde}: Sem compra`);
  assert.equal(num(ex.kpi.vis), num(V.xBase), `${onde}: Visitas hoje x "visitas hoje" do card Base`);
  assert.equal(ex.kpi.cat.replace(/\s/g, ''), V.ritmo.replace(/\s/g, ''), `${onde}: Categorias na tendência`);
  const [ix, in_] = xn(abas.ICS_GC.ritmo), [nx, nn] = xn(abas.NOVOS_NEG.ritmo);
  assert.equal(ex.kpi.cob.replace(/\s/g, ''), `Coberturasnoritmo:${ix + nx}/${in_ + nn}`, `${onde}: Coberturas no ritmo`);
  // Tendência x Meta: total = Tendência / Meta - 1 do agrega() do card; % e Meta do card; medidor = caixa Online
  for(const {k, d, txt, ordem} of ex.totDesvio){
    const p = ex.desvioP[k], card = V.cards[k];
    if(!p){ assert.equal(d, null, `${onde} ${k}: sem meta, sem linha de total`); continue; }
    assert.ok(Math.abs(d - p.d) < 1e-12, `${onde} ${k}: desvio ${d} x ${p.d}`);
    assert.equal(card.pct, `${p.pct}%`, `${onde} ${k}: % do card`);
    assert.equal(card.meta, `Meta ${p.meta}`, `${onde} ${k}: Meta do card`);
    assert.equal(txt, `${d >= 0 ? '+' : '−'}${br1(Math.abs(d * 100))}%`, `${onde} ${k}: desvio na tela`);
    for(let i = 1; i < ordem.length; i++) assert.ok(ordem[i - 1] >= ordem[i], `${onde} ${k}: ordem decrescente`);
    const g = ex.gauges.find(x => x.k === k);
    if(/online/.test(g.dia)) assert.equal(g.dia, `${card.onRot} · online ${card.on}`, `${onde} ${k}: medidor x caixa Online`);
    if(/batida/.test(g.dia)) assert.equal(card.onRot, 'Meta batida!', `${onde} ${k}: meta do dia batida`);
  }
  // coberturas: linha de total = % dos cards
  const conf = (k, card, cel, aba) => {
    if(!card || card.off) assert.equal(cel, '—', `${onde} ${aba} ${k}: card sem meta = "—"`);
    else assert.equal(cel, card.pct, `${onde} ${aba} ${k}`);
  };
  for(const aba of ['ICS_GC', 'NOVOS_NEG'])
    for(const k of await page.evaluate(a => P.COV_GRUPO[a], aba)) conf(k, abas[aba].cards[k], ex.cob[`${aba}|${k}`], aba);
  if(abas.INCENTIVO){
    for(const k of await page.evaluate(() => itensInc())) conf(k, abas.INCENTIVO.cards[k], ex.cob[`INCENTIVO|${k}`], 'INCENTIVO');
    const [x, n] = xn(abas.INCENTIVO.ritmo);
    assert.equal(ex.cob['INCENTIVO|STATUS'], n ? `${x}/${n}` : '—', `${onde}: Status`);
  }
  // Sem compra: soma das unidades = total = KPI; % = sem / base
  const sTot = ex.sem.find(x => x.tot), sUn = ex.sem.filter(x => !x.tot);
  if(sTot){
    assert.equal(sUn.reduce((s, x) => s + x.sem, 0), sTot.sem, `${onde}: Σ sem compra`);
    assert.equal(sTot.sem.toLocaleString('pt-BR'), ex.kpi.sem, `${onde}: total sem compra = KPI`);
    for(const x of ex.sem) assert.equal(x.txt, `${br1(x.sem / x.base * 100)}%`, `${onde} ${x.u}: % sem compra`);
  }
  // Agenda (fora do fechamento): soma = total; restam = sem - pediram; = recontagem; total = gaveta Sem compra hoje
  const aTot = ex.ag.find(x => x.tot), aUn = ex.ag.filter(x => !x.tot);
  if(ex.fech) assert.equal(ex.ag.length, 0, `${onde}: sem Agenda no fechamento`);
  if(aTot){
    for(const c of ['ag', 'sem', 'ped', 'restam']) assert.equal(aUn.reduce((s, x) => s + x[c], 0), aTot[c], `${onde}: Σ agenda ${c}`);
    for(const x of ex.ag) assert.equal(x.restam, x.sem - x.ped, `${onde} ${x.u}: restam`);
    assert.deepEqual({sem: aTot.sem, ped: aTot.ped, restam: aTot.restam}, ex.agendaP, `${onde}: agenda x payload/online`);
    assert.equal(aTot.sem, gav.itens, `${onde}: sem compra hoje x itens da gaveta`);
    assert.equal(aTot.ped, gav.riscados, `${onde}: pediram online x riscados da gaveta`);
  }
  const k0 = ex.totDesvio.find(x => x.k === ex.k) || {};
  return {onde, base: ex.kpi.base, sem: ex.kpi.sem, vis: ex.kpi.vis, cat: ex.kpi.cat.replace(/\s/g, ''),
    cob: ex.kpi.cob.replace(/^.*: /, ''), desvio: k0.txt || '—', status: ex.cob['INCENTIVO|STATUS'] || '—',
    ag: aTot ? aTot.ag : '—', semHoje: aTot ? aTot.sem : '—', ped: aTot ? aTot.ped : '—', restam: aTot ? aTot.restam : '—',
    gaveta: gav.itens};
}

module.exports = {confereExecutiva, LE_EXEC, LE_ABA};
