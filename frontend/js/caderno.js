/* =====================================================================
   CADERNO DE VENDAS (tela, PR 2, e PDF, PR 3) — Frente 2. Aba nova DENTRO da página do Back Office (backoffice.js),
   ao lado da tabela da R-BO-03, que não é tocada.

   Relatório MATINAL, como o Painel de Ritmo (R-BO-06, R-RIT-01): SÓ dados do payload.json. Nada do online.json
   (ONLINE, puxaOnline) nem dos campos do payload que dependem da venda de hoje (REVERTIDO_HOJE, OPORTUNIDADE_HOJE,
   SEM_COMPRA_HOJE, revertidoHoje, oportunidadeHoje, semDadoHoje), nada de Date/relógio: a data vem do próprio payload.

   NENHUM NÚMERO NOVO: Meta, Real, Dif, %, Tendência e Meta do dia saem de NUCLEO.agrega (o mesmo dos cards) e de
   NUCLEO.metaDiaCobertura; "Real M.A" e "Pré-Venda" saem das chaves MES_ANT_CHEIO e PRE_VENDA do payload, somadas
   pelo ÍNDICE DO NOME do indicador (IND_VOL / IND_COB são tabelas de índice que só crescem no fim).

   - montaCaderno(P, escopo): FUNÇÃO PURA (sem DOM, sem ONLINE, sem relógio) -> as duas folhas (Volume e Cobertura).
     escopo = {nivel:'gc', gc} (gerência aberta por supervisão) | {nivel:'sv', gc, sv} (supervisão aberta por rota).
   - cadernoCompleto / cadernoPaginas: TAMBÉM PURAS -> o caderno inteiro da gerência (2 + 2N folhas) e a divisão
     dele em páginas A4, pelo RS.paginas do Resumo (usado sem alteração).
   - CAD: a tela (seletores próprios, desenho das folhas) e o PDF (botão "Caderno em PDF", palco fora da tela).

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

/* ---------- o caderno inteiro da gerência, em páginas A4 (PDF, PR 3) ----------
   Também PURO (sem DOM, sem ONLINE, sem relógio): as medidas chegam prontas de quem mediu a folha na tela.

   cadernoCompleto(P, gc): a lista de folhas do PDF, na ordem que a Karen decidiu em 24/11/2026 — Gerência (Volume,
   Cobertura) e, depois, CADA supervisão de `svsCad(gc)` na mesma ordem da tela (Volume, Cobertura). São 2 + 2N folhas
   e cada uma sai do montaCaderno, a mesma função pura da tela, chamada UMA vez por escopo. Os seletores Nível e
   Supervisão da tela NÃO entram nisso: o PDF é sempre o caderno inteiro da gerência do seletor Gerência.

   cadernoPaginas(atomos, altUtil, altTotal, paginador): a folha não cabe numa A4, então é PAGINADA — nunca encolhida.
   A divisão é a do Resumo (`RS.paginas`, função pura já testada, injetada aqui como `paginador` e NÃO alterada): os
   átomos são o cabeçalho da folha e, depois, um por bloco de Grupo Produto (o td.prod com o rowspan, as linhas de
   unidade e a linha TOTAL), e um bloco nunca é cortado ao meio.
   As coordenadas são medidas a partir do topo do CORPO da tabela, porque o cabeçalho da folha e o <thead> são
   repetidos em TODA página (senão uma página solta seria ilegível) e por isso saem do orçamento `altUtil`, em vez de
   consumi-lo só na primeira. O átomo do cabeçalho entra como atomos[0] com altura zero: o RS.paginas o funde com o
   1º bloco (a regra do .rs-cab do Resumo, "o cabeçalho nunca fica sozinho"), que aqui é o próprio bloco.
   Devolve um vetor por página com os ÍNDICES dos blocos dela. */
