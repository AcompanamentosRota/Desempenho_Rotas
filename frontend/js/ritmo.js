/* =====================================================================
   PAINEL DE RITMO EM PDF (relatório MATINAL) — botão "Painel de ritmo" na barra do Resumo de vendas.
   SÓ DADOS REAIS: tudo vem do payload.json (Real fechado até o último dia útil + metas). Nada do online.json
   (ONLINE, puxaOnline) nem dos campos do payload que dependem da venda de hoje (REVERTIDO_HOJE, OPORTUNIDADE_HOJE,
   SEM_COMPRA_HOJE, revertidoHoje, oportunidadeHoje, semDadoHoje).
   - montaRitmo(P, escopo): FUNÇÃO PURA (sem DOM, sem globais do app.js) -> modelo das páginas. Os números do nível
     agregado (coluna do GC ou da SV) são os dos cards (NUCLEO.agrega, sem os campos de hoje); as colunas de
     supervisão/rota são as linhas visíveis (sem Neutraliza, virtuais, '-EV' e ocultas; os números delas ficam no
     total do GC).
   - escopoRitmo(): o escopo pelo filtro atual (Diretoria "Todas" = as 16; uma gerência ou grupo; uma supervisão).
   - desenho (desenhaPagina) e PDF (exporta): página a página, 1280x720, html2canvas (escala 1.5) + jsPDF (JPEG 0.85),
     com as bibliotecas e a entrega (baixar/compartilhar) do Resumo (RS.carregaScript, RS.salvaPdf).
   ===================================================================== */

