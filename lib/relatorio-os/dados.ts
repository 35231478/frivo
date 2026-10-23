/**
 * Relatório da OS (layout por equipamento) — dados. Carrega a OS com tudo o que o relatório usa
 * e MONTA (função pura, testável) a estrutura do documento:
 *   cabeçalho · resultado · cliente/local · equipe/veículo · um bloco por equipamento (local,
 *   equipamento + TAG, checklist e fotos DAQUELE equipamento) · formulário geral · não atendidos ·
 *   horários · observações · assinaturas.
 * O que mostrar em cada versão (cliente × interna) é decidido na tela, pela configuração.
 *
 * Fonte de cada parte:
 *  - checklist do TIPO por equipamento: checklist_respostas (OK / Atenção / Não se aplica + observação;
 *    medição = número + unidade, sem avaliação; áudio só sinalizado, na versão interna);
 *  - fotos por equipamento: fotos_atendimento (as DELE: antes → itens/gerais → depois) + as do formulário do tipo;
 *  - serviços ADICIONAIS (pedidos na visita): servicos_adicionais da OS, destacados (a cobrança é do adm);
 *  - formulário do tipo por equipamento: respostas_formulario_equipamento (atividade × equipamento × campo);
 *  - formulário geral: atividade_respostas (respostas da atividade, sem equipamento);
 *  - equipamentos: SÓ os ATENDIDOS na OS (atividade_equipamentos.feito), e de cada um só o que foi
 *    registrado nas atividades em que ele foi atendido. OS antiga concluída sem nenhum vínculo: o
 *    equipamento principal da OS conta como atendido (era assim que se registrava).
 */
import { prisma } from "@/lib/prisma";
import { LABELS_STATUS_OS , comparaNatural } from "@/lib/utils";
import { ambienteEquipamento, descricaoEquipamento, fabricanteModelo } from "@/lib/equipamento-descricao";
import { textoTecnicosAtividade } from "@/lib/atividade-equipe";
import { enderecoStr, type ClienteInfo, type ContratoInfo, type EmpresaInfo } from "@/components/relatorio/cabecalho-relatorio";
import type { StatusItem } from "@/lib/execucao/pendencias";

/* ───────── Tipos do documento ───────── */
export interface ItemChecklist { label: string; tipo: string; valor: string }
export interface GrupoChecklist { formulario: string; atividade: string; itens: ItemChecklist[] }
export interface FotoRelatorio { url: string; legenda: string }
export interface ItemChecklistTipo {
  texto: string; status: StatusItem | null; observacao: string | null;
  /** Medição capturada pelo técnico (número + unidade) — sem avaliação */
  medicao: { valor: number; unidade: string | null } | null;
  /** Tem observação em áudio (ouve-se na OS; no papel, só a marca na versão interna) */
  audio: boolean;
}
export interface ChecklistTipoRelatorio { atividade: string; itens: ItemChecklistTipo[] }
export interface BlocoEquipamento {
  id: string;
  /** Onde está: ambiente (principal) + setor (complemento) + unidade */
  local: { principal: string | null; complemento: string | null; unidade: string | null };
  titulo: string;
  descricao: string;
  fabricante: string;
  tag: string | null;
  numeroSerie: string | null;
  /** Checklist do tipo do equipamento, por atividade em que ele foi atendido */
  checklistTipo: ChecklistTipoRelatorio[];
  /** Contagem das respostas do checklist do tipo */
  resumoChecklist: { ok: number; atencao: number; naoSeAplica: number; medicoes: number };
  /** Formulário do tipo (tipo de OS × tipo de equipamento) */
  checklist: GrupoChecklist[];
  fotos: FotoRelatorio[];
  /** Observação do técnico sobre ESTE equipamento */
  observacoes: string[];
}
/** Serviço a mais pedido na visita: mesma OS, mesmo relatório, destacado (a cobrança o escritório decide) */
export interface AdicionalRelatorio {
  id: string; descricao: string; atividade: string; equipamento: string | null; fotos: FotoRelatorio[];
  statusCobranca: "A_AVALIAR" | "COBRAR" | "NAO_COBRAR"; criadoPor: string | null;
}
export interface AssinaturaColetada { rotulo: string; url: string; nome: string | null; data: Date | null }
export interface RelatorioOsDados {
  empresa: EmpresaInfo;
  numeroOs: string;
  numeroRelatorio: string | null;
  tipos: string[];
  status: string;
  situacao: string;
  datas: { abertura: Date; inicio: Date | null; conclusao: Date | null; previsao: Date | null };
  solicitacao: string;
  cliente: ClienteInfo;
  contrato: ContratoInfo | null;
  local: { nome: string; endereco: string } | null;
  equipe: { atividade: string; tecnicos: string | null; veiculo: string | null }[];
  resultado: { texto: string; atendidos: number; totalEquipamentos: number; atividades: number; concluidas: number };
  equipamentos: BlocoEquipamento[];
  naoAtendidos: { id: string; titulo: string; local: string | null }[];
  adicionais: AdicionalRelatorio[];
  geral: { checklist: GrupoChecklist[]; fotos: FotoRelatorio[] };
  tempos: { atividade: string; status: string; inicio: Date | null; duracaoMin: number | null }[];
  observacoes: string[];
  assinaturas: { coletadas: AssinaturaColetada[]; responsavel: { nome: string; crea: string | null } | null; clienteNome: string };
  /** Para o botão "Enviar" do link público (e-mail/WhatsApp de faturamento do cliente) */
  envio: { email: string | null; whatsapp: string | null };
}

