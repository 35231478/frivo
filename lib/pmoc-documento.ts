/**
 * PMOC — Etapa 3: o DOCUMENTO do plano como DADO (regras puras: sem banco e sem PDF).
 *
 * `montarDocumento` recebe o que foi lido do cadastro e devolve o que o documento diz, seção por
 * seção: identificação, responsável técnico e ART, texto técnico, equipamentos cobertos, cronograma,
 * planejamento das atividades e ocorrências. Quem desenha o PDF (lib/pmoc-documento-pdf) só coloca
 * isto na página.
 *
 * CRONOGRAMA: é o do plano inteiro, da data de início à expiração, com as MESMAS regras que geram as
 * OS (lib/pmoc-cronograma): a substituição já aplicada — no mesmo equipamento e no mesmo mês só aparece
 * o serviço de maior intervalo, nunca os dois — e as datas já ajustadas pelo fim de semana. É o
 * plano, não a agenda: não depende de quais OS já foram geradas, mudadas à mão ou canceladas.
 */
import { DESCRICAO_PADRAO_PMOC, LABELS_STATUS_PMOC, dataBR, situacaoPmoc, type StatusExibidoPmoc } from "@/lib/pmoc";
import {
  equipamentoNoItem, execucoesDesejadas, prevalece, rotuloFrequencia, type EstadoCronograma, type ItemCronograma,
} from "@/lib/pmoc-cronograma";
import { LABELS_GRAVIDADE, ROTULO_GERAL, contarOcorrencias, resumoDasOcorrencias, textoDaSituacao, type GravidadeOcorrencia } from "@/lib/pmoc-ocorrencias";
import { chaveDiaBR } from "@/lib/fuso";
import { LABELS_TIPO_EQUIPAMENTO, LABELS_TRATAMENTO_FIM_SEMANA, formatarCpfCnpj } from "@/lib/utils";

/* ───────── o que entra ───────── */

export interface EmpresaDoDocumento {
  nome: string; cnpj?: string | null; telefone?: string | null; email?: string | null; site?: string | null;
  endereco?: string | null; cidade?: string | null; estado?: string | null;
  /** Logo em data URL (só PNG ou JPG entram no PDF) */
  logo?: string | null;
}
export interface EquipamentoDoDocumento {
  id: string; ativo: boolean; patrimonio: string | null; nome: string | null; marca: string; modelo: string;
  /** Tipo antigo (enum) e o nome do tipo do cadastro novo, quando há */
  tipo: string; tipoEquipamentoId: string | null; tipoNome: string | null;
  capacidade: string | null; setor: string | null; localizacao: string | null;
  unidadeId: string; unidadeNome: string | null;
}
/** O que o item do cronograma tem além das datas: os nomes para mostrar */
export interface ItemDoDocumento { id: string; tipoOsNome: string; tipoEquipamentoNome: string | null; equipamentoRotulo: string | null }
/** O que o técnico faz em cada tipo de equipamento: o checklist do tipo e os formulários por serviço */
export interface AtividadesDoTipo {
  tipoEquipamentoId: string; nome: string; chaveEnum: string | null;
  checklist: string[];
  formularios: { tipoOsId: string; nome: string; campos: string[] }[];
}
/** Uma ocorrência do plano (só as que estão valendo: a excluída não entra no documento) */
export interface OcorrenciaDoDocumento {
  /** "AAAA-MM-DD" */
  data: string; criadoEm?: string;
  /** null = geral da unidade */
  equipamento: Pick<EquipamentoDoDocumento, "patrimonio" | "nome" | "marca" | "modelo"> | null;
  descricao: string; gravidade: string; situacao: string; resolvidaEm: string | null; resolucao: string | null;
}
export interface DadosDocumento {
  empresa: EmpresaDoDocumento;
  pmoc: {
    nome: string; descricao: string | null; status: string; ativo: boolean; dataInicio: string; dataExpiracao: string;
    rtNome: string | null; rtCrea: string | null; artNumero: string | null; artArquivoNome: string | null;
  };
  cliente: { nome: string; nomeFantasia: string | null; cpfCnpj: string | null };
  unidade: { nome: string; logradouro?: string | null; numero?: string | null; complemento?: string | null; bairro?: string | null; cidade?: string | null; estado?: string | null; cep?: string | null };
  equipamentos: EquipamentoDoDocumento[];
  /** O mesmo estado que o cronograma usa para gerar as OS (itens, equipamentos, tipos) */
  estado: EstadoCronograma;
  itens: ItemDoDocumento[];
  atividades: AtividadesDoTipo[];
  /** O livro de ocorrências do plano (ausente = nenhuma) */
  ocorrencias?: OcorrenciaDoDocumento[];
  /** Texto técnico padrão da EMPRESA (usado quando o plano não tem o seu) */
  textoPadrao?: string | null;
  geradoEm: Date;
}

