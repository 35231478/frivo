/**
 * COMENTÁRIOS NA OS (a conversa da OS no CHAT-1) — lado do banco. Regras puras em lib/tecnico/comentarios.ts e
 * lib/chat/regras.ts; a lista de conversas e o tempo real em lib/chat/servidor.ts.
 *  - técnico (fila do app): `comentarDoApp` (idempotente pelo clientId; o contexto da execução garante que a atividade
 *    é dele); o retrato leva `comentariosDaOs`;
 *  - escritório: `comentariosParaEscritorio` (lê e marca como lido), `comentarDoEscritorio` (também idempotente);
 *  - "lida": `marcarConversaLida` — a leitura da pessoa (os_comentarios_lidos) e o ✓✓ das mensagens dos outros;
 *  - sino: `contarComentariosNovos` (OS com comentário do campo depois da última leitura da pessoa).
 * A foto da mensagem vai em os_comentarios_fotos (validada como os anexos da OS; nunca entra no relatório nem no portal).
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { agendarPush, notificarMensagem } from "@/lib/push/eventos";
import { validarDataUrl } from "@/lib/anexos-server";
import { TIPOS_IMAGEM } from "@/lib/anexos";
import type { ContextoExecucao } from "@/lib/execucao/contexto";
import { atividadesDoTecnico } from "@/lib/tecnico/escopo";
import { lerValorQr } from "@/lib/tecnico/qr-campo";
import { nomeEquipamento } from "@/lib/execucao/vinculos";
import {
  equipamentoEmAndamento, MSG_EQUIPAMENTO_FORA_DA_OS, MSG_FOTO_NAO_ENCONTRADA, MSG_FOTO_SEM_OS, SEM_VINCULO, trilhaDaCorrecao, vinculoDaFoto,
  type OrigemEquipamentoFoto, type QrDaFoto, type VinculoFoto,
} from "@/lib/chat/equipamento-foto";
import {
  DIAS_SINO_COMENTARIOS, FOTO_TAMANHO_MAX, MINIATURA_TAMANHO_MAX, MSG_COMENTARIO_DUPLICADO, osComNovidade, ordenarComentarios,
  type ComentarioTela, type DadosComentario, type OrigemComentario,
} from "@/lib/tecnico/comentarios";
import { lidasPelaResposta, MSG_CITADA_NAO_ENCONTRADA, MSG_OS_CANCELADA, ROTULO_CITACAO_INDISPONIVEL, somenteLeitura, trechoDaCitacao } from "@/lib/chat/regras";
import type { RefCitacao } from "@/lib/tecnico/comentarios";

type Resultado<T> = { ok: true; status: number; dados: T } | { ok: false; status: number; erro: string };

const SELECT_NOME_EQUIP = { id: true, nome: true, marca: true, modelo: true } as const;
type NomeEquip = { id: string; nome: string | null; marca: string; modelo: string };
const equipTela = (e: NomeEquip | null | undefined) => (e ? { id: e.id, titulo: nomeEquipamento(e) } : null);

export const SELECT_MENSAGEM = {
  id: true, clientId: true, texto: true, autorNome: true, origem: true, criadoEm: true, usuarioId: true, lidaEm: true, lidaPorId: true,
  ordemServicoId: true, paraUsuarioId: true,
  atividade: { select: { titulo: true } },
  // A foto: só a miniatura (a inteira, `conteudo`, só ao ampliar) e o equipamento dela
  foto: { select: { id: true, miniatura: true, equipamentoOrigem: true, noRelatorio: true, equipamento: { select: SELECT_NOME_EQUIP }, equipamentoSugerido: { select: SELECT_NOME_EQUIP } } },
  ordemServico: { select: { id: true, numero: true, cliente: { select: { nome: true, nomeFantasia: true } } } },
  respostaA: { select: { id: true, clientId: true, autorNome: true, texto: true, usuarioId: true, foto: { select: { miniatura: true } } } },
} as const;
type Linha = {
  id: string; clientId: string | null; texto: string; autorNome: string; origem: string; criadoEm: Date; usuarioId: string;
  lidaEm?: Date | null; lidaPorId?: string | null; atividade?: { titulo: string } | null;
  foto?: { id: string; miniatura: string; equipamentoOrigem?: string | null; noRelatorio?: boolean; equipamento?: NomeEquip | null; equipamentoSugerido?: NomeEquip | null } | null;
  paraUsuarioId?: string | null;
  ordemServico?: { id: string; numero: string; cliente: { nome: string; nomeFantasia: string | null } | null } | null;
  respostaA?: { id: string; clientId: string | null; autorNome: string; texto: string; usuarioId: string; foto: { miniatura: string } | null } | null;
};

/** Como a mensagem sai para a tela. `nomes` traduz quem leu e o destinatário (id → nome). */
export const apresentar = (c: Linha, usuarioId: string, nomes: Map<string, string> = new Map()): ComentarioTela => ({
  id: c.id, clientId: c.clientId, texto: c.texto, autor: c.autorNome, origem: c.origem as OrigemComentario, criadoEm: c.criadoEm.toISOString(), meu: c.usuarioId === usuarioId,
  atividade: c.atividade?.titulo ?? null,
  foto: c.foto ? {
    id: c.foto.id, miniatura: c.foto.miniatura, equipamento: equipTela(c.foto.equipamento), origemEquipamento: (c.foto.equipamentoOrigem ?? null) as OrigemEquipamentoFoto | null,
    sugerido: equipTela(c.foto.equipamentoSugerido), noRelatorio: !!c.foto.noRelatorio,
  } : null,
  lida: c.lidaEm ? { por: (c.lidaPorId && nomes.get(c.lidaPorId)) || "Alguém", em: c.lidaEm.toISOString() } : null,
  os: c.ordemServico ? { id: c.ordemServico.id, numero: c.ordemServico.numero, cliente: (c.ordemServico.cliente?.nomeFantasia || c.ordemServico.cliente?.nome || "").trim() } : null,
  para: c.paraUsuarioId ? nomes.get(c.paraUsuarioId) ?? "Técnico" : null,
  respostaA: c.respostaA ? {
    id: c.respostaA.id, clientId: c.respostaA.clientId, autor: c.respostaA.autorNome, meu: c.respostaA.usuarioId === usuarioId,
    texto: trechoDaCitacao(c.respostaA.texto, !!c.respostaA.foto), miniatura: c.respostaA.foto?.miniatura ?? null,
  } : null,
});

