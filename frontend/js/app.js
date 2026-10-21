/* Desempenho de Rotas · núcleo do painel.
   Dados: data/payload.json (base do mês) e data/online.json (vendas do dia),
   ambos gerados pelo back-end a partir do SAP Datasphere (OData). */
let P = null;
let DATA,LABELS,GROUPS,CLIENT_ROSTER,CLIENTES_HOJE,OPORTUNIDADES_DIA,VISITAS_DIA,SEGS,DIAS,COBERTOS,SEM_COMPRA_HOJE,VENDAZERO_CLIENTES,COMODATO_ATIVOS,REVERTIDO_HOJE,OPORTUNIDADE_HOJE;
const KSTT_SEG = new Set(['LANCHONETE','RESTAURANTE','BOTECO','PADARIAS']);

let ONLINE = null, aba='ICS_GC';

/* ---------- utilitários ---------- */
const $ = id => document.getElementById(id);
const ESC_MAP = {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'};
const esc = v => String(v==null?'':v).replace(/[&<>"']/g, ch=>ESC_MAP[ch]);
const titulo = NUCLEO.titulo;
function nomeSv(sv){
  const n = ((P && P.NOME_SUPERVISOR)||{})[sv];
  if(!n) return '';
  if(/SEM VENDEDOR/i.test(n)) return 'sem vendedor';
  return titulo(n.split(/\s+/)[0]);
}
const rotuloSv = sv => { const n = nomeSv(sv); return n ? `${sv} · ${n}` : sv; };
/* Neutraliza e virtuais (por rota, em qualquer gerência) e ocultas (por supervisão): listas únicas no back-end
   (mapeamento.py), no payload em NEUTRALIZA_ROTAS, VIRTUAIS_ROTAS, OCULTAS e GC_SEM_OCULTAS.
   Neutraliza: Meta e Real de Volume, ICS GC e Novos Negócios no total da gerência; na cascata e no filtro de
   supervisão aparecem juntas como "Neutraliza" (rotas e clientes dentro); fora das supervisões, do Resumo, do
   "puxa a média" e da Venda Zero (que já vem indisponível do back-end). Virtuais: ocultas em tudo, só no total.
   Clientes em rotas EV* (EVENTUAIS_ROTAS, também em VIRTUAIS_ROTAS): uma rota oculta por gerência, só com o Real
   de volume (meta 0), tratada como virtual; na cascata, nota própria.
   Ocultas: fora do "puxa a média" e das listas de clientes; na gerência AT nenhuma supervisão é oculta.
   CONFIG.SV_EXCLUIDOS só vale para payload antigo, sem essas chaves. */
const SV_NEUTRA = 'Neutraliza';    // "supervisão" do filtro e da cascata que junta as rotas Neutraliza da gerência
const gcDoSv = sv => String(sv||'').split('.')[1] || '';
const semOcultas = sv => ((P && P.GC_SEM_OCULTAS) || ['AT']).includes(gcDoSv(sv));
const ehNeutraliza = r => ((P && P.NEUTRALIZA_ROTAS) || []).includes(r);
const ehEventual = r => ((P && P.EVENTUAIS_ROTAS) || []).includes(r);
// a rota oculta das eventuais ('-EV') já vem em VIRTUAIS_ROTAS; conferida aqui também, para nunca aparecer em lista
const ehVirtual = r => ((P && P.VIRTUAIS_ROTAS) || []).includes(r) || ehEventual(r);
const ehNormal = r => !ehNeutraliza(r) && !ehVirtual(r);
const ehOculta = sv => !semOcultas(sv) && ((P && P.OCULTAS) ? P.OCULTAS.includes(sv)
  : CONFIG.SV_EXCLUIDOS.includes(sv));
// supervisões sem SUP/VEND de verdade ("ROTA SEM VENDEDOR" / Neutraliza / ocultas)
// não entram na comparação "quem mais puxa a média para baixo"
const svExcluido = sv => sv===SV_NEUTRA || (!semOcultas(sv) && (ehOculta(sv)
  || /SEM VENDEDOR/i.test(((P && P.NOME_SUPERVISOR)||{})[sv]||'')));
// rótulo de indicador: LABELS do payload ou, para o volume extra (Del Valle Frut), VOLUME_EXTRA
const rotuloInd = k => (LABELS||{})[k] || (((P && P.VOLUME_EXTRA)||{})[k]||{}).label || k;
const volExtras = () => Object.keys((P && P.VOLUME_EXTRA) || {});
const ehVolume = k => GROUPS.VOLUME.includes(k) || volExtras().includes(k);
// números: volume inteiro e coberturas com até 1 casa, sempre no formato pt-BR (490.003, nunca 490002.69999)
const fmt0 = n => Math.round(n||0).toLocaleString('pt-BR');
const fmtN = n => (n||0).toLocaleString('pt-BR', {maximumFractionDigits:1});
// ordem natural dos códigos (SV.G1.2 antes de SV.G1.10; 111, 112...; A11, A12...; I11...): nucleo.js
const ordemNatural = NUCLEO.ordemNatural;
// torna um elemento não-<button> clicável também pelo teclado (Enter/Espaço)
function clicavel(el, fn){
  el.onclick = fn;
  el.onkeydown = e => { if(e.key==='Enter' || e.key===' '){ e.preventDefault(); fn(e); } };
}
// reduz a fonte até o texto caber na largura real do elemento (mede no DOM, não em px fixos);
// data-fit vazio = parte do tamanho da escala tipográfica (o do CSS, que muda entre PC e celular)
function encaixa(raiz){
  (raiz||document).querySelectorAll('[data-fit]').forEach(el=>{
    if(!el.dataset.fit) el.style.fontSize = '';
    const max = parseFloat(el.dataset.fit || getComputedStyle(el).fontSize), min = parseFloat(el.dataset.fitMin||7);
    let s = max; el.style.fontSize = s+'px';
    el.style.whiteSpace = '';
    while(el.scrollWidth > el.clientWidth + 0.5 && s > min){ s -= 0.5; el.style.fontSize = s+'px'; }
    // se nem no tamanho mínimo coube e o elemento permite, quebra a linha em vez de cortar
    if(el.dataset.fitQuebra!=null && el.scrollWidth > el.clientWidth + 0.5){
      el.style.whiteSpace = 'normal'; el.style.fontSize = ((max+min)/2)+'px';
    }
  });
}
// a Inter chega depois do 1º desenho (font-display: swap): mede de novo com a fonte certa
if(document.fonts) document.fonts.addEventListener('loadingdone', () => encaixa());

/* ---------- status "Online" ----------
   Janela de vendas (CONFIG.JANELA_VENDAS, horário de Brasília). Fora dela, ou se o
   updatedAt for de um dia anterior, a tag vira vermelha. Tudo calculado em
   America/Sao_Paulo via Intl (nunca o relógio local do aparelho); o updatedAt
   já vem no horário de Brasília e é lido direto da string. */
function agoraSP(){
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', year:'numeric', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit', hour12:false
  }).formatToParts(new Date());
  const m = {}; partes.forEach(p=>m[p.type]=p.value);
  let hora = Number(m.hour);
  if(hora===24) hora=0;
  return {ano:Number(m.year), mes:Number(m.month), dia:Number(m.day), hora, min:Number(m.minute)};
}
const minutos = hhmm => { const [h,m] = hhmm.split(':').map(Number); return h*60+m; };

function statusAtualizado(){
  if(!ONLINE || !ONLINE.updatedAt) return null;
  // Fechamento do mês: online.json traz 'fechamentoMes' e o dia não terá venda nova.
  if(ONLINE.fechamentoMes) return {cor:'fechamento', texto:`Fechamento ${ONLINE.fechamentoMes}`};
  const [dataStr, horaStr] = ONLINE.updatedAt.split('T');
  const hhmm = (horaStr||'').slice(0,5);
  const [anoU, mesU, diaU] = dataStr.split('-').map(Number);

  const ag = agoraSP();
  const mesmoDia = (anoU===ag.ano && mesU===ag.mes && diaU===ag.dia);
  const minutosAgora = ag.hora*60 + ag.min;
  const J = CONFIG.JANELA_VENDAS;
  const dentroHorario = minutosAgora>=minutos(J.inicio) && minutosAgora<=minutos(J.fim);

  if(mesmoDia && dentroHorario) return {cor:'verde', texto:`Online ${hhmm}`};
  if(mesmoDia) return {cor:'vermelho', texto:`Última atualização em ${hhmm}`};
  const dd=String(diaU).padStart(2,'0'), mm=String(mesU).padStart(2,'0');
  return {cor:'vermelho', texto:`Última atualização em ${dd}/${mm} ${hhmm}`};
}

function claseTag(st){
  if(!st) return 'tagUpd';
  if(st.cor==='vermelho') return 'tagUpd encerrado';
  if(st.cor==='fechamento') return 'tagUpd fechamento';
  return 'tagUpd';
}
function tagAtualizado(){
  const st = statusAtualizado();
  if(!st) return '';
  return ` <span class="${claseTag(st)}" id="tagUpdEl"><span class="pt"></span>${esc(st.texto)}</span>`;
}

// reavalia a tag e o rodapé a cada minuto, sem re-renderizar o painel inteiro
function atualizarStatusTag(){
  const st = statusAtualizado();
  const tagEl = document.getElementById('tagUpdEl');
  if(tagEl){
    tagEl.className = claseTag(st);
    tagEl.innerHTML = st ? `<span class="pt"></span>${esc(st.texto)}` : '';
  }
  const rEl = document.getElementById('rodapeStatus');
  if(rEl) rEl.textContent = st ? st.texto : 'sem dados de venda online neste export';
}
setInterval(atualizarStatusTag, CONFIG.STATUS_TICK_MS);

/* Filtro: modo 'gc' (Gerência: gc > sv > rota) ou 'dir' (Diretoria: todas as gerências ou a do filtro, dgc).
   O filtro da Diretoria (dgc) não mexe no da Gerência (gc) e volta para "Todas" ao reabrir a Diretoria.
   Os perfis Gerência, Supervisão e Rota usam o modo 'gc' com parte do filtro travada (ACESSO, ver a entrada).
   Na Gerência de um grupo (ex.: IT+MO), sel.gc é a chave do grupo (o Total das duas) ou uma das duas. */
let sel = {modo:'gc', dgc:'', gc:'', sv:'', rota:''};
let ROTA_IDX = {};   // rota -> [gc, sv] (montado em aplicaPayload; a Diretoria junta rotas de várias gerências)

/* As 16 gerências, na ordem e com o nome da praça: payload GC_NOMES (lista única do back-end; GC_ATIVAS na mesma
   ordem, só as que têm dados). Payload antigo sem GC_NOMES: ordem de GC_ATIVAS e rótulo só com o código; a chave
   REGIOES de payload antigo é ignorada. */
const nomesGc = () => (P && P.GC_NOMES) || {};
const todasGcs = () => [...new Set([...Object.keys(nomesGc()), ...((P && P.GC_ATIVAS) || []), ...Object.keys(DATA || {})])];
const gcsComDados = () => todasGcs().filter(g=>DATA[g]);
const primeiraGc = () => gcsComDados()[0] || Object.keys(DATA)[0];

/* Gerências agrupadas (CONFIG.GC_GRUPOS, os pares que o Datasphere junta): um grupo é uma "gerência" com a chave
   'IT+MO' (só as gerências do grupo que existem no painel; com menos de duas, não há grupo). Onde o código recebe
   uma gerência (rotasDe, svsVisiveis, rotasNeutraliza, ctxGerencia, rótulo...), recebe também a chave de um grupo:
   as rotas e supervisões são as das duas, na ordem do grupo. */
function gruposGc(){
  const todas = todasGcs();
  return (CONFIG.GC_GRUPOS || []).map(g => g.filter(x => todas.includes(x))).filter(g => g.length > 1)
    .map(membros => ({chave: membros.join('+'), membros}));
}
const ehGrupo = u => typeof u==='string' && u.includes('+') && gruposGc().some(g => g.chave===u);
const membrosGc = u => typeof u==='string' && u.includes('+') ? ((gruposGc().find(g => g.chave===u) || {}).membros || []) : [u];
const temDados = u => membrosGc(u).some(g => DATA[g]);
// "GC.G1 · Goiânia 01"; grupo: "GC.IT + GC.MO · Itumbiara + Morrinhos" (sem GC_NOMES, só os códigos)
function rotuloGc(u){
  const ms = membrosGc(u), nomes = ms.map(g => nomesGc()[g]);
  return ms.map(g => 'GC.'+g).join(' + ') + (nomes.every(Boolean) && nomes.length ? ' · '+nomes.join(' + ') : '');
}

const svsDe = gc => membrosGc(gc).flatMap(g => Object.keys(DATA[g]||{}));
const rotasDe = (gc,sv) => membrosGc(gc).filter(g => DATA[g])
  .flatMap(g => sv ? Object.keys(DATA[g][sv]||{}) : Object.keys(DATA[g]).flatMap(s=>Object.keys(DATA[g][s])));
const rotaSv = (gc,r) => (ROTA_IDX[r]||[])[1];
const nodo = (gc,r) => { const i = ROTA_IDX[r]; return i ? DATA[i[0]][i[1]][r] : undefined; };
const ehKstt = c => KSTT_SEG.has((SEGS[c[2]]||'').toUpperCase());
// rotas de uma supervisão sem as Neutraliza e as virtuais; as Neutraliza da gerência (linha "Neutraliza")
const rotasNormais = (gc,sv) => rotasDe(gc, sv).filter(ehNormal);
const rotasNeutraliza = gc => rotasDe(gc, '').filter(ehNeutraliza);
// supervisões que aparecem (selects, colunas, linhas): as que têm alguma rota normal
const svsVisiveis = gc => svsDe(gc).filter(s=>rotasNormais(gc, s).length);
// em ordem crescente do código (SV.G1.2 antes de SV.G1.10); num grupo, gerência -> número
const svsEmOrdem = gc => membrosGc(gc).flatMap(g => svsVisiveis(g).sort(ordemNatural));
// supervisão do filtro para a rota: "Neutraliza" ou a da rota
const svDaRota = r => ehNeutraliza(r) ? SV_NEUTRA : rotaSv(sel.gc, r);
// rotas do filtro para os indicadores: o total da gerência (e da Diretoria) inclui Neutraliza e virtuais;
// uma supervisão soma só as rotas normais dela e "Neutraliza", só as Neutraliza da gerência
const rotasAtuais = () => sel.modo==='dir' ? (sel.dgc ? rotasDe(sel.dgc,'') : gcsComDados().flatMap(g=>rotasDe(g,'')))
  : sel.rota ? [sel.rota] : sel.sv===SV_NEUTRA ? rotasNeutraliza(sel.gc)
  : sel.sv ? rotasNormais(sel.gc, sel.sv) : rotasDe(sel.gc, '');
// o que aparece (clientes, visitas, rotas, busca): sem as virtuais
const rotasVisiveis = () => rotasAtuais().filter(r=>!ehVirtual(r));
// listas de clientes: também sem as ocultas (na AT, tudo aparece)
const rotasListas = () => rotasVisiveis().filter(r=>!ehOculta(rotaSv(sel.gc, r)));

/* ---------- agregação ----------
   A conta é a de NUCLEO.agrega (nucleo.js, pura: também a do Painel de Ritmo em PDF); aqui com os campos de hoje
   (revertidoHoje, oportunidadeHoje, semDadoHoje) do payload. */
function agrega(rotas){
  return NUCLEO.agrega(P, rotas, r=>nodo(sel.gc,r), {revertido:REVERTIDO_HOJE, oportunidade:OPORTUNIDADE_HOJE});
}

/* ---------- filtros ---------- */
// grupo de gerências do filtro: o do acesso Gerência (ou o do link do Resumo, sem acesso); '' = gerência individual
const grupoDoFiltro = () => sel.modo==='dir' ? ''
  : ACESSO ? (ACESSO.perfil==='gc' && ehGrupo(ACESSO.gc) ? ACESSO.gc : '') : (ehGrupo(sel.gc) ? sel.gc : '');
let _chaveFiltros = '';
function montaFiltros(){
  // só reconstrói os <select> quando o filtro (ou o payload) muda -- o polling do online não mexe neles
  const perfil = ACESSO ? ACESSO.perfil : '', grupo = grupoDoFiltro();
  const chave = `${perfil}|${grupo}|${sel.modo}|${sel.dgc}|${sel.gc}|${sel.sv}|${sel.rota}|${P._versao||''}`;
  if(chave===_chaveFiltros) return;
  _chaveFiltros = chave;
  const dir = sel.modo==='dir';
  // perfis com contexto travado: Gerência sem o filtro de gerência (no grupo, só Total / uma das duas); Supervisão só
  // com o das rotas dela; Rota sem filtros
  $('fgc').hidden = !dir && !!perfil && !grupo;
  $('fsv').hidden = dir || perfil==='sv' || perfil==='rota';
  $('frota').hidden = dir || perfil==='rota';
  $('fgc').classList.toggle('largo', dir);
  $('qSugestoes').classList.remove('on');
  // as 16 na ordem de GC_NOMES, com o rótulo "GC.G1 · Goiânia 01"; sem dados aparece desabilitada
  const opc = g => `<option value="${esc(g)}"${DATA[g]?'':' disabled'}>${esc(rotuloGc(g))}${DATA[g]?'':' · sem dados'}</option>`;
  if(dir){        // Diretoria: todas as gerências (somadas) ou uma delas
    $('fgc').innerHTML = `<option value="">Todas as gerências</option>` + todasGcs().map(opc).join('');
    $('fgc').value = sel.dgc;
    return;
  }
  // grupo: "Total (GC.IT + GC.MO)" e cada uma das duas; a escolha filtra tudo (supervisão e rota dentro dela)
  $('fgc').innerHTML = grupo
    ? `<option value="${esc(grupo)}">Total (${esc(membrosGc(grupo).map(g=>'GC.'+g).join(' + '))})</option>` +
      membrosGc(grupo).map(opc).join('')
    : todasGcs().map(opc).join('');
  $('fgc').value = sel.gc;
  const neutra = rotasNeutraliza(sel.gc);
  $('fsv').innerHTML = `<option value="">Todos os SVs</option>`+
    svsEmOrdem(sel.gc).map(s=>`<option value="${esc(s)}">${esc(rotuloSv(s))}</option>`).join('')+
    (neutra.length ? `<option value="${SV_NEUTRA}">${SV_NEUTRA}</option>` : '');
  $('fsv').value = sel.sv;
  const rs = sel.sv===SV_NEUTRA ? neutra : sel.sv ? rotasNormais(sel.gc, sel.sv) : rotasDe(sel.gc,'').filter(r=>!ehVirtual(r));
  $('frota').innerHTML = `<option value="">Todas rotas</option>`+
    rs.map(r=>`<option value="${esc(r)}">Rota ${esc(r)}</option>`).join('');
  $('frota').value = sel.rota;
  $('qSugestoes').classList.remove('on');
}
$('fgc').onchange = e => {
  if(sel.modo==='dir') sel.dgc = e.target.value;
  else sel = {...sel, gc:e.target.value, sv:'', rota:''};
  render();
};
$('fsv').onchange = e => {sel.sv=e.target.value; sel.rota=''; render();};
$('frota').onchange = e => {
  sel.rota=e.target.value;
  if(sel.rota && !sel.sv) sel.sv = svDaRota(sel.rota);
  render();
};
function marcaAba(g){
  aba = g;
  document.querySelectorAll('.tab').forEach(x=>{
    x.classList.toggle('on', x.dataset.g===g); x.setAttribute('aria-selected', x.dataset.g===g);
  });
}
document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>{
  marcaAba(t.dataset.g);
  render();
  if($('q').value.trim()) buscaCliente();
});

