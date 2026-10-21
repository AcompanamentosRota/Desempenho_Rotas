/* Conferência automática da aba Executiva com DADO REAL (Etapa 5; invariantes da seção 7 do pacote de implementação).
   Só roda quando as variáveis de ambiente PAYLOAD_REAL e ONLINE_REAL apontam para os JSONs (uma cópia FORA do
   repositório, ex.: `git show origin/main:frontend/data/payload.json > /tmp/real/payload.json`, idem online.json); sem
   elas, pula sem falhar:

       PAYLOAD_REAL=/tmp/real/payload.json ONLINE_REAL=/tmp/real/online.json node --test frontend/tests/conferencia_real.test.js

   Precisa do pacote "playwright" (local, NODE_PATH ou global) e do Chromium dele. Os arquivos do front são servidos por
   interceptação (sem servidor), com os dois JSONs no lugar de data/. Escopos: a Diretoria, cada gerência com dados (filtro
   da Diretoria), cada grupo de gerências no Total (perfil Gerência) e uma supervisão (perfil Supervisão). As invariantes
   (KPIs = cards das abas, desvio do total = Tendência / Meta - 1 do card de Volume, % da linha de total das coberturas =
   cards do ICS GC / Novos Negócios / Todos a Bordo, Status, somas e "restam" de Sem compra e Agenda, gaveta Sem compra)
   estão em executiva_invariantes.js. Imprime uma tabela-resumo (só totais e códigos; nada de clientes). */
'use strict';
const {test, before, after, describe} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {execSync} = require('node:child_process');
const {confereExecutiva} = require('./executiva_invariantes.js');

const FRONT = path.resolve(__dirname, '..');
const PAYLOAD = process.env.PAYLOAD_REAL, ONLINE = process.env.ONLINE_REAL;

function carregaPlaywright(){
  try { return require('playwright'); } catch(e) { /* tenta o global */ }
  try { return require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); } catch(e) { return null; }
}
const pw = (PAYLOAD && ONLINE) ? carregaPlaywright() : null;
const pular = !(PAYLOAD && ONLINE) ? 'sem PAYLOAD_REAL e ONLINE_REAL (conferência com dado real só sob demanda)'
  : !(fs.existsSync(PAYLOAD) && fs.existsSync(ONLINE)) ? 'PAYLOAD_REAL ou ONLINE_REAL não existe'
  : !pw ? 'Playwright não instalado' : false;

const TIPOS = {'.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json',
  '.png':'image/png', '.woff2':'font/woff2', '.webmanifest':'application/manifest+json'};
const CHROMIUM = ['/opt/pw-browsers/chromium'].find(p => fs.existsSync(p));
let browser;
before(async () => { if(!pular) browser = await pw.chromium.launch(CHROMIUM ? {executablePath: CHROMIUM} : {}); });
after(async () => { if(browser) await browser.close(); });

async function abre(largura = 1440){
  const ctx = await browser.newContext({viewport: {width: largura, height: 1000}});
  const page = await ctx.newPage();
  const erros = [];
  page.on('pageerror', e => erros.push(String(e)));
  page.on('console', m => { if(m.type() === 'error') erros.push(m.text()); });
  await page.route('http://painel.test/**', rota => {
    const url = new URL(rota.request().url());
    const arq = url.pathname === '/data/payload.json' ? PAYLOAD : url.pathname === '/data/online.json' ? ONLINE
      : path.join(FRONT, url.pathname);
    if(!fs.existsSync(arq)) return rota.fulfill({status: 404, body: ''});
    rota.fulfill({status: 200, contentType: TIPOS[path.extname(arq)] || 'application/octet-stream', body: fs.readFileSync(arq)});
  });
  await page.route(/cdnjs\.cloudflare\.com/, r => r.abort());
  await page.goto('http://painel.test/index.html');
  await page.waitForFunction(() => typeof P !== 'undefined' && P && document.getElementById('carga').hidden);
  return {page, ctx, erros};
}
// entra pela tela de entrada (a casa volta para ela): {perfil: 'dir'} | {perfil: 'gc', gc} | {perfil: 'sv', gc, sv}
async function entra(page, {perfil, gc, sv}){
  if(await page.isHidden('#entrada')) await page.click('#btnCasa');
  await page.click(`#entrada [data-perfil="${perfil}"]`);
  if(perfil === 'dir') return;
  await page.click(`#entOpcoes [data-gc="${gc}"]`);
  if(perfil === 'sv') await page.click(`#entOpcoes [data-sv="${sv}"]`);
}

describe('Conferência da Executiva com dado real (seção 7)', {skip: pular}, () => {
  for(const largura of [1440, 390])
  test(`${largura} px: Diretoria, cada gerência, cada grupo no Total e uma supervisão: invariantes da seção 7`, async () => {
    const {page, ctx, erros} = await abre(largura);
    const info = await page.evaluate(() => ({gcs: gcsComDados(), grupos: gruposGc().map(g => g.chave).filter(temDados),
      mes: P.MES_LABEL, dia: `${P.DIA_HOJE}/${P.TOTAL_DIAS_UTEIS}`, fech: !!P.FECHAMENTO}));
    const linhas = [];
    await entra(page, {perfil: 'dir'});
    assert.equal(await page.evaluate(() => aba), 'EXEC', 'a Diretoria abre na Executiva');
    linhas.push(await confereExecutiva(page, 'BAND'));
    for(const g of info.gcs){
      await page.selectOption('#fgc', g);
      linhas.push(await confereExecutiva(page, `GC.${g}`));
    }
    for(const g of info.grupos){
      await entra(page, {perfil: 'gc', gc: g});
      assert.equal(await page.evaluate(() => aba), 'EXEC', `${g}: a Gerência abre na Executiva`);
      linhas.push(await confereExecutiva(page, `Total ${g}`));
    }
    const sv = await page.evaluate(() => { const g = gcsComDados()[0]; return {gc: g, sv: svsDaEntrada(g)[0]}; });
    await entra(page, {perfil: 'sv', gc: sv.gc, sv: sv.sv});
    assert.equal(await page.evaluate(() => aba), 'EXEC', 'a Supervisão abre na Executiva');
    linhas.push(await confereExecutiva(page, sv.sv));
    const upd = await page.evaluate(() => (ONLINE || {}).updatedAt);
    assert.deepEqual(erros, []);
    await ctx.close();
    const cab = ['Escopo', 'Base', 'Sem compra', 'Visitas hoje', 'Categ. tend.', 'Cob. no ritmo', 'Desvio Refri (total)',
                 'Status TaB', 'Agendados', 'Sem compra hoje', 'Pediram online', 'Restam', 'Gaveta Sem compra'];
    console.log(`# Conferência com dado real (${largura} px): ${info.mes}, dia útil ${info.dia}${info.fech ? ' (fechamento)' : ''}, online ${upd}`);
    console.log(`# | ${cab.join(' | ')} |`);
    console.log(`# |${cab.map(() => '---').join('|')}|`);
    for(const l of linhas) console.log(`# | ${[l.onde, l.base, l.sem, l.vis, l.cat, l.cob, l.desvio, l.status, l.ag, l.semHoje,
                                              l.ped, l.restam, l.gaveta].join(' | ')} |`);
  });
});