// ── Quem vê o quê (a conversa do técnico) — aqui para a gravação conferir a citada sem depender das telas ───────────

/**
 * A conversa do técnico T (o usuário U dele): o que ele escreveu, o que o escritório escreveu PARA ele e o que o
 * escritório escreveu sem destinatário numa OS em que ele tem atividade (= para todos os técnicos da OS).
 */
export const ondeConversaDoTecnico = (usuarioId: string, tecnicoId: string | null): Prisma.OsComentarioWhereInput => ({
  OR: [
    { usuarioId },
    { paraUsuarioId: usuarioId },
    ...(tecnicoId ? [{ paraUsuarioId: null, origem: "ESCRITORIO", ordemServico: { atividades: { some: atividadesDoTecnico(tecnicoId) } } }] : []),
  ],
});

/** O que o técnico vê: a conversa dele e as mensagens das OS em que tem atividade. */
export const ondeTecnicoVe = (usuarioId: string, tecnicoId: string | null): Prisma.OsComentarioWhereInput => ({
  OR: [ondeConversaDoTecnico(usuarioId, tecnicoId), ...(tecnicoId ? [{ ordemServico: { atividades: { some: atividadesDoTecnico(tecnicoId) } } }] : [])],
});

/**
 * A citada que quem VÊ não pode ver (outra OS, fora do escopo dele) aparece sem o conteúdo: "Mensagem indisponível".
 * Uma consulta para a conversa toda.
 */
export async function protegerCitacoes(empresaId: string, mensagens: ComentarioTela[], visivel: Prisma.OsComentarioWhereInput): Promise<ComentarioTela[]> {
  const ids = [...new Set(mensagens.map((m) => m.respostaA?.id).filter((x): x is string => !!x))];
  if (!ids.length) return mensagens;
  const ve = new Set((await prisma.osComentario.findMany({ where: { AND: [{ empresaId, id: { in: ids } }, visivel] }, select: { id: true } })).map((m) => m.id));
  return mensagens.map((m) => (m.respostaA?.id && !ve.has(m.respostaA.id)
    ? { ...m, respostaA: { id: null, clientId: null, autor: "", meu: false, texto: ROTULO_CITACAO_INDISPONIVEL, miniatura: null, indisponivel: true } }
    : m));
}

/**
 * A citada da resposta: só uma mensagem que quem responde pode citar (`citavel`: a mesma conversa/OS, a mesma
 * empresa). Pelo clientId e ainda inexistente no servidor: a citada nunca subiu (recusada ou descartada no aparelho) —
 * a resposta grava sem a citação, para não travar a fila.
 */
