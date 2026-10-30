/* Invariantes da gaveta "Categoria por unidade" da aba Executiva (tocar num medidor do bloco "Categorias"), conferidas no
   navegador com o filtro atual. Usadas pela Parte AC de front.test.js (dado sintético) e por conferencia_real.test.js (dado
   real). Não é um arquivo de teste: só exporta as funções. Desde a Etapa 6 do pacote v3 a gaveta é uma TABELA (.ctTab: # |
   unidade | Meta | Real | % Real | Online | Faltam | Tendência; sem a Tendência no fechamento); as invariantes de soma e de
   status são as mesmas dos cartões de antes, mais o Online. O esperado é recontado direto do payload e do online (meta, real e
   tendência de cada rota em P.DATA; ONLINE.volume), sem agrega() nem as funções da gaveta; as unidades são os grupos da
   cascata no 1º nível do escopo da Executiva (gcsComDados/rotasDe; svsEmOrdem/rotasNormais + rotasNeutraliza; as rotas normais
   da supervisão), também com o escopo do nível acima (Gerência em BAND, Supervisão na GC):
   (a) linha de total (a 1ª): Meta, Real e % real = os do medidor da categoria; Online = o "online" do medidor (quando ele
       mostra) e = a soma direta do online das rotas do escopo; Meta, Real, % real e pctTendencia = os do card da aba Volume
       com o mesmo escopo (no fechamento, o % do card é o realizado); e = a soma direta das rotas;
   (b) Σ Meta, Real, Online e Tendência das linhas de unidade + as unidades sem meta na categoria + as rotas fora das unidades
       (virtuais, '-EV', supervisões só de Neutraliza/virtuais) = o total;
   (c) linhas = as unidades com meta (> 0) na categoria, do maior para o menor Real / Meta (valor exato) na ordem padrão;
   (d) status (data-st, faixa de 4 px, cor do % Real e da Tendência) pela regra: Real >= Meta verde;
       Math.round(Tendência / Meta * 100) >= 100 âmbar (fora do fechamento); o resto vermelho; selo "✓ Meta batida" (e fundo
       verde-claro) <=> Real + Online >= Meta (fechamento: Real >= Meta);
   (e) Faltam = Meta − (Real + Online) (arredondado, vermelho) ou "+X" verde com Real + Online >= Meta (X = Real + Online −
       Meta; sem online e no fechamento, pelo Real; pedido da Karen de 30/10/2026); Tendência = pctTendencia
       ("Y%"); Online verde com meta do dia batida ou online >= meta do dia, vermelho abaixo, sem cor sem meta do dia; no
       fechamento, sem a coluna Tendência e o título "Online hoje";
   (f) a linha "Neutraliza", quando existir, é a última (também ao reordenar);
   (g) reordenar por % Real, Online, Faltam e Tendência (1º clique decrescente, 2º inverte; seta e título ativo): total fixo
       no topo, valores em ordem, "Neutraliza" no fim; o subtítulo diz a ordem;
   título "<Categoria> por <nível>", subtítulo com o critério, "N <nível>" e "ordenado por …", legenda; fechar mantém a
   categoria em análise. Medidor sem meta no escopo: não abre a gaveta. Devolve uma linha de resumo (só totais e códigos). */
'use strict';
const assert = require('node:assert/strict');

