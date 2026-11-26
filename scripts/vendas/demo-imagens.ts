/**
 * Imagens da empresa de demonstração, geradas na hora (nada de foto real): as fotos do atendimento
 * (antes/depois e dos itens do checklist) e a assinatura do aceite. Tudo vira data URL, que é como o
 * sistema guarda esses arquivos (FotoAtendimento.url, OsAceite.assinatura).
 */
import sharp from "sharp";

const svg = (largura: number, altura: number, corpo: string) =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${largura}" height="${altura}" viewBox="0 0 ${largura} ${altura}">${corpo}</svg>`);

/**
 * "Foto" de um equipamento: uma evaporadora estilizada sobre uma parede, com luz lateral. `sujo` escurece
 * a grade (o antes da limpeza). Pequena de propósito: o banco guarda a imagem inteira.
 */
export async function fotoEquipamento(variante: number, sujo: boolean): Promise<string> {
  const paredes = ["#d9d4cb", "#cfd6d8", "#ddd6c8", "#d3d0c9"];
  const parede = paredes[variante % paredes.length];
  const grade = sujo ? "#8a8578" : "#e9ecee";
  const corpo = `
    <defs><linearGradient id="l" x1="0" x2="1"><stop offset="0" stop-color="#000" stop-opacity=".18"/><stop offset=".6" stop-color="#000" stop-opacity="0"/></linearGradient></defs>
    <rect width="480" height="360" fill="${parede}"/>
    <rect x="70" y="110" width="340" height="120" rx="14" fill="#f4f5f6" stroke="#c9ccd0" stroke-width="3"/>
    <rect x="90" y="190" width="300" height="26" rx="6" fill="${grade}"/>
    ${Array.from({ length: 14 }, (_, i) => `<line x1="${100 + i * 21}" y1="192" x2="${100 + i * 21}" y2="214" stroke="${sujo ? "#6f6a5f" : "#cfd3d7"}" stroke-width="3"/>`).join("")}
    <circle cx="370" cy="140" r="5" fill="${sujo ? "#9aa0a6" : "#2fb36d"}"/>
    <rect x="232" y="230" width="10" height="90" fill="#bfc3c7"/>
    <rect width="480" height="360" fill="url(#l)"/>`;
  const jpg = await sharp(svg(480, 360, corpo)).jpeg({ quality: 70 }).toBuffer();
  return `data:image/jpeg;base64,${jpg.toString("base64")}`;
}

/** Assinatura manuscrita (um traço contínuo), em PNG transparente — o formato do quadro de assinatura. */
export async function assinatura(variante: number): Promise<string> {
  const tracos = [
    "M20 70 C 40 20, 60 20, 70 60 S 100 100, 120 50 S 160 10, 175 55 C 185 80, 200 80, 215 45 C 225 25, 240 30, 245 60 L 300 58",
    "M25 60 C 35 30, 55 25, 60 55 C 64 80, 80 85, 95 45 C 105 20, 125 25, 128 60 C 131 85, 150 80, 165 40 S 205 30, 210 62 L 290 55",
    "M30 75 C 30 30, 70 20, 80 55 C 88 85, 110 70, 120 40 C 130 15, 150 35, 150 60 C 150 80, 175 80, 190 50 C 200 30, 230 40, 232 62 C 236 70, 270 64, 300 60",
  ];
  const corpo = `<path d="${tracos[variante % tracos.length]}" fill="none" stroke="#1f2a44" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>`;
  const png = await sharp(svg(320, 110, corpo)).png().toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}
