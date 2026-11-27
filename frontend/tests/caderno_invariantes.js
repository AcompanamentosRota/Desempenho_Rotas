/* Invariantes do Caderno de Vendas (Frente 2), usadas pela Parte AR do front.test.js e pela conferência com
   DADO REAL (conferencia_real.test.js).

   A recontagem aqui é INDEPENDENTE: lê o payload.json como objeto, soma na mão e NÃO usa nenhuma função do front
   (nem montaCaderno, nem agrega, nem NUCLEO). É isso que dá valor à conferência.

   (a) TOTAL = a agregação de TODAS as rotas do escopo (com Neutraliza, virtuais e a oculta das EV*), ao formato da
       coluna — o mesmo número do card do painel —, e é a PRIMEIRA linha de cada cartão (R-BO-07).
   (b) Σ das linhas + a parcela das rotas que não viraram linha = TOTAL (tolerância 0,05 no volume e 0 na cobertura);
       onde houver resíduo, a nota está no rodapé da folha com o valor certo.
   (c) Dif e % recalculados dos valores CRUS batem com a tela, célula a célula (R-QLD-15). Conta também em quantas
       células a conta ERRADA (arredondar antes de subtrair/dividir) daria outro número.
   (d) Pré-v. e R. M.A somados do payload pelo ÍNDICE DO NOME do indicador batem com a tela; rota com null não
       entrou como 0 e linha toda null ficou "sem meta" (ou vazia, nas duas colunas).
   (e) Ritmo recalculado dos valores crus bate com a coluna (nunca o % já arredondado). Conta também em quantas
       células a conta errada daria outro número.
   (f) Rótulos das unidades (R-BO-07): "SV.G2.1 · <primeiro nome>" na gerência, "<rota> · <primeiro nome>" na
       supervisão, "Sem vendedor" onde o payload diz ROTA SEM VENDEDOR, e a ordem (Neutraliza por último).
   (g) Neutraliza: a supervisão só de rotas Neutraliza aparece como "Neutraliza · <rotas>", na ÚLTIMA linha, com os
       números das rotas dela.
   (h) Situação do cartão (ATRÁS / NO RITMO) e o % em destaque = os valores crus do TOTAL; o % em fundo preto marca
       exatamente as unidades atrás.
   (i) Tags de segmento: FOCO só no KS TT, FOCO 600 só na Cervejas 600ml Retornável, nenhum outro cartão com tag.
   (j) Geometria (só no navegador): nenhum texto cortado, nenhum cartão transbordando, o rodapé sem sobrepor cartão,
       a quebra a cada `porFolha` cartões e o cartão com a mesma altura em todas as folhas do escopo.

   Nada daqui imprime nome ou código de cliente: só totais e códigos de gerência, supervisão e rota. */
'use strict';

const assert = require('node:assert/strict');

const FORA_COB = ['IMPERDOAVEIS', 'VENDAZERO'];
// as mesmas tags do CAD_TAG_SEGMENTO do caderno.js, recriadas aqui (a conferência não importa nada do front)
const TAGS = {'KS TT': 'FOCO', 'CERVEJAS 600ML RETORNAVEL': 'FOCO 600'};

/* ---------- leitura crua do payload ---------- */
function indices(P){
  const nodo = {};
  for(const gc in P.DATA) for(const sv in P.DATA[gc]) for(const r in P.DATA[gc][sv]) nodo[r] = P.DATA[gc][sv][r];
  return nodo;
}
const bloco = (nodo, r, k) => ((nodo[r] || {}).indicators || {})[k];
const ehVirtual = (P, r) => (P.VIRTUAIS_ROTAS || []).includes(r) || (P.EVENTUAIS_ROTAS || []).includes(r);

