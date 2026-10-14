/* Inicialização: carrega payload.json + online.json e agenda as atualizações.
   O back-end regenera os dois arquivos a cada 15 min em dias úteis; o front
   revalida o payload no mesmo ritmo (ETag: só baixa quando mudou) e o online a cada 5 min. */
function aplicaPayload(novo){
  P = novo;
  P._versao = Date.now();
  ({DATA,LABELS,GROUPS,CLIENT_ROSTER,CLIENTES_HOJE,OPORTUNIDADES_DIA,VISITAS_DIA,SEGS,DIAS,COBERTOS,SEM_COMPRA_HOJE,VENDAZERO_CLIENTES,COMODATO_ATIVOS,REVERTIDO_HOJE,OPORTUNIDADE_HOJE} = P);
  COMODATO_ATIVOS = COMODATO_ATIVOS || {};
  // preserva o filtro atual se ele ainda existir no payload novo
  if(!DATA[sel.gc]) sel = {gc:P.GC_ATIVAS[0], sv:'', rota:''};
  if(sel.sv && !(DATA[sel.gc]||{})[sel.sv]) { sel.sv=''; sel.rota=''; }
  if(sel.rota && !rotaSv(sel.gc, sel.rota)) sel.rota='';
}

async function recarregaPayload(){
  try{
    aplicaPayload(await buscaJson(CONFIG.PAYLOAD_URL));
    render();
    if($('q').value.trim()) buscaCliente();
  }catch(e){ console.warn('payload.json indisponível', e); }
}

async function iniciar(){
  try{
    aplicaPayload(await buscaJson(CONFIG.PAYLOAD_URL));
  }catch(e){
    $('lista').innerHTML = '<div class="vazio">Não foi possível carregar os dados. Atualize a página.</div>'; return;
  }
  RS.liga();
  render();
  await puxaOnline();
  RS.doLink();
  setInterval(puxaOnline, CONFIG.ONLINE_POLL_MS);
  setInterval(recarregaPayload, CONFIG.PAYLOAD_POLL_MS);
}
iniciar();
