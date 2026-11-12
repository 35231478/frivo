/**
 * Busca nas listas de códigos (LC 116, códigos municipais já usados): regra pura usada pela caixa
 * de busca-e-seleção (components/ui/combobox-codigo.tsx). Acha pelo código, com ou sem ponto
 * ("1401" ou "14.01" acham 14.01; "14" acha o grupo 14), ou por palavras da descrição, sem
 * diferença de acento e maiúsculas. Código que começa com o digitado vem antes.
 */
export interface OpcaoCodigo {
  codigo: string;
  descricao: string;
  /** Título do bloco na lista (ex.: "Usados nos seus serviços", "Lista da LC 116") */
  grupo?: string;
}

export const MAX_OPCOES_BUSCA = 50;

const semAcento = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const digitos = (t: string) => t.replace(/\D/g, "");

export function filtrarCodigos(opcoes: readonly OpcaoCodigo[], busca: string, max = MAX_OPCOES_BUSCA): OpcaoCodigo[] {
  const q = semAcento(busca.trim());
  if (!q) return opcoes.slice(0, max);
  const qDig = digitos(q);
  // Só números/pontos/traços = busca por código; senão, cada palavra precisa estar no código ou na descrição
  const porCodigo = qDig.length > 0 && /^[\d\s./-]+$/.test(q);
  const palavras = q.split(/\s+/);
  // Ranqueia dentro de cada bloco (grupo), mantendo a ordem dos blocos: o título não se repete
  const blocos = new Map<string | undefined, { prefixo: OpcaoCodigo[]; resto: OpcaoCodigo[] }>();
  for (const o of opcoes) {
    if (!blocos.has(o.grupo)) blocos.set(o.grupo, { prefixo: [], resto: [] });
    const { prefixo, resto } = blocos.get(o.grupo)!;
    const cod = semAcento(o.codigo);
    if (porCodigo) {
      const d = digitos(o.codigo);
      if (d.startsWith(qDig)) prefixo.push(o);
      else if (d.includes(qDig)) resto.push(o);
      continue;
    }
    const texto = `${cod} ${semAcento(o.descricao)}`;
    if (palavras.every((p) => texto.includes(p))) (cod.startsWith(q) ? prefixo : resto).push(o);
  }
  return [...blocos.values()].flatMap((b) => [...b.prefixo, ...b.resto]).slice(0, max);
}

export const GRUPO_USADOS = "Usados nos seus serviços";
export const GRUPO_LC116 = "Lista da LC 116 (apoio)";

/**
 * Opções do código de tributação MUNICIPAL. Não há lista pública por município (o PlugNotas não
 * expõe uma; cada prefeitura tem a sua), então: primeiro os códigos que a empresa já usa nos
 * serviços (com os nomes deles), depois a LC 116 de apoio. O digitado sempre vale.
 */
export function opcoesCodigoMunicipal(
  servicos: readonly { codigoMunicipal: string | null; nome: string }[], lc116: readonly { codigo: string; descricao: string }[],
): OpcaoCodigo[] {
  const usados = new Map<string, string[]>();
  for (const s of servicos) {
    const c = s.codigoMunicipal?.trim();
    if (c) usados.set(c, [...(usados.get(c) ?? []), s.nome]);
  }
  const deUso = [...usados].sort(([a], [b]) => a.localeCompare(b, "pt-BR", { numeric: true }))
    .map(([codigo, nomes]) => ({ codigo, descricao: `Em uso: ${nomes.slice(0, 3).join(", ")}${nomes.length > 3 ? ` e mais ${nomes.length - 3}` : ""}`, grupo: GRUPO_USADOS }));
  return [...deUso, ...lc116.map((i) => ({ ...i, grupo: GRUPO_LC116 }))];
}