/* ───────── Entrada (o que o banco devolve; campos mínimos) ───────── */
type Campo = { label: string; tipo: string; ordem?: number | null };
type Resposta = { resposta: string | null; arquivoUrl: string | null; campo: Campo; formulario?: { nome: string } | null; formularioId?: string };
type Equip = {
  id: string; tipo: string; marca: string; modelo: string; numeroSerie: string | null; patrimonio: string | null; nome: string | null;
  capacidade: string | null; setor: string | null; localizacao: string | null; tipoEquipamento?: { nome: string } | null;
};
export type AtividadeParaBlocos = Atividade;
type Atividade = {
  id: string; titulo: string; status: string; criadoEm: Date; dataAgendada: Date | null; duracaoMin: number | null;
  observacao: string | null; resumo: string | null;
  tipoOs?: { nome: string } | null; tecnico?: { nome: string } | null; equipe?: { nome: string } | null;
  tecnicosEquipe?: { tecnico: { nome: string } }[];
  veiculo?: { placa: string; modelo: string; marca: string | null } | null;
  respostas: Resposta[];
  equipamentos: { feito: boolean; observacao?: string | null; equipamento: Equip }[];
  respostasEquipamento: (Resposta & { equipamentoId: string })[];
  checklistRespostas?: {
    equipamentoId: string; status: string | null; observacao: string | null; textoItem: string; item?: { ordem: number } | null;
    id?: string; valor?: { toNumber(): number } | number | null; unidade?: string | null; audio?: boolean;
  }[];
  fotosAtendimento?: { id: string; equipamentoId: string; url: string; momento?: "ANTES" | "DEPOIS" | null; item?: { texto: string } | null }[];
  servicosAdicionais?: AdicionalEntrada[];
};
type AdicionalEntrada = {
  id: string; descricao: string; statusCobranca: "A_AVALIAR" | "COBRAR" | "NAO_COBRAR"; criadoPor?: { nome: string } | null;
  equipamento: Equip | null; fotos: { url: string }[];
};
export interface OsParaRelatorio {
  numero: string; status: string; descricao: string; observacoes: string | null;
  criadoEm: Date; dataInicio: Date | null; dataConclusao: Date | null; previsaoConclusao: Date | null;
  empresa: EmpresaInfo;
  cliente: ClienteInfo & { email?: string | null; emailsFaturamento?: string[] | null; celular?: string | null; whatsappFaturamento?: string | null };
  unidade: { nome: string; logradouro: string | null; numero: string | null; bairro: string | null; cidade: string | null; estado: string | null; cep: string | null } | null;
  contrato: ContratoInfo | null;
  equipamento: Equip | null;
  atividades: Atividade[];
}
export interface RelatorioRef { numero: string; observacao: string | null; assinaturaUrl: string | null; assinadoPor: string | null; assinadoEm: Date | null }

