/**
 * Cadastro de equipamento em campo (app do técnico) — o lado do SERVIDOR. Reaproveita o que o
 * cadastro do painel já usa: o tipo é resolvido pela mesma função (`resolverTipoEquipamento`: tem de
 * ser um tipo que existe e está ativo), as fotos passam pela mesma validação (tipo pelos bytes) e o QR
 * sai do mesmo contador (`gerarQrCodeEquipamento`). O que é próprio daqui: o equipamento nasce na
 * unidade da OS, já vinculado à atividade, com o id que o aparelho gerou (reenviar não duplica).
 */
import { prisma } from "@/lib/prisma";
import { LABELS_TIPO_EQUIPAMENTO } from "@/lib/utils";
import { PREFIXO_TIPO_CUSTOM, opcoesTipoEquipamento } from "@/lib/cadastros/tipos-equipamento";
import { resolverTipoEquipamento } from "@/lib/tipo-equipamento";
import { validarFotos } from "@/lib/anexos-server";
import { gerarQrCodeEquipamento } from "@/lib/qrcode-server";
import { carregarConfigApp } from "@/lib/tecnico/config-app-server";
import {
  MSG_CADASTRO_DESLIGADO, MSG_SEM_UNIDADE, SERIE_MIN, apresentarCadastro, type CadastroCampo, type CadastroEquipamento, type TipoCadastro,
} from "@/lib/tecnico/cadastro-equipamento";
import type { ContextoExecucao } from "@/lib/execucao/contexto";
import type { ResultadoAcao } from "@/lib/execucao/acoes";

const ok = <T>(dados: T, status = 200): ResultadoAcao<T> => ({ ok: true, status, dados });
const erro = (status: number, mensagem: string): ResultadoAcao<never> => ({ ok: false, status, erro: mensagem });
const limpo = (v: string | null | undefined) => (v ?? "").trim() || null;

/** A unidade onde o equipamento nasce: a da OS; sem ela, a ÚNICA do cliente. Mais de uma = não dá para saber. */
export async function unidadeDoCadastro(empresaId: string, os: { clienteId: string; unidadeId: string | null }): Promise<string | null> {
  if (os.unidadeId) return os.unidadeId;
  const unidades = await prisma.unidade.findMany({ where: { empresaId, clienteId: os.clienteId }, select: { id: true }, take: 2 });
  return unidades.length === 1 ? unidades[0].id : null;
}

/** Os tipos que o técnico pode escolher: a mesma lista (e a mesma regra de "só os ativos") do cadastro do painel. */
export async function tiposParaCadastro(empresaId: string): Promise<TipoCadastro[]> {
  const cadastro = await prisma.tipoEquipamentoCustom.findMany({ where: { empresaId }, select: { id: true, nome: true, chaveEnum: true, ativo: true }, orderBy: { nome: "asc" } });
  const porChave = new Map(cadastro.filter((t) => t.chaveEnum).map((t) => [t.chaveEnum as string, t.id]));
  return opcoesTipoEquipamento(cadastro).map((o) => ({
    valor: o.value, nome: o.label,
    tipoEquipamentoId: o.value.startsWith(PREFIXO_TIPO_CUSTOM) ? o.value.slice(PREFIXO_TIPO_CUSTOM.length) : porChave.get(o.value) ?? null,
  }));
}

