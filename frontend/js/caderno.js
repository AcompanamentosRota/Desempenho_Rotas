/* =====================================================================
   CADERNO DE VENDAS (tela) — Frente 2, PR 2 de 4. Aba nova DENTRO da página do Back Office (backoffice.js), ao lado
   da tabela da R-BO-03, que não é tocada.

   Relatório MATINAL, como o Painel de Ritmo (R-BO-06, R-RIT-01): SÓ dados do payload.json. Nada do online.json
   (ONLINE, puxaOnline) nem dos campos do payload que dependem da venda de hoje (REVERTIDO_HOJE, OPORTUNIDADE_HOJE,
   SEM_COMPRA_HOJE, revertidoHoje, oportunidadeHoje, semDadoHoje), nada de Date/relógio: a data vem do próprio payload.

   NENHUM NÚMERO NOVO: Meta, Real, Dif, %, Tendência e Meta do dia saem de NUCLEO.agrega (o mesmo dos cards) e de
   NUCLEO.metaDiaCobertura; "Real M.A" e "Pré-Venda" saem das chaves MES_ANT_CHEIO e PRE_VENDA do payload, somadas
   pelo ÍNDICE DO NOME do indicador (IND_VOL / IND_COB são tabelas de índice que só crescem no fim).

   - montaCaderno(P, escopo): FUNÇÃO PURA (sem DOM, sem ONLINE, sem relógio) -> as duas folhas (Volume e Cobertura).
     escopo = {nivel:'gc', gc} (gerência aberta por supervisão) | {nivel:'sv', gc, sv} (supervisão aberta por rota).
   - CAD: a tela (seletores próprios, desenho das folhas). O PDF é o PR 3; aqui a tela só fica pronta para ele.

   Duas divergências de propósito em relação ao painel (decisões da Karen, 23/11/2026; ver CLAUDE.md):
   - a supervisão só de rotas Neutraliza entra como supervisão NORMAL, com o código real dela (no painel é a linha
     "Neutraliza", R-NEU-10), e a SV.G3.3 (oculta no painel, R-ESC-14) também entra;
   - fora das linhas fica só a supervisão das rotas ocultas das EV*, que continua DENTRO do TOTAL (R-ESC-11/12), por
     isso a soma das linhas pode ficar abaixo do TOTAL — o resíduo vai no rodapé da folha, com o texto da notaVirtuais.
   ===================================================================== */

/* ---------- parte pura ---------- */

// rótulo curto e selo (grupo de acompanhamento) de cada indicador do Caderno: tabela de constantes, num lugar só
const CAD_ROTULOS = {
  'VOL REFRIGERANTES':         ['REFRI', 'Volume'],
  'VOL CERVEJAS':              ['CERV', 'Volume'],
  'VOL STILL':                 ['STILL', 'Volume'],
  'VOL AGUA MINERAL':          ['AGUA', 'Volume'],
  'VOL DEST+ART+CND':          ['NOVOS NEGÓCIOS', 'Volume · Dest+Art+Cnd'],
  'VOL DEL VALLE FRUT':        ['DV FRUT', 'Volume · só G2'],
  'CCTM 2L PET':               ['CCTM 2L PET', 'ICS GC'],
  'KS TT':                     ['KS TT', 'ICS GC'],
  'REFRI SABORES ZERO':        ['REF. SAB ZERO', 'ICS GC'],
  'CERVEJAS 600ML RETORNAVEL': ['CERV 600', 'ICS GC · Todos a Bordo'],
  'CERVEJAS':                  ['CERV', 'ICS GC · Todos a Bordo'],
  'EISENBAHN':                 ['EISENBAHN', 'ICS GC'],
  'KAPO':                      ['KAPO', 'ICS GC'],
  'POWERADE':                  ['POWERADE', 'ICS GC'],
  'ARTD KO':                   ['ARTD KO', 'ICS GC · Novos Neg.'],
  'CAMPARI':                   ['CAMPARI', 'Novos Negócios'],
  'DREHER':                    ['DREHER', 'Novos Negócios'],
  'PERFETTI TT':               ['PERFETTI TT', 'Novos Negócios'],
  'APEROL':                    ['APEROL', 'Novos Negócios'],
  'INC HEINEKEN':              ['HEINEKEN', 'Todos a Bordo'],
  'INC EISENBAHN 600ML':       ['EISENBAHN 600', 'Todos a Bordo'],
  'INC HEINEKEN 600ML':        ['HEINEKEN 600', 'Todos a Bordo'],
};
// itens de cobertura que NÃO entram no Caderno (R-ESC-08, R-BO-06): Imperdoáveis e Venda Zero
const CAD_FORA_COB = ['IMPERDOAVEIS', 'VENDAZERO'];
/* colunas, na ordem e com as larguras do mockup aprovado em 19/11/2026 (px; a tabela é table-layout:fixed com
   width:100%, então estas larguras são a proporção entre as colunas). `novo` = as duas colunas novas desta frente
   (Real M.A e Pré-Venda), destacadas.
   As três primeiras ficam com o nome do mockup (seg, prod, un, todas no escopo .cadTab); as de número levam o prefixo
   cad — "ritmo" solto pegaria a .ritmo do painel (a caixa preta do dia, app.css), e o mesmo vale para "meta"/"pct". */