/* ───────── Montagem (pura) ───────── */
const ehImagem = (url: string | null) => !!url && /^data:image\//.test(url);
const ehFoto = (r: Resposta) => !!r.arquivoUrl && (r.campo.tipo === "FOTO" || (r.campo.tipo !== "ASSINATURA" && ehImagem(r.arquivoUrl)));
const ehAssinatura = (r: Resposta) => r.campo.tipo === "ASSINATURA" && !!r.arquivoUrl;
const SIM = ["sim", "true", "1", "yes"];

/** Valor da resposta para leitura humana: Sim/Não, data dd/mm/aaaa, lista "a, b". */
export function valorResposta(tipo: string, resposta: string | null): string {
  const v = (resposta ?? "").trim();
  if (tipo === "SIM_NAO") return SIM.includes(v.toLowerCase()) ? "Sim" : "Não";
  if (tipo === "DATA") { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v); if (m) return `${m[3]}/${m[2]}/${m[1]}`; }
  if (tipo === "MULTIPLA_ESCOLHA" && v.startsWith("[")) { try { const a = JSON.parse(v); if (Array.isArray(a)) return a.join(", "); } catch { /* texto */ } }
  return v;
}

/** Respostas → grupos de checklist (por formulário da atividade), na ordem dos campos. */
function checklistDe(respostas: Resposta[], atividade: string): GrupoChecklist[] {
  const grupos = new Map<string, GrupoChecklist & { ordem: number[] }>();
  for (const r of respostas) {
    // Foto e assinatura vão para as suas seções; resposta em branco não entra
    if (ehFoto(r) || r.campo.tipo === "FOTO" || r.campo.tipo === "ASSINATURA" || !(r.resposta ?? "").trim()) continue;
    const nome = r.formulario?.nome ?? "Checklist";
    const g = grupos.get(nome) ?? { formulario: nome, atividade, itens: [], ordem: [] };
    g.itens.push({ label: r.campo.label, tipo: r.campo.tipo, valor: valorResposta(r.campo.tipo, r.resposta) });
    g.ordem.push(r.campo.ordem ?? 0);
    grupos.set(nome, g);
  }
  return [...grupos.values()].map(({ ordem, ...g }) => ({
    ...g, itens: g.itens.map((it, i) => ({ it, o: ordem[i] })).sort((a, b) => a.o - b.o).map((x) => x.it),
  }));
}
const fotosDe = (respostas: Resposta[]): FotoRelatorio[] => respostas.filter(ehFoto).map((r) => ({ url: r.arquivoUrl!, legenda: r.campo.label }));

function blocoEquipamento(e: Equip, unidade: string | null): Omit<BlocoEquipamento, "checklist" | "fotos" | "checklistTipo" | "resumoChecklist" | "observacoes"> {
  const amb = ambienteEquipamento(e, null);
  return {
    id: e.id,
    local: { principal: amb.principal, complemento: amb.complemento, unidade },
    titulo: (e.nome ?? "").trim() || descricaoEquipamento(e),
    descricao: descricaoEquipamento(e),
    fabricante: fabricanteModelo(e),
    tag: (e.patrimonio ?? "").trim() || null,
    numeroSerie: (e.numeroSerie ?? "").trim() || null,
  };
}
const localTexto = (l: BlocoEquipamento["local"]) => [l.principal, l.complemento].filter(Boolean).join(" · ") || null;

