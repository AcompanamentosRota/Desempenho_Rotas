/* Invariantes do Caderno de Vendas (Frente 2, PR 2), usadas pela Parte AR do front.test.js e pela conferência com
   DADO REAL (conferencia_real.test.js).

   A recontagem aqui é INDEPENDENTE: lê o payload.json como objeto, soma na mão e NÃO usa nenhuma função do front
   (nem montaCaderno, nem agrega, nem NUCLEO). É isso que dá valor à conferência.

   (a) TOTAL = a agregação de TODAS as rotas do escopo (com Neutraliza, virtuais e a oculta das EV*), ao formato da
       coluna — o mesmo número do card do painel.
   (b) Σ das linhas + a parcela das rotas que não viraram linha = TOTAL (tolerância 0,05 no volume e 0 na cobertura);
       onde houver resíduo, a nota está no rodapé da folha com o valor certo.
   (c) Dif e % recalculados dos valores CRUS batem com a tela, célula a célula (R-QLD-15). Conta também em quantas
       células a conta ERRADA (arredondar antes de subtrair/dividir) daria outro número.
   (d) Pré-Venda e Real M.A somados do payload pelo ÍNDICE DO NOME do indicador batem com a tela; rota com null não
       entrou como 0 e linha toda null ficou vazia.
   (e) Ritmo recalculado dos valores crus bate com a coluna (nunca o % já arredondado). Conta também em quantas
       células a conta errada daria outro número.
   (g) Neutraliza: a supervisão só de rotas Neutraliza aparece com o código real dela e com os números das rotas dela.

   Nada daqui imprime nome ou código de cliente: só totais e códigos de gerência, supervisão e rota. */
'use strict';

const assert = require('node:assert/strict');

const FORA_COB = ['IMPERDOAVEIS', 'VENDAZERO'];

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

