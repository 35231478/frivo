/**
 * MÓDULOS DA EMPRESA — a leitura e a escrita do entitlement. As regras são todas puras
 * (./catalogo); aqui só se busca o estado no banco, sempre da empresa certa.
 *
 * O desenho: a VERDADE É O BANCO, não o JWT. As permissões do usuário são congeladas no token
 * no login (auth.config.ts), e isso é bom para elas — mas um módulo desligado tem de valer na
 * hora, para todo mundo, sem esperar ninguém sair e entrar de novo. Como o layout do painel é
 * Server Component e já consulta o banco, ler os módulos ali não custa nada.
 *
 * O CACHE É POR EMPRESA, e isso não é detalhe: um cache global vazaria o módulo de uma empresa
 * para outra — o pior defeito possível num sistema multiempresa. A chave é sempre o empresaId.
 */
import { prisma } from "@/lib/prisma";
import {
  TUDO_LIGADO, dependentesLigados, ehModuloNucleo, empresaTemModulo, moduloCatalogo,
  type ModulosDesligados,
} from "./catalogo";

/** Vida do cache: curta de propósito — desligar um módulo tem de aparecer em segundos. */
const VIDA_MS = 10_000;

const cache = new Map<string, { em: number; desligados: Set<string> }>();

/** Esquece o que foi lido de uma empresa (ou de todas) — chamado ao ligar/desligar. */
export function esquecerModulos(empresaId?: string) {
  if (empresaId) cache.delete(empresaId);
  else cache.clear();
}

/**
 * Os módulos DESLIGADOS da empresa. Conjunto vazio = tudo ligado, que é o estado de quem nunca
 * mexeu em nada (a tabela nasce vazia). Se a leitura falhar, responde "tudo ligado": um banco
 * instável nunca pode esconder o sistema de quem o contratou.
 */
export async function modulosDesligados(empresaId: string): Promise<ModulosDesligados> {
  const agora = Date.now();
  const guardado = cache.get(empresaId);
  if (guardado && agora - guardado.em < VIDA_MS) return guardado.desligados;

  try {
    const linhas = await prisma.empresaModulo.findMany({
      where: { empresaId, ativo: false },
      select: { modulo: true },
    });
    // Núcleo nunca entra: nem uma linha no banco desliga o que o Frivo precisa para existir
    const desligados = new Set(linhas.map((l) => l.modulo).filter((m) => !ehModuloNucleo(m)));
    cache.set(empresaId, { em: agora, desligados });
    return desligados;
  } catch {
    return TUDO_LIGADO;
  }
}

/** A empresa tem este módulo? (núcleo: sempre). */
export async function temModulo(empresaId: string, modulo: string): Promise<boolean> {
  return empresaTemModulo(await modulosDesligados(empresaId), modulo);
}

/** Lê os dois de uma vez quando a tela precisa de vários (uma consulta só). */
export async function mapaDeModulos(empresaId: string, ids: string[]): Promise<Record<string, boolean>> {
  const desligados = await modulosDesligados(empresaId);
  return Object.fromEntries(ids.map((id) => [id, empresaTemModulo(desligados, id)]));
}

/* ───────── ligar e desligar ───────── */

export interface ResultadoModulo {
  ok: boolean;
  erro?: string;
  /** Módulos que foram desligados junto por dependerem deste */
  arrastados?: string[];
}

/**
 * Liga ou desliga um módulo da empresa, com a auditoria de quem mexeu.
 *
 * O que esta função garante:
 *   • núcleo não desliga — nem por chamada direta;
 *   • desligar arrasta quem depende (Compras cai com o Estoque), porque um pedido de compra sem
 *     estoque não tem onde dar entrada;
 *   • ligar exige as dependências ligadas — e avisa qual falta, em vez de ligar pela metade;
 *   • nada é apagado: a linha só diz "ligado/desligado"; os veículos e os pedidos ficam onde estão.
 */
export async function definirModulo(
  empresaId: string, modulo: string, ativo: boolean, usuarioId?: string | null,
): Promise<ResultadoModulo> {
  const def = moduloCatalogo(modulo);
  if (!def) return { ok: false, erro: "Módulo desconhecido." };
  if (def.nucleo) return { ok: false, erro: `${def.nome} faz parte do núcleo do Frivo e não pode ser desligado.` };

  const desligados = await modulosDesligados(empresaId);

  if (ativo) {
    const faltando = (def.dependeDe ?? []).filter((d) => !empresaTemModulo(desligados, d));
    if (faltando.length) {
      const nomes = faltando.map((d) => moduloCatalogo(d)?.nome ?? d).join(", ");
      return { ok: false, erro: `Para ligar ${def.nome}, ligue antes: ${nomes}.` };
    }
  }

  // Desligar leva junto quem depende dele (em cascata)
  const arrastados = ativo ? [] : dependentesLigados(desligados, modulo);
  const alvos = [modulo, ...arrastados];
  const quando = new Date();

  await prisma.$transaction(
    alvos.map((id) =>
      prisma.empresaModulo.upsert({
        where: { empresaId_modulo: { empresaId, modulo: id } },
        create: { empresaId, modulo: id, ativo, alteradoPorId: usuarioId ?? null, alteradoEm: quando },
        update: { ativo, alteradoPorId: usuarioId ?? null, alteradoEm: quando },
      }),
    ),
  );
  esquecerModulos(empresaId);
  return { ok: true, arrastados };
}

/** O estado atual de todos os módulos pedidos, com a auditoria — para a tela de Configurações. */
export async function estadoDosModulos(empresaId: string, ids: string[]) {
  const linhas = await prisma.empresaModulo.findMany({
    where: { empresaId, modulo: { in: ids } },
    select: { modulo: true, ativo: true, alteradoEm: true, alteradoPor: { select: { nome: true } } },
  });
  const por = new Map(linhas.map((l) => [l.modulo, l]));
  return ids.map((id) => {
    const def = moduloCatalogo(id);
    const linha = por.get(id);
    return {
      id,
      nome: def?.nome ?? id,
      descricao: def?.descricao ?? "",
      icone: def?.icone ?? "Package",
      dependeDe: def?.dependeDe ?? [],
      // sem linha = ligado (a regra que faz este recurso não mudar nada para quem não mexeu)
      ativo: linha ? linha.ativo : true,
      alteradoEm: linha?.alteradoEm ?? null,
      alteradoPor: linha?.alteradoPor?.nome ?? null,
    };
  });
}

/* ───────── para as rotinas automáticas ───────── */

/**
 * Das empresas pedidas, as que TÊM o módulo. É o filtro dos crons: a rotina que fatura contrato,
 * cobra boleto ou manda lembrete não roda para quem desligou o módulo — e, quando religar, volta
 * a rodar do ponto em que está, sem gerar retroativo do que não aconteceu enquanto estava fora.
 */
export async function empresasComModulo(empresaIds: string[], modulo: string): Promise<string[]> {
  if (ehModuloNucleo(modulo) || !empresaIds.length) return empresaIds;
  const linhas = await prisma.empresaModulo.findMany({
    where: { empresaId: { in: empresaIds }, modulo, ativo: false },
    select: { empresaId: true },
  });
  const fora = new Set(linhas.map((l) => l.empresaId));
  return empresaIds.filter((id) => !fora.has(id));
}
