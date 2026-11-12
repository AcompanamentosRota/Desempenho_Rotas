/* Guarda das senhas da Diretoria (PN-45, 12/11/2026).

   O repositório é PÚBLICO. As senhas da Diretoria só podem existir aqui como HASH, em
   CONFIG.DIRETORIA_SENHAS_HASH (frontend/js/config.js); nenhum arquivo pode trazer uma delas por extenso — nem
   num teste, nem num comentário, nem dentro de uma expressão regular. Como ninguém pode CONFERIR isso lendo o
   código (ler já seria ver a senha), a conferência é feita pelo hash: este módulo varre frontend/js/ e
   frontend/tests/, aplica a MESMA conta do painel a cada literal de string e a cada sequência de até
   N_GRAMAS palavras, e devolve só o ARQUIVO e a LINHA em que algum texto bateu com um dos hashes reais.

   NUNCA devolver, imprimir nem gravar o texto encontrado: o achado aponta o lugar a consertar e nada mais. Isso
   não expõe nada que já não esteja público — os hashes estão no config.js, que vai para o Pages.

   Conta do painel (hashSenha em app.js): SHA-256, hex minúsculo, de "drotas:" + o texto sem espaços nas pontas e
   em MAIÚSCULAS, em UTF-8. As senhas FICTÍCIAS dos testes ficam em senha_teste.js.

   Usado pela Parte AO do front.test.js (varredura dos dois diretórios) e pela Parte I (nenhuma palavra da tela de
   entrada é uma das senhas). */
'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const FRONT = path.resolve(__dirname, '..');
const DIRS = ['js', 'tests'];                     // só estes dois: a varredura tem de ser rápida
const N_GRAMAS = 4;                               // "Uma Senha De Teste" tem 4 palavras
// literais de string ('...', "...", `...`, sem quebra de linha) e palavras (letras, números, _ . ' -)
const LITERAL = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;
const PALAVRA = /[\p{L}\p{N}][\p{L}\p{N}_.'-]*/gu;

const normaliza = s => String(s == null ? '' : s).trim().toUpperCase();
const hashTexto = s => crypto.createHash('sha256').update('drotas:' + normaliza(s), 'utf8').digest('hex');

// os hashes reais, lidos do config.js (nunca escritos aqui)
function hashesReais(arquivo = path.join(FRONT, 'js', 'config.js')){
  const m = fs.readFileSync(arquivo, 'utf-8').match(/DIRETORIA_SENHAS_HASH:\s*\[([^\]]*)\]/);
  return (m && m[1].match(/[0-9a-f]{64}/g)) || [];
}

/* Candidatos de uma linha (ou de um texto qualquer): cada literal de string e cada sequência de 1 a N_GRAMAS
   palavras, normalizados. Pega senha de uma palavra, de várias ("Uma Senha Assim") e dentro de literal, regex ou
   comentário. */
function candidatos(texto){
  const fora = new Set();
  for(const m of String(texto).matchAll(LITERAL)){
    const t = normaliza(m[1] ?? m[2] ?? m[3] ?? '');
    if(t) fora.add(t);
  }
  const pal = [...String(texto).matchAll(PALAVRA)].map(x => x[0]);
  for(let a = 0; a < pal.length; a++)
    for(let n = 1; n <= N_GRAMAS && a + n <= pal.length; n++){
      const t = normaliza(pal.slice(a, a + n).join(' '));
      if(t) fora.add(t);
    }
  return [...fora];
}

/* Quantos candidatos de `texto` são uma das senhas reais (0 = nenhum). Só a CONTAGEM: nunca o texto. */
function senhasNoTexto(texto, hashes = hashesReais()){
  const alvo = new Set(hashes);
  return candidatos(texto).filter(c => alvo.has(hashTexto(c))).length;
}

/* Varre frontend/js/ e frontend/tests/ (arquivos do 1º nível, qualquer extensão). Devolve
   {achados: ['frontend/tests/arquivo.js:123', ...], arquivos, linhas, candidatos} — nunca o texto achado. */
function varre({dirs = DIRS, front = FRONT, hashes = hashesReais()} = {}){
  const alvo = new Set(hashes);
  const achados = [], vistos = new Set();
  let arquivos = 0, linhas = 0, nCand = 0;
  for(const dir of dirs){
    const d = path.join(front, dir);
    for(const nome of fs.readdirSync(d).sort()){
      const arq = path.join(d, nome);
      if(!fs.statSync(arq).isFile()) continue;
      arquivos++;
      const rel = [path.basename(front), dir, nome].join('/');
      fs.readFileSync(arq, 'utf-8').split(/\r?\n/).forEach((linha, i) => {
        linhas++;
        for(const c of candidatos(linha)){
          if(vistos.has(c)) continue;             // o mesmo texto só é pesado uma vez (a varredura fica rápida)
          vistos.add(c); nCand++;
          if(alvo.has(hashTexto(c))) achados.push(`${rel}:${i + 1}`);
        }
      });
    }
  }
  return {achados, arquivos, linhas, candidatos: nCand};
}

module.exports = {hashTexto, hashesReais, candidatos, senhasNoTexto, varre, DIRS, N_GRAMAS, FRONT};
