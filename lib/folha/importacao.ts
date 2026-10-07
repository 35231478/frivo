import { REGIMES, type Adicional, type Regime } from "@/lib/folha/calculo";
import { lerValor } from "@/lib/folha/validacao";
import type { Celula, Tabela } from "@/lib/folha/planilha";

/**
 * Importação de colaboradores por planilha — análise PURA (sem banco): valida cada linha, deduplica
 * por CPF (na planilha e contra o cadastro da empresa) e diz o que acontecerá. A rota grava só
 * depois que o usuário confirma, analisando o arquivo de novo (a prévia do navegador não é confiável).
 */

export const MAX_LINHAS_IMPORTACAO = 500;

/** Colunas do modelo, na ordem. `obrig` = obrigatória. */
export const COLUNAS = [
  { chave: "nome", titulo: "nome", obrig: true, ajuda: "Nome completo", exemplo: "Maria da Silva" },
  { chave: "cpf", titulo: "cpf", obrig: true, ajuda: "Com ou sem pontuação. Chave para não duplicar.", exemplo: "123.456.789-09" },
  { chave: "funcao_cargo", titulo: "funcao_cargo", obrig: false, ajuda: "Nome do cargo. Se não existir, é criado em Configurações → Cargos.", exemplo: "Técnico de refrigeração" },
  { chave: "tipo_contrato", titulo: "tipo_contrato", obrig: true, ajuda: "CLT, PJ, Diarista ou Autônomo", exemplo: "CLT" },
  { chave: "salario_base", titulo: "salario_base", obrig: false, ajuda: "Salário mensal em R$ (CLT, PJ, Autônomo). Ex.: 3200,00", exemplo: "3200,00" },
  { chave: "valor_diaria", titulo: "valor_diaria", obrig: false, ajuda: "Diarista: valor da diária em R$", exemplo: "" },
  { chave: "dias_mes", titulo: "dias_mes", obrig: false, ajuda: "Diarista: dias trabalhados no mês", exemplo: "" },
  { chave: "horas_mes", titulo: "horas_mes", obrig: false, ajuda: "Horas pagas no mês (padrão 220). Usado no custo-hora.", exemplo: "220" },
  { chave: "data_admissao", titulo: "data_admissao", obrig: false, ajuda: "dd/mm/aaaa", exemplo: "01/03/2024" },
  { chave: "adicional", titulo: "adicional", obrig: false, ajuda: "Insalubridade, Periculosidade ou vazio", exemplo: "Periculosidade" },
  { chave: "adicional_percentual", titulo: "adicional_percentual", obrig: false, ajuda: "% sobre o salário-base (ex.: 30)", exemplo: "30" },
  { chave: "adicional_valor", titulo: "adicional_valor", obrig: false, ajuda: "Ou valor fixo em R$ (tem prioridade sobre o %)", exemplo: "" },
  { chave: "horas_extras_valor", titulo: "horas_extras_valor", obrig: false, ajuda: "Estimativa mensal em R$", exemplo: "250,00" },
  { chave: "vale_transporte", titulo: "vale_transporte", obrig: false, ajuda: "Custo mensal do VT em R$", exemplo: "220,00" },
  { chave: "desconta_vt", titulo: "desconta_vt", obrig: false, ajuda: "Sim/Não — desconto de até 6% do empregado (CLT). Padrão: Sim", exemplo: "Sim" },
  { chave: "vale_alimentacao", titulo: "vale_alimentacao", obrig: false, ajuda: "VA/VR mensal em R$", exemplo: "600,00" },
  { chave: "plano_saude", titulo: "plano_saude", obrig: false, ajuda: "Custo mensal da empresa em R$", exemplo: "350,00" },
  { chave: "outros_beneficios", titulo: "outros_beneficios", obrig: false, ajuda: "R$ por mês", exemplo: "" },
  { chave: "descontos", titulo: "descontos", obrig: false, ajuda: "Outros descontos em R$ (reduzem o custo)", exemplo: "" },
  { chave: "email", titulo: "email", obrig: false, ajuda: "E-mail", exemplo: "maria@empresa.com.br" },
  { chave: "telefone", titulo: "telefone", obrig: false, ajuda: "Telefone ou celular", exemplo: "(31) 99999-0000" },
  { chave: "equipe", titulo: "equipe", obrig: false, ajuda: "Nome de uma equipe já cadastrada (Equipes)", exemplo: "Equipe Alfa" },
] as const;