/* ---------- render ---------- */
function render(){
  if(!P) return;
  // aba Todos a Bordo (chave INCENTIVO): só com CONFIG.INCENTIVO_ATIVO e o grupo INCENTIVO no payload (payload antigo: oculta)
  const tabInc = document.querySelector('.tab[data-g="INCENTIVO"]');
  tabInc.hidden = !incentivoAtivo();
  if(aba==='INCENTIVO' && tabInc.hidden) marcaAba('ICS_GC');
  montaFiltros();
  const rotas = rotasAtuais();
  const {ind, tot} = agrega(rotas);

  // contexto: perfil (Diretoria, Gerência, Supervisão ou Rota) + gerência + supervisão + rota
  const perfil = ACESSO ? ACESSO.perfil : '';
  const onde = sel.modo==='dir' ? `Diretoria${sel.dgc ? ' · '+esc(rotuloGc(sel.dgc)) : ''}`
    : `${PERFIS[perfil==='sv' || perfil==='rota' ? perfil : 'gc']} · ${esc(rotuloGc(sel.gc))}`;
  $('sub').innerHTML = `${esc(P.MES_LABEL)}${tagAtualizado()} · ${onde}` +
    (sel.sv?` · ${esc(rotuloSv(sel.sv))}`:'') +
    (sel.rota?` · Rota ${esc(sel.rota)} — ${esc(titulo(nodo(sel.gc,sel.rota).consultor))}`:'');
  const paceHoje = Math.round(P.DIA_HOJE / P.TOTAL_DIAS_UTEIS * 100);
  $('ritmo').innerHTML =
    `<span>Real até ontem: <b>dia útil ${P.DIA_ONTEM}/${P.TOTAL_DIAS_UTEIS}</b> (<span class="pct">${P.PACE_ONTEM_PCT}%</span>)`+
    ` · para entrar no ritmo hoje: <span class="pct">${paceHoje}%</span></span>`+
    `<span>Hoje é o dia <b>${P.DIA_HOJE}</b> · ${esc(P.DIA_SEMANA)} · semana <b>N°${P.SEMANA_NUM}</b> (${esc(P.SEMANA_TIPO)})</span>`;

  const visiveis = rotasVisiveis();
  const visitas = visiveis.reduce((a,r)=>a+(VISITAS_DIA.geral[r]||0),0);
  $('nBase').textContent = tot.baseTotal.toLocaleString('pt-BR');
  $('xBase').innerHTML = `visitas hoje <b class="ok">${visitas}</b>`;

  const scHoje = visiveis.every(r=>VISITAS_DIA.semCompra[r]!=null)
    ? visiveis.reduce((a,r)=>a+VISITAS_DIA.semCompra[r],0) : null;
  const pctSem = (tot.semCompra!=null && tot.baseTotal)
    ? Math.round(tot.semCompra/tot.baseTotal*100) : null;
  $('nSem').textContent = tot.semCompra==null? '—' : tot.semCompra.toLocaleString('pt-BR');
  $('lSem').textContent = pctSem==null? 'Sem compra' : `Sem compra ${pctSem}%`;
  $('xSem').innerHTML = scHoje==null ? 'sem venda do dia'
    : `sem compra <b class="inl">hoje</b><b class="no">${scHoje}</b>`;

  if(aba==='INCENTIVO'){
    // aba Todos a Bordo: no lugar do "ritmo de coberturas", os itens com meta no escopo que estão em 100%; sem "puxa a média"
    const st = itensEm100(itensInc().map(k=>[k, rotasInc(k, rotas)]));
    $('lRitmo').textContent = 'Itens em 100%';
    $('nRitmo').textContent = `${st.nOk} / ${st.n}`;
    $('nRitmo').className = 'n ' + (st.n ? (st.nOk===st.n?'ok':'no') : '');
    $('xRitmo').textContent = !st.n ? 'sem meta' : st.nOk===st.n ? 'todos em 100%' : 'abaixo de 100%';
    linhaStatus(st);
    $('puxa').innerHTML = '';
    $('lista').innerHTML = itensInc().map(k=>cardIncItem(k, rotas)).join('');
    document.querySelectorAll('.ind[data-k]').forEach(el=>clicavel(el, ()=>abreIncentivo(el.dataset.k)));
  } else {
    const disp = P.COV_GRUPO[aba].filter(k=>ind[k] && !ind[k].unavailable);
    const noRitmo = disp.filter(k=>ind[k].onPace).length;
    const ritmoOk = noRitmo*2>=disp.length;
    $('lRitmo').textContent = 'Ritmo de coberturas';
    $('nRitmo').textContent = `${noRitmo} / ${disp.length}`;
    $('nRitmo').className = 'n ' + (disp.length ? (ritmoOk?'ok':'no') : '');
    $('xRitmo').textContent = ritmoOk? 'dentro do ritmo' : 'abaixo do ritmo';
    // linha "Status" só em Novos Negócios (ICS GC e Volume sem ela)
    linhaStatus(aba==='NOVOS_NEG' ? itensEm100(P.COV_GRUPO[aba].map(k=>[k, rotas])) : null);

    $('puxa').innerHTML = piorSv();

    // Imperdoáveis ainda não tem fonte: o card "indisponível" fica oculto até o dado existir;
    // a Venda Zero não vale para a Neutraliza: sem card quando o filtro só tem rotas Neutraliza
    const soNeutra = rotas.length>0 && rotas.every(ehNeutraliza);
    const oculta = k => (k==='IMPERDOAVEIS' && (!ind[k] || ind[k].unavailable)) || (k==='VENDAZERO' && soNeutra);
    // volume extra (Del Valle Frut): card só na aba Volume e só quando as rotas do filtro trazem o dado
    const extras = (aba==='VOLUME' && sel.modo!=='dir') ? volExtras().filter(k=>ind[k] && !ind[k].unavailable) : [];
    $('lista').innerHTML = [...GROUPS[aba].filter(k=>!oculta(k)), ...extras].map(k=>linha(k, ind[k], rotas)).join('');
    document.querySelectorAll('.ind[data-k]').forEach(el=>clicavel(el, ()=>abreIndicador(el.dataset.k)));
  }
  encaixa($('lista'));
  encaixa(document.querySelector('.cards'));
  const upd = (ONLINE && ONLINE.updatedAt) ? ONLINE.updatedAt.replace('T',' ').slice(0,16).split(' ') : null;
  $('rodape').innerHTML =
    `${visiveis.length} rota${visiveis.length>1?'s':''} · ${esc(P.MES_LABEL)} · ${P.TOTAL_DIAS_UTEIS} dias úteis<br>`+
    (tot.compraram!=null? `${tot.compraram.toLocaleString('pt-BR')} de ${tot.baseTotal.toLocaleString('pt-BR')} clientes já compraram no mês<br>`:'')+
    `<span id="rodapeStatus">${esc((statusAtualizado()||{}).texto || 'sem dados de venda online neste export')}</span>`+
    (upd? `<br><span class="fonte">Fonte: SAP Datasphere · ${upd[0].split('-').reverse().join('/')} ${upd[1]}</span>`:'')+
    `<div class="creditos">${esc(CONFIG.CREDITOS)}</div>`;
  document.querySelector('.rsBox').hidden = perfil==='rota';     // perfil Rota: sem Resumo de vendas nem Painel de Ritmo
  RS.pinta();
  RT.estado();                     // botão "Painel de ritmo": desabilitado no fechamento do mês
}

