/* Dia não útil (sábado, domingo, feriado; decisão da Karen, 31/10/2026): o rótulo esperado da meta do dia do volume,
   recontado por fora do app.js. Dia não útil = DIA_HOJE === DIA_ONTEM fora do fechamento; o dia pelo DIA_SEMANA (sem acento
   e sem caixa): sábado, domingo ou, em qualquer outro dia, feriado; sem DIA_SEMANA, só "sem meta do dia". Não é teste:
   só exporta as funções (usadas pelas invariantes e pela Parte AL). */
'use strict';
const semDiaUtilDe = p => !p.FECHAMENTO && p.DIA_HOJE === p.DIA_ONTEM;
const diaNaoUtilDe = diaSemana => {
  const d = String(diaSemana || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  return !d ? '' : d.startsWith('sabado') ? 'sábado' : d.startsWith('domingo') ? 'domingo' : 'feriado';
};
const rotuloSemMetaDiaDe = (diaSemana, curto) => {
  const q = diaNaoUtilDe(diaSemana);
  return curto || !q ? 'sem meta do dia' : `sem meta do dia · ${q}`;
};
module.exports = {semDiaUtilDe, diaNaoUtilDe, rotuloSemMetaDiaDe};
