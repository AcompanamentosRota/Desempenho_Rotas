/* Desempenho de Rotas · núcleo puro (sem DOM, sem online.json): a agregação dos cards e utilitários usados pelo
   painel (app.js) e pelo Painel de Ritmo em PDF (ritmo.js). Tudo recebe o payload por parâmetro; nada aqui lê
   ONLINE nem globais do app.js. Os nomes ficam dentro de NUCLEO para não colidir com os do app.js. */
const NUCLEO = (()=>{
  const INVERTIDOS = new Set(['VENDAZERO']);
  const lista = (P, k) => (P && P[k]) || [];
  const ehEventual = (P, r) => lista(P, 'EVENTUAIS_ROTAS').includes(r);
  // a rota oculta das eventuais ('-EV') já vem em VIRTUAIS_ROTAS; conferida aqui também
  const ehVirtual = (P, r) => lista(P, 'VIRTUAIS_ROTAS').includes(r) || ehEventual(P, r);
  const volExtras = P => Object.keys((P && P.VOLUME_EXTRA) || {});
  const titulo = s => String(s||'').toLowerCase().replace(/(^|\s)\S/g, m=>m.toUpperCase());
  // ordem natural dos códigos: trechos numéricos pelo valor (SV.G1.2 antes de SV.G1.10; 111, 112...; A11, A12...; I11...)
  function ordemNatural(a, b){
    const x = String(a).toUpperCase().match(/\d+|\D+/g) || [], y = String(b).toUpperCase().match(/\d+|\D+/g) || [];
    for(let i=0; i<Math.min(x.length, y.length); i++){
      const nx = /^\d/.test(x[i]), ny = /^\d/.test(y[i]);
      if(nx && ny){ if(Number(x[i])!==Number(y[i])) return Number(x[i]) - Number(y[i]); continue; }
      if(nx!==ny) return nx ? -1 : 1;
      if(x[i]!==y[i]) return x[i] < y[i] ? -1 : 1;
    }
    return x.length - y.length || (a < b ? -1 : a > b ? 1 : 0);
  }

  /* Soma as rotas como os cards: coberturas (ICS GC, Novos Negócios e os itens do Todos a Bordo) e volume pelo
     critério do SAC (igual a modelo.agrega_volume). nodo(r) = nó da rota no payload. hoje = {revertido, oportunidade}
     (REVERTIDO_HOJE / OPORTUNIDADE_HOJE do payload) acrescenta os campos que dependem da venda de hoje (revertidoHoje,
     oportunidadeHoje e semDadoHoje); sem ele (Painel de Ritmo, só dados reais) esses campos não são lidos nem saem. */
  function agrega(P, rotas, nodo, hoje){
    const G = P.GROUPS, ind={}, tot={baseTotal:0,compraram:null,semCompra:null};
    // os itens da aba Todos a Bordo (GROUPS.INCENTIVO) com a mesma conta das coberturas do ICS GC
    [...new Set([...G.ICS_GC,...G.NOVOS_NEG,...(G.INCENTIVO||[])])].forEach(k=>ind[k]={meta:0,real:0,n:0});
    const volKs=[...G.VOLUME, ...volExtras(P)];
    const volAgg={}; volKs.forEach(k=>volAgg[k]={meta:0,real:0,tend:0,neg:0,mdia:null,n:0});
    rotas.forEach(r=>{
      const d=nodo(r);
      if(!ehVirtual(P, r)){            // clientes das virtuais não aparecem (só os indicadores somam)
        tot.baseTotal+=d.baseTotal||0;
        if(d.compraram!=null){tot.compraram=(tot.compraram||0)+d.compraram;
          tot.semCompra=(tot.semCompra||0)+d.semCompra;}
      }
      Object.keys(ind).forEach(k=>{
        const b=d.indicators[k]; if(!b||b.unavailable) return;
        ind[k].meta+=b.meta||0; ind[k].real+=b.real||0; ind[k].n++;
      });
      volKs.forEach(k=>{
        const b=d.indicators[k], a=volAgg[k]; if(!b||b.unavailable) return;
        a.meta+=b.meta||0; a.real+=b.real||0; a.tend+=b.tendencia||0; a.neg+=b.negRestante||0;
        if(b.metaDia!=null) a.mdia=(a.mdia||0)+b.metaDia;
        a.n++;
      });
    });
    const out={};
    Object.keys(ind).forEach(k=>{
      const a=ind[k];
      if(!a.n){out[k]={unavailable:true};return;}
      const pct = a.meta ? Math.round(a.real/a.meta*100) : null;
      const o = out[k] = {meta:a.meta,real:a.real,pct,
        onPace: pct!=null && (INVERTIDOS.has(k)? pct<=100 : pct>=P.PACE_ONTEM_PCT),
        gap: INVERTIDOS.has(k)
          ? Math.max(0, Math.ceil(a.real - a.meta))
          : Math.max(0, Math.ceil(a.meta*P.DIA_HOJE/P.TOTAL_DIAS_UTEIS)-a.real)};
      if(hoje){
        o.revertidoHoje = rotas.reduce((s,r)=>s+((hoje.revertido||{})[r]||0),0);
        o.oportunidadeHoje = rotas.reduce((s,r)=>s+((hoje.oportunidade||{})[r]||0),0);
      }
      o.unavailable = false;
    });
    /* Volume (critério do SAC): soma as rotas (Vol Real, Neg Restante, Tendência, Meta, Meta do dia) e recalcula o %
       sobre as somas. Fechamento do mês: sem tendência nem meta do dia, no ritmo pelo % realizado (Real / Meta). */
    const fech = !!P.FECHAMENTO;
    volKs.forEach(k=>{
      const a=volAgg[k];
      if(!a.n){out[k]={unavailable:true};return;}
      const pctT = (!fech && a.meta) ? Math.round(a.tend/a.meta*100) : null;
      const pctR = a.meta ? Math.round(a.real/a.meta*100) : null;
      const o = out[k] = {meta:a.meta,real:a.real,dif:a.real-a.meta, metaDia: fech?null:a.mdia,
        tendencia: fech?null:a.tend, negRestante: fech?null:a.neg, pctTendencia:pctT, pctReal:pctR,
        onPace: fech ? (pctR!=null && pctR>=100) : (pctT!=null && pctT>=100), unavailable:false};
      if(hoje) o.semDadoHoje = rotas.length===1 && !!(nodo(rotas[0]).indicators[k]||{}).semDadoHoje;
    });
    return {ind:out, tot};
  }

  /* Meta do dia de uma cobertura (caixa do Online dos cards ICS): abaixo do ritmo é o próprio "faltam X" (gap); no
     ritmo, teto(Meta / dias úteis). */
  const metaDiaCobertura = (b, totalDias) => b.gap > 0 ? b.gap : (b.meta ? Math.ceil(b.meta/totalDias) : 0);

  /* Mês anterior no mesmo dia útil (chave MES_ANTERIOR, só os macros de volume de IND): soma simples dos pares
     [Real até o corte, Meta do mês anterior inteiro] das rotas. Item null (ou rota ausente) = a rota não tem o indicador
     no mês anterior: fica fora (Real e Meta). Devolve {k: {real, meta, n}} por item de IND (null sem nenhuma rota), ou
     null sem a chave. Nada de regra comercial aqui: a chave já vem pronta do gerador (backend/gerador/mes_anterior.py). */
  function mesAnterior(P, rotas){
    const M = P && P.MES_ANTERIOR;
    if(!M || !M.ROTAS || !Array.isArray(M.IND)) return null;
    const out = {};
    M.IND.forEach((k, i)=>{
      const a = {real:0, meta:0, n:0};
      rotas.forEach(r=>{
        const x = (M.ROTAS[r] || [])[i];
        if(!x) return;
        a.real += x[0] || 0; a.meta += x[1] || 0; a.n++;
      });
      out[k] = a.n ? a : null;
    });
    return out;
  }

  return {agrega, metaDiaCobertura, mesAnterior, ehVirtual, ehEventual, INVERTIDOS, titulo, ordemNatural};
})();