export type ChaveColuna = (typeof COLUNAS)[number]["chave"];

/** Cabeçalhos aceitos além do nome exato do modelo (normalizados: minúsculas, sem acento, `_`). */
const APELIDOS: Record<string, ChaveColuna> = {
  nome_completo: "nome", colaborador: "nome", funcionario: "nome",
  funcao: "funcao_cargo", cargo: "funcao_cargo", funcao_cargo: "funcao_cargo",
  tipo_de_contrato: "tipo_contrato", contrato: "tipo_contrato", regime: "tipo_contrato", vinculo: "tipo_contrato",
  salario: "salario_base", salario_base: "salario_base", base: "salario_base",
  diaria: "valor_diaria", dias: "dias_mes", dias_no_mes: "dias_mes", horas: "horas_mes", horas_no_mes: "horas_mes",
  admissao: "data_admissao", data_de_admissao: "data_admissao",
  adicional_tipo: "adicional", adicional_percent: "adicional_percentual", adicional_pct: "adicional_percentual",
  horas_extras: "horas_extras_valor", he: "horas_extras_valor",
  vt: "vale_transporte", va: "vale_alimentacao", vr: "vale_alimentacao", va_vr: "vale_alimentacao", vale_refeicao: "vale_alimentacao",
  plano: "plano_saude", plano_de_saude: "plano_saude",
  e_mail: "email", celular: "telefone", fone: "telefone", time: "equipe",
};

export function normalizar(s: string) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}
/** Para comparar nomes (cargo/equipe): sem acento, minúsculas, espaços simples. */
export function chaveNome(s: string) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

export function mapearCabecalho(cab: Celula[]) {
  const mapa = new Map<ChaveColuna, number>();
  const ignoradas: string[] = [];
  cab.forEach((c, i) => {
    if (c == null) return;
    const n = normalizar(String(c));
    const chave = (COLUNAS.find((col) => col.chave === n)?.chave ?? APELIDOS[n]) as ChaveColuna | undefined;
    if (chave && !mapa.has(chave)) mapa.set(chave, i);
    else if (n) ignoradas.push(String(c));
  });
  return { mapa, ignoradas };
}

export function cpfDigitos(s: string) { return s.replace(/\D/g, ""); }