function piorSv(){
  if(sel.rota) return '';
  const grupo = P.COV_GRUPO[aba];
  if(sel.modo==='dir' && !sel.dgc){
    // Diretoria com todas as gerências: compara as gerências
    const gcs = gcsComDados();
    if(gcs.length < 2) return '';
    let pior=null;
    gcs.forEach(g=>{
      const a = agrega(rotasDe(g,'')).ind;
      const disp = grupo.filter(k=>a[k] && !a[k].unavailable);
      if(!disp.length) return;
      const ok = disp.filter(k=>a[k].onPace).length;
      if(!pior || ok/disp.length < pior.razao) pior={rotulo:rotuloGc(g),ok,tot:disp.length,razao:ok/disp.length};
    });
    if(!pior || pior.ok===pior.tot) return '';
    return `<div class="puxa"><div class="t">Gerência que mais puxa a média para baixo: <b>${esc(pior.rotulo)}</b></div>
      <div class="s">${pior.ok} de ${pior.tot} indicadores na meta</div></div>`;
  }
  // Gerência (ou a gerência escolhida no filtro da Diretoria, sem supervisão)
  const gc = sel.modo==='dir' ? sel.dgc : sel.gc, sv = sel.modo==='dir' ? '' : sel.sv;
  if(!sv){
    // sem SV selecionado: compara as supervisões da gerência (só as rotas normais de cada uma; a Neutraliza fica fora)
    const svs = svsVisiveis(gc);
    if(svs.length < 2) return '';
    let pior=null;
    svs.forEach(s=>{
      if(svExcluido(s)) return;
      const a = agrega(rotasNormais(gc, s)).ind;
      const disp = grupo.filter(k=>a[k] && !a[k].unavailable);
      if(!disp.length) return;
      const ok = disp.filter(k=>a[k].onPace).length;
      if(!pior || ok/disp.length < pior.razao) pior={rotulo:rotuloSv(s),ok,tot:disp.length,razao:ok/disp.length};
    });
    if(!pior || pior.ok===pior.tot) return '';
    return `<div class="puxa"><div class="t">Supervisão que mais puxa a média para baixo: <b>${esc(pior.rotulo)}</b></div>
      <div class="s">${pior.ok} de ${pior.tot} indicadores na meta</div></div>`;
  }
  // SV selecionado, sem rota: compara as rotas dentro do SV (a Neutraliza não entra na comparação)
  if(sv===SV_NEUTRA) return '';
  const rotas = rotasNormais(gc, sv);
  if(rotas.length < 2) return '';
  let pior=null;
  rotas.forEach(r=>{
    const a = agrega([r]).ind;
    const disp = grupo.filter(k=>a[k] && !a[k].unavailable);
    if(!disp.length) return;
    const ok = disp.filter(k=>a[k].onPace).length;
    if(!pior || ok/disp.length < pior.razao) pior={rotulo:'Rota '+r,ok,tot:disp.length,razao:ok/disp.length};
  });
  if(!pior || pior.ok===pior.tot) return '';
  return `<div class="puxa"><div class="t">Rota que mais puxa a média para baixo: <b>${esc(pior.rotulo)}</b></div>
    <div class="s">${pior.ok} de ${pior.tot} indicadores na meta</div></div>`;
}

function linha(k, b, rotas){
  const nome = esc(rotuloInd(k));
  if(!b || b.unavailable)
    return `<div class="ind off"><div class="tit">${nome}</div>
      <div class="semdado">indisponível — falta a fonte deste indicador</div></div>`;
  const bom = b.onPace;
  const ini = `<div class="ind ${ehVolume(k)?'vol ':''}${bom?'ok':''}" data-k="${esc(k)}" role="button" tabindex="0">`;
  if(k==='VENDAZERO'){
    const dif = b.real - b.meta;                 // positivo = mais equip. zerado que a meta = ruim
    const oportHoje = rotas.reduce((a,r)=>a+((OPORTUNIDADE_HOJE||{})[r]||0),0);
    return `${ini}
      <div class="tit">${nome}</div>
      <div class="row">
        <div class="cl">
          <div>Meta ${b.meta.toLocaleString('pt-BR',{maximumFractionDigits:1})}</div>
          <div>Real ${b.real.toLocaleString('pt-BR')}</div>
          <div class="dif ${dif<=0?'pos':'neg'}">Diferença ${dif>0?'+':''}${dif.toLocaleString('pt-BR',{maximumFractionDigits:1})}</div>
        </div>
        <div class="cm">
          <div class="big" data-fit="" data-fit-min="18"><span class="seta">${bom?'▲':'▼'}</span>${oportHoje}</div>
          <div class="acao">${bom? 'no ritmo' : 'para reverter'}</div>
          <div class="opo">oportunidades do dia</div>
        </div>
        <div class="cr"><div class="olab">Online</div>${caixaOnline(k, rotas, b)}</div>
      </div></div>`;
  }
  if(ehVolume(k)){
    if(rotas.length===1 && b.semDadoHoje){
      return `<div class="ind off"><div class="tit">${nome}</div>
        <div class="semdado">indisponível — sem venda hoje pra essa rota</div></div>`;
    }
    const dif = b.real - b.meta;
    // fechamento do mês: % realizado no lugar da tendência (que não existe com o mês fechado)
    const fech = !!P.FECHAMENTO, big = fech ? b.pctReal : b.pctTendencia;
    return `${ini}
      <div class="tit">${nome}</div>
      <div class="row">
        <div class="cl">
          <div>Meta ${Math.round(b.meta).toLocaleString('pt-BR')}</div>
          <div>Real ${Math.round(b.real).toLocaleString('pt-BR')}</div>
          <div class="dif ${dif>=0?'pos':'neg'}">Diferença ${dif>0?'+':''}${Math.round(dif).toLocaleString('pt-BR')}</div>
        </div>
        <div class="cm">
          <div class="big" data-fit="" data-fit-min="18"><span class="seta">${bom?'▲':'▼'}</span>${big==null?'—':big+'%'}</div>
          <div class="acao">${fech ? (bom?'meta batida':'abaixo da meta') : (bom? 'no ritmo' : 'abaixo da tendência')}</div>
          <div class="opo">${fech ? 'realizado no mês' : `${b.pctReal==null?0:b.pctReal}% real`}</div>
        </div>
        <div class="cr"><div class="olab">Online</div>${caixaOnline(k, rotas, b)}</div>
      </div></div>`;
  }
  const dif = b.real - b.meta;
  const opo = rotas.reduce((a,r)=>a+((OPORTUNIDADES_DIA[r]||{})[k]||0),0);
  return `${ini}
    <div class="tit">${nome}</div>
    <div class="row">
      <div class="cl">
        <div>Meta ${b.meta.toLocaleString('pt-BR')}</div>
        <div>Real ${b.real.toLocaleString('pt-BR')}</div>
        <div class="dif ${dif>=0?'pos':'neg'}">Diferença ${dif>0?'+':''}${dif.toLocaleString('pt-BR')}</div>
      </div>
      <div class="cm">
        <div class="big" data-fit="" data-fit-min="18"><span class="seta">${bom?'▲':'▼'}</span>${b.pct==null?'—':b.pct+'%'}</div>
        <div class="acao ${b.gap>0?'falta':''}">${b.gap>0? `faltam ${b.gap} hoje` : 'no ritmo'}</div>
        ${opo? `<div class="opo">oportunidades do dia ${opo}</div>`:''}
      </div>
      <div class="cr"><div class="olab">Online</div>${caixaOnline(k, rotas, b)}</div>
    </div></div>`;
}

// número grande da caixa Online: parte do --fs-online do card e encaixa() ajusta à largura real da caixa
const numObox = txt => `<b data-fit="" data-fit-min="10">${txt}</b>`;
/* Volume: meta do dia do nível (já somada) <= 0 = "Meta batida!" e caixa do Online verde. Só o rótulo e a cor: o
   número do online e todos os valores seguem iguais. Resíduo de soma de decimais (ex.: 1e-14) conta como zero. */
const META_BATIDA = 'Meta batida!';
const metaBatida = md => md!=null && md <= 1e-9;
/* Coberturas (ICS GC e Novos Negócios; a Venda Zero não): "Meta batida!" e caixa do Online verde quando a meta do mês
   do nível (já somada) foi alcançada, Real >= Meta com Meta > 0 (daí em diante não falta nada no dia). Só o rótulo e a
   cor; fora do fechamento (como no volume, o fechamento fica como antes). */
const coberturaBatida = b => !P.FECHAMENTO && b.meta > 0 && b.real >= b.meta;

function caixaOnline(k, rotas, b){
  if(k==='VENDAZERO'){
    // sempre verde: é contagem positiva de reversões, não tem meta pra comparar
    const revHoje = rotas.reduce((a,r)=>a+((REVERTIDO_HOJE||{})[r]||0),0);
    return `<div class="obox ok">${numObox(revHoje)}<span>revertidos</span></div>`;
  }
  if(ehVolume(k)){
    const volHoje = rotas.reduce((a,r)=>a+(((ONLINE&&ONLINE.volume||{})[r]||{})[k]||0),0);
    if(b.metaDia==null)   // fechamento do mês (online de hoje, sem meta do dia) ou META_RECUPERAVEL_ROTA ausente
      return `<div class="obox nd">${numObox(Math.round(volHoje).toLocaleString('pt-BR'))}
        <span>${P.FECHAMENTO?'online hoje':'meta do dia —'}</span></div>`;
    const metaDia = b.metaDia, batida = metaBatida(metaDia);
    const ok = batida || volHoje >= metaDia;
    return `<div class="obox ${ok?'ok':'no'}">${numObox(Math.round(volHoje).toLocaleString('pt-BR'))}
      <span>${batida ? META_BATIDA : 'meta do dia '+Math.round(metaDia).toLocaleString('pt-BR')}</span></div>`;
  }
  // Meta do dia: fora do ritmo é o próprio "faltam X"; no ritmo é teto(Meta / dias úteis) (NUCLEO.metaDiaCobertura).
  const metaDia = NUCLEO.metaDiaCobertura(b, P.TOTAL_DIAS_UTEIS);
  const batida = coberturaBatida(b);
  if(!ONLINE)
    return `<div class="obox ${batida?'ok':'nd'}"><b>—</b><span>${batida ? META_BATIDA : `meta do dia ${metaDia}`}</span></div>`;
  const soma = rotas.reduce((a,r)=>a+(((ONLINE.rotas||{})[r]||{})[k]||0),0);
  const ok = batida || soma>=metaDia;
  return `<div class="obox ${ok?'ok':''}">${numObox(soma)}
    <span>${batida ? META_BATIDA : ok?'no ritmo':`meta do dia ${metaDia}`}</span></div>`;
}

/* ---------- drawer ---------- */
let _focoAntes = null;
function abre(tit, sub, html){
  _focoAntes = document.activeElement;
  $('dTit').textContent=tit; $('dSub').textContent=sub; $('dCorpo').innerHTML=html;
  $('back').classList.add('on'); $('drw').classList.add('on');
  document.body.classList.add('drw-aberto');
  $('dX').focus({preventScroll:true});
}
function fecha(){
  if(!$('drw').classList.contains('on')) return;
  $('back').classList.remove('on'); $('drw').classList.remove('on');
  document.body.classList.remove('drw-aberto');
  if(_focoAntes && _focoAntes.focus) _focoAntes.focus({preventScroll:true});
}
$('back').onclick=fecha; $('dX').onclick=fecha;
document.addEventListener('keydown',e=>{if(e.key==='Escape')fecha()});