const STATUS_VALIDOS: StatusItem[] = ["OK", "ATENCAO", "NAO_SE_APLICA"];
const numero = (v: { toNumber(): number } | number | null | undefined) => (v === null || v === undefined ? null : typeof v === "number" ? v : v.toNumber());
/** Antes do serviço → fotos dos itens/gerais → depois do serviço */
const ORDEM_MOMENTO = { ANTES: 0, NENHUM: 1, DEPOIS: 2 } as const;
const legendaFoto = (f: { momento?: "ANTES" | "DEPOIS" | null; item?: { texto: string } | null }) =>
  f.momento === "ANTES" ? "Antes do serviço" : f.momento === "DEPOIS" ? "Depois do serviço" : f.item?.texto ?? "Foto do equipamento";

/** Os serviços adicionais das atividades (menos as canceladas), com o equipamento e as fotos de cada um. */
export function adicionaisDe(ativs: Atividade[]): AdicionalRelatorio[] {
  return ativs.filter((a) => a.status !== "CANCELADA").flatMap((a) => (a.servicosAdicionais ?? []).map((s) => {
    const eq = s.equipamento ? blocoEquipamento(s.equipamento, null) : null;
    return {
      id: s.id, descricao: s.descricao, atividade: a.titulo, statusCobranca: s.statusCobranca, criadoPor: s.criadoPor?.nome ?? null,
      equipamento: eq ? [eq.titulo, eq.tag && `TAG ${eq.tag}`].filter(Boolean).join(" · ") : null,
      fotos: s.fotos.map((f, i) => ({ url: f.url, legenda: `Adicional — foto ${i + 1}` })),
    };
  }));
}

/**
 * Os equipamentos ATENDIDOS (um bloco cada) e os vinculados que não foram atendidos. De cada
 * atendido, só o que foi registrado nas atividades em que ELE foi atendido: checklist do tipo, as
 * fotos dele, a observação dele e o formulário do tipo. Usado no relatório da OS e no da atividade.
 */
