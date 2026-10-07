/**
 * Leva 4 — perfis de acesso, modelos de encargos e usuários no cadastro padronizado; inativar pelo
 * select de status pela função única. Rotas reais, banco em memória (duas empresas). Prova:
 *  - criar/editar/inativar/reativar perfil, modelo de encargos e usuário, com permissão;
 *  - travas: perfil padrão, o perfil de quem está logado, o próprio usuário, o último administrador,
 *    modelo padrão do regime — na rota, no modal (impacto) e nas ações em massa;
 *  - anti-autopromoção (cenários C3, agora sobre a implementação padronizada);
 *  - o hash da senha nunca sai; o convite é por link assinado, expira e é de uso único;
 *  - seletor de perfil mantém o inativo já usado e não o oferece em escolha nova;
 *  - impacto correto antes de inativar; select de status passa pela mesma função do botão.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PRESETS, permissoesTotais, permissoesVazias, type Permissoes } from "@/lib/permissoes";
import type { Banco, Linha } from "./helpers/banco-memoria";

process.env.AUTH_SECRET = "segredo-de-teste-leva4-com-32-caracteres!!";

const db = vi.hoisted(() => ({ t: {}, escritas: [], seq: 0 }) as unknown as Banco);
vi.mock("@/lib/prisma", async () => {
  const { criarPrisma } = await import("./helpers/banco-memoria");
  const vazio = () => [];
  return {
    prisma: criarPrisma(db, {
      usuario: (r, T) => ({ perfilAcesso: T("perfilAcesso").find((p) => p.id === r.perfilAcessoId) ?? null, empresa: { ativo: true } }),
      perfilAcesso: (r, T) => ({ _count: { usuarios: T("usuario").filter((u) => u.perfilAcessoId === r.id).length, colaboradores: T("tecnico").filter((t) => t.perfilAcessoId === r.id).length } }),
      modeloEncargos: (r, T) => ({ _count: { colaboradores: T("colaboradorFolha").filter((c) => c.modeloEncargosId === r.id).length } }),
      colaboradorFolha: (r, T) => ({ colaborador: T("tecnico").find((t) => t.id === r.colaboradorId) }),
      tecnico: (r, T) => ({
        equipesLideradas: vazio(), equipesMembro: vazio(), veiculosResponsavel: vazio(), contratosRecorrencia: vazio(),
        contratosResponsavel: vazio(), clientesResponsavel: vazio(), atividadesOs: vazio(), competencias: vazio(),
        folha: T("colaboradorFolha").find((f) => f.colaboradorId === r.id) ?? null,
      }),
      equipe: () => ({ membros: vazio(), veiculos: vazio() }),
    }),
  };
});
const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
// E-mail: por padrão "não configurado" (o convite volta como LINK); um teste liga o envio
const email = vi.hoisted(() => ({ ok: false, enviados: [] as any[] }));
vi.mock("@/lib/email", () => ({
  enviarEmail: vi.fn(async (_e: string, p: any) => { email.enviados.push(p); return email.ok ? { ok: true } : { ok: false, erro: "E-mail não configurado ou inativo." }; }),
}));

/** Gerente de configurações (não-admin): cenário de autopromoção */
const SUPERVISOR_CONFIG: Permissoes = { ...PRESETS.SUPERVISOR, configuracoes: { visualizar: true, gerenciar: true } };
const FOLHA: Permissoes = { ...permissoesVazias(), financeiro: { visualizar: true, folha: true } };

const logar = (id: string, role = "OPERADOR", permissoes: Permissoes = permissoesTotais(), empresaId = "e1") => {
  sessao.atual = { user: { id, name: id, email: `${id}@x.com`, empresaId, role, permissoes } };
};

