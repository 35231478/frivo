/**
 * ACESSO ATUAL — as regras puras por trás de "conceder ou retirar acesso vale sem sair e entrar".
 *
 * O bug que este arquivo existe para não voltar (confirmado em 19/11): papel e permissões eram
 * gravados no token no LOGIN e valiam até a sessão vencer (até 30 dias). O RH que recebia
 * "Admissão digital › Gerenciar" com a sessão já aberta continuava em "sem permissão"; e quem
 * perdia uma permissão continuava com ela.
 *
 * O que se prova aqui (sem banco):
 *  - `acessoAtual`: o acesso do cadastro de agora, com a mesma regra do login;
 *  - `acessoMudou`: o token difere do cadastro? (só ação LIGADA conta; papel conta; nome não);
 *  - `podeEntrarNoModulo`: o portão nunca exige uma ação que o módulo não tem;
 *  - `rotaInternaSegura` / `destinoSemPermissao`: o `de` de /sem-permissao não vira redirecionamento
 *    para fora do sistema.
 */
import { describe, expect, it } from "vitest";
import { acessoAtual, acessoMudou } from "@/lib/acesso/acesso-atual";
import { semCookieDaSessao } from "@/lib/acesso/cookie-sessao";
import {
  MODULOS, PRESETS, destinoSemPermissao, montarPermissoes, permissoesTotais, permissoesVazias, podeEntrarNoModulo,
  portaoBarra, rotaInternaSegura,
} from "@/lib/permissoes";

const RH = montarPermissoes({ admissao: ["gerenciar"] });

describe("acessoAtual: o acesso é o do cadastro de agora", () => {
  it("perfil ativo: as permissões do perfil, e o nome dele", () => {
    const a = acessoAtual({ role: "OPERADOR", perfilAcesso: { nome: "RH", ativo: true, permissoes: RH } });
    expect(a).toEqual({ role: "OPERADOR", permissoes: RH, perfilNome: "RH" });
  });

  it("perfil inativado ou retirado: só o Dashboard — tirar o perfil restringe, não libera", () => {
    for (const perfilAcesso of [{ nome: "RH", ativo: false, permissoes: RH }, null]) {
      const a = acessoAtual({ role: "OPERADOR", perfilAcesso });
      expect(a.permissoes).toEqual(permissoesVazias());
      expect(a.perfilNome).toBeNull();
    }
  });

  it("administrador master: acesso total, qualquer que seja o perfil", () => {
    expect(acessoAtual({ role: "ADMIN", perfilAcesso: { nome: "RH", ativo: true, permissoes: RH } }).permissoes).toEqual(permissoesTotais());
  });
});

describe("acessoMudou: o token que chegou está desatualizado?", () => {
  const atual = acessoAtual({ role: "OPERADOR", perfilAcesso: { nome: "RH", ativo: true, permissoes: RH } });

  it("igual ao cadastro: não mudou", () => {
    expect(acessoMudou({ role: "OPERADOR", permissoes: RH }, atual)).toBe(false);
  });

  it("ação concedida depois do login: mudou", () => {
    expect(acessoMudou({ role: "OPERADOR", permissoes: permissoesVazias() }, atual)).toBe(true);
  });

  it("ação retirada depois do login: mudou", () => {
    const semAdmissao = acessoAtual({ role: "OPERADOR", perfilAcesso: { nome: "RH", ativo: true, permissoes: permissoesVazias() } });
    expect(acessoMudou({ role: "OPERADOR", permissoes: RH }, semAdmissao)).toBe(true);
  });

  it("papel trocado (ex.: deixou de ser administrador): mudou", () => {
    expect(acessoMudou({ role: "ADMIN", permissoes: RH }, atual)).toBe(true);
  });

  it("só conta ação LIGADA: { x: false } e ausência de x dão o mesmo acesso; a ordem das chaves não importa", () => {
    const soLigadas = { admissao: { gerenciar: true }, dashboard: { visualizar: true } };
    expect(acessoMudou({ role: "OPERADOR", permissoes: soLigadas }, atual)).toBe(false);
    const embaralhado = Object.fromEntries(Object.entries(RH).reverse());
    expect(acessoMudou({ role: "OPERADOR", permissoes: embaralhado }, atual)).toBe(false);
  });

  it("token sem permissões (sessão antiga ou malformada) diante de um acesso com ações: mudou", () => {
    expect(acessoMudou({ role: "OPERADOR" }, atual)).toBe(true);
    expect(acessoMudou({ role: "OPERADOR", permissoes: "lixo" }, atual)).toBe(true);
  });
});