async function resolverCitada(empresaId: string, ref: RefCitacao, citavel: Prisma.OsComentarioWhereInput): Promise<{ ok: true; id: string | null } | { ok: false }> {
  const chave = ref.id ? { id: ref.id } : { clientId: ref.clientId! };
  const achada = await prisma.osComentario.findFirst({ where: { AND: [{ empresaId }, chave, citavel] }, select: { id: true } });
  if (achada) return { ok: true, id: achada.id };
  if (ref.clientId && !(await prisma.osComentario.findFirst({ where: { empresaId, clientId: ref.clientId }, select: { id: true } }))) return { ok: true, id: null };
  return { ok: false };
}

/** Os nomes de quem leu e dos destinatários (uma consulta para a conversa toda). */
export async function nomesDeQuemLeu(empresaId: string, linhas: Linha[]): Promise<Map<string, string>> {
  const ids = [...new Set(linhas.flatMap((l) => [l.lidaPorId, l.paraUsuarioId]).filter((x): x is string => !!x))];
  if (!ids.length) return new Map();
  const us = await prisma.usuario.findMany({ where: { empresaId, id: { in: ids } }, select: { id: true, nome: true } });
  return new Map(us.map((u) => [u.id, (u.nome ?? "").trim() || "Usuário"]));
}

async function nomeDe(empresaId: string, usuarioId: string) {
  const u = await prisma.usuario.findFirst({ where: { id: usuarioId, empresaId }, select: { nome: true } });
  return (u?.nome ?? "").trim() || "Usuário";
}

/** A foto e a miniatura (já reduzidas no aparelho), conferidas pelo conteúdo como os anexos da OS. */
function validarFoto(d: DadosComentario): { ok: true; foto: { tipo: string; tamanho: number; conteudo: string; miniatura: string } | null } | { ok: false; erro: string } {
  if (!d.foto || !d.miniatura) return { ok: true, foto: null };
  const opts = { tipos: TIPOS_IMAGEM, mensagemTipo: "Envie uma foto (JPG, PNG ou WEBP)." };
  const f = validarDataUrl(d.foto, "foto.jpg", { ...opts, tamanhoMax: FOTO_TAMANHO_MAX });
  if (!f.ok) return f;
  const m = validarDataUrl(d.miniatura, "miniatura.jpg", { ...opts, tamanhoMax: MINIATURA_TAMANHO_MAX });
  if (!m.ok) return m;
  return { ok: true, foto: { tipo: f.arquivo.tipo, tamanho: f.arquivo.tamanho, conteudo: f.arquivo.conteudo, miniatura: m.arquivo.conteudo } };
}

/** Os ids dos equipamentos DA OS: os das atividades dela e o principal (o mesmo critério da galeria da OS). */
export async function idsEquipamentosDaOs(empresaId: string, osId: string): Promise<string[]> {
  const [os, vinculos] = await Promise.all([
    prisma.ordemServico.findFirst({ where: { id: osId, empresaId }, select: { equipamentoId: true } }),
    prisma.atividadeEquipamento.findMany({ where: { atividade: { ordemServicoId: osId, empresaId } }, orderBy: [{ criadoEm: "asc" }, { id: "asc" }], select: { equipamentoId: true } }),
  ]);
  return [...new Set([...vinculos.map((v) => v.equipamentoId), ...(os?.equipamentoId ? [os.equipamentoId] : [])])];
}

/** O QR lido na foto, na empresa de quem envia: o equipamento e se é do mesmo cliente da OS (e ativo). De outra empresa: nada. */
async function qrDaFoto(empresaId: string, valor: string, clienteDaOs: string): Promise<QrDaFoto | null> {
  const { token, codigo } = lerValorQr(valor);
  const q = await prisma.qrcode.findFirst({
    where: { empresaId, OR: [{ tokenPublico: token }, { codigo }] },
    select: { equipamento: { select: { id: true, empresaId: true, ativo: true, unidade: { select: { clienteId: true } } } } },
  });
  const e = q?.equipamento;
  if (!e || e.empresaId !== empresaId) return null;
  return { equipamentoId: e.id, mesmoCliente: e.ativo && e.unidade?.clienteId === clienteDaOs };
}

