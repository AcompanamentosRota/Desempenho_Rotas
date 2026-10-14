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
  // Supervisões que não entram na comparação "quem mais puxa a média para baixo"
  // (além destas, qualquer uma cujo nome seja "ROTA SEM VENDEDOR").
  SV_EXCLUIDOS: ['SV.G2.5', 'SV.G3.3', 'SV.IT.3', 'SV.MO.3'],
  CREDITOS: 'Desenvolvido por Karen Oliveira · Analista de Inteligência de Vendas – Matriz G2',
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
