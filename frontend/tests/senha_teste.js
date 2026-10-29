/* Senha da Diretoria nos testes: as senhas reais NUNCA ficam no repositório (só os hashes, em config.js). Os testes
   servem o config.js com CONFIG.DIRETORIA_SENHAS_HASH trocado pelos hashes destas senhas FICTÍCIAS, calculados aqui
   com a mesma conta do front (hashSenha em app.js): SHA-256, hex minúsculo, de "drotas:" + senha sem espaços nas pontas
   e em MAIÚSCULAS, em UTF-8. */
'use strict';
const crypto = require('node:crypto');

const SENHAS_TESTE = ['Teste Painel 1', 'outra-senha-de-teste'];
const hashTeste = s => crypto.createHash('sha256').update('drotas:' + String(s).trim().toUpperCase(), 'utf8').digest('hex');
const HASHES_TESTE = SENHAS_TESTE.map(hashTeste);
const RE_HASHES = /DIRETORIA_SENHAS_HASH:\s*\[[^\]]*\]/;
// config.js servido nos testes: os hashes de teste no lugar dos reais (config.js sem a chave, de um front antigo, fica igual)
const trocaHash = (texto, hashes = HASHES_TESTE) =>
  String(texto).replace(RE_HASHES, `DIRETORIA_SENHAS_HASH: ${JSON.stringify(hashes)}`);
/* Também no config.js servido: CONFIG.GC_LIBERADAS (gerências que abrem na entrada) = `lista` (padrão null = todas, para
   os testes entrarem por qualquer gerência); 'config' = a lista do config.js. */
const RE_LIBERADAS = /GC_LIBERADAS:\s*(null|\[[^\]]*\])/;
const trocaLiberadas = (texto, lista = null) =>
  lista === 'config' ? String(texto) : String(texto).replace(RE_LIBERADAS, `GC_LIBERADAS: ${JSON.stringify(lista)}`);
/* Também no config.js servido: CONFIG.DIRETORIA_NOMES (nome de quem entra na Diretoria, pelo hash) = `nomes` (padrão
   {} = nenhum nome, só "Diretoria"), nunca o mapa real; NOMES_TESTE liga os hashes das senhas de teste a nomes FICTÍCIOS.
   config.js sem a chave (front antigo) fica igual. */
const NOMES_TESTE = {[HASHES_TESTE[0]]: 'Pessoa Teste Um', [HASHES_TESTE[1]]: 'Fulana de Teste'};
const RE_NOMES = /DIRETORIA_NOMES:\s*\{[^}]*\}/;
const trocaNomes = (texto, nomes = {}) =>
  String(texto).replace(RE_NOMES, `DIRETORIA_NOMES: ${JSON.stringify(nomes)}`);
/* Na caixa de senha aberta (botão DIRETORIA já clicado): digita a senha, Enter e espera sair da entrada. Front antigo
   (Diretoria sem senha, já entrou): não faz nada. */
async function digitaSenha(page, senha = SENHAS_TESTE[0]){
  if(!(await page.isVisible('#entSenha'))) return;
  await page.fill('#entSenha', senha);
  await page.press('#entSenha', 'Enter');
  await page.waitForFunction(() => document.getElementById('entrada').hidden);
}

module.exports = {SENHAS_TESTE, hashTeste, HASHES_TESTE, RE_HASHES, trocaHash, RE_LIBERADAS, trocaLiberadas, digitaSenha,
  NOMES_TESTE, RE_NOMES, trocaNomes};
