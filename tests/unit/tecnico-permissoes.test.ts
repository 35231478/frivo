/**
 * O app do técnico (/tecnico) fica FORA do layout do painel: as permissões da tela (ex.: o botão
 * "Concluir sem equipamento — justificar", que exige "concluir OS") só existem se a própria página
 * montar o PermissoesProvider. Sem ele, `pode()` devolve sempre false e o botão some no celular.
 */
import { describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { permissoesTotais } from "@/lib/permissoes";

const permissoes = permissoesTotais();
vi.mock("@/lib/auth", () => ({
  auth: async () => ({ user: { id: "uT", name: "Fernanda", email: "f@x.com", empresaId: "e1", empresaNome: "Clima", role: "TECNICO", permissoes, perfilNome: "Técnico" } }),
}));
vi.mock("@/lib/prisma", () => ({ prisma: { usuario: { findUnique: async () => ({ avatar: null }) } } }));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error(`redirect ${u}`); } }));

/** Caminho de componentes (pelo nome) da raiz até o primeiro elemento que satisfaz `alvo`. */
function caminho(no: ReactNode, alvo: (el: ReactElement) => boolean, acc: ReactElement[] = []): ReactElement[] | null {
  if (Array.isArray(no)) { for (const n of no) { const r = caminho(n, alvo, acc); if (r) return r; } return null; }
  if (!isValidElement(no)) return null;
  const el = no as ReactElement<any>;
  const aqui = [...acc, el];
  if (alvo(el)) return aqui;
  return caminho(el.props?.children, alvo, aqui);
}
const nome = (el: ReactElement) => (typeof el.type === "string" ? el.type : (el.type as any).name ?? (el.type as any).displayName);

describe("app do técnico: permissões da tela", () => {
  it("o AppTecnico é renderizado dentro do PermissoesProvider com as permissões da sessão", async () => {
    const { default: TecnicoPage } = await import("@/app/tecnico/page");
    const arvore = await TecnicoPage();
    const ate = caminho(arvore, (el) => nome(el) === "AppTecnico");
    expect(ate).toBeTruthy();
    const provider = ate!.find((el) => nome(el) === "PermissoesProvider") as ReactElement<any> | undefined;
    expect(provider).toBeTruthy();
    expect(provider!.props.role).toBe("TECNICO");
    expect(provider!.props.permissoes).toBe(permissoes);
  });
});
