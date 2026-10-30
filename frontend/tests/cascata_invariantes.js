/* Invariantes da cascata com Real + Online (Etapa 3 do pacote v3), conferidas no navegador com a gaveta aberta. Usadas pela
   Parte AG de front.test.js (dado sintético) e por conferencia_real.test.js (dado real). Não é um arquivo de teste: só exporta
   as funções. O esperado é recontado direto do payload e do online (indicators das rotas, COBERTOS, ONLINE.volume,
   ONLINE.clientes, VOLUME_CLIENTE, ONLINE.volumeCliente), sem realOnline()/realMaisOnline():
   (a) Volume: Dif da linha = Real + Online − Meta (data-dif exato; o número mostrado é ele arredondado);
   (b) Coberturas: Real <= Real + online <= Real + número da caixa Online, e = Σ Real + |online de hoje ∖ COBERTOS| por rota;
   (c) Σ linhas (+ nota das virtuais/EV*) = card do nível, em Meta e Real;
   (d) ordem padrão = a do código (gruposDo); ordenar por % dá data-dir decrescente (2º clique, crescente), com "Neutraliza"
       e os grupos sem dados no fim; o título da 1ª coluna (chip "Código") volta à ordem do código;
   (e) selo "✓ META BATIDA" ⇔ Real + online >= Meta (Meta > 0; no fechamento e sem online, Real >= Meta);
   (g) lista de clientes de volume: Real (faturado) + Online − Meta = Dif. Abs em todas as linhas exibidas.
   A (f) (card "Real + online" = Dif da linha do nível de cima) fica em conferencia_real.test.js e na Parte AG.
   Devolve linhas de resumo (só contagens, totais e códigos; nada de clientes). */
'use strict';
const assert = require('node:assert/strict');

// a cascata aberta: cada linha (na ordem da tela) com os números dos data-* e os textos; e o esperado recontado
const LE_CASCATA = () => {
  const num = s => s === '' || s == null ? null : Number(s);
  const {k, pilha, inc} = CASC, ctx = pilha[pilha.length - 1];
  const vol = ehVolume(k), doItem = rs => inc ? rotasInc(k, rs) : rs;
  // os grupos na ordem do código (a mesma conta de pintaCascata para o Todos a Bordo)
  let gs = gruposDo(ctx, k, true);
  if(inc) gs = gs.filter(g => !g.off && rotasInc(k, g.rotas).length);
  const ind = r => (nodo('', r) || {indicators: {}}).indicators[k];
  const onl = rs => rs.reduce((a, r) => a + ((((ONLINE && ONLINE[vol ? 'volume' : 'rotas']) || {})[r] || {})[k] || 0), 0);
  const roIndep = rs => {
    if(P.FECHAMENTO || !ONLINE) return null;
    if(vol){ const b = agrega(rs).ind[k]; return b && !b.unavailable ? b.real + onl(rs) : null; }
    let t = 0, n = 0;
    rs.forEach(r => {
      const b = ind(r);
      if(!b || b.unavailable) return;
      n++;
      const cob = new Set(((COBERTOS[r] || {})[k]) || []);
      t += (b.real || 0) + ((((ONLINE.clientes || {})[r] || {})[k]) || []).filter(pv => !cob.has(pv)).length;
    });
    return n ? t : null;
  };
  const linhas = [...document.querySelectorAll('#dCorpo .cLin')].map(el => {
    const d = el.dataset, i = d.i == null ? null : Number(d.i), g = i == null ? null : gs[i];
    const t = s => ((el.querySelector(s) || {}).textContent || '').replace(/\s+/g, ' ').trim();
    return {i, nome: t('.cNomeL b') || t('.cNome b'), off: el.classList.contains('off'), v3: el.classList.contains('v3'),
      fim: !!(g && g.fim), meta: num(d.meta), real: num(d.real), dir: num(d.dir), onl: num(d.onl), ro: num(d.ro), dif: num(d.dif),
      bat: d.bat === '1', fundo: el.classList.contains('bat'), selo: t('.cSelo'), difTxt: t('.cDif b'), difSub: t('.cDif small'),
      pct: t('.cPct b'), caixa: t('.cMeio .cOn'), colunas: [...el.children].map(c => c.classList[0]),
      esp: g && !g.off ? {onl: onl(doItem(g.rotas)), ro: roIndep(doItem(g.rotas))} : null};
  });
  const notas = [...document.querySelectorAll('#dCorpo .cNota')].map(n => ({meta: num(n.dataset.meta), real: num(n.dataset.real)}));
  const card = agrega(doItem(ctx.rotas)).ind[k];
  return {k, vol, vz: k === 'VENDAZERO', fech: !!P.FECHAMENTO, temOnline: !!ONLINE, nivel: ctx.nivel, nome: ctx.nome, n: gs.length,
    codigo: gs.map(g => g.nome), linhas, notas, card: card && !card.unavailable ? {meta: card.meta, real: card.real} : null,
    cab: !!document.querySelector('#dCorpo .cOrd'), chips: !!document.querySelector('#dCorpo .cOrdCh')};
};

