/* =====================================================================
   CADERNO DE VENDAS (tela e PDF) — Frente 2. Aba nova DENTRO da página do Back Office (backoffice.js),
   ao lado da tabela da R-BO-03, que não é tocada.

   Relatório MATINAL, como o Painel de Ritmo (R-BO-06, R-RIT-01): SÓ dados do payload.json. Nada do online.json
   (ONLINE, puxaOnline) nem dos campos do payload que dependem da venda de hoje (REVERTIDO_HOJE, OPORTUNIDADE_HOJE,
   SEM_COMPRA_HOJE, revertidoHoje, oportunidadeHoje, semDadoHoje), nada de Date/relógio: a data vem do próprio payload.

   NENHUM NÚMERO NOVO: Meta, Real, Dif, %, Tendência/Ritmo e Meta do dia saem de NUCLEO.agrega (o mesmo dos cards) e
   de NUCLEO.metaDiaCobertura; "R. M.A" e "Pré-v." saem das chaves MES_ANT_CHEIO e PRE_VENDA do payload, somadas
   pelo ÍNDICE DO NOME do indicador (IND_VOL / IND_COB são tabelas de índice que só crescem no fim).

   LAYOUT EM CARTÕES (R-BO-07, decisões da Karen de 26 e 27/11/2026): no lugar das tabelas por Grupo Produto, a
   folha A4 traz UM CARTÃO POR ITEM, dois por linha, até 16 por folha. Cada cartão tem o título (tag de segmento,
   nome, selos), a situação do TOTAL (ATRÁS / NO RITMO) com o % em destaque e a tabela Unid. · R. M.A · Meta · Real ·
   Dif · % · Tend./Ritmo · Pré-v. · Dia, com o TOTAL na PRIMEIRA linha. A coluna "Plan. Dia" saiu.
   Só a APRESENTAÇÃO mudou: toda célula é a mesma célula (mesmo valor, mesmo formato) do Caderno em tabelas.

   - montaCaderno(P, escopo): FUNÇÃO PURA (sem DOM, sem ONLINE, sem relógio) -> as folhas A4 do escopo (Volume e,
     depois, Cobertura; mais de uma folha por tipo quando os cartões não cabem numa só).
     escopo = {nivel:'gc', gc} (gerência aberta por supervisão) | {nivel:'sv', gc, sv} (supervisão aberta por rota).
   - cadernoCompleto(P, gc): TAMBÉM PURA -> o caderno inteiro da gerência, folha a folha (cada folha = uma página A4).
   - CAD: a tela (seletores próprios, desenho das folhas) e o PDF (botão "Caderno em PDF", palco fora da tela).

   Divergências de propósito em relação ao painel (decisões da Karen; ver CLAUDE.md):
   - a supervisão só de rotas Neutraliza entra como a linha "Neutraliza · <rotas>", SEMPRE a última (R-NEU-10), e
     NÃO tem folha própria: nem no seletor Supervisão, nem no PDF (R-BO-12, decisão da Karen de 27/11/2026);
   - a SV.G3.3 (oculta no painel, R-ESC-14) entra com o código real dela e TEM folha própria (ela não é Neutraliza);
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
/* Tag do SEGMENTO DE CLIENTE que o item atende (decisão da Karen, 27/11/2026). Só estes dois itens têm segmento
   próprio (R-COB-04, R-COB-11); todos os demais valem para todos os segmentos e ficam SEM tag. A legenda do rodapé
   sai desta mesma tabela — a informação mora num lugar só. */
const CAD_TAG_SEGMENTO = {
  'KS TT':                     {tag: 'FOCO', segmentos: 'Boteco, Padarias, Restaurante e Lanchonete (KS TT)'},
  'CERVEJAS 600ML RETORNAVEL': {tag: 'FOCO 600',
    segmentos: 'Bar/Boteco, Lanchonete, Restaurante, Adegas e Outros canais (Cerv. 600ml Ret.)'},
};
// itens de cobertura que NÃO entram no Caderno (R-ESC-08, R-BO-06): Imperdoáveis e Venda Zero
const CAD_FORA_COB = ['IMPERDOAVEIS', 'VENDAZERO'];
/* Colunas da tabela do cartão (decisão da Karen, 27/11/2026). A "Plan. Dia" saiu. O 3º item é o rótulo na folha de
   cobertura, quando ele difere do da folha de volume (Tend. % -> Ritmo). */
