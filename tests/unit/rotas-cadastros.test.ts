/**
 * Leva 4 (C4, restante): cadastros, configurações, QR, checklists, colaboradores e prazos da OS
 * exigem a permissão do perfil. Rotas reais, checagem de permissão real; banco e sessão simulados.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PRESETS, permissoesTotais, permissoesVazias, type Permissoes } from "@/lib/permissoes";

const chamadas = vi.hoisted(() => [] as string[]);
vi.mock("@/lib/prisma", () => {
  const model = (nome: string) => new Proxy({}, {
    get: (_t, metodo: string) => async () => {
      chamadas.push(`${nome}.${metodo}`);
      if (metodo === "findMany") return [];
      if (metodo === "count") return 0;
      return null;
    },
  });
  const prisma: any = new Proxy({}, { get: (_t, nome: string) => (nome === "$transaction" ? async (fn: any) => (typeof fn === "function" ? fn(prisma) : []) : model(nome)) });
  return { prisma };
});
const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
// A rota de QR importa helpers do portal; o login do portal não participa destes testes.
vi.mock("@/lib/auth-portal", () => ({ getPortalSession: vi.fn(async () => null), portalAuth: vi.fn(async () => null) }));

const logar = (permissoes: Permissoes, role = "OPERADOR") => { sessao.atual = { user: { id: "u1", empresaId: "e1", role, permissoes } }; };
beforeEach(() => { chamadas.length = 0; });

type Metodo = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
type Caso = [nome: string, carregar: () => Promise<any>, metodo: Metodo, params?: Record<string, string>];

async function chamar([, carregar, metodo, params]: Caso) {
  const mod = await carregar();
  const temCorpo = metodo !== "GET" && metodo !== "DELETE";
  const req = new NextRequest("http://localhost/api/x?clienteId=c1", {
    method: metodo, headers: { "Content-Type": "application/json" }, body: temCorpo ? "{}" : undefined,
  });
  return (mod[metodo] as any)(req, { params: Promise.resolve(params ?? { id: "x1" }) }) as Promise<Response>;
}
/** true se passou da checagem de permissão (resposta diferente de 401/403, ou erro depois dela). */
async function passou(c: Caso) {
  try { const r = await chamar(c); return r.status !== 401 && r.status !== 403; } catch { return true; }
}

const r = {
  unidades: () => import("@/app/api/unidades/route"),
  unidade: () => import("@/app/api/unidades/[id]/route"),
  qrcodes: () => import("@/app/api/qrcodes/route"),
  qrcode: () => import("@/app/api/qrcodes/[id]/route"),
  tabelas: () => import("@/app/api/tabelas-preco/route"),
  tabela: () => import("@/app/api/tabelas-preco/[id]/route"),
  servicos: () => import("@/app/api/servicos/route"),
  servico: () => import("@/app/api/servicos/[id]/route"),
  produtos: () => import("@/app/api/produtos/route"),
  produto: () => import("@/app/api/produtos/[id]/route"),
  tiposOs: () => import("@/app/api/tipos-os/route"),
  tipoOs: () => import("@/app/api/tipos-os/[id]/route"),
  tiposProblema: () => import("@/app/api/tipos-problema/route"),
  tipoProblema: () => import("@/app/api/tipos-problema/[id]/route"),
  formularios: () => import("@/app/api/formularios/route"),
  formulario: () => import("@/app/api/formularios/[id]/route"),
  formHistorico: () => import("@/app/api/formularios/[id]/historico/route"),
  formVinculos: () => import("@/app/api/formularios/[id]/vinculos/route"),
  termos: () => import("@/app/api/termo-templates/route"),
  termo: () => import("@/app/api/termo-templates/[id]/route"),
  prazosTpl: () => import("@/app/api/prazo-templates/route"),
  prazoTpl: () => import("@/app/api/prazo-templates/[id]/route"),
  checklistTpls: () => import("@/app/api/checklist-templates/route"),
  checklistTpl: () => import("@/app/api/checklist-templates/[id]/route"),
  checklists: () => import("@/app/api/checklists/route"),
  tipoEquipForms: () => import("@/app/api/tipos-equipamento/[id]/formularios/route"),
  tipoEquipForm: () => import("@/app/api/tipos-equipamento/[id]/formularios/[mappingId]/route"),
  logo: () => import("@/app/api/empresa/logo/route"),
  tecnico: () => import("@/app/api/tecnicos/[id]/route"),
  localizacao: () => import("@/app/api/tecnicos/[id]/localizacao/route"),
  proximos: () => import("@/app/api/tecnicos/proximos/route"),
  osPrazo: () => import("@/app/api/os-prazos/[id]/route"),
  osPrazoAvancar: () => import("@/app/api/os-prazos/[id]/avancar/route"),
};