/** CHAT-1.1: o equipamento da foto na hora de gravar (as regras em lib/chat/equipamento-foto). */
async function vinculoNaGravacao(a: { empresaId: string; osId: string | null; origem: OrigemComentario; tecnicoId?: string | null; d: DadosComentario }): Promise<VinculoFoto> {
  const { empresaId, osId, d } = a;
  if (!osId || !d.foto) return SEM_VINCULO;
  const [ids, os] = await Promise.all([idsEquipamentosDaOs(empresaId, osId), prisma.ordemServico.findFirst({ where: { id: osId, empresaId }, select: { clienteId: true } })]);
  let emAndamento: string | null = null;
  let qr: QrDaFoto | null = null;
  if (a.origem === "APP") {
    if (a.tecnicoId) {
      const vs = await prisma.atividadeEquipamento.findMany({
        where: { atividade: { ordemServicoId: osId, empresaId, status: "EM_ANDAMENTO", ...atividadesDoTecnico(a.tecnicoId) } }, select: { equipamentoId: true, feito: true },
      });
      emAndamento = equipamentoEmAndamento(vs);
    }
    if (d.qr && os) qr = await qrDaFoto(empresaId, d.qr, os.clienteId);
  }
  return vinculoDaFoto({ origem: a.origem, temOs: true, equipamentosDaOs: ids, emAndamento, qr, escolha: d.equipamentoId });
}

/**
 * Grava a mensagem (com a foto, se houver) — o mesmo caminho para o app e o escritório. A mesma gravação reenviada (o
 * clientId) devolve a primeira; o clientId usado em outra OS ou por outra pessoa é recusado.
 */
async function gravar(a: {
  empresaId: string; osId: string | null; usuarioId: string; origem: OrigemComentario; atividadeId: string | null; paraUsuarioId?: string | null; d: DadosComentario;
  /** O que quem escreve pode citar (a mesma conversa/OS) */
  citavel: Prisma.OsComentarioWhereInput;
  /** O técnico que escreve pelo app (a atividade em andamento dele decide o equipamento da foto) */
  tecnicoId?: string | null;
}):
  Promise<Resultado<{ comentario: ComentarioTela }>> {
  const { empresaId, osId, usuarioId, d } = a;
  const paraUsuarioId = a.paraUsuarioId ?? null;
  const buscar = () => prisma.osComentario.findUnique({ where: { empresaId_clientId: { empresaId, clientId: d.clientId } }, select: { ...SELECT_MENSAGEM, ordemServicoId: true } });
  const ja = await buscar();
  if (ja) {
    if (ja.ordemServicoId !== osId || ja.usuarioId !== usuarioId) return { ok: false, status: 409, erro: MSG_COMENTARIO_DUPLICADO };
    return { ok: true, status: 200, dados: { comentario: apresentar(ja, usuarioId) } };
  }
  if (osId) {
    const os = await prisma.ordemServico.findFirst({ where: { id: osId, empresaId }, select: { status: true } });
    if (!os) return { ok: false, status: 404, erro: "OS não encontrada" };
    if (somenteLeitura(os.status)) return { ok: false, status: 409, erro: MSG_OS_CANCELADA };
  }
  const foto = validarFoto(d);
  if (!foto.ok) return { ok: false, status: 400, erro: foto.erro };
  let respostaAId: string | null = null;
  if (d.respostaA) {
    const r = await resolverCitada(empresaId, d.respostaA, a.citavel);
    if (!r.ok) return { ok: false, status: 404, erro: MSG_CITADA_NAO_ENCONTRADA };
    respostaAId = r.id;
  }
  const vinculo = foto.foto ? await vinculoNaGravacao(a) : SEM_VINCULO;
  try {
    // A hora é a do servidor: é ela que ordena a conversa entre o app e o escritório
    const c = await prisma.osComentario.create({
      data: {
        empresaId, ordemServicoId: osId, atividadeId: a.atividadeId, usuarioId, autorNome: await nomeDe(empresaId, usuarioId), origem: a.origem,
        texto: d.texto.trim(), clientId: d.clientId, paraUsuarioId, respostaAId,
        ...(foto.foto && { foto: { create: {
          empresaId, ...foto.foto, equipamentoId: vinculo.equipamentoId, equipamentoOrigem: vinculo.origem, equipamentoSugeridoId: vinculo.sugeridoId,
        } } }),
      },
      select: SELECT_MENSAGEM,
    });
    // Push: com OS e sem destinatário, os técnicos da OS e o escritório ligado a ela; para uma pessoa, só ela; do técnico
    // sem OS, o escritório que conversa com ele (menos o autor) — depois da resposta
    agendarPush(() => notificarMensagem({ empresaId, comentarioId: c.id, osId, autorId: usuarioId, paraUsuarioId, origem: a.origem, texto: c.texto || (c.foto ? "Foto" : "") }));
    // Quem escreveu leu tudo até aqui: a OS e a conversa da pessoa (a do técnico; a do destinatário, no escritório)
    if (osId) await marcarConversaLida(empresaId, osId, usuarioId, c.criadoEm);
    const conversa = a.origem === "APP" ? usuarioId : paraUsuarioId;
    if (conversa) await marcarLeituraDaPessoa(usuarioId, conversa, c.criadoEm);
    return { ok: true, status: 201, dados: { comentario: apresentar(c, usuarioId, await nomesDeQuemLeu(empresaId, [c])) } };
  } catch (e) {
    // Dois envios simultâneos da mesma gravação: o segundo perde na chave única e devolve o primeiro
    if ((e as { code?: string })?.code === "P2002") {
      const c = await buscar();
      if (c && c.ordemServicoId === osId && c.usuarioId === usuarioId) return { ok: true, status: 200, dados: { comentario: apresentar(c, usuarioId) } };
    }
    throw e;
  }
}