/* ---------- parte pura ---------- */
function montaRitmo(P, escopo){
  const N = NUCLEO, D = P.DATA || {};
  const VOL = ['VOL REFRIGERANTES','VOL CERVEJAS','VOL STILL','VOL AGUA MINERAL','VOL DEST+ART+CND'];
  const COB = ['CCTM 2L PET','KS TT','REFRI SABORES ZERO','POWERADE','KAPO','CERVEJAS','CERVEJAS 600ML RETORNAVEL',
               'EISENBAHN','ARTD KO','VENDAZERO'];
  const NOMES = {'VOL REFRIGERANTES':'Refrigerantes','VOL CERVEJAS':'Cervejas','VOL STILL':'Still',
    'VOL AGUA MINERAL':'Água Mineral','VOL DEST+ART+CND':rotuloFront('VOL DEST+ART+CND'),'CCTM 2L PET':'CCTM 2L Pet','KS TT':'KS TT',
    'REFRI SABORES ZERO':'Refri Sab. Zero','POWERADE':'Powerade','KAPO':'Kapo','CERVEJAS':'Cervejas',
    'CERVEJAS 600ML RETORNAVEL':'Cerv. 600ml Ret.','EISENBAHN':'Eisenbahn','ARTD KO':'Artd KO','VENDAZERO':'Venda Zero (KO)'};
  const fmt0 = n => { const r = Math.round(n||0); return (r===0 ? 0 : r).toLocaleString('pt-BR'); };
  const T = P.TOTAL_DIAS_UTEIS;

  // rotas: índice rota -> nó; Neutraliza, virtuais (com as '-EV') e normais; supervisões ocultas (na AT nenhuma)
  const idx = {};
  for(const gc in D) for(const sv in D[gc]) for(const r in D[gc][sv]) idx[r] = D[gc][sv][r];
  const nodo = r => idx[r];
  const ehNeutra = r => (P.NEUTRALIZA_ROTAS || []).includes(r);
  const ehNormal = r => !ehNeutra(r) && !N.ehVirtual(P, r);
  const gcDoSv = sv => String(sv||'').split('.')[1] || '';
  const ehOculta = sv => !(P.GC_SEM_OCULTAS || ['AT']).includes(gcDoSv(sv)) &&
    (P.OCULTAS ? P.OCULTAS.includes(sv) : (CONFIG.SV_EXCLUIDOS || []).includes(sv));
  const rotasGc = gc => Object.keys(D[gc] || {}).flatMap(s => Object.keys(D[gc][s]));
  const rotasSv = (gc, sv) => Object.keys((D[gc] || {})[sv] || {}).filter(ehNormal).sort(N.ordemNatural);
  // supervisões com coluna/página: alguma rota normal, fora as ocultas; em ordem crescente do código
  const svsGc = gc => Object.keys(D[gc] || {}).filter(s => rotasSv(gc, s).length && !ehOculta(s)).sort(N.ordemNatural);
  // nome curto do supervisor ou do consultor: o primeiro nome capitalizado; "ROTA SEM VENDEDOR" (qualquer caixa) ou
  // vazio = "Sem vendedor"
  const primeiroNome = s => { const n = String(s||'').trim();
    return !n || /SEM\s+VENDEDOR/i.test(n) ? 'Sem vendedor' : N.titulo(n.split(/\s+/)[0]); };
  const nomeSv = sv => primeiroNome((P.NOME_SUPERVISOR || {})[sv]);
  const nomeGc = gc => (P.GC_NOMES || {})[gc] || '';

  // subtítulo: dados reais até o último dia útil fechado; as faltas miram o dia útil de hoje
  const pctDe = d => T ? Math.round(d / T * 100) : 0;
  const dataCurta = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? `${m[3]}/${m[2]}` : ''; };
  const ate = P.DIA_ONTEM_NOME
    ? `dados reais até ${P.DIA_ONTEM_NOME}${dataCurta(P.DATA_ONTEM) ? ' ' + dataCurta(P.DATA_ONTEM) : ''} (dia útil ${P.DIA_ONTEM}/${T}, ${P.PACE_ONTEM_PCT}%)`
    : `dados reais até o dia útil ${P.DIA_ONTEM}/${T} (${P.PACE_ONTEM_PCT}%)`;
  const mira = `faltas miram ${String(P.DIA_SEMANA || '').toLowerCase()} (dia ${P.DIA_HOJE}/${T}, ${pctDe(P.DIA_HOJE)}%)`;
  const subtitulo = nivel => [nivel, String(P.MES_LABEL || '').toLowerCase(), ate, mira].join(' · ');

  /* células: volume pela tendência (verde >= 100) com a meta do dia; cobertura pelo ritmo de ontem (onPace) com a meta do
     dia ou o que falta (a conta da caixa dos cards ICS) e "Meta batida!" com Real >= Meta; Venda Zero pelo pendente do mês
     (gap: "N" grande + "reverter", sem %) */
  function celVol(b){
    if(!b || b.unavailable || !b.meta || b.pctTendencia==null) return null;
    const ok = !!b.onPace, md = b.metaDia;
    return {ok, seta: ok ? '▲' : '▼', valor: b.pctTendencia + '%',
            sub: md==null ? 'Meta dia —' : md <= 1e-9 ? 'Meta batida!' : 'Meta dia ' + fmt0(md), falta: false};
  }
  function celCob(k, b){
    if(!b || b.unavailable) return null;
    // Venda Zero: o valor principal é o pendente do mês (gap), sem percentual; "reverter" embaixo, menor
    if(k==='VENDAZERO'){
      const ok = b.gap === 0;
      return {ok, seta: ok ? '▲' : '▼', valor: fmt0(b.gap), sub: 'reverter', falta: false};
    }
    if(!b.meta || b.pct==null) return null;
    // meta do mês alcançada (Real >= Meta, como o "Meta batida!" da caixa dos cards ICS): "Meta batida!"
    if(b.real >= b.meta) return {ok: true, seta: '▲', valor: b.pct + '%', sub: 'Meta batida!', falta: false};
    const ok = !!b.onPace, n = N.metaDiaCobertura(b, T);
    return {ok, seta: ok ? '▲' : '▼', valor: b.pct + '%', sub: (ok ? 'Meta dia ' : 'faltam ') + fmt0(n), falta: !ok};
  }
  const conta = cels => ({ok: cels.filter(c => c && c.ok).length, n: cels.filter(Boolean).length});

  // página: colunas[0] = o nível (total), as demais = supervisões (página do GC) ou rotas (página da SV)
  function pagina(nivel, gc, sv){
    const cols = nivel==='gc'
      ? [{codigo:'GC.'+gc, nome:nomeGc(gc), rotas:rotasGc(gc), foco:true},
         ...svsGc(gc).map(s => ({codigo:s, nome:nomeSv(s), rotas:rotasSv(gc, s), chave:s}))]
      : [{codigo:sv, nome:nomeSv(sv), rotas:rotasSv(gc, sv), foco:true},
         ...rotasSv(gc, sv).map(r => ({codigo:'Rota '+r, nome:primeiroNome((nodo(r)||{}).consultor), rotas:[r], chave:r}))];
    cols.forEach(c => {
      const ind = N.agrega(P, c.rotas, nodo).ind;
      c.vol = VOL.map(k => celVol(ind[k]));
      c.cob = COB.map(k => celCob(k, ind[k]));
      c.contaVol = conta(c.vol); c.contaCob = conta(c.cob);
    });
    // quem puxa a média pra baixo: a coluna (fora o total) com MENOS coberturas no ritmo (o x do "x / n", não a
    // proporção); empate no x: a com MAIS itens fora do ritmo (n - x); persistindo, o menor código. Sem linha se não
    // há coluna com cobertura ou se todas estão com x = n (ninguém fora do ritmo).
    const fora = c => c.contaCob.n - c.contaCob.ok;
    const cand = cols.slice(1).filter(c => c.contaCob.n)
      .sort((a, b) => a.contaCob.ok - b.contaCob.ok || fora(b) - fora(a) || N.ordemNatural(a.chave, b.chave));
    const pior = cand.some(c => fora(c) > 0) ? cand[0] : null;
    const rotPior = c => nivel==='gc' ? c.codigo + (c.nome ? ' · ' + c.nome : '') : c.codigo;
    const titNivel = nivel==='gc' ? `GC.${gc}${nomeGc(gc) ? ' · ' + nomeGc(gc) : ''}` : `${sv}${nomeSv(sv) ? ' · ' + nomeSv(sv) : ''}`;
    return {nivel, gc, sv: sv || '',
      titulo: 'Painel de Ritmo — ' + titNivel,
      subtitulo: subtitulo(nivel==='gc' ? 'Gerência → Supervisões' : 'Supervisor → Rotas'),
      puxa: pior ? `Puxando a média pra baixo: ${rotPior(pior)} — ${pior.contaCob.ok}/${pior.contaCob.n} no ritmo` : '',
      colunas: cols,
      volume: VOL.map(k => NOMES[k]), coberturas: COB.map(k => NOMES[k]),
      compacto: cols.length >= 7};
  }

  // escopo: {tipo:'band'} = as gerências com dados na ordem de GC_ATIVAS; {tipo:'gc', gcs} = essas gerências (GC + SVs
  // de cada uma); {tipo:'sv', gcs:[gc], sv} = só a página da supervisão
  const gcs = (escopo.tipo==='band' ? (P.GC_ATIVAS || Object.keys(D)) : (escopo.gcs || [])).filter(g => D[g]);
  const paginas = [];
  if(escopo.tipo==='sv'){
    const gc = gcs.find(g => svsGc(g).includes(escopo.sv));
    if(gc) paginas.push(pagina('sv', gc, escopo.sv));
  } else {
    gcs.forEach(g => { paginas.push(pagina('gc', g)); svsGc(g).forEach(s => paginas.push(pagina('sv', g, s))); });
  }
  return {nome: escopo.nome || '', paginas};
}