const DIAS_CHIP=['Hoje','Seg','Ter','Qua','Qui','Sex','Todos'];
const chipsHtml = chip => `<div class="chips" role="group" aria-label="Dia de visita">${DIAS_CHIP.map(d=>
  `<button class="dchip ${d===chip?'on':''}" data-d="${d}" aria-pressed="${d===chip}">${d}</button>`).join('')}</div>`;
function listaClientes(rotas, filtro){
  const out=[];
  rotas.forEach(r=>(CLIENTES_HOJE[r]||[]).forEach(c=>{ if(!filtro||filtro(c)) out.push([r,c]); }));
  return out.sort((a,b)=>a[1][1].localeCompare(b[1][1]));
}
function onlineIds(r, k){
  return ((ONLINE && ONLINE.clientes || {})[r] || {})[k || 'QUALQUER'] || [];
}
function itemHtml(r,c,extra,online){
  return `<div class="item ${online?'riscado':''}"><div><div class="nm">${esc(c[1])}${online?' <span class="tagOnline">Venda Online</span>':''}</div>
    <div class="sb">${esc(SEGS[c[2]]||'—')} · rota ${esc(r)} · ${esc(DIAS[c[3]]||'sem agenda')}</div></div>
    <div class="bd">${extra||('PV '+esc(c[0]))}</div></div>`;
}

clicavel($('cBase'), ()=>{
  const rotas = rotasListas();
  const l = listaClientes(rotas);
  abre('Visitas de hoje', `${l.length} clientes · ${P.DIA_SEMANA}, semana N°${P.SEMANA_NUM} (${P.SEMANA_TIPO})`,
    l.length? l.map(([r,c])=>itemHtml(r,c,null,onlineIds(r).includes(c[0]))).join('') : `<div class="vazio">Nenhuma visita agendada.</div>`);
});
clicavel($('cSem'), ()=>{
  const rotas = rotasListas();
  if(!P.FONTES.venda){
    abre('Sem compra hoje','',
      `<div class="vazio">Depende da planilha de venda do dia.</div>`); return;
  }
  const out=[];
  rotas.forEach(r=>{
    const ids=new Set(SEM_COMPRA_HOJE[r]||[]);
    (CLIENTES_HOJE[r]||[]).forEach(c=>{if(ids.has(c[0])) out.push([r,c]);});
  });
  out.sort((a,b)=>a[1][1].localeCompare(b[1][1]));
  const vis = rotas.reduce((a,r)=>a+(VISITAS_DIA.geral[r]||0),0);
  abre('Sem compra hoje', `${out.length} de ${vis} clientes agendados · nenhum faturamento no mês`,
    out.length? out.map(([r,c])=>itemHtml(r,c,null,onlineIds(r).includes(c[0]))).join('') : `<div class="vazio">Todo mundo já comprou.</div>`);
});

/* ---------- cascata (gaveta dos cards) ----------
   Uma função para todos os níveis: [gerências ->] supervisões -> rotas -> clientes. O primeiro nível depende do
   filtro: Diretoria = gerências; gerência = supervisões; supervisão = rotas; rota = clientes. Cada linha usa
   agrega() das rotas do grupo, o mesmo número dos cards (nada de tendência recalculada aqui). Nas supervisões
   de uma gerência, a última linha é "Neutraliza" (as rotas Neutraliza juntas; dentro, as rotas e os clientes;
   fora da Venda Zero). As virtuais não têm linha, mas estão no total da gerência: uma nota discreta no fim das
   supervisões mostra só a Meta e o Real delas (sem rotas nem clientes), e linhas + nota = card.
   Ordem fixa, pelo código (não pelos números, também no fechamento): gerências na ordem de GC_NOMES/GC_ATIVAS;
   supervisões e rotas em ordem natural (ordemNatural), com a "Neutraliza" sempre por último. Clientes: volume
   pela Dif. Abs (mais negativo primeiro); cobertura e Venda Zero como antes. */
const VOLTAR = {gc:'← Gerências', sv:'← Supervisões', rota:'← Rotas'};
let CASC = null;     // {k, pilha:[{nivel, chave, gc, rotas, nome}]}

// primeiro nível da cascata pelo filtro: Diretoria = gerências; gerência = supervisões; supervisão = rotas; rota = clientes
function ctxInicial(){
  if(sel.modo==='dir' && !sel.dgc) return {nivel:'gc', chave:'', rotas:rotasAtuais(), nome:'Diretoria'};
  if(sel.modo==='dir') return ctxGerencia(sel.dgc);     // uma gerência no filtro: como na Gerência
  if(sel.rota) return {nivel:'cli', chave:sel.rota, gc:sel.gc, rotas:[sel.rota], nome:'Rota '+sel.rota};
  if(sel.sv===SV_NEUTRA) return ctxNeutraliza(sel.gc);
  if(sel.sv) return {nivel:'rota', chave:sel.sv, gc:sel.gc, rotas:rotasNormais(sel.gc, sel.sv), nome:rotuloSv(sel.sv)};
  return ctxGerencia(sel.gc);
}

function abreIndicador(k){
  const b = agrega(rotasAtuais()).ind[k];
  if(!b || b.unavailable) return;
  CASC = {k, pilha:[ctxInicial()]};
  abre('', '', '');
  pintaCascata();
}

const nRotas = rs => `${rs.length} rota${rs.length>1?'s':''}`;
// nível das supervisões de uma gerência (cards da Gerência ou linha de gerência da Diretoria)
const ctxGerencia = gc => ({nivel:'sv', chave:gc, gc, rotas:rotasDe(gc,''), nome:rotuloGc(gc)});
// nível das rotas Neutraliza de uma gerência (linha "Neutraliza" da cascata ou filtro de supervisão "Neutraliza")
// (num grupo, uma linha só com as Neutraliza das duas gerências)
const ctxNeutraliza = gc => ({nivel:'rota', chave:SV_NEUTRA, gc, rotas:rotasNeutraliza(gc),
  nome:`${SV_NEUTRA} · ${membrosGc(gc).join(' + ')}`});

// grupos do nível (cada um com as rotas que somam e o contexto do nível de baixo)
function gruposDo(ctx, k){
  if(ctx.nivel==='gc') return todasGcs().map(g=>{
    const rs = rotasDe(g,'');
    return {nome:rotuloGc(g), rotas:rs, off:!DATA[g],
      info: DATA[g] ? `${svsVisiveis(g).length} supervisões · ${rs.filter(r=>!ehVirtual(r)).length} rotas` : 'sem dados',
      filho:ctxGerencia(g)};
  });
  if(ctx.nivel==='sv'){
    const grupos = svsEmOrdem(ctx.gc).map(s=>{
      const rs = rotasNormais(ctx.gc, s);
      return {nome:rotuloSv(s), rotas:rs, info:nRotas(rs), filho:{nivel:'rota', chave:s, gc:ctx.gc, rotas:rs, nome:rotuloSv(s)}};
    });
    // "Neutraliza": as rotas Neutraliza da gerência numa linha só, sempre a última (fora da Venda Zero)
    const n = ctxNeutraliza(ctx.gc);
    if(n.rotas.length && k!=='VENDAZERO') grupos.push({nome:SV_NEUTRA, rotas:n.rotas, info:nRotas(n.rotas), fim:true, filho:n});
    return grupos;
  }
  return ctx.rotas.filter(r=>!ehVirtual(r)).sort(ordemNatural).map(r=>{
    const d = nodo(ctx.gc, r);
    return {nome:'Rota '+r, rotas:[r], info:`${titulo(d.consultor)} · ${d.baseTotal} clientes`,
      filho:{nivel:'cli', chave:r, gc:ctx.gc, rotas:[r], nome:'Rota '+r}};
  });
}

// rotas virtuais da gerência: sem linha, rota ou cliente; só a Meta e o Real, para a conta das linhas fechar com o card.
// Os clientes em rotas EV* (rota oculta, sem meta) têm nota própria, só com o Real.
function notaVirtuais(k, gc, inc){
  const f = ehVolume(k) ? fmt0 : fmtN;
  const nota = (rs, texto) => {
    const b = rs.length ? agrega(rs).ind[k] : null;
    if(!b || b.unavailable) return '';
    return `<div class="cNota" data-meta="${b.meta}" data-real="${b.real}">${texto(b)}</div>`;
  };
  const todas = rotasDe(gc, '').filter(r=>ehVirtual(r) && (!inc || temMetaInc(k, r)));
  return nota(todas.filter(r=>!ehEventual(r)), b => `Inclui rotas virtuais: Meta ${f(b.meta)} · Real ${f(b.real)}`)
    + nota(todas.filter(ehEventual), b => `Inclui clientes de rotas eventuais (EV*): Real ${f(b.real)}`);
}

// números de uma linha: os mesmos de agrega()/caixaOnline() do card
function metricas(k, rotas){
  const b = agrega(rotas).ind[k];
  if(!b || b.unavailable) return null;
  const fech = !!P.FECHAMENTO, soma = (obj, r) => (((ONLINE && ONLINE[obj]) || {})[r] || {})[k] || 0;
  if(k==='VENDAZERO') return {b, onl:b.revertidoHoje, md:null, dir:b.pct};
  if(ehVolume(k)) return {b, onl:rotas.reduce((a,r)=>a+soma('volume', r),0), md:fech ? null : b.metaDia,
                          dir:fech ? b.pctReal : b.pctTendencia};
  return {b, onl:rotas.reduce((a,r)=>a+soma('rotas', r),0), md:fech ? null : NUCLEO.metaDiaCobertura(b, P.TOTAL_DIAS_UTEIS), dir:b.pct};
}

function linhaGrupo(g, m, k, i){
  if(!m) return `<div class="cLin off"><div class="cNome"><b>${esc(g.nome)}</b><small>${esc(g.info)}</small></div>
    <div class="cInd">${g.off ? 'sem dados' : 'indisponível'}</div></div>`;
  const {b, onl, md, dir} = m, vz = k==='VENDAZERO', f = ehVolume(k) ? fmt0 : fmtN;
  // volume: meta do dia da linha <= 0; cobertura: Real >= Meta do mês (fora do fechamento); Venda Zero não
  const batida = !vz && (ehVolume(k) ? metaBatida(md) : md!=null && coberturaBatida(b));
  const cor = vz ? 'ok' : (md==null ? 'nd' : (batida || onl>=md ? 'ok' : 'no'));
  const meio = vz ? `<span class="cOn ok">${fmtN(onl)}</span><small>revertidos hoje</small>`
    : `<span class="cOn ${cor}">${f(onl)}</span><small>${md==null ? (P.FECHAMENTO ? 'online hoje' : 'meta do dia —')
                                                        : batida ? META_BATIDA : 'meta do dia '+f(md)}</small>`;
  const rot = ehVolume(k) ? (P.FECHAMENTO ? 'realizado' : 'tendência') : 'do mês';
  return `<div class="cLin ${b.onPace?'ok':'no'}" role="button" tabindex="0" data-i="${i}"
      data-meta="${b.meta}" data-real="${b.real}" data-dir="${dir==null?'':dir}">
    <div class="cNome"><b>${esc(g.nome)}</b><small>${esc(g.info)}</small></div>
    <div class="cEsq"><span>Meta ${f(b.meta)}</span><span>Real ${f(b.real)}</span></div>
    <div class="cMeio">${meio}</div>
    <div class="cDir"><b>${dir==null?'—':dir+'%'}</b><small>${rot}</small></div></div>`;
}

// subtítulo da gaveta (número do card do nível)
function resumoInd(k, b){
  if(!b || b.unavailable) return 'indisponível';
  if(k==='VENDAZERO') return `${fmtN(b.real)} equipamentos zerados · ${b.gap>0? `${b.gap} para reverter` : 'no ritmo'}`+
    ` · ${b.revertidoHoje} revertidos hoje`;
  if(ehVolume(k)) return `Meta ${fmt0(b.meta)} · Real ${fmt0(b.real)} · `+
    (P.FECHAMENTO ? `${b.pctReal==null?'—':b.pctReal+'%'} realizado` : `tendência ${b.pctTendencia==null?'—':b.pctTendencia+'%'}`);
  const nota = (k==='KS TT') ? ' · lista restrita a bares, lanchonetes, restaurantes e padarias' : '';
  return `Meta ${fmtN(b.meta)} · Real ${fmtN(b.real)} · ${b.gap>0?`faltam ${b.gap} para o ritmo de hoje`:'no ritmo'}${nota}`;
}

