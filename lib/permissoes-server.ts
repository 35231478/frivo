import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { pode, type Acao, type Permissoes } from "@/lib/permissoes";
import { MSG_MODULO_DESLIGADO, moduloDaPermissao } from "@/lib/modulos/catalogo";
import { temModulo } from "@/lib/modulos/servidor";

/**
 * O módulo de produto está desligado para esta empresa? Devolve a resposta pronta (403) ou null.
 *
 * É a 3ª camada de acesso, ACIMA do RBAC: a EMPRESA tem o módulo × o USUÁRIO pode a ação. Só vai
 * ao banco quando a permissão pedida pertence a um módulo com o gate já migrado (hoje: Frota e
 * Compras) — para as outras centenas de rotas, `moduloDaPermissao` devolve null e nada muda,
 * nem em comportamento nem em consulta.
 *
 * ATENÇÃO ao que esta função NÃO é: ela recusa o PEDIDO DIRETO a um módulo desligado. Onde o
 * núcleo apenas ENCOSTA num módulo opcional (a OS que baixa material do estoque), a regra é
 * outra e mora no servidor do próprio fluxo: `if (tem(modulo))`, nunca 403 — concluir uma OS não
 * pode falhar porque a empresa desligou o Estoque.
 */
async function moduloBarra(empresaId: string | undefined, modulo: string, acao: Acao) {
  const id = moduloDaPermissao(modulo, acao);
  if (!id || !empresaId) return null;
  if (await temModulo(empresaId, id)) return null;
  return NextResponse.json({ erro: MSG_MODULO_DESLIGADO(id), modulo: id }, { status: 403 });
}

/**
 * Guarda de permissão para route handlers. Use no início da API:
 *
 *   const guard = await exigirPermissao("clientes", "criar");
 *   if (guard.erro) return guard.resposta;
 *   const { session } = guard;
 *
 * Libera automaticamente o administrador master (role ADMIN) — mas nem ele passa por um módulo
 * que a empresa desligou: permissão é do usuário, módulo é da empresa.
 */
export async function exigirPermissao(modulo: string, acao: Acao = "visualizar") {
  const session = await auth();
  if (!session) {
    return { erro: true as const, resposta: NextResponse.json({ erro: "Não autorizado" }, { status: 401 }) };
  }
  const user = session.user;
  if (!pode(user.permissoes as Permissoes, modulo, acao, user.role)) {
    return { erro: true as const, resposta: NextResponse.json({ erro: "Sem permissão para esta ação" }, { status: 403 }) };
  }
  const barrado = await moduloBarra((user as any).empresaId, modulo, acao);
  if (barrado) return { erro: true as const, resposta: barrado };
  return { erro: false as const, session };
}

/**
 * Como `exigirPermissao`, mas libera se o usuário tiver QUALQUER uma das permissões.
 * Ex.: execução de atividade em campo aceita "editar" ou "concluir" OS.
 */
export async function exigirAlgumaPermissao(lista: [modulo: string, acao: Acao][]) {
  const session = await auth();
  if (!session) {
    return { erro: true as const, resposta: NextResponse.json({ erro: "Não autorizado" }, { status: 401 }) };
  }
  const user = session.user;
  const aceita = lista.filter(([m, a]) => pode(user.permissoes as Permissoes, m, a, user.role));
  if (!aceita.length) {
    return { erro: true as const, resposta: NextResponse.json({ erro: "Sem permissão para esta ação" }, { status: 403 }) };
  }
  // Basta UMA das permissões aceitas estar num módulo ligado: quem entra por "editar OS" não é
  // barrado porque a outra porta da lista (um módulo opcional) está desligada.
  const empresaId = (user as any).empresaId;
  const barrados = await Promise.all(aceita.map(([m, a]) => moduloBarra(empresaId, m, a)));
  if (barrados.every((b) => b !== null)) return { erro: true as const, resposta: barrados[0]! };
  return { erro: false as const, session };
}

/**
 * Portão de módulo para a rota que NÃO passa por `exigirPermissao` — as poucas que conferem
 * `pode()` na mão porque aceitam várias portas (os pedidos de compra, que a OS e o orçamento
 * também criam). Devolve o 403 pronto ou null.
 *
 * Use só onde a ação CRIA ou MUDA algo do módulo. Para a LEITURA de dado antigo, não: um pedido
 * de compra que já existe continua aparecendo na OS depois de a empresa desligar Compras — o que
 * o módulo desligado impede é criar coisa nova, não é apagar o passado.
 */
export function exigirModuloNaApi(empresaId: string | undefined, modulo: string) {
  return moduloBarra(empresaId, modulo, "visualizar");
}
