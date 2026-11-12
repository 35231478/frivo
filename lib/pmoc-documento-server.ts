/**
 * PMOC — Etapa 3 (servidor): lê do cadastro o que o documento precisa e gera o PDF; a configuração
 * da empresa; e o histórico do plano. As regras estão em lib/pmoc-documento (o que o documento diz)
 * e lib/pmoc-documento-pdf (como ele é desenhado).
 */
import { randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { dataISO } from "@/lib/pmoc";
import { carregarCronograma } from "@/lib/pmoc-cronograma-server";
import { montarDocumento, type AtividadesDoTipo, type DadosDocumento } from "@/lib/pmoc-documento";
import { gerarPdfDocumento, type ArquivoArt, type DocumentoPdf } from "@/lib/pmoc-documento-pdf";
import { CONFIG_PMOC_PADRAO, type ConfigPmoc } from "@/lib/pmoc-avisos";
import { decodificarDataUrl } from "@/lib/anexos-server";

type Db = Prisma.TransactionClient | typeof prisma;

/* ───────── configuração da empresa ───────── */

export async function configPmoc(empresaId: string, db: Db = prisma): Promise<ConfigPmoc> {
  const c = await db.pmocConfiguracao.findUnique({ where: { empresaId }, select: { diasAviso: true, textoPadrao: true } });
  return c ? { diasAviso: c.diasAviso, textoPadrao: c.textoPadrao } : CONFIG_PMOC_PADRAO;
}

/* ───────── histórico ───────── */

export function registrarHistorico(db: Db, h: { pmocId: string; usuarioId?: string | null; acao: string; detalhes?: string | null }) {
  return db.pmocHistorico.create({ data: { pmocId: h.pmocId, usuarioId: h.usuarioId ?? null, acao: h.acao, detalhes: h.detalhes ?? null } });
}

export interface LinhaHistorico { id: string; acao: string; detalhes: string | null; criadoEm: string; usuario: string | null }
export async function historicoDoPlano(pmocId: string, empresaId: string): Promise<LinhaHistorico[] | null> {
  const p = await prisma.pmoc.findFirst({
    where: { id: pmocId, empresaId },
    select: { historico: { orderBy: [{ criadoEm: "desc" }, { id: "desc" }], take: 200, select: { id: true, acao: true, detalhes: true, criadoEm: true, usuario: { select: { nome: true } } } } },
  });
  return p ? p.historico.map((h) => ({ id: h.id, acao: h.acao, detalhes: h.detalhes, criadoEm: h.criadoEm.toISOString(), usuario: h.usuario?.nome ?? null })) : null;
}

/* ───────── link público ───────── */

/** O token do link público do plano; nasce na primeira vez que alguém envia o documento */
export async function tokenDoPlano(pmocId: string): Promise<string> {
  const atual = await prisma.pmoc.findUnique({ where: { id: pmocId }, select: { tokenPublico: true } });
  if (atual?.tokenPublico) return atual.tokenPublico;
  const novo = randomBytes(24).toString("base64url");
  // Dois envios ao mesmo tempo: só grava se ainda estiver vazio, e devolve o que ficou
  await prisma.pmoc.updateMany({ where: { id: pmocId, tokenPublico: null }, data: { tokenPublico: novo } });
  return (await prisma.pmoc.findUnique({ where: { id: pmocId }, select: { tokenPublico: true } }))!.tokenPublico!;
}

/* ───────── para quem vai ───────── */

export interface DestinoDoCliente { contato: string | null; whatsapp: string | null; email: string | null }
/** O contato principal ativo do cliente; sem ele (ou sem o dado nele), o que está no cadastro do cliente */
export async function destinoDoCliente(clienteId: string, empresaId: string): Promise<DestinoDoCliente> {
  const [contato, cliente] = await Promise.all([
    prisma.contatoCliente.findFirst({ where: { clienteId, empresaId, ativo: true, principal: true }, select: { nome: true, whatsapp: true, telefone: true, email: true } }),
    prisma.cliente.findFirst({ where: { id: clienteId, empresaId }, select: { email: true, celular: true, telefone: true } }),
  ]);
  const limpo = (v: string | null | undefined) => (v ?? "").trim() || null;
  return {
    contato: limpo(contato?.nome),
    whatsapp: limpo(contato?.whatsapp) ?? limpo(contato?.telefone) ?? limpo(cliente?.celular) ?? limpo(cliente?.telefone),
    email: limpo(contato?.email) ?? limpo(cliente?.email),
  };
}

/* ───────── documento ───────── */

export type ReferenciaDoPlano = { id: string; empresaId: string } | { tokenPublico: string };

const SELECT_DOCUMENTO = {
  id: true, empresaId: true, nome: true, descricao: true, status: true, ativo: true, dataInicio: true, dataExpiracao: true,
  rtNome: true, rtCrea: true, artNumero: true, artArquivo: true, artArquivoNome: true,
  cliente: { select: { nome: true, nomeFantasia: true, cpfCnpj: true } },
  unidade: { select: { nome: true, logradouro: true, numero: true, complemento: true, bairro: true, cidade: true, estado: true, cep: true } },
  empresa: { select: { nome: true, nomeFantasia: true, cnpj: true, telefone: true, celular: true, email: true, site: true, endereco: true, cidade: true, estado: true, logo: true } },
  equipamentos: {
    orderBy: { criadoEm: "asc" as const },
    select: { equipamento: { select: {
      id: true, ativo: true, patrimonio: true, nome: true, marca: true, modelo: true, tipo: true, tipoEquipamentoId: true, capacidade: true,
      setor: true, localizacao: true, unidadeId: true, tipoEquipamento: { select: { nome: true } }, unidade: { select: { nome: true } },
    } } },
  },
} satisfies Prisma.PmocSelect;

export interface DocumentoCarregado { pmocId: string; empresaId: string; status: string; ativo: boolean; dados: DadosDocumento; art: ArquivoArt | null }

/** Tudo o que o documento do plano precisa (null = plano não existe para esta referência) */
export async function carregarDocumento(ref: ReferenciaDoPlano, agora: Date = new Date()): Promise<DocumentoCarregado | null> {
  const p = await prisma.pmoc.findFirst({ where: "tokenPublico" in ref ? { tokenPublico: ref.tokenPublico } : { id: ref.id, empresaId: ref.empresaId }, select: SELECT_DOCUMENTO });
  if (!p) return null;
  const cron = await carregarCronograma(prisma, p.id, p.empresaId);
  if (!cron) return null;
  const equipamentos = p.equipamentos.map(({ equipamento: e }) => ({
    id: e.id, ativo: e.ativo, patrimonio: e.patrimonio, nome: e.nome, marca: e.marca, modelo: e.modelo, tipo: e.tipo, tipoEquipamentoId: e.tipoEquipamentoId,
    tipoNome: e.tipoEquipamento?.nome ?? null, capacidade: e.capacidade, setor: e.setor, localizacao: e.localizacao, unidadeId: e.unidadeId, unidadeNome: e.unidade?.nome ?? null,
  }));

  // Atividades: o checklist de cada tipo de equipamento coberto e os formulários ligados aos serviços do plano
  const ativos = equipamentos.filter((e) => e.ativo);
  const enums = [...new Set(ativos.filter((e) => !e.tipoEquipamentoId).map((e) => e.tipo))];
  const idsDiretos = [...new Set(ativos.map((e) => e.tipoEquipamentoId).filter((id): id is string => !!id))];
  const tipos = await prisma.tipoEquipamentoCustom.findMany({
    where: { empresaId: p.empresaId, OR: [{ id: { in: idsDiretos } }, { chaveEnum: { in: enums } }] },
    select: { id: true, nome: true, chaveEnum: true },
  });
  const servicos = [...new Set(cron.estado.itens.filter((i) => i.ativo).map((i) => i.tipoOsId))];
  const idsTipos = tipos.map((t) => t.id);
  const [checklist, formularios, config] = await Promise.all([
    prisma.checklistTipoItem.findMany({ where: { empresaId: p.empresaId, tipoEquipamentoId: { in: idsTipos }, ativo: true }, orderBy: [{ ordem: "asc" }, { criadoEm: "asc" }], select: { tipoEquipamentoId: true, texto: true } }),
    prisma.formTypeMapping.findMany({
      where: { empresaId: p.empresaId, tipoEquipamentoId: { in: idsTipos }, tipoOsId: { in: servicos }, formularioTemplate: { ativo: true } },
      select: { tipoEquipamentoId: true, tipoOsId: true, formularioTemplate: { select: { nome: true, campos: { where: { ativo: true }, orderBy: { ordem: "asc" }, select: { label: true } } } } },
    }),
    configPmoc(p.empresaId),
  ]);
  const atividades: AtividadesDoTipo[] = tipos.map((t) => ({
    tipoEquipamentoId: t.id, nome: t.nome, chaveEnum: t.chaveEnum,
    checklist: checklist.filter((c) => c.tipoEquipamentoId === t.id).map((c) => c.texto),
    formularios: formularios.filter((f) => f.tipoEquipamentoId === t.id).map((f) => ({ tipoOsId: f.tipoOsId, nome: f.formularioTemplate.nome, campos: f.formularioTemplate.campos.map((c) => c.label) })),
  }));

  const bytesArt = p.artArquivo ? decodificarDataUrl(p.artArquivo) : null;
  return {
    pmocId: p.id, empresaId: p.empresaId, status: p.status, ativo: p.ativo,
    dados: {
      empresa: { nome: p.empresa.nomeFantasia ?? p.empresa.nome, cnpj: p.empresa.cnpj, telefone: p.empresa.telefone ?? p.empresa.celular, email: p.empresa.email, site: p.empresa.site, endereco: p.empresa.endereco, cidade: p.empresa.cidade, estado: p.empresa.estado, logo: p.empresa.logo },
      pmoc: { nome: p.nome, descricao: p.descricao, status: p.status, ativo: p.ativo, dataInicio: dataISO(p.dataInicio)!, dataExpiracao: dataISO(p.dataExpiracao)!, rtNome: p.rtNome, rtCrea: p.rtCrea, artNumero: p.artNumero, artArquivoNome: p.artArquivoNome },
      cliente: p.cliente, unidade: p.unidade, equipamentos, estado: cron.estado,
      itens: cron.linhas.map((l) => ({
        id: l.id, tipoOsNome: l.tipoOs.nome, tipoEquipamentoNome: l.tipoEquipamento?.nome ?? null,
        equipamentoRotulo: l.equipamento ? [l.equipamento.patrimonio, l.equipamento.nome || `${l.equipamento.marca} ${l.equipamento.modelo}`.trim()].filter(Boolean).join(" · ") : null,
      })),
      atividades, textoPadrao: config.textoPadrao, geradoEm: agora,
    },
    art: bytesArt?.length ? { nome: p.artArquivoNome, bytes: bytesArt } : null,
  };
}

/** O PDF do documento do plano (null = plano não existe para esta referência) */
export async function gerarDocumento(ref: ReferenciaDoPlano, agora: Date = new Date()): Promise<(DocumentoPdf & { carregado: DocumentoCarregado }) | null> {
  const c = await carregarDocumento(ref, agora);
  if (!c) return null;
  return { ...(await gerarPdfDocumento(montarDocumento(c.dados), c.art)), carregado: c };
}

/** Resposta HTTP com o PDF (inline = abre no navegador; senão, baixa) */
export function respostaPdf(pdf: DocumentoPdf, inline: boolean): Response {
  return new Response(Buffer.from(pdf.bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(pdf.bytes.length),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(pdf.nomeArquivo)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