const CAD_COLS = [
  ['un', 'Unid.'], ['ma', 'R. M.A'], ['meta', 'Meta'], ['real', 'Real'], ['dif', 'Dif'],
  ['pct', '%'], ['tend', 'Tend. %', 'Ritmo'], ['pv', 'Pré-v.'], ['dia', 'Meta dia'],
];
/* Geometria da folha A4 a 96 dpi e da grade de cartões. A grade é a faixa `1fr` da .cadFolha (o CSS divide a altura
   que sobra entre as linhas do grid), então aqui basta decidir QUANTAS linhas de cartões a folha tem.
   `altGrade` é a altura FIXA dessa faixa, a mesma do --cad-grade do app.css (a Parte AR trava os dois juntos): com
   ela, o nº de cartões por folha não depende de quantas linhas o rodapé ocupou naquele escopo. */
const CAD_PAG = {larg: 794, alt: 1123, colunas: 2, linhas: 8, gap: 7, altGrade: 920};
/* Altura de que um cartão PRECISA, em px: a moldura, o título e o cabeçalho das colunas (base) mais `n` linhas de
   tabela (o TOTAL e as unidades). As letras da folha são fixas (não entram na escala --fs-* nem no encaixa()),
   então isto é aritmética de constantes: nada é medido e nada encolhe — quem cede é o nº de linhas de cartões da
   folha (R-BO-07: nunca cortar linha, nunca esconder unidade, nunca letra abaixo de 5,5 px). Os dois números saem
   da medição com dado real (a Parte AR confere que o cartão desenhado nunca passa do planejado). */
const CAD_CARTAO = {base: 34, linha: 9.8};
const cadAlturaCartao = n => CAD_CARTAO.base + n * CAD_CARTAO.linha;
// altura que cada linha de cartões ganha numa grade de L linhas
const cadAlturaLinha = L => (CAD_PAG.altGrade - (L - 1) * CAD_PAG.gap) / L;
// quantas linhas de cartões cabem numa folha cujos cartões têm `n` linhas de tabela (no máximo CAD_PAG.linhas)
function cadLinhasGrade(n){
  const precisa = cadAlturaCartao(n);
  for(let L = CAD_PAG.linhas; L > 1; L--) if(cadAlturaLinha(L) >= precisa) return L;
  return 1;
}
const CAD_MESES = ['JANEIRO', 'FEVEREIRO', 'MARCO', 'ABRIL', 'MAIO', 'JUNHO', 'JULHO', 'AGOSTO', 'SETEMBRO',
                   'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO'];
// 'AAAA-MM-DD' -> 'dd/mm/aa' (vazio sem a data ou fora do formato)
const cadDataBR = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? `${m[3]}/${m[2]}/${m[1].slice(2)}` : ''; };
const cadSemAcento = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '');
/* Primeiro nome capitalizado do supervisor ou do consultor, a MESMA regra do ritmo.js (que não a exporta):
   "ROTA SEM VENDEDOR" em qualquer caixa, ou vazio, vira "Sem vendedor" (R-ESC-14). */
const cadPrimeiroNome = s => { const n = String(s == null ? '' : s).trim();
  return !n || /SEM\s+VENDEDOR/i.test(n) ? 'Sem vendedor' : NUCLEO.titulo(n.split(/\s+/)[0]); };

/* Rotas de uma supervisão no payload e "essa supervisão é só de rotas Neutraliza?" — a regra mora num lugar SÓ
   (R-BO-12), porque três pontos fazem a mesma pergunta: a linha "Neutraliza · <rotas>" do montaCaderno, o seletor
   #cadSv e o cadernoCompleto (o PDF). As virtuais não contam (elas nunca viram linha).
   Decisão da Karen (27/11/2026): a supervisão só de Neutraliza NÃO tem folha própria — ela aparece só na folha da
   gerência, como aquela linha, dentro do TOTAL (R-NEU-10). */
