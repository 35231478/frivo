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

/* ───────── Rota: Google Maps ou Waze (o técnico escolhe o app do celular) ───────── */

export type AppRota = "google" | "waze";
export const APPS_ROTA: { id: AppRota; nome: string }[] = [{ id: "google", nome: "Google Maps" }, { id: "waze", nome: "Waze" }];

/**
 * Link do WAZE para o mesmo destino da rota do Google (o cartão guarda só a do Google — assim vale
 * também para o que já está no aparelho). Coordenadas, quando há; senão o endereço escrito.
 */
export function linkWaze(rotaGoogle: string | null | undefined): string | null {
  if (!rotaGoogle) return null;
  let destino: string | null = null;
  try { destino = new URL(rotaGoogle).searchParams.get("destination"); } catch { return null; }
  if (!destino) return null;
  const coord = /^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(destino);
  return `https://waze.com/ul?${coord ? "ll" : "q"}=${encodeURIComponent(destino)}&navigate=yes`;
}

/** O link da rota no app escolhido (sem Waze possível, cai no Google). */
export const linkDoApp = (rotaGoogle: string, app: AppRota): string => (app === "waze" ? linkWaze(rotaGoogle) ?? rotaGoogle : rotaGoogle);

/* ───────── Privacidade (Equipes › App do colaborador) ───────── */

interface DadosDoCliente { cliente: string; telefone: string | null; unidade: string | null; endereco: string; rota: string | null; descricao: string }
type Privacidade = { exibirDadosCliente: boolean; exibirContatosCliente: boolean };

/** O rodapé que o chamado aberto pelo QR Code grava na descrição: "[Chamado via QR Code] Solicitante: … · E-mail: … · Telefone: …" */
const RODAPE_QR = /\s*\[(?:Chamado|Orçamento) via QR Code\]([\s\S]*)$/;

/**
 * A descrição do serviço como o app pode ler. O texto do pedido fica SEMPRE (o técnico precisa saber
 * o que fazer); o que sai é a identidade de quem pediu, que o chamado do QR Code grava no rodapé:
 *  - "Exibir dados do cliente" desligado: sai o rodapé inteiro (nome, e-mail, telefone);
 *  - só "Exibir contatos" desligado: fica o nome do solicitante, saem e-mail e telefone.
 * Texto livre digitado no meio da descrição não dá para separar: segue como foi escrito.
 */
export function descricaoParaApp(descricao: string | null | undefined, config: Privacidade): string {
  const texto = (descricao ?? "").trim();
  const m = texto.match(RODAPE_QR);
  if (!m || (config.exibirDadosCliente && config.exibirContatosCliente)) return texto;
  const corpo = texto.slice(0, m.index).trimEnd();
  if (!config.exibirDadosCliente) return corpo;
  const nome = m[1].split(" · ").map((p) => p.trim()).filter((p) => /^Solicitante:/i.test(p));
  return nome.length ? `${corpo}\n\n${nome.join(" · ")}` : corpo;
}

/**
 * O cartão como o app pode ver, pelas permissões da empresa: "Exibir dados do cliente" desligado tira
 * nome, unidade, endereço e rota — e, da descrição, a identidade de quem pediu (o texto do serviço
 * fica); "Exibir contatos" desligado tira o telefone. Aplicado NO SERVIDOR (o dado nem chega ao
 * aparelho); a tela confere de novo para o que já estava guardado.
 */
export function aplicarPrivacidade<T extends DadosDoCliente>(c: T, config: Privacidade): T {
  return {
    ...c,
    descricao: descricaoParaApp(c.descricao, config),
    ...(!config.exibirDadosCliente && { cliente: "", unidade: null, endereco: "", rota: null }),
    ...(!config.exibirContatosCliente && { telefone: null }),
  };
}
