/**
 * "Foto somente pela câmera" (Equipes › App do colaborador): além do `capture` no campo (que no celular
 * abre a câmera direto, sem galeria), o app confere que o arquivo ACABOU de ser criado. Foto de câmera
 * nasce agora; arquivo escolhido da galeria ou de uma pasta traz a data de quando foi tirado/salvo.
 * É uma segunda barreira (pega o navegador que ignora o `capture`), não um laudo: há aparelho que
 * regrava a data ao escolher da galeria — nesses, vale o `capture`.
 */
export const TOLERANCIA_CAMERA_MS = 5 * 60 * 1000;

export function fotoTiradaAgora(arquivo: { lastModified?: number }, agora = Date.now(), toleranciaMs = TOLERANCIA_CAMERA_MS): boolean {
  const quando = Number(arquivo.lastModified);
  // Sem data (navegador não informa): não dá para dizer que é antiga — passa, o `capture` já restringiu
  if (!Number.isFinite(quando) || quando <= 0) return true;
  return agora - quando <= toleranciaMs;
}

export const MSG_SO_CAMERA = "A empresa só aceita foto tirada na hora, pela câmera. Fotos da galeria ficam bloqueadas.";