/** Ações que o Auxiliar (só vê OS/equipamentos/calendário, faz checklist) NÃO pode fazer. */
const RESTRITAS: Caso[] = [
  ["POST unidades", r.unidades, "POST"],
  ["PUT unidade", r.unidade, "PUT"],
  ["DELETE unidade", r.unidade, "DELETE"],
  ["POST qrcodes (gerar lote)", r.qrcodes, "POST"],
  ["PATCH qrcode", r.qrcode, "PATCH"],
  ["DELETE qrcode", r.qrcode, "DELETE"],
  ["POST tabelas-preco", r.tabelas, "POST"],
  ["PUT tabela-preco", r.tabela, "PUT"],
  ["DELETE tabela-preco", r.tabela, "DELETE"],
  ["POST servicos", r.servicos, "POST"],
  ["PUT servico", r.servico, "PUT"],
  ["DELETE servico", r.servico, "DELETE"],
  ["POST produtos", r.produtos, "POST"],
  ["PUT produto", r.produto, "PUT"],
  ["DELETE produto", r.produto, "DELETE"],
  ["POST tipos-os", r.tiposOs, "POST"],
  ["PUT tipo-os", r.tipoOs, "PUT"],
  ["DELETE tipo-os", r.tipoOs, "DELETE"],
  ["POST tipos-problema", r.tiposProblema, "POST"],
  ["PUT tipo-problema", r.tipoProblema, "PUT"],
  ["DELETE tipo-problema", r.tipoProblema, "DELETE"],
  ["GET formularios", r.formularios, "GET"],
  ["POST formularios", r.formularios, "POST"],
  ["PUT formulario", r.formulario, "PUT"],
  ["DELETE formulario", r.formulario, "DELETE"],
  ["GET formulario/historico", r.formHistorico, "GET"],
  ["GET formulario/vinculos", r.formVinculos, "GET"],
  ["GET termo-templates", r.termos, "GET"],
  ["POST termo-templates", r.termos, "POST"],
  ["PUT termo-template", r.termo, "PUT"],
  ["DELETE termo-template", r.termo, "DELETE"],
  ["POST prazo-templates", r.prazosTpl, "POST"],
  ["PUT prazo-template", r.prazoTpl, "PUT"],
  ["DELETE prazo-template", r.prazoTpl, "DELETE"],
  ["POST checklist-templates", r.checklistTpls, "POST"],
  ["PUT checklist-template", r.checklistTpl, "PUT"],
  ["DELETE checklist-template", r.checklistTpl, "DELETE"],
  ["GET tipo-equipamento/formularios", r.tipoEquipForms, "GET"],
  ["POST tipo-equipamento/formularios", r.tipoEquipForms, "POST"],
  ["PUT tipo-equipamento/formulario", r.tipoEquipForm, "PUT", { id: "x1", mappingId: "m1" }],
  ["DELETE tipo-equipamento/formulario", r.tipoEquipForm, "DELETE", { id: "x1", mappingId: "m1" }],
  ["PUT empresa/logo", r.logo, "PUT"],
  ["DELETE empresa/logo", r.logo, "DELETE"],
  ["GET tecnico/[id] (salário, CPF, documentos)", r.tecnico, "GET"],
  ["POST tecnico/localizacao", r.localizacao, "POST"],
  ["GET tecnicos/proximos", r.proximos, "GET"],
  ["DELETE os-prazo (cancelar etapa)", r.osPrazo, "DELETE"],
  ["POST os-prazo/avancar", r.osPrazoAvancar, "POST"],
];