function pintaCascata(){
  const {k, pilha, inc} = CASC, ctx = pilha[pilha.length-1];
  // aba Todos a Bordo (inc): os números são os do ICS GC, só com as rotas com meta do item
  const doItem = rotas => inc ? rotasInc(k, rotas) : rotas;
  $('dTit').textContent = `${rotuloInd(k)} · ${ctx.nome}`;
  $('dSub').textContent = resumoInd(k, agrega(doItem(ctx.rotas)).ind[k]);
  const volta = pilha.length>1 ? `<button class="cVolta" id="cVolta">${VOLTAR[pilha[pilha.length-2].nivel]}</button>` : '';
  if(ctx.nivel==='cli'){
    $('dCorpo').innerHTML = volta + '<div id="dLista"></div>';
    // listas de clientes: sem virtuais e sem ocultas (na AT, tudo); no Todos a Bordo, só as rotas com meta do item
    const rotas = ctx.rotas.filter(r=>!ehVirtual(r) && !ehOculta(rotaSv(ctx.gc, r)) && (!inc || temMetaInc(k, r)));
    if(ehVolume(k)) listaVolume(k, rotas);
    else if(k==='VENDAZERO') listaVendaZero(rotas);
    else listaCobertura(k, rotas);
  } else {
    // na ordem de gruposDo (pelo código; a "Neutraliza" por último), sem reordenar pelos números. No Todos a Bordo,
    // só os grupos com rota com meta do item
    let gs = gruposDo(ctx, k);
    if(inc) gs = gs.filter(g=>!g.off && rotasInc(k, g.rotas).length).map(g=>{
      // escopo misto: quantas rotas do grupo têm meta (só elas somam)
      const vis = g.rotas.filter(r=>!ehVirtual(r)), n = rotasInc(k, vis).length;
      return {...g, info: vis.length>1 && n<vis.length ? `${g.info} · ${n} com meta` : g.info};
    });
    const grupos = gs.map(g=>({g, m: g.off ? null : metricas(k, doItem(g.rotas))}));
    const nota = ctx.nivel!=='sv' ? '' : notaVirtuais(k, ctx.gc, inc);
    $('dCorpo').innerHTML = volta + `<div class="cLista">${grupos.map((x,i)=>linhaGrupo(x.g, x.m, k, i)).join('')
      || '<div class="vazio">Nada neste filtro.</div>'}${nota}</div>`;
    $('dCorpo').querySelectorAll('.cLin[data-i]').forEach(el=>clicavel(el, ()=>{
      pilha.push(grupos[Number(el.dataset.i)].g.filho); pintaCascata();
    }));
  }
  if($('cVolta')) $('cVolta').onclick = () => { pilha.pop(); pintaCascata(); };
  $('dCorpo').scrollTop = 0;
}

/* Clientes de volume: Meta (META_NEG do cliente), Real (faturado + online de hoje, fora do fechamento),
   Dif. Abs (Real - Meta) e %, do mais negativo para o mais positivo; sem tendência; sem quem não tem meta. */
function listaVolume(k, rotas){
  const LIM = CONFIG.LIMITE_LISTA, lin = [];
  rotas.forEach(r=>{
    const i = volDaRota(r).indexOf(k);
    if(i<0) return;
    (CLIENT_ROSTER[r]||[]).forEach(c=>{
      const bl = blocoVolCliente(r, c[0], i, k);
      if(bl) lin.push({r, c, meta:bl[0], real:bl[1], dif:bl[1]-bl[0], pct:bl[2]});
    });
  });
  lin.sort((a,b)=>a.dif-b.dif);
  const fmt1 = n => n.toLocaleString('pt-BR', {minimumFractionDigits:1, maximumFractionDigits:1});
  $('dLista').innerHTML = lin.length ? `<div class="cCab"><span>Cliente</span><span>Meta</span><span>Real</span>
      <span>Dif. Abs</span><span>%</span></div>` +
    lin.slice(0, LIM).map(x=>`<div class="cCli" data-dif="${x.dif}"><div><div class="nm">${esc(x.c[1])}</div>
      <div class="sb">${esc(SEGS[x.c[2]]||'—')} · rota ${esc(x.r)}</div></div>
      <span>${fmt1(x.meta)}</span><span>${fmt1(x.real)}</span>
      <span class="${x.dif>=0?'pos':'neg'}">${x.dif>0?'+':''}${fmt1(x.dif)}</span><span>${x.pct}%</span></div>`).join('') +
    (lin.length>LIM ? `<div class="vazio">+ ${lin.length-LIM} clientes — filtre por rota para ver todos.</div>` : '')
    : '<div class="vazio">Nenhum cliente com meta neste agrupador.</div>';
}

function listaVendaZero(rotas){
  const LIM = CONFIG.LIMITE_LISTA, equip = [];
  rotas.forEach(r=>(VENDAZERO_CLIENTES[r]||[]).forEach(e=>equip.push([r,e])));
  let chip='Todos';
  const pinta=()=>{
    const vis = equip.filter(([r,e])=> chip==='Todos' ||
      (chip==='Hoje' ? e.hoje===1 : (e.dia||'').startsWith(chip)))
      .sort((a,b)=>b[1].vdz-a[1].vdz);
    $('dLista').innerHTML = chipsHtml(chip) +
      (vis.length? vis.slice(0,LIM).map(([r,e])=>`<div class="item ${e.revertido?'riscado':''}"><div>
          <div class="nm">${esc(e.nome)}${e.revertido?' <span class="tagOnline">Revertido</span>':''}</div>
          <div class="sb">${esc(e.tipo)} · rota ${esc(r)} · ${esc(e.dia||'sem agenda')}</div></div>
          <div class="bd">${e.vdz} geladeira${e.vdz>1?'s':''}</div></div>`).join('')
               : `<div class="vazio">Ninguém neste filtro.</div>`) +
      (vis.length>LIM? `<div class="vazio">+ ${vis.length-LIM} equipamentos — filtre por rota para ver todos.</div>`:'');
    $('dLista').querySelectorAll('.dchip').forEach(el=>el.onclick=()=>{chip=el.dataset.d;pinta();});
  };
  pinta();
}

// cobertura: quem ainda falta comprar o indicador (KS TT só nos segmentos elegíveis)
function listaCobertura(k, rotas){
  const LIM = CONFIG.LIMITE_LISTA, todos = [];
  rotas.forEach(r => {
    const ja = new Set(((COBERTOS[r]||{})[k])||[]);
    (CLIENT_ROSTER[r]||[]).forEach(c=>{
      if(k==='KS TT' && !ehKstt(c)) return;
      if(P.FONTES.venda && ja.has(c[0])) return;      // já comprou este indicador
      todos.push([r,c]);
    });
  });
  let chip = 'Hoje';
  const pinta = () => {
    const vis = todos.filter(([r,c]) => {
      if(chip==='Todos') return true;
      if(chip==='Hoje') return c[4]===1;          // respeita a paridade da semana
      return (DIAS[c[3]]||'').includes(chip);
    }).sort((a,b)=>a[1][1].localeCompare(b[1][1]));
    $('dLista').innerHTML = chipsHtml(chip) +
      (vis.length? vis.slice(0,LIM).map(([r,c])=>itemHtml(r,c,null,onlineIds(r,k).includes(c[0]))).join('')
                 : `<div class="vazio">Ninguém neste filtro.</div>`) +
      (vis.length>LIM? `<div class="vazio">+ ${vis.length-LIM} clientes — filtre por rota para ver todos.</div>`:'');
    $('dLista').querySelectorAll('.dchip').forEach(el=>el.onclick=()=>{chip=el.dataset.d;pinta();});
  };
  pinta();
}

/* ---------- aba Todos a Bordo (chave INCENTIVO): campanha "Todos a Bordo 3.0" (cobertura de cervejas) ----------
   Itens = GROUPS.INCENTIVO do payload, na ordem da aba (CERVEJAS e CERVEJAS 600ML RETORNAVEL são os do ICS; INC
   HEINEKEN, INC EISENBAHN 600ML e INC HEINEKEN 600ML só existem aqui). Cada item soma só as rotas do escopo com meta do
   item (indicador disponível e meta > 0; as BARRACUDA não têm meta de Heineken); as demais ficam fora de todas as somas
   e listas dele. Card, números e cascata são os do ICS GC (linha(), agrega(), metricas(), listaCobertura()): Meta, Real,
   Diferença, % = Real / Meta com a régua do ritmo, oportunidades do dia e a caixa do Online.
   Escopo sem meta do item: "Exclusivo portfólio Full" (Heineken e Heineken - 600ml) ou "Sem meta".
   CONFIG.INCENTIVO_ATIVO = false ou payload sem GROUPS.INCENTIVO: aba oculta. */
const INC_SO_FULL = ['INC HEINEKEN', 'INC HEINEKEN 600ML'];
const incentivoAtivo = () => CONFIG.INCENTIVO_ATIVO !== false && !!(GROUPS && GROUPS.INCENTIVO);
const itensInc = () => (GROUPS && GROUPS.INCENTIVO) || [];
const msgSemMetaInc = k => INC_SO_FULL.includes(k) ? 'Exclusivo portfólio Full' : 'Sem meta';
// rota com meta do item: indicador disponível e meta > 0
function temMetaInc(k, r){
  const b = ((nodo(sel.gc, r) || {}).indicators || {})[k];
  return !!b && !b.unavailable && b.meta > 0;
}
const rotasInc = (k, rotas) => rotas.filter(r=>temMetaInc(k, r));

// card do item: o mesmo do ICS GC, só com as rotas com meta dele
function cardIncItem(k, rotas){
  const rs = rotasInc(k, rotas);
  if(!rs.length) return `<div class="ind off" data-inc-off="${esc(k)}"><div class="tit">${esc(rotuloInd(k))}</div>
    <div class="semdado">${msgSemMetaInc(k)}</div></div>`;
  return linha(k, agrega(rs).ind[k], rs);
}
// cascata do item: a do ICS GC (primeiro nível pelo filtro), só com as rotas com meta dele
function abreIncentivo(k){
  if(!rotasInc(k, rotasAtuais()).length) return;
  CASC = {k, inc:true, pilha:[ctxInicial()]};
  abre('', '', '');
  pintaCascata();
}

/* Linha "Status" do card do topo (abas Todos a Bordo e Novos Negócios): "-" até todos os itens com meta no escopo
   estarem em 100%, então "✓" verde. Item em 100%: Real >= Meta (clientes distintos do mês, como o % do ICS); com
   CONFIG.STATUS_INCLUI_ONLINE, clientes distintos no Real ou no online de hoje >= Meta (fora do fechamento, em que o
   online já é do mês novo). Sem item com meta no escopo: sem a linha. */
// clientes distintos no Real (COBERTOS) ou no online de hoje: quem já está no Real e comprou hoje conta uma vez
function realMaisOnline(k, rotas){
  return rotas.reduce((a, r)=>{
    const b = (nodo(sel.gc, r) || {indicators:{}}).indicators[k];
    if(!b || b.unavailable) return a;
    const cob = new Set(((COBERTOS[r] || {})[k]) || []);
    const hoje = (((ONLINE && ONLINE.clientes) || {})[r] || {})[k] || [];
    return a + (b.real || 0) + hoje.filter(pv=>!cob.has(pv)).length;
  }, 0);
}
// pares [item, rotas do item] -> {n: itens com meta, nOk: itens em 100%}
function itensEm100(pares){
  const online = CONFIG.STATUS_INCLUI_ONLINE === true && !P.FECHAMENTO;
  let n = 0, nOk = 0;
  pares.forEach(([k, rs])=>{
    const b = rs.length ? agrega(rs).ind[k] : null;
    if(!b || b.unavailable || !(b.meta > 0)) return;
    n++;
    if(b.real >= b.meta || (online && realMaisOnline(k, rs) >= b.meta)) nOk++;
  });
  return {n, nOk};
}
// st = itensEm100() ou null (aba sem a linha)
function linhaStatus(st){
  const el = $('stRitmo'), ok = !!st && st.nOk===st.n;
  el.hidden = !st || !st.n;
  el.dataset.status = el.hidden ? '' : ok ? 'ok' : 'parcial';
  el.innerHTML = el.hidden ? '' : `Status <span class="stMarca ${ok?'ok':''}">${ok ? '✓' : '-'}</span>`;
}

/* ---------- entrada com perfis (Diretoria / Gerência / Supervisão / Rota), por seleção ----------
   Controle de acesso INTERNO: a entrada só organiza o que cada perfil vê, sem usuário nem senha; NÃO é segurança
   (os dados estão em data/*.json). Diretoria entra direto ("Todas as gerências"). Gerência, Supervisão e Rota abrem a
   caixa de seleção com as gerências (cada grupo de CONFIG.GC_GRUPOS numa opção só, "GC.IT + GC.MO"); na Supervisão e
   na Rota, a 2ª etapa lista as supervisões ou as rotas da gerência escolhida (no grupo, das duas). Todos abrem a visão
   de hoje: Gerência com a gerência travada (supervisão e rota livres; no grupo, o total das duas e o seletor Total /
   uma delas); Supervisão com gerência e supervisão travadas (só o filtro das rotas dela); Rota com tudo travado (sem
   filtros nem Resumo). O acesso {perfil, gc, sv, rota, dia} fica em localStorage 'drotas_sessao' até a virada do dia
   de trabalho (CONFIG.SESSAO_VIRADA_HORA, horário de Brasília) ou até a casa: recarregar reabre o mesmo perfil e
   contexto (no grupo, no Total); sem armazenamento, a entrada aparece a cada visita. O sol/lua troca só o fundo da
   entrada (preto, padrão, ou branco), guardado à parte em 'drotas_entrada'. */