/* unidades e rotas do escopo, pela regra do item 8: no nível Gerência, todas as supervisões do payload (inclusive a
   só de Neutraliza e a oculta SV.G3.3), menos a das rotas ocultas das EV*; no nível Supervisão, as rotas dela sem as
   virtuais. A ORDEM das rotas dentro de cada conjunto é a do payload: a soma de float tem de ser a mesma do front. */
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
function escopoDe(P, escopo){
  const D = P.DATA || {}, gc = escopo.gc, evs = new Set(P.EVENTUAIS_ROTAS || []);
  const svs = Object.keys(D[gc] || {});
  const rotasSv = s => Object.keys((D[gc] || {})[s] || {});
  if(escopo.nivel === 'sv'){
    const rotas = rotasSv(escopo.sv);
    return {unidades: rotas.filter(r => !ehVirtual(P, r)).sort(ordemNatural).map(r => ({cod: r, rotas: [r]})),
      rotasEscopo: rotas};
  }
  const uteis = svs.filter(s => rotasSv(s).length && !rotasSv(s).every(r => evs.has(r))).sort(ordemNatural);
  return {unidades: uteis.map(s => ({cod: s, rotas: rotasSv(s)})), rotasEscopo: svs.flatMap(rotasSv)};
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
/* Pré-Venda / Real M.A: índice pelo NOME do indicador na tabela de índice da própria chave. null na rota não soma;
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

/* ---------- formato (as mesmas regras do item 11, recriadas aqui) ---------- */
const arred = (n, c) => { const f = Math.pow(10, c), r = Math.round((n || 0) * f) / f; return r === 0 ? 0 : r; };
const br = (n, c) => n.toLocaleString('pt-BR', {minimumFractionDigits: c, maximumFractionDigits: c});
const num = (n, c) => br(arred(n, c), c);
const pctTxt = (cima, baixo, c) => !baixo ? '—' : num(cima / baixo * 100, c) + '%';

/* ---------- leitura da tela ---------- */
const LE_CAD = () => [...document.querySelectorAll('#cadFolhas .cadFolha')].map(f => ({
  tipo: f.dataset.folha,
  titulo: f.querySelector('.cadTit').textContent,
  escopo: f.querySelector('.cadEsc').textContent,
  apoio: [...f.querySelectorAll('.cadApoio > span')].map(s => s.textContent),
  colunas: [...f.querySelectorAll('thead th')].map((t, i) => ({rot: t.textContent,
    larg: f.querySelectorAll('col')[i].style.width, novo: t.classList.contains('novo')})),
  notas: [...f.querySelectorAll('.cadRod div')].map(d => d.textContent),
  blocos: (() => {
    const out = [];
    let atual = null;
    for(const tr of f.querySelectorAll('tbody tr')){
      const prod = tr.querySelector('td.prod');
      if(prod){
        atual = {rotulo: prod.childNodes[0].textContent, selo: (prod.querySelector('.selo') || {}).textContent || '',
          seg: tr.querySelector('td.seg').textContent, rowspan: Number(prod.getAttribute('rowspan')), linhas: [], total: null};
        out.push(atual);
      }
      if(!atual) continue;
      const cels = [...tr.querySelectorAll('td')].filter(td => !td.classList.contains('seg') &&
        !td.classList.contains('prod') && !td.classList.contains('un'))
        .map(td => ({txt: td.textContent, neg: td.classList.contains('neg'), novo: td.classList.contains('novo')}));
      const l = {cod: tr.querySelector('td.un').textContent, cels};
      if(tr.classList.contains('tot')) atual.total = l; else atual.linhas.push(l);
    }
    return out;
  })(),
}));

/* ---------- conferência de um escopo ---------- */
/* Devolve uma linha de resumo (só contagens e códigos) e falha em qualquer divergência. */
async function confereCaderno(page, P, escopo, onde){
  const folhas = await page.evaluate(LE_CAD);
  assert.equal(folhas.length, 2, `${onde}: duas folhas`);
  assert.deepEqual(folhas.map(f => f.tipo), ['vol', 'cob'], `${onde}: Volume e depois Cobertura`);

  const nodo = indices(P);
  const {unidades, rotasEscopo} = escopoDe(P, escopo);
  const dentro = new Set(unidades.flatMap(u => u.rotas));
  const fora = rotasEscopo.filter(r => !dentro.has(r));
  const foraEv = fora.filter(r => (P.EVENTUAIS_ROTAS || []).includes(r));
  const foraVirt = fora.filter(r => !(P.EVENTUAIS_ROTAS || []).includes(r) && ehVirtual(P, r));
  const res = {onde, unidades: unidades.length, fora: fora.length, blocos: 0, celulas: 0, notas: 0,
    trapDif: 0, trapPct: 0, trapRitmo: 0, vazias: 0};

  for(const f of folhas){
    const vol = f.tipo === 'vol', casas = vol ? 1 : 0, campo = vol ? 'v' : 'c';
    const ks = itensFolha(P, f.tipo, rotasEscopo, nodo);
    assert.deepEqual(f.blocos.length, ks.length, `${onde}/${f.tipo}: um bloco por indicador`);
    res.blocos += f.blocos.length;
    f.blocos.forEach((b, i) => {
      const k = ks[i];
      // (a)/(b): as linhas são as unidades, na ordem, e o TOTAL é a última linha do bloco
      assert.deepEqual(b.linhas.map(l => l.cod), unidades.map(u => u.cod), `${onde}/${f.tipo}/${k}: unidades`);
      assert.equal(b.total.cod, 'TOTAL', `${onde}/${f.tipo}/${k}: linha TOTAL`);
      assert.equal(b.seg, 'TODOS', `${onde}/${f.tipo}/${k}: coluna Seg`);
      assert.equal(b.rowspan, unidades.length + 1, `${onde}/${f.tipo}/${k}: rowspan`);

      const confere = (l, rotas, quem) => {
        const s = soma(P, nodo, k, rotas);
        const ma = somaChave(P, 'MES_ANT_CHEIO', campo, k, rotas), pv = somaChave(P, 'PRE_VENDA', campo, k, rotas);
        const c = l.cels;
        assert.equal(c.length, 9, `${onde}/${f.tipo}/${k}/${quem}: 9 colunas de número`);
        res.celulas += 9;
        // (d) Pré-Venda e Real M.A: soma pelo índice do nome; nenhuma rota com valor = célula vazia
        assert.equal(c[0].txt, ma == null ? '' : num(ma, casas), `${onde}/${f.tipo}/${k}/${quem}: Real M.A`);
        assert.equal(c[6].txt, pv == null ? '' : num(pv, casas), `${onde}/${f.tipo}/${k}/${quem}: Pré-Venda`);
        assert.ok(c[0].novo && c[6].novo, `${onde}/${f.tipo}/${k}/${quem}: colunas novas marcadas`);
        // Plan. Dia sempre vazia, inclusive no TOTAL
        assert.equal(c[8].txt, '', `${onde}/${f.tipo}/${k}/${quem}: Plan. Dia vazia`);
        if(!s){ // indicador indisponível nessas rotas: só Real M.A e Pré-Venda podem ter texto
          for(const i of [1, 2, 3, 4, 5, 7]) assert.equal(c[i].txt, '', `${onde}/${f.tipo}/${k}/${quem}: célula ${i}`);
          res.vazias++;
          return s;
        }
        assert.equal(c[1].txt, num(s.meta, casas), `${onde}/${f.tipo}/${k}/${quem}: Meta`);
        assert.equal(c[2].txt, num(s.real, casas), `${onde}/${f.tipo}/${k}/${quem}: Real`);
        // (c) Dif e %: dos valores CRUS, arredondados só no fim
        const dif = arred(s.real - s.meta, casas);
        assert.equal(c[3].txt, br(dif, casas), `${onde}/${f.tipo}/${k}/${quem}: Dif`);
        assert.equal(c[3].neg, dif < 0, `${onde}/${f.tipo}/${k}/${quem}: classe neg`);
        assert.equal(c[4].txt, pctTxt(s.real, s.meta, 1), `${onde}/${f.tipo}/${k}/${quem}: %`);
        // quantas células a conta ERRADA mudaria (prova de que a ordem do arredondamento importa)
        if(Math.abs(dif - (arred(s.real, casas) - arred(s.meta, casas))) > 1e-9) res.trapDif++;
        if(s.meta && pctTxt(s.real, s.meta, 1) !== pctTxt(arred(s.real, casas), arred(s.meta, casas), 1)) res.trapPct++;
        if(vol){
          assert.equal(c[5].txt, P.FECHAMENTO || s.pctTend == null ? '—' : s.pctTend + '%',
            `${onde}/${f.tipo}/${k}/${quem}: Tend. %`);
        } else {
          // (e) Ritmo dos valores crus, nunca do % já arredondado
          const esperado = P.FECHAMENTO || !s.meta || !P.PACE_ONTEM_PCT ? '—'
            : num(s.real / s.meta / (P.PACE_ONTEM_PCT / 100) * 100, 0) + '%';
          assert.equal(c[5].txt, esperado, `${onde}/${f.tipo}/${k}/${quem}: Ritmo`);
          if(s.meta && P.PACE_ONTEM_PCT && !P.FECHAMENTO &&
             esperado !== num(Math.round(s.real / s.meta * 100) / (P.PACE_ONTEM_PCT / 100), 0) + '%') res.trapRitmo++;
        }
        assert.equal(c[7].txt, s.mdia == null ? '—' : num(s.mdia, casas), `${onde}/${f.tipo}/${k}/${quem}: Meta Dia`);
        return s;
      };

      unidades.forEach((u, j) => confere(b.linhas[j], u.rotas, u.cod));
      const tot = confere(b.total, rotasEscopo, 'TOTAL');

      // (b) Σ das linhas + as rotas de fora = TOTAL
      const soLinhas = unidades.map(u => soma(P, nodo, k, u.rotas)).filter(Boolean);
      const sFora = fora.length ? soma(P, nodo, k, fora) : null;
      if(tot){
        const tol = vol ? 0.05 : 0;
        const sr = soLinhas.reduce((a, x) => a + x.real, 0) + (sFora ? sFora.real : 0);
        const sm = soLinhas.reduce((a, x) => a + x.meta, 0) + (sFora ? sFora.meta : 0);
        assert.ok(Math.abs(sr - tot.real) <= tol, `${onde}/${f.tipo}/${k}: Σ linhas + fora = TOTAL (Real)`);
        assert.ok(Math.abs(sm - tot.meta) <= tol, `${onde}/${f.tipo}/${k}: Σ linhas + fora = TOTAL (Meta)`);
      }
      // a nota do resíduo, com o valor certo (o mesmo texto da notaVirtuais do painel)
      const sv = foraVirt.length ? soma(P, nodo, k, foraVirt) : null;
      const se = foraEv.length ? soma(P, nodo, k, foraEv) : null;
      if(sv) assert.ok(f.notas.includes(`${b.rotulo} · Inclui rotas virtuais: Meta ${num(sv.meta, casas)} · Real ${num(sv.real, casas)}`),
        `${onde}/${f.tipo}/${k}: nota das rotas virtuais`);
      if(se) assert.ok(f.notas.includes(`${b.rotulo} · Inclui clientes de rotas eventuais (EV*): Real ${num(se.real, casas)}`),
        `${onde}/${f.tipo}/${k}: nota das rotas eventuais`);
    });
    // nenhuma nota sobrando
    res.notas += f.notas.length;
  }
  return res;
}

module.exports = {confereCaderno, LE_CAD, escopoDe, soma, somaChave, itensFolha, indices, num, br, arred, pctTxt,
  ordemNatural, ehVirtual};
