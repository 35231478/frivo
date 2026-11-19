"use client";

import { createContext, useContext, useMemo } from "react";
import { empresaTemModulo, moduloDaRotaModular } from "@/lib/modulos/catalogo";

interface ModulosCtx {
  /** Ids dos módulos que a EMPRESA desligou (vazio = tudo ligado, o caso de quase todo mundo) */
  desligados: string[];
  /** A empresa tem este módulo? Núcleo: sempre. */
  tem: (modulo: string) => boolean;
  /** Esta rota pertence a um módulo desligado? (usado pelo menu) */
  rotaDesligada: (href: string) => boolean;
}

const ModulosContext = createContext<ModulosCtx>({ desligados: [], tem: () => true, rotaDesligada: () => false });

/**
 * Provider dos MÓDULOS DA EMPRESA (entitlement), irmão do PermissoesProvider — um diz o que a
 * empresa tem, o outro o que o usuário pode. Alimentado pelo layout do painel, que lê o estado
 * no banco a cada navegação: desligar um módulo vale na hora, sem ninguém precisar sair e entrar.
 */
export function ModulosProvider({ desligados, children }: { desligados: string[]; children: React.ReactNode }) {
  const value = useMemo<ModulosCtx>(() => {
    const conjunto = new Set(desligados);
    return {
      desligados,
      tem: (modulo: string) => empresaTemModulo(conjunto, modulo),
      rotaDesligada: (href: string) => {
        const id = moduloDaRotaModular(href);
        return !!id && !empresaTemModulo(conjunto, id);
      },
    };
  }, [desligados]);
  return <ModulosContext.Provider value={value}>{children}</ModulosContext.Provider>;
}

/** Hook para esconder menu e botões de um módulo que a empresa desligou. */
export function useModulos() {
  return useContext(ModulosContext);
}
