/* =====================================================================
   BACK OFFICE (Frente 1, 12/11/2026) — visões consolidadas e exportação para Excel.

   Perfil próprio na entrada (5º botão, com senha própria: CONFIG.BACKOFFICE_SENHA_HASH; só o hash, nunca a senha).
   Depois da senha, a entrada pede UMA gerência (as 16 separadas, sem grupos) e abre esta página, no lugar do painel.

   NENHUM NÚMERO NOVO: cada célula sai de NUCLEO.agrega (via metricas() do app.js) e de realOnline(), exatamente como a
   linha da cascata do painel (linhaCascata), com o MESMO texto. Não há conta de Meta, Real, Online, %, Dif ou meta do
   dia escrita aqui.

   Visão AGRUPADA (decisão da Karen, 12/11/2026): MATRIZ = G1 + G2 + G3 (a matinal) e os grupos de CONFIG.GC_GRUPOS
   (PA+DI, GU+PO, IT+MO, UR+RI). As gerências aparecem LADO A LADO, uma linha por gerência, SEM linha de total e SEM
   soma em lugar nenhum (tela e Excel). No Back Office esses grupos não têm "Total".

   - Filtros (dentro da página): escopo (uma gerência ou uma agrupada) e nível (Gerência, Supervisão, Rota).
   - Uma tabela por categoria: os 5 macros de Volume e os itens de ICS GC, Novos Negócios e Todos a Bordo, na ordem e
     com os rótulos do painel (rotuloInd). Venda Zero fica fora desta etapa.
   - Colunas, as mesmas da cascata: Meta, Real, Real + Online, % e Dif.
   - Excel (ExcelJS 4.4.0, carregado sob demanda como as bibliotecas do PDF): uma aba "Back Office" com a coluna
     "Categoria" e a aba "Metadados". Nome do arquivo com a data do PAYLOAD (RT.diaArq(), a regra do Painel de Ritmo).
   - "Painel de ritmo": chama a rotina de sempre (RT.exporta) com o escopo da página; na MATRIZ, um PDF só com as
     páginas de G1, depois G2, depois G3 — cada gerência calculada pelo montaRitmo dela, sem consolidar nada.
   ===================================================================== */
