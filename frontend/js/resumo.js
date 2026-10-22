/* =====================================================================
   RESUMO DE VENDAS (29/09/26) — botão no fim da consulta.
   Modelo 2 aprovado: "Faltam X"/"Meta dia X" e Online em destaque,
   seta com % em segundo plano. Blocos independentes: Volume, ICS GC,
   Novos Negócios. Colunas seguem o filtro (GC -> SVs, SV -> rotas, rota).
   Mesmas regras da Parcial: % = (Real ∪ Online)/Meta; ritmo = PACE_ONTEM;
   faltam = ceil(Meta*DIA_HOJE/TOTAL) - Real (sem descontar Online);
   Volume verde por % Tendência >= 100 sobre a meta da rota (tendência do SAC: só o faturado + Neg Restante; o online de hoje
   fica na coluna própria e não entra); no fechamento do mês, verde por % realizado >= 100, sem meta do dia.
   Online verde ao bater o número ao lado.
   Rotas Neutraliza e virtuais (payload NEUTRALIZA_ROTAS / VIRTUAIS_ROTAS) não têm coluna nem entram na coluna da
   supervisão; Meta e Real delas entram só no total da gerência (1ª coluna). Com o filtro "Neutraliza" (ou uma
   rota Neutraliza), o Resumo mostra a gerência. Gerência de um grupo (IT+MO) no "Total": o total do grupo e as
   duas gerências lado a lado, como na Diretoria; com uma das duas no seletor, o Resumo dela.
   ===================================================================== */