const TEMA_ENTRADA = 'drotas_entrada', SESSAO = 'drotas_sessao';
const PERFIS = {dir:'Diretoria', gc:'Gerência', sv:'Supervisão', rota:'Rota'};
const MSG_ENTRADA = {
  reiniciado: 'Acesso reiniciado, entre novamente',
  indisponivel: 'O acesso anterior não está mais disponível',
};
let ACESSO = null;        // acesso em uso; null = na entrada (ou no Resumo aberto por link, sem acesso)

function temaEntrada(){
  try { return localStorage.getItem(TEMA_ENTRADA)==='branca' ? 'branca' : 'preta'; } catch(e) { return 'preta'; }
}
function aplicaTemaEntrada(t){
  $('entrada').classList.toggle('branca', t==='branca');
  $('carga').classList.toggle('branca', t==='branca');
  $('aviso').classList.toggle('branca', t==='branca');
  $('btnTema').textContent = t==='branca' ? '☾' : '☀';
  $('btnTema').setAttribute('aria-label', t==='branca' ? 'Entrada com fundo preto' : 'Entrada com fundo branco');
}
$('btnTema').onclick = () => {
  const t = temaEntrada()==='branca' ? 'preta' : 'branca';
  try { localStorage.setItem(TEMA_ENTRADA, t); } catch(e) { /* sem armazenamento: vale só nesta visita */ }
  aplicaTemaEntrada(t);
};

// "dia de trabalho" (AAAA-MM-DD): agora em Brasília menos CONFIG.SESSAO_VIRADA_HORA, sem depender do fuso do aparelho
function diaTrabalho(){
  const m = {};
  new Intl.DateTimeFormat('en-US', {timeZone:'America/Sao_Paulo', year:'numeric', month:'2-digit', day:'2-digit'})
    .formatToParts(new Date(Date.now() - CONFIG.SESSAO_VIRADA_HORA*3600*1000)).forEach(p=>m[p.type]=p.value);
  return `${m.year}-${m.month}-${m.day}`;
}
// acesso guardado: null = nenhum (ou sem armazenamento); ilegível = {} (sem 'dia': tratado como vencido)
function leSessao(){
  let s;
  try { s = localStorage.getItem(SESSAO); } catch(e) { return null; }
  if(s==null) return null;
  try { const v = JSON.parse(s); return (v && typeof v==='object') ? v : {}; } catch(e) { return {}; }
}
function gravaSessao(a){
  try { localStorage.setItem(SESSAO, JSON.stringify({perfil:a.perfil, gc:a.gc, sv:a.sv, rota:a.rota, dia:a.dia})); }
  catch(e) { /* sem armazenamento: o acesso vale só nesta visita */ }
}
function apagaSessao(){ try { localStorage.removeItem(SESSAO); } catch(e) { /* sem armazenamento */ } }

/* Opções de gerência da entrada: as 16 na ordem de GC_NOMES/GC_ATIVAS, cada grupo na posição do seu primeiro membro
   (AN, AP, AT, G1, G2, G3, PA+DI, RV, SL, GU+PO, IT+MO, UR+RI). Sem dados: desabilitada (o grupo, se nenhuma das
   duas tiver). */
function opcoesGc(){
  const grupos = gruposGc(), vistas = new Set(), out = [];
  todasGcs().forEach(g=>{
    if(vistas.has(g)) return;
    const gr = grupos.find(x => x.membros.includes(g)), chave = gr ? gr.chave : g;
    membrosGc(chave).forEach(m => vistas.add(m));
    out.push({chave, rotulo:rotuloGc(chave), ok:temDados(chave)});
  });
  return out;
}
/* Supervisão que aparece no painel (não vale a oculta SV.G3.3 nem a linha "Neutraliza"); rota que aparece no painel
   da gerência (Neutraliza vale; virtual e a das eventuais, '-EV', que são ocultas, não). */
const svNoPainel = (gc, sv) => sv!==SV_NEUTRA && !ehOculta(sv) && svsVisiveis(gc).includes(sv);
const rotaNoPainel = (gc, r) => !ehVirtual(r) && rotasDe(gc, '').includes(r);
// 2ª etapa da caixa, por gerência: supervisões pelo número e rotas em ordem natural (no grupo, uma gerência e depois a outra)
const svsDaEntrada = gc => svsEmOrdem(gc).filter(s => svNoPainel(gc, s));
const rotasDaEntrada = gc => rotasDe(gc, '').filter(r => rotaNoPainel(gc, r)).sort(ordemNatural);
// Gerência: uma opção da 1ª etapa com dados (gerência ou grupo); Supervisão e Rota: também uma gerência do grupo
const opcaoValida = u => opcoesGc().some(o => o.chave===u && o.ok);
const gcValida = u => typeof u==='string' && (ehGrupo(u) || todasGcs().includes(u)) && temDados(u);

/* Confere um acesso com as regras da entrada: o escolhido na caixa ou o guardado (ao reabrir e a cada payload novo).
   Gerência ou grupo com dados; supervisão ou rota que aparece no painel da gerência (no grupo, de uma das duas).
   Devolve o acesso com os códigos do painel (na Supervisão e na Rota, a gerência delas) ou null. */
function validaAcesso(a){
  const perfil = a && a.perfil;
  if(perfil==='dir') return {perfil, gc:'', sv:'', rota:''};
  if(perfil==='gc') return opcaoValida(a.gc) ? {perfil, gc:a.gc, sv:'', rota:''} : null;
  if(!['sv', 'rota'].includes(perfil) || !gcValida(a.gc)) return null;
  const gcs = membrosGc(a.gc).filter(g => DATA[g]);
  if(perfil==='sv'){
    const gc = gcs.find(g => svNoPainel(g, a.sv));
    return gc ? {perfil, gc, sv:a.sv, rota:''} : null;
  }
  const gc = gcs.find(g => rotaNoPainel(g, a.rota));
  return gc ? {perfil, gc, sv:svDaRota(a.rota), rota:a.rota} : null;
}

// abre o painel no perfil e contexto do acesso (demais filtros e a cascata no padrão; no grupo, o Total)
function aplicaAcesso(a){
  ACESSO = a;
  sel = a.perfil==='dir' ? {...sel, modo:'dir', dgc:'', sv:'', rota:''} : {...sel, modo:'gc', gc:a.gc, sv:a.sv, rota:a.rota};
  fecha();
  $('entrada').hidden = true;
  document.body.classList.remove('na-entrada');
  render();
  if($('q').value.trim()) buscaCliente();
}
function mostraEntrada(msg){
  fecha(); RS.fecha();
  fechaCaixa(false);
  $('entMsg').textContent = msg || '';
  $('entrada').hidden = false;
  document.body.classList.add('na-entrada');
}
// casa, virada do dia ou acesso que não vale mais: apaga o acesso guardado e volta para a entrada
function saiDoAcesso(msg){
  ACESSO = null;
  apagaSessao();
  mostraEntrada(msg);
}
/* Ao carregar (depois do payload) e ao fechar o Resumo aberto por link: reabre o acesso guardado ou mostra a entrada.
   Guardado de outro dia de trabalho (ou sem 'dia'): apaga e avisa; que não vale mais no payload: apaga e avisa. */
function entradaOuAcesso(){
  const s = leSessao();
  if(!s) return mostraEntrada('');
  if(!s.dia || s.dia!==diaTrabalho()){ apagaSessao(); return mostraEntrada(MSG_ENTRADA.reiniciado); }
  const v = validaAcesso(s);
  if(!v){ apagaSessao(); return mostraEntrada(MSG_ENTRADA.indisponivel); }
  aplicaAcesso({...v, dia:s.dia});
}
// virada do dia de trabalho com o painel aberto (ao voltar para a aba e a cada online): volta para a entrada
function confereDia(){
  if(!ACESSO || ACESSO.dia===diaTrabalho()) return false;
  saiDoAcesso(MSG_ENTRADA.reiniciado);
  return true;
}
/* Payload novo com o painel aberto: o acesso ainda vale? Se vale, a parte travada continua a dele (no grupo, a escolha
   do seletor fica enquanto tiver dados; senão volta para o Total). */
function confereAcesso(){
  if(!ACESSO) return true;
  const v = validaAcesso(ACESSO);
  if(!v){ saiDoAcesso(MSG_ENTRADA.indisponivel); return false; }
  const a = ACESSO = {...v, dia:ACESSO.dia};
  if(a.perfil==='gc' && sel.gc!==a.gc && !(ehGrupo(a.gc) && membrosGc(a.gc).includes(sel.gc) && DATA[sel.gc]))
    sel = {...sel, gc:a.gc, sv:'', rota:''};
  if(a.perfil==='sv') sel = {...sel, gc:a.gc, sv:a.sv};
  if(a.perfil==='rota') sel = {...sel, gc:a.gc, sv:a.sv, rota:a.rota};
  return true;
}
document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState==='visible') confereDia(); });

// escolha feita (Diretoria ou a última etapa da caixa): grava o acesso do dia e abre o painel
function entraCom(escolha){
  const v = validaAcesso(escolha);
  fechaCaixa(false);
  if(!v){ $('entMsg').textContent = MSG_ENTRADA.indisponivel; return; }     // a caixa só lista o que vale
  const a = {...v, dia:diaTrabalho()};
  gravaSessao(a);
  aplicaAcesso(a);
}

/* Caixa de seleção (diálogo): 1ª etapa = gerências; na Supervisão e na Rota, 2ª etapa = a lista da gerência escolhida,
   com "← Gerências". Sem campo de texto. Foco na primeira opção, Tab preso na caixa, setas entre as opções, ESC, × e
   clique fora fecham (o foco volta ao botão do perfil); a lista rola dentro da caixa. */
let CAIXA = null, _focoCaixa = null;     // {perfil, gc}: gc '' = 1ª etapa; senão a gerência (ou grupo) escolhida
function abreCaixa(perfil){
  _focoCaixa = document.activeElement;
  $('entMsg').textContent = '';
  CAIXA = {perfil, gc:''};
  $('entCaixa').hidden = false;
  pintaCaixa();
}
function fechaCaixa(devolveFoco = true){
  if($('entCaixa').hidden) return;
  $('entCaixa').hidden = true;
  CAIXA = null;
  if(devolveFoco && _focoCaixa && _focoCaixa.focus) _focoCaixa.focus({preventScroll:true});
}
const opcaoCaixa = (attr, valor, rotulo, off) =>
  `<button type="button" data-${attr}="${esc(valor)}"${off ? ' disabled' : ''}>${esc(rotulo)}</button>`;
function pintaCaixa(){
  const {perfil, gc} = CAIXA, nome = perfil==='sv' ? 'supervisão' : 'rota';
  $('entCaixaTit').textContent = PERFIS[perfil].toUpperCase();
  $('entVoltar').hidden = !gc;
  let html;
  if(!gc){
    $('entCaixaSub').textContent = 'Escolha a gerência';
    html = opcoesGc().map(o => opcaoCaixa('gc', o.chave, o.rotulo + (o.ok ? '' : ' · sem dados'), !o.ok)).join('');
  } else {
    $('entCaixaSub').textContent = `${rotuloGc(gc)} · escolha a ${nome}`;
    const gcs = membrosGc(gc).filter(g => DATA[g]);
    html = gcs.map(g => {
      const itens = perfil==='sv' ? svsDaEntrada(g).map(s => opcaoCaixa('sv', s, rotuloSv(s)))
        : rotasDaEntrada(g).map(r => { const c = titulo(nodo(g, r).consultor);
            return opcaoCaixa('rota', r, c ? `Rota ${r} · ${c}` : `Rota ${r}`); });
      // no grupo, o nome de cada gerência antes da lista dela
      return itens.length ? (gcs.length > 1 ? `<div class="entSecao">${esc(rotuloGc(g))}</div>` : '') + itens.join('') : '';
    }).join('') || `<div class="entVazio">Nenhuma ${nome} disponível nesta gerência.</div>`;
  }
  $('entOpcoes').innerHTML = html;
  $('entOpcoes').scrollTop = 0;
  ($('entOpcoes').querySelector('button:not([disabled])') || $('entFechar')).focus({preventScroll:true});
}
$('entOpcoes').onclick = e => {
  const b = e.target.closest('button');
  if(!b || b.disabled || !CAIXA) return;
  const {perfil} = CAIXA;
  if(b.dataset.gc!=null){
    if(perfil==='gc') return entraCom({perfil, gc:b.dataset.gc});
    CAIXA = {perfil, gc:b.dataset.gc};
    return pintaCaixa();
  }
  entraCom({perfil, gc:CAIXA.gc, sv:b.dataset.sv || '', rota:b.dataset.rota || ''});
};
$('entVoltar').onclick = () => { CAIXA = {...CAIXA, gc:''}; pintaCaixa(); };
$('entFechar').onclick = () => fechaCaixa();
$('entCaixa').onclick = e => { if(e.target===$('entCaixa')) fechaCaixa(); };     // clique fora do painel
$('entCaixa').addEventListener('keydown', e=>{
  if(e.key==='Escape'){ e.preventDefault(); e.stopPropagation(); fechaCaixa(); return; }
  if(e.key==='Tab'){
    const f = [...$('entCaixa').querySelectorAll('button')].filter(b => !b.disabled && !b.hidden);
    const i = f.indexOf(document.activeElement);
    if(e.shiftKey && i<=0){ e.preventDefault(); f[f.length-1].focus(); }
    else if(!e.shiftKey && i===f.length-1){ e.preventDefault(); f[0].focus(); }
    return;
  }
  if((e.key==='ArrowDown' || e.key==='ArrowUp') && e.target.closest('#entOpcoes')){
    const ops = [...$('entOpcoes').querySelectorAll('button:not([disabled])')];
    const prox = ops[ops.indexOf(document.activeElement) + (e.key==='ArrowDown' ? 1 : -1)];
    if(prox){ e.preventDefault(); prox.focus(); }
  }
});
document.querySelectorAll('#entrada [data-perfil]').forEach(b => b.onclick = () =>
  b.dataset.perfil==='dir' ? entraCom({perfil:'dir'}) : abreCaixa(b.dataset.perfil));
