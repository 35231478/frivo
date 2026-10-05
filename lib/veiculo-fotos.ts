/**
 * Fotos do veículo por ângulo. `fotos` e `fotosRotulos` andam juntos (mesma ordem);
 * a capa (lista, cadastro) é sempre fotos[0] — a FRENTE quando existir.
 * Arquivo puro: usado na tela e no servidor.
 */
export const ANGULOS_VEICULO = ["FRENTE", "TRASEIRA", "LATERAL_ESQUERDA", "LATERAL_DIREITA"] as const;
export type AnguloVeiculo = (typeof ANGULOS_VEICULO)[number];
export type RotuloFotoVeiculo = AnguloVeiculo | "OUTRO";

export const ROTULOS_FOTO_VEICULO: Record<RotuloFotoVeiculo, string> = {
  FRENTE: "Frente",
  TRASEIRA: "Traseira",
  LATERAL_ESQUERDA: "Lateral esquerda",
  LATERAL_DIREITA: "Lateral direita",
  OUTRO: "Outros",
};

export const MAX_OUTRAS_FOTOS = 4;
export const MAX_FOTOS_VEICULO = ANGULOS_VEICULO.length + MAX_OUTRAS_FOTOS;

const ORDEM: Record<RotuloFotoVeiculo, number> = { FRENTE: 0, TRASEIRA: 1, LATERAL_ESQUERDA: 2, LATERAL_DIREITA: 3, OUTRO: 4 };

/**
 * Junta fotos e rótulos e devolve na ordem certa: Frente, Traseira, Lateral esq., Lateral dir., Outros.
 * Rótulo ausente/desconhecido (veículos antigos) ou ângulo repetido vira "OUTRO", mantendo a ordem original.
 */
export function organizarFotosVeiculo(fotos: string[], rotulos: (string | null | undefined)[] = []): { fotos: string[]; fotosRotulos: RotuloFotoVeiculo[] } {
  const usados = new Set<string>();
  const pares = fotos
    .map((foto, i) => {
      let r = (rotulos[i] ?? "OUTRO") as RotuloFotoVeiculo;
      if (!(r in ORDEM) || (r !== "OUTRO" && usados.has(r))) r = "OUTRO";
      usados.add(r);
      return { foto, r, i };
    })
    .filter((p) => !!p.foto)
    .sort((a, b) => ORDEM[a.r] - ORDEM[b.r] || a.i - b.i);
  return { fotos: pares.map((p) => p.foto), fotosRotulos: pares.map((p) => p.r) };
}