const cadRotasSv = (P, gc, sv) => Object.keys((((P && P.DATA) || {})[gc] || {})[sv] || {});
function cadSoNeutraliza(P, gc, sv){
  const neutras = new Set((P && P.NEUTRALIZA_ROTAS) || []);
  const rs = cadRotasSv(P, gc, sv).filter(r => !NUCLEO.ehVirtual(P, r));
  return rs.length > 0 && rs.every(r => neutras.has(r));
}

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

  /* ---- unidades (item 8 do pedido; rótulos da R-BO-07) ----
     Gerência aberta por supervisão: TODAS as supervisões da gerência presentes no payload, em ordem natural, com o
     código real e o PRIMEIRO NOME do supervisor — inclusive a oculta do painel (SV.G3.3). A supervisão cujas rotas
     são todas Neutraliza vira a linha "Neutraliza · <rotas>" e vai SEMPRE para o fim (decisão da Karen, 27/11/2026:
     muda só o rótulo e a posição; os números continuam os da supervisão). Fora fica só a supervisão das rotas
     ocultas das EV* (todas as rotas dela são eventuais), que não é uma supervisão de verdade e continua dentro do
     TOTAL. Supervisão aberta por rota: as rotas dela em ordem natural, sem as virtuais, com o nome do consultor. */
  const evs = new Set(P.EVENTUAIS_ROTAS || []);
  const svsGc = () => Object.keys(D[gc] || {});
  const rotasSv = s => Object.keys((D[gc] || {})[s] || {});
  const svEventual = s => { const rs = rotasSv(s); return rs.length > 0 && rs.every(r => evs.has(r)); };
  const svNeutraliza = s => cadSoNeutraliza(P, gc, s);        // a regra única, do topo do arquivo
  function unidadesDe(){
    if(nivel === 'sv') return rotasSv(sv).filter(r => !N.ehVirtual(P, r)).sort(N.ordemNatural)
      .map(r => ({cod: r, rotulo: `${r} · ${cadPrimeiroNome((nodo(r) || {}).consultor)}`, rotas: [r]}));
    const svs = svsGc().filter(s => rotasSv(s).length && !svEventual(s)).sort(N.ordemNatural);
    const linha = s => svNeutraliza(s)
      ? {cod: s, neutraliza: true, rotas: rotasSv(s),
         rotulo: 'Neutraliza · ' + rotasSv(s).filter(r => !N.ehVirtual(P, r)).sort(N.ordemNatural).join(', ')}
      : {cod: s, rotas: rotasSv(s), rotulo: `${s} · ${cadPrimeiroNome((P.NOME_SUPERVISOR || {})[s])}`};
    // as de Neutraliza por último, mantendo a ordem natural dentro de cada grupo
    return [...svs.filter(s => !svNeutraliza(s)), ...svs.filter(svNeutraliza)].map(linha);
  }
  const unidades = unidadesDe();
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

  /* ---- chaves novas do payload (R. M.A e Pré-v.) ----
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

  // Ritmo da cobertura, dos valores CRUS (nunca do % já arredondado): % da meta ÷ ritmo esperado do dia
  const ritmoCru = b => (!b.meta || !P.PACE_ONTEM_PCT) ? null : b.real / b.meta / (P.PACE_ONTEM_PCT / 100) * 100;
  /* Situação da linha: ATRÁS (true) quando a Tend. % (volume) ou o Ritmo (cobertura) ficam abaixo de 100, pelos
     valores CRUS (decisão da Karen, 27/11/2026). `null` = sem situação (sem meta, indicador indisponível, ou
     fechamento, que não tem tendência nem ritmo, R-MES-08): aí o cartão não mostra caixa de situação. */
  function atrasDe(tipo, b){
    if(fech || !b || b.unavailable || !b.meta) return null;
    if(tipo === 'vol') return b.tendencia == null ? null : b.tendencia / b.meta * 100 < 100;
    const r = ritmoCru(b);
    return r == null ? null : r < 100;
  }

  /* ---- células de uma linha ----
     `b` = o bloco de NUCLEO.agrega do indicador nas rotas da linha. Indicador indisponível em todas elas = linha
     "sem meta" (as cinco células Meta…Tend. viram uma só; R. M.A e Pré-v., que vêm das chaves do mês anterior e do
     último dia útil fechado, continuam com o número que tinham). */
  function celulas(tipo, k, rotas){
    const vol = tipo === 'vol', casas = vol ? 1 : 0, campo = vol ? 'v' : 'c';
    const b = indDe(rotas)[k];
    const ma = somaChave('MES_ANT_CHEIO', campo, k, rotas), pv = somaChave('PRE_VENDA', campo, k, rotas);
    const cel = (txt, cls) => ({txt, cls: cls || ''});
    const vazio = cel('');
    if(!b || b.unavailable)
      return {semMeta: true, atras: null, pct: '—',
        cels: [cel(ma == null ? '' : num(ma, casas)), vazio, vazio, vazio, vazio, vazio,
               cel(pv == null ? '' : num(pv, casas)), vazio]};
    const dif = arred(b.real - b.meta, casas);                 // arredondado SÓ no fim (R-QLD-15)
    const md = vol ? b.metaDia : (fech ? null : N.metaDiaCobertura(b, T));
    // Tend. % (volume) e Ritmo (cobertura): no fechamento não há tendência nem meta do dia (R-MES-08)
    const tend = fech || b.pctTendencia == null ? '—' : b.pctTendencia + '%';
    const r = ritmoCru(b);
    const ritmo = fech || r == null ? '—' : num(r, 0) + '%';
    const pc = pct(b.real, b.meta, 1);
    return {semMeta: false, atras: atrasDe(tipo, b), pct: pc, cels: [
      cel(ma == null ? '' : num(ma, casas)),
      cel(num(b.meta, casas)),
      cel(num(b.real, casas)),
      cel(br(dif, casas), dif < 0 ? 'neg' : ''),
      cel(pc),
      cel(vol ? tend : ritmo),
      cel(pv == null ? '' : num(pv, casas)),
      cel(md == null ? '—' : num(md, casas)),
    ]};
  }

  /* ---- itens (um cartão cada) ----
     Volume: os 5 macros do payload e, depois, os extras (Del Valle Frut) só na gerência que tem o indicador
     (R-VOL-14). Cobertura: os itens do ICS GC (sem Imperdoáveis e Venda Zero), de Novos Negócios e do Todos a Bordo,
     cada um UMA vez só — o selo diz a que grupos ele pertence (ARTD KO, CERVEJAS e CERVEJAS 600ML RETORNAVEL estão
     em dois). */
  const G = (P.GROUPS) || {};
  const incentivo = CONFIG.INCENTIVO_ATIVO !== false && !!G.INCENTIVO;
  function itens(tipo){
    if(tipo === 'vol') return [...(G.VOLUME || []),
      ...Object.keys(P.VOLUME_EXTRA || {}).filter(k => indEscopo[k] && !indEscopo[k].unavailable)];
    const cob = [...(G.ICS_GC || []), ...(G.NOVOS_NEG || []), ...(incentivo ? G.INCENTIVO : [])];
    return [...new Set(cob)].filter(k => !CAD_FORA_COB.includes(k));
  }
  /* Um cartão: o título (tag de segmento, nome, selos), a situação do TOTAL e a tabela, com o TOTAL na PRIMEIRA
     linha e as unidades (a de Neutraliza por último) depois. */
  function cartao(tipo, k){
    const [rot, selo] = CAD_ROTULOS[k] || [k, ''];
    const seg = CAD_TAG_SEGMENTO[k] || null;
    const tot = celulas(tipo, k, rotasEscopo);
    const linhas = [{cod: 'TOTAL', rotulo: 'TOTAL', tot: true, ...tot},
      ...unidades.map(u => ({cod: u.cod, rotulo: u.rotulo, tot: false, neutraliza: !!u.neutraliza,
        ...celulas(tipo, k, u.rotas)}))];
    return {k, rotulo: rot, selo, tag: seg ? seg.tag : '', pct: tot.pct,
      situacao: tot.atras == null ? '' : tot.atras ? 'atras' : 'ritmo', linhas};
  }

  /* ---- larguras das colunas ----
     `table-layout:fixed` com as larguras em %, calculadas pelo MAIOR texto da folha em cada coluna (a Unid. alarga
     com o rótulo, as de número com o maior número): nada é cortado e nada vira reticências. São larguras RELATIVAS,
     então o que importa é a proporção — o cartão tem sempre a mesma largura. */
  const CH_CEL = 1, CH_CAB = 1.1;    // peso de um caractere do corpo e de um do cabeçalho (maiúsculas, mais largas)
  const FOLGA = 2;                   // o padding da célula, em "caracteres"
  function colunas(tipo, cartoes){
    const vol = tipo === 'vol';
    return CAD_COLS.map(([chave, rotVol, rotCob], i) => {
      const rotulo = (!vol && rotCob) ? rotCob : rotVol;
      let ch = rotulo.length * CH_CAB;
      for(const c of cartoes) for(const l of c.linhas){
        // a linha "sem meta" ocupa cinco colunas de uma vez: ela não manda na largura de nenhuma
        if(chave !== 'un' && l.semMeta) continue;
        const txt = chave === 'un' ? l.rotulo : ((l.cels[i - 1] || {}).txt || '');
        ch = Math.max(ch, txt.length * CH_CEL);
      }
      return {chave, rotulo, peso: ch + FOLGA};
    });
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
  const rotuloEscopo = nivel === 'sv' ? `${sv} · ${cadPrimeiroNome((P.NOME_SUPERVISOR || {})[sv])}` : 'GC. ' + gc;
  function cabecalho(tipo){
    const apoio = [`Dias úteis: ${T}`];
    if(fech) apoio.push(`Fechamento ${P.MES_LABEL || ''}`);
    else apoio.push(`Corridos: ${P.DIA_ONTEM}`, `Restantes: ${T - P.DIA_ONTEM}`);
    apoio.push(`Pré-venda: ${pvData || '—'}`);
    return {titulo: `CADERNO DE VENDAS · GC/GV · EXERCÍCIO ${exercicio}`, escopo: rotuloEscopo,
      tipo: tipo === 'vol' ? 'VOLUME' : 'COBERTURA', apoio,
      ritmo: P.PACE_ONTEM_PCT == null ? '—' : P.PACE_ONTEM_PCT + '%',
      // o rodapé mostra "GC n/N" ou "SV n/N" (a folha dentro do tipo) e a data do PAYLOAD, nunca a do relógio
      sigla: nivel === 'gc' ? 'GC' : 'SV', data: cadDataBR(P.DATA_ONTEM),
      aberto: nivel === 'gc' ? 'Aberto por supervisão' : 'Aberto por rota'};
  }
  // legenda das tags do rodapé: sai da própria CAD_TAG_SEGMENTO, na ordem em que os itens aparecem na folha
  function legendaTags(cartoes){
    const vistos = [];
    for(const c of cartoes) if(c.tag && !vistos.some(x => x.tag === c.tag))
      vistos.push({tag: c.tag, texto: CAD_TAG_SEGMENTO[c.k].segmentos});
    return vistos;
  }

  /* ---- as folhas A4 ----
     Um cartão por item, dois por linha. Quantas LINHAS de cartões a folha tem depende de quantas unidades o escopo
     tem (o cartão nunca encolhe nem corta linha: quem cede é o nº de linhas da grade, R-BO-07). A 1ª folha é
     preenchida até o limite e só o que passa vai para a seguinte, que repete o cabeçalho; a nota do resíduo sai só
     na última folha daquele tipo. Folha com menos cartões deixa o espaço em branco no pé: o cartão não estica. */
  const linhasTab = unidades.length + 1;                   // o TOTAL mais as unidades
  const linhasGrade = cadLinhasGrade(linhasTab);
  const porFolha = linhasGrade * CAD_PAG.colunas;
  // caso-limite: nem com uma linha de cartões o cartão cabe na A4 -> a folha cresce (nada é cortado nem escondido)
  const altura = Math.max(CAD_PAG.alt,
    Math.ceil(CAD_PAG.alt + cadAlturaCartao(linhasTab) - cadAlturaLinha(linhasGrade)));

  function folhasDe(tipo){
    const ks = itens(tipo), cartoes = ks.map(k => cartao(tipo, k));
    const cols = colunas(tipo, cartoes), nts = notas(tipo, ks), leg = legendaTags(cartoes);
    const partes = Math.max(1, Math.ceil(cartoes.length / porFolha));
    const out = [];
    for(let i = 0; i < partes; i++)
      out.push({tipo, parte: i + 1, partes, cab: cabecalho(tipo), colunas: cols,
        cartoes: cartoes.slice(i * porFolha, (i + 1) * porFolha), altura, legendas: leg,
        grade: {linhas: linhasGrade, colunas: CAD_PAG.colunas, porFolha, linhasTabela: linhasTab},
        notas: i === partes - 1 ? nts : []});
    return out;
  }
  return {escopo: {nivel, gc, sv}, rotulo: rotuloEscopo, exercicio, nivel,
    unidades: unidades.map(u => u.cod), rotulosUnidades: unidades.map(u => u.rotulo),
    grade: {linhas: linhasGrade, porFolha, linhasTabela: linhasTab, altura},
    folhas: [...folhasDe('vol'), ...folhasDe('cob')]};
}

