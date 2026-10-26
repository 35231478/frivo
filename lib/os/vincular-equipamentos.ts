import { comparaNatural } from "@/lib/utils";

/** Equipamento como chega de `/api/equipamentos?resumo=1` (o que a gaveta da Nova OS precisa). */
export interface EquipamentoResumo {
  id: string;
  nome?: string | null;
  marca: string;
  modelo: string;
  capacidade?: string | null;
  potencia?: string | null;
  patrimonio?: string | null; // a TAG
  setor?: string | null;
  localizacao?: string | null;
  ativo?: boolean;
  unidadeId?: string;
  unidade?: { id: string; nome: string } | null;
  tipoEquipamento?: { id: string; nome: string } | null;
}

export const rotuloEquipamento = (e: EquipamentoResumo) => `${e.nome ? `${e.nome} — ` : ""}${e.marca} ${e.modelo}`.trim();

/** Linha de apoio: tipo · capacidade/potência · ambiente · TAG · local. */
export function detalheEquipamento(e: EquipamentoResumo, comLocal: boolean): string {
  return [
    e.tipoEquipamento?.nome,
    e.capacidade, e.potencia,
    [e.setor, e.localizacao].filter(Boolean).join(" / ") || null,
    e.patrimonio && `TAG ${e.patrimonio}`,
    comLocal && e.unidade?.nome,
  ].filter(Boolean).join(" · ");
}

const normalizar = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
/** Números escritos no texto, sem separador de milhar ("12.000 BTU/h" → ["12000"]). */
const numeros = (t: string) => (t.match(/\d+(?:[.,]\d+)*/g) ?? []).map((n) => n.replace(/[.,]/g, ""));

/**
 * Busca por nome, marca, modelo, potência/capacidade (BTU/TR), TAG, ambiente e local — sem acento e
 * sem caixa. Número digitado também acha a capacidade escrita com ponto ("12000" acha "12.000 BTU/h").
 */
export function combinaBusca(e: EquipamentoResumo, busca: string): boolean {
  const termo = normalizar(busca.trim());
  if (!termo) return true;
  const campos = [e.nome, e.marca, e.modelo, e.capacidade, e.potencia, e.patrimonio, e.setor, e.localizacao, e.unidade?.nome, e.tipoEquipamento?.nome]
    .filter(Boolean).map((v) => normalizar(String(v)));
  const texto = campos.join(" ");
  // Todas as palavras precisam aparecer (ex.: "daikin 12000")
  return termo.split(/\s+/).every((p) => {
    if (texto.includes(p)) return true;
    // Número inteiro digitado sem o ponto: precisa ser o mesmo número da capacidade/potência
    const d = p.replace(/[.,]/g, "");
    return /^\d{3,}$/.test(d) && [e.capacidade, e.potencia].some((v) => numeros(v ?? "").includes(d));
  });
}

const localDe = (e: EquipamentoResumo) => e.unidade?.id ?? e.unidadeId ?? "";

/** Filtra por local ("" = todos) e busca; ordena por local e nome (ordem natural). */
export function filtrarEquipamentos(lista: EquipamentoResumo[], filtro: { unidadeId?: string; busca?: string }): EquipamentoResumo[] {
  return lista
    .filter((e) => e.ativo !== false)
    .filter((e) => !filtro.unidadeId || localDe(e) === filtro.unidadeId)
    .filter((e) => combinaBusca(e, filtro.busca ?? ""))
    .sort((a, b) => comparaNatural(a.unidade?.nome, b.unidade?.nome) || comparaNatural(rotuloEquipamento(a), rotuloEquipamento(b)));
}

/** Locais (unidades) que têm equipamento, com a contagem — para o filtro da gaveta. */
export function locaisComEquipamento(lista: EquipamentoResumo[]): { id: string; nome: string; qtd: number }[] {
  const mapa = new Map<string, { id: string; nome: string; qtd: number }>();
  for (const e of lista) {
    if (e.ativo === false) continue;
    const id = localDe(e);
    if (!id) continue;
    const atual = mapa.get(id) ?? { id, nome: e.unidade?.nome ?? "Local", qtd: 0 };
    atual.qtd += 1;
    mapa.set(id, atual);
  }
  return [...mapa.values()].sort((a, b) => comparaNatural(a.nome, b.nome));
}

/** "Selecionar todos" sobre o que está visível: marca todos, ou desmarca se já estavam todos marcados. */
export function alternarTodos(marcados: Set<string>, visiveis: string[]): Set<string> {
  const n = new Set(marcados);
  const todos = visiveis.length > 0 && visiveis.every((id) => n.has(id));
  for (const id of visiveis) { if (todos) n.delete(id); else n.add(id); }
  return n;
}