const BO = (()=>{
  const TXT = {botao:'Exportar Excel', exportando:'Exportando…', semConexao:'Sem conexão para gerar o Excel',
    erro:'Não foi possível gerar o Excel', vazio:'Nada para exportar neste filtro',
    ritmo:'Painel de ritmo', ritmoMatriz:'Painel de ritmo (Matriz)', fechamento:'Indisponível durante o fechamento'};
  const NOME_ABA = 'Back Office', ABA_META = 'Metadados';
  const MATRIZ = 'MATRIZ';
  // nível -> rótulo da 1ª coluna (o mesmo NIVEL_CASC do cabeçalho da cascata)
  const NIVEIS = [['gc', 'Gerência'], ['sv', 'Supervisão'], ['rota', 'Rota']];

  let ST = null;        // {escopo: 'gc:G1' | 'grp:MATRIZ' | 'grp:IT+MO', nivel: 'gc' | 'sv' | 'rota'}
  let _rotas = null;    // cache de rotasDe(gc, '') dentro de um render (o payload não muda no meio)
  let ocupado = false;

  const $$ = id => document.getElementById(id);
  const ativo = () => !!ST && !!ACESSO && ACESSO.perfil==='bo';

  /* ---------- escopo ---------- */
  // grupos da página: a MATRIZ e os pares de CONFIG.GC_GRUPOS (os mesmos do painel), só com as gerências que existem
  function gruposBo(){
    const pares = (CONFIG.GC_GRUPOS || []).map(ms => ({chave: ms.join('+'), membros: ms.slice()}));
    return [{chave: MATRIZ, membros: (CONFIG.BACKOFFICE_MATRIZ || []).slice()}, ...pares]
      .map(g => ({...g, membros: g.membros.filter(m => todasGcs().includes(m))}))
      .filter(g => g.membros.length > 1);
  }
  const grupoBo = chave => gruposBo().find(g => g.chave===chave) || null;
  const rotuloGrupo = g => `${g.chave} (${g.membros.map(m => 'GC.' + m).join(' + ')})`;
  // gerências do escopo: uma só, ou as do grupo (nunca somadas)
  function gcsDoEscopo(){
    if(!ST) return [];
    if(ST.escopo.startsWith('grp:')){ const g = grupoBo(ST.escopo.slice(4)); return g ? g.membros : []; }
    const gc = ST.escopo.slice(3);
    return todasGcs().includes(gc) ? [gc] : [];
  }
  const agrupada = () => gcsDoEscopo().length > 1;
  // nome curto do escopo (arquivo e metadados): 'G1', 'MATRIZ', 'IT+MO'
  const nomeEscopo = () => ST ? (ST.escopo.startsWith('grp:') ? ST.escopo.slice(4) : ST.escopo.slice(3)) : '';
  const rotuloEscopo = () => {
    if(!ST) return '';
    const g = ST.escopo.startsWith('grp:') ? grupoBo(ST.escopo.slice(4)) : null;
    return g ? rotuloGrupo(g) : rotuloGc(nomeEscopo());
  };
  const rotasGc = gc => (_rotas[gc] || (_rotas[gc] = rotasDe(gc, '')));

  /* ---------- categorias (uma tabela cada) ----------
     Volume = os 5 macros (Del Valle Frut fica fora: nunca é somado a eles); ICS GC sem a Venda Zero (fora desta etapa)
     e sem Imperdoáveis enquanto o indicador não tem fonte (a mesma regra do cardsDaAba do painel); Novos Negócios e
     Todos a Bordo (só com a aba ligada), com os itens e a ordem do payload. */
  function categorias(){
    const todas = gcsDoEscopo().flatMap(rotasGc);
    const ind = todas.length ? agrega(todas).ind : {};
    const semFonte = k => !ind[k] || ind[k].unavailable;
    const out = [
      {grupo:'VOLUME', titulo:'Volume', itens:(GROUPS.VOLUME || []).slice()},
      {grupo:'ICS_GC', titulo:'ICS GC',
       itens:(GROUPS.ICS_GC || []).filter(k => k!=='VENDAZERO' && !(k==='IMPERDOAVEIS' && semFonte(k)))},
      {grupo:'NOVOS_NEG', titulo:'Novos Negócios', itens:(GROUPS.NOVOS_NEG || []).slice()},
    ];
    if(incentivoAtivo()) out.push({grupo:'INCENTIVO', titulo:'Todos a Bordo', itens:itensInc().slice()});
    return out.filter(c => c.itens.length);
  }

  /* ---------- linhas (os grupos da cascata do painel, com os números dela) ----------
     Nível Gerência = uma linha por gerência do escopo (a mesma do 1º nível da cascata da Diretoria); Supervisão e Rota
     = gruposDo() da gerência, isto é, o que o painel mostra ao abrir a cascata dela: supervisões (com a SV.G3.3, que só
     some das listas de clientes) e a linha "Neutraliza" no fim; rotas em ordem natural, sem as virtuais nem as ocultas
     das EV* (que ficam dentro do total, como no painel). Nenhuma linha de total e nenhuma soma entre gerências. */
  function linhaDaGerencia(gc){
    const rs = rotasGc(gc);
    return {nome: rotuloGc(gc), rotas: rs, off: !DATA[gc],
      info: DATA[gc] ? `${svsVisiveis(gc).length} supervisões · ${rs.filter(r=>!ehVirtual(r)).length} rotas` : 'sem dados'};
  }
  function gruposDoNivel(k, gc, nivel){
    if(nivel==='gc') return [linhaDaGerencia(gc)];
    if(nivel==='sv') return gruposDo(ctxGerencia(gc), k);
    return gruposDo({nivel:'rota', chave:gc, gc, rotas:rotasGc(gc), nome:rotuloGc(gc)}, k);
  }
  /* Linhas de uma categoria numa gerência. Todos a Bordo (inc): a mesma regra da cascata (pintaCascata) — o escopo
     aberto é a GERÊNCIA, então rotasInc(k, rotas da gerência) decide o que soma e cada linha leva só a parte dela;
     escopo sem nenhuma rota com meta do item = "Exclusivo portfólio Full" / "Sem meta", como o card da aba. */
  function linhasDaGerencia(k, gc, nivel, inc){
    const todas = rotasGc(gc);
    if(inc){
      const soma = new Set(rotasInc(k, todas));
      if(!soma.size) return [{gc, nome:rotuloGc(gc), info:'', m:null, msg:msgSemMetaInc(k)}];
      const doItem = rs => rs.filter(r => soma.has(r));
      return gruposDoNivel(k, gc, nivel).filter(g => !g.off && doItem(g.rotas).length).map(g => {
        // escopo misto: quantas rotas do grupo têm meta > 0 (as de meta 0 somam só o Real), como na cascata
        const vis = g.rotas.filter(r => !ehVirtual(r)), n = vis.filter(r => temMetaInc(k, r)).length;
        const info = vis.length > 1 && n < vis.length ? `${g.info} · ${n} com meta` : g.info;
        return {gc, nome:g.nome, info, m:metricas(k, doItem(g.rotas)), msg:''};
      });
    }
    return gruposDoNivel(k, gc, nivel).map(g => {
      const m = g.off ? null : metricas(k, g.rotas);
      return {gc, nome:g.nome, info:g.info, m, msg: m ? '' : (g.off ? 'sem dados' : 'indisponível')};
    });
  }
  // todas as linhas da categoria no escopo: as gerências lado a lado, na ordem do escopo, sem total
  const linhas = (k, nivel = ST.nivel, inc = false) =>
    gcsDoEscopo().flatMap(gc => linhasDaGerencia(k, gc, nivel, inc));

  /* ---------- células: o MESMO texto da linha da cascata (linhaCascata em app.js) ----------
     Meta e Real com fmt0 no volume e fmtN nas coberturas; "Real + Online" sempre com fmt0 (o mesmo `ro` da realOnline
     que a Dif usa; sem online — fechamento ou sem online.json — o Real faturado); % = o `dir` de sempre (volume:
     tendência, no fechamento o realizado; coberturas: Real ÷ Meta); Dif = sinal(k, difMostrada(k, ro − Meta)).
     `num` = o valor JÁ ARREDONDADO como a tela o mostra, para o Excel gravar número (nunca texto); null = célula vazia. */
  const arr1 = n => Math.round((n || 0) * 10) / 10;
  function celulas(k, m){
    const vol = ehVolume(k), f = vol ? fmt0 : fmtN, num = n => vol ? Math.round(n || 0) : arr1(n);
    const {b, dir, ro} = m, v = ro==null ? null : difMostrada(k, ro - b.meta);
    return [
      {txt:f(b.meta), num:num(b.meta)},
      {txt:f(b.real), num:num(b.real)},
      {txt:ro==null ? f(b.real) : fmt0(ro), num:ro==null ? num(b.real) : Math.round(ro)},
      {txt:dir==null ? '—' : dir + '%', num:dir==null ? null : dir, cls:dir==null ? '' : b.onPace ? 'boOk' : 'boNo'},
      {txt:v==null ? '—' : sinal(k, v), num:v, cls:v==null ? '' : v>=0 ? 'boOk' : 'boNo'},
    ];
  }
  // cabeçalho das colunas de números: os mesmos nomes do cabeçalho da cascata (ordemCascata)
  const colunasNum = k => ['Meta', 'Real', 'Real + Online',
    ehVolume(k) ? (P.FECHAMENTO ? '% realizado' : '% tendência') : '% real da meta', 'Dif'];

  /* ---------- tabela (tela) ---------- */
  function tabela(c, k){
    const inc = c.grupo==='INCENTIVO', ls = linhas(k, ST.nivel, inc), agr = agrupada();
    const cols = colunasNum(k), nivelRot = (NIVEIS.find(n => n[0]===ST.nivel) || [])[1];
    // no nível Gerência a unidade É a gerência: uma coluna só, mesmo na visão agrupada
    const comGc = agr && ST.nivel!=='gc';
    const cab = (comGc ? ['Gerência'] : []).concat([nivelRot], cols);
    const linha = l => {
      const td = (comGc ? `<td class="boGcCel">${esc(rotuloGc(l.gc))}</td>` : '') +
        `<td class="boUn"><b>${esc(l.nome)}</b>${l.info ? `<small>${esc(l.info)}</small>` : ''}</td>`;
      if(!l.m) return `<tr class="boLinOff" data-gc="${esc(l.gc)}">${td}` +
        `<td class="boOff" colspan="${cols.length}">${esc(l.msg)}</td></tr>`;
      // os valores EXATOS da linha, como a cascata publica nos data-* dela (nada é recalculado a partir deles)
      const {b, dir, ro} = l.m;
      const dados = ` data-gc="${esc(l.gc)}" data-meta="${b.meta}" data-real="${b.real}" data-ro="${ro==null?'':ro}"` +
        ` data-dir="${dir==null?'':dir}" data-dif="${ro==null?'':ro-b.meta}"`;
      return `<tr${dados}>${td}${celulas(k, l.m).map(x => `<td class="boNum ${x.cls || ''}">${esc(x.txt)}</td>`).join('')}</tr>`;
    };
    // o mesmo item pode estar em dois grupos (CERVEJAS no ICS GC e no Todos a Bordo; ARTD KO no ICS GC e em Novos
    // Negócios), com contas diferentes: a seção leva o grupo no id e no data-g
    const id = `boCat-${c.grupo}-${k}`.replace(/[^\w-]+/g, '_');
    return `<section class="boCat" data-g="${esc(c.grupo)}" data-k="${esc(k)}" aria-labelledby="${id}">
      <h3 class="boCatTit" id="${id}">${esc(rotuloInd(k))}</h3>
      <div class="boRola"><table class="boTab">
        <thead><tr>${cab.map((t, i) => `<th${i >= cab.length - cols.length ? ' class="boNum"' : ''}>${esc(t)}</th>`).join('')}</tr></thead>
        <tbody>${ls.map(linha).join('') || `<tr><td class="boOff" colspan="${cab.length}">Nada neste filtro.</td></tr>`}</tbody>
      </table></div></section>`;
  }

  /* ---------- filtros e desenho ---------- */
  function pintaFiltros(){
    const sel = $$('boGc');
    const uma = todasGcs().map(g => `<option value="gc:${esc(g)}">${esc(rotuloGc(g))}</option>`).join('');
    const grp = gruposBo().map(g => `<option value="grp:${esc(g.chave)}">${esc(rotuloGrupo(g))}</option>`).join('');
    const html = `<optgroup label="Gerência">${uma}</optgroup><optgroup label="Agrupada">${grp}</optgroup>`;
    if(sel.dataset.html !== html){ sel.innerHTML = html; sel.dataset.html = html; }
    sel.value = ST.escopo;
    $$('boNivel').value = ST.nivel;
  }
  function render(){
    if(!ativo() || !P) return;
    _rotas = {};
    pintaFiltros();
    const gcs = gcsDoEscopo();
    $$('boEsc').textContent = `${rotuloEscopo()} · ${P.MES_LABEL} · dia útil ${P.DIA_ONTEM}/${P.TOTAL_DIAS_UTEIS}`;
    $$('boNota').textContent = agrupada()
      ? `Gerências lado a lado, uma linha por gerência: nada é somado entre elas (sem linha de total), na tela e no Excel.`
      : `Os números são os mesmos dos cards e da cascata do painel para o mesmo escopo.`;
    $$('boCorpo').innerHTML = !gcs.length ? '<div class="boOff">Nenhuma gerência neste filtro.</div>'
      : categorias().map(c => `<section class="boGrupo" aria-labelledby="boG-${esc(c.grupo)}">` +
          `<h2 class="boGrupoTit" id="boG-${esc(c.grupo)}">${esc(c.titulo)}</h2>` +
          c.itens.map(k => tabela(c, k)).join('') + '</section>').join('');
    estado();
    _rotas = null;
  }

  /* ---------- Excel ----------
     Uma aba "Back Office" com a coluna "Categoria" (a mais simples de conferir: uma linha por categoria x unidade, na
     ordem da tela) e a aba "Metadados". Os números vão como NÚMERO, já arredondados como a tela os mostra; onde a tela
     mostra "—", a célula fica VAZIA (nunca zero); linha sem dado leva o texto dela ("indisponível", "sem dados",
     "Exclusivo portfólio Full", "Sem meta") na coluna Meta, com as outras vazias. Nenhuma fórmula e nenhuma soma. */
  function dadosExcel(){
    _rotas = {};
    const agr = agrupada(), comGc = agr && ST.nivel!=='gc';
    const nivelRot = (NIVEIS.find(n => n[0]===ST.nivel) || [])[1];
    const out = [];
    categorias().forEach(c => {
      const inc = c.grupo==='INCENTIVO';
      c.itens.forEach(k => {
        const cols = colunasNum(k);
        out.push({k, painel:c.titulo, rotulo:rotuloInd(k), cols, comGc, nivelRot,
          linhas: linhas(k, ST.nivel, inc).map(l => ({gc:rotuloGc(l.gc), nome:l.nome, msg:l.msg,
            valores: l.m ? celulas(k, l.m).map(x => x.num) : null}))});
      });
    });
    _rotas = null;
    return out;
  }
  const nomeArquivo = () => `BackOffice_${nomeEscopo().replace(/[^\w.+-]+/g, '_')}_${RT.diaArq()}.xlsx`;
  function metadados(){
    return [
      ['Filtro', rotuloEscopo()],
      ['Nível', (NIVEIS.find(n => n[0]===ST.nivel) || [])[1]],
      ['Dia útil', `${P.DIA_ONTEM}/${P.TOTAL_DIAS_UTEIS}`],
      ['Data do payload', P.DATA_ONTEM || ''],
      ['Online atualizado em', (ONLINE && ONLINE.updatedAt) || ''],
      ['Mês de referência', P.MES_LABEL || ''],
    ];
  }
  // download simples (a página é de uso no PC); nada é enviado para fora: o arquivo é montado no próprio navegador
  function baixa(blob, nome){
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = nome;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  function montaPlanilha(wb, dados){
    const ws = wb.addWorksheet(NOME_ABA);
    /* "Painel" (Volume / ICS GC / Novos Negócios / Todos a Bordo) é o cabeçalho de grupo da tela: sem ele, Cervejas
       (ICS GC e Todos a Bordo) e Artd KO (ICS GC e Novos Negócios) apareceriam duas vezes com contas diferentes e a
       mesma Categoria. */
    const cab = ['Painel', 'Categoria', ...(dados[0] && dados[0].comGc ? ['Gerência'] : []),
      (dados[0] || {}).nivelRot || 'Unidade', 'Meta', 'Real', 'Real + Online', '%', 'Dif'];
    ws.addRow(cab).font = {bold: true};
    dados.forEach(d => d.linhas.forEach(l => {
      const ini = [d.painel, d.rotulo, ...(d.comGc ? [l.gc] : []), l.nome];
      // sem dado: o texto da tela na coluna Meta e as outras vazias (nunca zero)
      const vals = l.valores ? l.valores.map(v => v==null ? null : v) : [l.msg, null, null, null, null];
      ws.addRow([...ini, ...vals]);
    }));
    ws.columns.forEach((c, i) => { c.width = i < cab.length - 5 ? 26 : 14; });
    ws.views = [{state:'frozen', ySplit:1}];
    const meta = wb.addWorksheet(ABA_META);
    meta.addRow(['Campo', 'Valor']).font = {bold: true};
    metadados().forEach(r => meta.addRow(r));
    meta.columns.forEach(c => { c.width = 26; });
    return wb;
  }
  async function exportaExcel(){
    if(ocupado || !ativo() || !P) return;
    const b = $$('boXlsx');
    const dados = dadosExcel();
    if(!dados.length){ avisa(TXT.vazio); return; }
    ocupado = true;
    b.disabled = true; b.setAttribute('aria-busy', 'true'); b.textContent = TXT.exportando;
    let msg = '', longa = '';
    try{
      try{ await RS.carregaScript(CONFIG.CDN.exceljs, 'ExcelJS'); }
      catch(err){ msg = TXT.semConexao; return; }
      const wb = montaPlanilha(new window.ExcelJS.Workbook(), dados);
      const buf = await wb.xlsx.writeBuffer();
      const nome = nomeArquivo();
      baixa(new Blob([buf], {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}), nome);
      msg = 'Excel salvo'; longa = 'Excel salvo: ' + nome;
    }catch(err){ msg = TXT.erro; }
    finally{
      ocupado = false; b.removeAttribute('aria-busy'); b.disabled = false; b.textContent = TXT.botao;
      if(msg) avisa(msg, longa);
    }
  }
  function avisa(curta, longa){
    const el = $$('boAviso'); if(el) el.textContent = longa || curta;
    const b = $$('boXlsx'); if(!b || ocupado) return;
    b.textContent = curta; clearTimeout(avisa.t);
    avisa.t = setTimeout(() => { if(!ocupado) b.textContent = TXT.botao; }, 5000);
  }

  /* ---------- Painel de Ritmo (a rotina de sempre, com o escopo da página) ----------
     MATRIZ = {tipo:'gc', gcs:['G1','G2','G3']}: montaRitmo já devolve as páginas de G1 (gerência + supervisões), depois
     as de G2 e as de G3, nessa ordem, cada uma com o escopo dela. Nada é consolidado e nada muda no montaRitmo nem no
     layout das páginas. Grupo de duas e gerência sozinha: o mesmo escopo que o painel usaria. */
  const escopoRitmo = () => {
    const gcs = gcsDoEscopo().filter(g => DATA[g]);
    return gcs.length ? {tipo:'gc', gcs, nome:nomeEscopo()} : null;
  };
  const rotuloRitmo = () => nomeEscopo()===MATRIZ ? TXT.ritmoMatriz : TXT.ritmo;
  function exportaRitmo(){
    const e = escopoRitmo(); if(!e) return;
    RT.exporta(e, {el:$$('boRitmo'), rotulo:rotuloRitmo(), aviso:'boAviso'});
  }
  /* botões: Excel sempre; Painel de ritmo desabilitado no fechamento do mês, como no painel. Durante uma exportação
     (aria-busy, posto pelo RT.exporta ou pelo Excel daqui) não mexe no botão: o render do online a cada 5 min não pode
     apagar o "Gerando i/n". */
  function estado(){
    const r = $$('boRitmo'), fech = !!(P && P.FECHAMENTO);
    if(!r || ocupado || r.getAttribute('aria-busy')==='true') return;
    r.disabled = fech || !escopoRitmo();
    r.textContent = rotuloRitmo();
    r.title = fech ? TXT.fechamento : 'Exportar o Painel de Ritmo em PDF (só dados reais)';
  }

  /* ---------- entrar e sair ---------- */
  function entra(a){
    if(!$$('bo')) return;
    ST = {escopo: 'gc:' + a.gc, nivel: 'gc'};
    document.body.classList.add('boAtivo');
    $$('bo').hidden = false;
    render();
  }
  function sai(){
    if(!ST) return;
    ST = null;
    document.body.classList.remove('boAtivo');
    $$('bo').hidden = true;
    $$('boCorpo').innerHTML = '';
  }

  /* Sem os elementos da página (index.html antigo no cache com o backoffice.js novo) não faz nada: o painel, o ↻ e o
     resto seguem funcionando, como no painel lateral do app.js. */
  function liga(){
    if(!$$('bo') || !$$('boGc')) return;
    $$('boGc').onchange = e => { ST = {...ST, escopo:e.target.value}; render(); };
    $$('boNivel').onchange = e => { ST = {...ST, nivel:e.target.value}; render(); };
    $$('boXlsx').onclick = exportaExcel;
    $$('boRitmo').onclick = exportaRitmo;
    $$('boCasa').onclick = () => saiDoAcesso('');
    $$('boRecarga').onclick = atualizaPainel;
    $$('boRod').textContent = CONFIG.CREDITOS;
  }
  liga();
  // só o que o painel chama (entra/sai/render pelo app.js) e o que os testes leem (escopoRitmo, nomeArquivo)
  return {entra, sai, render, ativo, estado, escopoRitmo, nomeArquivo};
})();