/* ---------- o caderno inteiro da gerência (PDF) ----------
   Também PURO (sem DOM, sem ONLINE, sem relógio). Cada folha do layout em cartões JÁ é uma página A4: a quebra
   acontece a cada `porFolha` cartões (R-BO-07), então não há mais paginação por medição de blocos.
   A ordem é a que a Karen decidiu em 24/11/2026 — Gerência (Volume, Cobertura) e, depois, CADA supervisão COM FOLHA
   na mesma ordem da tela (Volume, Cobertura) —, cada folha saindo do montaCaderno, a mesma função pura da tela. Os
   seletores Nível e Supervisão da tela NÃO entram nisso: o PDF é sempre o caderno inteiro da gerência do seletor
   Gerência. São 2 + 2 x (supervisões com folha) conjuntos de folhas: a só de Neutraliza fica fora (R-BO-12). */
function cadernoCompleto(P, gc){
  const g = montaCaderno(P, {nivel: 'gc', gc});
  const out = g.folhas.map(f => ({nivel: 'gc', gc, sv: '', rotulo: g.rotulo, tipo: f.tipo, alt: f.altura, folha: f}));
  for(const sv of g.unidades){
    // a supervisão só de Neutraliza não tem folha própria: ela é a linha "Neutraliza · <rotas>" da folha da
    // gerência, e só (decisão da Karen, 27/11/2026; R-BO-12)
    if(cadSoNeutraliza(P, gc, sv)) continue;
    const m = montaCaderno(P, {nivel: 'sv', gc, sv});
    for(const f of m.folhas) out.push({nivel: 'sv', gc, sv, rotulo: m.rotulo, tipo: f.tipo, alt: f.altura, folha: f});
  }
  return out;
}