const CAD_COLS_VOL = [
  ['seg', 'Seg', 20], ['prod', 'Grupo Produto', 82], ['un', 'Unid.', 50],
  ['cadMa', 'Real M.A', 60, true], ['cadMeta', 'Meta', 64], ['cadReal', 'Real', 64], ['cadDif', 'Real x Meta', 66],
  ['cadPct', '%', 44], ['cadTend', 'Tend. %', 42], ['cadPv', 'Pré-Venda', 58, true],
  ['cadMdia', 'Meta Dia', 56], ['cadPlan', 'Plan. Dia', 58],
];
const CAD_COLS_COB = [
  ['seg', 'Seg', 20], ['prod', 'Grupo Produto', 94], ['un', 'Unid.', 50],
  ['cadMa', 'Real M.A', 58, true], ['cadMeta', 'Meta', 56], ['cadReal', 'Real', 56], ['cadDif', 'Dif', 58],
  ['cadPct', '%', 44], ['cadRitmo', 'Ritmo', 48], ['cadPv', 'Pré-Venda', 58, true],
  ['cadMdia', 'Meta Dia', 56], ['cadPlan', 'Plan. Dia', 58],
];
const CAD_MESES = ['JANEIRO', 'FEVEREIRO', 'MARCO', 'ABRIL', 'MAIO', 'JUNHO', 'JULHO', 'AGOSTO', 'SETEMBRO',
                   'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO'];
// 'AAAA-MM-DD' -> 'dd/mm/aa' (vazio sem a data ou fora do formato)
const cadDataBR = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? `${m[3]}/${m[2]}/${m[1].slice(2)}` : ''; };
const cadSemAcento = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '');

/* MES_LABEL ('Novembro/26') -> 'AAAAMM' do exercício. Vem do PAYLOAD, nunca do relógio; sem conseguir ler o rótulo,
   a data do último dia útil fechado (DATA_ONTEM) serve de reserva. */
function cadExercicio(P){
  const m = /^\s*([^/\s]+)\s*\/\s*(\d{2,4})\s*$/.exec((P && P.MES_LABEL) || '');
  if(m){
    const i = CAD_MESES.indexOf(cadSemAcento(m[1]).toUpperCase());
    if(i >= 0){ const a = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2]);
      return `${a}${String(i + 1).padStart(2, '0')}`; }
  }
  const d = /^(\d{4})-(\d{2})-\d{2}$/.exec((P && P.DATA_ONTEM) || '');
  return d ? d[1] + d[2] : '';
}

