import { pode, type Permissoes } from "@/lib/permissoes";
import { exigirPermissao } from "@/lib/permissoes-server";
import { empresaTemModulo } from "@/lib/modulos/catalogo";
import { modulosDesligados } from "@/lib/modulos/servidor";

/**
 * Lotes de importação: quem vê e desfaz é quem configura a empresa (Configurações › Gerenciar, a mesma da tela de
 * Implantação). Cada registro ainda passa pela permissão de excluir do cadastro dele (lotes-regras).
 */
export async function exigirLotes() {
  const guard = await exigirPermissao("configuracoes", "gerenciar");
  if (guard.erro) return guard;
  const u = guard.session.user!;
  const permissoes = (u.permissoes ?? {}) as Permissoes;
  const desligados = await modulosDesligados(u.empresaId);
  return {
    ...guard,
    ctx: {
      empresaId: u.empresaId, usuarioId: (u.id as string | undefined) ?? null,
      pode: (m: string, a: Parameters<typeof pode>[2]) => pode(permissoes, m, a, u.role),
      temModulo: (m: string) => empresaTemModulo(desligados, m),
    },
  };
}