/* ───────── o que sai ───────── */

export interface CampoDoc { rotulo: string; valor: string }
export interface ServicoDoc { tipoOsId: string; codigo: string; nome: string }
export interface LinhaServicoDoc { codigo: string; servico: string; aplicaSe: string; equipamentos: number; frequencia: string; dia: number; fimSemana: string; inicio: string }
export interface CelulaDoc { codigo: string; /** "dd/mm" */ data: string; /** "AAAA-MM-DD" */ iso: string }
export interface LinhaCronogramaDoc { equipamentoId: string; tag: string; descricao: string; local: string; celulas: (CelulaDoc | null)[] }
export interface LinhaEquipamentoDoc { tag: string; descricao: string; tipo: string; capacidade: string; local: string }
export interface LinhaOcorrenciaDoc { data: string; equipamento: string; descricao: string; resolucao: string; gravidade: string; situacao: string }
export interface PlanejamentoDoc { tipo: string; equipamentos: number; atividades: string[]; formularios: { servico: string; nome: string; campos: string[] }[] }

export interface ModeloDocumento {
  nome: string;
  status: StatusExibidoPmoc | "INATIVO"; statusRotulo: string;
  vigencia: string;
  empresa: { nome: string; linhas: string[]; logo: string | null };
  identificacao: { grupo: string; campos: CampoDoc[] }[];
  rt: { nome: string; crea: string }; art: { numero: string; arquivo: string | null };
  /** Parágrafos do texto técnico (cada um pode ter quebras de linha) */
  texto: string[];
  equipamentos: LinhaEquipamentoDoc[];
  /** Equipamentos do plano que estão inativos no cadastro (não entram no cronograma) */
  inativos: number;
  servicos: ServicoDoc[];
  itens: LinhaServicoDoc[];
  /** Competências "AAAA-MM" da tabela: do primeiro ao último mês com execução, dentro da vigência */
  meses: string[];
  cronograma: LinhaCronogramaDoc[];
  totalExecucoes: number;
  observacoes: string[];
  planejamento: PlanejamentoDoc[];
  /** O livro de ocorrências, da mais antiga para a mais nova, e a frase que resume a situação delas */
  ocorrencias: LinhaOcorrenciaDoc[];
  resumoOcorrencias: string;
  geradoEm: string;
  nomeArquivo: string;
}

/* ───────── pedaços ───────── */

const txt = (v: string | null | undefined) => (v ?? "").trim();
const ordenar = (a: string, b: string) => a.localeCompare(b, "pt-BR", { numeric: true, sensitivity: "base" });

/** "48000" → "48.000 BTU/h"; o que já vem com unidade ("120 TR", "36000 BTU/h") fica como foi digitado */
export function capacidadeDoc(valor: string | null | undefined): string {
  const v = txt(valor);
  if (!v) return "—";
  // só o número, ou o número seguido de BTU: mesma escrita para todos ("36000 BTU/h" → "36.000 BTU/h")
  const btu = /^(\d{4,7})(?:\s*btus?(?:\s*\/\s*h)?)?$/i.exec(v);
  if (btu) return `${Number(btu[1]).toLocaleString("pt-BR")} BTU/h`;
  return v;
}