/** O técnico escreve pela fila do app (texto e/ou foto). A mesma gravação reenviada não duplica. */
export async function comentarDoApp(ctx: ContextoExecucao, d: DadosComentario): Promise<Resultado<{ comentario: ComentarioTela }>> {
  return gravar({ empresaId: ctx.empresaId, osId: ctx.atividade.ordemServico.id, usuarioId: ctx.usuarioId, origem: "APP", atividadeId: ctx.atividade.id, d,
    citavel: ondeTecnicoVe(ctx.usuarioId, ctx.escopo.tecnicoId), tecnicoId: ctx.escopo.tecnicoId });
}

/** O técnico escreve SEM OS ("chego em 10 minutos") pela fila do app: só na conversa dele com o escritório. */
export async function comentarSemOsDoApp(ator: { empresaId: string; usuarioId: string; escopo?: { tecnicoId: string | null } }, d: DadosComentario): Promise<Resultado<{ comentario: ComentarioTela }>> {
  return gravar({ empresaId: ator.empresaId, osId: null, usuarioId: ator.usuarioId, origem: "APP", atividadeId: null, d, citavel: ondeTecnicoVe(ator.usuarioId, ator.escopo?.tecnicoId ?? null) });
}

/**
 * O escritório escreve para UMA pessoa (a conversa dela), com ou sem OS: só ela recebe; na OS aparece "para Fulano".
 * `citavel`: a conversa da pessoa, no que quem escreve pode ver (montado pela rota).
 */
export async function comentarParaPessoa(empresaId: string, usuarioId: string, paraUsuarioId: string, osId: string | null, d: DadosComentario, citavel: Prisma.OsComentarioWhereInput): Promise<Resultado<{ comentario: ComentarioTela }>> {
  return gravar({ empresaId, osId, usuarioId, origem: "ESCRITORIO", atividadeId: null, paraUsuarioId, d, citavel });
}

// ── CHAT-1.1: corrigir o equipamento da foto e pôr no relatório (a mensagem não muda; a trilha fica no histórico da OS) ──

const SELECT_FOTO_DA_MENSAGEM = {
  id: true, ordemServicoId: true, autorNome: true, criadoEm: true, ordemServico: { select: { status: true } },
  foto: { select: { id: true, equipamentoId: true, noRelatorio: true, equipamento: { select: SELECT_NOME_EQUIP } } },
} as const;

/** A mensagem com foto que quem corrige pode ver (pelo id, ou pelo clientId se ainda há pouco estava na fila). */
async function fotoParaCorrigir(empresaId: string, ref: RefCitacao, podeVer: Prisma.OsComentarioWhereInput, osId?: string) {
  const chave = ref.id ? { id: ref.id } : { clientId: ref.clientId! };
  const m = await prisma.osComentario.findFirst({ where: { AND: [{ empresaId }, chave, podeVer, { foto: { isNot: null } }] }, select: SELECT_FOTO_DA_MENSAGEM });
  if (!m?.foto || (osId && m.ordemServicoId !== osId)) return { ok: false as const, status: 404, erro: MSG_FOTO_NAO_ENCONTRADA };
  if (!m.ordemServicoId) return { ok: false as const, status: 409, erro: MSG_FOTO_SEM_OS };
  if (somenteLeitura(m.ordemServico?.status)) return { ok: false as const, status: 409, erro: MSG_OS_CANCELADA };
  return { ok: true as const, m: { ...m, ordemServicoId: m.ordemServicoId, foto: m.foto } };
}

const deQuem = (m: { autorNome: string; criadoEm: Date }) => `foto de ${m.autorNome}, ${m.criadoEm.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" })}`;