const RS = (()=>{
  const VOL_ORD = ['VOL REFRIGERANTES','VOL CERVEJAS','VOL STILL','VOL AGUA MINERAL','VOL DEST+ART+CND'];
  const ICS_ORD = ['CCTM 2L PET','KS TT','REFRI SABORES ZERO','POWERADE','KAPO','CERVEJAS','CERVEJAS 600ML RETORNAVEL','EISENBAHN','ARTD KO'];
  const CURTO_X = {'REFRI SABORES ZERO':'Refri Sab. Zero','CERVEJAS 600ML RETORNAVEL':'Cerv. 600ml Ret.'};
  const blocos = {vol:true, ics:true, nov:false};
  let aberto = false, COMPACTO = false, LARG_MIN = 380;
  const n = v => { const r = Math.round(v); return (r===0?0:r).toLocaleString('pt-BR'); };
  const nome = k => rotuloFront(k, CURTO_X[k] || (P.LABELS_CURTO||{})[k] || LABELS[k]);

  /* ---- soma de um conjunto de rotas (mesma conta da Parcial) ---- */
  function soma(gc, rotas){
    const s = {c:{}, v:{}, vz:{meta:0,real:0,rev:0,op:0,n:0}};
    const OC = (ONLINE && ONLINE.clientes) || {}, OV = (ONLINE && ONLINE.volume) || {};
    const ids = {};
    rotas.forEach(r=>{
      const d = nodo(gc, r); if(!d) return;
      [...new Set([...ICS_ORD, ...GROUPS.NOVOS_NEG])].forEach(k=>{   // ARTD KO esta nos dois grupos: Set evita somar em dobro
        const b = d.indicators[k]; if(!b || b.unavailable) return;
        const t = s.c[k] || (s.c[k] = {meta:0, real:0, onl:0, tot:0});
        const idsR = new Set(((COBERTOS[r]||{})[k])||[]), idsO = ((OC[r]||{})[k])||[];
        t.meta += b.meta||0; t.real += b.real||0; t.onl += idsO.length;
        idsO.forEach(i=>idsR.add(i)); t.tot += idsR.size;
      });
      VOL_ORD.forEach(k=>{
        const b = d.indicators[k]; if(!b || b.unavailable) return;
        const t = s.v[k] || (s.v[k] = {meta:0, real:0, tend:0, mdia:null, onl:0, sem:false});
        t.meta += b.meta||0; t.real += b.real||0; t.tend += b.tendencia||0;
        if(b.metaDia!=null) t.mdia = (t.mdia||0) + b.metaDia;
        t.onl += ((OV[r]||{})[k])||0; if(b.semDadoHoje) t.sem = true;
      });
      const z = d.indicators.VENDAZERO || {};
      s.vz.rev += (REVERTIDO_HOJE||{})[r]||0; s.vz.op += (OPORTUNIDADE_HOJE||{})[r]||0;
      if(!z.unavailable){ s.vz.meta += z.meta||0; s.vz.real += z.real||0; s.vz.n++; }
    });
    if(rotas.length===1) for(const k in s.v) if(s.v[k].sem) s.v[k].indisp = true;
    return s;
  }

  /* ---- células ---- */
  const kpi = (rot, val, cls) => `<span class="rs-k ${cls||''}"><small>${rot}</small><strong>${val}</strong></span>`;
  const VAZIO = '<div class="rs-cel"><span class="rs-sec">—</span></div>';
  const seta = ok => `<span class="${ok?'rs-ok':'rs-bad'}">${ok?'▲':'▼'}</span>`;
  function celVol(x){
    if(!x || x.indisp || !x.meta) return VAZIO;
    const fech = !!P.FECHAMENTO, semMd = x.mdia==null;
    const p = (fech ? x.real : x.tend)/x.meta*100, ok = p>=100, onOk = !semMd && x.onl >= x.mdia;
    return `<div class="rs-cel"><div class="rs-par">${kpi('M.dia', semMd?'—':n(x.mdia), !semMd && x.mdia<=0?'rs-meta0':'')}${kpi('Online', n(x.onl), semMd ? '' : 'rs-on '+(onOk?'rs-ok':'rs-bad'))}</div><span class="rs-sec">${seta(ok)} ${Math.round(p)}% ${fech?'real':'tend.'}</span></div>`;
  }
  function celInd(x){
    if(!x || !x.meta) return {ok:null, h:VAZIO};
    const p = Math.round(x.tot/x.meta*100), ok = p >= P.PACE_ONTEM_PCT;
    const gap = Math.max(0, Math.ceil(x.meta*P.DIA_HOJE/P.TOTAL_DIAS_UTEIS) - x.real);
    const fatia = Math.ceil(x.meta/P.TOTAL_DIAS_UTEIS), obj = gap>0 ? gap : fatia, onOk = x.onl >= obj;
    const esq = gap>0 ? kpi('Faltam', n(gap), 'rs-faltam') : kpi(COMPACTO?'M.dia':'Meta dia', n(fatia), 'rs-meta0');
    return {ok, h:`<div class="rs-cel"><div class="rs-par">${esq}${kpi('Online', n(x.onl), 'rs-on '+(onOk?'rs-ok':'rs-bad'))}</div><span class="rs-sec">${seta(ok)} ${p}% do mês</span></div>`};
  }
  function celVz(z){
    if(!z.n) return {ok:null, h:VAZIO};
    const pend = Math.ceil(Math.max(0, z.real - z.meta)), ok = pend===0, revOk = z.rev >= z.op;
    return {ok, h:`<div class="rs-cel"><div class="rs-par">${kpi('Reverter', n(z.op))}${kpi('Revert.', n(z.rev), 'rs-on '+(revOk?'rs-ok':'rs-bad'))}</div><span class="rs-sec">${seta(ok)} ${ok?'no ritmo':'pend. mês '+n(pend)}</span></div>`};
  }

  /* ---- colunas conforme o filtro atual (ou a gerência escolhida no seletor da Diretoria) ---- */
  // filtro do Resumo: a Neutraliza não tem coluna, então o filtro "Neutraliza" (ou uma rota dela) vira a gerência
  const filtroRs = () => (sel.sv===SV_NEUTRA || (sel.rota && ehNeutraliza(sel.rota))) ? {sv:'', rota:''}
    : {sv:sel.sv, rota:sel.rota};
  function colunas(){
    if(sel.modo==='dir' && !sel.dgc){
      // Diretoria: total + uma coluna por gerência com dados (Neutraliza no total de cada uma)
      const gcs = gcsComDados();
      return {titulo: 'Diretoria', sub: 'Diretoria → gerências',
              cols:[['Diretoria', gcs.flatMap(g=>rotasDe(g,''))], ...gcs.map(g=>['GC.'+g, rotasDe(g,'')])]};
    }
    // Diretoria com uma gerência no filtro: o resumo dela (gerência + supervisões), como na Gerência
    const gc = (sel.modo==='dir') ? sel.dgc : sel.gc;
    // Neutraliza e virtuais sem coluna; o total da gerência (1ª coluna) inclui as rotas delas
    const porSv = () => ({titulo:rotuloGc(gc), sub:'Gerência → supervisores',
      cols:[['GC.'+gc, rotasDe(gc,'')], ...svsVisiveis(gc).map(s=>[s, rotasNormais(gc, s)])]});
    if(sel.modo==='dir') return porSv();
    const {sv, rota} = filtroRs();
    if(rota){
      const d = nodo(gc, rota);
      return {titulo:'Rota '+rota, sub:`${rotuloSv(rotaSv(gc,rota))} → rota ${rota}${d&&d.consultor?' · '+titulo(d.consultor):''}`, cols:[[rota,[rota]]]};
    }
    if(sv){
      const rs = rotasNormais(gc, sv);
      return {titulo:sv, sub:rotuloSv(sv)+' → rotas', cols:[[sv, rs], ...rs.map(r=>[r,[r]])]};
    }
    // grupo de gerências no "Total": as duas lado a lado, como na Diretoria (o total do grupo + uma coluna por gerência)
    if(ehGrupo(gc)){
      const gcs = membrosGc(gc).filter(g=>DATA[g]), nomes = membrosGc(gc).map(g=>nomesGc()[g]);
      const total = Object.assign([membrosGc(gc).map(g=>'GC.'+g).join(' + '), rotasDe(gc,'')],
                                  {nome: nomes.every(Boolean) ? nomes.join(' + ') : ''});
      return {titulo:rotuloGc(gc), sub:'Total → gerências', cols:[total, ...gcs.map(g=>['GC.'+g, rotasDe(g,'')])]};
    }
    return porSv();
  }
  // cabeçalho da coluna: código (GC.G1 / SV.G1.1 / rota) + nome da praça (GC_NOMES) ou primeiro nome do supervisor
  const cab = c => { if(c.vazio) return '';
    const nm = c.nome!=null ? c.nome : /^GC\./.test(c[0]) ? nomesGc()[c[0].slice(3)] : nomeSv(c[0]);
    return esc(c[0]) + (nm ? `<small class="rs-svnome">${esc(nm)}</small>` : ''); };
  // coluna em branco: completa as faixas da Diretoria para as colunas ficarem alinhadas entre as faixas
  const colVazia = () => Object.assign(['', [], {c:{}, v:{}, vz:{n:0}}], {vazio:true});
  // foco0: a 1ª coluna é o total (destacada); nas faixas seguintes da Diretoria não é
  const thead = (rot, cols, foco0=true) => `<thead><tr><th class="rs-nome">${rot}</th>${cols.map((c,i)=>`<th class="${i===0&&foco0?'rs-foco':''}">${cab(c)}</th>`).join('')}</tr></thead>`;
  function tabela(linhas, todas, comVz, foco0=true){
    const cols = todas.filter((c,i)=> (i===0 && foco0) || c.vazio || linhas.some(k=>c[2].c[k] && c[2].c[k].meta));
    const cont = cols.map(()=>[0,0]);
    const td = (i,r)=>{ if(cols[i].vazio) return '<td></td>'; if(r.ok!==null){cont[i][1]++; if(r.ok) cont[i][0]++;} return `<td>${r.h}</td>`; };
    let body = linhas.map(k=>`<tr><td class="rs-nome">${nome(k)}</td>${cols.map((c,i)=>td(i, celInd(c[2].c[k]))).join('')}</tr>`).join('');
    if(comVz) body += `<tr><td class="rs-nome">Venda Zero</td>${cols.map((c,i)=>td(i, celVz(c[2].vz))).join('')}</tr>`;
    body += `<tr class="rs-tot"><td class="rs-nome">No ritmo</td>${cont.map((v,i)=>`<td>${cols[i].vazio?'':(v[1]?v[0]+'/'+v[1]:'—')}</td>`).join('')}</tr>`;
    const cards = cols.map((c,i)=>{
      if(c.vazio) return '';
      const lin = linhas.map(k=>{ const r = celInd(c[2].c[k]); return r.ok===null ? '' : `<div class="rs-lin"><span class="rs-nome">${nome(k)}</span>${r.h}</div>`; }).join('')
        + (comVz ? (()=>{ const r = celVz(c[2].vz); return r.ok===null ? '' : `<div class="rs-lin"><span class="rs-nome">Venda Zero</span>${r.h}</div>`; })() : '');
      const ct = cont[i][1] ? `<small>${cont[i][0]}/${cont[i][1]} no ritmo</small>` : '';
      return `<div class="rs-card ${i===0&&foco0?'rs-foco':''}"><div class="rs-cardh"><span>${cab(c)}</span>${ct}</div>${lin}</div>`;
    }).join('');
    return {html:`<div class="rs-tab"><table>${thead('Indicador', cols, foco0)}<tbody>${body}</tbody></table></div><div class="rs-cards">${cards}</div>`, cont, cols};
  }

  /* ---- faixas: na Diretoria, acima de N gerências (CONFIG.RS_COLUNAS_FAIXA), quebra em faixas de N;
     o total fica no começo da 1ª faixa ---- */
  function faixas(cols){
    const N = CONFIG.RS_COLUNAS_FAIXA || 8;
    if(!(sel.modo==='dir' && !sel.dgc) || cols.length-1 <= N) return [cols];
    const out = [];
    for(let i=1; i<cols.length; i+=N) out.push(cols.slice(i, i+N));
    out[0] = [cols[0], ...out[0]];
    // faixas com o mesmo nº de colunas (as que faltam ficam em branco): colunas alinhadas entre as faixas
    out.forEach(f=>{ while(f.length < out[0].length) f.push(colVazia()); });
    return out;
  }
  /* ---- placa ATENÇÃO: colunas com menos de LIMIAR_ATENCAO dos indicadores de ICS no ritmo.
     CONFIG.LIMIAR_ATENCAO = null -> desligada (não aparece). Neutraliza/ocultas não entram. ---- */
  function placaAtencao(tabs){
    const lim = CONFIG.LIMIAR_ATENCAO;
    if(lim==null) return '';
    const cand = [];
    tabs.forEach((t,ti)=>t.cols.forEach((c,i)=>{
      if(ti===0 && i===0) return;                    // o total não entra
      const ct = t.cont[i];
      if(ct[1] && !svExcluido(c[0]) && ct[0]/ct[1] < lim) cand.push([c[0], ct]);
    }));
    if(!cand.length) return '';
    return `<div class="rs-atencao">ATENÇÃO: ${cand.map(([c,ct])=>`${esc(rotuloSv(c))} (${ct[0]}/${ct[1]} no ritmo)`).join(' · ')}</div>`;
  }
  /* ---- monta a folha ---- */
  function pinta(){
    if(!aberto || !P) return;
    const {titulo:tit, sub, cols} = colunas();
    cols.forEach(c=>c[2] = soma(sel.gc, c[1]));
    const fx = faixas(cols);
    COMPACTO = Math.max(...fx.map(f=>f.length)) >= 7;
    const folha = document.getElementById('rsFolha');
    folha.classList.toggle('rs-compacto', COMPACTO);
    LARG_MIN = Math.max(380, 130 + Math.max(...fx.map(f=>f.length))*(COMPACTO?112:150));
    folha.style.minWidth = (innerWidth >= 700 && innerWidth < 1000) ? LARG_MIN + 'px' : '';
    const volT = fx.map((fc,fi)=>{
      const volTab = `<table>${thead('Agrupador', fc, fi===0)}<tbody>${VOL_ORD.map(k=>`<tr><td class="rs-nome">${rotuloFront(k, LABELS[k])}</td>${fc.map(c=>`<td>${c.vazio?'':celVol(c[2].v[k])}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
      const volCards = fc.filter(c=>!c.vazio).map((c,i)=>`<div class="rs-card ${i===0&&fi===0?'rs-foco':''}"><div class="rs-cardh"><span>${cab(c)}</span></div>${VOL_ORD.map(k=>{ const x=c[2].v[k]; return (!x||x.indisp||!x.meta) ? '' : `<div class="rs-lin"><span class="rs-nome">${rotuloFront(k, LABELS[k])}</span>${celVol(x)}</div>`; }).join('')}</div>`).join('');
      return `<div class="rs-faixa"><div class="rs-tab">${volTab}</div><div class="rs-cards">${volCards}</div></div>`;
    }).join('');
    const ics = fx.map((fc,fi)=>tabela(ICS_ORD, fc, true, fi===0)), nov = fx.map((fc,fi)=>tabela(GROUPS.NOVOS_NEG, fc, false, fi===0));
    const html = ts => ts.map(t=>`<div class="rs-faixa">${t.html}</div>`).join('');
    const up = (ONLINE && ONLINE.updatedAt) || '';
    const placa = placaAtencao(ics);
    const st = statusAtualizado();
    const tag = st ? `<span class="rs-tag ${st.cor==='verde'?'rs-tag-on':'rs-tag-off'}">${esc(st.texto)}</span>` : `<span class="rs-tag rs-tag-off">sem venda online</span>`;
    const hoje = up ? up.split('T')[0].split('-').reverse().slice(0,2).join('/') : '';
    const helm = (document.querySelector('header .helm')||{}).src || '';
    folha.innerHTML = `
      <div class="rs-cab"><div>
          <div class="rs-marca">${helm?`<img src="${helm}" alt="">`:''}COMERCIAL BANDEIRANTES</div>
          <h2>Resumo de vendas · ${esc(tit)}</h2>
          <div class="rs-sub">${esc(sub)} · ${esc(P.DIA_SEMANA)} ${hoje} · dia útil ${P.DIA_HOJE}/${P.TOTAL_DIAS_UTEIS}</div></div>
        <div class="rs-tags">${tag}<span class="rs-tag rs-tag-rit">Objetivo do ritmo hoje: ${Math.round(P.DIA_HOJE/P.TOTAL_DIAS_UTEIS*100)}%</span></div></div>
      ${placa}
      ${blocos.vol?`<div class="rs-bloco"><h3>Volume — ${P.FECHAMENTO?'realizado do mês (fechamento)':'tendência do mês'} <small>${P.FECHAMENTO?'Online de hoje, sem meta do dia':'Online verde ao bater a Meta dia'}</small></h3>${volT}</div>`:''}
      ${blocos.ics?`<div class="rs-bloco"><h3>Coberturas — ICS GC <small>Online verde ao bater o faltam</small></h3>${html(ics)}</div>`:''}
      ${blocos.nov?`<div class="rs-bloco"><h3>Novos Negócios <small>Online verde ao bater o faltam</small></h3>${html(nov)}</div>`:''}`;
    document.querySelectorAll('[data-rsb]').forEach(b=>b.setAttribute('aria-pressed', blocos[b.dataset.rsb]));
  }

  /* ---- link com filtro + blocos ---- */
  function linkAtual(){
    const q = new URLSearchParams();
    q.set('resumo', Object.keys(blocos).filter(k=>blocos[k]).join(','));
    if(sel.modo==='dir'){ q.set('modo', 'dir'); if(sel.dgc) q.set('gc', sel.dgc); }
    else { const f = filtroRs(); q.set('gc', sel.gc); if(f.sv) q.set('sv', f.sv); if(f.rota) q.set('rota', f.rota); }
    return location.origin + location.pathname + '?' + q.toString().replace(/%2C/g, ',');
  }
  const aviso = t => { const el = document.getElementById('rsToast'); el.textContent = t; clearTimeout(aviso.t); aviso.t = setTimeout(()=>el.textContent='', 4000); };

  async function compartilhar(){
    const url = linkAtual(), titulo = 'Resumo de vendas · ' + colunas().titulo;
    if(navigator.share){ try{ await navigator.share({title:titulo, text:titulo, url}); return; }catch(e){ if(e && e.name==='AbortError') return; } }
    try{ await navigator.clipboard.writeText(url); aviso('Link copiado. Cole no WhatsApp.'); }
    catch(e){ prompt('Copie o link:', url); }
  }

  // bibliotecas do PDF vêm do cdnjs com verificação de integridade (SRI)
  function carregaScript(lib, global){
    if(window[global]) return Promise.resolve();
    return new Promise((ok, erro)=>{
      const s = document.createElement('script');
      s.src = lib.src;
      if(lib.integrity){ s.integrity = lib.integrity; s.crossOrigin = 'anonymous'; s.referrerPolicy = 'no-referrer'; }
      s.onload = ok; s.onerror = erro; document.head.appendChild(s);
    });
  }
  /* ---- entrega do PDF (Resumo e Painel de Ritmo): no celular, a folha de compartilhar com o arquivo; senão (ou se
     ela falhar), o download. Devolve 'compartilhado', 'cancelado' (o usuário fechou a folha) ou 'salvo'. ---- */
  async function salvaPdf(blob, nomeArq){
    const arq = new File([blob], nomeArq, {type:'application/pdf'});
    if(navigator.canShare && navigator.canShare({files:[arq]}) && matchMedia('(pointer:coarse)').matches){
      try{ await navigator.share({files:[arq], title:nomeArq}); return 'compartilhado'; }
      catch(e){ if(e && e.name==='AbortError') return 'cancelado'; }
    }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nomeArq;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href), 4000);
    return 'salvo';
  }
  /* ---- divisão do PDF em páginas (função pura: sem DOM).
     atomos = [cabeçalho, bloco 1, bloco 2...], cada um {t, b} (topo e base em px dentro da folha); H0 = altura da
     página; altTotal = altura da folha. O cabeçalho (.rs-cab + .rs-atencao) nunca fica sozinho: vira um átomo só com
     o 1º bloco (do topo do cabeçalho à base do bloco). Cada página leva os átomos seguintes enquanto couberem; um
     átomo mais alto que H0 fica sozinho e a página cresce (altura = max(H0, faixa)). Saída: faixas [y0, y1]. ---- */
  function paginas(atomos, H0, altTotal){
    const at = atomos.length > 1 ? [{t:Math.min(atomos[0].t, atomos[1].t), b:Math.max(atomos[0].b, atomos[1].b)}, ...atomos.slice(2)]
                                 : atomos.slice();
    if(!at.length) return [[0, altTotal]];
    const out = []; let i = 0, ini = 0;
    while(i < at.length){
      let j = i; while(j+1 < at.length && at[j+1].b - ini + 8 <= H0) j++;
      out.push([ini, Math.min(altTotal, at[j].b + 10)]);
      i = j + 1; if(i < at.length) ini = Math.max(0, at[i].t - 8);
    }
    return out;
  }
  /* ---- PDF: números que não cabem na caixa (a Inter é mais larga). (a) o CSS do .rs-pdf dá mais largura e menos folga
     às caixas, sem mudar a fonte; (b) encaixa() reduz a fonte do número, só no PDF, até FONTE_MIN_PDF; (c) se ainda
     faltar, a folha (W) fica mais larga. Mede na própria página: o CSS do .rs-pdf não depende da largura da tela. ---- */
  const FONTE_MIN_PDF = 10;
  const numsPdf = folha => folha.querySelectorAll('.rs-tab .rs-k strong');
  // maior estouro (px) numa célula, caixa ou texto das tabelas
  const excessoPdf = folha => Math.max(0, ...[...folha.querySelectorAll('.rs-tab th, .rs-tab td, .rs-tab .rs-k, .rs-tab .rs-k > *')]
    .map(el => el.scrollWidth - el.clientWidth));
  function encaixaPdf(folha, W){
    const cols = Math.max(1, ...[...folha.querySelectorAll('.rs-tab thead tr')].map(tr => tr.children.length - 1));
    for(let t = 0; ; t++){
      folha.style.width = W+'px';
      numsPdf(folha).forEach(s=>{ s.dataset.fit = ''; s.dataset.fitMin = FONTE_MIN_PDF; });
      encaixa(folha);
      const ex = excessoPdf(folha);
      if(ex <= 0 || t === 7) break;              // a última tentativa fica com a largura que mediu
      W += Math.ceil(2*ex + 4) * cols;           // as duas caixas da célula, em todas as colunas
    }
    return W;
  }
  const limpaPdf = folha => numsPdf(folha).forEach(s=>{ delete s.dataset.fit; delete s.dataset.fitMin; s.style.fontSize = ''; s.style.whiteSpace = ''; });
  async function baixarPdf(){
    const btn = document.getElementById('rsImg'); btn.disabled = true; aviso('Gerando PDF…');
    try{
      await Promise.all([
        carregaScript(CONFIG.CDN.html2canvas, 'html2canvas'),
        carregaScript(CONFIG.CDN.jspdf, 'jspdf')
      ]);
      // a captura usa a fonte do painel (Inter): espera ela carregar para nada sair com a fonte reserva
      if(document.fonts) await document.fonts.ready;
      const folha = document.getElementById('rsFolha');
      const minAntes = folha.style.minWidth, largAntes = folha.style.width;
      /* 08/10/26: PDF sempre no formato da visao PC (tabela), em paginas deitadas (16:9) que cabem na tela na horizontal.
         Bloco mais alto que a pagina ganha uma pagina mais alta (rolagem so na vertical). Vale p/ celular, tablet e PC. */
      let W = innerWidth >= 1000 ? Math.ceil(folha.scrollWidth) : Math.max(1200, LARG_MIN);
      folha.classList.add('rs-pdf'); folha.style.width = W+'px'; folha.style.minWidth = '0';
      let canvas, atomos = [], altTotal = 0;
      try{
        W = encaixaPdf(folha, W);
        await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
        /* mede os blocos DENTRO da renderizacao (largura W, estilos do PC), nao na janela real do celular */
        const mede = (doc) => {
          const f = doc.getElementById('rsFolha'); if(!f) return;
          const topF = f.getBoundingClientRect().top;
          const R = el => { const r = el.getBoundingClientRect(); return {t:r.top-topF, b:r.bottom-topF}; };
          const uni = (x,y) => ({t:Math.min(x.t,y.t), b:Math.max(x.b,y.b)});
          let cab = R(f.querySelector('.rs-cab')); const at = f.querySelector('.rs-atencao'); if(at) cab = uni(cab, R(at));
          atomos = [cab];
          f.querySelectorAll('.rs-bloco').forEach(bl=>atomos.push(R(bl)));
        };
        canvas = await html2canvas(folha, {scale:2, backgroundColor:'#ffffff', useCORS:true, windowWidth:W, width:W, onclone: mede});
        altTotal = canvas.height/2;
      } finally { limpaPdf(folha); folha.classList.remove('rs-pdf'); folha.style.width = largAntes; folha.style.minWidth = minAntes; }
      const H0 = Math.round(W*9/16);
      const pags = paginas(atomos, H0, altTotal);
      const altP = ([y0,y1]) => Math.max(H0, Math.ceil(y1-y0));
      let pdf = new window.jspdf.jsPDF({orientation:'landscape', unit:'px', format:[W, altP(pags[0])], hotfixes:['px_scaling'], compress:true});
      pags.forEach((pg,n)=>{
        const [y0,y1] = pg, h = altP(pg);
        const pc = document.createElement('canvas'); pc.width = W*2; pc.height = h*2;
        const cx = pc.getContext('2d'); cx.fillStyle = '#ffffff'; cx.fillRect(0,0,pc.width,pc.height);
        cx.drawImage(canvas, 0, y0*2, W*2, (y1-y0)*2, 0, 0, W*2, (y1-y0)*2);
        if(n>0) pdf.addPage([W,h], h>W?'portrait':'landscape');
        pdf.addImage(pc.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, W, h);
      });
      pdf.setProperties({title:'Resumo de vendas · '+colunas().titulo, author:'Comercial Bandeirantes'});
      const nomeArq = `Resumo_${colunas().titulo.replace(/[^\w.]+/g,'_')}_${P.DIA_HOJE}-${P.TOTAL_DIAS_UTEIS}.pdf`;
      if(await salvaPdf(pdf.output('blob'), nomeArq) !== 'salvo'){ aviso(''); return; }
      aviso('PDF salvo: ' + nomeArq);
    }catch(e){ aviso('Não foi possível gerar o PDF agora. Tente de novo.'); }
    finally{ btn.disabled = false; }
  }

  function abre(){
    aberto = true; document.getElementById('rsOverlay').hidden = false;
    document.body.classList.add('rs-travado'); pinta();
    document.getElementById('rsOverlay').scrollTop = 0;
  }
  function fecha(){
    if(!aberto) return;
    aberto = false; document.getElementById('rsOverlay').hidden = true;
    document.body.classList.remove('rs-travado');
    // Resumo aberto por link: limpa o endereço e segue como uma visita nova (acesso guardado ou entrada)
    if(location.search.includes('resumo=')){ history.replaceState(null, '', location.pathname); entradaOuAcesso(); }
  }
  function alterna(k){
    const lig = Object.values(blocos).filter(Boolean).length;
    if(blocos[k] && lig===1){ aviso('Deixe pelo menos um bloco ligado.'); return; }
    blocos[k] = !blocos[k];
    document.querySelectorAll('[data-rsb]').forEach(b=>b.setAttribute('aria-pressed', blocos[b.dataset.rsb]));
    pinta();
  }

  /* ---- abre direto quando vem do link (?resumo=vol,ics&gc=G2&sv=...), sem passar pela entrada nem mexer no acesso
     guardado ('drotas_sessao'); ao fechar, entradaOuAcesso() ---- */
  function doLink(){
    const q = new URLSearchParams(location.search);
    if(!q.has('resumo')) return;
    const bl = (q.get('resumo')||'').split(',').filter(k=>k in blocos);
    if(bl.length) Object.keys(blocos).forEach(k=>blocos[k] = bl.includes(k));
    document.getElementById('entrada').hidden = true;      // link do resumo pula a entrada
    document.body.classList.remove('na-entrada');
    const gc = q.get('gc');
    if(q.get('modo')==='dir'){
      // gc = filtro da Diretoria (sem ele, todas); link antigo com reg= (região) abre a Diretoria inteira
      sel = {...sel, modo:'dir', dgc: gc && DATA[gc] ? gc : '', sv:'', rota:''};
      render(); abre();
      return;
    }
    // gerência ou grupo de gerências (gc=IT%2BMO; um '+' sem codificar chega como espaço)
    const gcLink = (gc || '').trim().replace(/\s+/g, '+');
    if(gcLink && temDados(gcLink)) sel = {...sel, modo:'gc', gc:gcLink, sv:'', rota:''};
    const sv = q.get('sv'); if(sv && svsVisiveis(sel.gc).includes(sv)) sel.sv = sv;
    const rota = q.get('rota'); if(rota && rotaSv(sel.gc, rota) && !ehVirtual(rota)){ sel.rota = rota; sel.sv = svDaRota(rota); }
    render(); abre();
  }

  function liga(){
    document.querySelectorAll('[data-rsb]').forEach(b=>b.onclick=()=>alterna(b.dataset.rsb));
    document.getElementById('btnResumo').onclick = abre;
    document.getElementById('rsVoltar').onclick = fecha;
    document.getElementById('rsLink').onclick = compartilhar;
    document.getElementById('rsImg').onclick = baixarPdf;
    document.addEventListener('keydown', e=>{ if(e.key==='Escape' && aberto) fecha(); });
    let t; addEventListener('resize', ()=>{ clearTimeout(t); t = setTimeout(pinta, 150); });
  }
  return {pinta, doLink, liga, fecha, paginas, carregaScript, salvaPdf};
})();