// a gaveta aberta (linhas na ordem da tela)
const LE_GAVETA = () => {
  const n = v => v === '' || v == null ? null : Number(v);
  const cs = el => getComputedStyle(el);
  const vis = el => !!el && el.getClientRects().length > 0 && cs(el).display !== 'none';
  // faixa = sombra interna da 1ª célula visível da linha (# no PC; a unidade abaixo de 700 px)
  const faixa = tr => { const c = [...tr.children].find(vis); const m = cs(c).boxShadow.match(/^(rgba?\([^)]*\)) (\d+(?:\.\d+)?)px 0px 0px 0px inset/);
    return m ? [m[1], Number(m[2])] : [null, 0]; };
  const txt = (tr, c) => { const el = tr.querySelector('.' + c); return el ? el.textContent : null; };
  const cor = (tr, c) => { const el = tr.querySelector('.' + c); return el ? cs(el).color : null; };
  return {tit: document.getElementById('dTit').textContent, sub: document.getElementById('dSub').textContent,
    aberta: document.getElementById('drw').classList.contains('on'), k: (document.querySelector('#dCorpo .cuGav') || {dataset: {}}).dataset.k,
    leg: [...document.querySelectorAll('#dCorpo .cuLeg span')].map(s => [s.querySelector('.cuLg').className.replace('cuLg ', ''), s.textContent]),
    rod: (document.querySelector('#dCorpo .ctRod') || {}).textContent || '',
    vazio: (document.querySelector('#dCorpo .cuGav .vazio') || {}).textContent || '',
    barras: document.querySelectorAll('#dCorpo .cuTr, #dCorpo .cuBar, #dCorpo .cuCard').length,
    cab: [...document.querySelectorAll('#dCorpo .ctTab thead th')].map(th => ({cls: th.className, t: th.textContent, vis: vis(th),
      ord: (th.querySelector('.ctOrd') || {dataset: {}}).dataset.col || null, on: !!th.querySelector('.ctOrd.on'), sort: th.getAttribute('aria-sort'),
      cor: th.querySelector('.ctOrd') ? cs(th.querySelector('.ctOrd')).color : null})),
    linhas: [...document.querySelectorAll('#dCorpo .ctTab tbody tr.ctLin')].map(tr => ({u: tr.dataset.u, st: tr.dataset.st,
      tot: tr.classList.contains('ctTot'), cls: tr.className, meta: n(tr.dataset.meta), real: n(tr.dataset.real), onl: n(tr.dataset.onl),
      tend: n(tr.dataset.tend), pct: n(tr.dataset.pct), pctTend: n(tr.dataset.pctTend), ro: n(tr.dataset.ro), bat: tr.dataset.bat === 'true', title: tr.title,
      selo: tr.querySelector('.ctSelo') ? tr.querySelector('.ctSelo').textContent : null, nCel: [...tr.children].filter(vis).length,
      n: txt(tr, 'ctN'), cod: txt(tr, 'ctCod'), info: txt(tr, 'ctInfo'), metaTxt: txt(tr, 'ctMeta'), realTxt: txt(tr, 'ctReal'),
      pctTxt: txt(tr, 'ctPct'), onlTxt: txt(tr, 'ctOnl'), faltTxt: txt(tr, 'ctFalt'), tendTxt: txt(tr, 'ctTend'),
      onlCls: tr.querySelector('.ctOnl').className, faltCls: tr.querySelector('.ctFalt').className,
      faixa: faixa(tr), corPct: cor(tr, 'ctPct'), corTend: cor(tr, 'ctTend'), corOnl: cor(tr, 'ctOnl'), corFalt: cor(tr, 'ctFalt'),
      bg: cs(tr.children[1]).backgroundColor, dica: tr.dataset.dica}))};
};
// cores de referência (as variáveis do CSS) de cada status e das colunas
const CORES = () => { const ref = v => { const s = document.createElement('span'); s.style.color = `var(${v})`; document.body.appendChild(s);
  const c = getComputedStyle(s).color; s.remove(); return c; };
  return {bat: ref('--verde'), tend: ref('--ambar'), abx: ref('--vermelho'), esc: {bat: ref('--verdeE'), tend: 'rgb(125, 90, 0)', abx: ref('--ruim')},
    verdeE: ref('--verdeE'), vermelho2: ref('--vermelho2'), txt: ref('--txt'), batBg: 'rgb(238, 248, 242)'}; };