/** Unidade · setor · ambiente (o que houver) */
export function localDoc(e: Pick<EquipamentoDoDocumento, "unidadeNome" | "setor" | "localizacao">): string {
  return [e.unidadeNome, e.setor, e.localizacao].map(txt).filter(Boolean).join(" · ") || "—";
}

export const tipoDoc = (e: Pick<EquipamentoDoDocumento, "tipo" | "tipoNome">) => txt(e.tipoNome) || LABELS_TIPO_EQUIPAMENTO[e.tipo] || e.tipo;
export const descricaoEquipamento = (e: Pick<EquipamentoDoDocumento, "nome" | "marca" | "modelo">) => txt(e.nome) || [e.marca, e.modelo].map(txt).filter(Boolean).join(" ") || "Equipamento";

/** Endereço da unidade numa linha: "Rua X, 100 — Sala 2 — Centro — São Paulo/SP — 01000-000" */
export function enderecoDoc(u: DadosDocumento["unidade"]): string {
  const rua = [txt(u.logradouro), txt(u.numero)].filter(Boolean).join(", ");
  const cidade = [txt(u.cidade), txt(u.estado)].filter(Boolean).join("/");
  return [rua, txt(u.complemento), txt(u.bairro), cidade, txt(u.cep)].filter(Boolean).join(" — ");
}

/**
 * Código curto de cada serviço para caber na tabela do cronograma: as iniciais do nome do tipo de OS
 * ("Manutenção Preventiva" → MP, "Limpeza Química" → LQ, "Higienização" → HI). Repetiu? Ganha número.
 */
export function codigosDosServicos(servicos: { tipoOsId: string; nome: string }[]): ServicoDoc[] {
  const usados = new Set<string>();
  return servicos.map((s) => {
    const palavras = s.nome.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().split(/[^A-Z0-9]+/).filter((p) => p.length > 2 || /^\d+$/.test(p));
    const base = (palavras.length >= 2 ? palavras.slice(0, 3).map((p) => p[0]).join("") : (palavras[0] ?? "SV").slice(0, 2)) || "SV";
    let codigo = base;
    for (let n = 2; usados.has(codigo); n++) codigo = `${base}${n}`;
    usados.add(codigo);
    return { tipoOsId: s.tipoOsId, codigo, nome: s.nome };
  });
}

/** As competências do plano, mês a mês: de "2026-11" a "2027-11" */
export function mesesDoPlano(dataInicio: string, dataExpiracao: string): string[] {
  let [a, m] = dataInicio.split("-").map(Number);
  const fim = dataExpiracao.slice(0, 7);
  const out: string[] = [];
  for (let i = 0; i < 600; i++) {
    const mes = `${a}-${String(m).padStart(2, "0")}`;
    if (mes > fim) break;
    out.push(mes);
    m++; if (m > 12) { m = 1; a++; }
  }
  return out;
}

/** Parágrafos do texto técnico: blocos separados por linha em branco; as quebras simples ficam */
export function paragrafos(texto: string): string[] {
  return texto.replace(/\r\n?/g, "\n").split(/\n\s*\n/).map((p) => p.split("\n").map((l) => l.trim()).filter(Boolean).join("\n")).filter(Boolean);
}

/** O texto técnico do documento: o do plano; sem ele, o padrão da empresa; sem ele, o do sistema */
export function textoTecnico(descricao: string | null | undefined, padraoEmpresa: string | null | undefined): string {
  return txt(descricao) || txt(padraoEmpresa) || DESCRICAO_PADRAO_PMOC;
}

const aplicaSe = (item: ItemCronograma, nomes: ItemDoDocumento | undefined) =>
  item.equipamentoId ? nomes?.equipamentoRotulo || "Um equipamento" : item.tipoEquipamentoId ? nomes?.tipoEquipamentoNome || "Um tipo de equipamento" : "Todos os equipamentos";

