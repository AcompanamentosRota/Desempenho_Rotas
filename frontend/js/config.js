/* Configuração do front-end.
   Os JSONs são gerados pelo back-end (backend/scripts/gerar.py) via GitHub Actions
   e publicados junto com o site em data/. Para apontar para outro lugar
   (ex.: um bucket ou API), troque DATA_BASE. */
const CONFIG = Object.freeze({
  DATA_BASE: 'data/',
  PAYLOAD_URL: 'payload.json',
  ONLINE_URL: 'online.json',
  ONLINE_POLL_MS: 5 * 60 * 1000,      // busca online.json a cada 5 min
  PAYLOAD_POLL_MS: 15 * 60 * 1000,    // revalida payload.json a cada 15 min (mesmo ritmo do back-end)
  STATUS_TICK_MS: 60 * 1000,          // reavalia a tag "Online" a cada 1 min
  /* Aviso de versão nova do código: a versão do painel aberto é a <meta name="versao"> do index.html ("dev" = aviso
     desligado); a do servidor é VERSAO_URL, gravado pelo deploy-pages.yml (hash de frontend/ sem data/). Conferida a
     cada online, ao voltar para a aba/app e no pageshow. "Depois" esconde a faixa até a 1ª verificação após
     VERSAO_ADIA_MS. Ao voltar do segundo plano, o payload é recarregado se o último tiver mais de PAYLOAD_POLL_MS. */
  VERSAO_URL: 'versao.json',
  VERSAO_ADIA_MS: 30 * 60 * 1000,
  JANELA_VENDAS: { inicio: '07:30', fim: '17:29' },   // horário de Brasília
  // Neutraliza, virtuais e ocultas vêm do payload (NEUTRALIZA_ROTAS/VIRTUAIS_ROTAS/OCULTAS, listas únicas no
  // back-end). Esta lista só vale para um payload antigo, sem essas chaves: fora do "puxa a média" (além de
  // "ROTA SEM VENDEDOR") e das listas de clientes.
  SV_EXCLUIDOS: ['SV.G1.5', 'SV.G2.5', 'SV.G3.3', 'SV.IT.3', 'SV.MO.3'],
  // Aba Todos a Bordo (campanha "Todos a Bordo 3.0", cobertura de cervejas; chave interna INCENTIVO): false esconde
  // a aba. Sem o grupo INCENTIVO no payload (payload antigo), a aba fica oculta de qualquer jeito.
  INCENTIVO_ATIVO: true,
  // Linha "Status" do card do topo (Todos a Bordo e Novos Negócios): false = item em 100% com Real >= Meta; true =
  // também com os clientes distintos no Real ou no online de hoje >= Meta (no fechamento, só o Real)
  STATUS_INCLUI_ONLINE: false,
  // Aba Executiva: bloco "Evolução contra o mês anterior" (Etapa 8c; só Volume, pela chave MES_ANTERIOR do payload).
  // false = o bloco não aparece; payload sem a chave (antigo ou com a consulta do mês anterior falhando) também não
  EVOLUCAO_ATIVA: true,
  // Placa ATENÇÃO do Resumo: % mínimo de indicadores no ritmo; null = desligada (não aparece)
  LIMIAR_ATENCAO: null,
  // Resumo da Diretoria: gerências por faixa (acima disso, quebra em faixas)
  RS_COLUNAS_FAIXA: 8,
  CREDITOS: 'Karen Oliveira - Inteligência de Mercado',
  /* Rótulo do macro de volume VOL DEST+ART+CND (chave interna e payload continuam "Dest+Art+Cnd"): todo o painel mostra
     ROTULO_VOLUME_NOVOS (rotuloFront abaixo); ROTULO_VOLUME_SUB é a 2ª linha, menor, só no card da aba Volume. Não
     confundir com a aba/grupo de coberturas "Novos Negócios" (NOVOS_NEG), que não muda. */
  ROTULO_VOLUME_NOVOS: 'Novos Negócios',
  ROTULO_VOLUME_SUB: 'Dest+Art+Cnd',
  // nome da aba EXEC (visão executiva) por perfil; o perfil Rota não tem a aba
  ABA_EXEC_NOME: {dir: 'Diretoria', gc: 'Gerencial', sv: 'Supervisão'},
  /* Controle de acesso interno: a entrada só organiza o que cada perfil vê (sem usuário; senha só na Diretoria); NÃO
     é segurança — os dados estão em frontend/data/*.json. O acesso fica guardado no aparelho até a virada do dia
     (05:00, horário de Brasília) ou até clicar na casa. */
  SESSAO_VIRADA_HORA: 5,              // o "dia de trabalho" do acesso guardado vira às 05:00 de Brasília
  /* Senha da visão Diretoria: controle de acesso INTERNO (organiza o que cada perfil vê), NÃO é segurança — os dados
     continuam em frontend/data/*.json e qualquer um pode lê-los. Duas senhas valem; aqui ficam SÓ os hashes, nunca a
     senha: SHA-256 (hex minúsculo) de "drotas:" + a senha sem espaços nas pontas e em MAIÚSCULAS, em UTF-8 (hashSenha
     em app.js). Gerência, Supervisão e Rota entram sem senha. */
  DIRETORIA_SENHAS_HASH: [
    'b9d9818e4672b1f0d17c953a7dce40e58b06e06168e3aa2bda2bb7ca254d3d66',
    '912ab610b482ee34ffca833bfbb38dc64b9cd7fc04fe142dbcaaca9b038db34c',
  ],
  // nome de quem entra na Diretoria, pelo hash da senha (os mesmos de DIRETORIA_SENHAS_HASH; nunca a senha): aparece no
  // cabeçalho ("Diretoria · nome") e fica no acesso guardado; hash sem nome aqui = só "Diretoria"
  DIRETORIA_NOMES: {
    'b9d9818e4672b1f0d17c953a7dce40e58b06e06168e3aa2bda2bb7ca254d3d66': 'Ana Paula Naves',
    '912ab610b482ee34ffca833bfbb38dc64b9cd7fc04fe142dbcaaca9b038db34c': 'Alberto Batista',
  },
  // Gerências agrupadas: os pares que o Datasphere junta numa gerência só (Pa_Di, Gu_Po, It_Mo, Ur_Ri; ver
  // GC_ORIGEM e GC_SIGLAS_ORIGEM em backend/gerador/mapeamento.py). Na entrada viram uma opção "GC.IT + GC.MO"
  // que abre o total das duas, com o seletor Total / uma delas no cabeçalho.
  GC_GRUPOS: [['PA', 'DI'], ['GU', 'PO'], ['IT', 'MO'], ['UR', 'RI']],
  /* Entrada por Gerência, Supervisão e Rota: só estas gerências abrem por enquanto (27/10/2026); as demais ficam na
     caixa desabilitadas ("em breve") e um acesso guardado delas volta para a entrada. Grupo de GC_GRUPOS: só com as
     duas na lista. null = todas. A Diretoria vê todas. */
  GC_LIBERADAS: ['G1', 'G2', 'G3', 'AP', 'IT', 'MO'],
  LIMITE_LISTA: 400,
  CDN: {
    html2canvas: {
      src: 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
      integrity: 'sha512-BNaRQnYJYiPSqHHDb58B0yaPfCu+Wgds8Gp/gU33kqBtgNS4tSPHuGibyoeqMV/TJlSKda6FXzoEyYGjTe+vXA=='
    },
    jspdf: {
      src: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
      integrity: 'sha512-qZvrmS2ekKPF2mSznTQsxqPgnpkI4DNTlrdUmTzrDgektczlKNRRhy5X5AAOnx5S09ydFYWWNSfcEqDTTHgtNA=='
    }
  }
});

/* Rótulo exibido de um indicador (único ponto para os nomes que o front troca): o macro de volume VOL DEST+ART+CND vira
   CONFIG.ROTULO_VOLUME_NOVOS; os demais ficam com o rótulo de quem chama (LABELS do payload, curto...) ou a chave. */
const CHAVE_VOLUME_NOVOS = 'VOL DEST+ART+CND';
function rotuloFront(k, rotulo){ return k===CHAVE_VOLUME_NOVOS ? CONFIG.ROTULO_VOLUME_NOVOS : (rotulo || k); }
