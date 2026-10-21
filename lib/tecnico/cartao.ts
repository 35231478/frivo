/**
 * "Meu dia" do técnico — regras puras do CARTÃO da atividade: endereço numa linha, link que abre a
 * ROTA no mapa (do lugar onde ele está até o cliente) e a ordem do dia (horário; sem horário vai
 * para o fim; empate pelo número da OS). Usado pelo servidor e testado à parte.
 */
import { horaBR } from "@/lib/fuso";

export interface EnderecoLocal {
  logradouro?: string | null; numero?: string | null; complemento?: string | null; bairro?: string | null;
  cidade?: string | null; estado?: string | null; cep?: string | null; latitude?: number | null; longitude?: number | null;
}

const limpo = (v: string | null | undefined) => (v ?? "").trim();

/** "Rua X, 123 (sala 2) — Bairro, Cidade/UF". Vazio = sem endereço. */
export function enderecoEmLinha(e: EnderecoLocal | null | undefined): string {
  if (!e) return "";
  const rua = [limpo(e.logradouro), limpo(e.numero)].filter(Boolean).join(", ");
  const comp = limpo(e.complemento);
  const cidade = [limpo(e.cidade), limpo(e.estado)].filter(Boolean).join("/");
  const resto = [limpo(e.bairro), cidade].filter(Boolean).join(", ");
  return [rua + (rua && comp ? ` (${comp})` : ""), resto].filter(Boolean).join(" — ");
}

/**
 * Link de ROTA no mapa (Google Maps abre o app no celular e traça do ponto atual até o destino).
 * Coordenadas, quando há; senão o endereço escrito. Sem nada = sem link.
 */
export function linkRota(e: EnderecoLocal | null | undefined): string | null {
  if (!e) return null;
  const temCoord = typeof e.latitude === "number" && typeof e.longitude === "number" && Number.isFinite(e.latitude) && Number.isFinite(e.longitude)
    && !(e.latitude === 0 && e.longitude === 0);
  const destino = temCoord ? `${e.latitude},${e.longitude}` : [enderecoEmLinha(e), limpo(e.cep)].filter(Boolean).join(" ");
  if (!destino) return null;
  return `https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=${encodeURIComponent(destino)}`;
}

/** Hora marcada ("08:30") ou null quando a atividade só tem o dia (meia-noite = sem horário). */
export function horaMarcada(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  const h = horaBR(new Date(d));
  return h === "00:00" ? null : h;
}

/** Ordem do dia: pelo horário (sem horário no fim); empate pelo número da OS. */
export function ordenarDoDia<T extends { dataAgendada: Date | string | null; hora: string | null; osNumero: string }>(lista: T[]): T[] {
  const chave = (x: T) => (x.hora ? new Date(x.dataAgendada!).getTime() : Number.MAX_SAFE_INTEGER);
  return [...lista].sort((a, b) => chave(a) - chave(b) || a.osNumero.localeCompare(b.osNumero, "pt-BR", { numeric: true }));
}
