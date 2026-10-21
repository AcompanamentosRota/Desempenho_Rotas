/* Invariantes das gavetas com barra de dias (Etapa 6; seção 3.5 do pacote de implementação), conferidas no navegador com o
   filtro atual. Usadas pela Parte X de front.test.js (dado sintético) e por conferencia_real.test.js (dado real). Não é um
   arquivo de teste: só exporta as funções. O esperado é recontado direto do payload e do online (CLIENT_ROSTER,
   SEM_COMPRA_HOJE, SEM_COMPRA_MES, DIAS, ONLINE.clientes[r].QUALQUER), sem as funções da gaveta:
   - por chip, a lista da Base e a do Sem compra nas rotas das listas de clientes (rotasListas: sem virtuais nem ocultas),
     em nome, com o riscado (+ "Venda Online") de quem comprou online hoje; "Hoje" = c[4] (visita hoje); um dia = DIAS[c[3]]
     separado por " - " contém o dia (o cliente com mais de um dia aparece em cada um);
   - contagens x cards: "Hoje" da Base = "visitas hoje" do card Base; "Hoje" do Sem compra = "sem compra hoje" do card;
     "Todos" do Sem compra = semCompra do card (= soma do semCompra das rotas); "Todos" da Base = base do card. Só as rotas
     ocultas (SV.G3.3: nos cards, fora das listas de clientes) fazem diferença, e a diferença é exatamente a delas;
   - fora do "Hoje" vale o limite das listas da cascata (CONFIG.LIMITE_LISTA): os primeiros itens + "+ N clientes"; o
     subtítulo traz o total.
   Devolve uma linha de resumo (só contagens e o escopo; nada de clientes). */
'use strict';
const assert = require('node:assert/strict');

