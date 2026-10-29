/* Invariantes do ajuste de rótulos (rótulo "Novos Negócios" do macro VOL DEST+ART+CND, nome da aba EXEC por perfil e
   notas menores), usadas pela Parte AA do front.test.js (dado sintético) e pela conferencia_real.test.js (dado real).
   As funções *_PAGINA rodam no navegador (page.evaluate). */
'use strict';
const SUB = 'Dest+Art+Cnd', NOVOS = 'Novos Negócios', K_NOVOS = 'VOL DEST+ART+CND';
const NOME_EXEC = {dir: 'Diretoria', gc: 'Gerencial', sv: 'Supervisão'};

/* ocorrências de "Dest+Art+Cnd" na página: texto VISÍVEL fora da 2ª linha do card de Volume (.ind .tsub) e atributos
   lidos por pessoas (title, aria-label, alt, placeholder, data-dica); devolve [onde, trecho] */
const RASTRO_PAGINA = sub => {
  const achados = [];
  const visivel = el => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length) &&
    getComputedStyle(el).visibility !== 'hidden';
  const andar = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for(let n = andar.nextNode(); n; n = andar.nextNode()){
    if(!n.nodeValue.includes(sub)) continue;
    const el = n.parentElement;
    if(!el || el.closest('script,style') || el.closest('.ind .tsub') || !visivel(el)) continue;
    achados.push([el.tagName.toLowerCase() + '#' + (el.id || '') + '.' + String(el.className || ''), n.nodeValue.trim().slice(0, 60)]);
  }
  for(const el of document.querySelectorAll('[title],[aria-label],[alt],[placeholder],[data-dica]'))
    for(const a of ['title', 'aria-label', 'alt', 'placeholder', 'data-dica'])
      if((el.getAttribute(a) || '').includes(sub)) achados.push([`${el.tagName.toLowerCase()}[${a}]`, el.getAttribute(a).slice(0, 60)]);
  return achados;
};

/* card de Volume do macro e os outros 4: título, 2ª linha, estilo (tamanho, peso, cor, fundo do card), alturas */
const CARDS_VOLUME_PAGINA = k => {
  const rgb = s => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
  const lum = c => { const v = c.map(x => { x /= 255; return x <= .03928 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4; });
    return .2126 * v[0] + .7152 * v[1] + .0722 * v[2]; };
  const contraste = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + .05) / (y + .05); };
  const cards = [...document.querySelectorAll('#lista .ind')].filter(c => c.offsetParent);
  return cards.map(c => {
    const t = c.querySelector('.tit'), s = c.querySelector('.tsub');
    const ct = getComputedStyle(t), fundo = rgb(getComputedStyle(c).backgroundColor);
    const r = {k: c.dataset.k || null, vol: c.classList.contains('vol'), off: c.classList.contains('off'),
      tit: t.textContent, sub: s ? s.textContent : null, h: c.getBoundingClientRect().height,
      topo: Math.round(c.getBoundingClientRect().top), tFs: parseFloat(ct.fontSize), tLum: lum(rgb(ct.color))};
    if(s){
      const cs = getComputedStyle(s);
      Object.assign(r, {sFs: parseFloat(cs.fontSize), sPeso: cs.fontWeight, sLum: lum(rgb(cs.color)),
        sContraste: contraste(rgb(cs.color), fundo), sVisivel: s.getClientRects().length > 0,
        sDepois: !!(t.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_FOLLOWING) &&
          s.getBoundingClientRect().top >= t.getBoundingClientRect().bottom - 1});
    }
    return r;
  });
};

