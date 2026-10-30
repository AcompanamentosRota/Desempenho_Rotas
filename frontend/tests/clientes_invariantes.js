/* Invariantes da gaveta "Clientes" (botão do cabeçalho das abas Volume, ICS GC, Novos Negócios e Todos a Bordo), as mesmas
   na Parte AH do front.test.js (dado sintético) e na conferência com dado real (conferencia_real.test.js).

   Para o filtro atual e cada agrupador do botão:
   (a) a lista do botão = a lista do último nível da cascata do mesmo escopo: a cascata é percorrida inteira (todos os
       caminhos até a lista de clientes, cada uma no dia "Todos"); a união das listas, na ordem da lista (volume pela
       Dif. Abs, coberturas pelo nome, Venda Zero pelas geladeiras; empate na ordem das rotas do filtro), tem de ser igual,
       linha a linha (HTML: mesmos clientes, rotas, números e riscados), à lista do botão no dia "Todos";
   (b) agrupadores do botão = os cards da aba que abrem a cascata, na ordem dos cards;
   (c) só rotas com o agrupador disponível (decisão da Karen de 30/10/2026; no Todos a Bordo, com meta do item, temMetaInc):
       na Gerência, na Supervisão e na Rota a cascata já não entra nas outras; na Diretoria ela abre a gerência direto nos
       clientes e mostra também os das rotas sem o agrupador, que saem da comparação e são contados (foraDir);
   (d) busca: a lista com a busca = a lista inteira filtrada pelo nome (sem acento, sem caixa) ou pelo PV (contém).
   As contas rodam no navegador (uma chamada por aba) e só voltam contagens, códigos de rota e o 1º índice diferente:
   nunca nomes nem códigos de clientes (a conferência com dado real imprime o resumo).
   CONFIG é congelado: a página tem de ser servida com o config.js com LIMITE_LISTA alto (LIMITE_SEM, ver semLimite), senão
   a conferência para com erro (as listas cortadas no limite não se comparam). */
'use strict';

/* roda no navegador: confere a aba ativa; opts = {buscas: [texto, ...]} (além das buscas automáticas: um PV e parte de um
   nome de cada lista) */
function CONFERE_CLIENTES(opts){
  const o = opts || {};
  const out = {aba, dir: sel.modo === 'dir' && !sel.dgc, ks: [], cards: [], porK: {}, erros: []};
  try {
    if(!(CONFIG.LIMITE_LISTA >= 1e6)) throw new Error('sirva o config.js com LIMITE_LISTA alto (semLimite)');
    const ordem = new Map(rotasListas().map((r, i) => [r, i]));
    const todos = () => { const b = document.querySelector('#dLista .dchip[data-d="Todos"]'); if(b) b.click(); };
    const vz = k => k === 'VENDAZERO';
    // nome do cliente na linha: o texto antes da etiqueta "Venda Online"/"Revertido" (que vem depois de um espaço)
    const nomeLinha = el => { const nm = el.querySelector('.nm'), t = nm.firstChild.textContent;
      return nm.querySelector('.tagOnline') ? t.replace(/ $/, '') : t; };
    // linhas da lista aberta: {html, rota, chave (ordem da lista), nome, pv}
    const coleta = k => [...document.querySelectorAll('#dLista > .cCli, #dLista > .item')].map(el => {
      const rota = (el.querySelector('.sb').textContent.match(/· rota (\S+)/) || [])[1];
      const nome = nomeLinha(el);
      let chave, pv = null;
      if(el.classList.contains('cCli')){
        chave = Number(el.dataset.dif);
        // nome repetido na rota: desempata pelo Real do cliente (data-real = VOLUME_CLIENTE[rota][pv][i][1])
        const i = volDaRota(rota).indexOf(k), cs = (CLIENT_ROSTER[rota] || []).filter(c => c[1] === nome);
        const c = cs.length > 1 ? cs.find(c => ((((P.VOLUME_CLIENTE[rota] || {})[c[0]] || [])[i]) || [])[1] === Number(el.dataset.real)) : cs[0];
        pv = c ? c[0] : null;
        if(cs.length > 1) out.repetidos = (out.repetidos || 0) + 1;
      } else if(vz(k)){
        chave = -parseInt(el.querySelector('.bd').textContent, 10);
        const e = (VENDAZERO_CLIENTES[rota] || []).find(e => e.nome === nome); pv = e ? e.pv : null;
      } else { chave = nome; pv = Number(el.querySelector('.bd').textContent.replace(/^PV /, '')); }
      return {html: el.outerHTML, rota, chave, nome, pv};
    });
    const cmp = (a, b) => (typeof a.chave === 'string' ? a.chave.localeCompare(b.chave) : a.chave - b.chave)
      || (ordem.get(a.rota) - ordem.get(b.rota));
    const difere = (a, b) => { const n = Math.max(a.length, b.length);
      for(let i = 0; i < n; i++) if(a[i] !== b[i]) return i; return -1; };
    // (b) os cards que abrem a cascata
    out.cards = [...document.querySelectorAll('#lista .ind[data-k]')].map(e => e.dataset.k);
    const abreCasc = k => aba === 'INCENTIVO' ? abreIncentivo(k) : abreIndicador(k);
    const cascata = k => {
      const l = [];
      abreCasc(k);
      if(!$('drw').classList.contains('on')) return l;
      const anda = () => {
        if($('dLista')){ todos(); l.push(...coleta(k)); return; }
        const n = document.querySelectorAll('#dCorpo .cLin[data-i]').length;
        for(let i = 0; i < n; i++){
          document.querySelectorAll('#dCorpo .cLin[data-i]')[i].click();
          anda();
          $('cVolta').click();
        }
      };
      anda();
      fecha();
      return l;
    };
    abreClientes();
    out.ks = [...document.querySelectorAll('#cliKs .dchip')].map(e => e.dataset.k);
    fecha();
    for(const k of out.ks){
      const tudo = cascata(k), esperado = tudo.filter(x => temItemCli(k, x.rota));
      // ordem da lista sobre a união (a cascata dá uma lista por rota ou, na Diretoria, por gerência)
      const ordenado = esperado.slice().sort(cmp);
      abreClientes();
      document.querySelector(`#cliKs .dchip[data-k="${CSS.escape(k)}"]`).click();
      todos();
      const botao = coleta(k);
      const r = {n: botao.length, nCascata: esperado.length, foraDir: tudo.length - esperado.length, rotas: [...new Set(botao.map(x => x.rota))].length,
                 igual: difere(botao.map(x => x.html), ordenado.map(x => x.html)), tit: $('dTit').textContent,
                 sub: $('dSub').textContent, semMeta: [], buscas: []};
      r.semMeta = [...new Set(botao.map(x => x.rota))].filter(rt => !temItemCli(k, rt));
      // (d) buscas: o PV da 1ª linha, o da do meio, parte do nome da última e as pedidas
      const qs = [...(o.buscas || [])];
      if(botao.length){
        const meio = botao[Math.floor(botao.length / 2)], ult = botao[botao.length - 1];
        if(botao[0].pv != null) qs.push(String(botao[0].pv));
        if(meio.pv != null) qs.push(String(meio.pv));
        qs.push(ult.nome.slice(Math.floor(ult.nome.length / 3), Math.floor(ult.nome.length / 3) + 5).toLowerCase());
      }
      for(const q of qs){
        $('cliQ').value = q;
        $('cliQ').dispatchEvent(new Event('input'));
        const casa = buscaCasa(q), filtrada = botao.filter(x => casa(x.pv, x.nome)).map(x => x.html);
        const achada = coleta(k).map(x => x.html);
        r.buscas.push({tipo: /^\d+$/.test(q) ? 'pv' : 'nome', n: achada.length, igual: difere(achada, filtrada),
                       dia: (document.querySelector('#dLista .dchip.on') || {}).dataset.d,
                       vazio: (document.querySelector('#dLista > .vazio') || {}).textContent || ''});
      }
      fecha();
      out.porK[k] = r;
    }
  } catch(e) { out.erros.push(String(e && e.stack || e)); }
  finally { fecha(); }
  return out;
}

