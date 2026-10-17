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
   SV.G2.5/SV.IT.3/SV.MO.3 (Neutraliza -- 251/I31/M31) entram no Volume;
   em ICS/NN a coluna some (sem meta). SV.IT.3/SV.MO.3 adicionadas 05/10/26,
   mesmo tratamento da SV.G2.5 original.
   ===================================================================== */
const RS = (()=>{
  const VOL_ORD = ['VOL REFRIGERANTES','VOL CERVEJAS','VOL STILL','VOL AGUA MINERAL','VOL DEST+ART+CND'];
  const ICS_ORD = ['CCTM 2L PET','KS TT','REFRI SABORES ZERO','POWERADE','KAPO','CERVEJAS','CERVEJAS 600ML RETORNAVEL','EISENBAHN','ARTD KO'];
  const CURTO_X = {'REFRI SABORES ZERO':'Refri Sab. Zero','CERVEJAS 600ML RETORNAVEL':'Cerv. 600ml Ret.'};
  const blocos = {vol:true, ics:true, nov:false};
  let aberto = false, COMPACTO = false, LARG_MIN = 380;
  const n = v => { const r = Math.round(v); return (r===0?0:r).toLocaleString('pt-BR'); };
  const nome = k => CURTO_X[k] || (P.LABELS_CURTO||{})[k] || LABELS[k] || k;

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
    const esq = gap>0 ? kpi('Faltam', n(gap)) : kpi(COMPACTO?'M.dia':'Meta dia', n(fatia), 'rs-meta0');
    return {ok, h:`<div class="rs-cel"><div class="rs-par">${esq}${kpi('Online', n(x.onl), 'rs-on '+(onOk?'rs-ok':'rs-bad'))}</div><span class="rs-sec">${seta(ok)} ${p}% do mês</span></div>`};
  }
  function celVz(z){
    if(!z.n) return {ok:null, h:VAZIO};
    const pend = Math.ceil(Math.max(0, z.real - z.meta)), ok = pend===0, revOk = z.rev >= z.op;
    return {ok, h:`<div class="rs-cel"><div class="rs-par">${kpi('Reverter', n(z.op))}${kpi('Revert.', n(z.rev), 'rs-on '+(revOk?'rs-ok':'rs-bad'))}</div><span class="rs-sec">${seta(ok)} ${ok?'no ritmo':'pend. mês '+n(pend)}</span></div>`};
  }

  /* ---- colunas conforme o filtro atual ---- */
  function colunas(){
    const gc = sel.gc;
    if(sel.rota){
      const d = nodo(gc, sel.rota);
      return {titulo:'Rota '+sel.rota, sub:`${rotuloSv(rotaSv(gc,sel.rota))} → rota ${sel.rota}${d&&d.consultor?' · '+titulo(d.consultor):''}`, cols:[[sel.rota,[sel.rota]]]};
    }
    if(sel.sv){
      const rs = Object.keys(DATA[gc][sel.sv]);
      return {titulo:sel.sv, sub:rotuloSv(sel.sv)+' → rotas', cols:[[sel.sv, rs], ...rs.map(r=>[r,[r]])]};
    }
    const svs = svsDe(gc);
    return {titulo:'Matriz GC.'+gc, sub:'Gerência → supervisores', cols:[['GC.'+gc, rotasDe(gc,'')], ...svs.map(s=>[s, Object.keys(DATA[gc][s])])]};
  }
  // cabeçalho da coluna: código (SV.G1.1 / rota) + primeiro nome do supervisor quando houver
  const cab = c => { const nm = nomeSv(c[0]); return esc(c[0]) + (nm ? `<small class="rs-svnome">${esc(nm)}</small>` : ''); };
  const thead = (rot, cols) => `<thead><tr><th class="rs-nome">${rot}</th>${cols.map((c,i)=>`<th class="${i===0?'rs-foco':''}">${cab(c)}</th>`).join('')}</tr></thead>`;
  function tabela(linhas, todas, comVz){
    const cols = todas.filter((c,i)=> i===0 || linhas.some(k=>c[2].c[k] && c[2].c[k].meta));
    const cont = cols.map(()=>[0,0]);
    const td = (i,r)=>{ if(r.ok!==null){cont[i][1]++; if(r.ok) cont[i][0]++;} return `<td>${r.h}</td>`; };
    let body = linhas.map(k=>`<tr><td class="rs-nome">${nome(k)}</td>${cols.map((c,i)=>td(i, celInd(c[2].c[k]))).join('')}</tr>`).join('');
    if(comVz) body += `<tr><td class="rs-nome">Venda Zero</td>${cols.map((c,i)=>td(i, celVz(c[2].vz))).join('')}</tr>`;
    body += `<tr class="rs-tot"><td class="rs-nome">No ritmo</td>${cont.map(v=>`<td>${v[1]?v[0]+'/'+v[1]:'—'}</td>`).join('')}</tr>`;
    const cards = cols.map((c,i)=>{
      const lin = linhas.map(k=>{ const r = celInd(c[2].c[k]); return r.ok===null ? '' : `<div class="rs-lin"><span class="rs-nome">${nome(k)}</span>${r.h}</div>`; }).join('')
        + (comVz ? (()=>{ const r = celVz(c[2].vz); return r.ok===null ? '' : `<div class="rs-lin"><span class="rs-nome">Venda Zero</span>${r.h}</div>`; })() : '');
      const ct = cont[i][1] ? `<small>${cont[i][0]}/${cont[i][1]} no ritmo</small>` : '';
      return `<div class="rs-card ${i===0?'rs-foco':''}"><div class="rs-cardh"><span>${cab(c)}</span>${ct}</div>${lin}</div>`;
    }).join('');
    return {html:`<div class="rs-tab"><table>${thead('Indicador', cols)}<tbody>${body}</tbody></table></div><div class="rs-cards">${cards}</div>`, cont, cols};
  }

  /* ---- monta a folha ---- */
  function pinta(){
    if(!aberto || !P) return;
    const {titulo:tit, sub, cols} = colunas();
    cols.forEach(c=>c[2] = soma(sel.gc, c[1]));
    COMPACTO = cols.length >= 7;
    const folha = document.getElementById('rsFolha');
    folha.classList.toggle('rs-compacto', COMPACTO);
    LARG_MIN = Math.max(380, 130 + cols.length*(COMPACTO?112:150));
    folha.style.minWidth = (innerWidth >= 700 && innerWidth < 1000) ? LARG_MIN + 'px' : '';
    const volTab = `<table>${thead('Agrupador', cols)}<tbody>${VOL_ORD.map(k=>`<tr><td class="rs-nome">${LABELS[k]||k}</td>${cols.map(c=>`<td>${celVol(c[2].v[k])}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    const volCards = cols.map((c,i)=>`<div class="rs-card ${i===0?'rs-foco':''}"><div class="rs-cardh"><span>${cab(c)}</span></div>${VOL_ORD.map(k=>{ const x=c[2].v[k]; return (!x||x.indisp||!x.meta) ? '' : `<div class="rs-lin"><span class="rs-nome">${LABELS[k]||k}</span>${celVol(x)}</div>`; }).join('')}</div>`).join('');
    const volT = `<div class="rs-tab">${volTab}</div><div class="rs-cards">${volCards}</div>`;
    const ics = tabela(ICS_ORD, cols, true), nov = tabela(GROUPS.NOVOS_NEG, cols, false);
    const up = (ONLINE && ONLINE.updatedAt) || '';
    const hhmm = up.split('T')[1] ? up.split('T')[1].slice(0,5) : '';
    const janela = hhmm && hhmm <= CONFIG.JANELA_VENDAS.fim;
    let pior = '';
    const cand = ics.cols.slice(1).map((c,i)=>[c[0], ics.cont[i+1]]).filter(x=>!svExcluido(x[0]) && x[1][1]>0);
    if(cand.length >= 2){
      cand.sort((a,b)=>a[1][0]/a[1][1] - b[1][0]/b[1][1]);
      if(cand[0][1][0] < cand[0][1][1]) pior = `<div class="rs-atencao">Oportunidade de reversão ${janela?'agora':'amanhã'}: ${esc(rotuloSv(cand[0][0]))}</div>`;
    }
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
      ${pior}
      ${blocos.vol?`<div class="rs-bloco"><h3>Volume — ${P.FECHAMENTO?'realizado do mês (fechamento)':'tendência do mês'} <small>${P.FECHAMENTO?'Online de hoje, sem meta do dia':'Online verde ao bater a Meta dia'}</small></h3>${volT}</div>`:''}
      ${blocos.ics?`<div class="rs-bloco"><h3>Coberturas — ICS GC <small>Online verde ao bater o faltam</small></h3>${ics.html}</div>`:''}
      ${blocos.nov?`<div class="rs-bloco"><h3>Novos Negócios <small>Online verde ao bater o faltam</small></h3>${nov.html}</div>`:''}
      <div class="rs-rod">${esc(CONFIG.CREDITOS)}</div>`;
    document.querySelectorAll('[data-rsb]').forEach(b=>b.setAttribute('aria-pressed', blocos[b.dataset.rsb]));
  }

  /* ---- link com filtro + blocos ---- */
  function linkAtual(){
    const q = new URLSearchParams();
    q.set('resumo', Object.keys(blocos).filter(k=>blocos[k]).join(','));
    q.set('gc', sel.gc); if(sel.sv) q.set('sv', sel.sv); if(sel.rota) q.set('rota', sel.rota);
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
  async function baixarPdf(){
    const btn = document.getElementById('rsImg'); btn.disabled = true; aviso('Gerando PDF…');
    try{
      await Promise.all([
        carregaScript(CONFIG.CDN.html2canvas, 'html2canvas'),
        carregaScript(CONFIG.CDN.jspdf, 'jspdf')
      ]);
      const folha = document.getElementById('rsFolha');
      const minAntes = folha.style.minWidth, largAntes = folha.style.width;
      /* 08/10/26: PDF sempre no formato da visao PC (tabela), em paginas deitadas (16:9) que cabem na tela na horizontal.
         Bloco mais alto que a pagina ganha uma pagina mais alta (rolagem so na vertical). Vale p/ celular, tablet e PC. */
      const W = innerWidth >= 1000 ? Math.ceil(folha.scrollWidth) : Math.max(1200, LARG_MIN);
      folha.classList.add('rs-pdf'); folha.style.width = W+'px'; folha.style.minWidth = '0';
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      let canvas, atomos = [], altTotal = 0;
      try{
        /* mede os blocos DENTRO da renderizacao (largura W, estilos do PC), nao na janela real do celular */
        const mede = (doc) => {
          const f = doc.getElementById('rsFolha'); if(!f) return;
          const topF = f.getBoundingClientRect().top;
          const R = el => { const r = el.getBoundingClientRect(); return {t:r.top-topF, b:r.bottom-topF}; };
          const uni = (x,y) => ({t:Math.min(x.t,y.t), b:Math.max(x.b,y.b)});
          let cab = R(f.querySelector('.rs-cab')); const at = f.querySelector('.rs-atencao'); if(at) cab = uni(cab, R(at));
          atomos = [cab];
          f.querySelectorAll('.rs-bloco').forEach(bl=>atomos.push(R(bl)));
          atomos.push(R(f.querySelector('.rs-rod')));
        };
        canvas = await html2canvas(folha, {scale:2, backgroundColor:'#ffffff', useCORS:true, windowWidth:W, width:W, onclone: mede});
        altTotal = canvas.height/2;
      } finally { folha.classList.remove('rs-pdf'); folha.style.width = largAntes; folha.style.minWidth = minAntes; }
      const H0 = Math.round(W*9/16);
      const paginas = []; let i = 0, ini = 0;
      while(i < atomos.length){
        let j = i; while(j+1 < atomos.length && atomos[j+1].b - ini + 8 <= H0) j++;
        const fim = Math.min(altTotal, atomos[j].b + 10);
        paginas.push([ini, fim]);
        i = j + 1; if(i < atomos.length) ini = Math.max(0, atomos[i].t - 8);
      }
      const altP = ([y0,y1]) => Math.max(H0, Math.ceil(y1-y0));
      let pdf = new window.jspdf.jsPDF({orientation:'landscape', unit:'px', format:[W, altP(paginas[0])], hotfixes:['px_scaling'], compress:true});
      paginas.forEach((pg,n)=>{
        const [y0,y1] = pg, h = altP(pg);
        const pc = document.createElement('canvas'); pc.width = W*2; pc.height = h*2;
        const cx = pc.getContext('2d'); cx.fillStyle = '#ffffff'; cx.fillRect(0,0,pc.width,pc.height);
        cx.drawImage(canvas, 0, y0*2, W*2, (y1-y0)*2, 0, 0, W*2, (y1-y0)*2);
        if(n>0) pdf.addPage([W,h], h>W?'portrait':'landscape');
        pdf.addImage(pc.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, W, h);
      });
      pdf.setProperties({title:'Resumo de vendas · '+colunas().titulo, author:'Comercial Bandeirantes'});
      const nomeArq = `Resumo_${colunas().titulo.replace(/[^\w.]+/g,'_')}_${P.DIA_HOJE}-${P.TOTAL_DIAS_UTEIS}.pdf`;
      const blob = pdf.output('blob');
      const arq = new File([blob], nomeArq, {type:'application/pdf'});
      if(navigator.canShare && navigator.canShare({files:[arq]}) && matchMedia('(pointer:coarse)').matches){
        try{ await navigator.share({files:[arq], title:nomeArq}); aviso(''); return; }catch(e){ if(e && e.name==='AbortError'){ aviso(''); return; } }
      }
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nomeArq;
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href), 4000);
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
    aberto = false; document.getElementById('rsOverlay').hidden = true;
    document.body.classList.remove('rs-travado');
    if(location.search.includes('resumo=')) history.replaceState(null, '', location.pathname);
  }
  function alterna(k){
    const lig = Object.values(blocos).filter(Boolean).length;
    if(blocos[k] && lig===1){ aviso('Deixe pelo menos um bloco ligado.'); return; }
    blocos[k] = !blocos[k];
    document.querySelectorAll('[data-rsb]').forEach(b=>b.setAttribute('aria-pressed', blocos[b.dataset.rsb]));
    pinta();
  }

  /* ---- abre direto quando vem do link (?resumo=vol,ics&gc=G2&sv=...) ---- */
  function doLink(){
    const q = new URLSearchParams(location.search);
    if(!q.has('resumo')) return;
    const bl = (q.get('resumo')||'').split(',').filter(k=>k in blocos);
    if(bl.length) Object.keys(blocos).forEach(k=>blocos[k] = bl.includes(k));
    const gc = q.get('gc'); if(gc && DATA[gc]) sel = {gc, sv:'', rota:''};
    const sv = q.get('sv'); if(sv && DATA[sel.gc][sv]) sel.sv = sv;
    const rota = q.get('rota'); if(rota && rotaSv(sel.gc, rota)){ sel.rota = rota; sel.sv = rotaSv(sel.gc, rota); }
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
  return {pinta, doLink, liga};
})();