$('btnCasa').onclick = () => saiDoAcesso('');
aplicaTemaEntrada(temaEntrada());
$('entRod').textContent = CONFIG.CREDITOS;

/* ---------- busca de cliente ---------- */
let ULTIMA_BUSCA = [];   // [ {tipo:'cliente',rota,c} | {tipo:'rede',nome,membros} ], sugestão mostrada agora

/* Redes/KA: "Key Account" da Base de Clientes agrupa lojas da mesma rede.
   A busca pela rede mostra o consolidado das lojas no escopo do filtro (GC/SV/rota). */
function gruposRede(rotas){
  const map = new Map();
  for(const r of rotas){
    const grupos = (P.REDES_CLIENTE||{})[r]||{};
    for(const key in grupos){
      const g = grupos[key];
      if(!map.has(key)) map.set(key, {nome:g.nome, membros:[]});
      g.clientes.forEach(cid=> map.get(key).membros.push([r,cid]));
    }
  }
  return map;
}
function buscaRede(v, rotas){
  const vNorm = v.trim().toLowerCase();
  if(!vNorm) return null;
  const grupos = gruposRede(rotas);
  for(const g of grupos.values())
    if(g.nome.toLowerCase()===vNorm) return g;         // match exato tem prioridade
  const cands = [...grupos.values()].filter(g=>g.nome.toLowerCase().includes(vNorm));
  return cands.length===1 ? cands[0] : null;            // substring só serve se for único (senão ambíguo)
}

function escolheSugestao(i){
  const it = ULTIMA_BUSCA[i]; if(!it) return;
  $('q').value = it.tipo==='rede' ? it.nome : `${it.c[0]} — ${it.c[1]}`;
  $('qSugestoes').classList.remove('on');
  buscaCliente();
}
function buscaSugestoes(){
  const v = $('q').value.trim().toLowerCase();
  const box = $('qSugestoes');
  if(!v){ box.classList.remove('on'); box.innerHTML=''; ULTIMA_BUSCA=[]; return; }
  const rotas = rotasVisiveis();
  const out = [];
  for(const g of gruposRede(rotas).values()){
    if(g.nome.toLowerCase().includes(v)){
      out.push({tipo:'rede', nome:g.nome, membros:g.membros});
      if(out.length>=8) break;
    }
  }
  if(out.length<8){
    outer:
    for(const r of rotas){
      for(const c of (CLIENT_ROSTER[r]||[])){
        if(c[1].toLowerCase().includes(v) || String(c[0]).includes(v)){
          out.push({tipo:'cliente', rota:r, c});
          if(out.length>=8) break outer;
        }
      }
    }
  }
  ULTIMA_BUSCA = out;
  if(!out.length){ box.classList.remove('on'); box.innerHTML=''; return; }
  box.innerHTML = out.map((it,i)=>{
    if(it.tipo==='rede'){
      const rotasUnicas = [...new Set(it.membros.map(m=>m[0]))];
      return `<div class="sugItem" role="option" tabindex="0" data-i="${i}"><span class="nm">${esc(it.nome)}<span class="tagRedeSug">Rede</span></span>
        <span class="meta">${it.membros.length} lojas · rota${rotasUnicas.length>1?'s':''} ${esc(rotasUnicas.join(', '))}</span></div>`;
    }
    return `<div class="sugItem" role="option" tabindex="0" data-i="${i}"><span class="nm">${esc(it.c[1])}</span>
      <span class="meta">PV ${esc(it.c[0])} · rota ${esc(it.rota)}</span></div>`;
  }).join('');
  box.classList.add('on');
  box.querySelectorAll('.sugItem').forEach(el=>clicavel(el, ()=>escolheSugestao(Number(el.dataset.i))));
}
document.addEventListener('click', e=>{
  if(!e.target.closest('.buscaWrap')) $('qSugestoes').classList.remove('on');
});
document.addEventListener('focusin', e=>{
  if(e.target.id==='q' && ULTIMA_BUSCA.length) $('qSugestoes').classList.add('on');
});
$('q').addEventListener('keydown', e=>{
  if(e.key==='ArrowDown'){ const p = $('qSugestoes').querySelector('.sugItem'); if(p){ e.preventDefault(); p.focus(); } }
  if(e.key==='Enter' && ULTIMA_BUSCA.length===1){ e.preventDefault(); escolheSugestao(0); }
});
$('qSugestoes').addEventListener('keydown', e=>{
  const it = e.target.closest('.sugItem'); if(!it) return;
  if(e.key==='ArrowDown' && it.nextElementSibling){ e.preventDefault(); it.nextElementSibling.focus(); }
  if(e.key==='ArrowUp'){ e.preventDefault(); (it.previousElementSibling || $('q')).focus(); }
  if(e.key==='Escape'){ $('qSugestoes').classList.remove('on'); $('q').focus(); }
});

/* Barra de status de meta por cliente (aba Volume): 3 faixas de cor.
   `bloco` = [meta,real,pct,status] (0 fora do ritmo, 1 dentro do ritmo, 2 meta batida) ou null.
   As linhas de texto usam data-fit: encaixa() reduz a fonte até caber na largura real do tile. */
function tileVolume(k, bloco){
  const label = esc(P.LABELS_CURTO[k]||rotuloInd(k));
  if(!P.FONTES.venda)
    return `<div class="tileVol nd"><div class="t" data-fit="13" data-fit-min="9.5">${label}</div>
      <div class="barraWrap"><div class="barra"></div></div>
      <div class="e">sem venda</div></div>`;
  if(!bloco)
    return `<div class="tileVol nd"><div class="t" data-fit="13" data-fit-min="9.5">${label}</div>
      <div class="barraWrap"><div class="barra"></div></div>
      <div class="e">sem meta</div></div>`;
  const [meta,real,pct,status] = bloco;
  const cls = status===2?'ok':(status===1?'pace':'no');
  const rotulo = status===2?'meta batida':(status===1?'dentro do ritmo':'fora do ritmo');
  const larg = Math.max(0, Math.min(100, pct));
  const fmtNum = n => n.toLocaleString('pt-BR', {minimumFractionDigits:1, maximumFractionDigits:1});
  return `<div class="tileVol ${cls}"><div class="t" data-fit="13" data-fit-min="9.5">${label}</div>
    <div class="barraWrap"><div class="barra" style="width:${larg}%"></div></div>
    <div class="e" data-fit="10.5" data-fit-min="8.5" data-fit-quebra>${pct}% · ${rotulo}</div>
    <div class="nums" data-fit="12" data-fit-min="8">${fmtNum(real)} / ${fmtNum(meta)}</div></div>`;
}
// blocos de volume da rota, na ordem do VOLUME_CLIENTE: os 5 macros + os extras que a rota tem (Del Valle Frut na G2)
const volDaRota = r => [...GROUPS.VOLUME, ...volExtras().filter(k=>((nodo(sel.gc,r)||{}).indicators||{})[k])];
/* Real da barra por cliente = Vol Real do payload + volume online de hoje do cliente (online.json volumeCliente),
   fora do fechamento do mês. % e status recalculados com a mesma regra (modelo.bloco_cliente_com_online). */
function blocoVolCliente(r, pv, i, k){
  const porCliente = ((P.VOLUME_CLIENTE||{})[r]||{})[pv];
  const bloco = porCliente ? porCliente[i] : null;
  const onl = (((((ONLINE && ONLINE.volumeCliente)||{})[r]||{})[pv])||{})[k]||0;
  if(!bloco || P.FECHAMENTO || !onl) return bloco;
  const meta = bloco[0], real = bloco[1] + onl;
  const pct = meta ? Math.round(real/meta*100) : 0;
  return [meta, Math.round(real*10)/10, pct, pct>=100?2:(pct>=P.PACE_ONTEM_PCT?1:0)];
}
const tileCob = (k, cls, txt) =>
  `<div class="tile ${cls}"><div class="t" data-fit="13" data-fit-min="9.5">${esc(P.LABELS_CURTO[k]||rotuloInd(k))}</div><div class="e">${txt}</div></div>`;
/* Desempenho GDM e tag de geladeira (payload COMODATO_CLIENTE: [meta, faturado GDM, situação, nº de geladeiras]).
   Real = faturado do mês (mesmo filtro de NF_STATUS do Vol Real) + online de hoje (online.json gdmCliente), só em
   Refrigerantes, Água Mineral, Sucos, Ades e Powerade; Meta = META_EQPTO das geladeiras Total Ko.
   Sem geladeira: sem tag nem quadrinho. No fechamento do mês: nenhum dos dois. */
const SITUACAO_TAG = {zero:['tagVZ','Venda Zero · '], baixo:['tagBaixo','Baixo Giro · '], ok:['tagAtivo',''],
  '30d':['tagNovo','< 30 dias · ']};
const geladeiras = n => `${n} geladeira${n>1?'s':''}`;
const temGdm = () => !!(P && P.COMODATO_CLIENTE) && !P.FECHAMENTO;
function gdmCliente(r, pv){
  if(!temGdm()) return null;
  const b = (P.COMODATO_CLIENTE[r]||{})[pv]; if(!b) return null;
  const onl = ((((ONLINE && ONLINE.gdmCliente)||{})[r])||{})[pv]||0;
  return {meta:b[0], real:b[1]+onl, situacao:b[2], n:b[3]};
}
function tagGeladeira(g){
  if(!g || !SITUACAO_TAG[g.situacao]) return '';          // situação desconhecida: sem tag
  const [cls, pre] = SITUACAO_TAG[g.situacao];
  return `<span class="${cls}">${pre}${geladeiras(g.n)}</span>`;
}
// cor: Giro Zero vermelho; Baixo Giro sempre amarelo; Giro Ok verde; < 30 dias (e rede) pela venda do mês;
// situação desconhecida: sem cor
function corGdm(g){
  if(g.situacao==='zero') return 'no';
  if(g.situacao==='baixo') return 'pace';
  if(g.situacao==='ok') return 'ok';
  if(g.situacao==='30d' || g.situacao==='rede') return g.real<=0 ? 'no' : (g.real<g.meta ? 'pace' : 'ok');
  return 'nc';
}
function tileGdm(g){
  if(!g) return '';
  const pct = g.meta ? Math.round(g.real/g.meta*100) : 0;
  const fmt = n => n.toLocaleString('pt-BR', {minimumFractionDigits:1, maximumFractionDigits:1});
  return `<div class="tileVol gdm ${corGdm(g)}"><div class="t" data-fit="13" data-fit-min="9.5" data-fit-quebra>Desempenho GDM</div>
    <div class="barraWrap"><div class="barra" style="width:${Math.max(0, Math.min(100, pct))}%"></div></div>
    <div class="e" data-fit="10.5" data-fit-min="8.5" data-fit-quebra>${pct}%</div>
    <div class="nums" data-fit="12" data-fit-min="8">${fmt(g.real)} / ${fmt(g.meta)}</div></div>`;
}
const blocoImperdoaveis = `<h4>Imperdoáveis</h4><div class="semim">Sem dado de Imperdoáveis pra essa rota.</div>`;