export function cpfValido(s: string) {
  const d = cpfDigitos(s);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const dv = (len: number) => {
    let soma = 0;
    for (let i = 0; i < len; i++) soma += Number(d[i]) * (len + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}

export function formatarCpf(s: string) {
  const d = cpfDigitos(s);
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9, 11)}`;
}

/** "dd/mm/aaaa", "aaaa-mm-dd" ou data do Excel (número de dias desde 1899-12-30) → "aaaa-mm-dd". */
export function lerData(v: Celula): string | null | undefined {
  if (v == null || v === "") return null;
  let a: number, m: number, d: number;
  if (typeof v === "number" || /^\d{5}(\.\d+)?$/.test(String(v).trim())) {
    const serial = Math.floor(Number(v));
    if (serial < 1 || serial > 2958465) return undefined;
    const dt = new Date(Date.UTC(1899, 11, 30) + serial * 864e5);
    [a, m, d] = [dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()];
  } else {
    const s = String(v).trim();
    const br = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
    const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(s);
    if (br) [d, m, a] = [Number(br[1]), Number(br[2]), Number(br[3])];
    else if (iso) [a, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
    else return undefined;
  }
  const dt = new Date(Date.UTC(a, m - 1, d));
  if (dt.getUTCFullYear() !== a || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d || a < 1950 || a > 2100) return undefined;
  return `${a}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function lerRegime(v: Celula): Regime | null | undefined {
  if (v == null) return null;
  const n = normalizar(String(v));
  if (!n) return null;
  if (n === "clt" || n.startsWith("clt") || n === "celetista") return "CLT";
  if (n === "pj" || n.startsWith("pessoa_juridica") || n === "mei") return "PJ";
  if (n.startsWith("diarist") || n === "diaria") return "DIARISTA";
  if (n.startsWith("autonom") || n === "rpa") return "AUTONOMO";
  return (REGIMES as readonly string[]).includes(n.toUpperCase()) ? (n.toUpperCase() as Regime) : undefined;
}

function lerAdicional(v: Celula): Adicional | undefined {
  if (v == null) return "NENHUM";
  const n = normalizar(String(v));
  if (!n || n === "nenhum" || n === "nao" || n === "0") return "NENHUM";
  if (n.startsWith("insalub")) return "INSALUBRIDADE";
  if (n.startsWith("pericul")) return "PERICULOSIDADE";
  return undefined;
}

function lerSimNao(v: Celula): boolean | null | undefined {
  if (v == null) return null;
  const n = normalizar(String(v));
  if (!n) return null;
  if (["sim", "s", "true", "1", "yes", "x"].includes(n)) return true;
  if (["nao", "n", "false", "0", "no"].includes(n)) return false;
  return undefined;
}

/** Dados prontos para gravar (o que veio vazio fica undefined = não mexe ao atualizar). */
export interface LinhaImportada {
  nome: string;
  cpf: string; // formatado 000.000.000-00
  cargo?: string;
  regime: Regime;
  salario?: number;
  valorDiaria?: number;
  diasMes?: number;
  horasMes?: number;
  dataAdmissao?: string;
  adicionalTipo?: Adicional;
  adicionalPercent?: number;
  adicionalValor?: number;
  horasExtrasValor?: number;
  valeTransporte?: number;
  descontaVt?: boolean;
  valeAlimentacao?: number;
  planoSaude?: number;
  outrosBeneficios?: number;
  descontos?: number;
  email?: string;
  telefone?: string;
  equipe?: string;
}

export type StatusLinha = "novo" | "atualizar" | "existente" | "erro";

export interface AnaliseLinha {
  linha: number; // número da linha na planilha (cabeçalho = 1)
  nome: string;
  cpf: string;
  status: StatusLinha;
  erros: string[];
  avisos: string[];
  existenteId?: string;
  cargoId?: string;
  equipeId?: string;
  dados?: LinhaImportada;
}

export interface ContextoImportacao {
  /** Colaboradores da EMPRESA DO USUÁRIO (ativos e inativos) */
  existentes: { id: string; cpf: string; nome: string }[];
  cargos: { id: string; nome: string }[];
  equipes: { id: string; nome: string }[];
  atualizarExistentes: boolean;
}

export interface Analise {
  linhas: AnaliseLinha[];
  colunasIgnoradas: string[];
  cargosNovos: string[];
  resumo: { total: number; novos: number; atualizar: number; existentes: number; erros: number };
}

const texto = (v: Celula) => (v == null ? "" : String(v).trim());

export function analisarPlanilha(tabela: Tabela, ctx: ContextoImportacao): Analise {
  // Cabeçalho = primeira linha não vazia
  const iCab = tabela.findIndex((l) => l.some((c) => c != null && String(c).trim() !== ""));
  if (iCab < 0) throw new Error("A planilha está vazia.");
  const { mapa, ignoradas } = mapearCabecalho(tabela[iCab]);
  const faltando = COLUNAS.filter((c) => c.obrig && !mapa.has(c.chave)).map((c) => c.titulo);
  if (faltando.length) throw new Error(`Faltam colunas obrigatórias: ${faltando.join(", ")}. Baixe o modelo e use os mesmos títulos.`);

  const corpo = tabela.slice(iCab + 1).map((l, i) => ({ l, num: iCab + 2 + i })).filter(({ l }) => l.some((c) => c != null && String(c).trim() !== ""));
  if (corpo.length === 0) throw new Error("Nenhum colaborador na planilha (só o cabeçalho).");
  if (corpo.length > MAX_LINHAS_IMPORTACAO) throw new Error(`Máximo de ${MAX_LINHAS_IMPORTACAO} linhas por importação (a planilha tem ${corpo.length}). Divida em arquivos menores.`);

  const porCpf = new Map(ctx.existentes.map((e) => [cpfDigitos(e.cpf), e]));
  const cargos = new Map(ctx.cargos.map((c) => [chaveNome(c.nome), c]));
  const equipes = new Map(ctx.equipes.map((e) => [chaveNome(e.nome), e]));
  const vistos = new Map<string, number>();
  const cargosNovos = new Map<string, string>();

  const linhas = corpo.map(({ l, num }): AnaliseLinha => {
    const cel = (k: ChaveColuna) => { const i = mapa.get(k); return i == null ? null : l[i] ?? null; };
    const erros: string[] = [];
    const avisos: string[] = [];

    const nome = texto(cel("nome")).replace(/\s+/g, " ");
    if (!nome) erros.push("Nome vazio");
    else if (nome.length > 150) erros.push("Nome muito longo");

    const cpfBruto = texto(cel("cpf"));
    // CPF lido como número no Excel perde o zero à esquerda: completa até 11 dígitos
    const cpfNum = typeof cel("cpf") === "number" ? String(cel("cpf")).padStart(11, "0") : cpfBruto;
    let cpf = "";
    if (!cpfBruto) erros.push("CPF vazio");
    else if (!cpfValido(cpfNum)) erros.push(`CPF inválido (${cpfBruto})`);
    else cpf = formatarCpf(cpfNum);

    const regime = lerRegime(cel("tipo_contrato"));
    if (regime === null) erros.push("Tipo de contrato vazio (CLT, PJ, Diarista ou Autônomo)");
    else if (regime === undefined) erros.push(`Tipo de contrato inválido: “${texto(cel("tipo_contrato"))}” (use CLT, PJ, Diarista ou Autônomo)`);

    const dados: Partial<LinhaImportada> = {};
    const numero = (k: ChaveColuna, campo: keyof LinhaImportada, rotulo: string, max: number, inteiro = false) => {
      const v = cel(k);
      if (v == null || texto(v) === "") return;
      const x = lerValor(v);
      if (x == null) return;
      if (Number.isNaN(x) || x < 0 || x > max) { erros.push(`${rotulo} inválido: “${texto(v)}”`); return; }
      (dados as any)[campo] = inteiro ? Math.round(x) : Math.round(x * 100) / 100;
    };
    numero("salario_base", "salario", "Salário/base", 1_000_000);
    numero("valor_diaria", "valorDiaria", "Valor da diária", 100_000);
    numero("dias_mes", "diasMes", "Dias no mês", 31, true);
    numero("horas_mes", "horasMes", "Horas no mês", 744, true);
    numero("adicional_percentual", "adicionalPercent", "Percentual do adicional", 100);
    numero("adicional_valor", "adicionalValor", "Valor do adicional", 1_000_000);
    numero("horas_extras_valor", "horasExtrasValor", "Horas extras", 1_000_000);
    numero("vale_transporte", "valeTransporte", "Vale-transporte", 100_000);
    numero("vale_alimentacao", "valeAlimentacao", "VA/VR", 100_000);
    numero("plano_saude", "planoSaude", "Plano de saúde", 100_000);
    numero("outros_beneficios", "outrosBeneficios", "Outros benefícios", 100_000);
    numero("descontos", "descontos", "Descontos", 1_000_000);
    if (dados.horasMes === 0) { erros.push("Horas no mês deve ser maior que zero"); delete dados.horasMes; }

    const adic = cel("adicional");
    const adicional = lerAdicional(adic);
    if (adicional === undefined) erros.push(`Adicional inválido: “${texto(adic)}” (Insalubridade, Periculosidade ou vazio)`);
    else if (adic != null) dados.adicionalTipo = adicional;
    if ((dados.adicionalPercent || dados.adicionalValor) && (!adicional || adicional === "NENHUM"))
      avisos.push("Percentual/valor de adicional informado sem o tipo (Insalubridade/Periculosidade): será ignorado");

    const vt = lerSimNao(cel("desconta_vt"));
    if (vt === undefined) erros.push(`desconta_vt inválido: “${texto(cel("desconta_vt"))}” (Sim ou Não)`);
    else if (vt !== null) dados.descontaVt = vt;

    const adm = lerData(cel("data_admissao"));
    if (adm === undefined) erros.push(`Data de admissão inválida: “${texto(cel("data_admissao"))}” (use dd/mm/aaaa)`);
    else if (adm) dados.dataAdmissao = adm;

    const email = texto(cel("email"));
    if (email) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 150) erros.push(`E-mail inválido: “${email}”`);
      else dados.email = email.toLowerCase();
    }
    const tel = texto(cel("telefone"));
    if (tel) {
      if (tel.replace(/\D/g, "").length < 8) erros.push(`Telefone inválido: “${tel}”`);
      else dados.telefone = tel.slice(0, 30);
    }

    if (regime === "DIARISTA" && dados.salario == null && dados.valorDiaria == null) avisos.push("Diarista sem diária nem salário: custo ficará zerado");
    else if (regime && regime !== "DIARISTA" && dados.salario == null) avisos.push("Sem salário/base: custo ficará zerado até preencher");
    if (regime === "DIARISTA" && dados.valorDiaria != null && !dados.diasMes) avisos.push("Diarista sem dias no mês: custo ficará zerado");

    // Cargo: existente na empresa ou criado na confirmação
    let cargoId: string | undefined;
    const cargo = texto(cel("funcao_cargo")).replace(/\s+/g, " ").slice(0, 80);
    if (cargo) {
      dados.cargo = cargo;
      const c = cargos.get(chaveNome(cargo));
      if (c) cargoId = c.id;
      else if (!cargosNovos.has(chaveNome(cargo))) cargosNovos.set(chaveNome(cargo), cargo);
    }
    // Equipe: só as que já existem na empresa (não cria equipe pela planilha)
    let equipeId: string | undefined;
    const equipe = texto(cel("equipe"));
    if (equipe) {
      const e = equipes.get(chaveNome(equipe));
      if (e) { equipeId = e.id; dados.equipe = e.nome; } else avisos.push(`Equipe “${equipe}” não encontrada: o colaborador entra sem equipe`);
    }

    // Duplicidade: na própria planilha e no cadastro da empresa
    let status: StatusLinha = "novo";
    let existenteId: string | undefined;
    if (cpf) {
      const d = cpfDigitos(cpf);
      const anterior = vistos.get(d);
      if (anterior) erros.push(`CPF repetido na planilha (já aparece na linha ${anterior})`);
      else vistos.set(d, num);
      const ex = porCpf.get(d);
      if (ex) { existenteId = ex.id; status = ctx.atualizarExistentes ? "atualizar" : "existente"; }
    }
    if (erros.length) status = "erro";

    return {
      linha: num, nome, cpf: cpf || cpfBruto, status, erros, avisos, existenteId, cargoId, equipeId,
      dados: status === "erro" ? undefined : ({ ...dados, nome, cpf, regime } as LinhaImportada),
    };
  });

  const conta = (s: StatusLinha) => linhas.filter((l) => l.status === s).length;
  return {
    linhas,
    colunasIgnoradas: ignoradas,
    // Só os cargos que serão realmente usados (linhas válidas que vão gravar)
    cargosNovos: [...cargosNovos.entries()]
      .filter(([k]) => linhas.some((l) => (l.status === "novo" || l.status === "atualizar") && l.dados?.cargo && chaveNome(l.dados.cargo) === k))
      .map(([, v]) => v),
    resumo: { total: linhas.length, novos: conta("novo"), atualizar: conta("atualizar"), existentes: conta("existente"), erros: conta("erro") },
  };
}

