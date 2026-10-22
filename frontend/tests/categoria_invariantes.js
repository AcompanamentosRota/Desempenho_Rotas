/* Invariantes da gaveta "Categoria por unidade" da aba Executiva (tocar num medidor do bloco "Categorias"), conferidas no
   navegador com o filtro atual. Usadas pela Parte AC de front.test.js (dado sintético) e por conferencia_real.test.js (dado
   real). Não é um arquivo de teste: só exporta as funções. O esperado é recontado direto do payload (meta, real e tendência de
   cada rota em P.DATA), sem agrega() nem as funções da gaveta; as unidades são os grupos da cascata no 1º nível do filtro
   (gcsComDados/rotasDe; svsEmOrdem/rotasNormais + rotasNeutraliza; as rotas normais da supervisão):
   (a) cartão de total: Meta, Real e % real = os do medidor da categoria; Meta, Real, % real e pctTendencia = os do card da aba
       Volume com o mesmo filtro (no fechamento, o % do card é o realizado); e = a soma direta das rotas do filtro;
   (b) Σ Meta, Real e Tendência dos cartões de unidade + as unidades sem meta na categoria + as rotas fora das unidades
       (virtuais, '-EV', supervisões só de Neutraliza/virtuais) = o total;
   (c) cartões = as unidades com meta (> 0) na categoria, do maior para o menor Real / Meta (valor exato), sem as outras;
   (d) cor (data-st, faixa lateral, % e barra) pela regra: Real >= Meta verde; Math.round(Tendência / Meta * 100) >= 100 âmbar
       (fora do fechamento); o resto vermelho;
   (e) "faltam N" = Meta − Real (arredondado) ou "+X% s/ meta" com Real >= Meta (X = (Real / Meta − 1) * 100 arredondado);
       "Y%" da Tendência = pctTendencia; larguras das barras = Real / Meta e Tendência / Meta (até 100%); no fechamento, sem a
       barra de Tendência;
   (f) a linha "Neutraliza", quando existir, é a última;
   título "<Categoria> por <nível>", subtítulo com o critério e "N <nível>", legenda; fechar mantém a categoria em análise.
   Medidor sem meta no escopo: não abre a gaveta. Devolve uma linha de resumo (só totais e códigos de unidade). */
'use strict';
const assert = require('node:assert/strict');

// a gaveta aberta (cartões na ordem da tela)
const LE_GAVETA = () => {
  const n = v => v === '' || v == null ? null : Number(v);
  const cs = el => getComputedStyle(el);
  const larg = el => el ? parseFloat(el.style.width) : null;
  return {tit: document.getElementById('dTit').textContent, sub: document.getElementById('dSub').textContent,
    aberta: document.getElementById('drw').classList.contains('on'), k: (document.querySelector('#dCorpo .cuGav') || {dataset: {}}).dataset.k,
    leg: [...document.querySelectorAll('#dCorpo .cuLeg span')].map(s => [s.querySelector('.cuLg').className.replace('cuLg ', ''), s.textContent]),
    vazio: (document.querySelector('#dCorpo .cuGav .vazio') || {}).textContent || '',
    cards: [...document.querySelectorAll('#dCorpo .cuCard')].map(c => ({u: c.dataset.u, st: c.dataset.st, tot: c.classList.contains('cuTot'),
      cls: c.className, meta: n(c.dataset.meta), real: n(c.dataset.real), tend: n(c.dataset.tend), pct: n(c.dataset.pct),
      pctTend: n(c.dataset.pctTend), nome: c.querySelector('.cuNome').textContent, sub: c.querySelector('.cuSub').textContent,
      pctTxt: c.querySelector('.cuPct').textContent.replace(/\s+/g, ' ').trim(), vals: c.querySelector('.cuVals').textContent.replace(/\s+/g, ' ').trim(),
      v1: c.querySelector('.cuB1 .cuVal').textContent, w1: larg(c.querySelector('.cuB1 .cuTr i')),
      b2: !!c.querySelector('.cuB2'), v2: (c.querySelector('.cuB2 .cuVal') || {}).textContent || null, w2: larg(c.querySelector('.cuB2 .cuTr i')),
      faixa: cs(c).borderLeftColor, corPct: cs(c.querySelector('.cuPct b')).color, corBarra: cs(c.querySelector('.cuB1 .cuTr i')).backgroundColor,
      dica: c.dataset.dica}))};
};
// cores de referência (as variáveis do CSS) de cada status
const CORES = () => { const ref = v => { const s = document.createElement('span'); s.style.color = `var(${v})`; document.body.appendChild(s);
  const c = getComputedStyle(s).color; s.remove(); return c; };
  return {bat: ref('--verde'), tend: ref('--ambar'), abx: ref('--vermelho')}; };