/* ---------- desenho, escopo pelo filtro e PDF (navegador) ---------- */
const RT = (()=>{
  const LARG = 1280, ALT = 720, ESCALA = 1.5, QUALIDADE = 0.85;
  const TXT = {botao:'Painel de ritmo', fechamento:'Indisponível durante o fechamento',
    semConexao:'Sem conexão para gerar o PDF', erro:'Não foi possível gerar o PDF'};

  /* escopo pelo filtro: Diretoria "Todas" = BAND; Diretoria com uma gerência, perfil Gerência ou grupo = a gerência
     (no Total do grupo, as duas; com uma delas no seletor, só ela); supervisão no filtro (ou perfil Supervisão) = só
     ela ("Neutraliza" não tem página: vale a gerência). Perfil Rota: null (sem botão). */
  function escopoRitmo(){
    if(ACESSO && ACESSO.perfil==='rota') return null;
    if(sel.modo==='dir') return sel.dgc ? {tipo:'gc', gcs:[sel.dgc], nome:sel.dgc} : {tipo:'band', nome:'BAND'};
    if(sel.sv && sel.sv!==SV_NEUTRA) return {tipo:'sv', gcs:membrosGc(sel.gc), sv:sel.sv, nome:sel.sv};
    return {tipo:'gc', gcs:membrosGc(sel.gc).filter(g=>DATA[g]), nome:sel.gc};
  }

  function celula(c){
    if(!c) return '<td class="rt-vazio"><span class="rt-v" data-fit="">—</span></td>';
    return `<td class="${c.ok ? 'rt-ok' : 'rt-no'}"><span class="rt-v" data-fit=""><span class="rt-seta">${c.seta}</span>${esc(c.valor)}</span>` +
      `<span class="rt-s${c.falta ? ' rt-falta' : ''}" data-fit="">${esc(c.sub)}</span></td>`;
  }
  const contagem = ct => `<td><span class="rt-c" data-fit="">${ct.n ? `${ct.ok} / ${ct.n}` : '—'}</span></td>`;
  // uma página (1280x720): título, subtítulo, "puxando a média", Volume (5) e Coberturas (10)
  function desenhaPagina(pg){
    const cols = pg.colunas, nc = cols.length + 1;
    const cab = cols.map(c => `<th class="${c.foco ? 'rt-foco' : ''}"><span class="rt-cod" data-fit="">${esc(c.codigo)}</span>` +
      `<span class="rt-nm" data-fit="">${esc(c.nome || '')}</span></th>`).join('');
    const bloco = (titulo, rot, chave, conta, nomes) =>
      `<tr class="rt-bloco"><td colspan="${nc}">${titulo}</td></tr>` +
      `<tr class="rt-tot"><td class="rt-nome">${rot}</td>${cols.map(c => contagem(c[conta])).join('')}</tr>` +
      nomes.map((nm, i) => `<tr><td class="rt-nome"><span data-fit="">${esc(nm)}</span></td>${cols.map(c => celula(c[chave][i])).join('')}</tr>`).join('');
    return `<div class="rt-pag${pg.compacto ? ' rt-compacto' : ''}" data-colunas="${cols.length}">
      <div class="rt-cab"><h2 data-fit="">${esc(pg.titulo)}</h2><div class="rt-marca"><span class="rt-pt">●</span> COMERCIAL BANDEIRANTES</div></div>
      <div class="rt-sub" data-fit="">${esc(pg.subtitulo)}</div>
      ${pg.puxa ? `<div class="rt-puxa" data-fit="">${esc(pg.puxa)}</div>` : ''}
      <table class="rt-tab"><colgroup><col class="rt-c0">${cols.map(() => '<col>').join('')}</colgroup>
        <thead><tr><th class="rt-nome"></th>${cab}</tr></thead>
        <tbody>${bloco('VOLUME — TENDÊNCIA DO MÊS', 'NA TENDÊNCIA', 'vol', 'contaVol', pg.volume)}
          ${bloco('COBERTURAS — ICS GC', 'NO RITMO', 'cob', 'contaCob', pg.coberturas)}</tbody>
      </table></div>`;
  }

  // AAAAMMDD de hoje em Brasília (nome do arquivo)
  const hojeArq = () => { const a = agoraSP(); return `${a.ano}${String(a.mes).padStart(2,'0')}${String(a.dia).padStart(2,'0')}`; };
  const espera = () => new Promise(r => setTimeout(r, 0));
  let ocupado = false;
  const btn = () => document.getElementById('btnRitmo');
  // mensagem curta no próprio botão por 5 s (o texto inteiro também na região viva #rtAviso, para leitores de tela)
  function avisa(curta, longa){
    const el = document.getElementById('rtAviso'); if(el) el.textContent = longa || curta;
    const b = btn(); if(!b) return;
    b.textContent = curta; clearTimeout(avisa.t);
    avisa.t = setTimeout(()=>{ if(!ocupado) estado(); }, 5000);
  }

  // botão: oculto no perfil Rota (a barra inteira some no render); desabilitado no fechamento do mês
  function estado(){
    const b = btn(); if(!b || ocupado || !P) return;
    const fech = !!P.FECHAMENTO;
    b.disabled = fech;
    b.textContent = TXT.botao;
    b.title = fech ? TXT.fechamento : 'Exportar o Painel de Ritmo em PDF (só dados reais)';
    b.setAttribute('aria-label', fech ? `${TXT.botao} — ${TXT.fechamento}` : TXT.botao);
  }

  async function exporta(){
    if(ocupado || !P || P.FECHAMENTO) return;
    const escopo = escopoRitmo(); if(!escopo) return;
    const modelo = montaRitmo(P, escopo), n = modelo.paginas.length;
    if(!n){ avisa('Nada para exportar neste filtro'); return; }
    if(escopo.tipo==='band' && !confirm(`Exportar ${n} páginas?`)) return;
    ocupado = true;
    const b = btn(); b.disabled = true; b.setAttribute('aria-busy', 'true'); b.textContent = 'Preparando…';
    let palco = null, msg = '', longa = '';
    try{
      try{
        await Promise.all([RS.carregaScript(CONFIG.CDN.html2canvas, 'html2canvas'), RS.carregaScript(CONFIG.CDN.jspdf, 'jspdf')]);
      }catch(err){ msg = TXT.semConexao; return; }
      if(document.fonts) await document.fonts.ready;      // a captura usa a Inter
      palco = document.createElement('div'); palco.className = 'rt-palco'; palco.setAttribute('aria-hidden', 'true');
      document.body.appendChild(palco);
      const pdf = new window.jspdf.jsPDF({orientation:'landscape', unit:'px', format:[LARG, ALT], hotfixes:['px_scaling'], compress:true});
      for(let i = 0; i < n; i++){
        b.textContent = `Gerando ${i+1}/${n}`;
        palco.innerHTML = desenhaPagina(modelo.paginas[i]);
        encaixa(palco);
        let canvas = await html2canvas(palco.firstElementChild, {scale:ESCALA, backgroundColor:'#ffffff', useCORS:true,
          width:LARG, height:ALT, windowWidth:LARG, windowHeight:ALT, logging:false});
        if(i > 0) pdf.addPage([LARG, ALT], 'landscape');
        pdf.addImage(canvas.toDataURL('image/jpeg', QUALIDADE), 'JPEG', 0, 0, LARG, ALT);
        canvas.width = canvas.height = 0; canvas = null;    // libera a memória do canvas (celular)
        await espera();                                      // cede ao navegador: a interface não trava
      }
      palco.remove(); palco = null;
      pdf.setProperties({title:'Painel de Ritmo · ' + modelo.nome, author:'Comercial Bandeirantes'});
      const nomeArq = `Painel_Ritmo_${modelo.nome.replace(/[^\w.+-]+/g,'_')}_${hojeArq()}.pdf`;
      const r = await RS.salvaPdf(pdf.output('blob'), nomeArq);
      if(r==='salvo'){ msg = 'PDF salvo'; longa = 'PDF salvo: ' + nomeArq; }
    }catch(err){ msg = TXT.erro; }
    finally{
      if(palco) palco.remove();
      ocupado = false; b.removeAttribute('aria-busy');
      estado();
      if(msg) avisa(msg, longa);
    }
  }

  function liga(){
    const b = btn(); if(!b) return;
    b.onclick = exporta;
    estado();
  }
  return {liga, estado, escopoRitmo, desenhaPagina, exporta};
})();