// número mostrado (pt-BR, com sinal) -> Number
const leNum = s => Number(String(s).replace(/[^\d,+−-]/g, '').replace(/−/g, '-').replace(/\./g, '').replace(',', '.'));
const perto = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));

// (a), (b), (c), (e) e a ordem padrão (d) no nível aberto; devolve o resumo
async function confereNivel(page, onde){
  const c = await page.evaluate(LE_CASCATA);
  const ls = c.linhas.filter(l => !l.off);
  // (d) ordem padrão = a do código (a de gruposDo; "Neutraliza" por último)
  assert.deepEqual(c.linhas.map(l => l.nome), c.codigo, `${onde}: ordem do código`);
  if(c.vz){
    assert.ok(ls.every(l => !l.v3) && !c.cab && !c.chips, `${onde}: Venda Zero como antes, sem ordenação`);
  } else {
    assert.ok(c.linhas.length === 0 || (c.cab && c.chips), `${onde}: cabeçalho e chips de ordenação`);
    for(const l of ls){
      const q = `${onde} ${l.nome}`;
      assert.ok(l.v3, `${q}: linha nova`);
      assert.deepEqual(l.colunas, ['cNome', 'cEsq', 'cPct', 'cDif', 'cMeio'], `${q}: 5 colunas`);
      assert.ok(perto(l.onl, l.esp.onl), `${q}: online ${l.onl} x ${l.esp.onl}`);
      if(c.fech || !c.temOnline){
        assert.equal(l.ro, null, `${q}: sem Real + online`);
        assert.equal(l.difTxt, '—');
        assert.equal(l.difSub, c.fech ? 'sem online no fechamento' : 'sem online');
      } else if(c.vol){
        // (a) Dif = Real + Online − Meta
        assert.ok(perto(l.ro, l.real + l.onl), `${q}: Real + online ${l.ro} x ${l.real} + ${l.onl}`);
        assert.ok(perto(l.dif, l.real + l.onl - l.meta), `${q}: Dif ${l.dif}`);
        assert.equal(leNum(l.difTxt), Math.round(l.dif) || 0, `${q}: Dif mostrada "${l.difTxt}"`);
      } else {
        // (b) clientes distintos: entre Real e Real + caixa do Online; e o recontado
        assert.ok(l.ro >= l.real - 1e-9 && l.ro <= l.real + l.onl + 1e-9, `${q}: ${l.real} <= ${l.ro} <= ${l.real} + ${l.onl}`);
        assert.ok(perto(l.ro, l.esp.ro), `${q}: Real + online ${l.ro} x recontado ${l.esp.ro}`);
        assert.ok(perto(l.dif, l.ro - l.meta), `${q}: Dif`);
        assert.equal(leNum(l.difTxt), Math.round(l.dif * 10) / 10 || 0, `${q}: Dif mostrada "${l.difTxt}"`);
      }
      if(l.ro != null) assert.equal(l.difSub, l.meta > 0 ? `${Math.round(l.ro / l.meta * 100)}% da meta com online` : 'sem meta', `${q}: texto cinza`);
      // (e) selo ⇔ Real + online >= Meta (Meta > 0); sem online (fechamento), Real >= Meta
      const bat = l.meta > 0 && (l.ro == null ? l.real : l.ro) >= l.meta;
      assert.equal(l.bat, bat, `${q}: selo (data-bat)`);
      assert.equal(l.fundo, bat, `${q}: fundo verde-claro`);
      assert.equal(l.selo, bat ? '✓ Meta batida' : '', `${q}: selo`);
      assert.equal(l.pct, l.dir == null ? '—' : `${l.dir}%`, `${q}: %`);
    }
  }
  // (c) linhas (+ nota das virtuais/EV*) = card do nível
  if(c.card){
    const s = [...ls, ...c.notas].reduce((a, l) => ({meta: a.meta + l.meta, real: a.real + l.real}), {meta: 0, real: 0});
    assert.ok(perto(s.meta, c.card.meta, 1e-9) && perto(s.real, c.card.real, 1e-9), `${onde}: Σ linhas = card (${s.meta}/${s.real} x ${c.card.meta}/${c.card.real})`);
  }
  return {onde, k: c.k, nivel: c.nivel, linhas: ls.length, selos: ls.filter(l => l.bat).length,
    comOnline: ls.filter(l => l.ro != null && l.ro > l.real).length, card: c.card};
}