/** Nome de arquivo do documento, sem caracteres que o sistema de arquivos recusa */
export function nomeArquivoDocumento(nome: string): string {
  const limpo = nome.replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
  return `${/^pmoc\b/i.test(limpo) ? limpo : `PMOC ${limpo || "plano"}`}.pdf`;
}

/* ───────── o documento ───────── */

export function montarDocumento(d: DadosDocumento): ModeloDocumento {
  const s = situacaoPmoc(d.pmoc, d.geradoEm);
  const status: ModeloDocumento["status"] = d.pmoc.ativo ? s.status : "INATIVO";
  const ativos = d.equipamentos.filter((e) => e.ativo);
  const nomesDoItem = new Map(d.itens.map((i) => [i.id, i]));
  const itensAtivos = d.estado.itens.filter((i) => i.ativo);

  // Serviços (tipos de OS) dos itens ativos, na ordem em que os itens foram criados
  const servicos = codigosDosServicos([...new Map(itensAtivos.map((i) => [i.tipoOsId, { tipoOsId: i.tipoOsId, nome: nomesDoItem.get(i.id)?.tipoOsNome ?? "Serviço" }])).values()]);
  const codigoDe = new Map(servicos.map((x) => [x.tipoOsId, x.codigo]));

  // O cronograma do plano inteiro: todas as execuções disputam (nenhuma é "passada"), sem olhar o que já virou OS
  const { desejado } = execucoesDesejadas({ ...d.estado, execucoes: [] }, new Date("2000-01-01T12:00:00Z"));
  const mesesDaVigencia = mesesDoPlano(d.pmoc.dataInicio, d.pmoc.dataExpiracao);
  const indiceDoMes = new Map(mesesDaVigencia.map((m, i) => [m, i]));
  const porEquipamento = new Map<string, (CelulaDoc & { item: ItemCronograma } | null)[]>();
  let totalExecucoes = 0;
  for (const q of desejado.values()) {
    const iso = chaveDiaBR(q.data);
    const coluna = indiceDoMes.get(q.periodo);
    if (coluna === undefined || iso < d.pmoc.dataInicio) continue; // antes do início do plano não é deste documento
    const linha = porEquipamento.get(q.equipamento.id) ?? mesesDaVigencia.map(() => null);
    const atual = linha[coluna];
    // A substituição deixa um serviço por equipamento e mês; se sobrar mais de um, vale a mesma regra
    if (atual && !prevalece(q.item, atual.item)) continue;
    if (!atual) totalExecucoes++;
    linha[coluna] = { codigo: codigoDe.get(q.item.tipoOsId) ?? "SV", data: `${iso.slice(8, 10)}/${iso.slice(5, 7)}`, iso, item: q.item };
    porEquipamento.set(q.equipamento.id, linha);
  }

  const emOrdem = [...ativos].sort((a, b) => ordenar(txt(a.unidadeNome), txt(b.unidadeNome)) || ordenar(txt(a.patrimonio) || "~", txt(b.patrimonio) || "~") || ordenar(descricaoEquipamento(a), descricaoEquipamento(b)));
  // A tabela vai do primeiro ao último mês COM execução: mês vazio no começo ou no fim da vigência não vira coluna
  const comExecucao = mesesDaVigencia.map((_, i) => [...porEquipamento.values()].some((linha) => linha[i]));
  const primeiro = comExecucao.indexOf(true), ultimo = comExecucao.lastIndexOf(true);
  const meses = primeiro < 0 ? [] : mesesDaVigencia.slice(primeiro, ultimo + 1);
  const cronograma: LinhaCronogramaDoc[] = emOrdem.map((e) => ({
    equipamentoId: e.id, tag: txt(e.patrimonio) || "—", descricao: descricaoEquipamento(e), local: localDoc(e),
    celulas: meses.map((_, i) => { const c = porEquipamento.get(e.id)?.[primeiro + i]; return c ? { codigo: c.codigo, data: c.data, iso: c.iso } : null; }),
  }));

  const itens: LinhaServicoDoc[] = itensAtivos.map((i) => ({
    codigo: codigoDe.get(i.tipoOsId) ?? "SV", servico: nomesDoItem.get(i.id)?.tipoOsNome ?? "Serviço", aplicaSe: aplicaSe(i, nomesDoItem.get(i.id)),
    equipamentos: d.estado.equipamentos.filter((e) => e.ativo && equipamentoNoItem(i, e, d.estado.tipos)).length,
    frequencia: rotuloFrequencia(i.intervaloMeses), dia: i.diaExecucao, fimSemana: LABELS_TRATAMENTO_FIM_SEMANA[i.fimSemana] ?? i.fimSemana, inicio: dataBR(i.dataInicio),
  }));

  // Planejamento: por tipo de equipamento coberto, o checklist do tipo e os formulários dos serviços do plano
  const servicosDoPlano = new Set(itensAtivos.map((i) => i.tipoOsId));
  const nomeDoServico = new Map(servicos.map((x) => [x.tipoOsId, x.nome]));
  const grupos = new Map<string, { tipo: string; equipamentos: number; atividades: AtividadesDoTipo | undefined }>();
  for (const e of ativos) {
    const atividades = d.atividades.find((a) => (e.tipoEquipamentoId ? a.tipoEquipamentoId === e.tipoEquipamentoId : a.chaveEnum === e.tipo));
    const chave = atividades?.tipoEquipamentoId ?? `enum:${e.tipo}`;
    const g = grupos.get(chave) ?? { tipo: atividades?.nome ?? tipoDoc(e), equipamentos: 0, atividades };
    g.equipamentos++;
    grupos.set(chave, g);
  }
  const planejamento: PlanejamentoDoc[] = [...grupos.values()].sort((a, b) => ordenar(a.tipo, b.tipo)).map((g) => ({
    tipo: g.tipo, equipamentos: g.equipamentos, atividades: g.atividades?.checklist ?? [],
    formularios: (g.atividades?.formularios ?? []).filter((f) => servicosDoPlano.has(f.tipoOsId)).map((f) => ({ servico: nomeDoServico.get(f.tipoOsId) ?? "Serviço", nome: f.nome, campos: f.campos })),
  }));

  // Ocorrências: o livro em ordem de data (a de mesma data, na ordem em que foi registrada)
  const registradas = [...(d.ocorrencias ?? [])].sort((a, b) => a.data.localeCompare(b.data) || (a.criadoEm ?? "").localeCompare(b.criadoEm ?? ""));
  const ocorrencias: LinhaOcorrenciaDoc[] = registradas.map((o) => ({
    data: dataBR(o.data),
    equipamento: o.equipamento ? [txt(o.equipamento.patrimonio), descricaoEquipamento(o.equipamento)].filter(Boolean).join(" · ") : ROTULO_GERAL,
    descricao: txt(o.descricao), resolucao: o.situacao === "RESOLVIDA" ? txt(o.resolucao) : "",
    gravidade: LABELS_GRAVIDADE[o.gravidade as GravidadeOcorrencia] ?? o.gravidade, situacao: textoDaSituacao(o),
  }));

  const observacoes: string[] = [];
  if (itensAtivos.length > 1) observacoes.push("Quando dois serviços coincidem no mesmo equipamento e no mesmo mês, é executado o de maior intervalo, que inclui a rotina do serviço mais frequente.");
  if (itensAtivos.some((i) => i.fimSemana !== "MANTER")) observacoes.push("As datas que cairiam em sábado ou domingo já estão ajustadas para o dia útil definido em cada serviço. Feriados não são considerados.");
  if (itensAtivos.length) observacoes.push("As datas são as previstas no plano; a execução é registrada na ordem de serviço de cada manutenção.");

  const endereco = enderecoDoc(d.unidade);
  const cliente = txt(d.cliente.nomeFantasia) && txt(d.cliente.nomeFantasia) !== txt(d.cliente.nome) ? `${txt(d.cliente.nomeFantasia)} (${txt(d.cliente.nome)})` : txt(d.cliente.nome);
  const vigencia = `${dataBR(d.pmoc.dataInicio)} a ${dataBR(d.pmoc.dataExpiracao)}`;
  const statusRotulo = status === "INATIVO" ? "Inativo" : LABELS_STATUS_PMOC[status];
  const empresaCidade = [txt(d.empresa.cidade), txt(d.empresa.estado)].filter(Boolean).join("/");

  return {
    nome: d.pmoc.nome, status, statusRotulo, vigencia,
    empresa: {
      nome: d.empresa.nome,
      linhas: [
        txt(d.empresa.cnpj) ? `CNPJ ${formatarCpfCnpj(txt(d.empresa.cnpj))}` : "",
        [txt(d.empresa.endereco), empresaCidade].filter(Boolean).join(" — "),
        [txt(d.empresa.telefone), txt(d.empresa.email), txt(d.empresa.site)].filter(Boolean).join(" · "),
      ].filter(Boolean),
      logo: d.empresa.logo ?? null,
    },
    identificacao: [
      { grupo: "Estabelecimento", campos: [
        { rotulo: "Cliente", valor: cliente || "—" },
        { rotulo: "CNPJ/CPF", valor: txt(d.cliente.cpfCnpj) ? formatarCpfCnpj(txt(d.cliente.cpfCnpj)) : "—" },
        { rotulo: "Unidade", valor: txt(d.unidade.nome) || "—" },
        { rotulo: "Endereço", valor: endereco || "—" },
      ] },
      { grupo: "Plano", campos: [
        { rotulo: "Vigência", valor: vigencia },
        { rotulo: "Situação", valor: status === "VIGENTE" && s.diasParaExpirar !== null ? `Vigente — expira em ${dataBR(d.pmoc.dataExpiracao)}` : status === "EXPIRADO" ? `Expirado em ${dataBR(d.pmoc.dataExpiracao)}` : statusRotulo },
        { rotulo: "Equipamentos cobertos", valor: String(ativos.length) },
        { rotulo: "Empresa responsável", valor: d.empresa.nome },
      ] },
      { grupo: "Responsabilidade técnica", campos: [
        { rotulo: "Responsável Técnico", valor: txt(d.pmoc.rtNome) || "Não informado" },
        { rotulo: "Registro CREA", valor: txt(d.pmoc.rtCrea) || "Não informado" },
        { rotulo: "ART nº", valor: txt(d.pmoc.artNumero) || "Não informada" },
      ] },
    ],
    rt: { nome: txt(d.pmoc.rtNome), crea: txt(d.pmoc.rtCrea) },
    art: { numero: txt(d.pmoc.artNumero), arquivo: d.pmoc.artArquivoNome },
    texto: paragrafos(textoTecnico(d.pmoc.descricao, d.textoPadrao)),
    equipamentos: emOrdem.map((e) => ({ tag: txt(e.patrimonio) || "—", descricao: descricaoEquipamento(e), tipo: tipoDoc(e), capacidade: capacidadeDoc(e.capacidade), local: localDoc(e) })),
    inativos: d.equipamentos.length - ativos.length,
    servicos, itens, meses, cronograma, totalExecucoes, observacoes, planejamento,
    ocorrencias, resumoOcorrencias: resumoDasOcorrencias(contarOcorrencias(registradas)),
    geradoEm: dataBR(chaveDiaBR(d.geradoEm)),
    nomeArquivo: nomeArquivoDocumento(d.pmoc.nome),
  };
}

/** Rótulo do mês da competência no cabeçalho da tabela: "2026-11" → "nov/26" */
export function rotuloMes(competencia: string): string {
  const [a, m] = competencia.split("-");
  return `${["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"][Number(m) - 1] ?? m}/${a.slice(2)}`;
}