async function mensagemApresentada(empresaId: string, id: string, usuarioId: string): Promise<ComentarioTela> {
  const c = await prisma.osComentario.findFirstOrThrow({ where: { id, empresaId }, select: SELECT_MENSAGEM });
  return apresentar(c, usuarioId, await nomesDeQuemLeu(empresaId, [c]));
}

/**
 * Corrige (ou tira) o equipamento da foto: só um equipamento DESTA OS, ou nenhum. O mesmo valor de novo não muda nada
 * (idempotente: a fila do app pode reenviar). Cada mudança fica no histórico da OS (de → para, quem, de qual foto).
 */
export async function corrigirEquipamentoDaFoto(a: {
  empresaId: string; usuarioId: string; ref: RefCitacao; equipamentoId: string | null; podeVer: Prisma.OsComentarioWhereInput; osId?: string; doApp: boolean;
}): Promise<Resultado<{ comentario: ComentarioTela }>> {
  const r = await fotoParaCorrigir(a.empresaId, a.ref, a.podeVer, a.osId);
  if (!r.ok) return r;
  const { m } = r;
  let para: NomeEquip | null = null;
  if (a.equipamentoId) {
    if (!(await idsEquipamentosDaOs(a.empresaId, m.ordemServicoId)).includes(a.equipamentoId)) return { ok: false, status: 422, erro: MSG_EQUIPAMENTO_FORA_DA_OS };
    para = await prisma.equipamento.findFirst({ where: { id: a.equipamentoId, empresaId: a.empresaId }, select: SELECT_NOME_EQUIP });
    if (!para) return { ok: false, status: 422, erro: MSG_EQUIPAMENTO_FORA_DA_OS };
  }
  const de = m.foto.equipamento;
  const trilha = trilhaDaCorrecao(de ? { id: de.id, nome: nomeEquipamento(de) } : null, para ? { id: para.id, nome: nomeEquipamento(para) } : null);
  if (trilha) {
    await prisma.$transaction([
      prisma.osComentarioFoto.update({ where: { id: m.foto.id }, data: { equipamentoId: para?.id ?? null, equipamentoOrigem: "CORRIGIDO" } }),
      prisma.osHistorico.create({ data: {
        ordemServicoId: m.ordemServicoId, usuarioId: a.usuarioId, acao: trilha.acao,
        detalhes: `${trilha.detalhes} (${deQuem(m)})${a.doApp ? " (app do técnico)" : ""}`.slice(0, 1000),
      } }),
    ]);
  }
  return { ok: true, status: 200, dados: { comentario: await mensagemApresentada(a.empresaId, m.id, a.usuarioId) } };
}

/**
 * O escritório põe (ou tira) a foto do relatório da atividade: por REFERÊNCIA (o relatório lê a foto daqui; nada é
 * copiado). O chat é interno: por padrão, fora. Registrado no histórico da OS.
 */
export async function fotoNoRelatorio(a: { empresaId: string; usuarioId: string; comentarioId: string; noRelatorio: boolean; podeVer: Prisma.OsComentarioWhereInput }):
  Promise<Resultado<{ comentario: ComentarioTela }>> {
  const r = await fotoParaCorrigir(a.empresaId, { id: a.comentarioId }, a.podeVer);
  if (!r.ok) return r;
  const { m } = r;
  if (m.foto.noRelatorio !== a.noRelatorio) {
    await prisma.$transaction([
      prisma.osComentarioFoto.update({ where: { id: m.foto.id }, data: { noRelatorio: a.noRelatorio } }),
      prisma.osHistorico.create({ data: {
        ordemServicoId: m.ordemServicoId, usuarioId: a.usuarioId,
        acao: a.noRelatorio ? "Foto do chat incluída no relatório" : "Foto do chat retirada do relatório", detalhes: deQuem(m),
      } }),
    ]);
  }
  return { ok: true, status: 200, dados: { comentario: await mensagemApresentada(a.empresaId, m.id, a.usuarioId) } };
}

/** Até quando `usuarioId` leu a conversa do técnico `conversaUsuarioId` (o contador por pessoa). */
export async function marcarLeituraDaPessoa(usuarioId: string, conversaUsuarioId: string, agora: Date = new Date()) {
  await prisma.conversaLeitura.upsert({
    where: { usuarioId_conversaUsuarioId: { usuarioId, conversaUsuarioId } },
    create: { usuarioId, conversaUsuarioId, lidoEm: agora }, update: { lidoEm: agora },
  });
}

