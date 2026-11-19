import type { Metadata } from "next";
import Link from "next/link";
import { Lock, LayoutDashboard, PowerOff } from "lucide-react";
import { moduloCatalogo } from "@/lib/modulos/catalogo";

export const metadata: Metadata = { title: "Sem permissão" };

/**
 * Duas recusas diferentes, com a mesma porta de saída:
 *  - SEM PERMISSÃO: o perfil do usuário não alcança a área (RBAC) — peça ao administrador;
 *  - MÓDULO DESLIGADO: a EMPRESA desligou o módulo (`?modulo=`) — é uma decisão da empresa, não
 *    uma falta de acesso da pessoa, e quem resolve é Configurações. Dizer "sem permissão" num
 *    caso desses mandaria a pessoa pedir à toa um acesso que ela já tem.
 */
export default async function SemPermissaoPage({ searchParams }: { searchParams: Promise<{ modulo?: string }> }) {
  const { modulo } = await searchParams;
  const def = modulo ? moduloCatalogo(modulo) : null;

  return (
    <div className="min-h-[70vh] flex flex-col items-center justify-center text-center px-6">
      <div className={`w-20 h-20 rounded-card flex items-center justify-center mb-6 ${def ? "bg-previsto-claro" : "bg-atrasado-claro"}`}>
        {def
          ? <PowerOff className="w-9 h-9 text-previsto-texto" aria-hidden />
          : <Lock className="w-9 h-9 text-atrasado" aria-hidden />}
      </div>
      <h1 className="text-2xl font-bold text-ink" data-titulo-recusa>
        {def ? `${def.nome} está desligado` : "Sem permissão para esta área"}
      </h1>
      <p className="text-sm text-ink-muted mt-2 max-w-md" data-explicacao-recusa>
        {def ? def.descricao : "O perfil de acesso não inclui esta seção. Solicite o acesso ao administrador."}
      </p>
      {def && (
        <p className="text-sm text-ink-muted mt-1 max-w-md" data-nada-apagado>
          A empresa desligou este módulo. Nada foi apagado: religando, tudo volta como estava.
        </p>
      )}
      <div className="flex flex-wrap items-center justify-center gap-2 mt-6">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 bg-primary-500 hover:bg-primary-600 text-white px-5 py-2.5 rounded-lg text-sm font-semibold transition-colors"
        >
          <LayoutDashboard className="w-4 h-4" aria-hidden /> Voltar ao Dashboard
        </Link>
        {def && (
          <Link
            href="/configuracoes?aba=conta&secao=modulos"
            className="inline-flex items-center gap-2 bg-white border border-surface-border text-ink hover:bg-surface-alt px-5 py-2.5 rounded-lg text-sm font-semibold transition-colors"
            data-ir-modulos
          >
            Ver os módulos
          </Link>
        )}
      </div>
    </div>
  );
}