/** O que vai no retrato da atividade para o app cadastrar sem sinal. null = permissão desligada na empresa. */
export async function cadastroParaRetrato(
  empresaId: string, permitido: boolean, os: { clienteId: string; unidadeId: string | null },
  daUnidade: readonly { setor: string | null; localizacao: string | null }[],
): Promise<CadastroCampo | null> {
  if (!permitido) return null;
  const distintos = (vs: (string | null)[]) => [...new Set(vs.map((v) => (v ?? "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR")).slice(0, 60);
  return {
    unidadeId: await unidadeDoCadastro(empresaId, os),
    tipos: await tiposParaCadastro(empresaId),
    setores: distintos(daUnidade.map((e) => e.setor)),
    ambientes: distintos(daUnidade.map((e) => e.localizacao)),
  };
}

/** Outros equipamentos da EMPRESA com a mesma série (sem ligar para maiúsculas e espaços nas pontas). */
export async function equipamentosComSerie(empresaId: string, numero: string, ignorarId: string) {
  const n = numero.trim();
  if (n.length < SERIE_MIN) return [];
  const ids = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM equipamentos
    WHERE empresa_id = ${empresaId} AND lower(btrim(numero_serie)) = lower(${n}) AND id <> ${ignorarId}
    LIMIT 10`;
  if (!ids.length) return [];
  return prisma.equipamento.findMany({
    where: { id: { in: ids.map((r) => r.id) } },
    select: {
      id: true, nome: true, tipo: true, capacidade: true, marca: true, modelo: true, ativo: true, setor: true, localizacao: true,
      tipoEquipamento: { select: { nome: true } }, unidade: { select: { nome: true, clienteId: true } },
    },
    orderBy: { criadoEm: "asc" },
  });
}

/** Liga ao equipamento a etiqueta QR que já estava colada nele (lida no app). Só etiqueta AVULSA da empresa. */
async function usarEtiquetaLida(empresaId: string, equipamentoId: string, valorLido: string): Promise<{ codigo: string | null; motivo: string | null }> {
  const valor = valorLido.trim();
  const m = valor.match(/\/qr\/([^/?#\s]+)/);
  const token = m ? m[1] : valor;
  const qr = await prisma.qrcode.findFirst({ where: { empresaId, OR: [{ tokenPublico: token }, { codigo: valor }] }, select: { id: true, codigo: true, equipamentoId: true } });
  if (!qr) return { codigo: null, motivo: "a etiqueta lida não é desta empresa" };
  if (qr.equipamentoId === equipamentoId) return { codigo: qr.codigo, motivo: null };
  if (qr.equipamentoId) return { codigo: null, motivo: `a etiqueta ${qr.codigo} já é de outro equipamento` };
  // Só pega se ainda estiver avulsa (duas leituras ao mesmo tempo: uma ganha, a outra gera um número novo)
  const { count } = await prisma.qrcode.updateMany({ where: { id: qr.id, equipamentoId: null }, data: { equipamentoId } });
  return count ? { codigo: qr.codigo, motivo: null } : { codigo: null, motivo: `a etiqueta ${qr.codigo} já é de outro equipamento` };
}

export interface ResultadoCadastroCampo {
  equipamentoId: string; vinculoId: string;
  /** Código do QR do equipamento (o da etiqueta lida, ou o número gerado) */
  qr: string | null;
  /** Quantos outros equipamentos da empresa já tinham esta série (só aviso) */
  serieRepetida: number;
  jaExistia: boolean;
  /** O que o app mostra ao técnico quando a gravação sobe (série repetida, etiqueta QR recusada) */
  aviso: string | null;
}

/**
 * Cadastra o equipamento na unidade da OS e já o vincula à atividade. NUNCA trava por série repetida
 * nem por problema na etiqueta QR: grava, avisa e deixa registrado no histórico da OS.
 */
export async function cadastrarEquipamentoEmCampo(ctx: ContextoExecucao, d: CadastroEquipamento): Promise<ResultadoAcao<ResultadoCadastroCampo>> {
  const { empresaId } = ctx;
  const os = ctx.atividade.ordemServico;
  const atividadeId = ctx.atividade.id;
  if (!(await carregarConfigApp(empresaId)).cadastrarEquipamento) return erro(403, MSG_CADASTRO_DESLIGADO);

  // Reenvio (o aparelho perdeu a resposta): o equipamento já existe com este id — só garante o vínculo
  const ja = await prisma.equipamento.findUnique({ where: { id: d.id }, select: { empresaId: true, unidade: { select: { clienteId: true } }, qrcode: { select: { codigo: true } } } });
  if (ja) {
    if (ja.empresaId !== empresaId || ja.unidade.clienteId !== os.clienteId) return erro(409, "Identificador de equipamento já usado em outro cadastro.");
    const vinculo = await prisma.atividadeEquipamento.upsert({
      where: { atividadeId_equipamentoId: { atividadeId, equipamentoId: d.id } }, create: { atividadeId, equipamentoId: d.id }, update: {}, select: { id: true },
    });
    return ok({ equipamentoId: d.id, vinculoId: vinculo.id, qr: ja.qrcode?.codigo ?? null, serieRepetida: 0, jaExistia: true, aviso: null });
  }

  const unidadeId = await unidadeDoCadastro(empresaId, os);
  if (!unidadeId) return erro(409, MSG_SEM_UNIDADE);

  // Tipo: só um que JÁ existe e está ativo (criar tipo é do escritório). Mesma resolução do painel.
  const custom = d.tipo.startsWith(PREFIXO_TIPO_CUSTOM) ? d.tipo.slice(PREFIXO_TIPO_CUSTOM.length) : null;
  if (!custom && !(d.tipo in LABELS_TIPO_EQUIPAMENTO)) return erro(400, "Tipo de equipamento não encontrado.");
  const tipo = await resolverTipoEquipamento(empresaId, custom ? "OUTRO" : d.tipo, custom);
  if ("erro" in tipo) return erro(400, tipo.erro);

  const fotos = validarFotos(d.fotos);
  if (!fotos.ok) return erro(400, fotos.erro);

  const numeroSerie = limpo(d.numeroSerie);
  const vinculo = await prisma.$transaction(async (tx) => {
    await tx.equipamento.create({
      data: {
        id: d.id, empresaId, unidadeId, tipo: tipo.tipo as never, tipoEquipamentoId: tipo.tipoEquipamentoId,
        // Marca e modelo são opcionais em campo (nem toda etiqueta está legível): ficam em branco
        marca: limpo(d.marca) ?? "", modelo: limpo(d.modelo) ?? "",
        numeroSerie, capacidade: limpo(d.capacidade), setor: limpo(d.setor), localizacao: limpo(d.ambiente),
        fotos: fotos.fotos, observacoesTecnicas: "Cadastrado em campo, pelo app do colaborador.",
      },
    });
    return tx.atividadeEquipamento.create({ data: { atividadeId, equipamentoId: d.id }, select: { id: true } });
  });

  // QR: a etiqueta que já estava no equipamento, ou um número novo do contador da empresa.
  // Falha aqui não desfaz o cadastro (o escritório gera o QR pela ficha).
  let qr: string | null = null;
  let motivoQr: string | null = null;
  try {
    if (d.qrLido) ({ codigo: qr, motivo: motivoQr } = await usarEtiquetaLida(empresaId, d.id, d.qrLido));
    if (!qr) qr = (await gerarQrCodeEquipamento(empresaId, d.id)).codigo;
  } catch (e) {
    console.error("[cadastro em campo] falha ao definir o QR do equipamento", e);
  }

  // Série: confere contra a EMPRESA inteira (o aparelho, sem sinal, só conferiu o que tinha). Só aviso.
  const repetidos = numeroSerie ? await equipamentosComSerie(empresaId, numeroSerie, d.id) : [];
  const avisos = [
    repetidos.length ? `O nº de série ${numeroSerie} já existia em ${repetidos.length === 1 ? "outro equipamento" : `${repetidos.length} equipamentos`}.` : null,
    motivoQr && qr ? `QR ${qr} gerado: ${motivoQr}.` : null,
  ].filter(Boolean);

  const titulo = apresentarCadastro(d, await tiposParaCadastro(empresaId)).titulo;
  await prisma.osHistorico.create({
    data: {
      ordemServicoId: os.id, usuarioId: ctx.usuarioId, acao: "Equipamento cadastrado em campo",
      detalhes: [`${titulo}${qr ? ` · ${qr}` : ""} (app do técnico)`, ...avisos].join(" "),
    },
  });

  return ok({
    equipamentoId: d.id, vinculoId: vinculo.id, qr, serieRepetida: repetidos.length, jaExistia: false,
    aviso: avisos.length ? `${avisos.join(" ")} Cadastro mantido — o escritório foi avisado.` : null,
  }, 201);
}