function semear() {
  db.escritas = []; email.ok = false; email.enviados = [];
  db.t = {
    perfilAcesso: [
      { id: "p-admin", empresaId: "e1", nome: "Administrador", tipo: "ADMINISTRADOR", cor: "#ef4444", ativo: true, padraoSistema: true, permissoes: PRESETS.ADMINISTRADOR },
      { id: "p-sup", empresaId: "e1", nome: "Supervisor", tipo: "SUPERVISOR", cor: "#8b5cf6", ativo: true, padraoSistema: false, permissoes: SUPERVISOR_CONFIG },
      { id: "p-tec", empresaId: "e1", nome: "Técnico", tipo: "TECNICO", cor: "#10b981", ativo: true, padraoSistema: false, permissoes: PRESETS.TECNICO },
      { id: "p-velho", empresaId: "e1", nome: "Perfil antigo", tipo: "PERSONALIZADO", cor: "#64748b", ativo: false, padraoSistema: false, permissoes: PRESETS.TECNICO },
      { id: "p-fin", empresaId: "e1", nome: "Financeiro", tipo: "FINANCEIRO", cor: "#f59e0b", ativo: true, padraoSistema: false, permissoes: PRESETS.FINANCEIRO },
      { id: "pB", empresaId: "e2", nome: "Da outra", tipo: "TECNICO", cor: "#000000", ativo: true, padraoSistema: false, permissoes: PRESETS.TECNICO },
    ],
    usuario: [
      { id: "admin", empresaId: "e1", nome: "Ana Admin", email: "ana@x.com", senha: "$2a$12$hash-da-ana", role: "ADMIN", ativo: true, perfilAcessoId: null, ultimoAcesso: new Date() },
      { id: "gerente", empresaId: "e1", nome: "Gil Gerente", email: "gil@x.com", senha: "$2a$12$hash-do-gil", role: "OPERADOR", ativo: true, perfilAcessoId: "p-sup", ultimoAcesso: new Date() },
      { id: "tec1", empresaId: "e1", nome: "Téo Técnico", email: "teo@x.com", senha: "$2a$12$hash-do-teo", role: "OPERADOR", ativo: true, perfilAcessoId: "p-tec", ultimoAcesso: new Date() },
      { id: "tec2", empresaId: "e1", nome: "Tina Técnica", email: "tina@x.com", senha: "$2a$12$hash-da-tina", role: "OPERADOR", ativo: true, perfilAcessoId: "p-tec", ultimoAcesso: null },
      { id: "velho", empresaId: "e1", nome: "Vera Antiga", email: "vera@x.com", senha: "$2a$12$hash-da-vera", role: "OPERADOR", ativo: true, perfilAcessoId: "p-velho", ultimoAcesso: new Date() },
      { id: "fin", empresaId: "e1", nome: "Fábio Fin", email: "fabio@x.com", senha: "$2a$12$hash-do-fabio", role: "OPERADOR", ativo: true, perfilAcessoId: "p-fin", ultimoAcesso: new Date() },
      { id: "uB", empresaId: "e2", nome: "Da outra", email: "b@x.com", senha: "x", role: "ADMIN", ativo: true, perfilAcessoId: null },
    ],
    ordemServico: [{ id: "os1", empresaId: "e1", responsavelId: "tec1", status: "ABERTA" }],
    pedidoCompraInterno: [],
    modeloEncargos: [
      { id: "m-clt", empresaId: "e1", nome: "CLT (padrão)", regime: "CLT", padrao: true, ativo: true, itens: [{ nome: "FGTS", percentual: 8 }] },
      { id: "m-clt2", empresaId: "e1", nome: "CLT Simples", regime: "CLT", padrao: false, ativo: true, itens: [{ nome: "FGTS", percentual: 8 }] },
      { id: "m-velho", empresaId: "e1", nome: "CLT 2019", regime: "CLT", padrao: false, ativo: false, itens: [] },
      { id: "m-pj", empresaId: "e1", nome: "PJ (padrão)", regime: "PJ", padrao: true, ativo: true, itens: [] },
      { id: "mB", empresaId: "e2", nome: "CLT (padrão)", regime: "CLT", padrao: true, ativo: true, itens: [] },
    ],
    tecnico: [
      { id: "t1", empresaId: "e1", nome: "Caio", cpf: "11111111111", telefone: "11999999999", ativo: true, statusColaborador: "ATIVO", email: "teo@x.com", perfilAcessoId: "p-tec", cargoId: null, observacoes: null, salario: null },
      { id: "t2", empresaId: "e1", nome: "Duda", cpf: "22222222222", telefone: "11999999999", ativo: true, statusColaborador: "ATIVO", email: null, perfilAcessoId: "p-velho", cargoId: null, observacoes: null, salario: null },
      { id: "t3", empresaId: "e1", nome: "Eva", cpf: "33333333333", telefone: "11999999999", ativo: false, statusColaborador: "INATIVO", email: null, perfilAcessoId: null, cargoId: null, observacoes: null, salario: null },
      { id: "tAdm", empresaId: "e1", nome: "Ana (colab.)", cpf: "44444444444", telefone: "11999999999", ativo: true, statusColaborador: "ATIVO", email: "ana@x.com", perfilAcessoId: null, cargoId: null, observacoes: null, salario: null },
    ],
    colaboradorFolha: [
      { id: "f1", empresaId: "e1", colaboradorId: "t1", regime: "CLT", modeloEncargosId: "m-clt2", horasMes: 220, adicionalTipo: "NENHUM", descontaVt: true },
      { id: "f2", empresaId: "e1", colaboradorId: "t2", regime: "CLT", modeloEncargosId: "m-velho", horasMes: 220, adicionalTipo: "NENHUM", descontaVt: true },
    ],
    equipe: [
      { id: "eq1", empresaId: "e1", nome: "Equipe Norte", status: "ATIVA", observacoes: null, liderId: null, cor: "#0EA5E9" },
    ],
    atividadeTecnico: [], veiculo: [],
  };
}
beforeEach(() => { semear(); logar("admin", "ADMIN"); });