// itens de cada folha, na ordem em que o Caderno os desenha
function itensFolha(P, tipo, rotasEscopo, nodo){
  if(tipo === 'vol'){
    const disp = k => rotasEscopo.some(r => { const b = bloco(nodo, r, k); return b && !b.unavailable; });
    return [...(P.GROUPS.VOLUME || []), ...Object.keys(P.VOLUME_EXTRA || {}).filter(disp)];
  }
  const cob = [...(P.GROUPS.ICS_GC || []), ...(P.GROUPS.NOVOS_NEG || []), ...(P.GROUPS.INCENTIVO || [])];
  return [...new Set(cob)].filter(k => !FORA_COB.includes(k));
}

/* unidades e rotas do escopo, pela regra do item 8 e pelos rótulos da R-BO-07: no nível Gerência, todas as
   supervisões do payload (inclusive a oculta SV.G3.3), menos a das rotas ocultas das EV*, com o código e o primeiro
   nome do supervisor — e a que só tem rotas Neutraliza vira "Neutraliza · <rotas>", por último. No nível Supervisão,
   as rotas dela sem as virtuais, com o primeiro nome do consultor.
   A ORDEM das rotas dentro de cada conjunto é a do payload: a soma de float tem de ser a mesma do front. */
function ordemNatural(a, b){
  const x = String(a).toUpperCase().match(/\d+|\D+/g) || [], y = String(b).toUpperCase().match(/\d+|\D+/g) || [];
  for(let i = 0; i < Math.min(x.length, y.length); i++){
    const nx = /^\d/.test(x[i]), ny = /^\d/.test(y[i]);
    if(nx && ny){ if(Number(x[i]) !== Number(y[i])) return Number(x[i]) - Number(y[i]); continue; }
    if(nx !== ny) return nx ? -1 : 1;
    if(x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  }
  return x.length - y.length || (a < b ? -1 : a > b ? 1 : 0);
}
const titulo = s => String(s == null ? '' : s).toLowerCase().replace(/(^|\s)\S/g, m => m.toUpperCase());
const primeiroNome = s => { const n = String(s == null ? '' : s).trim();
  return !n || /SEM\s+VENDEDOR/i.test(n) ? 'Sem vendedor' : titulo(n.split(/\s+/)[0]); };

function escopoDe(P, escopo){
  const D = P.DATA || {}, gc = escopo.gc, evs = new Set(P.EVENTUAIS_ROTAS || []);
  const neutras = new Set(P.NEUTRALIZA_ROTAS || []);
  const svs = Object.keys(D[gc] || {});
  const rotasSv = s => Object.keys((D[gc] || {})[s] || {});
  if(escopo.nivel === 'sv'){
    const rotas = rotasSv(escopo.sv);
    return {rotasEscopo: rotas, unidades: rotas.filter(r => !ehVirtual(P, r)).sort(ordemNatural)
      .map(r => ({cod: r, rotulo: `${r} · ${primeiroNome((D[gc][escopo.sv][r] || {}).consultor)}`, rotas: [r]}))};
  }
  const uteis = svs.filter(s => rotasSv(s).length && !rotasSv(s).every(r => evs.has(r))).sort(ordemNatural);
  const soNeutra = s => { const rs = rotasSv(s).filter(r => !ehVirtual(P, r));
    return rs.length > 0 && rs.every(r => neutras.has(r)); };
  const linha = s => soNeutra(s)
    ? {cod: s, neutraliza: true, rotas: rotasSv(s),
       rotulo: 'Neutraliza · ' + rotasSv(s).filter(r => !ehVirtual(P, r)).sort(ordemNatural).join(', ')}
    : {cod: s, rotas: rotasSv(s), rotulo: `${s} · ${primeiroNome((P.NOME_SUPERVISOR || {})[s])}`};
  return {rotasEscopo: svs.flatMap(rotasSv),
    unidades: [...uteis.filter(s => !soNeutra(s)), ...uteis.filter(soNeutra)].map(linha)};
}

/* soma de um indicador num conjunto de rotas, do jeito mais direto possível (null = nenhuma rota tem o indicador) */
function soma(P, nodo, k, rotas){
  const fech = !!P.FECHAMENTO, T = P.TOTAL_DIAS_UTEIS;
  let meta = 0, real = 0, tend = 0, mdia = null, n = 0;
  for(const r of rotas){
    const b = bloco(nodo, r, k);
    if(!b || b.unavailable) continue;
    n++; meta += b.meta || 0; real += b.real || 0;
    if(b.tendencia != null) tend += b.tendencia || 0;
    if(b.metaDia != null) mdia = (mdia || 0) + b.metaDia;
  }
  if(!n) return null;
  const vol = (P.GROUPS.VOLUME || []).includes(k) || Object.keys(P.VOLUME_EXTRA || {}).includes(k);
  const gap = Math.max(0, Math.ceil(meta * P.DIA_HOJE / T) - real);
  return {meta, real, n,
    tend: fech ? null : tend,
    pctTend: (!fech && meta) ? Math.round(tend / meta * 100) : null,
    // meta do dia: volume = soma das rotas; cobertura = a conta da caixa dos cards (gap, ou teto(Meta / dias úteis))
    mdia: fech ? null : vol ? mdia : (gap > 0 ? gap : (meta ? Math.ceil(meta / T) : 0))};
}
/* Pré-v. / R. M.A: índice pelo NOME do indicador na tabela de índice da própria chave. null na rota não soma;
   nenhuma rota com valor = null (célula vazia). */
function somaChave(P, chave, campo, k, rotas){
  const C = P[chave];
  if(!C || !C.ROTAS) return null;
  const tab = C[campo === 'v' ? 'IND_VOL' : 'IND_COB'];
  if(!Array.isArray(tab)) return null;
  const i = tab.indexOf(k);
  if(i < 0) return null;
  let s = 0, n = 0;
  for(const r of rotas){
    const x = (C.ROTAS[r] || {})[campo];
    const v = Array.isArray(x) ? x[i] : undefined;
    if(v == null) continue;
    s += v; n++;
  }
  return n ? s : null;
}

/* ---------- formato (as mesmas regras do Caderno, recriadas aqui) ---------- */
const arred = (n, c) => { const f = Math.pow(10, c), r = Math.round((n || 0) * f) / f; return r === 0 ? 0 : r; };
const br = (n, c) => n.toLocaleString('pt-BR', {minimumFractionDigits: c, maximumFractionDigits: c});
const num = (n, c) => br(arred(n, c), c);
const pctTxt = (cima, baixo, c) => !baixo ? '—' : num(cima / baixo * 100, c) + '%';

/* ---------- leitura da tela ----------
   Uma entrada por FOLHA A4 desenhada (o layout em cartões pode precisar de mais de uma folha por tipo). */
const LE_CAD = () => [...document.querySelectorAll('#cadFolhas .cadFolha')].map(f => ({
  tipo: f.dataset.folha,
  parte: Number(f.dataset.parte),
  titulo: f.querySelector('.cadTit').textContent,
  escopo: f.querySelector('.cadEsc').textContent,
  caixaTipo: f.querySelector('.cadTipo').textContent,
  pace: f.querySelector('.cadPace b').textContent,
  apoio: [...f.querySelectorAll('.cadApoio > span')].map(s => s.textContent),
  linhasGrade: Number(getComputedStyle(f).getPropertyValue('--cad-linhas')),
  pagina: (f.querySelector('.cadPg') || {}).textContent || '',
  notas: [...f.querySelectorAll('.cadNota')].map(n => n.textContent),
  colunas: [...f.querySelectorAll('.cadCart:first-child thead th')].map(t => t.textContent),
  cartoes: [...f.querySelectorAll('.cadCart')].map(c => ({
    k: c.dataset.k,
    rotulo: c.querySelector('.cadNome').textContent,
    selo: (c.querySelector('.cadSelo') || {}).textContent || '',
    tag: (c.querySelector('.cadCartTit .cadTag') || {}).textContent || '',
    situacao: (() => { const s = c.querySelector('.cadSit');
      return !s ? '' : s.classList.contains('cadAtras') ? 'atras' : 'ritmo'; })(),
    pct: c.querySelector('.cadCartPct').textContent,
    linhas: [...c.querySelectorAll('tbody tr')].map(tr => ({
      cod: tr.querySelector('th').textContent,
      tot: tr.classList.contains('tot'),
      neutraliza: tr.classList.contains('neu'),
      semMeta: !!tr.querySelector('td.cadSemMeta'),
      atras: !!tr.querySelector('td.pct.atras'),
      cels: [...tr.querySelectorAll('td')].map(td => ({txt: td.textContent, cls: td.className})),
    })),
  })),
}));

/* Geometria da folha, só no navegador: nada cortado e nada transbordando. */
const LE_GEO = () => [...document.querySelectorAll('#cadFolhas .cadFolha')].map(f => {
  const rf = f.getBoundingClientRect(), rod = f.querySelector('.cadRod').getBoundingClientRect();
  const carts = [...f.querySelectorAll('.cadCart')];
  const cortes = [], alturas = [];
  let estoura = 0, fundo = 0, menorFonte = 99;
  for(const c of carts){
    const rc = c.getBoundingClientRect();
    alturas.push(Math.round(rc.height * 10) / 10);
    fundo = Math.max(fundo, rc.bottom);
    if(c.scrollHeight > c.clientHeight + 0.5) estoura++;
    for(const el of c.querySelectorAll('*'))
      if(el.textContent) menorFonte = Math.min(menorFonte, parseFloat(getComputedStyle(el).fontSize));
    for(const cel of c.querySelectorAll('th, td'))
      if(cel.scrollWidth > cel.clientWidth + 0.5) cortes.push([c.dataset.k, cel.className, cel.textContent]);
  }
  return {tipo: f.dataset.folha, parte: Number(f.dataset.parte), cartoes: carts.length, estoura, cortes, menorFonte,
    alturas: [...new Set(alturas)], larg: Math.round(rf.width),
    sobreRodape: fundo > rod.top + 0.5, transborda: fundo > rf.bottom + 0.5,
    rodapeDentro: rod.bottom <= rf.bottom + 0.5};
});

/* ---------- conferência de um escopo ---------- */
/* Devolve uma linha de resumo (só contagens e códigos) e falha em qualquer divergência. */
async function confereCaderno(page, P, escopo, onde){
  const folhas = await page.evaluate(LE_CAD);
  const geo = await page.evaluate(LE_GEO);
  assert.ok(folhas.length >= 2, `${onde}: pelo menos a folha de Volume e a de Cobertura (${folhas.length})`);

  const nodo = indices(P);
  const {unidades, rotasEscopo} = escopoDe(P, escopo);
  const dentro = new Set(unidades.flatMap(u => u.rotas));
  const fora = rotasEscopo.filter(r => !dentro.has(r));
  const foraEv = fora.filter(r => (P.EVENTUAIS_ROTAS || []).includes(r));
  const foraVirt = fora.filter(r => !(P.EVENTUAIS_ROTAS || []).includes(r) && ehVirtual(P, r));
  const res = {onde, unidades: unidades.length, fora: fora.length, folhas: folhas.length, cartoes: 0, celulas: 0,
    notas: 0, trapDif: 0, trapPct: 0, trapRitmo: 0, vazias: 0, atras: 0,
    grade: folhas.map(f => f.linhasGrade).join('/')};

  // as folhas de cada tipo, na ordem: primeiro todas as de Volume, depois todas as de Cobertura
  const tipos = [...new Set(folhas.map(f => f.tipo))];
  assert.deepEqual(tipos, ['vol', 'cob'], `${onde}: Volume e depois Cobertura`);
  assert.deepEqual(folhas.map(f => f.tipo), [...folhas].sort((a, b) =>
    (a.tipo === 'cob') - (b.tipo === 'cob')).map(f => f.tipo), `${onde}: as folhas de um tipo ficam juntas`);

  for(const tipo of tipos){
    const minhas = folhas.filter(f => f.tipo === tipo);
    const vol = tipo === 'vol', casas = vol ? 1 : 0, campo = vol ? 'v' : 'c';
    const ks = itensFolha(P, tipo, rotasEscopo, nodo);
    // (quebra) a 1ª folha é preenchida até o limite e só o que passa vai para a seguinte
    const porFolha = minhas[0].linhasGrade * 2;
    assert.deepEqual(minhas.map(f => f.parte), minhas.map((f, i) => i + 1), `${onde}/${tipo}: as partes em ordem`);
    assert.equal(minhas.length, Math.max(1, Math.ceil(ks.length / porFolha)),
      `${onde}/${tipo}: ${ks.length} cartões em folhas de ${porFolha}`);
    minhas.forEach((f, i) => {
      const esperados = ks.slice(i * porFolha, (i + 1) * porFolha).length;
      assert.equal(f.cartoes.length, esperados, `${onde}/${tipo}: cartões da folha ${i + 1}`);
      assert.equal(f.pagina.split(' ')[1].split(' ')[0], `${i + 1}/${minhas.length}`,
        `${onde}/${tipo}: "${f.pagina}" na folha ${i + 1}`);
      assert.ok(f.pagina.startsWith(escopo.nivel === 'gc' ? 'GC ' : 'SV '), `${onde}/${tipo}: sigla "${f.pagina}"`);
    });
    const cartoes = minhas.flatMap(f => f.cartoes);
    assert.deepEqual(cartoes.map(c => c.k), ks, `${onde}/${tipo}: um cartão por indicador, na ordem`);
    res.cartoes += cartoes.length;
    // (i) tags de segmento: só os dois itens da tabela
    for(const c of cartoes) assert.equal(c.tag, TAGS[c.k] || '', `${onde}/${tipo}/${c.k}: tag de segmento`);
    // a nota do resíduo sai só na ÚLTIMA folha daquele tipo
    minhas.slice(0, -1).forEach((f, i) => assert.deepEqual(f.notas, [],
      `${onde}/${tipo}: a nota do resíduo só na última folha (folha ${i + 1})`));
    const notas = minhas[minhas.length - 1].notas;
    res.notas += notas.length;

    cartoes.forEach((c, i) => {
      const k = ks[i];
      // (a)/(f)/(g): o TOTAL é a PRIMEIRA linha e as unidades vêm depois, na ordem, com os rótulos da R-BO-07
      assert.deepEqual(c.linhas.map(l => l.cod), ['TOTAL', ...unidades.map(u => u.rotulo)],
        `${onde}/${tipo}/${k}: TOTAL primeiro e as unidades na ordem`);
      assert.equal(c.linhas[0].tot, true, `${onde}/${tipo}/${k}: a 1ª linha é a do TOTAL`);
      assert.deepEqual(c.linhas.slice(1).map(l => l.neutraliza), unidades.map(u => !!u.neutraliza),
        `${onde}/${tipo}/${k}: a linha Neutraliza`);

      const confere = (l, rotas, quem) => {
        const s = soma(P, nodo, k, rotas);
        const ma = somaChave(P, 'MES_ANT_CHEIO', campo, k, rotas), pv = somaChave(P, 'PRE_VENDA', campo, k, rotas);
        const c2 = l.cels;
        // (d) Pré-v. e R. M.A: soma pelo índice do nome, mesmo na linha sem o indicador
        if(l.semMeta){
          // sem o indicador: R. M.A | "sem meta" (cinco colunas) | Pré-v. | Dia vazia
          assert.equal(s, null, `${onde}/${tipo}/${k}/${quem}: "sem meta" só sem o indicador`);
          assert.equal(c2.length, 4, `${onde}/${tipo}/${k}/${quem}: 4 células na linha sem meta`);
          assert.equal(c2[0].txt, ma == null ? '' : num(ma, casas), `${onde}/${tipo}/${k}/${quem}: R. M.A`);
          assert.equal(c2[2].txt, pv == null ? '' : num(pv, casas), `${onde}/${tipo}/${k}/${quem}: Pré-v.`);
          assert.equal(c2[3].txt, '', `${onde}/${tipo}/${k}/${quem}: Dia vazia`);
          res.vazias++; res.celulas += 4;
          return s;
        }
        assert.ok(s, `${onde}/${tipo}/${k}/${quem}: linha com números sem o indicador no payload`);
        assert.equal(c2.length, 8, `${onde}/${tipo}/${k}/${quem}: 8 colunas de número`);
        res.celulas += 8;
        assert.equal(c2[0].txt, ma == null ? '' : num(ma, casas), `${onde}/${tipo}/${k}/${quem}: R. M.A`);
        assert.equal(c2[6].txt, pv == null ? '' : num(pv, casas), `${onde}/${tipo}/${k}/${quem}: Pré-v.`);
        assert.equal(c2[1].txt, num(s.meta, casas), `${onde}/${tipo}/${k}/${quem}: Meta`);
        assert.equal(c2[2].txt, num(s.real, casas), `${onde}/${tipo}/${k}/${quem}: Real`);
        // (c) Dif e %: dos valores CRUS, arredondados só no fim
        const dif = arred(s.real - s.meta, casas);
        assert.equal(c2[3].txt, br(dif, casas), `${onde}/${tipo}/${k}/${quem}: Dif`);
        assert.equal(/\bneg\b/.test(c2[3].cls), dif < 0, `${onde}/${tipo}/${k}/${quem}: classe neg`);
        assert.equal(c2[4].txt, pctTxt(s.real, s.meta, 1), `${onde}/${tipo}/${k}/${quem}: %`);
        // quantas células a conta ERRADA mudaria (prova de que a ordem do arredondamento importa)
        if(Math.abs(dif - (arred(s.real, casas) - arred(s.meta, casas))) > 1e-9) res.trapDif++;
        if(s.meta && pctTxt(s.real, s.meta, 1) !== pctTxt(arred(s.real, casas), arred(s.meta, casas), 1)) res.trapPct++;
        // (h) ATRÁS pelos valores CRUS: Tend. % no volume, Ritmo na cobertura
        const ritmoCru = (!s.meta || !P.PACE_ONTEM_PCT) ? null : s.real / s.meta / (P.PACE_ONTEM_PCT / 100) * 100;
        const atras = P.FECHAMENTO || !s.meta ? null
          : vol ? (s.tend == null ? null : s.tend / s.meta * 100 < 100)
          : (ritmoCru == null ? null : ritmoCru < 100);
        assert.equal(l.atras, atras === true, `${onde}/${tipo}/${k}/${quem}: % em fundo preto`);
        if(l.atras) res.atras++;
        if(vol){
          assert.equal(c2[5].txt, P.FECHAMENTO || s.pctTend == null ? '—' : s.pctTend + '%',
            `${onde}/${tipo}/${k}/${quem}: Tend. %`);
        } else {
          // (e) Ritmo dos valores crus, nunca do % já arredondado
          const esperado = P.FECHAMENTO || ritmoCru == null ? '—' : num(ritmoCru, 0) + '%';
          assert.equal(c2[5].txt, esperado, `${onde}/${tipo}/${k}/${quem}: Ritmo`);
          if(s.meta && P.PACE_ONTEM_PCT && !P.FECHAMENTO &&
             esperado !== num(Math.round(s.real / s.meta * 100) / (P.PACE_ONTEM_PCT / 100), 0) + '%') res.trapRitmo++;
        }
        assert.equal(c2[7].txt, s.mdia == null ? '—' : num(s.mdia, casas), `${onde}/${tipo}/${k}/${quem}: Dia`);
        return {s, atras};
      };

      const tot = confere(c.linhas[0], rotasEscopo, 'TOTAL');
      unidades.forEach((u, j) => confere(c.linhas[j + 1], u.rotas, u.cod));
      // (h) a caixa de situação e o % em destaque do título = os do TOTAL
      const esperaSit = !tot || tot.atras == null ? '' : tot.atras ? 'atras' : 'ritmo';
      assert.equal(c.situacao, esperaSit, `${onde}/${tipo}/${k}: caixa de situação do cartão`);
      assert.equal(c.pct, tot && tot.s ? pctTxt(tot.s.real, tot.s.meta, 1) : '—',
        `${onde}/${tipo}/${k}: % do cartão`);

      // (b) Σ das linhas + as rotas de fora = TOTAL
      const soLinhas = unidades.map(u => soma(P, nodo, k, u.rotas)).filter(Boolean);
      const sFora = fora.length ? soma(P, nodo, k, fora) : null;
      if(tot && tot.s){
        const tol = vol ? 0.05 : 0;
        const sr = soLinhas.reduce((a, x) => a + x.real, 0) + (sFora ? sFora.real : 0);
        const sm = soLinhas.reduce((a, x) => a + x.meta, 0) + (sFora ? sFora.meta : 0);
        assert.ok(Math.abs(sr - tot.s.real) <= tol, `${onde}/${tipo}/${k}: Σ linhas + fora = TOTAL (Real)`);
        assert.ok(Math.abs(sm - tot.s.meta) <= tol, `${onde}/${tipo}/${k}: Σ linhas + fora = TOTAL (Meta)`);
      }
      // a nota do resíduo, com o valor certo (o mesmo texto da notaVirtuais do painel)
      const rotCurto = c.rotulo;
      const sv = foraVirt.length ? soma(P, nodo, k, foraVirt) : null;
      const se = foraEv.length ? soma(P, nodo, k, foraEv) : null;
      if(sv) assert.ok(notas.includes(`${rotCurto} · Inclui rotas virtuais: Meta ${num(sv.meta, casas)} · Real ${num(sv.real, casas)}`),
        `${onde}/${tipo}/${k}: nota das rotas virtuais`);
      if(se) assert.ok(notas.includes(`${rotCurto} · Inclui clientes de rotas eventuais (EV*): Real ${num(se.real, casas)}`),
        `${onde}/${tipo}/${k}: nota das rotas eventuais`);
    });
  }

  // (j) geometria: nada cortado, nada transbordando, o cartão com a mesma altura em todas as folhas do escopo
  const alturas = new Set();
  for(const g of geo){
    const q = `${onde}/${g.tipo} folha ${g.parte}`;
    assert.deepEqual(g.cortes, [], `${q}: texto cortado`);
    assert.equal(g.estoura, 0, `${q}: cartão com conteúdo maior que a caixa`);
    assert.equal(g.sobreRodape, false, `${q}: cartão sobre o rodapé`);
    assert.equal(g.transborda, false, `${q}: cartão fora da folha`);
    assert.equal(g.rodapeDentro, true, `${q}: rodapé fora da folha`);
    assert.equal(g.larg, 794, `${q}: a folha é uma A4 (794 px)`);
    // R-BO-07: nenhuma letra do cartão desce abaixo de 5,5 px (o cartão não encolhe: quem cede é a grade)
    assert.ok(g.cartoes === 0 || g.menorFonte >= 5.5, `${q}: letra de ${g.menorFonte} px (mínimo 5,5)`);
    assert.equal(g.alturas.length <= 1, true, `${q}: cartões de alturas diferentes (${g.alturas.join(', ')})`);
    for(const a of g.alturas) alturas.add(a);
  }
  assert.ok(alturas.size <= 1, `${onde}: o cartão muda de altura entre as folhas (${[...alturas].join(', ')})`);
  res.altCartao = [...alturas][0] || 0;
  return res;
}

module.exports = {confereCaderno, LE_CAD, LE_GEO, escopoDe, soma, somaChave, itensFolha, indices, num, br, arred,
  pctTxt, ordemNatural, ehVirtual, primeiroNome, TAGS};
