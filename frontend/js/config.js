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
  JANELA_VENDAS: { inicio: '07:30', fim: '17:29' },   // horário de Brasília
  // Neutraliza, virtuais e ocultas vêm do payload (NEUTRALIZA_ROTAS/VIRTUAIS_ROTAS/OCULTAS, listas únicas no
  // back-end). Esta lista só vale para um payload antigo, sem essas chaves: fora do "puxa a média" (além de
  // "ROTA SEM VENDEDOR") e das listas de clientes.
  SV_EXCLUIDOS: ['SV.G1.5', 'SV.G2.5', 'SV.G3.3', 'SV.IT.3', 'SV.MO.3'],
  // Placa ATENÇÃO do Resumo: % mínimo de indicadores no ritmo; null = desligada (não aparece)
  LIMIAR_ATENCAO: null,
  // Resumo da Diretoria: gerências por faixa (acima disso, quebra em faixas)
  RS_COLUNAS_FAIXA: 8,
  CREDITOS: 'Karen Oliveira - Inteligência de Mercado',
  /* Controle de acesso interno: organiza o que cada perfil vê; NÃO é segurança — os dados estão em
     frontend/data/*.json. A Gerência entra pela sigla ou pelo nome da filial. O acesso fica guardado no aparelho
     até a virada do dia (05:00, horário de Brasília) ou até clicar na casa. */
  USUARIO_DIRETORIA: 'DICOM',         // perfil Diretoria (sem senha; maiúsculas/minúsculas e espaços ignorados)
  SESSAO_VIRADA_HORA: 5,              // o "dia de trabalho" do acesso guardado vira às 05:00 de Brasília
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