async function chamar(carregar: () => Promise<any>, metodo: string, params: Record<string, string>, corpo?: unknown, url = "http://localhost/api/x") {
  const mod = await carregar();
  const req = new NextRequest(url, { method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  return { status: res.status, json: await res.json().catch(() => null) };
}
const col = () => import("@/app/api/cadastros/[entidade]/route");
const item = () => import("@/app/api/cadastros/[entidade]/[id]/route");
const impacto = () => import("@/app/api/cadastros/[entidade]/[id]/impacto/route");
const linha = (m: string, id: string) => db.t[m].find((r) => r.id === id)!;
const apagou = () => db.escritas.some((e) => e.includes(".delete"));

// ═════════════════════════ Perfis de acesso ═════════════════════════
describe("perfis de acesso", () => {
  const P = { entidade: "perfis-acesso" };

  it("criar / editar / inativar / reativar com permissão — nunca apaga", async () => {
    const c = await chamar(col, "POST", P, { nome: "Almoxarife", permissoes: PRESETS.AUXILIAR });
    expect(c.status).toBe(201);
    expect(c.json).toMatchObject({ empresaId: "e1", ativo: true, padraoSistema: false, tipo: "PERSONALIZADO" });
    const id = c.json.id;
    expect((await chamar(item, "PATCH", { ...P, id }, { nome: "Almoxarifado" })).json.nome).toBe("Almoxarifado");
    expect((await chamar(item, "DELETE", { ...P, id })).status).toBe(200);
    expect(linha("perfilAcesso", id).ativo).toBe(false);
    expect((await chamar(item, "PATCH", { ...P, id }, { ativo: true })).status).toBe(200);
    expect(linha("perfilAcesso", id)).toMatchObject({ ativo: true, nome: "Almoxarifado" });
    expect(apagou()).toBe(false);
  });

  it("não inativa o perfil padrão do sistema (rota, modal e ação em massa)", async () => {
    const r = await chamar(item, "DELETE", { ...P, id: "p-admin" });
    expect(r.status).toBe(409);
    expect(r.json.erro).toMatch(/perfil padrão do sistema/);
    expect((await chamar(impacto, "GET", { ...P, id: "p-admin" })).json.bloqueio).toMatch(/perfil padrão/);
    const { POST } = await import("@/app/api/acoes-massa/route");
    const m = await (await POST(new NextRequest("http://localhost/api/acoes-massa", { method: "POST", body: JSON.stringify({ entidade: "perfis-acesso", acao: "inativar", ids: ["p-admin"] }) }))).json();
    expect(m.resultados[0]).toMatchObject({ ok: false, codigo: "bloqueado" });
    expect(linha("perfilAcesso", "p-admin").ativo).toBe(true);
  });

  it("não inativa o perfil de quem está logado (nem pelo PATCH com outros campos)", async () => {
    logar("gerente", "OPERADOR", SUPERVISOR_CONFIG);
    const r = await chamar(item, "DELETE", { ...P, id: "p-sup" });
    expect(r.status).toBe(409);
    expect(r.json.erro).toMatch(/seu próprio perfil/);
    const misto = await chamar(item, "PATCH", { ...P, id: "p-sup" }, { descricao: "x", ativo: false });
    expect(misto.status).toBe(409);
    expect(linha("perfilAcesso", "p-sup")).toMatchObject({ ativo: true });
    expect(linha("perfilAcesso", "p-sup").descricao).toBeUndefined(); // nada gravado pela metade
  });

  it("impacto: avisa quem fica sem acesso (o administrador não conta: tem acesso total)", async () => {
    db.t.usuario.push({ id: "admin2", empresaId: "e1", nome: "Beto Admin", email: "beto@x.com", senha: "x", role: "ADMIN", ativo: true, perfilAcessoId: "p-tec" });
    const r = (await chamar(impacto, "GET", { ...P, id: "p-tec" })).json;
    expect(r.bloqueio).toBeNull();
    expect(r.avisos[0]).toBe("2 usuários ativos usam este perfil (Téo Técnico, Tina Técnica). Ao inativar, eles ficam SEM ACESSO (só o início) a partir da próxima tela, até receberem outro perfil em Configurações › Usuários.");
    expect(r.avisos[1]).toBe("1 colaborador está ligado a este perfil no cadastro.");
    expect(r.usos).toEqual([{ rotulo: "3 usuários ativos", total: 3 }, { rotulo: "1 colaborador", total: 1 }]);
  });

  it("sem permissão de Configurações › gerenciar: 403 e nada muda", async () => {
    logar("tec1", "OPERADOR", PRESETS.TECNICO);
    expect((await chamar(col, "POST", P, { nome: "X" })).status).toBe(403);
    expect((await chamar(item, "DELETE", { ...P, id: "p-tec" })).status).toBe(403);
    expect(db.escritas).toEqual([]);
  });

  it("campo desconhecido é recusado (empresaId, padraoSistema)", async () => {
    expect((await chamar(col, "POST", P, { nome: "X", empresaId: "e2" })).status).toBe(400);
    expect((await chamar(item, "PATCH", { ...P, id: "p-tec" }, { padraoSistema: true })).status).toBe(400);
  });

  describe("anti-autopromoção (C3)", () => {
    beforeEach(() => logar("gerente", "OPERADOR", SUPERVISOR_CONFIG));
    it("não-admin não cria perfil com acessos que não tem", async () => {
      expect((await chamar(col, "POST", P, { nome: "Tudo", permissoes: PRESETS.ADMINISTRADOR })).status).toBe(403);
      expect(db.escritas).toEqual([]);
    });
    it("não-admin não edita o perfil ao qual está vinculado", async () => {
      expect((await chamar(item, "PATCH", { ...P, id: "p-sup" }, { permissoes: PRESETS.ADMINISTRADOR })).status).toBe(403);
    });
    it("não-admin não amplia outro perfil além do que ele tem", async () => {
      expect((await chamar(item, "PUT", { ...P, id: "p-tec" }, { permissoes: PRESETS.FINANCEIRO })).status).toBe(403);
    });
    it("não-admin não inativa nem reativa perfil com mais acesso que o dele", async () => {
      expect((await chamar(item, "DELETE", { ...P, id: "p-fin" })).json.erro).toMatch(/só um administrador pode inativá-lo/);
    });
    it("não-admin edita perfil menor que o dele; admin edita qualquer um", async () => {
      expect((await chamar(item, "PATCH", { ...P, id: "p-tec" }, { descricao: "Campo" })).status).toBe(200);
      logar("admin", "ADMIN");
      expect((await chamar(item, "PATCH", { ...P, id: "p-tec" }, { permissoes: PRESETS.FINANCEIRO })).status).toBe(200);
    });
  });

  it("rota antiga /api/perfis-acesso/[id] DELETE agora inativa (não apaga)", async () => {
    const antigo = () => import("@/app/api/perfis-acesso/[id]/route");
    expect((await chamar(antigo, "DELETE", { id: "p-fin" })).status).toBe(200);
    expect(linha("perfilAcesso", "p-fin").ativo).toBe(false);
    expect(apagou()).toBe(false);
  });
});

// ═════════════════════════ Seletor de perfil ═════════════════════════
describe("seletor de perfil: mantém o inativo já usado, não oferece em escolha nova", () => {
  const perfis = () => db.t.perfilAcesso.filter((p) => p.empresaId === "e1").map((p) => ({ id: p.id, nome: p.nome, ativo: p.ativo }));
  it("componente: registro antigo mostra 'Perfil antigo (inativo)'; escolha nova não oferece", async () => {
    const { SeletorCadastro } = await import("@/components/cadastros/seletor-cadastro");
    const html = (valor: string) => renderToStaticMarkup(createElement(SeletorCadastro, { entidade: "perfis-acesso", itens: perfis(), valor, onChange: () => {} }));
    expect(html("p-velho")).toMatch(/<option value="p-velho"[^>]*selected[^>]*>Perfil antigo \(inativo\)/);
    expect(html("")).not.toContain("Perfil antigo");
  });
  it("servidor: atribuir perfil inativo a outro usuário = 400; quem já tem perfil inativo edita o nome normalmente", async () => {
    const r = await chamar(item, "PATCH", { entidade: "usuarios", id: "tec1" }, { perfilAcessoId: "p-velho" });
    expect(r.status).toBe(400);
    expect(r.json.erro).toBe("Perfil de acesso inativo(a): escolha um(a) ativo(a).");
    expect((await chamar(item, "PATCH", { entidade: "usuarios", id: "velho" }, { nome: "Vera A.", perfilAcessoId: "p-velho" })).status).toBe(200);
  });
  it("colaborador: trocar para perfil inativo = 400; manter o inativo que já tinha = 200", async () => {
    const tecnico = () => import("@/app/api/tecnicos/[id]/route");
    const base = { nome: "Duda", cpf: "22222222222", telefone: "11999999999" };
    expect((await chamar(tecnico, "PUT", { id: "t1" }, { ...base, cpf: "11111111111", nome: "Caio", perfilAcessoId: "p-velho" })).status).toBe(400);
    expect((await chamar(tecnico, "PUT", { id: "t2" }, { ...base, perfilAcessoId: "p-velho" })).status).toBe(200);
  });
});

// ═════════════════════════ Modelos de encargos ═════════════════════════
describe("modelos de encargos", () => {
  const M = { entidade: "modelos-encargos" };
  beforeEach(() => logar("rh", "OPERADOR", FOLHA));

  it("criar / editar / inativar / reativar (Financeiro › Custo de pessoal); nome único; um padrão por regime", async () => {
    const c = await chamar(col, "POST", M, { nome: "CLT Desonerada", regime: "CLT", padrao: true, itens: [{ nome: "FGTS", percentual: "8,0" }] });
    expect(c.status).toBe(201);
    expect(c.json).toMatchObject({ ativo: true, padrao: true, itens: [{ nome: "FGTS", percentual: 8 }] });
    expect(linha("modeloEncargos", "m-clt").padrao).toBe(false); // o padrão anterior deixou de ser
    expect((await chamar(col, "POST", M, { nome: "CLT Simples", regime: "CLT" })).status).toBe(409);
    expect((await chamar(item, "PATCH", { ...M, id: "m-clt2" }, { nome: "CLT Simples Nacional" })).json.nome).toBe("CLT Simples Nacional");
    expect((await chamar(item, "DELETE", { ...M, id: "m-clt2" })).status).toBe(200);
    expect(linha("modeloEncargos", "m-clt2").ativo).toBe(false);
    expect((await chamar(item, "PATCH", { ...M, id: "m-clt2" }, { ativo: true })).status).toBe(200);
    expect(apagou()).toBe(false);
  });

  it("não inativa o modelo padrão do regime (troque o padrão antes)", async () => {
    const r = await chamar(item, "DELETE", { ...M, id: "m-clt" });
    expect(r.status).toBe(409);
    expect(r.json.erro).toBe("É o modelo padrão de CLT: marque outro modelo como padrão antes de inativar este.");
  });

  it("impacto: avisa quem usa e para qual padrão o custo vai (não volta ao padrão sem aviso)", async () => {
    const r = (await chamar(impacto, "GET", { ...M, id: "m-clt2" })).json;
    expect(r.bloqueio).toBeNull();
    expect(r.avisos[0]).toBe("1 colaborador ativo usa este modelo (Caio). Ao inativar, o custo dele passa a ser calculado pelo padrão do tipo de contrato (“CLT (padrão)”). Os meses já fechados não mudam.");
  });

  it("rota antiga /api/folha/modelos/[id] DELETE inativa (antes apagava); sem permissão de folha = 403", async () => {
    const antigo = () => import("@/app/api/folha/modelos/[id]/route");
    expect((await chamar(antigo, "DELETE", { id: "m-clt2" })).status).toBe(200);
    expect(linha("modeloEncargos", "m-clt2").ativo).toBe(false);
    expect(apagou()).toBe(false);
    logar("gerente", "OPERADOR", SUPERVISOR_CONFIG);
    expect((await chamar(item, "DELETE", { ...M, id: "m-pj" })).status).toBe(403);
  });

  it("folha do colaborador: escolher modelo inativo = 400; manter o inativo que já usava = 200", async () => {
    const folha = () => import("@/app/api/folha/colaboradores/[id]/route");
    const corpo = { regime: "CLT", salario: "3000", adicionalTipo: "NENHUM", descontaVt: true };
    expect((await chamar(folha, "PUT", { id: "t1" }, { ...corpo, modeloEncargosId: "m-velho" })).json.erro).toBe("Modelo de encargos inativo: escolha um ativo.");
    const r = await chamar(folha, "PUT", { id: "t2" }, { ...corpo, modeloEncargosId: "m-velho" });
    expect(r.status).toBe(200);
    // a tela recebe o modelo inativo (para mostrar "(inativo)"), mas o custo sai pelo padrão
    expect(r.json.modelos.find((m: Linha) => m.id === "m-velho")).toMatchObject({ ativo: false });
    expect(r.json.modeloAplicado).toBe("CLT (padrão)");
  });
});

// ═════════════════════════ Usuários ═════════════════════════
describe("usuários", () => {
  const U = { entidade: "usuarios" };

  it("lista sem o hash da senha (nem no criar/editar)", async () => {
    const l = await chamar(col, "GET", U, undefined, "http://localhost/api/x?ativo=todos");
    expect(l.json.length).toBe(6);
    expect(l.json.every((u: Linha) => !("senha" in u))).toBe(true);
    expect(JSON.stringify(l.json)).not.toContain("hash-");
    const e = await chamar(item, "PATCH", { ...U, id: "tec1" }, { nome: "Téo T." });
    expect(e.json).not.toHaveProperty("senha");
  });

  it("criar: OPERADOR com perfil, senha aleatória (ninguém sabe), convite por LINK quando não há e-mail", async () => {
    const r = await chamar(col, "POST", U, { nome: "Nina Nova", email: "Nina@X.com ", perfilAcessoId: "p-tec" }, "http://localhost:3000/api/x");
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ nome: "Nina Nova", email: "nina@x.com", role: "OPERADOR", perfilAcessoId: "p-tec", ativo: true });
    expect(r.json).not.toHaveProperty("senha");
    expect(r.json.convite.enviadoPorEmail).toBe(false);
    expect(r.json.convite.link).toMatch(/^http:\/\/localhost:3000\/definir-senha\?token=/);
    const gravado = linha("usuario", r.json.id);
    expect(gravado.senha).toMatch(/^\$2[aby]\$12\$/);
    expect(JSON.stringify(r.json)).not.toContain(gravado.senha);
  });

  it("convite: define a senha uma vez; o link morre depois de usado; entra com a senha nova", async () => {
    const r = await chamar(col, "POST", U, { nome: "Nina Nova", email: "nina@x.com" }, "http://localhost/api/x");
    const token = new URL(r.json.convite.link).searchParams.get("token")!;
    const pub = () => import("@/app/api/publico/definir-senha/route");
    expect((await chamar(pub, "GET", {}, undefined, `http://localhost/api/publico/definir-senha?token=${encodeURIComponent(token)}`)).json).toEqual({ nome: "Nina Nova", email: "nina@x.com" });
    expect((await chamar(pub, "POST", {}, { token, senha: "curta", confirmar: "curta" })).status).toBe(400);
    expect((await chamar(pub, "POST", {}, { token, senha: "senha-forte-123", confirmar: "outra-coisa" })).status).toBe(400);
    expect((await chamar(pub, "POST", {}, { token, senha: "senha-forte-123", confirmar: "senha-forte-123" })).status).toBe(200);
    expect(await bcrypt.compare("senha-forte-123", linha("usuario", r.json.id).senha)).toBe(true);
    const reuso = await chamar(pub, "POST", {}, { token, senha: "outra-senha-456", confirmar: "outra-senha-456" });
    expect(reuso.json.erro).toMatch(/já foi usado/);
  });

  it("convite: link adulterado ou expirado é recusado; usuário inativo também", async () => {
    const { gerarTokenConvite, verificarTokenConvite } = await import("@/lib/usuarios/convite");
    const u = linha("usuario", "tec2");
    const t = gerarTokenConvite(u as { id: string; senha: string });
    expect((await verificarTokenConvite(t)).ok).toBe(true);
    const [corpo, assinatura] = t.split(".");
    const falso = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(corpo, "base64url").toString()), u: "admin" })).toString("base64url");
    expect(await verificarTokenConvite(`${falso}.${assinatura}`)).toEqual({ ok: false, erro: "invalido" });
    expect(await verificarTokenConvite(t, Date.now() + 73 * 3600_000)).toEqual({ ok: false, erro: "expirado" });
    u.ativo = false;
    expect(await verificarTokenConvite(t)).toEqual({ ok: false, erro: "invalido" });
  });

  it("criar: e-mail repetido = 409; e-mail não muda na edição (campo não permitido)", async () => {
    expect((await chamar(col, "POST", U, { nome: "Outro Teo", email: "TEO@x.com" })).status).toBe(409);
    expect((await chamar(item, "PATCH", { ...U, id: "tec1" }, { email: "novo@x.com" })).json.erro).toBe("Campo não permitido: email.");
  });

  it("com e-mail configurado o convite vai por e-mail e o link NÃO volta na resposta", async () => {
    email.ok = true;
    const r = await chamar(col, "POST", U, { nome: "Nina Nova", email: "nina@x.com" });
    expect(r.json.convite).toEqual({ enviadoPorEmail: true });
    expect(email.enviados[0]).toMatchObject({ tipo: "CONVITE_USUARIO", para: "nina@x.com" });
    expect(email.enviados[0].variaveis.link_definir_senha).toMatch(/definir-senha\?token=/);
  });

  it("não inativa o próprio usuário", async () => {
    const r = await chamar(item, "DELETE", { ...U, id: "admin" });
    expect(r.status).toBe(409);
    expect(r.json.erro).toBe("Você não pode inativar o seu próprio usuário.");
    expect((await chamar(impacto, "GET", { ...U, id: "admin" })).json.bloqueio).toMatch(/próprio usuário/);
  });

  it("não inativa o último administrador ativo", async () => {
    logar("gerente", "OPERADOR", permissoesTotais());
    const r = await chamar(item, "DELETE", { ...U, id: "admin" });
    expect(r.status).toBe(409);
    expect(r.json.erro).toMatch(/último administrador ativo/);
    expect(linha("usuario", "admin").ativo).toBe(true);
    // com outro administrador ativo, pode
    db.t.usuario.push({ id: "admin2", empresaId: "e1", nome: "Beto", email: "beto@x.com", senha: "x", role: "ADMIN", ativo: true, perfilAcessoId: null });
    expect((await chamar(item, "DELETE", { ...U, id: "admin" })).status).toBe(200);
  });

  it("inativar e reativar outro usuário (com impacto: OS em aberto)", async () => {
    const imp = (await chamar(impacto, "GET", { ...U, id: "tec1" })).json;
    expect(imp.avisos).toContain("É responsável por 1 OS em aberto: reatribua se for o caso.");
    expect((await chamar(item, "DELETE", { ...U, id: "tec1" })).status).toBe(200);
    expect(linha("usuario", "tec1").ativo).toBe(false);
    expect((await chamar(item, "PATCH", { ...U, id: "tec1" }, { ativo: true })).status).toBe(200);
    expect(linha("usuario", "tec1").ativo).toBe(true);
  });

  it("de outra empresa: 404; sem Configurações › gerenciar: 403", async () => {
    expect((await chamar(item, "DELETE", { ...U, id: "uB" })).status).toBe(404);
    logar("tec1", "OPERADOR", PRESETS.TECNICO);
    expect((await chamar(col, "GET", U)).status).toBe(403);
    expect((await chamar(col, "POST", U, { nome: "X", email: "x@x.com" })).status).toBe(403);
  });

  describe("anti-autopromoção (C3)", () => {
    beforeEach(() => logar("gerente", "OPERADOR", SUPERVISOR_CONFIG));
    const vincular = (id: string, perfilAcessoId: string | null) => chamar(() => import("@/app/api/usuarios/[id]/route"), "PUT", { id }, { perfilAcessoId });
    it("ninguém altera o próprio perfil (nem para 'sem perfil')", async () => {
      expect((await vincular("gerente", null)).status).toBe(403);
      expect(linha("usuario", "gerente").perfilAcessoId).toBe("p-sup");
    });
    it("não-admin não atribui o perfil Administrador a outra pessoa", async () => {
      expect((await vincular("tec1", "p-admin")).status).toBe(403);
    });
    it("não-admin não mexe em quem tem mais acesso que ele (nem inativa)", async () => {
      expect((await vincular("fin", null)).status).toBe(403);
      expect((await chamar(item, "DELETE", { ...U, id: "fin" })).json.erro).toMatch(/só um administrador pode inativá-lo/);
    });
    it("perfil de outra empresa é recusado", async () => {
      expect((await vincular("tec1", "pB")).status).toBe(400);
    });
    it("não-admin atribui perfil menor que o seu; admin atribui o perfil Administrador", async () => {
      expect((await vincular("tec2", "p-tec")).status).toBe(200);
      expect((await vincular("velho", "p-tec")).status).toBe(200);
      expect(linha("usuario", "velho").perfilAcessoId).toBe("p-tec");
      logar("admin", "ADMIN");
      expect((await vincular("tec1", "p-admin")).status).toBe(200);
    });
    it("criar usuário com perfil maior que o seu = 403", async () => {
      expect((await chamar(col, "POST", U, { nome: "Novo", email: "novo@x.com", perfilAcessoId: "p-admin" })).status).toBe(403);
    });
  });

  describe("reenviar convite", () => {
    const convite = (id: string) => chamar(() => import("@/app/api/usuarios/[id]/convite/route"), "POST", { id });
    it("quem nunca entrou: devolve o link (sem e-mail configurado)", async () => {
      expect((await convite("tec2")).json.link).toMatch(/definir-senha\?token=/);
    });
    it("quem já usa o sistema: link NUNCA volta para quem pediu (só por e-mail)", async () => {
      const r = await convite("tec1");
      expect(r.status).toBe(409);
      expect(r.json.link).toBeUndefined();
      email.ok = true;
      expect((await convite("tec1")).json).toEqual({ enviadoPorEmail: true });
    });
    it("para si mesmo, para inativo e para quem tem mais acesso: recusado", async () => {
      expect((await convite("admin")).status).toBe(400);
      linha("usuario", "tec2").ativo = false;
      expect((await convite("tec2")).status).toBe(409);
      logar("gerente", "OPERADOR", SUPERVISOR_CONFIG);
      expect((await convite("fin")).status).toBe(403);
    });
  });
});

