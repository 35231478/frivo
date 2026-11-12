import { describe, expect, it } from "vitest";
import {
  montarPermissoes, permissoesDoUsuario, permissoesExcedentes, permissoesTotais, permissoesVazias, pode, PRESETS,
} from "@/lib/permissoes";
import { contatoSeguro } from "@/lib/contato-cliente";

describe("permissoesDoUsuario (C3: sem perfil não pode liberar tudo)", () => {
  const perfilSupervisor = { ativo: true, permissoes: PRESETS.SUPERVISOR };

  it("ADMIN tem acesso total, com ou sem perfil", () => {
    expect(permissoesDoUsuario({ role: "ADMIN", perfilAcesso: null })).toEqual(permissoesTotais());
    expect(permissoesDoUsuario({ role: "ADMIN", perfilAcesso: { ativo: true, permissoes: {} } })).toEqual(permissoesTotais());
  });

  it("usuário SEM perfil fica sem acesso (só o dashboard)", () => {
    const p = permissoesDoUsuario({ role: "OPERADOR", perfilAcesso: null });
    expect(p).toEqual(permissoesVazias());
    expect(pode(p, "configuracoes", "gerenciar", "OPERADOR")).toBe(false);
    expect(pode(p, "financeiro", "visualizar", "OPERADOR")).toBe(false);
    expect(pode(p, "dashboard", "visualizar", "OPERADOR")).toBe(true);
  });

  it("perfil INATIVO conta como sem perfil", () => {
    expect(permissoesDoUsuario({ role: "GERENTE", perfilAcesso: { ...perfilSupervisor, ativo: false } })).toEqual(permissoesVazias());
  });

  it("perfil ativo usa as permissões do perfil", () => {
    const p = permissoesDoUsuario({ role: "GERENTE", perfilAcesso: perfilSupervisor });
    expect(pode(p, "ordens", "criar", "GERENTE")).toBe(true);
    expect(pode(p, "financeiro", "visualizar", "GERENTE")).toBe(false);
  });
});

describe("permissoesExcedentes (ninguém concede o que não tem)", () => {
  const supervisor = PRESETS.SUPERVISOR;

  it("perfil menor cabe no maior", () => {
    expect(permissoesExcedentes(supervisor, PRESETS.TECNICO)).toEqual([]);
  });

  it("lista o que falta", () => {
    expect(permissoesExcedentes(supervisor, montarPermissoes({ financeiro: ["visualizar"], ordens: ["criar"] })))
      .toEqual(["financeiro.visualizar"]);
  });

  it("perfil Administrador excede qualquer perfil não-admin", () => {
    expect(permissoesExcedentes(supervisor, PRESETS.ADMINISTRADOR).length).toBeGreaterThan(0);
  });

  it("ADMIN pode conceder tudo; dashboard é ignorado", () => {
    expect(permissoesExcedentes(permissoesVazias(), PRESETS.ADMINISTRADOR, "ADMIN")).toEqual([]);
    expect(permissoesExcedentes(permissoesVazias(), { dashboard: { visualizar: true } })).toEqual([]);
  });
});

describe("contatoSeguro (C2)", () => {
  it("remove hash e senha em texto e informa só se há acesso", () => {
    const c = contatoSeguro({ id: "1", nome: "Ana", senha: "$2a$12$hash", senhaProvisoria: "abc123" });
    expect(c).toEqual({ id: "1", nome: "Ana", temAcesso: true });
    expect(contatoSeguro({ id: "2", senha: null, senhaProvisoria: null }).temAcesso).toBe(false);
  });
});