// o esperado da categoria k no escopo atual da Executiva, recontado do payload e do online (ver o cabeçalho)
const ESPERADO = k => {
  const fech = !!P.FECHAMENTO, acima = typeof acimaAtivo === 'function' && acimaAtivo();
  const dir = acima ? ACESSO.perfil === 'gc' : sel.modo === 'dir';
  const gc = acima ? (ACESSO.perfil === 'gc' ? '' : ACESSO.gc) : dir ? sel.dgc : sel.gc, sv = acima || dir ? '' : sel.sv;
  const onl = r => ONLINE ? ((((ONLINE.volume || {})[r]) || {})[k] || 0) : 0;
  const soma = rs => rs.reduce((a, r) => { const b = nodo('', r).indicators[k];
    a.onl += onl(r);
    if(!b || b.unavailable) return a;
    a.meta += b.meta || 0; a.real += b.real || 0; a.tend += b.tendencia || 0; a.md += b.metaDia || 0; a.mdN += b.metaDia != null ? 1 : 0; a.n++;
    return a; }, {meta: 0, real: 0, tend: 0, onl: 0, md: 0, mdN: 0, n: 0});
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
  return {fech, acima, nivel, nome: rotuloInd(k), tot: {...t, st: t.n && t.meta > 0 ? st(t) : null}, un, temOnline: !!ONLINE,
    fora: soma(tot.filter(r => !dentro.has(r))), nFora: tot.filter(r => !dentro.has(r)).length};
};
// o medidor da categoria (Meta, Real, % real) e o card de Volume (lidos antes, na aba Volume)
const LE_MEDIDOR = k => { const g = document.querySelector(`#exGauges .gCard[data-k="${k}"]`);
  return {off: g.classList.contains('off'), role: g.getAttribute('role'), pct: (g.querySelector('.gPct') || {}).firstChild ? g.querySelector('.gPct').firstChild.textContent : null,
    mr: [...g.querySelectorAll('.gMR b')].map(b => b.textContent), sel: g.classList.contains('sel'),
    dia: (g.querySelector('.gDia') || {}).textContent || ''}; };
const LE_VOLUME = () => Object.fromEntries([...document.querySelectorAll('#lista .ind.vol[data-k]')].map(el => {
  const big = el.querySelector('.big').cloneNode(true); big.querySelector('.seta').remove();
  return [el.dataset.k, {meta: el.querySelector('.cl > div:nth-child(1)').textContent.trim(), real: el.querySelector('.cl > div:nth-child(2)').textContent.trim(),
    big: big.textContent.trim(), opo: el.querySelector('.opo').textContent.trim()}]; }));

const f0 = v => Math.round(v).toLocaleString('pt-BR');
const quase = (a, b, onde) => assert.ok(Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b)), `${onde}: ${a} x ${b}`);
const NIVEIS = {'gerência': 'gerências', 'supervisão': 'supervisões', rota: 'rotas'};
const vaiAba = (page, aba) => page.evaluate(aba => document.querySelector(`.tab[data-g="${aba}"]`).click(), aba);

const ORD = {pct: '% da meta', onl: 'online', falt: 'faltam', tend: 'tendência'};
const valOrd = (x, col) => col === 'pct' ? x.real / x.meta : col === 'onl' ? x.onl : col === 'falt' ? x.meta - (x.ro == null ? x.real : x.ro) : x.tend == null ? null : x.tend / x.meta;
// (g) a ordem das linhas de unidade numa coluna (dir -1 = decrescente): valores em ordem, sem valor no fim, "Neutraliza" por último
function confereOrdem(us, col, dir, o){
  const normais = us.filter(x => x.u !== 'Neutraliza');
  for(let i = 1; i < normais.length; i++){
    const a = valOrd(normais[i - 1], col), b = valOrd(normais[i], col);
    if(a == null) assert.equal(b, null, `${o}: sem valor só no fim (${normais[i - 1].u} ${normais[i].u})`);
    else if(b != null) assert.ok(dir < 0 ? a >= b - 1e-9 : a <= b + 1e-9, `${o}: ordem ${col} ${normais[i - 1].u} ${normais[i].u}`);
  }
  if(us.some(x => x.u === 'Neutraliza')) assert.equal(us[us.length - 1].u, 'Neutraliza', `${o}: Neutraliza por último`);
}
// clica num título ordenável e lê a gaveta de novo
const clicaOrd = async (page, col) => { await page.evaluate(col => document.querySelector(`#dCorpo .ctOrd[data-col="${col}"]`).click(), col);
  return page.evaluate(LE_GAVETA); };

