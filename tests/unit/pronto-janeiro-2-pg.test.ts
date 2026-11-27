/**
 * "Pronto pra janeiro 2" — rotas e regras reais com o Prisma real num PostgreSQL real (schema
 * descartável via `prisma db push`). Dados fictícios.
 *  B/A/C — "Nova empresa" do super admin: empresa + configuração + 5 perfis + 6 tipos de OS + 1º
 *          administrador, numa transação; só o dono do Frivo entra; CNPJ e e-mail de login únicos;
 *          "Usar modelos sugeridos" cria só os tipos que faltam.
 *  D — "Cliente aprovou" registrado pela equipe: quem, por onde, sem assinatura; travas de status,
 *      validade e permissão; linha do tempo.
 *  F — concluir a ÚLTIMA atividade aberta marca os itens da OS como executados (com histórico); o
 *      escritório desmarca; registro fechado não desmarca.
 *  G — "Cheguei" pelo app inicia a atividade e leva a OS para Em execução; status manual é respeitado.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/pronto-janeiro-2-pg
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import bcrypt from "bcryptjs";
import { NextRequest } from "next/server";
import { PRESETS, montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_pronto_jan2_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
vi.mock("resend", () => ({ Resend: class { emails = { send: async () => ({ data: { id: "x" } }) }; } }));

const como = (role: string, permissoes: Permissoes = permissoesTotais(), id = "uA", empresaId = "e1", extra: Record<string, unknown> = {}) => {
  sessao.atual = { user: { id, name: "Marina Teste", email: `${id}@ficticio.test`, empresaId, role, permissoes, tecnicoId: null, ...extra } };
};
const semSessao = () => { sessao.atual = null; };

async function chamar(rota: string, metodo: string, params: Record<string, string> = {}, corpo?: unknown) {
  const mod = await import(/* @vite-ignore */ `@/app/api/${rota}/route`);
  const req = new NextRequest("http://localhost/api/x", { method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const res: Response = metodo === "GET" && !Object.keys(params).length ? await mod[metodo](req) : await mod[metodo](req, { params: Promise.resolve(params) });
  return { status: res.status, json: (res.headers.get("content-type") ?? "").includes("json") ? await res.json() : null };
}

const NOVA = {
  razaoSocial: "Climatização Horizonte Ltda (fictícia)", nomeFantasia: "Horizonte Clima", cnpj: "11.222.333/0001-81",
  email: "Contato@Horizonte.Ficticio", telefone: "(11) 4000-0000",
  admin: { nome: "Beatriz Fictícia", email: "Beatriz@Horizonte.Ficticio", senha: "Horizonte@2027" },
};

describe.skipIf(!URL_PG)("Pronto pra janeiro 2 (PostgreSQL real)", () => {
  let prisma: any;

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    process.env.NEXTAUTH_SECRET ||= "segredo-de-teste-0123456789abcdef";
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    await Promise.all([
      "admin/empresas", "tipos-os/modelos", "orcamentos/[id]/aprovacao-equipe", "ordens/[id]/orcamento/[itemId]", "tecnico/sync",
    ].map((r) => import(/* @vite-ignore */ `@/app/api/${r}/route`)));

    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Refrigeração Teste Ltda (fictícia)", nomeFantasia: "Refri Teste", cnpj: "45.723.174/0001-10", email: "e1@ficticio.test" },
      { id: "e2", nome: "Outra Empresa Fictícia", cnpj: "04.252.011/0001-10", email: "e2@ficticio.test" },
    ] });
    await prisma.usuario.createMany({ data: [
      { id: "uA", empresaId: "e1", nome: "Marina Teste", email: "marina@ficticio.test", senha: "x", role: "ADMIN" },
      { id: "uDono", empresaId: "e1", nome: "Dono do Frivo", email: "dono@ficticio.test", senha: "x", role: "SUPER_ADMIN" },
      { id: "uT", empresaId: "e1", nome: "Diego Técnico", email: "diego@ficticio.test", senha: "x", role: "TECNICO" },
      { id: "uB", empresaId: "e2", nome: "Usuário da outra", email: "ja-existe@ficticio.test", senha: "x" },
    ] });
    await prisma.tecnico.create({ data: { id: "t1", empresaId: "e1", nome: "Diego Técnico", cpf: "1", telefone: "1", email: "diego@ficticio.test" } });
    await prisma.cliente.createMany({ data: [
      { id: "c1", empresaId: "e1", nome: "Padaria Fictícia", cpfCnpj: "1" },
      { id: "c2", empresaId: "e2", nome: "Cliente da outra", cpfCnpj: "2" },
    ] });
  }, 180_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  /* ───────────────────────── B / A / C ───────────────────────── */
  describe("Nova empresa (super admin)", () => {
    it("só o dono do Frivo: sem sessão 401; ADMIN de empresa-cliente 403 (listar e criar)", async () => {
      semSessao();
      expect((await chamar("admin/empresas", "GET")).status).toBe(401);
      como("ADMIN");
      const lista = await chamar("admin/empresas", "GET");
      expect(lista.status).toBe(403);
      expect(lista.json.erro).toBe("A área de Empresas é do administrador do Frivo.");
      expect((await chamar("admin/empresas", "POST", {}, NOVA)).status).toBe(403);
      expect(await prisma.empresa.count({ where: { cnpj: "11.222.333/0001-81" } })).toBe(0);
    });

    it("cria tudo de uma vez: empresa, configuração, 5 perfis dos presets, 6 tipos de OS e o 1º administrador", async () => {
      como("SUPER_ADMIN", permissoesTotais(), "uDono");
      const r = await chamar("admin/empresas", "POST", {}, NOVA);
      expect(r.status).toBe(201);
      expect(r.json).toMatchObject({ ok: true, adminEmail: "beatriz@horizonte.ficticio", perfis: 5, tiposOs: 6 });
      const id = r.json.empresaId;

      const empresa = await prisma.empresa.findUnique({ where: { id } });
      expect(empresa).toMatchObject({ nome: "Climatização Horizonte Ltda (fictícia)", nomeFantasia: "Horizonte Clima", cnpj: "11.222.333/0001-81", email: "contato@horizonte.ficticio" });
      expect(await prisma.configuracao.count({ where: { empresaId: id } })).toBe(1);

      const perfis = await prisma.perfilAcesso.findMany({ where: { empresaId: id }, orderBy: { nome: "asc" } });
      expect(perfis.map((p: any) => [p.nome, p.tipo])).toEqual([
        ["Administrador", "ADMINISTRADOR"], ["Financeiro", "FINANCEIRO"], ["Gestor", "SUPERVISOR"], ["Técnico", "TECNICO"], ["Vendas", "PERSONALIZADO"],
      ]);
      expect(perfis.every((p: any) => p.padraoSistema && p.ativo)).toBe(true);
      const por = (n: string) => perfis.find((p: any) => p.nome === n);
      // Gestor = preset Supervisor; Vendas = exatamente o combinado (sem financeiro, sem configurações)
      expect(por("Gestor").permissoes).toEqual(JSON.parse(JSON.stringify(PRESETS.SUPERVISOR)));
      expect(por("Vendas").permissoes).toEqual(JSON.parse(JSON.stringify(montarPermissoes({
        dashboard: ["visualizar"], clientes: ["visualizar", "criar", "editar"], orcamentos: ["visualizar", "criar", "editar"], contratos: ["visualizar"],
      }))));
      expect(perfis.some((p: any) => p.nome === "Auxiliar")).toBe(false);

      const tipos = await prisma.tipoOs.findMany({ where: { empresaId: id }, orderBy: { nome: "asc" } });
      expect(tipos.map((t: any) => [t.nome, t.exigeEquipamento])).toEqual([
        ["Instalação", false], ["Manutenção Corretiva", false], ["Manutenção Preventiva", true], ["Orçamento/Vistoria", false], ["PMOC", true], ["Visita Técnica", false],
      ]);

      const admin = await prisma.usuario.findFirst({ where: { empresaId: id } });
      expect(admin).toMatchObject({ nome: "Beatriz Fictícia", email: "beatriz@horizonte.ficticio", role: "ADMIN", ativo: true, perfilAcessoId: por("Administrador").id });
      // Senha inicial guardada com hash (o administrador troca em Meu perfil › Senha)
      expect(admin.senha).not.toBe(NOVA.admin.senha);
      expect(await bcrypt.compare(NOVA.admin.senha, admin.senha)).toBe(true);

      // A lista mínima mostra a nova empresa, sem nada de dentro dela além do nº de usuários
      const lista = await chamar("admin/empresas", "GET");
      const linha = lista.json.empresas.find((e: any) => e.id === id);
      expect(Object.keys(linha).sort()).toEqual(["ativo", "cnpj", "criadoEm", "id", "nome", "nomeFantasia", "usuarios"]);
      expect(linha.usuarios).toBe(1);
    });

    it("CNPJ repetido (com ou sem máscara) e e-mail de login já usado em OUTRA empresa: 409, nada criado", async () => {
      como("SUPER_ADMIN", permissoesTotais(), "uDono");
      const antes = await prisma.empresa.count();
      const cnpj = await chamar("admin/empresas", "POST", {}, { ...NOVA, cnpj: "11222333000181", admin: { ...NOVA.admin, email: "outra@ficticio.test" } });
      expect(cnpj).toMatchObject({ status: 409, json: { erro: "Já existe uma empresa com este CNPJ." } });
      const email = await chamar("admin/empresas", "POST", {}, { ...NOVA, cnpj: "11.444.777/0001-61", admin: { ...NOVA.admin, email: "JA-EXISTE@ficticio.test" } });
      expect(email.status).toBe(409);
      expect(email.json.erro).toContain("já é login de outro usuário");
      expect(await prisma.empresa.count()).toBe(antes);
    });

    it("validação: CNPJ inválido, senha fraca e campo desconhecido são recusados (400)", async () => {
      como("SUPER_ADMIN", permissoesTotais(), "uDono");
      expect((await chamar("admin/empresas", "POST", {}, { ...NOVA, cnpj: "11.222.333/0001-00" })).json).toMatchObject({ erro: "CNPJ inválido.", campo: "cnpj" });
      const fraca = await chamar("admin/empresas", "POST", {}, { ...NOVA, cnpj: "11.444.777/0001-61", admin: { ...NOVA.admin, email: "x@y.ficticio", senha: "123" } });
      expect(fraca.status).toBe(400);
      expect(fraca.json.campo).toBe("admin.senha");
      expect((await chamar("admin/empresas", "POST", {}, { ...NOVA, role: "SUPER_ADMIN" })).status).toBe(400);
    });

    it("completar padrões não duplica nem mexe no que existe (mesmo nome sem acento/caixa)", async () => {
      const { completarPadroesDaEmpresa } = await import("@/lib/empresa/criar-empresa");
      await prisma.empresa.create({ data: { id: "eAntiga", nome: "Empresa Antiga Fictícia", cnpj: "03.778.130/0001-48", email: "antiga@ficticio.test" } });
      await prisma.perfilAcesso.create({ data: { empresaId: "eAntiga", nome: "administrador", tipo: "PERSONALIZADO", permissoes: { dashboard: { visualizar: true } } } });
      await prisma.tipoOs.create({ data: { empresaId: "eAntiga", nome: "manutencao preventiva", exigeEquipamento: false } });
      const r1 = await completarPadroesDaEmpresa(prisma, "eAntiga");
      expect(r1).toEqual({ perfis: 4, tiposOs: 5 });
      const r2 = await completarPadroesDaEmpresa(prisma, "eAntiga");
      expect(r2).toEqual({ perfis: 0, tiposOs: 0 });
      // O que já existia ficou como estava
      expect(await prisma.perfilAcesso.findFirst({ where: { empresaId: "eAntiga", nome: "administrador" } })).toMatchObject({ tipo: "PERSONALIZADO", permissoes: { dashboard: { visualizar: true } } });
      expect(await prisma.tipoOs.findFirst({ where: { empresaId: "eAntiga", nome: "manutencao preventiva" } })).toMatchObject({ exigeEquipamento: false });
    });

    it("Usar modelos sugeridos: GET conta o que falta, POST cria só isso; sem Configurações › Gerenciar, 403", async () => {
      como("OPERADOR", montarPermissoes({ dashboard: ["visualizar"] }));
      expect((await chamar("tipos-os/modelos", "GET")).status).toBe(403);
      expect((await chamar("tipos-os/modelos", "POST", {})).status).toBe(403);

      como("ADMIN");
      const g = await chamar("tipos-os/modelos", "GET");
      expect(g.json.total).toBe(0);
      expect(g.json.faltando).toHaveLength(6);
      expect((await chamar("tipos-os/modelos", "POST", {})).json).toEqual({ criados: 6 });
      expect((await chamar("tipos-os/modelos", "POST", {})).json).toEqual({ criados: 0 });
      expect(await prisma.tipoOs.count({ where: { empresaId: "e1" } })).toBe(6);
      // Só na empresa da sessão
      expect(await prisma.tipoOs.count({ where: { empresaId: "e2" } })).toBe(0);
    });
  });

  /* ───────────────────────── D ───────────────────────── */
  describe("Cliente aprovou (registrado pela equipe)", () => {
    let n = 0;
    async function orcamento(extra: Record<string, unknown> = {}, empresaId = "e1", clienteId = "c1") {
      const id = `orc${++n}`;
      await prisma.orcamento.create({ data: { id, empresaId, codigo: `ORC-${n}`, nome: `Orçamento ${n}`, clienteId, criadoPorId: empresaId === "e1" ? "uA" : "uB", tokenPublico: randomUUID(), status: "ENVIADO", ...extra } });
      return id;
    }
    const aprovar = (id: string, corpo: unknown) => chamar("orcamentos/[id]/aprovacao-equipe", "POST", { id }, corpo);
    const CORPO = { nome: "Sr. Paulo (fictício)", canal: "TELEFONE", observacao: "Ligou às 10h" };

    beforeEach(() => como("OPERADOR", permissoesTotais(), "uA"));

    it("ENVIADO → APROVADO com quem aprovou, sem CPF/assinatura/IP; a linha do tempo diz quem registrou e por onde", async () => {
      const id = await orcamento({ assinadoCpf: "lixo", aprovadoIp: "1.2.3.4" });
      const r = await aprovar(id, CORPO);
      expect(r).toMatchObject({ status: 200, json: { ok: true, status: "APROVADO" } });
      const o = await prisma.orcamento.findUnique({ where: { id } });
      expect(o).toMatchObject({ status: "APROVADO", assinadoPor: "Sr. Paulo (fictício)", assinadoCpf: null, assinaturaUrl: null, aprovadoIp: null, aprovadoUserAgent: null });
      expect(o.assinadoEm).toBeInstanceOf(Date);
      expect(o.respostaVistaEm).toBeInstanceOf(Date);
      const ev = await prisma.orcamentoEvento.findFirst({ where: { orcamentoId: id, tipo: "APROVADO" } });
      expect(ev).toMatchObject({ usuarioId: "uA", detalhe: "Sr. Paulo (fictício) (por telefone) · registrado por Marina Teste — Ligou às 10h" });
    });

    it("RASCUNHO também pode; APROVADO de novo, REPROVADO e validade vencida não", async () => {
      expect((await aprovar(await orcamento({ status: "RASCUNHO" }), { nome: "Ana", canal: "WHATSAPP" })).status).toBe(200);
      const ja = await orcamento({ status: "APROVADO" });
      expect(await aprovar(ja, CORPO)).toMatchObject({ status: 400, json: { erro: "Este orçamento já está aprovado." } });
      expect((await aprovar(await orcamento({ status: "REPROVADO" }), CORPO)).status).toBe(400);
      const vencido = await orcamento({ validadeEm: new Date(Date.now() - 3 * 86_400_000) });
      expect((await aprovar(vencido, CORPO)).status).toBe(410);
      expect((await prisma.orcamento.findUnique({ where: { id: vencido } })).status).toBe("ENVIADO");
    });

    it("dados obrigatórios: quem aprovou e o canal (400); campo extra recusado", async () => {
      const id = await orcamento();
      expect((await aprovar(id, { nome: "A", canal: "TELEFONE" })).json.erro).toBe("Informe quem aprovou.");
      expect((await aprovar(id, { nome: "Ana", canal: "POMBO" })).json.erro).toBe("Escolha por onde o cliente aprovou.");
      expect((await aprovar(id, { ...CORPO, assinadoCpf: "123" })).status).toBe(400);
      expect((await prisma.orcamento.findUnique({ where: { id } })).status).toBe("ENVIADO");
    });

    it("sem Orçamentos › Aprovar: 403; orçamento de outra empresa: 404", async () => {
      const id = await orcamento();
      como("OPERADOR", montarPermissoes({ orcamentos: ["visualizar", "criar", "editar"] }));
      expect((await aprovar(id, CORPO)).status).toBe(403);
      como("OPERADOR", permissoesTotais(), "uA");
      const deOutra = await orcamento({}, "e2", "c2");
      expect((await aprovar(deOutra, CORPO)).status).toBe(404);
      expect((await prisma.orcamento.findUnique({ where: { id: deOutra } })).status).toBe("ENVIADO");
    });

    it("dois cliques ao mesmo tempo: aprova uma vez só (um evento)", async () => {
      const id = await orcamento();
      const rs = await Promise.all([aprovar(id, CORPO), aprovar(id, CORPO)]);
      expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
      expect(await prisma.orcamentoEvento.count({ where: { orcamentoId: id, tipo: "APROVADO" } })).toBe(1);
    });
  });

  /* ───────────────────────── F ───────────────────────── */
  describe("Itens executados ao concluir a última atividade", () => {
    let n = 0;
    async function osCom(atividades: string[], itens = 2) {
      const osId = `osF${++n}`;
      await prisma.ordemServico.create({ data: { id: osId, empresaId: "e1", numero: `OS-F${n}`, clienteId: "c1", criadoPorId: "uA", descricao: "Instalação" } });
      for (const [i, status] of atividades.entries())
        await prisma.atividadeOs.create({ data: { id: `${osId}-a${i}`, empresaId: "e1", ordemServicoId: osId, titulo: `Atividade ${i}`, status } });
      for (let i = 0; i < itens; i++)
        await prisma.osItemOrcamento.create({ data: { id: `${osId}-i${i}`, ordemServicoId: osId, descricao: `Item ${i}`, quantidade: 1, valorUnitario: 100, valorTotal: 100 } });
      return osId;
    }
    const executados = async (osId: string) => prisma.osItemOrcamento.count({ where: { ordemServicoId: osId, executado: true } });

    it("ainda há atividade aberta: nada muda; todas concluídas/canceladas: marca os itens e deixa no histórico", async () => {
      const { marcarItensAoConcluirUltima, ACAO_HISTORICO_ITENS } = await import("@/lib/execucao/itens-ao-concluir");
      const { prisma: db } = await import("@/lib/prisma");
      const aberta = await osCom(["CONCLUIDA", "AGENDADA"]);
      expect(await marcarItensAoConcluirUltima("e1", aberta, "uT", new Date(), db)).toBe(0);
      expect(await executados(aberta)).toBe(0);

      const fechada = await osCom(["CONCLUIDA", "CANCELADA"], 3);
      await prisma.osItemOrcamento.update({ where: { id: `${fechada}-i0` }, data: { executado: true, executadoEm: new Date("2026-01-02T12:00:00Z") } });
      const em = new Date();
      expect(await marcarItensAoConcluirUltima("e1", fechada, "uT", em, db)).toBe(2);
      expect(await executados(fechada)).toBe(3);
      // O que já estava executado mantém a data de antes
      expect((await prisma.osItemOrcamento.findUnique({ where: { id: `${fechada}-i0` } })).executadoEm.toISOString()).toBe("2026-01-02T12:00:00.000Z");
      const h = await prisma.osHistorico.findFirst({ where: { ordemServicoId: fechada, acao: ACAO_HISTORICO_ITENS } });
      expect(h).toMatchObject({ usuarioId: "uT" });
      expect(h.detalhes).toContain("2");
      // Rodar de novo não repete o histórico
      expect(await marcarItensAoConcluirUltima("e1", fechada, "uT", em, db)).toBe(0);
      expect(await prisma.osHistorico.count({ where: { ordemServicoId: fechada, acao: ACAO_HISTORICO_ITENS } })).toBe(1);
    });

    it("o escritório desmarca (com histórico); registro fechado (aceite do cliente) não desmarca", async () => {
      como("OPERADOR", permissoesTotais(), "uA");
      const osId = await osCom(["CONCLUIDA"], 1);
      await prisma.osItemOrcamento.update({ where: { id: `${osId}-i0` }, data: { executado: true, executadoEm: new Date() } });
      const r = await chamar("ordens/[id]/orcamento/[itemId]", "PUT", { id: osId, itemId: `${osId}-i0` }, { executado: false });
      expect(r.status).toBe(200);
      expect(await prisma.osItemOrcamento.findUnique({ where: { id: `${osId}-i0` } })).toMatchObject({ executado: false, executadoEm: null });
      expect(await prisma.osHistorico.findFirst({ where: { ordemServicoId: osId, acao: "Item desmarcado como executado" } })).toMatchObject({ usuarioId: "uA", detalhes: "Item 0" });

      const assinada = await osCom(["CONCLUIDA"], 1);
      await prisma.osItemOrcamento.update({ where: { id: `${assinada}-i0` }, data: { executado: true, executadoEm: new Date() } });
      await prisma.osAceite.create({ data: { id: randomUUID(), empresaId: "e1", ordemServicoId: assinada, situacao: "CONFIRMADO", token: randomUUID() } });
      const travada = await chamar("ordens/[id]/orcamento/[itemId]", "PUT", { id: assinada, itemId: `${assinada}-i0` }, { executado: false });
      expect(travada.status).toBe(400);
      expect((await prisma.osItemOrcamento.findUnique({ where: { id: `${assinada}-i0` } })).executado).toBe(true);
    });

    it("sem Ordens › Editar: não desmarca (403)", async () => {
      como("OPERADOR", montarPermissoes({ ordens: ["visualizar"] }));
      const osId = await osCom(["CONCLUIDA"], 1);
      await prisma.osItemOrcamento.update({ where: { id: `${osId}-i0` }, data: { executado: true, executadoEm: new Date() } });
      expect((await chamar("ordens/[id]/orcamento/[itemId]", "PUT", { id: osId, itemId: `${osId}-i0` }, { executado: false })).status).toBe(403);
      expect((await prisma.osItemOrcamento.findUnique({ where: { id: `${osId}-i0` } })).executado).toBe(true);
    });
  });

  /* ───────────────────────── G ───────────────────────── */
  describe("Cheguei inicia a atividade (servidor)", () => {
    let n = 0;
    async function osAgendada(statusManual = false) {
      const osId = `osG${++n}`;
      await prisma.ordemServico.create({ data: { id: osId, empresaId: "e1", numero: `OS-G${n}`, clienteId: "c1", criadoPorId: "uA", descricao: "Visita", status: "AGENDADA", statusManual } });
      await prisma.atividadeOs.create({ data: { id: `${osId}-a`, empresaId: "e1", ordemServicoId: osId, titulo: "Visita técnica", tecnicoId: "t1", status: "AGENDADA", dataAgendada: new Date() } });
      return osId;
    }
    const toque = (evento: "A_CAMINHO" | "CHEGOU", atividadeId: string, em = Date.now()) =>
      ({ id: randomUUID(), tipo: "avisoCliente", atividadeId, em: new Date(em).toISOString(), dados: { evento } });
    const sync = async (ops: unknown[]) => (await chamar("tecnico/sync", "POST", {}, { operacoes: ops, agora: new Date().toISOString() })).json.resultados as any[];

    beforeEach(() => como("TECNICO", PRESETS.TECNICO, "uT", "e1", { tecnicoId: "t1" }));

    it("A caminho não muda nada; Cheguei: atividade Em andamento (hora do toque) e OS Em execução, com histórico", async () => {
      const osId = await osAgendada();
      const tocouEm = Date.now() - 60_000;
      await sync([toque("A_CAMINHO", `${osId}-a`)]);
      expect((await prisma.atividadeOs.findUnique({ where: { id: `${osId}-a` } })).status).toBe("AGENDADA");
      const [r] = await sync([toque("CHEGOU", `${osId}-a`, tocouEm)]);
      expect(r.ok).toBe(true);
      const a = await prisma.atividadeOs.findUnique({ where: { id: `${osId}-a` } });
      expect(a.status).toBe("EM_ANDAMENTO");
      expect(Math.abs(a.iniciadaEm.getTime() - tocouEm)).toBeLessThan(2000);
      expect((await prisma.ordemServico.findUnique({ where: { id: osId } })).status).toBe("EM_ANDAMENTO");
      expect(await prisma.osHistorico.findFirst({ where: { ordemServicoId: osId, acao: "Status da atividade alterado" } })).toMatchObject({ usuarioId: "uT" });
    });

    it("Cheguei repetido não reinicia; OS com status manual fica como o escritório deixou", async () => {
      const osId = await osAgendada(true);
      await sync([toque("CHEGOU", `${osId}-a`)]);
      const primeiro = (await prisma.atividadeOs.findUnique({ where: { id: `${osId}-a` } })).iniciadaEm;
      await sync([toque("CHEGOU", `${osId}-a`)]);
      expect((await prisma.atividadeOs.findUnique({ where: { id: `${osId}-a` } })).iniciadaEm.getTime()).toBe(primeiro.getTime());
      expect(await prisma.osHistorico.count({ where: { ordemServicoId: osId, acao: "Status da atividade alterado" } })).toBe(1);
      expect((await prisma.ordemServico.findUnique({ where: { id: osId } })).status).toBe("AGENDADA");
    });
  });
});