describe("podeEntrarNoModulo: o portão e o menu nunca exigem uma ação que o módulo não tem", () => {
  it("módulo com \"visualizar\": é ela que abre a área — outra ação sozinha não abre", () => {
    expect(podeEntrarNoModulo(montarPermissoes({ estoque: ["visualizar"] }), "estoque", "OPERADOR")).toBe(true);
    expect(podeEntrarNoModulo(montarPermissoes({ estoque: ["gerenciar"] }), "estoque", "OPERADOR")).toBe(false);
  });

  it("módulo SEM \"visualizar\": qualquer ação dele abre; nenhuma ação, não abre", () => {
    const semVisualizar = MODULOS.filter((m) => !m.acoes.includes("visualizar"));
    expect(semVisualizar.map((m) => m.id).sort()).toEqual(["admissao", "documentos"]);
    for (const m of semVisualizar) {
      for (const a of m.acoes) expect(podeEntrarNoModulo(montarPermissoes({ [m.id]: [a] }), m.id, "OPERADOR"), `${m.id}.${a}`).toBe(true);
      expect(podeEntrarNoModulo(permissoesVazias(), m.id, "OPERADOR"), m.id).toBe(false);
      // o perfil "Administrador" (tudo marcado, sem ser o master) também entra — antes era barrado
      expect(podeEntrarNoModulo(PRESETS.ADMINISTRADOR, m.id, "OPERADOR"), m.id).toBe(true);
    }
  });

  it("administrador master entra em tudo; Dashboard é de todos", () => {
    for (const m of MODULOS) expect(podeEntrarNoModulo(null, m.id, "ADMIN"), m.id).toBe(true);
    expect(podeEntrarNoModulo(permissoesVazias(), "dashboard", "OPERADOR")).toBe(true);
  });

  it("módulo desconhecido cai na regra antiga (\"visualizar\")", () => {
    expect(podeEntrarNoModulo({ novo: { visualizar: true } }, "novo", "OPERADOR")).toBe(true);
    expect(podeEntrarNoModulo({ novo: { gerenciar: true } }, "novo", "OPERADOR")).toBe(false);
  });
});

describe("o `de` de /sem-permissao", () => {
  it("o middleware leva o endereço pedido, codificado", () => {
    expect(destinoSemPermissao("/admissoes")).toBe("/sem-permissao?de=%2Fadmissoes");
    expect(new URL(destinoSemPermissao("/ordens/a b"), "https://x").searchParams.get("de")).toBe("/ordens/a b");
  });

  it("só aceita caminho deste sistema", () => {
    expect(rotaInternaSegura("/admissoes")).toBe("/admissoes");
    expect(rotaInternaSegura("/estoque/separacao")).toBe("/estoque/separacao");
    for (const ruim of [
      undefined, null, "", "admissoes", "https://outro.com", "//outro.com", "/\\outro.com", "\\\\outro.com",
      "/sem-permissao", "/sem-permissao?de=/x", "/ok\nSet-Cookie: x", "javascript:alert(1)", `/${"a".repeat(600)}`,
    ]) expect(rotaInternaSegura(ruim as string), String(ruim)).toBeNull();
  });

  it("o destino seguro é decidido pelo mesmo portão do middleware", () => {
    expect(portaoBarra("/admissoes", RH, "OPERADOR")).toBe(false);
    expect(portaoBarra("/admissoes", permissoesVazias(), "OPERADOR")).toBe(true);
  });
});

describe("o middleware não regrava o cookie da sessão", () => {
  it("tira só as linhas da sessão do painel (inteira ou em pedaços); os outros cookies ficam", () => {
    const res = new Response(null, { headers: [
      ["set-cookie", "authjs.session-token=velho; Path=/; HttpOnly"],
      ["set-cookie", "__Secure-authjs.session-token.0=velho0; Path=/"],
      ["set-cookie", "frivo-portal=abc; Path=/"],
      ["set-cookie", "authjs.csrf-token=x; Path=/"],
    ] });
    const nomes = semCookieDaSessao(res).headers.getSetCookie().map((c) => c.split("=")[0]);
    expect(nomes).toEqual(["frivo-portal", "authjs.csrf-token"]);
    const sem = new Response(null, { headers: [["set-cookie", "outro=1"]] });
    expect(semCookieDaSessao(sem).headers.getSetCookie()).toEqual(["outro=1"]);
  });
});