/* tamanho e contraste das notas de rodapé e legendas (só os elementos visíveis) */
const NOTAS_PAGINA = () => {
  const rgb = s => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
  const lum = c => { const v = c.map(x => { x /= 255; return x <= .03928 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4; });
    return .2126 * v[0] + .7152 * v[1] + .0722 * v[2]; };
  // fundo efetivo: o 1º ancestral com fundo opaco
  const fundo = el => { for(let e = el; e; e = e.parentElement){ const b = getComputedStyle(e).backgroundColor;
    if(!/rgba\(.*,\s*0\)$|transparent/.test(b)) return rgb(b); } return [255, 255, 255]; };
  const out = {};
  for(const [nome, sel] of [['rodape', '#rodape'], ['creditos', '#rodape .creditos'], ['legenda', '#exec .legenda'],
                            ['ladoCred', '#ladoCred']]){
    const el = [...document.querySelectorAll(sel)].find(e => e.getClientRects().length);
    if(!el) continue;
    const cs = getComputedStyle(el), [a, b] = [lum(rgb(cs.color)), lum(fundo(el))].sort((p, q) => q - p);
    out[nome] = {fs: parseFloat(cs.fontSize), contraste: (a + .05) / (b + .05)};
  }
  return out;
};

/* aba EXEC: [visível, texto do botão, title, aria-label, #abTit quando ativa] */
const ABA_EXEC_PAGINA = () => {
  const t = document.querySelector('.tab[data-g="EXEC"]');
  return {visivel: !t.hidden && t.getClientRects().length > 0, span: t.querySelector('span').textContent, title: t.title,
    aria: t.getAttribute('aria-label'), on: t.classList.contains('on'), abTit: document.getElementById('abTit').textContent};
};

/* antes x depois: textos da tela (cards da lista sem a 2ª linha, cabeçalho da aba sem o título, visão executiva sem o bloco
   "Evolução contra o mês anterior", redesenhado de propósito em barras pareadas em 22/10/2026) */
const TEXTOS_TELA_PAGINA = () => {
  const limpa = el => { const c = el.cloneNode(true); c.querySelectorAll('.tsub, #exEvo').forEach(s => s.remove()); return c.textContent.replace(/\s+/g, ' ').trim(); };
  const topo = document.getElementById('abaTopo').cloneNode(true);
  topo.querySelector('#abTit').remove();
  const ex = document.getElementById('exec');
  return {lista: [...document.querySelectorAll('#lista .ind')].map(limpa), topo: limpa(topo), exec: ex.hidden ? '' : limpa(ex)};
};
// NaN vira 'NaN' (o JSON perderia a diferença entre NaN e null); o lado de antes ganha o nome novo
const semNaN = o => JSON.parse(JSON.stringify(o, (k, v) => Number.isNaN(v) ? 'NaN' : v));
const comNomeNovo = o => JSON.parse(JSON.stringify(semNaN(o)).replace(/Dest\+Art\+Cnd/g, NOVOS));

/* Antes x depois contra fronts anteriores aos ajustes visuais da Executiva (Parte AE de front.test.js): desfaz no front atual
   o que a etapa acrescenta de propósito, em HTML ou texto (strings dentro de objetos e listas também): a linha do medidor
   (.gFalta, "faltam X para a meta" / "meta batida · +X"), os data-meta/data-real do .gCard e o rótulo visível e o placeholder
   da busca (antes, o rótulo só para leitor de tela). O resto continua comparado byte a byte. */
const desfazAE = x => {
  if(Array.isArray(x)) return x.map(desfazAE);
  if(x && typeof x === 'object') return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, desfazAE(v)]));
  if(typeof x !== 'string') return x;
  return x.replace(/<div class="gFalta( ok)?">[^<]*<\/div>/g, '')
    .replace(/( data-desvio="[^"]*") data-meta="[^"]*" data-real="[^"]*">/g, '$1>')
    .replace(/<label class="buscaRot" for="q">Busca por cliente<\/label>(\s*)<div class="buscaWrap">(\s*)<input/g,
             '<div class="buscaWrap">$2<label class="sr-only" for="q">Buscar cliente ou rede</label>$2<input')
    .replace('placeholder="Digite nome, código ou rede"', 'placeholder="Buscar cliente por nome, código ou rede"')
    .replace(/faltam [\d.]+ para a meta|meta batida · \+[\d.]+/g, '')
    .replace(/Busca por cliente/g, 'Buscar cliente ou rede');
};

module.exports = {desfazAE, SUB, NOVOS, K_NOVOS, NOME_EXEC, RASTRO_PAGINA, CARDS_VOLUME_PAGINA, NOTAS_PAGINA, ABA_EXEC_PAGINA,
  TEXTOS_TELA_PAGINA, semNaN, comNomeNovo};