export function blocosAtendidos(ativs: Atividade[], unidade: string | null, principal: Equip | null = null, legado = false) {
  const equips = new Map<string, { e: Equip; atividades: Set<string> }>();
  for (const a of ativs) for (const v of a.equipamentos) {
    const x = equips.get(v.equipamento.id) ?? { e: v.equipamento, atividades: new Set<string>() };
    if (v.feito && a.status !== "CANCELADA") x.atividades.add(a.id); // atividade cancelada não atendeu ninguém
    equips.set(v.equipamento.id, x);
  }
  // OS antiga (concluída sem nenhum equipamento vinculado): o principal era o atendido
  if (principal && !equips.has(principal.id))
    equips.set(principal.id, { e: principal, atividades: new Set(legado && equips.size === 0 ? ["*", ...ativs.map((a) => a.id)] : []) });

  const blocos: BlocoEquipamento[] = [...equips.values()].filter((x) => x.atividades.size).map(({ e, atividades }) => {
    const checklist: GrupoChecklist[] = [], fotos: FotoRelatorio[] = [], checklistTipo: ChecklistTipoRelatorio[] = [], observacoes: string[] = [];
    const resumoChecklist = { ok: 0, atencao: 0, naoSeAplica: 0, medicoes: 0 };
    for (const a of ativs.filter((x) => atividades.has(x.id))) {
      const itens: ItemChecklistTipo[] = (a.checklistRespostas ?? [])
        .filter((r) => r.equipamentoId === e.id && (r.status || (r.observacao ?? "").trim() || numero(r.valor) !== null || r.audio))
        .sort((x, y) => (x.item?.ordem ?? 0) - (y.item?.ordem ?? 0))
        .map((r) => {
          const valor = numero(r.valor);
          return {
            texto: r.textoItem, status: STATUS_VALIDOS.includes(r.status as StatusItem) ? (r.status as StatusItem) : null, observacao: (r.observacao ?? "").trim() || null,
            medicao: valor === null ? null : { valor, unidade: r.unidade ?? null }, audio: !!r.audio,
          };
        });
      for (const it of itens) {
        if (it.status === "OK") resumoChecklist.ok++;
        else if (it.status === "ATENCAO") resumoChecklist.atencao++;
        else if (it.status === "NAO_SE_APLICA") resumoChecklist.naoSeAplica++;
        else if (it.medicao) resumoChecklist.medicoes++;
      }
      if (itens.length) checklistTipo.push({ atividade: a.titulo, itens });
      fotos.push(...(a.fotosAtendimento ?? []).filter((f) => f.equipamentoId === e.id)
        .map((f, i) => ({ f, i })).sort((x, y) => ORDEM_MOMENTO[x.f.momento ?? "NENHUM"] - ORDEM_MOMENTO[y.f.momento ?? "NENHUM"] || x.i - y.i)
        .map(({ f }) => ({ url: f.url, legenda: legendaFoto(f) })));
      const rs = a.respostasEquipamento.filter((r) => r.equipamentoId === e.id);
      checklist.push(...checklistDe(rs, a.titulo));
      fotos.push(...fotosDe(rs));
      const obs = (a.equipamentos.find((v) => v.equipamento.id === e.id)?.observacao ?? "").trim();
      if (obs && !observacoes.includes(obs)) observacoes.push(obs);
    }
    return { ...blocoEquipamento(e, unidade), checklistTipo, resumoChecklist, checklist, fotos, observacoes };
  }).sort((a, b) =>
    comparaNatural(`${a.local.complemento ?? ""}|${a.local.principal ?? ""}|${a.titulo}`, `${b.local.complemento ?? ""}|${b.local.principal ?? ""}|${b.titulo}`));

  const naoAtendidos = [...equips.values()].filter((x) => !x.atividades.size).map(({ e }) => {
    const b = blocoEquipamento(e, unidade);
    return { id: e.id, titulo: b.titulo, local: localTexto(b.local) };
  }).sort((a, b) => comparaNatural(a.titulo, b.titulo));

  const ids = new Set(blocos.map((b) => b.id));
  const equipamentosAtendidos = [...equips.values()].filter((x) => ids.has(x.e.id)).map((x) => x.e);
  return { blocos, naoAtendidos, total: equips.size, equipamentosAtendidos };
}