/** Linhas do modelo para download (aba principal + aba de instruções). */
export function linhasModelo() {
  return {
    cabecalho: COLUNAS.map((c) => c.titulo),
    instrucoes: [
      ["coluna", "obrigatória", "o que preencher", "exemplo"],
      ...COLUNAS.map((c) => [c.titulo, c.obrig ? "sim" : "não", c.ajuda, c.exemplo]),
      [],
      ["Dicas"],
      ["• Uma linha por colaborador. A primeira linha da aba “Colaboradores” é o cabeçalho: não mude os títulos."],
      ["• O CPF é a chave: se ele já estiver cadastrado, a linha é ignorada — ou atualizada, se você marcar “atualizar existentes”."],
      ["• Valores em reais aceitam 3200,00 ou 3.200,00. Datas: dd/mm/aaaa."],
      ["• Nada é gravado antes de você conferir a prévia e confirmar."],
      ["• Ferramenta de gestão: não substitui a folha oficial nem o contador."],
    ],
  };
}

/** Função (tipo) do colaborador novo, deduzida do cargo da planilha. Dá para ajustar depois no cadastro. */
export function funcaoPeloCargo(cargo?: string): "TECNICO_CAMPO" | "RESPONSAVEL_TECNICO" | "ADMINISTRATIVO" | "MOTORISTA" | "OUTRO" {
  const c = chaveNome(cargo ?? "");
  if (!c) return "OUTRO";
  if (/respons[a-z]* tecnic|engenheir/.test(c)) return "RESPONSAVEL_TECNICO";
  if (/tecnic|mecanic|refrigera|climatiza|instalador|ajudante|auxiliar tecnic|eletricist/.test(c)) return "TECNICO_CAMPO";
  if (/motorista/.test(c)) return "MOTORISTA";
  if (/administr|financ|\brh\b|recursos humanos|comercial|vend|escrit|recep|gerente|diretor|assistente|analista|compras|contab|secret/.test(c)) return "ADMINISTRATIVO";
  return "OUTRO";
}