/* confere a aba ativa da página e devolve o resumo; `onde` entra nas mensagens */
async function confereAba(page, onde, opts = {}){
  const assert = require('node:assert/strict');
  const r = await page.evaluate(`(${CONFERE_CLIENTES})(${JSON.stringify(opts)})`);
  assert.deepEqual(r.erros, [], `${onde}: erro no navegador`);
  // (b) um botão por agrupador = os cards que abrem a cascata (na ordem deles)
  assert.deepEqual(r.ks, r.cards, `${onde}: agrupadores do botão x cards`);
  for(const [k, x] of Object.entries(r.porK)){
    assert.equal(x.igual, -1, `${onde} ${k}: lista do botão x cascata (1ª linha diferente ${x.igual}; ${x.n} x ${x.nCascata})`);
    assert.equal(x.n, x.nCascata, `${onde} ${k}: tamanho`);
    assert.match(x.tit, /^Clientes · /, `${onde} ${k}: título`);
    assert.deepEqual(x.semMeta, [], `${onde} ${k}: rotas sem o agrupador`);
    if(!r.dir) assert.equal(x.foraDir, 0, `${onde} ${k}: fora da Diretoria, a cascata não mostra rota sem o agrupador`);
    for(const b of x.buscas){
      assert.equal(b.igual, -1, `${onde} ${k}: busca (${b.tipo}) x lista filtrada`);
      assert.equal(b.dia, 'Todos', `${onde} ${k}: o dia continua com a busca`);
      if(!b.n) assert.match(b.vazio, /^Ninguém neste filtro\.$|^Nenhum cliente com meta neste agrupador\.$/, `${onde} ${k}: sem resultado`);
    }
  }
  return r;
}

/* config.js servido sem limite nas listas (para a conferência; `troca` dos testes) */
const LIMITE_SEM = 1e9;
const semLimite = texto => String(texto).replace(/LIMITE_LISTA:\s*\d+/, `LIMITE_LISTA: ${LIMITE_SEM}`);

/* tira o botão "Clientes" do HTML do cabeçalho da aba (#abaTopo) para comparar com um front de antes da gaveta */
const semBotaoClientes = html => String(html).replace(/\s*<button class="abCli"[^>]*>[\s\S]*?<\/button>/, '');

module.exports = {CONFERE_CLIENTES, confereAba, semBotaoClientes, semLimite, LIMITE_SEM};