export function montarRelatorioOs(os: OsParaRelatorio, relatorio: RelatorioRef | null): RelatorioOsDados {
  const unidade = os.unidade?.nome ?? null;
  const ativs = os.atividades;

  const { blocos, naoAtendidos, total } = blocosAtendidos(ativs, unidade, os.equipamento, os.status === "CONCLUIDA");

  const concluidas = ativs.filter((a) => a.status === "CONCLUIDA").length;
  // Relato do técnico (texto livre da atividade). O `resumo` NÃO entra: é o despejo automático das
  // respostas do formulário geral ("Campo: valor"), que já sai na seção do formulário.
  const relatos = ativs.map((a) => (a.observacao ?? "").trim()).filter(Boolean);
  const situacao = LABELS_STATUS_OS[os.status] ?? os.status;
  const partes = [
    `${situacao}`,
    total ? `${blocos.length} de ${total} equipamento${total === 1 ? "" : "s"} atendido${blocos.length === 1 ? "" : "s"}` : null,
    ativs.length ? `${concluidas} de ${ativs.length} atividade${ativs.length === 1 ? "" : "s"} concluída${concluidas === 1 ? "" : "s"}` : null,
  ].filter(Boolean);
  const texto = [partes.join(" · "), relatos.join(" ").slice(0, 280)].filter(Boolean).join(". ");

  // Equipe: uma linha por atividade (sem repetir linhas iguais)
  const equipe: RelatorioOsDados["equipe"] = [];
  for (const a of ativs) {
    const linha = {
      atividade: a.titulo, tecnicos: textoTecnicosAtividade(a),
      veiculo: a.veiculo ? [a.veiculo.placa, [a.veiculo.marca, a.veiculo.modelo].filter(Boolean).join(" ")].filter(Boolean).join(" — ") : null,
    };
    if ((linha.tecnicos || linha.veiculo) && !equipe.some((x) => x.tecnicos === linha.tecnicos && x.veiculo === linha.veiculo)) equipe.push(linha);
  }

  // Assinaturas coletadas nos formulários (a mesma imagem replicada por equipamento conta uma vez)
  const coletadas: AssinaturaColetada[] = [];
  const vistas = new Set<string>();
  const add = (a: AssinaturaColetada) => { if (!vistas.has(a.url)) { vistas.add(a.url); coletadas.push(a); } };
  for (const a of ativs) for (const r of [...a.respostas, ...a.respostasEquipamento]) {
    if (ehAssinatura(r)) add({ rotulo: r.campo.label, url: r.arquivoUrl!, nome: null, data: null });
  }
  if (relatorio?.assinaturaUrl) add({ rotulo: "Aprovação do cliente", url: relatorio.assinaturaUrl, nome: relatorio.assinadoPor, data: relatorio.assinadoEm });

  return {
    empresa: os.empresa,
    numeroOs: os.numero,
    numeroRelatorio: relatorio?.numero ?? null,
    tipos: [...new Set(ativs.map((a) => a.tipoOs?.nome).filter(Boolean) as string[])],
    status: os.status,
    situacao,
    datas: { abertura: os.criadoEm, inicio: os.dataInicio, conclusao: os.dataConclusao, previsao: os.previsaoConclusao },
    solicitacao: os.descricao,
    cliente: os.cliente,
    contrato: os.contrato,
    local: os.unidade ? {
      nome: os.unidade.nome,
      endereco: enderecoStr({ endereco: os.unidade.logradouro, numero: os.unidade.numero, bairro: os.unidade.bairro, cidade: os.unidade.cidade, estado: os.unidade.estado, cep: os.unidade.cep }),
    } : null,
    equipe,
    resultado: { texto, atendidos: blocos.length, totalEquipamentos: total, atividades: ativs.length, concluidas },
    equipamentos: blocos,
    naoAtendidos,
    adicionais: adicionaisDe(ativs),
    geral: {
      checklist: ativs.flatMap((a) => checklistDe(a.respostas, a.titulo)),
      fotos: ativs.flatMap((a) => fotosDe(a.respostas)),
    },
    tempos: ativs.map((a) => ({ atividade: a.titulo, status: a.status, inicio: a.dataAgendada ?? a.criadoEm, duracaoMin: a.duracaoMin })),
    observacoes: [os.observacoes, relatorio?.observacao].map((x) => (x ?? "").trim()).filter((x, i, arr) => x && arr.indexOf(x) === i),
    assinaturas: {
      coletadas,
      responsavel: os.contrato?.responsavelTecnico ? { nome: os.contrato.responsavelTecnico.nome, crea: os.contrato.responsavelTecnico.crea ?? null } : null,
      clienteNome: os.cliente.nomeFantasia ?? os.cliente.nome,
    },
    envio: {
      email: os.cliente.emailsFaturamento?.[0] ?? os.cliente.email ?? null,
      whatsapp: os.cliente.whatsappFaturamento ?? os.cliente.celular ?? null,
    },
  };
}

/* ───────── Carga ───────── */
const SELECT_EQUIP = {
  id: true, tipo: true, marca: true, modelo: true, numeroSerie: true, patrimonio: true, nome: true, capacidade: true,
  setor: true, localizacao: true, tipoEquipamento: { select: { nome: true } },
} as const;
const CAMPO = { select: { label: true, tipo: true, ordem: true } } as const;
export const SELECT_CHECKLIST = { select: { id: true, equipamentoId: true, status: true, observacao: true, textoItem: true, valor: true, unidade: true, item: { select: { ordem: true } } } } as const;
export const SELECT_FOTOS = { orderBy: { criadoEm: "asc" }, select: { id: true, equipamentoId: true, url: true, momento: true, item: { select: { texto: true } } } } as const;
export const SELECT_ADICIONAIS = {
  orderBy: { criadoEm: "asc" },
  select: {
    id: true, descricao: true, statusCobranca: true, criadoPor: { select: { nome: true } },
    equipamento: { select: SELECT_EQUIP }, fotos: { orderBy: { criadoEm: "asc" }, select: { url: true } },
  },
} as const;