/** O escritório escreve na conversa da OS (texto e/ou foto); idempotente pelo clientId como o app. */
export async function comentarDoEscritorio(empresaId: string, osId: string, usuarioId: string, d: DadosComentario): Promise<Resultado<{ comentario: ComentarioTela }>> {
  // Pela OS: cita só mensagem da mesma OS
  return gravar({ empresaId, osId, usuarioId, origem: "ESCRITORIO", atividadeId: null, d, citavel: { ordemServicoId: osId } });
}

/** Quantas mensagens uma conversa traz (as mais recentes) e, ao ir até uma citada antiga, no máximo quantas */
export const LIMITE_MENSAGENS_OS = 500;
export const LIMITE_ATE_CITADA = 2_000;

/**
 * As mensagens de uma conversa (um filtro de os_comentarios): as mais recentes, mais antiga primeiro. `ate`: o id de
 * uma mensagem antiga (a citada que a tela quer mostrar) — traz desde ela, até LIMITE_ATE_CITADA. A citação que quem
 * vê não pode ver sai sem o conteúdo (`visivel`).
 */
export async function mensagensDaConversa(empresaId: string, onde: Prisma.OsComentarioWhereInput, usuarioId: string,
  op: { limite: number; ate?: string | null; visivel: Prisma.OsComentarioWhereInput }): Promise<ComentarioTela[]> {
  const where: Prisma.OsComentarioWhereInput = { AND: [{ empresaId }, onde] };
  let take = op.limite;
  if (op.ate) {
    const citada = await prisma.osComentario.findFirst({ where: { AND: [where, { id: op.ate }] }, select: { criadoEm: true } });
    if (citada) take = Math.min(LIMITE_ATE_CITADA, Math.max(take, await prisma.osComentario.count({ where: { AND: [where, { criadoEm: { gte: citada.criadoEm } }] } })));
  }
  // O id desempata mensagens do mesmo instante (sem isso a ordem delas mudava conforme o banco regravava as linhas)
  const linhas = await prisma.osComentario.findMany({ where, orderBy: [{ criadoEm: "desc" }, { id: "desc" }], take, select: SELECT_MENSAGEM });
  linhas.reverse();
  const nomes = await nomesDeQuemLeu(empresaId, linhas);
  return protegerCitacoes(empresaId, linhas.map((c) => apresentar(c, usuarioId, nomes)), op.visivel);
}

/**
 * As mensagens da OS (o retrato do app, o card da OS e o chat), mais antiga primeiro. A citação aparece igual; a de
 * outra conversa só se quem vê pode vê-la (`visivel`; sem ele, só as da mesma OS).
 */
export async function comentariosDaOs(empresaId: string, osId: string, usuarioId: string, op: { ate?: string | null; visivel?: Prisma.OsComentarioWhereInput } = {}): Promise<ComentarioTela[]> {
  return ordenarComentarios(await mensagensDaConversa(empresaId, { ordemServicoId: osId }, usuarioId,
    { limite: LIMITE_MENSAGENS_OS, ate: op.ate, visivel: op.visivel ?? { ordemServicoId: osId } }));
}

/**
 * A pessoa leu a conversa até `agora`: avança a leitura dela (os_comentarios_lidos — o contador de não lidas e o sino)
 * e marca o ✓✓ das mensagens dos OUTROS que ainda não tinham sido lidas por ninguém (a 1ª leitura fica: quem e quando).
 */
export async function marcarConversaLida(empresaId: string, osId: string, usuarioId: string, agora: Date = new Date()) {
  // Só avança a leitura quando chegou mensagem desde a última: reler sem novidade não muda nada (a marca do tempo real
  // inclui a leitura de quem pergunta — avançar sempre faria a tela reler em laço)
  const antes = await prisma.osComentarioLeitura.findUnique({ where: { usuarioId_ordemServicoId: { usuarioId, ordemServicoId: osId } }, select: { lidoEm: true } });
  const novidade = !antes || !!(await prisma.osComentario.findFirst({ where: { empresaId, ordemServicoId: osId, criadoEm: { gt: antes.lidoEm, lte: agora } }, select: { id: true } }));
  if (novidade) {
    await prisma.osComentarioLeitura.upsert({
      where: { usuarioId_ordemServicoId: { usuarioId, ordemServicoId: osId } },
      create: { usuarioId, ordemServicoId: osId, lidoEm: agora },
      update: { lidoEm: agora },
    });
  }
  // O ✓✓ só toca o que ainda não foi lido por ninguém: sem nada a marcar, não muda nada
  await prisma.osComentario.updateMany({
    where: { empresaId, ordemServicoId: osId, usuarioId: { not: usuarioId }, lidaEm: null, criadoEm: { lte: agora } },
    data: { lidaEm: agora, lidaPorId: usuarioId },
  });
}