// o esperado da categoria k no filtro atual, recontado do payload (ver o cabeçalho)
const ESPERADO = k => {
  const fech = !!P.FECHAMENTO, dir = sel.modo === 'dir', gc = dir ? sel.dgc : sel.gc, sv = dir ? '' : sel.sv;
  const soma = rs => rs.reduce((a, r) => { const b = nodo('', r).indicators[k];
    if(!b || b.unavailable) return a;
    a.meta += b.meta || 0; a.real += b.real || 0; a.tend += b.tendencia || 0; a.n++; return a; }, {meta: 0, real: 0, tend: 0, n: 0});
  const rotasDaUn = rs => rs.filter(r => !ehVirtual(r)).sort(ordemNatural).map(r => ['Rota ' + r, [r]]);
  let nivel, tot, us;
  if(dir && !gc){ nivel = 'gerência'; us = gcsComDados().map(g => ['GC.' + g, rotasDe(g, '')]); tot = us.flatMap(u => u[1]); }
  else if(sv === 'Neutraliza'){ nivel = 'rota'; tot = rotasNeutraliza(gc); us = rotasDaUn(tot); }
  else if(sv){ nivel = 'rota'; tot = rotasNormais(gc, sv); us = rotasDaUn(tot); }
  else {
    nivel = 'supervisão'; tot = rotasDe(gc, '');
    us = svsEmOrdem(gc).map(s => [s, rotasNormais(gc, s)]);
    if(rotasNeutraliza(gc).length) us.push(['Neutraliza', rotasNeutraliza(gc)]);
  }
  const dentro = new Set(us.flatMap(u => u[1]));
  const st = x => x.real >= x.meta ? 'bat' : !fech && Math.round(x.tend / x.meta * 100) >= 100 ? 'tend' : 'abx';
  const un = us.map(([u, rs]) => { const x = soma(rs); return {u, ...x, com: x.n > 0 && x.meta > 0}; });
  un.filter(x => x.com).forEach(x => { x.st = st(x); });
  const t = soma(tot);
  return {fech, nivel, nome: rotuloInd(k), tot: {...t, st: t.n && t.meta > 0 ? st(t) : null}, un,
    fora: soma(tot.filter(r => !dentro.has(r))), nFora: tot.filter(r => !dentro.has(r)).length};
};
// o medidor da categoria (Meta, Real, % real) e o card de Volume (lidos antes, na aba Volume)
const LE_MEDIDOR = k => { const g = document.querySelector(`#exGauges .gCard[data-k="${k}"]`);
  return {off: g.classList.contains('off'), role: g.getAttribute('role'), pct: (g.querySelector('.gPct') || {}).firstChild ? g.querySelector('.gPct').firstChild.textContent : null,
    mr: [...g.querySelectorAll('.gMR b')].map(b => b.textContent), sel: g.classList.contains('sel')}; };
const LE_VOLUME = () => Object.fromEntries([...document.querySelectorAll('#lista .ind.vol[data-k]')].map(el => {
  const big = el.querySelector('.big').cloneNode(true); big.querySelector('.seta').remove();
  return [el.dataset.k, {meta: el.querySelector('.cl > div:nth-child(1)').textContent.trim(), real: el.querySelector('.cl > div:nth-child(2)').textContent.trim(),
    big: big.textContent.trim(), opo: el.querySelector('.opo').textContent.trim()}]; }));

const f0 = v => Math.round(v).toLocaleString('pt-BR');
const quase = (a, b, onde) => assert.ok(Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b)), `${onde}: ${a} x ${b}`);
const NIVEIS = {'gerência': 'gerências', 'supervisão': 'supervisões', rota: 'rotas'};
const vaiAba = (page, aba) => page.evaluate(aba => document.querySelector(`.tab[data-g="${aba}"]`).click(), aba);

