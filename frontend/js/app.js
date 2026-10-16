/* Desempenho de Rotas · núcleo do painel.
   Dados: data/payload.json (base do mês) e data/online.json (vendas do dia),
   ambos gerados pelo back-end a partir do SAP Datasphere (OData). */
let P = null;
let DATA,LABELS,GROUPS,CLIENT_ROSTER,CLIENTES_HOJE,OPORTUNIDADES_DIA,VISITAS_DIA,SEGS,DIAS,COBERTOS,SEM_COMPRA_HOJE,VENDAZERO_CLIENTES,COMODATO_ATIVOS,REVERTIDO_HOJE,OPORTUNIDADE_HOJE;
const INVERTED = new Set(['VENDAZERO']);
const KSTT_SEG = new Set(['LANCHONETE','RESTAURANTE','BOTECO','PADARIAS']);

let ONLINE = null, aba='ICS_GC';

/* ---------- utilitários ---------- */
const $ = id => document.getElementById(id);
const ESC_MAP = {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'};
const esc = v => String(v==null?'':v).replace(/[&<>"']/g, ch=>ESC_MAP[ch]);
const titulo = s => String(s||'').toLowerCase().replace(/(^|\s)\S/g, m=>m.toUpperCase());
function nomeSv(sv){
  const n = ((P && P.NOME_SUPERVISOR)||{})[sv];
  if(!n) return '';
  if(/SEM VENDEDOR/i.test(n)) return 'sem vendedor';
  return titulo(n.split(/\s+/)[0]);
}
const rotuloSv = sv => { const n = nomeSv(sv); return n ? `${sv} · ${n}` : sv; };
// supervisões sem SUP/VEND de verdade ("ROTA SEM VENDEDOR" / Neutraliza / rotas online)
// não entram na comparação "quem mais puxa a média para baixo"
const svExcluido = sv => CONFIG.SV_EXCLUIDOS.includes(sv) || /SEM VENDEDOR/i.test(((P && P.NOME_SUPERVISOR)||{})[sv]||'');
// torna um elemento não-<button> clicável também pelo teclado (Enter/Espaço)
function clicavel(el, fn){
  el.onclick = fn;
  el.onkeydown = e => { if(e.key==='Enter' || e.key===' '){ e.preventDefault(); fn(e); } };
}
// reduz a fonte até o texto caber na largura real do elemento (mede no DOM, não em px fixos)
function encaixa(raiz){
  (raiz||document).querySelectorAll('[data-fit]').forEach(el=>{
    const max = parseFloat(el.dataset.fit), min = parseFloat(el.dataset.fitMin||7);
    let s = max; el.style.fontSize = s+'px';
    el.style.whiteSpace = '';
    while(el.scrollWidth > el.clientWidth + 0.5 && s > min){ s -= 0.5; el.style.fontSize = s+'px'; }
    // se nem no tamanho mínimo coube e o elemento permite, quebra a linha em vez de cortar
    if(el.dataset.fitQuebra!=null && el.scrollWidth > el.clientWidth + 0.5){
      el.style.whiteSpace = 'normal'; el.style.fontSize = ((max+min)/2)+'px';
    }
  });
}

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

let sel = {gc:'', sv:'', rota:''};

const svsDe = gc => Object.keys(DATA[gc]||{});
const rotasDe = (gc,sv) => sv ? Object.keys(DATA[gc][sv]) : svsDe(gc).flatMap(s=>Object.keys(DATA[gc][s]));
const rotaSv = (gc,r) => svsDe(gc).find(s=>DATA[gc][s][r]);
const nodo = (gc,r) => DATA[gc][rotaSv(gc,r)][r];
const ehKstt = c => KSTT_SEG.has((SEGS[c[2]]||'').toUpperCase());
const rotasAtuais = () => sel.rota ? [sel.rota] : rotasDe(sel.gc, sel.sv);

/* ---------- agregação ---------- */
function agrega(rotas){
  const ind={}, tot={baseTotal:0,compraram:null,semCompra:null};
  [...GROUPS.ICS_GC,...GROUPS.NOVOS_NEG].forEach(k=>ind[k]={meta:0,real:0,n:0});
  const volAgg={}; GROUPS.VOLUME.forEach(k=>volAgg[k]={meta:0,real:0,tend:0,n:0});
  rotas.forEach(r=>{
    const d=nodo(sel.gc,r); tot.baseTotal+=d.baseTotal||0;
    if(d.compraram!=null){tot.compraram=(tot.compraram||0)+d.compraram;
      tot.semCompra=(tot.semCompra||0)+d.semCompra;}
    Object.keys(ind).forEach(k=>{
      const b=d.indicators[k]; if(!b||b.unavailable) return;
      ind[k].meta+=b.meta||0; ind[k].real+=b.real||0; ind[k].n++;
    });
    GROUPS.VOLUME.forEach(k=>{
      const b=d.indicators[k]; if(!b||b.unavailable) return;
      volAgg[k].meta+=b.meta||0; volAgg[k].real+=b.real||0;
      volAgg[k].tend+=b.tendencia||0; volAgg[k].n++;
    });
  });
  const out={};
  Object.keys(ind).forEach(k=>{
    const a=ind[k];
    if(!a.n){out[k]={unavailable:true};return;}
    const pct = a.meta ? Math.round(a.real/a.meta*100) : null;
    out[k]={meta:a.meta,real:a.real,pct,
      onPace: pct!=null && (INVERTED.has(k)? pct<=100 : pct>=P.PACE_ONTEM_PCT),
      gap: INVERTED.has(k)
        ? Math.max(0, Math.ceil(a.real - a.meta))
        : Math.max(0, Math.ceil(a.meta*P.DIA_HOJE/P.TOTAL_DIAS_UTEIS)-a.real),
      revertidoHoje: rotas.reduce((s,r)=>s+((REVERTIDO_HOJE||{})[r]||0),0),
      oportunidadeHoje: rotas.reduce((s,r)=>s+((OPORTUNIDADE_HOJE||{})[r]||0),0),
      unavailable:false};
  });
  GROUPS.VOLUME.forEach(k=>{
    const a=volAgg[k];
    if(!a.n){out[k]={unavailable:true};return;}
    const pctT = a.meta ? Math.round(a.tend/a.meta*100) : null;
    const semDadoHoje = rotas.length===1 && !!(nodo(sel.gc,rotas[0]).indicators[k]||{}).semDadoHoje;
    out[k]={meta:a.meta,real:a.real,dif:a.real-a.meta,
      metaDia: rotas.reduce((s,r)=>{const b=nodo(sel.gc,r).indicators[k];return s+(b&&!b.unavailable?(b.metaDia||0):0);},0),
      pctTendencia:pctT, onPace: pctT!=null && pctT>=100, unavailable:false, semDadoHoje};
  });
  return {ind:out, tot};
}

/* ---------- filtros ---------- */
let _chaveFiltros = '';
function montaFiltros(){
  // só reconstrói os <select> quando o filtro (ou o payload) muda -- o polling do online não mexe neles
  const chave = `${sel.gc}|${sel.sv}|${sel.rota}|${P._versao||''}`;
  if(chave===_chaveFiltros) return;
  _chaveFiltros = chave;
  $('fgc').innerHTML = P.GC_ATIVAS.map(g=>`<option value="${esc(g)}">Gerência ${esc(g)}</option>`).join('');
  $('fgc').value = sel.gc;
  $('fsv').innerHTML = `<option value="">Todos os SVs</option>`+
    svsDe(sel.gc).map(s=>`<option value="${esc(s)}">${esc(rotuloSv(s))}</option>`).join('');
  $('fsv').value = sel.sv;
  const rs = rotasDe(sel.gc, sel.sv);
  $('frota').innerHTML = `<option value="">Todas rotas</option>`+
    rs.map(r=>`<option value="${esc(r)}">Rota ${esc(r)}</option>`).join('');
  $('frota').value = sel.rota;
  $('qSugestoes').classList.remove('on');
}
$('fgc').onchange = e => {sel={gc:e.target.value,sv:'',rota:''}; render();};
$('fsv').onchange = e => {sel.sv=e.target.value; sel.rota=''; render();};
$('frota').onchange = e => {
  sel.rota=e.target.value;
  if(sel.rota && !sel.sv) sel.sv = rotaSv(sel.gc, sel.rota);
  render();
};
document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>{
  aba=t.dataset.g;
  document.querySelectorAll('.tab').forEach(x=>{
    x.classList.toggle('on',x===t); x.setAttribute('aria-selected', x===t);
  });
  render();
  if($('q').value.trim()) buscaCliente();
});

/* ---------- render ---------- */
function render(){
  if(!P) return;
  montaFiltros();
  const rotas = rotasAtuais();
  const {ind, tot} = agrega(rotas);

  $('sub').innerHTML = `${esc(P.MES_LABEL)}${tagAtualizado()} · ${esc(sel.gc)}` +
    (sel.sv?` · ${esc(rotuloSv(sel.sv))}`:'') +
    (sel.rota?` · Rota ${esc(sel.rota)} — ${esc(titulo(nodo(sel.gc,sel.rota).consultor))}`:'');
  const paceHoje = Math.round(P.DIA_HOJE / P.TOTAL_DIAS_UTEIS * 100);
  $('ritmo').innerHTML =
    `<span>Real até ontem: <b>dia útil ${P.DIA_ONTEM}/${P.TOTAL_DIAS_UTEIS}</b> (<span class="pct">${P.PACE_ONTEM_PCT}%</span>)`+
    ` · para entrar no ritmo hoje: <span class="pct">${paceHoje}%</span></span>`+
    `<span>Hoje é o dia <b>${P.DIA_HOJE}</b> · ${esc(P.DIA_SEMANA)} · semana <b>N°${P.SEMANA_NUM}</b> (${esc(P.SEMANA_TIPO)})</span>`;

  const visitas = rotas.reduce((a,r)=>a+(VISITAS_DIA.geral[r]||0),0);
  $('nBase').textContent = tot.baseTotal.toLocaleString('pt-BR');
  $('xBase').innerHTML = `visitas hoje <b class="ok">${visitas}</b>`;

  const scHoje = rotas.every(r=>VISITAS_DIA.semCompra[r]!=null)
    ? rotas.reduce((a,r)=>a+VISITAS_DIA.semCompra[r],0) : null;
  const pctSem = (tot.semCompra!=null && tot.baseTotal)
    ? Math.round(tot.semCompra/tot.baseTotal*100) : null;
  $('nSem').textContent = tot.semCompra==null? '—' : tot.semCompra.toLocaleString('pt-BR');
  $('lSem').textContent = pctSem==null? 'Sem compra' : `Sem compra ${pctSem}%`;
  $('xSem').innerHTML = scHoje==null ? 'sem venda do dia'
    : `sem compra <b class="inl">hoje</b><b class="no">${scHoje}</b>`;

  const disp = P.COV_GRUPO[aba].filter(k=>ind[k] && !ind[k].unavailable);
  const noRitmo = disp.filter(k=>ind[k].onPace).length;
  const ritmoOk = noRitmo*2>=disp.length;
  $('nRitmo').textContent = `${noRitmo} / ${disp.length}`;
  $('nRitmo').className = 'n ' + (disp.length ? (ritmoOk?'ok':'no') : '');
  $('xRitmo').textContent = ritmoOk? 'dentro do ritmo' : 'abaixo do ritmo';

  $('puxa').innerHTML = piorSv();

  // Imperdoáveis ainda não tem fonte: o card "indisponível" fica oculto até o dado existir
  const oculta = k => k==='IMPERDOAVEIS' && (!ind[k] || ind[k].unavailable);
  $('lista').innerHTML = GROUPS[aba].filter(k=>!oculta(k)).map(k=>linha(k, ind[k], rotas)).join('');
  document.querySelectorAll('.ind[data-k]').forEach(el=>clicavel(el, ()=>abreIndicador(el.dataset.k, rotas)));
  encaixa($('lista'));
  const upd = (ONLINE && ONLINE.updatedAt) ? ONLINE.updatedAt.replace('T',' ').slice(0,16).split(' ') : null;
  $('rodape').innerHTML =
    `${rotas.length} rota${rotas.length>1?'s':''} · ${esc(P.MES_LABEL)} · ${P.TOTAL_DIAS_UTEIS} dias úteis<br>`+
    (tot.compraram!=null? `${tot.compraram.toLocaleString('pt-BR')} de ${tot.baseTotal.toLocaleString('pt-BR')} clientes já compraram no mês<br>`:'')+
    `<span id="rodapeStatus">${esc((statusAtualizado()||{}).texto || 'sem dados de venda online neste export')}</span>`+
    (upd? `<br><span class="fonte">Fonte: SAP Datasphere · ${upd[0].split('-').reverse().join('/')} ${upd[1]}</span>`:'')+
    `<div class="creditos">${esc(CONFIG.CREDITOS)}</div>`;
  RS.pinta();
}

function piorSv(){
  if(sel.rota) return '';
  const grupo = P.COV_GRUPO[aba];
  if(!sel.sv){
    // sem SV selecionado: compara as supervisões da gerência
    const svs = svsDe(sel.gc);
    if(svs.length < 2) return '';
    let pior=null;
    svs.forEach(sv=>{
      if(svExcluido(sv)) return;
      const a = agrega(Object.keys(DATA[sel.gc][sv])).ind;
      const disp = grupo.filter(k=>a[k] && !a[k].unavailable);
      if(!disp.length) return;
      const ok = disp.filter(k=>a[k].onPace).length;
      if(!pior || ok/disp.length < pior.razao) pior={rotulo:rotuloSv(sv),ok,tot:disp.length,razao:ok/disp.length};
    });
    if(!pior || pior.ok===pior.tot) return '';
    return `<div class="puxa"><div class="t">Supervisão que mais puxa a média para baixo: <b>${esc(pior.rotulo)}</b></div>
      <div class="s">${pior.ok} de ${pior.tot} indicadores na meta</div></div>`;
  }
  // SV selecionado, sem rota: compara as rotas dentro do SV
  const rotas = Object.keys(DATA[sel.gc][sel.sv]);
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
  const nome = esc(LABELS[k]||k);
  if(!b || b.unavailable)
    return `<div class="ind off"><div class="tit">${nome}</div>
      <div class="semdado">indisponível — falta a fonte deste indicador</div></div>`;
  const bom = b.onPace;
  const ini = `<div class="ind ${bom?'ok':''}" data-k="${esc(k)}" role="button" tabindex="0">`;
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
          <div class="big"><span class="seta">${bom?'▲':'▼'}</span>${oportHoje}</div>
          <div class="acao">${bom? 'no ritmo' : 'para reverter'}</div>
          <div class="opo">oportunidades do dia</div>
        </div>
        <div class="cr"><div class="olab">Online</div>${caixaOnline(k, rotas, b)}</div>
      </div></div>`;
  }
  if(GROUPS.VOLUME.includes(k)){
    if(rotas.length===1 && b.semDadoHoje){
      return `<div class="ind off"><div class="tit">${nome}</div>
        <div class="semdado">indisponível — sem venda hoje pra essa rota</div></div>`;
    }
    const dif = b.real - b.meta;
    return `${ini}
      <div class="tit">${nome}</div>
      <div class="row">
        <div class="cl">
          <div>Meta ${Math.round(b.meta).toLocaleString('pt-BR')}</div>
          <div>Real ${Math.round(b.real).toLocaleString('pt-BR')}</div>
          <div class="dif ${dif>=0?'pos':'neg'}">Diferença ${dif>0?'+':''}${Math.round(dif).toLocaleString('pt-BR')}</div>
        </div>
        <div class="cm">
          <div class="big"><span class="seta">${bom?'▲':'▼'}</span>${b.pctTendencia==null?'—':b.pctTendencia+'%'}</div>
          <div class="acao">${bom? 'no ritmo' : 'abaixo da tendência'}</div>
          <div class="opo">${b.meta? Math.round(b.real/b.meta*100) : 0}% real</div>
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
        <div class="big"><span class="seta">${bom?'▲':'▼'}</span>${b.pct==null?'—':b.pct+'%'}</div>
        <div class="acao">${b.gap>0? `faltam ${b.gap} hoje` : 'no ritmo'}</div>
        ${opo? `<div class="opo">oportunidades do dia ${opo}</div>`:''}
      </div>
      <div class="cr"><div class="olab">Online</div>${caixaOnline(k, rotas, b)}</div>
    </div></div>`;
}

// número grande da caixa Online: a fonte é ajustada por encaixa() à largura real da caixa
const numObox = txt => `<b data-fit="23" data-fit-min="10">${txt}</b>`;

function caixaOnline(k, rotas, b){
  if(k==='VENDAZERO'){
    // sempre verde: é contagem positiva de reversões, não tem meta pra comparar
    const revHoje = rotas.reduce((a,r)=>a+((REVERTIDO_HOJE||{})[r]||0),0);
    return `<div class="obox ok">${numObox(revHoje)}<span>revertidos</span></div>`;
  }
  if(GROUPS.VOLUME.includes(k)){
    const volHoje = rotas.reduce((a,r)=>a+(((ONLINE&&ONLINE.volume||{})[r]||{})[k]||0),0);
    const metaDia = b.metaDia||0;
    const ok = volHoje >= metaDia;
    return `<div class="obox ${ok?'ok':'no'}">${numObox(Math.round(volHoje).toLocaleString('pt-BR'))}
      <span>meta do dia ${Math.round(metaDia).toLocaleString('pt-BR')}</span></div>`;
  }
  // Meta do dia: fora do ritmo é o próprio "faltam X"; no ritmo é teto(Meta / dias úteis).
  const fatia = b.meta ? Math.ceil(b.meta/P.TOTAL_DIAS_UTEIS) : 0;
  const metaDia = b.gap > 0 ? b.gap : fatia;
  if(!ONLINE)
    return `<div class="obox nd"><b>—</b><span>meta do dia ${metaDia}</span></div>`;
  const soma = rotas.reduce((a,r)=>a+(((ONLINE.rotas||{})[r]||{})[k]||0),0);
  const ok = soma>=metaDia;
  return `<div class="obox ${ok?'ok':''}">${numObox(soma)}
    <span>${ok?'no ritmo':`meta do dia ${metaDia}`}</span></div>`;
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
  const rotas = rotasAtuais();
  const l = listaClientes(rotas);
  abre('Visitas de hoje', `${l.length} clientes · ${P.DIA_SEMANA}, semana N°${P.SEMANA_NUM} (${P.SEMANA_TIPO})`,
    l.length? l.map(([r,c])=>itemHtml(r,c,null,onlineIds(r).includes(c[0]))).join('') : `<div class="vazio">Nenhuma visita agendada.</div>`);
});
clicavel($('cSem'), ()=>{
  const rotas = rotasAtuais();
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

function abreIndicador(k, rotas){
  const b = agrega(rotas).ind[k];
  if(!b || b.unavailable) return;
  const LIM = CONFIG.LIMITE_LISTA;

  if(k==='VENDAZERO'){
    const equip = [];
    rotas.forEach(r=>(VENDAZERO_CLIENTES[r]||[]).forEach(e=>equip.push([r,e])));
    let chip='Todos';
    const pinta=()=>{
      const vis = equip.filter(([r,e])=> chip==='Todos' ||
        (chip==='Hoje' ? e.hoje===1 : (e.dia||'').startsWith(chip)))
        .sort((a,b)=>b[1].vdz-a[1].vdz);
      $('dCorpo').innerHTML = chipsHtml(chip) +
        (vis.length? vis.slice(0,LIM).map(([r,e])=>`<div class="item ${e.revertido?'riscado':''}"><div>
            <div class="nm">${esc(e.nome)}${e.revertido?' <span class="tagOnline">Revertido</span>':''}</div>
            <div class="sb">${esc(e.tipo)} · rota ${esc(r)} · ${esc(e.dia||'sem agenda')}</div></div>
            <div class="bd">${e.vdz} geladeira${e.vdz>1?'s':''}</div></div>`).join('')
                 : `<div class="vazio">Ninguém neste filtro.</div>`) +
        (vis.length>LIM? `<div class="vazio">+ ${vis.length-LIM} equipamentos — filtre por rota para ver todos.</div>`:'');
      $('dCorpo').querySelectorAll('.dchip').forEach(el=>el.onclick=()=>{chip=el.dataset.d;pinta();});
    };
    const revHoje = rotas.reduce((a,r)=>a+((REVERTIDO_HOJE||{})[r]||0),0);
    const oportHoje = rotas.reduce((a,r)=>a+((OPORTUNIDADE_HOJE||{})[r]||0),0);
    abre(LABELS[k]||k, `${b.real} equipamentos zerados · ${b.gap>0? `${b.gap} para reverter` : 'no ritmo'} · ${revHoje} revertidos hoje · ${oportHoje} na agenda de hoje`, '');
    pinta();
    return;
  }

  const todos = [];
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
    $('dCorpo').innerHTML = chipsHtml(chip) +
      (vis.length? vis.slice(0,LIM).map(([r,c])=>itemHtml(r,c,null,onlineIds(r,k).includes(c[0]))).join('')
                 : `<div class="vazio">Ninguém neste filtro.</div>`) +
      (vis.length>LIM? `<div class="vazio">+ ${vis.length-LIM} clientes — filtre por rota para ver todos.</div>`:'');
    $('dCorpo').querySelectorAll('.dchip').forEach(el=>el.onclick=()=>{chip=el.dataset.d;pinta();});
  };
  const nota = (k==='KS TT') ? ' · lista restrita a bares, lanchonetes, restaurantes e padarias' : '';
  abre(LABELS[k]||k, `Meta ${b.meta} · Real ${b.real} · ${b.gap>0?`faltam ${b.gap} para o ritmo de hoje`:'no ritmo'}${nota}`, '');
  pinta();
}

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
  const rotas = rotasAtuais();
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
  const label = esc(P.LABELS_CURTO[k]||LABELS[k]);
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
const tileCob = (k, cls, txt) =>
  `<div class="tile ${cls}"><div class="t" data-fit="13" data-fit-min="9.5">${esc(P.LABELS_CURTO[k]||LABELS[k])}</div><div class="e">${txt}</div></div>`;
const blocoImperdoaveis = `<h4>Imperdoáveis</h4><div class="semim">Sem dado de Imperdoáveis pra essa rota.</div>`;

function buscaCliente(){
  const v=$('q').value.trim(); if(!v){$('cli').innerHTML='';return;}
  const id=parseInt(v,10);
  const rotas = rotasAtuais();
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
  const grupo = P.COV_GRUPO[aba];              // só os itens da aba ativa
  let chips;
  if(aba==='VOLUME'){
    // Volume não tem cobertura binária: usa a barra de status de meta por cliente (VOLUME_CLIENTE)
    const porCliente = ((P.VOLUME_CLIENTE||{})[rota]||{})[achado[0]];
    chips = grupo.map((k,i)=> tileVolume(k, porCliente ? porCliente[i] : null)).join('');
  } else {
    chips = grupo.map(k=>{
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
  $('cli').innerHTML = `<div class="cli"><h3>${esc(achado[1])}${tagVZ}${tagAtivo}</h3>
    <div class="meta">PV ${esc(achado[0])} · ${esc(SEGS[achado[2]]||'—')} · rota ${esc(rota)} · visita ${esc(DIAS[achado[3]]||'—')}</div>
    <div class="painel">
      <div class="grid13">${chips}</div>
      ${blocoImperdoaveis}
    </div></div>`;
  encaixa($('cli'));
}
/* Consolidado de rede: soma meta/real (Volume) ou cobertos/elegíveis (ICS GC, Novos Negócios)
   de todas as lojas da rede dentro do escopo de filtro atual. */
function renderRede(rede){
  const membros = rede.membros;                  // [[rota,cid], ...]
  const rotasUnicas = [...new Set(membros.map(m=>m[0]))];
  const grupo = P.COV_GRUPO[aba];
  let chips;
  if(aba==='VOLUME'){
    chips = grupo.map((k,i)=>{
      let metaSum=0, realSum=0, temMeta=false;
      membros.forEach(([r,cid])=>{
        const porCliente = ((P.VOLUME_CLIENTE||{})[r]||{})[cid];
        const bloco = porCliente ? porCliente[i] : null;
        if(bloco){ metaSum+=bloco[0]; realSum+=bloco[1]; temMeta=true; }
      });
      if(!temMeta || metaSum<=0) return tileVolume(k, null);
      const pct = Math.round(realSum/metaSum*100);
      const status = pct>=100?2:(pct>=P.PACE_ONTEM_PCT?1:0);
      return tileVolume(k, [Math.round(metaSum*10)/10, Math.round(realSum*10)/10, pct, status]);
    }).join('');
  } else {
    chips = grupo.map(k=>{
      if(!P.FONTES.venda) return tileCob(k, 'nd', 'sem venda');
      let elegiveis=0, cobertos=0;
      membros.forEach(([r,cid])=>{
        const c = (CLIENT_ROSTER[r]||[]).find(x=>x[0]===cid);
        if(k==='KS TT' && (!c || !ehKstt(c))) return;   // fora do denominador, igual ao cliente avulso
        elegiveis++;
        if((((COBERTOS[r]||{})[k])||[]).includes(cid)) cobertos++;
      });
      if(elegiveis===0) return tileCob(k, 'na', 'não elegível');
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
  $('cli').innerHTML = `<div class="cli"><h3>${esc(rede.nome)}<span class="tagRede">Rede</span>${tagVZ}${tagAtivoR}</h3>
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

/* ---------- carga dos JSONs ---------- */
// cache:'no-cache' revalida com ETag: só baixa de novo quando o arquivo mudou no servidor.
async function buscaJson(nome){
  const r = await fetch(CONFIG.DATA_BASE + nome, {cache:'no-cache'});
  if(!r.ok) throw new Error(`${nome}: HTTP ${r.status}`);
  return r.json();
}
async function puxaOnline(){
  try{
    ONLINE = await buscaJson(CONFIG.ONLINE_URL);
    render();
  }catch(e){ console.warn('online.json indisponível', e); }
}