/**
 * Responder é ler, para trás: na conversa (`onde`), as mensagens sem ✓✓ que o outro lado respondeu depois ficam lidas
 * por quem respondeu, na hora da resposta (lidasPelaResposta). Roda ao abrir a conversa; sem nada pendente, uma consulta.
 */
export async function marcarRespondidas(empresaId: string, onde: Prisma.OsComentarioWhereInput) {
  const where: Prisma.OsComentarioWhereInput = { AND: [{ empresaId }, onde] };
  const primeira = await prisma.osComentario.findFirst({ where: { AND: [where, { lidaEm: null }] }, orderBy: { criadoEm: "asc" }, select: { criadoEm: true } });
  if (!primeira) return;
  const msgs = await prisma.osComentario.findMany({
    where: { AND: [where, { criadoEm: { gte: primeira.criadoEm } }] }, orderBy: { criadoEm: "asc" }, take: 2000,
    select: { id: true, origem: true, usuarioId: true, criadoEm: true, lidaEm: true },
  });
  for (const g of lidasPelaResposta(msgs)) {
    await prisma.osComentario.updateMany({ where: { id: { in: g.ids }, lidaEm: null }, data: { lidaEm: g.lidaEm, lidaPorId: g.lidaPorId } });
  }
}

/** Escritório abre a conversa: lê as mensagens e marca como lidas até agora (o sino e o contador apagam para esta pessoa). */
export async function comentariosParaEscritorio(empresaId: string, osId: string, usuarioId: string, agora: Date = new Date(),
  op: { ate?: string | null; visivel?: Prisma.OsComentarioWhereInput } = {}): Promise<ComentarioTela[] | null> {
  const os = await prisma.ordemServico.findFirst({ where: { id: osId, empresaId }, select: { id: true } });
  if (!os) return null;
  const leitura = await prisma.osComentarioLeitura.findUnique({ where: { usuarioId_ordemServicoId: { usuarioId, ordemServicoId: osId } }, select: { lidoEm: true } });
  // "novo": de outra pessoa, depois da última vez que esta pessoa leu (nunca leu: todos os dos outros)
  const desde = leitura?.lidoEm?.toISOString() ?? null;
  await marcarRespondidas(empresaId, { ordemServicoId: osId });
  await marcarConversaLida(empresaId, osId, usuarioId, agora);
  // TODAS as mensagens da OS, de todas as atividades (a do app vem com a atividade de onde foi escrita), já com o ✓✓
  const todos = await comentariosDaOs(empresaId, osId, usuarioId, op);
  return todos.map((c) => ({ ...c, novo: !c.meu && (!desde || c.criadoEm > desde) }));
}

/** A foto inteira de uma mensagem (para ampliar), só de OS da empresa. Quem pode ver a conversa é conferido na rota. */
export async function fotoDaMensagem(empresaId: string, fotoId: string): Promise<{ comentarioId: string; conteudo: string } | null> {
  const f = await prisma.osComentarioFoto.findFirst({ where: { id: fotoId, empresaId }, select: { conteudo: true, comentario: { select: { id: true } } } });
  return f ? { comentarioId: f.comentario.id, conteudo: f.conteudo } : null;
}

/** Sino: OS com comentário do campo que esta pessoa ainda não leu (janela de DIAS_SINO_COMENTARIOS). */
export async function contarComentariosNovos(empresaId: string, usuarioId: string, agora: Date = new Date()): Promise<{ comentariosCampo: number; comentarioCampoOsId: string | null }> {
  const desde = new Date(agora.getTime() - DIAS_SINO_COMENTARIOS * 86_400_000);
  const grupos = await prisma.osComentario.groupBy({ by: ["ordemServicoId"], where: { empresaId, origem: "APP", ordemServicoId: { not: null }, criadoEm: { gte: desde } }, _max: { criadoEm: true } });
  const ultimos = grupos.filter((u): u is typeof u & { ordemServicoId: string } => !!u.ordemServicoId);
  if (!ultimos.length) return { comentariosCampo: 0, comentarioCampoOsId: null };
  const lidos = await prisma.osComentarioLeitura.findMany({ where: { usuarioId, ordemServicoId: { in: ultimos.map((u) => u.ordemServicoId) } }, select: { ordemServicoId: true, lidoEm: true } });
  const novas = osComNovidade(new Map(ultimos.map((u) => [u.ordemServicoId, u._max.criadoEm!])), new Map(lidos.map((l) => [l.ordemServicoId, l.lidoEm])));
  return { comentariosCampo: novas.length, comentarioCampoOsId: novas[0] ?? null };
}