const CHIPS = ['Hoje', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Todos'];
// a gaveta aberta: título, subtítulo, chips (e o ligado), itens {r, pv, risc, tag, nome}, linhas .vazio e o resto ("+ N")
const LE_GAV = () => {
  const chips = [...document.querySelectorAll('#dCorpo .dchip')];
  const vazio = [...document.querySelectorAll('#dCorpo .vazio')].map(v => v.textContent);
  const resto = vazio.map(t => t.match(/^\+ ([\d.]+) clientes/)).filter(Boolean).map(m => Number(m[1].replace(/\./g, '')));
  return {tit: document.getElementById('dTit').textContent, sub: document.getElementById('dSub').textContent,
    chips: chips.map(b => b.dataset.d), on: (chips.find(b => b.classList.contains('on')) || {dataset: {}}).dataset.d || null,
    itens: [...document.querySelectorAll('#dCorpo .item')].map(el => ({r: el.querySelector('.sb').textContent.match(/rota (\S+)/)[1],
      pv: el.querySelector('.bd').textContent.replace(/^PV /, ''), risc: el.classList.contains('riscado'),
      tag: (el.querySelector('.tagOnline') || {}).textContent || '', nome: el.querySelector('.nm').firstChild.textContent})),
    vazio, resto: resto.length ? resto[0] : 0};
};
// o esperado, recontado do payload e do online (ver o cabeçalho); cards do filtro e a parte das rotas ocultas
const ESPERADO = () => {
  const rs = rotasListas(), dias = c => (DIAS[c[3]] || '').split(' - ');
  const on = r => new Set((((ONLINE && ONLINE.clientes) || {})[r] || {}).QUALQUER || []);
  const passa = (c, d) => d === 'Todos' || (d === 'Hoje' ? c[4] === 1 : dias(c).includes(d));
  const lista = f => rs.flatMap(r => (CLIENT_ROSTER[r] || []).filter(c => f(r, c)).map(c => [r, c]))
    .sort((a, b) => a[1][1].localeCompare(b[1][1])).map(([r, c]) => ({r, pv: String(c[0]), risc: on(r).has(c[0]), dias: DIAS[c[3]]}));
  const mes = r => new Set((P.SEM_COMPRA_MES || {})[r] || []), hoje = r => new Set(SEM_COMPRA_HOJE[r] || []);
  const base = {}, sem = {};
  for(const d of ['Hoje', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Todos']){
    base[d] = lista((r, c) => passa(c, d));
    sem[d] = lista((r, c) => d === 'Hoje' ? c[4] === 1 && hoje(r).has(c[0]) : passa(c, d) && mes(r).has(c[0]));
  }
  // número do card; null quando o card não tem número ("sem venda do dia": alguma rota do filtro sem venda no mês; "—")
  const n = id => { const t = document.getElementById(id).textContent; return /\d/.test(t) ? Number(t.replace(/\D/g, '')) : null; };
  const ocultas = rotasVisiveis().filter(r => !rs.includes(r)), soma = (l, f) => l.reduce((a, r) => a + (f(r) || 0), 0);
  return {base, sem, temMes: !!P.SEM_COMPRA_MES, lim: CONFIG.LIMITE_LISTA,
    cards: {base: n('nBase'), vis: n('xBase'), sem: n('nSem'), semHoje: n('xSem')},
    ocultas: {n: ocultas.length, base: soma(ocultas, r => nodo('', r).baseTotal), vis: soma(ocultas, r => VISITAS_DIA.geral[r]),
              sem: soma(ocultas, r => nodo('', r).semCompra), semHoje: soma(ocultas, r => VISITAS_DIA.semCompra[r])},
    semRotas: soma(rs, r => nodo('', r).semCompra), semHojeRotas: soma(rs, r => VISITAS_DIA.semCompra[r])};
};
// abre uma gaveta e lê o padrão e cada chip da barra (sem barra: só o padrão)
async function leChips(page, abrir){
  await abrir();
  const out = {padrao: await page.evaluate(LE_GAV)};
  for(const d of out.padrao.chips){
    await page.click(`#dCorpo .dchip[data-d="${d}"]`);
    out[d] = await page.evaluate(LE_GAV);
  }
  await page.keyboard.press('Escape');
  return out;
}
const abreGaveta = (page, id) => page.evaluate(id => document.getElementById(id).click(), id);
const semTag = l => l.map(({r, pv, risc}) => ({r, pv, risc}));
const numSub = s => Number((s.match(/^[\d.]+/) || ['-1'])[0].replace(/\./g, ''));
const total = g => g.itens.length + g.resto;

/* confere as duas gavetas no filtro atual (aba de indicadores ou Executiva: os cards existem nas duas, ocultos ou não) */
async function confereGavetas(page, onde){
  const e = await page.evaluate(ESPERADO);
  const b = await leChips(page, () => abreGaveta(page, 'cBase')), s = await leChips(page, () => abreGaveta(page, 'cSem'));
  assert.deepEqual([b.padrao.on, b.padrao.tit], ['Hoje', 'Visitas de hoje'], `${onde}: Base abre no "Hoje"`);
  assert.deepEqual([s.padrao.on, s.padrao.tit], [e.temMes ? 'Hoje' : null, 'Sem compra hoje'], `${onde}: Sem compra abre no "Hoje"`);
  const chips = e.temMes ? CHIPS : [];
  const lado = [['Base', b, e.base], ...(e.temMes ? [['Sem compra', s, e.sem]] : [])];
  for(const [nome, g, esp] of lado) for(const d of CHIPS){
    const x = g[d], l = esp[d], quem = `${onde} ${nome} ${d}`;
    // "Hoje" inteiro (a lista de sempre); nos outros, os primeiros CONFIG.LIMITE_LISTA e o resto em "+ N clientes"
    if(d === 'Hoje') assert.equal(x.itens.length, l.length, `${quem}: inteiro`);
    else assert.equal(x.itens.length, Math.min(l.length, e.lim), `${quem}: limite`);
    assert.equal(total(x), l.length, `${quem}: total`);
    assert.deepEqual(semTag(x.itens), semTag(l.slice(0, x.itens.length)), `${quem}: itens`);
    for(const i of x.itens) assert.equal(i.tag, i.risc ? 'Venda Online' : '', `${quem}: tag`);
    assert.equal(numSub(x.sub), l.length, `${quem}: subtítulo "${x.sub}"`);
  }
  if(!e.temMes) assert.deepEqual(s.padrao.chips, chips, `${onde}: Sem compra sem a barra`);
  const sh = e.temMes ? s.Hoje : s.padrao;
  // contagens x cards (a diferença, quando há, é só a das rotas ocultas). O card "sem compra hoje" só tem número quando
  // todas as rotas do filtro têm venda no mês (senão, "sem venda do dia"): aí o "Hoje" = a soma das rotas com dado
  assert.equal(b.Hoje.itens.length, e.cards.vis - e.ocultas.vis, `${onde}: Hoje x visitas hoje`);
  if(e.cards.semHoje != null) assert.equal(sh.itens.length, e.cards.semHoje - e.ocultas.semHoje, `${onde}: Hoje x sem compra hoje`);
  assert.equal(sh.itens.length, e.semHojeRotas, `${onde}: Hoje x soma do sem compra hoje das rotas`);
  assert.equal(total(b.Todos), e.cards.base - e.ocultas.base, `${onde}: Todos x base`);
  if(e.temMes){
    if(e.cards.sem != null) assert.equal(total(s.Todos), e.cards.sem - e.ocultas.sem, `${onde}: Todos x semCompra do card`);
    assert.equal(total(s.Todos), e.semRotas, `${onde}: Todos x soma do semCompra das rotas`);
  }
  const multi = e.base.Todos.filter(x => x.dias.includes(' - '));
  const dia = d => total(b[d]);
  return {onde, ocultas: e.ocultas.n, base: e.cards.base, baseTodos: total(b.Todos), vis: e.cards.vis, baseHoje: b.Hoje.itens.length,
    sem: e.cards.sem, semTodos: e.temMes ? total(s.Todos) : '—',
    semHoje: e.cards.semHoje != null ? e.cards.semHoje : `"sem venda do dia" (rotas com dado: ${e.semHojeRotas})`, semHojeGav: sh.itens.length,
    riscHoje: sh.itens.filter(x => x.risc).length, dias: ['Seg', 'Ter', 'Qua', 'Qui', 'Sex'].map(d => `${dia(d)}/${e.temMes ? total(s[d]) : '—'}`).join(' '),
    multi: multi.length};
}

module.exports = {confereGavetas, leChips, LE_GAV, ESPERADO, CHIPS, total, semTag, numSub};