describe("auxiliar é barrado nas ações restritas", () => {
  it.each(RESTRITAS)("%s → 403", async (...c) => {
    logar(PRESETS.AUXILIAR);
    expect((await chamar(c as Caso)).status).toBe(403);
    expect(chamadas).toEqual([]); // nada lido/gravado antes da recusa
  });
});

describe("administrador continua com acesso", () => {
  it.each(RESTRITAS)("%s passa da permissão", async (...c) => {
    logar(permissoesTotais());
    expect(await passou(c as Caso)).toBe(true);
  });
});

describe("leituras de catálogo continuam abertas a qualquer logado (usadas em OS/orçamento/contrato)", () => {
  const CATALOGOS: Caso[] = [
    ["GET servicos", r.servicos, "GET"],
    ["GET produtos", r.produtos, "GET"],
    ["GET tipos-os", r.tiposOs, "GET"],
    ["GET tipos-problema", r.tiposProblema, "GET"],
    ["GET tabelas-preco", r.tabelas, "GET"],
    ["GET prazo-templates", r.prazosTpl, "GET"],
    // Leva 3: o registro único segue a regra da lista (mesmos dados, que o auxiliar já lê)
    ["GET prazo-template", r.prazoTpl, "GET"],
  ];
  it.each(CATALOGOS)("%s → auxiliar lê", async (...c) => {
    logar(PRESETS.AUXILIAR);
    expect(await passou(c as Caso)).toBe(true);
  });
});

describe("usos legítimos fora de Configurações", () => {
  it("unidades do cliente: quem vê OS lê; quem não tem nenhum módulo, não", async () => {
    logar(PRESETS.AUXILIAR);
    expect((await chamar(["", r.unidades, "GET"])).status).toBe(200);
    logar(permissoesVazias());
    expect((await chamar(["", r.unidades, "GET"])).status).toBe(403);
  });

  it("técnico lista QR livres para vincular ao equipamento (equipamentos.editar)", async () => {
    logar(PRESETS.TECNICO);
    expect((await chamar(["", r.qrcodes, "GET"])).status).toBe(200);
    expect((await chamar(["", r.qrcodes, "POST"])).status).toBe(403);
  });

  it("checklist de veículo: auxiliar preenche (veiculos.checklist); financeiro não", async () => {
    logar(PRESETS.AUXILIAR);
    expect(await passou(["", r.checklists, "POST"])).toBe(true);
    logar(PRESETS.FINANCEIRO);
    expect((await chamar(["", r.checklists, "POST"])).status).toBe(403);
  });

  it("modelos de checklist: supervisor de frota (veiculos.gerenciar) edita", async () => {
    logar(PRESETS.SUPERVISOR);
    expect(await passou(["", r.checklistTpls, "POST"])).toBe(true);
  });

  it("prazos da OS: técnico (ordens.editar) avança etapa", async () => {
    logar(PRESETS.TECNICO);
    expect(await passou(["", r.osPrazoAvancar, "POST"])).toBe(true);
  });

  it("ficha do colaborador: supervisor (equipes.gerenciar) vê; técnico não", async () => {
    logar(PRESETS.SUPERVISOR);
    expect(await passou(["", r.tecnico, "GET"])).toBe(true);
    logar(PRESETS.TECNICO);
    expect((await chamar(["", r.tecnico, "GET"])).status).toBe(403);
  });
});