// confere as 5 categorias no filtro atual; devolve {onde, cats: {k: resumo}}
async function confereCategoria(page, onde){
  await vaiAba(page, 'VOLUME');
  const vol = await page.evaluate(LE_VOLUME);
  await vaiAba(page, 'EXEC');
  const ks = await page.evaluate(() => GROUPS.VOLUME), cores = await page.evaluate(CORES), cats = {};
  for(const k of ks){
    const o = `${onde} ${k}`, esp = await page.evaluate(ESPERADO, k), med = await page.evaluate(LE_MEDIDOR, k);
    const comMeta = esp.tot.n > 0 && esp.tot.meta > 0;
    assert.equal(!med.off, comMeta, `${o}: medidor com meta`);
    await page.click(`#exGauges .gCard[data-k="${k}"]`);
    const g = await page.evaluate(LE_GAVETA);
    if(!comMeta){
      // sem meta no escopo: "sem meta neste escopo", medidor sem papel de botão e a gaveta não abre
      assert.equal(med.role, null, o);
      assert.equal(g.aberta, false, `${o}: sem meta, a gaveta não abre`);
      cats[k] = 'sem meta';
      continue;
    }
    assert.ok(g.aberta, `${o}: a gaveta abre`);
    assert.equal(g.k, k, o);
    assert.equal(await page.evaluate(() => catAtual()), k, `${o}: categoria em análise`);
    assert.equal(g.tit, `${esp.nome} por ${esp.nivel}`, `${o}: título`);
    const [tot, ...us] = g.cards;
    // (a) total = medidor = card de Volume = soma das rotas do filtro
    assert.ok(tot.tot && !us.some(c => c.tot), `${o}: um total, primeiro`);
    for(const c of ['meta', 'real']) quase(tot[c], esp.tot[c], `${o}: total ${c}`);
    if(!esp.fech) quase(tot.tend, esp.tot.tend, `${o}: total tendência`);
    assert.equal(tot.vals, `Meta ${f0(tot.meta)} Real ${f0(tot.real)}`, `${o}: Meta e Real do total`);
    assert.deepEqual(med.mr, [f0(tot.meta), f0(tot.real)], `${o}: total x medidor (Meta, Real)`);
    assert.equal(tot.pctTxt, `${med.pct} real`, `${o}: % real do total x medidor`);
    const card = vol[k];
    assert.ok(card, `${o}: card de Volume`);
    assert.deepEqual([card.meta, card.real], [`Meta ${f0(tot.meta)}`, `Real ${f0(tot.real)}`], `${o}: total x card de Volume`);
    if(esp.fech) assert.equal(card.big, `${tot.pct}%`, `${o}: % realizado do card`);
    else {
      assert.equal(card.big, `${tot.pctTend}%`, `${o}: pctTendencia do card`);
      assert.equal(card.opo, `${tot.pct}% real`, `${o}: % real do card`);
      assert.equal(tot.pctTend, Math.round(esp.tot.tend / esp.tot.meta * 100), `${o}: pctTendencia recontado`);
    }
    assert.equal(tot.pct, Math.round(esp.tot.real / esp.tot.meta * 100), `${o}: % real recontado`);
    // (b) Σ unidades (cartões) + unidades sem meta + rotas fora das unidades = total
    const semMeta = esp.un.filter(x => !x.com);
    for(const [c, e] of [['meta', 'meta'], ['real', 'real'], ...(esp.fech ? [] : [['tend', 'tend']])])
      quase(us.reduce((s, x) => s + x[c], 0) + semMeta.reduce((s, x) => s + x[e], 0) + esp.fora[e], tot[c], `${o}: Σ ${c}`);
    // (c) as unidades com meta, do maior para o menor Real / Meta, e só elas; (f) "Neutraliza" por último
    const comM = esp.un.filter(x => x.com);
    assert.deepEqual([...us.map(x => x.u)].sort(), comM.map(x => x.u).sort(), `${o}: unidades com meta`);
    const normais = us.filter(x => x.u !== 'Neutraliza');
    for(let i = 1; i < normais.length; i++)
      assert.ok(normais[i - 1].real / normais[i - 1].meta >= normais[i].real / normais[i].meta, `${o}: ordem ${normais[i - 1].u} ${normais[i].u}`);
    if(us.some(x => x.u === 'Neutraliza')) assert.equal(us[us.length - 1].u, 'Neutraliza', `${o}: Neutraliza por último`);
    assert.equal(g.sub, `${esp.fech ? 'Realizado ÷ Meta · cor pelo realizado' : 'Real até ontem ÷ Meta · cor pela tendência do SAC'} · ` +
      `${us.length} ${us.length === 1 ? esp.nivel : NIVEIS[esp.nivel]}`, `${o}: subtítulo`);
    // (d) cor de cada cartão pela regra, recontada das rotas; (e) textos e barras
    for(const c of g.cards){
      const e = c.tot ? esp.tot : comM.find(x => x.u === c.u), oc = `${o} ${c.u}`;
      if(!c.tot) for(const m of ['meta', 'real']) quase(c[m], e[m], `${oc} ${m}`);
      assert.equal(c.st, e.st, `${oc}: status`);
      if(esp.fech) assert.notEqual(c.st, 'tend', `${oc}: sem âmbar no fechamento`);
      for(const cor of [c.faixa, c.corPct, c.corBarra]) assert.equal(cor, cores[c.st], `${oc}: cor`);
      assert.match(c.cls, {bat: /\bcuBat\b/, tend: /\bcuTend\b/, abx: /\bcuAbx\b/}[c.st], oc);
      const r = c.real / c.meta;
      assert.equal(c.v1, c.real >= c.meta ? `+${Math.round((r - 1) * 100)}% s/ meta` : `faltam ${f0(c.meta - c.real)}`, `${oc}: faltam / s/ meta`);
      assert.ok(Math.abs(c.w1 - Math.min(100, r * 100)) < 0.01, `${oc}: barra do Real ${c.w1}`);
      assert.equal(c.pctTxt, `${Math.round(r * 100)}% real`, `${oc}: % real`);
      assert.equal(c.b2, !esp.fech, `${oc}: barra da Tendência`);
      if(!esp.fech){
        assert.equal(c.v2, `${c.pctTend}%`, `${oc}: % da tendência`);
        assert.equal(c.pctTend, Math.round(c.tend / c.meta * 100), `${oc}: pctTendencia`);
        assert.ok(Math.abs(c.w2 - Math.min(100, c.tend / c.meta * 100)) < 0.01, `${oc}: barra da Tendência ${c.w2}`);
      }
    }
    assert.deepEqual(g.leg.map(x => x[0]), esp.fech ? ['cuBat', 'cuAbx'] : ['cuBat', 'cuTend', 'cuAbx'], `${o}: legenda`);
    // fechar mantém a categoria em análise
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.getElementById('drw').classList.contains('on')), false, `${o}: fechou`);
    assert.equal(await page.evaluate(() => catAtual()), k, `${o}: categoria em análise depois de fechar`);
    assert.ok((await page.evaluate(LE_MEDIDOR, k)).sel, `${o}: medidor marcado depois de fechar`);
    const nSt = s => g.cards.filter(c => !c.tot && c.st === s).length;
    cats[k] = {n: us.length, pct: tot.pct, tend: esp.fech ? null : tot.pctTend, st: tot.st, bat: nSt('bat'), am: nSt('tend'), abx: nSt('abx'),
      semMeta: semMeta.length, fora: esp.nFora, neutra: us.some(x => x.u === 'Neutraliza')};
  }
  return {onde, cats};
}

// textos cortados e rolagem lateral dentro da gaveta da categoria (só o que está à vista)
const CORTES_CAT = () => [...document.querySelectorAll('#dCorpo .cuGav, #dCorpo .cuGav *')].filter(el => el.clientWidth > 0 &&
  el.getClientRects().length && !/auto|scroll/.test(getComputedStyle(el).overflowX) && el.scrollWidth > el.clientWidth + 1)
  .map(el => `${el.className || el.tagName}: ${el.textContent.trim().slice(0, 40)}`)
  .concat(document.getElementById('dCorpo').scrollWidth > document.getElementById('dCorpo').clientWidth + 1 ? ['#dCorpo rola de lado'] : []);

module.exports = {confereCategoria, LE_GAVETA, ESPERADO, CORTES_CAT, CORES};