/* ---------- a tela (navegador) ---------- */
const CAD = (()=>{
  const NIVEIS = [['gc', 'Gerência (aberta por supervisão)'], ['sv', 'Supervisão (aberta por rota)']];
  /* PDF: A4 retrato a 96 dpi, as medidas da .cadFolha do app.css (o "Folha X de Y" é absoluto, não entra no fluxo).
     CONFIRMA = acima disso o navegador pergunta antes de gerar, como o Painel de Ritmo faz na Diretoria "Todas". */
  const LARG = CAD_PAG.larg, ALT = CAD_PAG.alt, ESCALA = 1.5, QUALIDADE = 0.85, CONFIRMA = 12;
  const TXT = {botao: 'Caderno em PDF', dica: 'Gerar o caderno completo da gerência em PDF (só dados do payload)',
    semConexao: 'Sem conexão para gerar o PDF', erro: 'Não foi possível gerar o PDF',
    vazio: 'Nada para exportar nesta gerência'};
  /* Rodapé da folha: as definições das colunas, num lugar só. "Dif = Real − Meta" e "% = Real ÷ Meta" são as mesmas
     contas do montaCaderno — aqui é só o texto que explica a tabela ao leitor. */
  const DEFINICOES = 'Dif = Real − Meta · % = Real ÷ Meta, sem o online (caderno matinal) · ' +
    'Ritmo = % ÷ ritmo esperado · R. M.A = real do mês anterior inteiro · Pré-v. = último dia útil fechado. ' +
    'Item em mais de um grupo aparece uma vez, com todos os selos.';
  const LEG_SIT = [['atras', 'tendência/ritmo abaixo de 100%; na linha, o % em fundo preto marca a unidade atrás'],
                   ['ritmo', '100% ou mais']];
  const LOGOS = [['cadLogoCoca', 'assets/coca-bandeirantes-preto.png', 'Coca-Cola Bandeirantes', 560, 251],
                 ['cadLogoIm', 'assets/logo-im.png', 'Inteligência de Mercado', 241, 240]];
  let ST = null;        // {gc, nivel:'gc'|'sv', sv}
  let ligado = false, ocupado = false;

  const $$ = id => document.getElementById(id);
  const ativo = () => !!ST && !!ACESSO && ACESSO.perfil === 'bo';
  const escopoCaderno = () => ST ? {nivel: ST.nivel, gc: ST.gc, sv: ST.nivel === 'sv' ? ST.sv : ''} : null;

  /* ---------- gerências e supervisões dos seletores ----------
     As 16 SEPARADAS (nunca grupos, nunca a MATRIZ) e todas habilitadas, como a 2ª etapa da entrada do Back Office
     (gcBackOffice; CONFIG.GC_LIBERADAS não vale aqui); sem dados = desabilitada. */
  const gcsCad = () => todasGcs();
  /* supervisões com FOLHA PRÓPRIA no Caderno: as do payload, menos a das rotas ocultas das EV* e menos a que só
     tem rotas Neutraliza (R-BO-12; essa continua na folha da gerência como a linha "Neutraliza · <rotas>").
     É a mesma lista que o cadernoCompleto percorre, pela mesma função pura: a regra não é duplicada aqui. */
  function svsCad(gc){
    const svs = Object.keys((DATA || {})[gc] || {}), evs = new Set((P && P.EVENTUAIS_ROTAS) || []);
    return svs.filter(s => { const rs = Object.keys(DATA[gc][s] || {});
      return rs.length && !rs.every(r => evs.has(r)) && !cadSoNeutraliza(P, gc, s); }).sort(ordemNatural);
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

  /* ---------- o HTML de um cartão ----------
     Título (tag de segmento, nome do item, selos) + situação do TOTAL + a tabela. O TOTAL é a PRIMEIRA linha; a
     linha sem o indicador troca as cinco células Meta…Tend. por uma só, "sem meta" (R-BO-07). Nada é recalculado
     aqui: todo texto vem pronto do montaCaderno. */
  /* "ritmo" e "ok" soltos são classes do painel (a .ritmo é a caixa preta do dia): os modificadores da caixa de
     situação levam o prefixo cad, como as colunas de número. */
  const SIT = {atras: ['cadAtras', 'ATRÁS'], ritmo: ['cadNoRitmo', 'NO RITMO']};
  const tagHtml = t => t ? `<span class="cadTag">${esc(t)}</span>` : '';
  const sitHtml = s => s ? `<span class="cadSit ${SIT[s][0]}">${esc(SIT[s][1])}</span>` : '';
  function linhaCartaoHtml(l, cols){
    const cls = [l.tot ? 'tot' : '', l.neutraliza ? 'neu' : ''].filter(Boolean).join(' ');
    const un = `<th scope="row" class="cadUn">${esc(l.rotulo)}</th>`;
    if(l.semMeta){
      // R. M.A e Pré-v. continuam (não dependem do mês); as cinco do meio viram uma célula só, e a Dia fica vazia
      const c = l.cels;
      return `<tr${cls ? ` class="${cls}"` : ''}>${un}<td class="ma">${esc(c[0].txt)}</td>` +
        `<td class="cadSemMeta" colspan="5">sem meta</td><td class="pv">${esc(c[6].txt)}</td><td class="dia"></td></tr>`;
    }
    const cels = l.cels.map((c, i) => {
      const col = cols[i + 1];
      // o % da unidade atrás vai em fundo preto com letra branca (a marca de "atrás" dentro da tabela)
      const marca = col.chave === 'pct' && l.atras ? ' atras' : '';
      return `<td class="${col.chave}${marca}${c.cls ? ' ' + c.cls : ''}">${esc(c.txt)}</td>`;
    }).join('');
    return `<tr${cls ? ` class="${cls}"` : ''}>${un}${cels}</tr>`;
  }
  function cartaoHtml(c, cols){
    const total = cols.reduce((a, x) => a + x.peso, 0);
    return `<article class="cadCart" data-k="${esc(c.k)}">
      <div class="cadCartTopo">
        <div class="cadCartTit">${tagHtml(c.tag)}<b class="cadNome">${esc(c.rotulo)}</b>${
          c.selo ? `<span class="cadSelo">${esc(c.selo)}</span>` : ''}</div>
        <div class="cadCartSit">${sitHtml(c.situacao)}<b class="cadCartPct">${esc(c.pct)}</b></div>
      </div>
      <table class="cadTab"><colgroup>${
        cols.map(x => `<col style="width:${(x.peso / total * 100).toFixed(3)}%">`).join('')}</colgroup>
        <thead><tr>${cols.map(x => `<th class="${x.chave}">${esc(x.rotulo)}</th>`).join('')}</tr></thead>
        <tbody>${c.linhas.map(l => linhaCartaoHtml(l, cols)).join('')}</tbody>
      </table></article>`;
  }
  /* A MESMA marcação da tela e do PDF (R-BO-06: uma fonte só). Sem `op`, a folha vai dentro do .cadRola, que é o que
     dá a rolagem lateral da tela; com `op.pdf` a <section> sai crua, para o palco. A folha tem sempre a altura de
     uma A4 (mais que isso só no caso-limite de um cartão altíssimo): folha com poucos cartões fica com o pé em
     branco, o cartão não estica. */
  function folhaHtml(f, op){
    const cols = f.colunas, o = op || {}, g = f.grade;
    const estilo = `--cad-linhas:${g.linhas}` + (f.altura !== ALT ? `;height:${f.altura}px` : '');
    const legTags = f.legendas.map(x => `${tagHtml(x.tag)} ${esc(x.texto)}`).join(' · ');
    const legSit = LEG_SIT.map(([s, txt]) => `${sitHtml(s)} ${esc(txt)}`).join(' · ');
    const pagina = `${esc(f.cab.sigla)} ${f.parte}/${f.partes}${f.cab.data ? ' · ' + esc(f.cab.data) : ''}`;
    const miolo = `<section class="cadFolha" data-folha="${esc(f.tipo)}" data-parte="${f.parte}" style="${estilo}">
      <header class="cadCab">
        <div class="cadCabAlto">
          <div class="cadLogos">${LOGOS.map(([cls, src, alt, w, h]) =>
            `<img class="${cls}" src="${src}" alt="${esc(alt)}" width="${w}" height="${h}">`).join('')}</div>
          <div class="cadCabTxt"><p class="cadTit">${esc(f.cab.titulo)}</p>
            <h3 class="cadEscL"><span class="cadEsc">${esc(f.cab.escopo)}</span>` +
              `<span class="cadTipo">${esc(f.cab.tipo)}</span></h3></div>
          <div class="cadPace"><b>${esc(f.cab.ritmo)}</b><span>ritmo esperado da meta hoje</span></div>
        </div>
        <div class="cadApoio">${f.cab.apoio.map(t => `<span>${esc(t)}</span>`).join('')}` +
          `<span class="cadAberto">${esc(f.cab.aberto)}</span></div>
      </header>
      <div class="cadGrade">${f.cartoes.map(c => cartaoHtml(c, cols)).join('') ||
        `<p class="cadVazio">Nada neste filtro.</p>`}</div>
      <footer class="cadRod">
        ${legTags ? `<p class="cadLeg">${legTags} · sem tag = todos os segmentos</p>` : ''}
        <p class="cadLeg">${legSit}</p>
        <p class="cadDef"><span>${esc(DEFINICOES)}${f.notas.length ? ' ' +
          f.notas.map(t => `<span class="cadNota">${esc(t)}</span>`).join(' · ') : ''}</span>` +
          `<span class="cadPg">${pagina}</span></p>
      </footer>
    </section>`;
    return o.pdf ? miolo : `<div class="cadRola">${miolo}</div>`;
  }

  /* ---------- o PDF ----------
     O PDF é SEMPRE o caderno inteiro da gerência do seletor Gerência (decisão da Karen, 24/11/2026): os seletores
     Nível e Supervisão governam só a tela. Molde: o exporta() do ritmo.js, que já resolveu memória (um canvas por
     vez, liberado em seguida), travamento (um await que cede ao navegador entre páginas) e entrega (RS.salvaPdf).
     Nada aqui lê o online.json nem o relógio (R-BO-06, R-RIT-01): a data do arquivo é a do PAYLOAD, por RT.diaArq().
     Ao contrário do Painel de Ritmo, o botão FUNCIONA no fechamento do mês (decisão da Karen, 24/11/2026).
     Com o layout em cartões cada folha JÁ é uma página A4 (a quebra é a cada `porFolha` cartões), então não há
     passada de medição: a composição sai pronta do cadernoCompleto, que é puro. */
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

  /* uma página do PDF: a folha inteira (cabeçalho, cartões e rodapé) e o "Folha X de Y" do caderno inteiro no pé.
     `pg.alt` é a A4 (1123 px) ou, no caso-limite de um cartão mais alto que a página, a altura daquela folha. */
  const paginaHtml = (pg, i, n) => `<div class="cadPag"${pg.alt === ALT ? '' : ` style="height:${pg.alt}px"`}>${
    folhaHtml(pg.folha, {pdf: true})}<div class="cadFolio">Folha ${i} de ${n}</div></div>`;

  /* As páginas do caderno inteiro da gerência, sem capturar nada: uma por folha. Separada do exporta() para os
     testes conferirem a composição sem gerar o PDF; `medidas` é a tabela de medição (quantos cartões, quantas
     linhas de cartões e qual a altura de cada folha). */
  function paginasDoCaderno(folhas){
    const medidas = folhas.map(it => ({tipo: it.tipo, escopo: it.sv || 'GC.' + it.gc, alt: it.alt,
      parte: it.folha.parte, partes: it.folha.partes, cartoes: it.folha.cartoes.length,
      linhas: it.folha.grade.linhas, porFolha: it.folha.grade.porFolha,
      unidades: it.folha.grade.linhasTabela - 1}));
    return {pags: folhas, medidas};
  }

  async function exporta(){
    if(ocupado || !ativo() || !P) return;
    const b = btnPdf(); if(!b) return;
    const gc = ST.gc, folhas = cadernoCompleto(P, gc);
    if(!folhas.length){ avisa(TXT.vazio); return; }
    const pags = paginasDoCaderno(folhas).pags, n = pags.length;
    if(n > CONFIRMA && !confirm(`Exportar ${n} páginas?`)) return;
    ocupado = true;
    b.disabled = true; b.setAttribute('aria-busy', 'true'); b.textContent = 'Preparando…';
    let palco = null, msg = '', longa = '';
    try{
      if(document.fonts) await document.fonts.ready;     // medir e fotografar com a Inter, nunca com a fonte reserva
      try{
        await Promise.all([RS.carregaScript(CONFIG.CDN.html2canvas, 'html2canvas'),
                           RS.carregaScript(CONFIG.CDN.jspdf, 'jspdf')]);
      }catch(err){ msg = TXT.semConexao; return; }
      palco = document.createElement('div'); palco.className = 'cad-palco'; palco.setAttribute('aria-hidden', 'true');
      document.body.appendChild(palco);
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
    $$('cadFolhas').innerHTML = m.folhas.map(f => folhaHtml(f)).join('');
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
     htmlPagina e paginas: a composição do caderno inteiro sem gerar o arquivo) */
  return {entra, sai, render, ativo, estado, escopoCaderno, monta: montaCaderno, exporta, htmlPagina: paginaHtml,
    paginas: () => paginasDoCaderno(cadernoCompleto(P, ST.gc))};
})();
