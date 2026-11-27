"use client";

import { createContext, useContext, useMemo } from "react";
import { pode as podeRaw, type Acao, type Permissoes } from "@/lib/permissoes";

interface PermissoesCtx {
  admin: boolean;
  role?: string;
  /** Quem está logado e em qual empresa (os filtros lembrados das listas separam por estes dois) */
  usuarioId?: string;
  empresaId?: string;
  permissoes?: Permissoes;
  pode: (modulo: string, acao?: Acao) => boolean;
}

const PermissoesContext = createContext<PermissoesCtx>({ admin: false, pode: () => false });

/**
 * Provider de permissões alimentado pela sessão do servidor (montado no layout do
 * dashboard). Evita depender de SessionProvider/useSession.
 */
export function PermissoesProvider({
  role,
  permissoes,
  usuarioId,
  empresaId,
  children,
}: {
  role?: string;
  permissoes?: Permissoes;
  usuarioId?: string;
  empresaId?: string;
  children: React.ReactNode;
}) {
  const value = useMemo<PermissoesCtx>(
    () => ({
      admin: role === "ADMIN",
      role,
      permissoes,
      usuarioId,
      empresaId,
      pode: (modulo: string, acao: Acao = "visualizar") => podeRaw(permissoes, modulo, acao, role),
    }),
    [role, permissoes, usuarioId, empresaId],
  );
  return <PermissoesContext.Provider value={value}>{children}</PermissoesContext.Provider>;
}

/** Hook para ocultar botões/menus conforme a permissão do usuário logado. */
export function usePermissoes() {
  return useContext(PermissoesContext);
}
