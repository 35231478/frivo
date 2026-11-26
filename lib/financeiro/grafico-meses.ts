/**
 * O gráfico "Entradas × Saídas" do Dashboard financeiro — as regras puras (escala, rótulos, série).
 *
 * O gráfico de antes tinha dois eixos sem dizer: as barras numa escala e a linha do "saldo acumulado"
 * noutra, centrada no meio da área (o "zero" da linha não era o zero das barras). Não tinha eixo nem
 * valores, o mês vinha sem ano e o valor só aparecia ao parar o mouse (no celular, nunca). Aqui:
 *  - UM eixo, começando no zero, com marcas "redondas" (R$ 0, 20 mil, 40 mil…);
 *  - o resultado de cada mês (entradas − saídas) escrito embaixo, e o do período no cabeçalho;
 *  - o mês com o ano quando o ano muda (jan/2026), e o nome completo no detalhe.
 */

export interface MesFinanceiro {
  /** "jun" (o rótulo curto que o servidor já mandava) */
  mes: string;
  /** "2026-06": o mês de referência, para o ano e o nome completo */
  ref?: string;
  entradas: number;
  saidas: number;
}

export interface BarraMes {
  ref: string;
  rotulo: string;
  nomeCompleto: string;
  entradas: number;
  saidas: number;
  resultado: number;
  /** Altura de cada barra em % da área do gráfico (0–100) */
  altEntradas: number;
  altSaidas: number;
}

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const centavos = (n: number) => Math.round(n * 100) / 100;

/**
 * As marcas do eixo: o menor topo "redondo" (1, 2, 2,5 ou 5 × 10ⁿ por passo) que cabe o maior valor, em
 * até `divisoes` faixas. Sem dado (tudo zero), um eixo de R$ 0 a R$ 1.000 — o gráfico não some.
 */
export function escalaEixo(maximo: number, divisoes = 4): { topo: number; marcas: number[] } {
  const max = Math.max(0, maximo);
  if (max === 0) return { topo: 1000, marcas: [0, 250, 500, 750, 1000] };
  const bruto = max / divisoes;
  const pot = 10 ** Math.floor(Math.log10(bruto));
  const passo = [1, 2, 2.5, 5, 10].map((f) => f * pot).find((p) => p * divisoes >= max)!;
  const n = Math.ceil(max / passo);
  return { topo: passo * n, marcas: Array.from({ length: n + 1 }, (_, i) => centavos(passo * i)) };
}

/**
 * Valor curto para eixo e rótulo: "R$ 0", "R$ 850", "R$ 1,5 mil", "R$ 60 mil", "R$ 1,2 mi" (com sinal "−").
 * Sem o prefixo (`{ prefixo: false }`): "17 mil" — o rótulo do mês no celular, onde "R$" não cabe.
 */
export function moedaCurta(v: number, { prefixo = true }: { prefixo?: boolean } = {}): string {
  const r = moedaCurtaComPrefixo(v);
  return prefixo ? r : r.replace("R$ ", "");
}

function moedaCurtaComPrefixo(v: number): string {
  const sinal = v < 0 ? "−" : "";
  const a = Math.abs(v);
  const num = (x: number) => x.toLocaleString("pt-BR", { maximumFractionDigits: x < 10 ? 1 : 0 });
  if (a >= 1_000_000) return `${sinal}R$ ${num(a / 1_000_000)} mi`;
  if (a >= 1_000) return `${sinal}R$ ${num(a / 1_000)} mil`;
  return `${sinal}R$ ${Math.round(a).toLocaleString("pt-BR")}`;
}

/** O que o leitor de tela diz ao chegar num mês (os mesmos números do detalhe). */
export function rotuloAcessivelMes(b: Pick<BarraMes, "nomeCompleto" | "entradas" | "saidas" | "resultado">, moeda: (v: number) => string): string {
  return `${b.nomeCompleto}: entradas ${moeda(b.entradas)}, saídas ${moeda(b.saidas)}, resultado ${moeda(b.resultado)}`;
}

/** A série pronta para desenhar, na ordem recebida (do mais antigo ao atual). */
export function montarSerie(meses: MesFinanceiro[]): { barras: BarraMes[]; topo: number; marcas: number[]; resultadoPeriodo: number } {
  const { topo, marcas } = escalaEixo(Math.max(0, ...meses.flatMap((m) => [m.entradas, m.saidas])));
  let anoAnterior: string | null = null;
  const barras = meses.map((m, i) => {
    const [ano, mm] = (m.ref ?? "").split("-");
    const idx = Number(mm) - 1;
    // O ano aparece no primeiro mês e quando vira (jan): "dez" "jan/2026"
    const mostraAno = !!ano && (i === 0 || ano !== anoAnterior);
    anoAnterior = ano || anoAnterior;
    const curto = m.mes.replace(".", "").toLowerCase();
    return {
      ref: m.ref ?? m.mes,
      rotulo: mostraAno ? `${curto}/${ano.slice(2)}` : curto,
      // "Agosto de 2026" (a maiúscula só na primeira letra: o "de" fica minúsculo)
      nomeCompleto: idx >= 0 && idx < 12 ? `${MESES[idx][0].toUpperCase()}${MESES[idx].slice(1)} de ${ano}` : curto,
      entradas: m.entradas, saidas: m.saidas, resultado: centavos(m.entradas - m.saidas),
      altEntradas: Math.max(0, Math.min(100, (m.entradas / topo) * 100)),
      altSaidas: Math.max(0, Math.min(100, (m.saidas / topo) * 100)),
    };
  });
  return { barras, topo, marcas, resultadoPeriodo: centavos(barras.reduce((s, b) => s + b.resultado, 0)) };
}