// ═════════════════════════ Colaborador ↔ usuário; select de status ═════════════════════════
describe("colaborador: inativar o usuário de login junto (função real de Usuários)", () => {
  const tecnico = () => import("@/app/api/tecnicos/[id]/route");
  it("impacto aponta o usuário vinculado; inativar junto usa as travas de Usuários", async () => {
    const imp = (await chamar(() => import("@/app/api/tecnicos/[id]/impacto/route"), "GET", { id: "t1" })).json;
    expect(imp.usuarioVinculado).toMatchObject({ id: "tec1", email: "teo@x.com" });
    expect((await chamar(tecnico, "DELETE", { id: "t1" }, { inativarUsuario: true, motivo: "Desligado" })).json).toMatchObject({ ok: true, usuarioInativado: true });
    expect(linha("tecnico", "t1")).toMatchObject({ ativo: false, statusColaborador: "INATIVO" });
    expect(linha("usuario", "tec1").ativo).toBe(false);
  });
  it("trava do usuário (o próprio) impede tudo — o colaborador não é inativado pela metade", async () => {
    const r = await chamar(tecnico, "DELETE", { id: "tAdm" }, { inativarUsuario: true });
    expect(r.status).toBe(409);
    expect(r.json.erro).toMatch(/^Usuário de login: Você não pode inativar o seu próprio usuário/);
    expect(linha("tecnico", "tAdm").ativo).toBe(true);
  });
  it("sem Configurações › gerenciar não inativa o usuário (403) e nada muda", async () => {
    logar("sup", "OPERADOR", { ...PRESETS.SUPERVISOR, equipes: { visualizar: true, gerenciar: true, excluir: true } });
    expect((await chamar(tecnico, "DELETE", { id: "t1" }, { inativarUsuario: true })).status).toBe(403);
    expect(linha("tecnico", "t1").ativo).toBe(true);
  });
});