/** Marca as respostas que têm áudio (sem carregar o áudio: ele é servido à parte). */
export async function marcarAudios<T extends { checklistRespostas?: { id?: string; audio?: boolean }[] }>(atividades: T[]): Promise<T[]> {
  const ids = atividades.flatMap((a) => (a.checklistRespostas ?? []).map((r) => r.id).filter((x): x is string => !!x));
  if (!ids.length) return atividades;
  const com = new Set((await prisma.checklistResposta.findMany({ where: { id: { in: ids }, audioUrl: { not: null } }, select: { id: true } })).map((r) => r.id));
  for (const a of atividades) for (const r of a.checklistRespostas ?? []) r.audio = !!r.id && com.has(r.id);
  return atividades;
}

/** OS da empresa (empresa SEMPRE da sessão, ou do relatório no link público). null = não existe nela. */
export async function carregarOsParaRelatorio(osId: string, empresaId: string): Promise<OsParaRelatorio | null> {
  const os = await prisma.ordemServico.findFirst({
    where: { id: osId, empresaId },
    include: {
      empresa: true,
      cliente: true,
      unidade: { select: { nome: true, logradouro: true, numero: true, bairro: true, cidade: true, estado: true, cep: true } },
      contrato: { select: { numero: true, artNumero: true, responsavelTecnico: { select: { nome: true, crea: true } } } },
      equipamento: { select: SELECT_EQUIP },
      atividades: {
        orderBy: { criadoEm: "asc" },
        include: {
          tipoOs: { select: { nome: true } },
          tecnico: { select: { nome: true } },
          equipe: { select: { nome: true } },
          tecnicosEquipe: { select: { tecnico: { select: { nome: true } } }, orderBy: { criadoEm: "asc" } },
          veiculo: { select: { placa: true, modelo: true, marca: true } },
          respostas: { include: { campo: CAMPO, formulario: { select: { nome: true } } } },
          equipamentos: { orderBy: { criadoEm: "asc" }, include: { equipamento: { select: SELECT_EQUIP } } },
          respostasEquipamento: { include: { campo: CAMPO, formulario: { select: { nome: true } } } },
          checklistRespostas: SELECT_CHECKLIST,
          fotosAtendimento: SELECT_FOTOS,
          servicosAdicionais: SELECT_ADICIONAIS,
        },
      },
    },
  });
  if (os) await marcarAudios(os.atividades);
  return os as unknown as OsParaRelatorio | null;
}

const SELECT_REL = { numero: true, observacao: true, assinaturaUrl: true, assinadoPor: true, assinadoEm: true } as const;

/** Versão interna (logado): OS da empresa da sessão + o relatório geral dela, se já existir. */
export async function relatorioInterno(osId: string, empresaId: string) {
  const os = await carregarOsParaRelatorio(osId, empresaId);
  if (!os) return null;
  const rel = await prisma.relatorioOs.findFirst({ where: { ordemServicoId: osId, empresaId, escopo: "GERAL" }, orderBy: { criadoEm: "desc" }, select: SELECT_REL });
  return { empresaId, dados: montarRelatorioOs(os, rel) };
}

/** Versão do cliente (link público): pelo token do relatório; a empresa vem do próprio relatório. */
export async function relatorioPorToken(token: string) {
  const rel = await prisma.relatorioOs.findUnique({ where: { tokenPublico: token }, select: { ...SELECT_REL, ordemServicoId: true, empresaId: true } });
  if (!rel) return null;
  const os = await carregarOsParaRelatorio(rel.ordemServicoId, rel.empresaId);
  if (!os) return null;
  return { empresaId: rel.empresaId, dados: montarRelatorioOs(os, rel) };
}