// (d) ordenar por % (data-dir decrescente; 2º clique crescente) e voltar ao código; pelo cabeçalho (PC) ou pelos chips
async function confereOrdem(page, onde){
  const c0 = await page.evaluate(LE_CASCATA);
  if(c0.vz) return;
  const pc = await page.evaluate(() => getComputedStyle(document.querySelector('#dCorpo .cOrd')).display !== 'none');
  const alvo = col => pc ? `#dCorpo .cOrdB[data-o="${col}"]` : `#dCorpo .cOrdCh .fchip[data-o="${col}"]`;
  const ordem = c => c.linhas.map(l => l.nome);
  for(const [col, val] of [['pct', l => l.dir], ['dif', l => l.dif], ['onl', l => l.onl]]){
    for(const dir of [-1, 1]){
      await page.click(alvo(col));
      const c = await page.evaluate(LE_CASCATA), ls = c.linhas;
      // valores primeiro (no sentido), depois os sem valor, e por último "Neutraliza" e os grupos sem dados (ordem do código)
      const faixa = l => l.off || l.fim ? 2 : val(l) == null ? 1 : 0;
      for(let j = 1; j < ls.length; j++){
        const [a, b] = [ls[j - 1], ls[j]];
        assert.ok(faixa(a) <= faixa(b), `${onde} ${col} ${dir}: faixas ${a.nome} / ${b.nome}`);
        if(faixa(a) === 0 && faixa(b) === 0) assert.ok(dir < 0 ? val(a) >= val(b) : val(a) <= val(b), `${onde} ${col} ${dir}: ${a.nome} ${val(a)} / ${b.nome} ${val(b)}`);
        if(faixa(a) === faixa(b) && faixa(a) > 0) assert.ok(a.i == null || b.i == null || a.i < b.i, `${onde}: fim na ordem do código`);
      }
      assert.deepEqual([...ordem(c)].sort(), [...ordem(c0)].sort(), `${onde} ${col}: as mesmas linhas`);
      // título ativo com a seta (↓ maior para o menor, ↑ o inverso)
      const seta = await page.$eval(alvo(col), b => b.textContent);
      assert.ok(seta.endsWith(dir < 0 ? '↓' : '↑'), `${onde} ${col}: seta "${seta}"`);
    }
  }
  await page.click(alvo(''));
  assert.deepEqual(ordem(await page.evaluate(LE_CASCATA)), ordem(c0), `${onde}: de volta à ordem do código`);
}

