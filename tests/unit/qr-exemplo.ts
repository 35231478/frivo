/**
 * QR Codes DE VERDADE para os testes do leitor: gerados com a mesma biblioteca que o sistema usa para
 * imprimir as etiquetas (`qrcode`) e desenhados como pixels RGBA — o que um canvas entregaria.
 */
import QRCode from "qrcode";

export interface ImagemQr { dados: Uint8ClampedArray; largura: number; altura: number }

/**
 * Desenha o QR de `texto` numa imagem `largura`×`altura` (fundo branco), centralizado, ocupando
 * `ocupacao` do menor lado. `invertido` = claro sobre escuro.
 */
export function imagemQr(texto: string, largura = 480, altura = largura, op: { ocupacao?: number; invertido?: boolean } = {}): ImagemQr {
  const qr = QRCode.create(texto, { errorCorrectionLevel: "M" });
  const n = qr.modules.size;
  const total = n + 8; // 4 módulos de margem de cada lado (zona de silêncio)
  const escala = Math.max(1, Math.floor((Math.min(largura, altura) * (op.ocupacao ?? 0.9)) / total));
  const x0 = Math.floor((largura - total * escala) / 2);
  const y0 = Math.floor((altura - total * escala) / 2);
  const [claro, escuro] = op.invertido ? [20, 240] : [255, 0];
  const dados = new Uint8ClampedArray(largura * altura * 4);
  for (let y = 0; y < altura; y++) {
    for (let x = 0; x < largura; x++) {
      const mx = Math.floor((x - x0) / escala) - 4;
      const my = Math.floor((y - y0) / escala) - 4;
      const dentro = mx >= 0 && my >= 0 && mx < n && my < n;
      const v = dentro && qr.modules.data[my * n + mx] ? escuro : claro;
      const i = (y * largura + x) * 4;
      dados[i] = v; dados[i + 1] = v; dados[i + 2] = v; dados[i + 3] = 255;
    }
  }
  return { dados, largura, altura };
}

/** Uma imagem sem QR nenhum (cinza liso) */
export function imagemLisa(largura = 480, altura = largura): ImagemQr {
  return { dados: new Uint8ClampedArray(largura * altura * 4).fill(128), largura, altura };
}