// confere as 5 categorias no escopo atual; devolve {onde, cats: {k: resumo}}. ordena = também reordenar pelos 4 títulos (g)
async function confereCategoria(page, onde, {ordena = true} = {}){
  await vaiAba(page, 'VOLUME');
  const vol = await page.evaluate(LE_VOLUME);
  await vaiAba(page, 'EXEC');
  const ks = await page.evaluate(() => GROUPS.VOLUME), cores = await page.evaluate(CORES), cats = {};
  for(const k of ks){
    const o = `${onde} ${k}`, esp = await page.evaluate(ESPERADO, k), med = await page.evaluate(LE_MEDIDOR, k);
    const comMeta = esp.tot.n > 0 && esp.tot.meta > 0;
    assert.equal(!med.off, comMeta, `${o}: medidor com meta`);
    await page.click(`#exGauges .gCard[data-k="${k}"]`);
    await page.mouse.move(1, 1);          // sem hover numa linha (o fundo é conferido)
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
    // tabela: as colunas (7 no fechamento, sem a Tendência), sem barras nem Desvio
    const cabEsp = ['#', esp.nivel[0].toUpperCase() + esp.nivel.slice(1), 'Meta', 'Real', '% Real', esp.fech ? 'Online hoje' : 'Online', 'Faltam',
      ...(esp.fech ? [] : ['Tendência'])];
    assert.deepEqual(g.cab.map(c => c.t.replace(/[↓↑]/g, '')), cabEsp, `${o}: colunas`);
    assert.deepEqual(g.cab.filter(c => c.ord).map(c => c.ord), ['pct', 'onl', 'falt', ...(esp.fech ? [] : ['tend'])], `${o}: títulos que ordenam`);
    assert.equal(g.barras, 0, `${o}: sem barras nem cartões`);
    assert.ok(!g.cab.some(c => /desvio/i.test(c.t)), `${o}: sem Desvio`);
    const [tot, ...us] = g.linhas;
    // (a) total (1ª linha) = medidor = card de Volume = soma das rotas do escopo
    assert.ok(tot.tot && !us.some(c => c.tot), `${o}: um total, primeiro`);
    assert.equal(tot.n, '', `${o}: total sem número`);
    for(const c of ['meta', 'real']) quase(tot[c], esp.tot[c], `${o}: total ${c}`);
    if(!esp.fech) quase(tot.tend, esp.tot.tend, `${o}: total tendência`);
    assert.deepEqual([tot.metaTxt, tot.realTxt], [f0(tot.meta), f0(tot.real)], `${o}: Meta e Real do total`);
    assert.deepEqual(med.mr, [f0(tot.meta), f0(tot.real)], `${o}: total x medidor (Meta, Real)`);
    assert.equal(tot.pctTxt, med.pct, `${o}: % real do total x medidor`);
    if(esp.temOnline){
      quase(tot.onl, esp.tot.onl, `${o}: online do total`);
      const mo = med.dia.match(/online ([\d.]+)$/);
      if(mo) assert.equal(f0(tot.onl), mo[1], `${o}: online do total x medidor`);
    } else assert.equal(tot.onl, null, `${o}: sem online`);
    // (com o escopo do nível acima marcado, a aba Volume continua no acesso: a comparação com o card não se aplica)
    const card = esp.acima ? null : vol[k];
    if(!esp.acima) assert.ok(card, `${o}: card de Volume`);
    if(card){
      assert.deepEqual([card.meta, card.real], [`Meta ${f0(tot.meta)}`, `Real ${f0(tot.real)}`], `${o}: total x card de Volume`);
      if(esp.fech) assert.equal(card.big, `${tot.pct}%`, `${o}: % realizado do card`);
      else {
        assert.equal(card.big, `${tot.pctTend}%`, `${o}: pctTendencia do card`);
        assert.equal(card.opo, `${tot.pct}% real`, `${o}: % real do card`);
      }
    }
    if(!esp.fech) assert.equal(tot.pctTend, Math.round(esp.tot.tend / esp.tot.meta * 100), `${o}: pctTendencia recontado`);
    assert.equal(tot.pct, Math.round(esp.tot.real / esp.tot.meta * 100), `${o}: % real recontado`);
    // (b) Σ unidades (linhas) + unidades sem meta + rotas fora das unidades = total (Meta, Real, Online, Tendência)
    const semMeta = esp.un.filter(x => !x.com);
    for(const c of ['meta', 'real', ...(esp.temOnline ? ['onl'] : []), ...(esp.fech ? [] : ['tend'])])
      quase(us.reduce((s, x) => s + x[c], 0) + semMeta.reduce((s, x) => s + x[c], 0) + esp.fora[c], tot[c], `${o}: Σ ${c}`);
    // (c) as unidades com meta, do maior para o menor Real / Meta, e só elas; (f) "Neutraliza" por último
    const comM = esp.un.filter(x => x.com);
    assert.deepEqual([...us.map(x => x.u)].sort(), comM.map(x => x.u).sort(), `${o}: unidades com meta`);
    confereOrdem(us, 'pct', -1, `${o} padrão`);
    assert.deepEqual(us.map(x => x.n), us.map((x, i) => String(i + 1)), `${o}: numeração`);
    assert.equal(g.sub, `${esp.fech ? 'Realizado ÷ Meta · cor pelo realizado' : 'Real até ontem ÷ Meta · cor pela tendência do SAC'} · ` +
      `${us.length} ${us.length === 1 ? esp.nivel : NIVEIS[esp.nivel]} · ordenado por % da meta`, `${o}: subtítulo`);
    const pct = g.cab.find(c => c.ord === 'pct');
    assert.deepEqual([pct.on, pct.sort, pct.cor], [true, 'descending', cores.vermelho2], `${o}: % Real ativo`);
    // (d) status de cada linha pela regra, recontado das rotas; (e) textos e cores das colunas
    for(const c of g.linhas){
      const e = c.tot ? esp.tot : comM.find(x => x.u === c.u), oc = `${o} ${c.u}`;
      if(!c.tot){ for(const m of ['meta', 'real']) quase(c[m], e[m], `${oc} ${m}`); if(esp.temOnline) quase(c.onl, e.onl, `${oc} online`); }
      assert.equal(c.st, e.st, `${oc}: status`);
      if(esp.fech) assert.notEqual(c.st, 'tend', `${oc}: sem âmbar no fechamento`);
      assert.deepEqual(c.faixa, [cores[c.st], 4], `${oc}: faixa de 4 px na cor do status`);
      assert.equal(c.corPct, cores[c.st], `${oc}: cor do % Real`);
      assert.match(c.cls, {bat: /\bcuBat\b/, tend: /\bcuTend\b/, abx: /\bcuAbx\b/}[c.st], oc);
      assert.equal(c.pctTxt, `${Math.round(c.real / c.meta * 100)}%`, `${oc}: % real`);
      // Faltam = Meta − (Real + Online); sem online e no fechamento, Meta − Real
      const ro = esp.fech || c.onl == null ? null : c.real + c.onl, base = ro == null ? c.real : ro;
      if(ro == null) assert.equal(c.ro, null, `${oc}: sem Real + Online`); else quase(c.ro, ro, `${oc}: Real + Online`);
      assert.equal(c.faltTxt, base >= c.meta ? `+${f0(base - c.meta)}` : f0(c.meta - base), `${oc}: Faltam`);
      assert.equal(c.corFalt, base >= c.meta ? cores.verdeE : cores.vermelho2, `${oc}: cor do Faltam`);
      assert.equal(c.onlTxt, c.onl == null ? '—' : f0(c.onl), `${oc}: Online`);
      // Online: verde com a meta do dia batida ou online >= meta do dia; vermelho abaixo; sem cor sem meta do dia
      const md = esp.fech || !e.mdN ? null : e.md;
      const corO = md == null || c.onl == null ? '' : md <= 1e-9 || c.onl >= md ? 'ok' : 'no';
      assert.equal(c.onlCls, `ctOnl${corO ? ' ' + corO : ''}`, `${oc}: cor do Online (meta do dia ${md})`);
      // selo e fundo: Real + Online >= Meta (fechamento: Real >= Meta)
      const bat = c.meta > 0 && (esp.fech || c.onl == null ? c.real : c.real + c.onl) >= c.meta;
      assert.equal(c.bat, bat, `${oc}: selo`);
      assert.equal(c.selo, bat ? '✓ Meta batida' : null, `${oc}: texto do selo`);
      if(bat && !c.tot) assert.equal(c.bg, cores.batBg, `${oc}: fundo verde-claro`);
      if(esp.fech) assert.equal(c.tendTxt, null, `${oc}: sem Tendência no fechamento`);
      else {
        assert.equal(c.tendTxt, `${c.pctTend}%`, `${oc}: Tendência`);
        assert.equal(c.pctTend, Math.round(c.tend / c.meta * 100), `${oc}: pctTendencia`);
        assert.equal(c.corTend, cores.esc[c.st], `${oc}: cor da Tendência`);
      }
    }
    assert.deepEqual(g.leg.map(x => x[0]), esp.fech ? ['cuBat', 'cuAbx'] : ['cuBat', 'cuTend', 'cuAbx'], `${o}: legenda`);
    assert.equal(g.rod, `Clique em % Real, Online${esp.fech ? ' ou Faltam' : ', Faltam ou Tendência'} para reordenar.`, `${o}: rodapé`);
    // (g) reordenar: cada título (1º clique decrescente, 2º inverte); total fixo no topo
    if(ordena) for(const col of ['onl', 'falt', ...(esp.fech ? [] : ['tend']), 'pct']){
      for(const dir of [-1, 1]){
        const r = await clicaOrd(page, col), oo = `${o} ordem ${col} ${dir}`;
        assert.ok(r.linhas[0].tot && r.linhas[0].u === tot.u, `${oo}: total fixo no topo`);
        assert.deepEqual(r.linhas.slice(1).map(x => x.u).sort(), us.map(x => x.u).sort(), `${oo}: as mesmas linhas`);
        confereOrdem(r.linhas.slice(1), col, dir, oo);
        const h = r.cab.find(c => c.ord === col);
        assert.deepEqual([h.on, h.sort, h.t.slice(-1), h.cor], [true, dir < 0 ? 'descending' : 'ascending', dir < 0 ? '↓' : '↑', cores.vermelho2], `${oo}: título`);
        assert.equal(r.cab.filter(c => c.on).length, 1, `${oo}: um título ativo`);
        assert.ok(r.sub.endsWith(`· ordenado por ${ORD[col]}`), `${oo}: subtítulo`);
      }
    }
    // fechar mantém a categoria em análise
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.getElementById('drw').classList.contains('on')), false, `${o}: fechou`);
    assert.equal(await page.evaluate(() => catAtual()), k, `${o}: categoria em análise depois de fechar`);
    assert.ok((await page.evaluate(LE_MEDIDOR, k)).sel, `${o}: medidor marcado depois de fechar`);
    const nSt = s => us.filter(c => c.st === s).length;
    cats[k] = {n: us.length, pct: tot.pct, tend: esp.fech ? null : tot.pctTend, st: tot.st, bat: nSt('bat'), am: nSt('tend'), abx: nSt('abx'),
      selo: us.filter(c => c.bat).length, onl: tot.onl == null ? null : Math.round(tot.onl), semMeta: semMeta.length, fora: esp.nFora,
      neutra: us.some(x => x.u === 'Neutraliza')};
  }
  return {onde, cats};
}

// textos cortados e rolagem lateral dentro da gaveta da categoria (só o que está à vista)
const CORTES_CAT = () => [...document.querySelectorAll('#dCorpo .cuGav, #dCorpo .cuGav *')].filter(el => el.clientWidth > 0 &&
  el.getClientRects().length && !/auto|scroll/.test(getComputedStyle(el).overflowX) && el.scrollWidth > el.clientWidth + 1)
  .map(el => `${el.className || el.tagName}: ${el.textContent.trim().slice(0, 40)}`)
  .concat(document.getElementById('dCorpo').scrollWidth > document.getElementById('dCorpo').clientWidth + 1 ? ['#dCorpo rola de lado'] : []);

module.exports = {confereCategoria, LE_GAVETA, ESPERADO, CORTES_CAT, CORES, clicaOrd, confereOrdem};