describe("select de status passa pela função única (impacto, motivo e anotação)", () => {
  const tecnico = () => import("@/app/api/tecnicos/[id]/route");
  const base = { nome: "Caio", cpf: "11111111111", telefone: "11999999999", perfilAcessoId: "p-tec" };
  it("colaborador: status INATIVO inativa com anotação e motivo; sair de INATIVO reativa", async () => {
    const r = await chamar(tecnico, "PUT", { id: "t1" }, { ...base, statusColaborador: "INATIVO", motivoInativacao: "Pediu demissão" });
    expect(r.status).toBe(200);
    expect(linha("tecnico", "t1")).toMatchObject({ ativo: false, statusColaborador: "INATIVO" });
    expect(linha("tecnico", "t1").observacoes).toMatch(/Inativado [\s\S]*Pediu demissão/);
    const volta = await chamar(tecnico, "PUT", { id: "t3" }, { nome: "Eva", cpf: "33333333333", telefone: "11999999999", statusColaborador: "FERIAS" });
    expect(volta.status).toBe(200);
    expect(linha("tecnico", "t3")).toMatchObject({ ativo: true, statusColaborador: "FERIAS" });
  });
  it("colaborador: inativar pelo status sem permissão de excluir = 403", async () => {
    logar("sup", "OPERADOR", { ...PRESETS.SUPERVISOR, equipes: { visualizar: true, gerenciar: true } });
    expect((await chamar(tecnico, "PUT", { id: "t1" }, { ...base, statusColaborador: "INATIVO" })).status).toBe(403);
    expect(linha("tecnico", "t1").ativo).toBe(true);
  });
  it("equipe: status INATIVA pelo formulário anota o motivo; botão e reativar usam a mesma função", async () => {
    const equipe = () => import("@/app/api/equipes/[id]/route");
    const r = await chamar(equipe, "PUT", { id: "eq1" }, { nome: "Equipe Norte", status: "INATIVA", motivoInativacao: "Unificada com a Sul" });
    expect(r.status).toBe(200);
    expect(linha("equipe", "eq1")).toMatchObject({ status: "INATIVA" });
    expect(linha("equipe", "eq1").observacoes).toMatch(/Inativada [\s\S]*Unificada com a Sul/);
    expect((await chamar(equipe, "PATCH", { id: "eq1" }, { ativo: true })).status).toBe(200);
    expect(linha("equipe", "eq1").status).toBe("ATIVA");
    expect((await chamar(equipe, "DELETE", { id: "eq1" }, { motivo: "Encerrada" })).status).toBe(200);
    expect(linha("equipe", "eq1").observacoes).toMatch(/Encerrada/);
  });
});