// (g) lista de clientes de volume aberta: Real (faturado) + Online − Meta = Dif. Abs; Online "—" no fechamento
const LE_LISTA = () => { const num = s => s === '' || s == null ? null : Number(s); return {fech: !!P.FECHAMENTO, cab: [...document.querySelectorAll('#dCorpo .cCab span')].map(s => s.textContent.trim()),
  linhas: [...document.querySelectorAll('#dCorpo .cCli')].map(el => {
    const sp = [...el.children].filter(c => c.tagName === 'SPAN').map(s => s.textContent.trim());
    return {meta: Number(el.dataset.meta), real: Number(el.dataset.real), onl: num(el.dataset.onl), dif: Number(el.dataset.dif), sp,
      cls: [...el.children].filter(c => c.tagName === 'SPAN').map(s => s.className)};
  })}; };
async function confereLista(page, onde){
  const l = await page.evaluate(LE_LISTA);
  if(!l.linhas.length) return {onde, clientes: 0, comOnline: 0};       // sem cliente com meta (ou ninguém no dia)
  assert.deepEqual(l.cab, ['Cliente', 'Meta', 'Real', 'Online', 'Dif. Abs', '%'], `${onde}: colunas`);
  const f1 = n => n.toLocaleString('pt-BR', {minimumFractionDigits: 1, maximumFractionDigits: 1});
  for(const x of l.linhas){
    assert.equal(x.sp.length, 5, `${onde}: Meta, Real, Online, Dif. Abs, %`);
    assert.equal(x.sp[1], f1(x.real), `${onde}: Real = só o faturado`);
    if(l.fech){ assert.equal(x.onl, null); assert.equal(x.sp[2], '—', `${onde}: Online no fechamento`); }
    else {
      assert.ok(Math.abs(x.real + x.onl - x.meta - x.dif) <= 0.051, `${onde}: Real ${x.real} + Online ${x.onl} − Meta ${x.meta} = Dif ${x.dif}`);
      assert.equal(x.sp[2], f1(x.onl));
      assert.equal(x.cls[2], x.onl > 0 ? 'onl' : 'onl0', `${onde}: cor do Online`);
    }
    assert.equal(x.sp[3], `${x.dif > 0 ? '+' : ''}${f1(x.dif)}`, `${onde}: Dif. Abs mostrada`);
  }
  for(let j = 1; j < l.linhas.length; j++) assert.ok(l.linhas[j - 1].dif <= l.linhas[j].dif, `${onde}: Dif. Abs crescente`);
  return {onde, clientes: l.linhas.length, comOnline: l.linhas.filter(x => x.onl > 0).length};
}

/* Para os "antes x depois" contra fronts de antes da Etapa 3 do pacote v3: desfaz, em HTML (strings dentro de objetos e
   listas também), só o que a etapa trocou de propósito, e o resto continua comparado byte a byte:
   - a Diferença dos cards, que desde 29/10/2026 é (Real + online de hoje) − Meta: volta a Real − Meta, pelos valores exatos
     do div (data-meta/data-real; data-vol = volume, arredondado);
   - o cabeçalho de colunas e os chips de ordenação da cascata (.cOrd, .cOrdCh);
   - a linha nova da cascata (.cLin.v3) volta à de antes (Nome | Meta e Real | Online | %; "do mês" nas coberturas), sem o
     selo, a coluna Dif e os data-* novos (os números, a ordem e a caixa do Online ficam como estão);
   - a lista de clientes de volume volta às colunas de antes (Real = Meta + Dif. Abs, o Real + Online; sem a coluna Online).
   Na Diretoria a gerência abre direto a lista de clientes: os testes antigos conferem só o 1º nível da cascata ali. */