function buscaCliente(){
  const v=$('q').value.trim(); if(!v){$('cli').innerHTML='';return;}
  const id=parseInt(v,10);
  const rotas = rotasVisiveis();
  let achado=null, rota=null;
  for(const r of rotas){
    const c=(CLIENT_ROSTER[r]||[]).find(x=> x[0]===id || x[1].toLowerCase()===v.toLowerCase()
      || `${x[0]} — ${x[1]}`===v);
    if(c){achado=c;rota=r;break;}
  }
  if(!achado){
    const rede = buscaRede(v, rotas);
    if(rede){ renderRede(rede); return; }
    $('cli').innerHTML='';return;
  }
  const kstt = ehKstt(achado);
  const grupo = aba==='INCENTIVO' ? itensInc() : P.COV_GRUPO[aba];              // só os itens da aba ativa
  let chips;
  if(aba==='VOLUME'){
    // Volume não tem cobertura binária: usa a barra de status de meta por cliente (VOLUME_CLIENTE + online de hoje)
    chips = volDaRota(rota).map((k,i)=> tileVolume(k, blocoVolCliente(rota, achado[0], i, k))).join('')
      + tileGdm(gdmCliente(rota, achado[0]));
  } else {
    chips = grupo.map(k=>{
      // Todos a Bordo: item sem meta na rota do cliente (BARRACUDA sem Heineken) não tem quadrinho de compra
      if(aba==='INCENTIVO' && !temMetaInc(k, rota)) return tileCob(k, 'na', INC_SO_FULL.includes(k) ? 'só Full' : 'sem meta');
      if(k==='KS TT' && !kstt) return tileCob(k, 'na', 'não elegível');
      if(!P.FONTES.venda) return tileCob(k, 'nd', 'sem venda');
      const ok=(((COBERTOS[rota]||{})[k])||[]).includes(achado[0]);
      return tileCob(k, ok?'ok':'no', ok?'real':'sem compra');
    }).join('');
  }
  const vzEntries = (VENDAZERO_CLIENTES[rota]||[]).filter(e=>e.pv===achado[0]);
  // Venda Zero pendente = equipamentos ainda não revertidos hoje; os revertidos contam como "Cliente ativo"
  const vzTotal = vzEntries.filter(e=>!e.revertido).reduce((s,e)=>s+e.vdz,0);
  const vzRevert = vzEntries.filter(e=>e.revertido).reduce((s,e)=>s+e.vdz,0);
  const tagVZ = vzTotal>0
    ? `<span class="tagVZ">Venda Zero · ${vzTotal} geladeira${vzTotal>1?'s':''}</span>` : '';
  const nAtivo = (((COMODATO_ATIVOS[rota]||{})[String(achado[0])])||0) + vzRevert;
  const tagAtivo = nAtivo>0
    ? `<span class="tagAtivo">${nAtivo} geladeira${nAtivo>1?'s':''}</span>` : '';
  // payload com COMODATO_CLIENTE: tag pela situação da geladeira; payload antigo: tags de antes
  const tags = (P && P.COMODATO_CLIENTE) ? tagGeladeira(gdmCliente(rota, achado[0])) : tagVZ + tagAtivo;
  $('cli').innerHTML = `<div class="cli"><h3>${esc(achado[1])}${tags}</h3>
    <div class="meta">PV ${esc(achado[0])} · ${esc(SEGS[achado[2]]||'—')} · rota ${esc(rota)} · visita ${esc(DIAS[achado[3]]||'—')}</div>
    <div class="painel">
      <div class="grid13">${chips}</div>
      ${blocoImperdoaveis}
    </div></div>`;
  encaixa($('cli'));
}
// rede: soma Meta, Real (faturado + online) e geladeiras das lojas com geladeira Total Ko; cor pela venda do mês
function gdmRede(membros){
  const gs = membros.map(([r,cid])=>gdmCliente(r, cid)).filter(Boolean);
  if(!gs.length) return null;
  return {meta: gs.reduce((a,g)=>a+g.meta,0), real: gs.reduce((a,g)=>a+g.real,0), n: gs.reduce((a,g)=>a+g.n,0),
          situacao: 'rede'};
}
/* Consolidado de rede: soma meta/real (Volume) ou cobertos/elegíveis (ICS GC, Novos Negócios)
   de todas as lojas da rede dentro do escopo de filtro atual. */
function renderRede(rede){
  const membros = rede.membros;                  // [[rota,cid], ...]
  const rotasUnicas = [...new Set(membros.map(m=>m[0]))];
  const grupo = aba==='INCENTIVO' ? itensInc() : P.COV_GRUPO[aba];
  let chips;
  if(aba==='VOLUME'){
    const ks = [...grupo, ...volExtras().filter(k=>rotasUnicas.some(r=>volDaRota(r).includes(k)))];
    chips = ks.map(k=>{
      let metaSum=0, realSum=0, temMeta=false;
      membros.forEach(([r,cid])=>{
        const i = volDaRota(r).indexOf(k);
        const bloco = i<0 ? null : blocoVolCliente(r, cid, i, k);
        if(bloco){ metaSum+=bloco[0]; realSum+=bloco[1]; temMeta=true; }
      });
      if(!temMeta || metaSum<=0) return tileVolume(k, null);
      const pct = Math.round(realSum/metaSum*100);
      const status = pct>=100?2:(pct>=P.PACE_ONTEM_PCT?1:0);
      return tileVolume(k, [Math.round(metaSum*10)/10, Math.round(realSum*10)/10, pct, status]);
    }).join('') + tileGdm(gdmRede(membros));
  } else {
    chips = grupo.map(k=>{
      if(!P.FONTES.venda) return tileCob(k, 'nd', 'sem venda');
      let elegiveis=0, cobertos=0;
      membros.forEach(([r,cid])=>{
        const c = (CLIENT_ROSTER[r]||[]).find(x=>x[0]===cid);
        if(k==='KS TT' && (!c || !ehKstt(c))) return;   // fora do denominador, igual ao cliente avulso
        if(aba==='INCENTIVO' && !temMetaInc(k, r)) return;   // Todos a Bordo: só as lojas de rotas com meta do item
        elegiveis++;
        if((((COBERTOS[r]||{})[k])||[]).includes(cid)) cobertos++;
      });
      if(elegiveis===0) return tileCob(k, 'na', aba==='INCENTIVO' ? 'sem meta' : 'não elegível');
      const cls = cobertos===elegiveis ? 'ok' : (cobertos===0 ? 'no' : 'parcial');
      return tileCob(k, cls, `${cobertos}/${elegiveis} lojas`);
    }).join('');
  }
  let vzTotal = 0, vzRevertR = 0;
  membros.forEach(([r,cid])=>{
    (VENDAZERO_CLIENTES[r]||[]).filter(e=>e.pv===cid).forEach(e=>{ if(e.revertido) vzRevertR += e.vdz; else vzTotal += e.vdz; });
  });
  const tagVZ = vzTotal>0
    ? `<span class="tagVZ">Venda Zero · ${vzTotal} geladeira${vzTotal>1?'s':''}</span>` : '';
  let nAtivoR = vzRevertR;
  membros.forEach(([r,cid])=>{ nAtivoR += ((COMODATO_ATIVOS[r]||{})[String(cid)])||0; });
  const tagAtivoR = nAtivoR>0
    ? `<span class="tagAtivo">${nAtivoR} geladeira${nAtivoR>1?'s':''}</span>` : '';
  const rotaTxt = rotasUnicas.length>1 ? `rotas ${rotasUnicas.join(', ')}` : `rota ${rotasUnicas[0]}`;
  const gR = gdmRede(membros);
  const tags = (P && P.COMODATO_CLIENTE) ? (gR ? `<span class="tagAtivo">${geladeiras(gR.n)}</span>` : '')
    : tagVZ + tagAtivoR;
  $('cli').innerHTML = `<div class="cli"><h3>${esc(rede.nome)}<span class="tagRede">Rede</span>${tags}</h3>
    <div class="meta">${membros.length} loja${membros.length>1?'s':''} · ${esc(rotaTxt)}</div>
    <div class="painel">
      <div class="grid13">${chips}</div>
      ${blocoImperdoaveis}
    </div></div>`;
  encaixa($('cli'));
}
$('q').oninput = () => { buscaSugestoes(); buscaCliente(); };

// reencaixa os textos quando a largura muda (rotação do celular, janela redimensionada)
{ let t; addEventListener('resize', ()=>{ clearTimeout(t); t = setTimeout(()=>encaixa(), 150); }); }

/* ---------- versão nova do código ----------
   A versão do painel aberto é a <meta name="versao"> (o deploy troca "dev" pelo hash de frontend/ sem data/); a do
   servidor vem de versao.json, sem cache. Diferente: faixa "Nova versão disponível" acima do cabeçalho (só com o
   painel aberto; o CSS a esconde na entrada). "Atualizar" (e o ↻ do cabeçalho) baixa de novo, sem o cache do
   navegador, a página, CSS, JS, manifest, versao.json e os dois JSONs, e só então recarrega; sem conexão, avisa e
   não recarrega. Nenhuma chave do localStorage é apagada: o painel reabre no mesmo acesso. */
const VERSAO = ((document.querySelector('meta[name="versao"]') || {}).content || '').trim() || 'dev';
const versaoLigada = () => VERSAO !== 'dev';
let versaoServidor = null, versaoAdiada = null, modoAviso = '';
const MSG_AVISO = {nova:'Nova versão disponível', atualizando:'Atualizando o painel', erro:'Sem conexão. Tente de novo.'};

// modo: '' (sem faixa) | 'nova' | 'atualizando' | 'erro'
function mostraAviso(modo){
  modoAviso = modo;
  $('aviso').hidden = !modo;
  const ocupado = modo==='atualizando';
  $('avisoTxt').textContent = ocupado && versaoServidor && versaoServidor!==VERSAO ? MSG_AVISO.nova : (MSG_AVISO[modo] || '');
  $('avisoAtualizar').textContent = ocupado ? 'Atualizando…' : 'Atualizar';
  $('avisoAtualizar').disabled = $('avisoDepois').disabled = $('btnRecarga').disabled = ocupado;
  $('btnRecarga').setAttribute('aria-busy', String(ocupado));
}
// falha de rede, 404 ou resposta estranha: silêncio (sem faixa, sem erro)
async function confereVersao(){
  if(!versaoLigada()) return;
  let v;
  try{
    const r = await fetch(`${CONFIG.VERSAO_URL}?t=${Date.now()}`, {cache:'no-store'});
    if(!r.ok) return;
    v = (await r.json()).versao;
  }catch(e){ return; }
  if(typeof v!=='string' || !v) return;
  versaoServidor = v;
  if(modoAviso==='atualizando' || modoAviso==='erro') return;
  if(v===VERSAO) return mostraAviso('');
  if(versaoAdiada && versaoAdiada.versao===v && Date.now() < versaoAdiada.ate) return;
  versaoAdiada = null;
  mostraAviso('nova');
}
async function atualizaPainel(){
  if(modoAviso==='atualizando') return;
  mostraAviso('atualizando');
  const urls = [location.origin + location.pathname,
    ...[...document.querySelectorAll('link[rel=stylesheet], link[rel=manifest], script[src]')].map(e => e.href || e.src),
    CONFIG.DATA_BASE + CONFIG.PAYLOAD_URL, CONFIG.DATA_BASE + CONFIG.ONLINE_URL];
  if(versaoLigada()) urls.push(CONFIG.VERSAO_URL);      // em desenvolvimento não existe
  try{
    await Promise.all(urls.map(async u => {
      const r = await fetch(u, {cache:'reload'});
      if(!r.ok) throw new Error(`${u}: HTTP ${r.status}`);
      await r.arrayBuffer();                            // até o fim: o cache do navegador fica com o arquivo novo
    }));
  }catch(e){ return mostraAviso('erro'); }
  location.reload();
}
$('btnRecarga').onclick = atualizaPainel;
$('avisoAtualizar').onclick = atualizaPainel;
$('avisoDepois').onclick = () => {
  if(versaoServidor && versaoServidor!==VERSAO) versaoAdiada = {versao:versaoServidor, ate:Date.now() + CONFIG.VERSAO_ADIA_MS};
  mostraAviso('');
};

/* ---------- carga dos JSONs ---------- */
// cache:'no-cache' revalida com ETag: só baixa de novo quando o arquivo mudou no servidor.
async function buscaJson(nome){
  const r = await fetch(CONFIG.DATA_BASE + nome, {cache:'no-cache'});
  if(!r.ok) throw new Error(`${nome}: HTTP ${r.status}`);
  return r.json();
}
async function puxaOnline(){
  confereDia();      // virou o dia de trabalho com o painel aberto: volta para a entrada
  confereVersao();   // em paralelo; não atrasa o online
  try{
    ONLINE = await buscaJson(CONFIG.ONLINE_URL);
    render();
  }catch(e){ console.warn('online.json indisponível', e); }
}