function montaCaderno(P, escopo){
  const N = NUCLEO, D = (P && P.DATA) || {}, e = escopo || {};
  const gc = e.gc || '', nivel = e.nivel === 'sv' ? 'sv' : 'gc', sv = e.sv || '';
  const T = P.TOTAL_DIAS_UTEIS, fech = !!P.FECHAMENTO;
  // índice rota -> nó (como o montaRitmo): tudo o que o Caderno lê do payload passa por aqui
  const idx = {};
  for(const g in D) for(const s in D[g]) for(const r in D[g][s]) idx[r] = D[g][s][r];
  const nodo = r => idx[r];

  /* ---- números ----
     Volume com UMA casa decimal e cobertura INTEIRA (decisão da Karen, 23/11/2026). TODA conta é feita com os valores
     CRUS e só o resultado é arredondado (R-QLD-15): a Dif é arredonda(real - meta), nunca arredonda(real) -
     arredonda(meta), que erra em 1. Math.round (.5 sobe), como o resto do painel. */
  const br = (n, casas) => n.toLocaleString('pt-BR', {minimumFractionDigits: casas, maximumFractionDigits: casas});
  const arred = (n, casas) => { const f = Math.pow(10, casas), r = Math.round((n || 0) * f) / f; return r === 0 ? 0 : r; };
  const num = (n, casas) => br(arred(n, casas), casas);
  // % com uma casa; Tend. % e Ritmo inteiros. Meta 0 ou ausente = "—" (nunca uma divisão por zero disfarçada)
  const pct = (cima, baixo, casas) => !baixo ? '—' : num(cima / baixo * 100, casas) + '%';

  /* ---- unidades (item 8 do pedido) ----
     Gerência aberta por supervisão: TODAS as supervisões da gerência presentes no payload, em ordem natural, com o
     código real — inclusive a que só tem rotas Neutraliza e a oculta do painel (SV.G3.3). Fora fica só a supervisão
     das rotas ocultas das EV* (todas as rotas dela são eventuais), que não é uma supervisão de verdade e continua
     dentro do TOTAL. Supervisão aberta por rota: as rotas dela em ordem natural, sem as virtuais. */
  const evs = new Set(P.EVENTUAIS_ROTAS || []);
  const svsGc = () => Object.keys(D[gc] || {});
  const rotasSv = s => Object.keys((D[gc] || {})[s] || {});
  const svEventual = s => { const rs = rotasSv(s); return rs.length > 0 && rs.every(r => evs.has(r)); };
  const unidades = nivel === 'gc'
    ? svsGc().filter(s => rotasSv(s).length && !svEventual(s)).sort(N.ordemNatural)
        .map(s => ({cod: s, rotas: rotasSv(s)}))
    : rotasSv(sv).filter(r => !N.ehVirtual(P, r)).sort(N.ordemNatural).map(r => ({cod: r, rotas: [r]}));
  const rotasEscopo = nivel === 'gc' ? svsGc().flatMap(rotasSv) : rotasSv(sv);
  // rotas do escopo que não viraram linha: a oculta das EV* (nível Gerência) ou as virtuais (nível Supervisão)
  const dentro = new Set(unidades.flatMap(u => u.rotas));
  const fora = rotasEscopo.filter(r => !dentro.has(r));
  const foraEv = fora.filter(r => evs.has(r));
  const foraVirt = fora.filter(r => !evs.has(r) && N.ehVirtual(P, r));

  /* Agregação de um conjunto de rotas: o mesmo agrega dos cards, UMA vez por conjunto (ele já devolve todos os
     indicadores de uma vez, e os conjuntos são sempre os mesmos — as linhas, o escopo e as rotas de fora). */
  const _ind = new Map();
  const indDe = rs => { let v = _ind.get(rs); if(!v){ v = N.agrega(P, rs, nodo).ind; _ind.set(rs, v); } return v; };
  const indEscopo = indDe(rotasEscopo);

  /* ---- chaves novas do payload (Real M.A e Pré-Venda) ----
     O índice vem do NOME do indicador na tabela de índice da própria chave (IND_VOL / IND_COB), nunca de uma posição
     fixa: são tabelas que só crescem no fim. Indicador fora da tabela, chave ausente (payload antigo, fechamento sem
     DATA_ONTEM, consulta que falhou) ou todas as rotas com null = célula vazia, sem erro. `null` numa rota é "a rota
     não tem o indicador": não soma e não vira 0. */
  function somaChave(chave, campo, k, rotas){
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

  /* ---- células de uma linha ----
     `b` = o bloco de NUCLEO.agrega do indicador nas rotas da linha. Indicador indisponível em todas elas = linha com
     as células de número vazias (não é erro: a unidade não tem esse indicador). */
  function celulas(tipo, k, rotas){
    const vol = tipo === 'vol', casas = vol ? 1 : 0, campo = vol ? 'v' : 'c';
    const b = indDe(rotas)[k];
    const ma = somaChave('MES_ANT_CHEIO', campo, k, rotas), pv = somaChave('PRE_VENDA', campo, k, rotas);
    const cel = (txt, cls) => ({txt, cls: cls || ''});
    const vazio = cel('');
    if(!b || b.unavailable)
      return [cel(ma == null ? '' : num(ma, casas)), vazio, vazio, vazio, vazio, vazio,
              cel(pv == null ? '' : num(pv, casas)), vazio, vazio];
    const dif = arred(b.real - b.meta, casas);                 // arredondado SÓ no fim (R-QLD-15)
    const md = vol ? b.metaDia : (fech ? null : N.metaDiaCobertura(b, T));
    // Tend. % (volume) e Ritmo (cobertura): no fechamento não há tendência nem meta do dia (R-MES-08)
    const tend = fech || b.pctTendencia == null ? '—' : b.pctTendencia + '%';
    const ritmo = fech || !b.meta || !P.PACE_ONTEM_PCT ? '—'
      : num(b.real / b.meta / (P.PACE_ONTEM_PCT / 100) * 100, 0) + '%';
    return [
      cel(ma == null ? '' : num(ma, casas)),
      cel(num(b.meta, casas)),
      cel(num(b.real, casas)),
      cel(br(dif, casas), dif < 0 ? 'neg' : ''),
      cel(pct(b.real, b.meta, 1)),
      cel(vol ? tend : ritmo),
      cel(pv == null ? '' : num(pv, casas)),
      cel(md == null ? '—' : num(md, casas)),
      vazio,                                                   // Plan. Dia: sempre vazia (R-BO-06)
    ];
  }

  /* ---- blocos de Grupo Produto ----
     Volume: os 5 macros do payload e, depois, os extras (Del Valle Frut) só na gerência que tem o indicador
     (R-VOL-14). Cobertura: os itens do ICS GC (sem Imperdoáveis e Venda Zero), de Novos Negócios e do Todos a Bordo,
     cada um UMA vez só — o selo diz a que grupos ele pertence (ARTD KO, CERVEJAS e CERVEJAS 600ML RETORNAVEL estão em
     dois). */
  const G = (P.GROUPS) || {};
  const incentivo = CONFIG.INCENTIVO_ATIVO !== false && !!G.INCENTIVO;
  function itens(tipo){
    if(tipo === 'vol') return [...(G.VOLUME || []),
      ...Object.keys(P.VOLUME_EXTRA || {}).filter(k => indEscopo[k] && !indEscopo[k].unavailable)];
    const cob = [...(G.ICS_GC || []), ...(G.NOVOS_NEG || []), ...(incentivo ? G.INCENTIVO : [])];
    return [...new Set(cob)].filter(k => !CAD_FORA_COB.includes(k));
  }
  function bloco(tipo, k){
    const [rot, selo] = CAD_ROTULOS[k] || [k, ''];
    return {k, rotulo: rot, selo, seg: 'TODOS',
      linhas: unidades.map(u => ({cod: u.cod, cels: celulas(tipo, k, u.rotas)})),
      total: {cod: 'TOTAL', cels: celulas(tipo, k, rotasEscopo)}};
  }

  /* ---- rodapé: o resíduo das rotas que não viraram linha ----
     O MESMO texto da notaVirtuais do painel, por indicador (é por indicador que o resíduo existe), com o rótulo curto
     na frente para o valor ser atribuível. Sem resíduo, sem nota. */
  function notas(tipo, ks){
    const casas = tipo === 'vol' ? 1 : 0, out = [];
    for(const k of ks){
      const [rot] = CAD_ROTULOS[k] || [k, ''];
      const nota = (rs, texto) => {
        if(!rs.length) return;
        const b = indDe(rs)[k];
        if(!b || b.unavailable) return;
        out.push(`${rot} · ${texto(b)}`);
      };
      nota(foraVirt, b => `Inclui rotas virtuais: Meta ${num(b.meta, casas)} · Real ${num(b.real, casas)}`);
      nota(foraEv, b => `Inclui clientes de rotas eventuais (EV*): Real ${num(b.real, casas)}`);
    }
    return out;
  }

  /* ---- cabeçalho da folha ---- */
  const exercicio = cadExercicio(P);
  const pvData = cadDataBR(((P.PRE_VENDA) || {}).DATA);
  const rotuloEscopo = nivel === 'sv' ? sv : 'GC. ' + gc;
  function cabecalho(tipo){
    const apoio = [`Dias úteis: ${T}`];
    if(fech) apoio.push(`Fechamento ${P.MES_LABEL || ''}`);
    else apoio.push(`Corridos: ${P.DIA_ONTEM}`, `Restantes: ${T - P.DIA_ONTEM}`);
    apoio.push(`Pré-venda: ${pvData || '—'}`, `Ritmo esperado: ${P.PACE_ONTEM_PCT}%`);
    return {titulo: `CADERNO DE VENDAS · GC/GV · ${tipo === 'vol' ? 'VOLUME' : 'COBERTURA'} · EXERCÍCIO ${exercicio}`,
      escopo: rotuloEscopo, apoio, aberto: nivel === 'gc' ? 'Aberto por supervisão' : 'Aberto por rota'};
  }

  const folha = tipo => {
    const ks = itens(tipo);
    return {tipo, cab: cabecalho(tipo), colunas: (tipo === 'vol' ? CAD_COLS_VOL : CAD_COLS_COB)
        .map(([c, rot, larg, novo]) => ({chave: c, rotulo: rot, larg, novo: !!novo})),
      blocos: ks.map(k => bloco(tipo, k)), notas: notas(tipo, ks)};
  };
  return {escopo: {nivel, gc, sv}, rotulo: rotuloEscopo, exercicio, nivel,
    unidades: unidades.map(u => u.cod), folhas: [folha('vol'), folha('cob')]};
}

/* ---------- a tela (navegador) ---------- */
const CAD = (()=>{
  const NIVEIS = [['gc', 'Gerência (aberta por supervisão)'], ['sv', 'Supervisão (aberta por rota)']];
  let ST = null;        // {gc, nivel:'gc'|'sv', sv}
  let ligado = false;

  const $$ = id => document.getElementById(id);
  const ativo = () => !!ST && !!ACESSO && ACESSO.perfil === 'bo';
  const escopoCaderno = () => ST ? {nivel: ST.nivel, gc: ST.gc, sv: ST.nivel === 'sv' ? ST.sv : ''} : null;

  /* ---------- gerências e supervisões dos seletores ----------
     As 16 SEPARADAS (nunca grupos, nunca a MATRIZ) e todas habilitadas, como a 2ª etapa da entrada do Back Office
     (gcBackOffice; CONFIG.GC_LIBERADAS não vale aqui); sem dados = desabilitada. */
  const gcsCad = () => todasGcs();
  // supervisões que viram linha no Caderno: as do payload, menos a das rotas ocultas das EV* (a mesma regra do
  // montaCaderno; aqui só para o seletor)
  function svsCad(gc){
    const svs = Object.keys((DATA || {})[gc] || {}), evs = new Set((P && P.EVENTUAIS_ROTAS) || []);
    return svs.filter(s => { const rs = Object.keys(DATA[gc][s] || {});
      return rs.length && !rs.every(r => evs.has(r)); }).sort(ordemNatural);
  }
  const primeiraCad = () => gcsCad().find(g => DATA[g]) || gcsCad()[0] || '';
  function ajusta(){
    if(!ST) return;
    if(!gcsCad().includes(ST.gc) || !DATA[ST.gc]) ST.gc = primeiraCad();
    const svs = svsCad(ST.gc);
    if(ST.nivel === 'sv' && !svs.includes(ST.sv)) ST.sv = svs[0] || '';
  }

  /* ---------- desenho ---------- */
  function caixa(){
    let el = $$('cad');
    if(el) return el;
    const bo = $$('bo'), rod = $$('boRod');
    if(!bo) return null;
    el = document.createElement('div');
    el.className = 'cadWrap'; el.id = 'cad'; el.hidden = true;
    el.setAttribute('role', 'tabpanel');
    el.setAttribute('aria-labelledby', 'boAba-caderno');
    el.innerHTML = `<div class="cadFiltros">
      <div class="boCampo"><label class="boRot" for="cadGc">Gerência</label><select id="cadGc"></select></div>
      <div class="boCampo"><label class="boRot" for="cadNivel">Nível</label><select id="cadNivel">${
        NIVEIS.map(([v, r]) => `<option value="${v}">${esc(r)}</option>`).join('')}</select></div>
      <div class="boCampo" id="cadCampoSv"><label class="boRot" for="cadSv">Supervisão</label>
        <select id="cadSv"></select></div></div>
      <p class="cadAviso" id="cadAviso"></p>
      <div class="cadFolhas" id="cadFolhas"></div>`;
    bo.insertBefore(el, rod || null);
    return el;
  }
  function liga(){
    if(ligado || !$$('cadGc')) return;
    ligado = true;
    $$('cadGc').onchange = ev => { ST = {...ST, gc: ev.target.value}; ajusta(); render(); };
    $$('cadNivel').onchange = ev => { ST = {...ST, nivel: ev.target.value}; ajusta(); render(); };
    $$('cadSv').onchange = ev => { ST = {...ST, sv: ev.target.value}; render(); };
  }
  function pintaFiltros(){
    const g = $$('cadGc');
    const html = gcsCad().map(x => `<option value="${esc(x)}"${DATA[x] ? '' : ' disabled'}>${esc(rotuloGc(x))}${
      DATA[x] ? '' : ' · sem dados'}</option>`).join('');
    if(g.dataset.html !== html){ g.innerHTML = html; g.dataset.html = html; }
    g.value = ST.gc;
    $$('cadNivel').value = ST.nivel;
    const svs = svsCad(ST.gc), s = $$('cadSv');
    const htmlSv = svs.map(x => `<option value="${esc(x)}">${esc(x)}</option>`).join('');
    if(s.dataset.html !== htmlSv){ s.innerHTML = htmlSv; s.dataset.html = htmlSv; }
    s.value = ST.sv;
    $$('cadCampoSv').hidden = ST.nivel !== 'sv';
  }

  // classe da célula: a chave da coluna, "novo" nas duas colunas novas (Real M.A e Pré-Venda) e "neg" no negativo
  const cel = (c, col) => `<td class="${[col.chave, col.novo ? 'novo' : '', c.cls].filter(Boolean).join(' ')}">` +
    `${esc(c.txt)}</td>`;
  function linhaHtml(l, cols, prim){
    // as 3 primeiras colunas (Seg, Grupo Produto, Unid.) só aparecem com rowspan na 1ª linha do bloco
    const cns = cols.slice(3);
    return `<tr${l.tot ? ' class="tot"' : ''}>${prim}<td class="un">${esc(l.cod)}</td>` +
      l.cels.map((c, i) => cel(c, cns[i])).join('') + '</tr>';
  }
  function blocoHtml(b, cols){
    const ls = [...b.linhas.map(l => ({...l, tot: false})), {...b.total, tot: true}];
    const n = ls.length;
    const prim = `<td class="seg" rowspan="${n}">${esc(b.seg)}</td>` +
      `<td class="prod" rowspan="${n}">${esc(b.rotulo)}${b.selo ? `<span class="selo">${esc(b.selo)}</span>` : ''}</td>`;
    return ls.map((l, i) => linhaHtml(l, cols, i === 0 ? prim : '')).join('');
  }
  function folhaHtml(f){
    const cols = f.colunas;
    return `<div class="cadRola"><section class="cadFolha" data-folha="${esc(f.tipo)}">
      <header class="cadCab">
        <div class="cadCabL"><h3 class="cadTit">${esc(f.cab.titulo)}</h3><span class="cadEsc">${esc(f.cab.escopo)}</span></div>
        <div class="cadApoio">${f.cab.apoio.map(t => `<span>${esc(t)}</span>`).join('')}` +
      `<span class="cadAberto">${esc(f.cab.aberto)}</span></div>
      </header>
      <table class="cadTab"><colgroup>${cols.map(c => `<col style="width:${c.larg}px">`).join('')}</colgroup>
        <thead><tr>${cols.map(c => `<th class="${c.chave}${c.novo ? ' novo' : ''}">${esc(c.rotulo)}</th>`).join('')}</tr></thead>
        <tbody>${f.blocos.map(b => blocoHtml(b, cols)).join('') ||
          `<tr><td class="cadVazio" colspan="${cols.length}">Nada neste filtro.</td></tr>`}</tbody>
      </table>
      ${f.notas.length ? `<div class="cadRod">${f.notas.map(t => `<div>${esc(t)}</div>`).join('')}</div>` : ''}
    </section></div>`;
  }

  function render(){
    if(!ativo() || !P) return;
    if(!caixa()) return;
    liga();
    ajusta();
    pintaFiltros();
    $$('cad').hidden = false;
    const m = montaCaderno(P, escopoCaderno());
    $$('cadAviso').textContent = m.unidades.length
      ? `Relatório matinal: só os dados do payload (sem os pedidos de hoje). ${m.unidades.length} ` +
        (m.nivel === 'gc' ? (m.unidades.length > 1 ? 'supervisões' : 'supervisão') : (m.unidades.length > 1 ? 'rotas' : 'rota')) +
        ` · ${P.MES_LABEL} · dia útil ${P.DIA_ONTEM}/${P.TOTAL_DIAS_UTEIS}`
      : 'Nada neste filtro.';
    $$('cadFolhas').innerHTML = m.folhas.map(folhaHtml).join('');
  }
  // esconde a caixa do Caderno (a aba "Tabela" voltou); nada é recalculado
  function estado(){
    const el = $$('cad');
    if(el) el.hidden = true;
  }
  /* Ao entrar no Back Office a caixa já é criada (escondida): assim o #cad existe desde o começo, mesmo antes de
     alguém abrir a aba. Padrão: a 1ª gerência com dados, aberta por supervisão. */
  function entra(a){
    ST = {gc: primeiraCad(), nivel: 'gc', sv: ''};
    ajusta();
    if(caixa()) liga();
  }
  function sai(){
    ST = null;
    const el = $$('cad');
    if(el){ el.hidden = true; $$('cadFolhas').innerHTML = ''; }
  }

  // só o que o Back Office chama (entra/sai/render/estado) e o que os testes leem (escopoCaderno, monta)
  return {entra, sai, render, ativo, estado, escopoCaderno, monta: montaCaderno};
})();
