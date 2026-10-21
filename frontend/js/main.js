/* Inicialização: carrega payload.json + online.json e agenda as atualizações.
   O back-end regenera os dois arquivos a cada 15 min em dias úteis; o front
   revalida o payload no mesmo ritmo (ETag: só baixa quando mudou) e o online a cada 5 min. */
function aplicaPayload(novo){
  P = novo;
  P._versao = Date.now();
  ({DATA,LABELS,GROUPS,CLIENT_ROSTER,CLIENTES_HOJE,OPORTUNIDADES_DIA,VISITAS_DIA,SEGS,DIAS,COBERTOS,SEM_COMPRA_HOJE,VENDAZERO_CLIENTES,COMODATO_ATIVOS,REVERTIDO_HOJE,OPORTUNIDADE_HOJE} = P);
  COMODATO_ATIVOS = COMODATO_ATIVOS || {};
  // índice rota -> [gerência, supervisão]: a Diretoria e a cascata juntam rotas de várias gerências
  ROTA_IDX = {};
  for(const gc in DATA) for(const sv in DATA[gc]) for(const r in DATA[gc][sv]) ROTA_IDX[r] = [gc, sv];
  // preserva o filtro atual se ele ainda existir no payload novo (a gerência ou o grupo de gerências)
  if(!temDados(sel.gc)) sel = {...sel, gc:primeiraGc(), sv:'', rota:''};
  if(sel.dgc && !DATA[sel.dgc]) sel.dgc = '';
  // supervisão: uma que ainda tem rota normal ou "Neutraliza" se a gerência ainda tem rota Neutraliza
  if(sel.sv && !(sel.sv===SV_NEUTRA ? rotasNeutraliza(sel.gc).length : svsVisiveis(sel.gc).includes(sel.sv))) { sel.sv=''; sel.rota=''; }
  if(sel.rota && (!rotaSv(sel.gc, sel.rota) || ehVirtual(sel.rota))) sel.rota='';
}

async function recarregaPayload(){
  try{
    aplicaPayload(await buscaJson(CONFIG.PAYLOAD_URL));
    if(!confereAcesso()) return;       // o acesso em uso não vale mais no payload novo: entrada com o aviso
    render();
    if($('q').value.trim()) buscaCliente();
  }catch(e){ console.warn('payload.json indisponível', e); }
}

async function iniciar(){
  try{
    aplicaPayload(await buscaJson(CONFIG.PAYLOAD_URL));
  }catch(e){
    $('cargaTxt').textContent = 'Não foi possível carregar os dados. Atualize a página.';
    $('lista').innerHTML = '<div class="vazio">Não foi possível carregar os dados. Atualize a página.</div>'; return;
  }
  RS.liga();
  // a tela de carga fica até decidir: acesso guardado (painel direto, sem piscar a entrada) ou entrada; o link do
  // Resumo (?resumo=) abre direto e não mexe no acesso guardado
  const link = new URLSearchParams(location.search).has('resumo');
  if(!link) entradaOuAcesso();
  render();
  if(!link) $('carga').hidden = true;
  await puxaOnline();
  if(link){ RS.doLink(); $('carga').hidden = true; }
  setInterval(puxaOnline, CONFIG.ONLINE_POLL_MS);
  setInterval(recarregaPayload, CONFIG.PAYLOAD_POLL_MS);
  iniciado = true;
}
/* De volta do segundo plano (aba ou app da tela inicial; no iPhone os temporizadores param com o app fechado): online
   já (com a checagem de versão) e o payload se o último tiver mais de PAYLOAD_POLL_MS. visibilitychange e pageshow
   costumam vir juntos: uma vez só. */
let iniciado = false, ultimaVolta = 0;
function aoVoltar(){
  if(!iniciado || Date.now() - ultimaVolta < 2000) return;
  ultimaVolta = Date.now();
  puxaOnline();
  if(Date.now() - P._versao > CONFIG.PAYLOAD_POLL_MS) recarregaPayload();
}
document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState==='visible') aoVoltar(); });
addEventListener('pageshow', aoVoltar);
iniciar();