const f1 = n => n.toLocaleString('pt-BR', {minimumFractionDigits: 1, maximumFractionDigits: 1});
const LINHA_V3 = new RegExp('<div class="cLin v3 (ok|no)(?: bat)?" role="button" tabindex="0" data-i="(\\d+)"\\s+' +
  'data-meta="([^"]*)" data-real="([^"]*)" data-dir="([^"]*)" data-onl="[^"]*"\\s+data-ro="[^"]*" data-dif="[^"]*" data-bat="[01]">\\n\\s*' +
  '<div class="cNome"><div class="cNomeL"><b>([^<]*)</b>(?: <span class="cSelo">[^<]*</span>)?</div><small>([^<]*)</small></div>\\n\\s*' +
  '<div class="cEsq">(<span>[^<]*</span><span>[^<]*</span>)</div>\\n\\s*' +
  '<div class="cPct"><b>([^<]*)</b><small>([^<]*)</small></div>\\n\\s*' +
  '<div class="cDif[^"]*"><b>[^<]*</b><small>[^<]*</small></div>\\n\\s*' +
  '<div class="cMeio">(<span class="cOn[^"]*">[^<]*</span><small>[^<]*</small>)</div></div>', 'g');
const CLI_V3 = new RegExp('<div class="cCli v3" data-dif="([^"]*)" data-meta="([^"]*)" data-real="[^"]*" data-onl="[^"]*">\\n\\s*' +
  '<div class="cCliN">(<div class="nm">[^<]*</div>\\n\\s*<div class="sb">[^<]*</div></div>)\\n\\s*' +
  '(<span>[^<]*</span>)<span>[^<]*</span>\\n\\s*<span class="onl0?">[^<]*</span>\\n\\s*(<span class="(?:pos|neg)">[^<]*</span><span>[^<]*</span></div>)', 'g');
const desfazCasc = x => {
  if(Array.isArray(x)) return x.map(desfazCasc);
  if(x && typeof x === 'object') return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, desfazCasc(v)]));
  if(typeof x !== 'string') return x;
  return x.replace(/<div class="dif (?:pos|neg)" data-meta="([^"]*)" data-real="([^"]*)" data-ro="[^"]*"( data-vol="")?>Diferença [^<]*<\/div>/g,
      (m, meta, real, vol) => { const d = Number(real) - Number(meta);
        return `<div class="dif ${d >= 0 ? 'pos' : 'neg'}">Diferença ${d > 0 ? '+' : ''}${(vol ? Math.round(d) : d).toLocaleString('pt-BR')}</div>`; })
    .replace(/<div class="cOrd v3"[^]*?<\/div><div class="cOrdCh v3"[^]*?<\/div>/g, '')
    .replace(LINHA_V3, (m, cor, i, meta, real, dir, nome, info, esq, pct, rot, meio) =>
      `<div class="cLin ${cor}" role="button" tabindex="0" data-i="${i}" data-meta="${meta}" data-real="${real}" data-dir="${dir}">\n` +
      `    <div class="cNome"><b>${nome}</b><small>${info}</small></div>\n    <div class="cEsq">${esq}</div>\n` +
      `    <div class="cMeio">${meio}</div>\n    <div class="cDir"><b>${pct}</b><small>${rot === 'real da meta' ? 'do mês' : rot}</small></div></div>`)
    .replace('<div class="cCab v3"><span class="cCabN">Cliente</span><span>Meta</span><span>Real</span><span>Online</span>\n      ' +
             '<span title="(Real + Online) − Meta">Dif. Abs</span><span title="(Real + Online) ÷ Meta">%</span></div>',
             '<div class="cCab"><span>Cliente</span><span>Meta</span><span>Real</span>\n      <span>Dif. Abs</span><span>%</span></div>')
    .replace(CLI_V3, (m, dif, meta, nome, sMeta, resto) => `<div class="cCli" data-dif="${dif}"><div>${nome}\n      ${sMeta}` +
      `<span>${f1(Number(meta) + Number(dif))}</span>\n      ${resto}`);
};

module.exports = {LE_CASCATA, LE_LISTA, confereNivel, confereOrdem, confereLista, leNum, desfazCasc};