function cadernoCompleto(P, gc){
  const g = montaCaderno(P, {nivel: 'gc', gc});
  const out = g.folhas.map(f => ({nivel: 'gc', gc, sv: '', rotulo: g.rotulo, tipo: f.tipo, folha: f}));
  for(const sv of g.unidades){
    const m = montaCaderno(P, {nivel: 'sv', gc, sv});
    for(const f of m.folhas) out.push({nivel: 'sv', gc, sv, rotulo: m.rotulo, tipo: f.tipo, folha: f});
  }
  return out;
}
function cadernoPaginas(atomos, altUtil, altTotal, paginador){
  const faixas = paginador(atomos, altUtil, altTotal);
  const out = faixas.map(() => []);
  // cada átomo cabe INTEIRO em uma faixa só (as faixas se encostam por alguns px, por isso "cabe inteiro" e não
  // "começa dentro"); o ponteiro só anda para a frente, então nenhum bloco fica fora nem entra em duas páginas
  let p = 0;
  for(let i = 1; i < atomos.length; i++){
    const a = atomos[i];
    while(p < out.length - 1 && !(a.t >= faixas[p][0] - 1 && a.b <= faixas[p][1] + 1)) p++;
    out[p].push(i - 1);
  }
  return out;
}

/* ---------- a tela (navegador) ---------- */
const CAD = (()=>{
  const NIVEIS = [['gc', 'Gerência (aberta por supervisão)'], ['sv', 'Supervisão (aberta por rota)']];
  /* PDF (PR 3): A4 retrato a 96 dpi, as medidas da .cadFolha do app.css. ALT_FOLIO = a faixa reservada no pé de cada
     página para o "Folha X de Y" (ele é absoluto, não entra no fluxo, mas ocupa o papel). CONFIRMA = acima disso o
     navegador pergunta antes de gerar, como o Painel de Ritmo faz na Diretoria "Todas". */
  const LARG = 794, ALT = 1123, ALT_FOLIO = 14, ESCALA = 1.5, QUALIDADE = 0.85, CONFIRMA = 12;
  const TXT = {botao: 'Caderno em PDF', dica: 'Gerar o caderno completo da gerência em PDF (só dados do payload)',
    semConexao: 'Sem conexão para gerar o PDF', erro: 'Não foi possível gerar o PDF',
    vazio: 'Nada para exportar nesta gerência'};
  let ST = null;        // {gc, nivel:'gc'|'sv', sv}
  let ligado = false, ocupado = false;

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
        <select id="cadSv"></select></div>
      <div class="cadAcoes"><button id="cadPdf" class="boBtn boPri" type="button">${esc(TXT.botao)}</button>
        <span id="cadMsg" class="sr-only" role="status" aria-live="polite"></span></div></div>
      <p class="cadAviso" id="cadAviso"></p>
      <div class="cadFolhas" id="cadFolhas"></div>`;
    bo.insertBefore(el, rod || null);
    return el;
  }
  // O desenho da aba Caderno é pedido ao Back Office, nunca direto: só o BO.render() escreve a linha de escopo
  // do alto da página (#boEsc), e ele a monta a partir do CAD.escopoCaderno(). Chamando o render() local, as
  // folhas mudavam e o cabeçalho ficava na gerência da entrada (defeito achado em 23/11/2026).
  // O fallback é para o backoffice.js antigo em cache (sem a aba): aí o Caderno nem aparece, mas não quebra.
  const repinta = () => (typeof BO !== 'undefined' && BO.render) ? BO.render() : render();
  function liga(){
    if(ligado || !$$('cadGc')) return;
    ligado = true;
    $$('cadGc').onchange = ev => { ST = {...ST, gc: ev.target.value}; ajusta(); repinta(); };
    $$('cadNivel').onchange = ev => { ST = {...ST, nivel: ev.target.value}; ajusta(); repinta(); };
    $$('cadSv').onchange = ev => { ST = {...ST, sv: ev.target.value}; repinta(); };
    $$('cadPdf').onclick = () => exporta();     // sem o MouseEvent como 1º argumento
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
  /* A MESMA marcação da tela e do PDF (R-BO-06: uma fonte só). Sem `op`, o HTML é byte a byte o de antes — a folha
     inteira dentro do .cadRola, que é o que dá a rolagem lateral da tela. Com `op` (só o PDF):
     - `pdf` tira o .cadRola (no papel não há rolagem) e devolve a <section> crua, para o palco;
     - `blocos` = os índices dos blocos DAQUELA página (o cabeçalho da folha e o <thead> saem em todas);
     - `ultima` = é a última página da folha, a única que leva a nota de rodapé do resíduo (EV* e virtuais). */
  function folhaHtml(f, op){
    const cols = f.colunas, o = op || {};
    const bls = o.blocos ? o.blocos.map(i => f.blocos[i]) : f.blocos;
    const notas = o.blocos && !o.ultima ? [] : f.notas;
    const miolo = `<section class="cadFolha" data-folha="${esc(f.tipo)}">
      <header class="cadCab">
        <div class="cadCabL"><h3 class="cadTit">${esc(f.cab.titulo)}</h3><span class="cadEsc">${esc(f.cab.escopo)}</span></div>
        <div class="cadApoio">${f.cab.apoio.map(t => `<span>${esc(t)}</span>`).join('')}` +
      `<span class="cadAberto">${esc(f.cab.aberto)}</span></div>
      </header>
      <table class="cadTab"><colgroup>${cols.map(c => `<col style="width:${c.larg}px">`).join('')}</colgroup>
        <thead><tr>${cols.map(c => `<th class="${c.chave}${c.novo ? ' novo' : ''}">${esc(c.rotulo)}</th>`).join('')}</tr></thead>
        <tbody>${bls.map(b => blocoHtml(b, cols)).join('') ||
          `<tr><td class="cadVazio" colspan="${cols.length}">Nada neste filtro.</td></tr>`}</tbody>
      </table>
      ${notas.length ? `<div class="cadRod">${notas.map(t => `<div>${esc(t)}</div>`).join('')}</div>` : ''}
    </section>`;
    return o.pdf ? miolo : `<div class="cadRola">${miolo}</div>`;
  }

  /* ---------- o PDF (PR 3) ----------
     O PDF é SEMPRE o caderno inteiro da gerência do seletor Gerência (decisão da Karen, 24/11/2026): os seletores
     Nível e Supervisão governam só a tela. Molde: o exporta() do ritmo.js, que já resolveu memória (um canvas por
     vez, liberado em seguida), travamento (um await que cede ao navegador entre páginas) e entrega (RS.salvaPdf).
     Nada aqui lê o online.json nem o relógio (R-BO-06, R-RIT-01): a data do arquivo é a do PAYLOAD, por RT.diaArq().
     Ao contrário do Painel de Ritmo, o botão FUNCIONA no fechamento do mês (decisão da Karen, 24/11/2026). */
  // 'AAAA-MM-DD' -> 'dd/mm' (só as propriedades do PDF; a folha já tem o cadDataBR da pré-venda)
  const curtaDe = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? `${m[3]}/${m[2]}` : ''; };
  const espera = () => new Promise(r => setTimeout(r, 0));
  const btnPdf = () => $$('cadPdf');
  function repoe(){
    const b = btnPdf(); if(!b) return;
    b.disabled = false; b.removeAttribute('aria-busy'); b.textContent = TXT.botao;
  }
  // mensagem curta no próprio botão por 5 s (o texto inteiro na região viva #cadMsg, para leitores de tela)
  function avisa(curta, longa){
    const el = $$('cadMsg'); if(el) el.textContent = longa || curta;
    const b = btnPdf(); if(!b) return;
    b.textContent = curta; clearTimeout(avisa.t);
    avisa.t = setTimeout(() => { if(!ocupado) repoe(); }, 5000);
  }
  // o botão nunca é desabilitado pelo fechamento (ver acima); durante uma exportação, o render do online não o mexe
  function pintaBotao(){
    const b = btnPdf(); if(!b || ocupado) return;
    b.textContent = TXT.botao; b.title = TXT.dica; b.setAttribute('aria-label', TXT.botao);
  }

  /* Mede a folha JÁ DESENHADA no palco (largura fixa de 794 px e o CSS do app.css: é a mesma geometria que o
     html2canvas vai fotografar) e devolve os átomos do cadernoPaginas. O átomo de um bloco de Grupo Produto é o
     retângulo do próprio td.prod: o rowspan dele cobre exatamente as linhas de unidade e a linha TOTAL do bloco.
     `cromo` = da borda de cima da folha ao fim do <thead> (repetido em toda página) e `rodape` = a nota do resíduo
     mais o padding de baixo: os dois saem do orçamento de altura dos blocos, com a faixa do "Folha X de Y". */
  function medeFolha(palco){
    const sec = palco.querySelector('.cadFolha'), tb = sec.querySelector('tbody');
    const rs = sec.getBoundingClientRect(), rt = tb.getBoundingClientRect();
    const cromo = rt.top - rs.top, corpo = rt.height, rodape = rs.height - cromo - corpo;
    const atomos = [{t: 0, b: 0}, ...[...sec.querySelectorAll('td.prod')].map(td => {
      const r = td.getBoundingClientRect(); return {t: r.top - rt.top, b: r.bottom - rt.top}; })];
    return {atomos, altUtil: ALT - cromo - rodape - ALT_FOLIO, altTotal: corpo, alt: rs.height, cromo, rodape};
  }
  /* uma página do PDF: a folha com os blocos dela (o cabeçalho da folha e o <thead> saem em TODAS) e o
     "Folha X de Y" no pé. `pg.alt` é a altura da página: a A4 (1123 px) ou, no caso-limite de um bloco de Grupo
     Produto mais alto que a página útil, a altura daquele bloco (é o que o RS.paginas já faz no Resumo — a folha
     cresce, nada é cortado). Com o payload de 24/11 o maior bloco tem 121 px numa página útil de ~1.011 px. */
  const paginaHtml = (pg, i, n) => `<div class="cadPag"${pg.alt === ALT ? '' : ` style="height:${pg.alt}px"`}>${
    folhaHtml(pg.folha, {pdf: true, blocos: pg.blocos, ultima: pg.ultima})
    }<div class="cadFolio">Folha ${i} de ${n}</div></div>`;

  /* Divide as 2 + 2N folhas da gerência em páginas A4, sem capturar nada: devolve uma entrada por página do caderno
     inteiro. Separada do exporta() para os testes conferirem a composição e a paginação sem gerar o PDF. */
  function paginasDoCaderno(palco, folhas){
    const pags = [], medidas = [];
    for(const it of folhas){
      palco.innerHTML = folhaHtml(it.folha, {pdf: true});
      const m = medeFolha(palco);
      const grupos = cadernoPaginas(m.atomos, m.altUtil, m.altTotal, RS.paginas);
      medidas.push({tipo: it.tipo, escopo: it.sv || 'GC.' + it.gc, alt: Math.round(m.alt),
        altUtil: Math.round(m.altUtil), blocos: m.atomos.length - 1, paginas: grupos.length,
        maior: Math.round(Math.max(0, ...m.atomos.slice(1).map(a => a.b - a.t)))});
      // altura da página: a A4, ou mais que isso se os blocos dela não couberem (ver paginaHtml)
      const altura = bls => { if(!bls.length) return ALT;
        const corpo = m.atomos[bls[bls.length - 1] + 1].b - m.atomos[bls[0] + 1].t;
        return Math.max(ALT, Math.ceil(m.cromo + corpo + m.rodape + ALT_FOLIO)); };
      grupos.forEach((bls, i) => pags.push({...it, blocos: bls, ultima: i === grupos.length - 1, alt: altura(bls)}));
    }
    return {pags, medidas};
  }

  async function exporta(){
    if(ocupado || !ativo() || !P) return;
    const b = btnPdf(); if(!b) return;
    const gc = ST.gc, folhas = cadernoCompleto(P, gc);
    if(!folhas.length){ avisa(TXT.vazio); return; }
    ocupado = true;
    b.disabled = true; b.setAttribute('aria-busy', 'true'); b.textContent = 'Preparando…';
    let palco = null, msg = '', longa = '';
    try{
      if(document.fonts) await document.fonts.ready;     // medir e fotografar com a Inter, nunca com a fonte reserva
      palco = document.createElement('div'); palco.className = 'cad-palco'; palco.setAttribute('aria-hidden', 'true');
      document.body.appendChild(palco);
      const pags = paginasDoCaderno(palco, folhas).pags, n = pags.length;
      if(n > CONFIRMA && !confirm(`Exportar ${n} páginas?`)) return;
      try{
        await Promise.all([RS.carregaScript(CONFIG.CDN.html2canvas, 'html2canvas'),
                           RS.carregaScript(CONFIG.CDN.jspdf, 'jspdf')]);
      }catch(err){ msg = TXT.semConexao; return; }
      const pdf = new window.jspdf.jsPDF({orientation: 'portrait', unit: 'px', format: [LARG, pags[0].alt],
        hotfixes: ['px_scaling'], compress: true});
      for(let i = 0; i < n; i++){
        const alt = pags[i].alt;
        b.textContent = `Gerando ${i + 1}/${n}`;
        palco.innerHTML = paginaHtml(pags[i], i + 1, n);
        let canvas = await html2canvas(palco.firstElementChild, {scale: ESCALA, backgroundColor: '#ffffff',
          useCORS: true, width: LARG, height: alt, windowWidth: LARG, windowHeight: alt, logging: false});
        if(i > 0) pdf.addPage([LARG, alt], 'portrait');
        pdf.addImage(canvas.toDataURL('image/jpeg', QUALIDADE), 'JPEG', 0, 0, LARG, alt);
        canvas.width = canvas.height = 0; canvas = null;  // libera a memória do canvas (celular)
        await espera();                                   // cede ao navegador: a interface não trava
      }
      palco.remove(); palco = null;
      // título do PDF (aba do leitor): o dia útil do payload e, com DATA_ONTEM, até quando vão os dados reais
      const curta = curtaDe(P.DATA_ONTEM);
      pdf.setProperties({title: `Caderno de Vendas · ${gc} · dia útil ${P.DIA_ONTEM}/${P.TOTAL_DIAS_UTEIS}` +
        (curta ? ' · dados até ' + curta : ''), author: 'Comercial Bandeirantes'});
      // o nome leva a data do PAYLOAD (RT.diaArq: DATA_ONTEM, o último dia útil fechado), nunca a do relógio (R-RIT-02)
      const nomeArq = `Caderno_Vendas_${gc.replace(/[^\w.+-]+/g, '_')}_${RT.diaArq()}.pdf`;
      if(await RS.salvaPdf(pdf.output('blob'), nomeArq) === 'salvo'){
        msg = 'PDF salvo'; longa = 'PDF salvo: ' + nomeArq;
      }
    }catch(err){ msg = TXT.erro; }
    finally{
      if(palco) palco.remove();
      ocupado = false;
      repoe();
      if(msg) avisa(msg, longa);
    }
  }

  function render(){
    if(!ativo() || !P) return;
    if(!caixa()) return;
    liga();
    ajusta();
    pintaFiltros();
    pintaBotao();
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

  /* só o que o Back Office chama (entra/sai/render/estado) e o que os testes leem (escopoCaderno, monta e, do PDF,
     htmlPagina e paginas: a composição e a divisão em páginas sem gerar o arquivo) */
  return {entra, sai, render, ativo, estado, escopoCaderno, monta: montaCaderno, exporta, htmlPagina: paginaHtml,
    paginas: () => { const palco = document.createElement('div'); palco.className = 'cad-palco';
      palco.setAttribute('aria-hidden', 'true'); document.body.appendChild(palco);
      try { return paginasDoCaderno(palco, cadernoCompleto(P, ST.gc)); } finally { palco.remove(); } }};
})();
