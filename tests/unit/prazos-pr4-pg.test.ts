/**
 * Prazos da OS — PR 4 (prazo de atendimento do contrato), pelas rotas reais com o Prisma real num
 * PostgreSQL real (schema descartável via `prisma db push`). Prova:
 *  - CONTRATO: as promessas por prioridade entram e saem pelo cadastro do contrato; salvar sem o campo
 *    não apaga; a proposta aprovada vira contrato já com o prazo que prometeu; quem não edita
 *    contrato não mexe; salvar o contrato nunca reescreve OS;
 *  - CHAMADO: o portal e o QR gravam a hora da abertura; o aceite (que define contrato e prioridade)
 *    fixa "comparecer até" e "resolver até" contados DA ABERTURA, não do aceite; sem contrato ou sem
 *    promessa para a prioridade, a OS fica sem prazo de atendimento;
 *  - OS lançada como chamado: a abertura é a hora do servidor ao salvar (ninguém digita nem edita);
 *    mudar prioridade ou contrato NA OS refaz os limites;
 *  - HORÁRIO COMERCIAL por empresa: a rota (RBAC, multiempresa, validação) e o efeito na conta — só
 *    para os chamados dali em diante;
 *  - "CHEGUEI": o toque do app grava o comparecimento na hora do toque, uma vez só; "A caminho" não;
 *    quem começa a atividade sem tocar em "Cheguei" comparece naquele momento;
 *  - ALERTAS: o sino conta vencendo e estourado só para quem vê as OS, só da própria empresa; a lista
 *    e a exportação filtram as mesmas OS.
 *
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/prazos-pr4-pg
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { NextRequest } from "next/server";
import { PRESETS, montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";
import { MSG_JORNADA_HORAS, MSG_JORNADA_VAZIA, MSG_RESOLVER_ANTES, alertaDoAtendimento } from "@/lib/atendimento/prazo";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_prazos_pr4_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
const portal = vi.hoisted(() => ({ sessao: null as any }));
vi.mock("@/lib/auth-portal", () => ({ getPortalSession: vi.fn(async () => portal.sessao) }));
vi.mock("@/lib/nfse/webhook-server", async (orig) => ({ ...(await orig<object>()), reconciliarEmpresa: vi.fn(async () => {}) }));
vi.mock("next/server", async (orig) => ({ ...(await orig<object>()), after: (fn: () => void) => { void fn; } }));
vi.mock("resend", () => ({ Resend: class { emails = { send: async () => ({ data: { id: "x" } }) }; } }));

/** Quem opera as OS e os contratos (não é administrador) */
const OPERACAO = montarPermissoes({ ordens: ["visualizar", "criar", "editar", "concluir"], contratos: ["visualizar", "criar", "editar"], configuracoes: ["visualizar"] });
const logar = (o: { id?: string; empresaId?: string; role?: string; permissoes?: Permissoes; tecnicoId?: string | null } = {}) => {
  const id = o.id ?? "uGestor";
  sessao.atual = { user: { id, name: id, email: `${id}@x.com`, empresaId: o.empresaId ?? "e1", role: o.role ?? "OPERADOR", permissoes: o.permissoes ?? OPERACAO, tecnicoId: o.tecnicoId ?? null } };
};
const comoTecnico = () => logar({ id: "uTec", role: "TECNICO", permissoes: PRESETS.TECNICO, tecnicoId: "t1" });
const comoAdminDaOutra = () => logar({ id: "uB", empresaId: "e2", role: "ADMIN", permissoes: permissoesTotais() });

async function chamar(rota: string, metodo: string, params: Record<string, string> = {}, corpo?: unknown, query = "") {
  const mod = await import(/* @vite-ignore */ `@/app/api/${rota}/route`);
  const req = new NextRequest(`http://localhost/api/x${query ? `?${query}` : ""}`, {
    method: metodo, headers: { "Content-Type": "application/json", "x-forwarded-for": "10.9.8.7" }, body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  const tipo = res.headers.get("content-type") ?? "";
  return { status: res.status, json: tipo.includes("json") ? await res.json().catch(() => null) : null, texto: tipo.includes("json") ? "" : await res.text() };
}
const erro = async (r: Promise<{ status: number; json: any }>) => { const x = await r; return `${x.status} ${x.json?.erro ?? ""}`.trim(); };

vi.setConfig({ testTimeout: 90_000 });
const br = (data: string, hora = "00:00") => new Date(`${data}T${hora}:00-03:00`);
const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null);
// 18/11/2026 é quarta; 20, sexta; 21, sábado; 23, segunda
const AGORA = br("2026-11-18", "15:00");
const todas = (comparecerHoras: number | null, resolverHoras: number | null, soHorarioComercial = false) =>
  ["BAIXA", "NORMAL", "ALTA", "URGENTE", "CRITICO"].map((prioridade) => ({ prioridade, comparecerHoras, resolverHoras, soHorarioComercial }));

describe.skipIf(!URL_PG)("Prazos da OS — PR 4: prazo de atendimento do contrato (PostgreSQL real)", () => {
  let prisma: any;
  let seq = 0;
  const noRelogio = (quando: Date = AGORA) => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(quando); };
  const regras = async (contratoId: string) => (await prisma.contratoPrazoAtendimento.findMany({ where: { contratoId }, orderBy: { prioridade: "asc" } }))
    .map((r: any) => `${r.prioridade} ${r.comparecerHoras ?? "-"}/${r.resolverHoras ?? "-"}${r.soHorarioComercial ? " comercial" : ""} @${r.empresaId}`);
  const lerOs = (id: string) => prisma.ordemServico.findUnique({ where: { id } });
  const limites = async (id: string) => { const o = await lerOs(id); return [iso(o.atendimentoComparecerAte), iso(o.atendimentoResolverAte)]; };

  /** O corpo do cadastro de contrato (o mínimo que a tela manda) */
  const corpoContrato = (numero: string, extra: Record<string, unknown> = {}) => ({ clienteId: "c1", numero, tipo: "MANUTENCAO_PREVENTIVA", dataInicio: "2026-01-01", ...extra });
  async function contrato(prazosAtendimento?: unknown, extra: Record<string, unknown> = {}) {
    const r = await chamar("contratos", "POST", {}, corpoContrato(`PR4-${++seq}`, { ...(prazosAtendimento !== undefined && { prazosAtendimento }), ...extra }));
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    return r.json.id as string;
  }
  /** Um chamado do portal já recebido (aguardando a equipe aceitar), aberto em `abertoEm` */
  const chamado = (abertoEm: Date, dados: Record<string, unknown> = {}) => prisma.ordemServico.create({ data: {
    empresaId: "e1", clienteId: "c1", criadoPorId: "uGestor", numero: `OS-C${String(++seq).padStart(3, "0")}`, chamadoNumero: `CH-${seq}`, descricao: "Split da recepção pingando",
    status: "AGUARDANDO_ATENDIMENTO", origem: "PORTAL_CLIENTE", chamadoAbertoEm: abertoEm, ...dados,
  } });
  const aceitar = (id: string, corpo: Record<string, unknown> = {}) => chamar("solicitacoes/[id]/aceitar", "POST", { id }, {
    dataHora: "2026-11-25T09:00", descricao: "Split da recepção pingando água", tecnicoIds: ["t1"], responsavelId: "t1", ...corpo,
  });
  const novaOs = (corpo: Record<string, unknown> = {}) => chamar("ordens", "POST", {}, {
    clienteId: "c1", descricao: "Atendimento de chamado por telefone", execucao: { dataAgendada: "2026-11-25T12:00:00.000Z", tecnicoIds: ["t1"], responsavelId: "t1" }, ...corpo,
  });

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
      cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe",
    });
    process.env.DATABASE_URL = url;
    process.env.NEXTAUTH_SECRET ||= "segredo-de-teste-0123456789abcdef";
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Clima Total", cnpj: "12.345.678/0001-90", email: "e@x.com" },
      { id: "e2", nome: "Outra", cnpj: "98.765.432/0001-10", email: "o@x.com" },
    ] });
    await prisma.usuario.createMany({ data: [
      { id: "uGestor", empresaId: "e1", nome: "Gabi Gestora", email: "g@x.com", senha: "x", role: "ADMIN" },
      { id: "uTec", empresaId: "e1", nome: "João Silva", email: "t@x.com", senha: "x", role: "TECNICO" },
      { id: "uB", empresaId: "e2", nome: "Beto", email: "b@x.com", senha: "x", role: "ADMIN" },
    ] });
    await prisma.tecnico.create({ data: { id: "t1", empresaId: "e1", nome: "João Silva", cpf: "11122233344", telefone: "11999990000" } });
    await prisma.cliente.createMany({ data: [
      { id: "c1", empresaId: "e1", nome: "Hospital Santa Luzia", cpfCnpj: "11222333000181", portalAtivo: true },
      { id: "cX", empresaId: "e2", nome: "Cliente da outra", cpfCnpj: "11222333000343" },
    ] });
    await prisma.unidade.create({ data: { id: "un1", empresaId: "e1", clienteId: "c1", nome: "Matriz" } });
    await prisma.equipamento.create({ data: { id: "eq1", empresaId: "e1", unidadeId: "un1", tipo: "AR_CONDICIONADO_SPLIT", marca: "Daikin", modelo: "FTX" } });
    await prisma.qrcode.create({ data: { id: "qr1", empresaId: "e1", codigo: "QR-001", equipamentoId: "eq1", tokenPublico: "tok-pr4" } });
    await prisma.contatoCliente.create({ data: { id: "k1", empresaId: "e1", clienteId: "c1", nome: "Dra. Paula", email: "paula@hospital.com", principal: true } });
    await prisma.contrato.create({ data: { id: "ctOutra", empresaId: "e2", clienteId: "cX", numero: "CT-E2", tipo: "MANUTENCAO_PREVENTIVA", dataInicio: new Date("2026-01-01") } });
    logar();
  }, 180_000);

  afterEach(() => { vi.useRealTimers(); logar(); });

  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  /* ───────── o contrato ───────── */
  describe("contrato: as promessas por prioridade", () => {
    it("o cadastro grava uma linha por prioridade prometida, na empresa da sessão; sem o campo, o contrato nasce sem prazo", async () => {
      const id = await contrato([
        { prioridade: "URGENTE", comparecerHoras: 4, resolverHoras: 24, soHorarioComercial: false },
        { prioridade: "NORMAL", comparecerHoras: 24, resolverHoras: "", soHorarioComercial: true },
        { prioridade: "CRITICO", comparecerHoras: null, resolverHoras: 8 },
      ]);
      expect(await regras(id)).toEqual(["NORMAL 24/- comercial @e1", "URGENTE 4/24 @e1", "CRITICO -/8 @e1"]);
      expect(await regras(await contrato())).toEqual([]);
      expect(await regras(await contrato([]))).toEqual([]);
    });

    it("recusa promessa torta sem criar o contrato: resolver antes de comparecer, linha vazia, prioridade repetida ou desconhecida, hora quebrada", async () => {
      const antes = await prisma.contrato.count();
      const tentar = async (prazosAtendimento: unknown) => (await chamar("contratos", "POST", {}, corpoContrato(`CT-X${++seq}`, { prazosAtendimento })));
      const torto = await tentar([{ prioridade: "URGENTE", comparecerHoras: 8, resolverHoras: 4 }]);
      expect(torto.status).toBe(400);
      expect(JSON.stringify(torto.json)).toContain(MSG_RESOLVER_ANTES);
      for (const p of [
        [{ prioridade: "URGENTE", comparecerHoras: null, resolverHoras: null }],
        [{ prioridade: "URGENTE", comparecerHoras: 4 }, { prioridade: "URGENTE", comparecerHoras: 6 }],
        [{ prioridade: "EMERGENCIAL", comparecerHoras: 4 }],
        [{ prioridade: "URGENTE", comparecerHoras: 1.5 }],
        [{ prioridade: "URGENTE", comparecerHoras: 0 }],
        [{ prioridade: "URGENTE", comparecerHoras: "quatro" }],
        "4 horas",
      ]) expect((await tentar(p)).status, JSON.stringify(p)).toBe(400);
      expect(await prisma.contrato.count()).toBe(antes);
    });

    it("editar: mandar as promessas TROCA; não mandar o campo não apaga nada; lista vazia tira o prazo", async () => {
      const id = await contrato(todas(4, 24));
      const numero = (await prisma.contrato.findUnique({ where: { id } })).numero;
      const salvar = (extra: Record<string, unknown>) => chamar("contratos/[id]", "PUT", { id }, corpoContrato(numero, extra));
      // outra tela (ou integração) salvando o contrato sem falar de prazo
      expect((await salvar({ observacoes: "Renovado por mais um ano" })).status).toBe(200);
      expect(await regras(id)).toHaveLength(5);
      expect((await salvar({ prazosAtendimento: [{ prioridade: "CRITICO", comparecerHoras: 2, resolverHoras: 6, soHorarioComercial: true }] })).status).toBe(200);
      expect(await regras(id)).toEqual(["CRITICO 2/6 comercial @e1"]);
      // promessa torta não troca nada
      expect((await salvar({ prazosAtendimento: [{ prioridade: "CRITICO", comparecerHoras: 9, resolverHoras: 6 }] })).status).toBe(400);
      expect(await regras(id)).toEqual(["CRITICO 2/6 comercial @e1"]);
      expect((await salvar({ prazosAtendimento: [] })).status).toBe(200);
      expect(await regras(id)).toEqual([]);
    });

    it("permissão e empresa: quem não edita contrato não mexe nas promessas; contrato de outra empresa não existe", async () => {
      const id = await contrato(todas(4, 24));
      const numero = (await prisma.contrato.findUnique({ where: { id } })).numero;
      const corpo = corpoContrato(numero, { prazosAtendimento: [] });
      logar({ permissoes: montarPermissoes({ contratos: ["visualizar"], ordens: ["visualizar", "criar", "editar"] }) });
      expect((await chamar("contratos/[id]", "PUT", { id }, corpo)).status).toBe(403);
      expect((await chamar("contratos", "POST", {}, corpoContrato("CT-SEM", { prazosAtendimento: todas(1, 2) }))).status).toBe(403);
      comoTecnico();
      expect((await chamar("contratos/[id]", "PUT", { id }, corpo)).status).toBe(403);
      comoAdminDaOutra();
      expect((await chamar("contratos/[id]", "PUT", { id }, corpo)).status).toBe(404);
      expect(await regras(id)).toHaveLength(5);
      expect(await prisma.contrato.count({ where: { numero: "CT-SEM" } })).toBe(0);
    });

    it("a proposta aprovada vira contrato já com o prazo que prometeu: emergencial nas prioridades altas, normal nas demais", async () => {
      const proposta = (id: string, dados: Record<string, unknown>) => prisma.orcamento.create({ data: {
        id, empresaId: "e1", codigo: id.toUpperCase(), nome: "Contrato de manutenção", clienteId: "c1", criadoPorId: "uGestor", tipo: "PROPOSTA_CONTRATO", status: "APROVADO", tokenPublico: randomUUID(), ...dados,
      } });
      await proposta("prop1", { prazoEmergencial: 4, prazoNormal: 24 });
      const r = await chamar("orcamentos/[id]/gerar-contrato", "POST", { id: "prop1" });
      expect(r.json.contratoId, JSON.stringify(r.json)).toBeTruthy();
      expect(await regras(r.json.contratoId)).toEqual(["BAIXA 24/- @e1", "NORMAL 24/- @e1", "ALTA 4/- @e1", "URGENTE 4/- @e1", "CRITICO 4/- @e1"]);
      // gerar de novo devolve o mesmo contrato, sem duplicar promessa
      const denovo = await chamar("orcamentos/[id]/gerar-contrato", "POST", { id: "prop1" });
      expect(denovo.json).toMatchObject({ contratoId: r.json.contratoId, jaExistia: true });
      expect(await regras(r.json.contratoId)).toHaveLength(5);
      // proposta que não prometeu prazo: contrato sem prazo de atendimento
      await proposta("prop2", { prazoEmergencial: null, prazoNormal: null });
      const sem = await chamar("orcamentos/[id]/gerar-contrato", "POST", { id: "prop2" });
      expect(await regras(sem.json.contratoId)).toEqual([]);
    });
  });

  /* ───────── o chamado vira OS ───────── */
  describe("chamado do cliente: a abertura é gravada na hora, os limites no aceite", () => {
    it("portal e QR gravam a hora em que o cliente abriu o chamado; pedido de orçamento pelo QR não é chamado de atendimento", async () => {
      noRelogio(br("2026-11-18", "10:07"));
      portal.sessao = { user: { id: "k1", name: "Dra. Paula", clienteId: "c1", clienteNome: "Hospital", empresaId: "e1", permissoes: { verOS: true, abrirChamados: true } } };
      const pelo = await chamar("portal/chamados", "POST", {}, { descricao: "Split da recepção pingando água", urgencia: "URGENTE", fotos: [] });
      expect(pelo.status, JSON.stringify(pelo.json)).toBe(201);
      const doPortal = await lerOs(pelo.json.id);
      expect(iso(doPortal.chamadoAbertoEm)).toBe(iso(br("2026-11-18", "10:07")));
      // ainda sem contrato: nenhum limite — eles nascem quando a equipe aceita
      expect([doPortal.contratoId, doPortal.atendimentoComparecerAte, doPortal.atendimentoResolverAte]).toEqual([null, null, null]);

      const qr = async (tipo: string) => {
        const { POST } = await import("@/app/api/qr/[token]/chamado/route");
        const res = await POST(new NextRequest("http://localhost/api/qr/tok-pr4/chamado", {
          method: "POST", headers: { "Content-Type": "application/json", "x-forwarded-for": "10.1.1.9" },
          body: JSON.stringify({ tipo, nome: "Visitante", descricao: "Equipamento pingando muito na recepção" }),
        }), { params: Promise.resolve({ token: "tok-pr4" }) });
        const j = await res.json();
        expect(res.status, JSON.stringify(j)).toBe(201);
        return prisma.ordemServico.findFirst({ where: { chamadoNumero: j.chamadoNumero } });
      };
      expect(iso((await qr("CHAMADO")).chamadoAbertoEm)).toBe(iso(br("2026-11-18", "10:07")));
      // a empresa liga o botão "Solicitar orçamento" do QR (Configurações › QR Code)
      await prisma.configuracao.upsert({ where: { empresaId: "e1" }, create: { empresaId: "e1", qrConfig: { botaoOrcamento: true } }, update: { qrConfig: { botaoOrcamento: true } } });
      expect((await qr("ORCAMENTO")).chamadoAbertoEm).toBeNull();
    });

    it("o aceite fixa \"comparecer até\" e \"resolver até\" contados DA ABERTURA do chamado — não da hora do aceite", async () => {
      const ct = await contrato([{ prioridade: "URGENTE", comparecerHoras: 4, resolverHoras: 24 }, { prioridade: "NORMAL", comparecerHoras: 24, resolverHoras: 72 }]);
      const os = await chamado(br("2026-11-18", "10:00"));
      noRelogio(br("2026-11-18", "11:30")); // a equipe só viu o chamado uma hora e meia depois
      const r = await aceitar(os.id, { contratoId: ct, prioridade: "URGENTE" });
      expect(r.status, JSON.stringify(r.json)).toBe(200);
      expect(await limites(os.id)).toEqual([iso(br("2026-11-18", "14:00")), iso(br("2026-11-19", "10:00"))]);
      const gravada = await lerOs(os.id);
      expect([gravada.status, gravada.contratoId, gravada.prioridade, iso(gravada.chamadoAbertoEm), gravada.atendimentoComparecidoEm]).toEqual(["AGENDADA", ct, "URGENTE", iso(br("2026-11-18", "10:00")), null]);
      // a mesma abertura com a prioridade Normal recebe a promessa da Normal
      const normal = await chamado(br("2026-11-18", "10:00"));
      await aceitar(normal.id, { contratoId: ct, prioridade: "NORMAL" });
      expect(await limites(normal.id)).toEqual([iso(br("2026-11-19", "10:00")), iso(br("2026-11-21", "10:00"))]);
    });

    it("sem contrato, ou com prioridade que o contrato não promete, a OS fica sem prazo de atendimento (não herda de outra prioridade)", async () => {
      const ct = await contrato([{ prioridade: "URGENTE", comparecerHoras: 4, resolverHoras: 24 }]);
      const semContrato = await chamado(br("2026-11-18", "10:00"));
      expect((await aceitar(semContrato.id, { prioridade: "URGENTE" })).status).toBe(200);
      expect(await limites(semContrato.id)).toEqual([null, null]);
      const semPromessa = await chamado(br("2026-11-18", "10:00"));
      expect((await aceitar(semPromessa.id, { contratoId: ct, prioridade: "ALTA" })).status).toBe(200);
      expect(await limites(semPromessa.id)).toEqual([null, null]);
      // contrato de outra empresa é recusado no aceite: nada é fixado
      const outro = await chamado(br("2026-11-18", "10:00"));
      expect(await erro(aceitar(outro.id, { contratoId: "ctOutra", prioridade: "URGENTE" }))).toBe("400 Contrato inválido para este cliente.");
      expect(await limites(outro.id)).toEqual([null, null]);
      expect((await lerOs(outro.id)).status).toBe("AGUARDANDO_ATENDIMENTO");
    });

    it("só o comparecimento prometido: grava um limite e deixa o outro vazio", async () => {
      const ct = await contrato([{ prioridade: "ALTA", comparecerHoras: 6, resolverHoras: null }, { prioridade: "BAIXA", comparecerHoras: null, resolverHoras: 120 }]);
      const a = await chamado(br("2026-11-18", "10:00"));
      await aceitar(a.id, { contratoId: ct, prioridade: "ALTA" });
      expect(await limites(a.id)).toEqual([iso(br("2026-11-18", "16:00")), null]);
      const b = await chamado(br("2026-11-18", "10:00"));
      await aceitar(b.id, { contratoId: ct, prioridade: "BAIXA" });
      expect(await limites(b.id)).toEqual([null, iso(br("2026-11-23", "10:00"))]);
    });
  });

  /* ───────── OS lançada como chamado e a edição da OS ───────── */
  describe("OS lançada como chamado e a edição da OS", () => {
    it("Nova OS com contrato marcada \"Chamado do cliente\": a abertura é a hora do SERVIDOR ao salvar e a OS nasce com os dois limites; sem marcar, é uma OS comum", async () => {
      const ct = await contrato(todas(4, 24));
      noRelogio(); // quarta, 15h
      const r = await novaOs({ contratoId: ct, prioridade: "ALTA", chamadoDoCliente: true });
      expect(r.status, JSON.stringify(r.json)).toBe(201);
      expect(iso((await lerOs(r.json.id)).chamadoAbertoEm)).toBe(iso(AGORA));
      expect(await limites(r.json.id)).toEqual([iso(br("2026-11-18", "19:00")), iso(br("2026-11-19", "15:00"))]);
      const comum = await novaOs({ contratoId: ct, prioridade: "ALTA" });
      expect([(await lerOs(comum.json.id)).chamadoAbertoEm, ...(await limites(comum.json.id))]).toEqual([null, null, null]);
      expect((await novaOs({ contratoId: ct, chamadoDoCliente: false })).status).toBe(201);
      // chamado sem contrato: a abertura fica registrada, mas não há promessa para contar
      const avulso = await novaOs({ chamadoDoCliente: true });
      expect([iso((await lerOs(avulso.json.id)).chamadoAbertoEm), ...(await limites(avulso.json.id))]).toEqual([iso(AGORA), null, null]);
    });

    it("ninguém escolhe a hora de abertura: uma data mandada no corpo (passada ou futura) é ignorada", async () => {
      const ct = await contrato(todas(4, 24));
      noRelogio();
      // tentativa de antedatar o chamado (ganharia prazo) ou de jogá-lo para a frente (esconderia o atraso)
      for (const chamadoAbertoEm of ["2026-11-10T08:00", "2026-11-25T08:00", "2026-11-18T12:00:00.000Z"]) {
        const r = await novaOs({ contratoId: ct, prioridade: "ALTA", chamadoDoCliente: true, chamadoAbertoEm });
        expect(r.status, JSON.stringify(r.json)).toBe(201);
        expect(iso((await lerOs(r.json.id)).chamadoAbertoEm), chamadoAbertoEm).toBe(iso(AGORA));
      }
      // sem marcar "Chamado do cliente", mandar a data não transforma a OS em chamado
      const semMarcar = await novaOs({ contratoId: ct, prioridade: "ALTA", chamadoAbertoEm: "2026-11-18T10:00" });
      expect([(await lerOs(semMarcar.json.id)).chamadoAbertoEm, ...(await limites(semMarcar.json.id))]).toEqual([null, null, null]);
      // o marcador é sim/não: outra coisa é recusada e a OS não é criada
      const antes = await prisma.ordemServico.count();
      expect((await novaOs({ contratoId: ct, chamadoDoCliente: "2026-11-10T08:00" })).status).toBe(400);
      expect(await prisma.ordemServico.count()).toBe(antes);
    });

    it("mudar a prioridade ou o contrato NA OS refaz os limites; a hora de abertura não se edita nem se apaga", async () => {
      const ct = await contrato([{ prioridade: "URGENTE", comparecerHoras: 4, resolverHoras: 24 }, { prioridade: "NORMAL", comparecerHoras: 24, resolverHoras: 72 }]);
      const outroCt = await contrato([{ prioridade: "NORMAL", comparecerHoras: 8, resolverHoras: null }]);
      noRelogio();
      const { json: os } = await novaOs({ contratoId: ct, prioridade: "URGENTE", chamadoDoCliente: true });
      const editar = (corpo: Record<string, unknown>) => chamar("ordens/[id]", "PUT", { id: os.id }, corpo);
      expect(await limites(os.id)).toEqual([iso(br("2026-11-18", "19:00")), iso(br("2026-11-19", "15:00"))]);

      // as edições acontecem horas depois: os limites continuam contando da ABERTURA, não da edição
      vi.setSystemTime(br("2026-11-18", "17:30"));
      const r = await editar({ prioridade: "NORMAL" });
      expect(r.status, JSON.stringify(r.json)).toBe(200);
      expect(await limites(os.id)).toEqual([iso(br("2026-11-19", "15:00")), iso(br("2026-11-21", "15:00"))]);
      // a resposta já traz a OS com os limites novos (a tela não precisa recarregar para ver)
      expect(iso(r.json.atendimentoComparecerAte)).toBe(iso(br("2026-11-19", "15:00")));

      await editar({ contratoId: outroCt });
      expect(await limites(os.id)).toEqual([iso(br("2026-11-18", "23:00")), null]);

      // tentar mudar ou apagar a abertura pela edição não faz nada
      for (const chamadoAbertoEm of ["2026-11-18T12:00", "2026-11-19T12:00", "", null]) {
        expect((await editar({ chamadoAbertoEm, observacoes: "Cliente ligou de novo" })).status).toBe(200);
        expect([iso((await lerOs(os.id)).chamadoAbertoEm), ...(await limites(os.id))], String(chamadoAbertoEm)).toEqual([iso(AGORA), iso(br("2026-11-18", "23:00")), null]);
      }

      await editar({ prioridade: "CRITICO" }); // o contrato não promete nada para a Crítica
      expect(await limites(os.id)).toEqual([null, null]);
      await editar({ prioridade: "NORMAL" });
      expect([iso((await lerOs(os.id)).chamadoAbertoEm), ...(await limites(os.id))]).toEqual([iso(AGORA), iso(br("2026-11-18", "23:00")), null]);
    });

    it("o que foi prometido a um chamado não muda quando o CONTRATO muda — nem quando a OS é editada em outro campo", async () => {
      const ct = await contrato(todas(4, 24));
      const numero = (await prisma.contrato.findUnique({ where: { id: ct } })).numero;
      noRelogio();
      const { json: os } = await novaOs({ contratoId: ct, prioridade: "ALTA", chamadoDoCliente: true });
      const prometido = [iso(br("2026-11-18", "19:00")), iso(br("2026-11-19", "15:00"))];
      expect(await limites(os.id)).toEqual(prometido);
      // o contrato passa a prometer 1 h / 2 h
      expect((await chamar("contratos/[id]", "PUT", { id: ct }, corpoContrato(numero, { prazosAtendimento: todas(1, 2) }))).status).toBe(200);
      expect(await limites(os.id)).toEqual(prometido);
      // editar a descrição da OS não é motivo para refazer a promessa
      expect((await chamar("ordens/[id]", "PUT", { id: os.id }, { descricao: "Chamado por telefone — recepção", observacoes: "Cliente pediu urgência" })).status).toBe(200);
      expect(await limites(os.id)).toEqual(prometido);
      // um chamado novo, esse sim, recebe a promessa nova
      const { json: nova } = await novaOs({ contratoId: ct, prioridade: "ALTA", chamadoDoCliente: true });
      expect(await limites(nova.id)).toEqual([iso(br("2026-11-18", "16:00")), iso(br("2026-11-18", "17:00"))]);
    });
  });

  /* ───────── horário comercial por empresa ───────── */
  describe("horário comercial: configuração de cada empresa", () => {
    const PADRAO = { dias: [1, 2, 3, 4, 5].map((dia) => ({ dia, inicio: "08:00", fim: "18:00" })) };
    const COM_SABADO = { dias: [{ dia: 6, inicio: "08:00", fim: "12:00" }, ...PADRAO.dias] };
    const R = "configuracoes/horario-comercial";

    it("sem configurar, a empresa vê e usa segunda a sexta, das 8h às 18h — e nada é gravado por isso", async () => {
      expect((await chamar(R, "GET")).json).toEqual(PADRAO);
      expect((await prisma.configuracao.findUnique({ where: { empresaId: "e1" } }))?.horarioComercial ?? null).toBeNull();
    });

    it("validação: jornada vazia, fim antes do início, dia repetido e campo estranho são recusados sem gravar", async () => {
      logar({ permissoes: montarPermissoes({ configuracoes: ["visualizar", "gerenciar"] }) });
      expect(await erro(chamar(R, "PUT", {}, { dias: [] }))).toBe(`400 ${MSG_JORNADA_VAZIA}`);
      expect(await erro(chamar(R, "PUT", {}, { dias: [{ dia: 1, inicio: "18:00", fim: "08:00" }] }))).toBe(`400 ${MSG_JORNADA_HORAS}`);
      expect((await chamar(R, "PUT", {}, { dias: [{ dia: 1, inicio: "08:00", fim: "12:00" }, { dia: 1, inicio: "13:00", fim: "18:00" }] })).status).toBe(400);
      expect((await chamar(R, "PUT", {}, { dias: PADRAO.dias, empresaId: "e2" })).status).toBe(400);
      expect((await chamar(R, "PUT", {}, "seg-sex")).status).toBe(400);
      expect((await chamar(R, "GET")).json).toEqual(PADRAO);
    });

    it("a tela geral de Configurações (que manda a configuração INTEIRA de volta ao salvar) continua salvando e não mexe no horário comercial", async () => {
      logar({ permissoes: montarPermissoes({ configuracoes: ["visualizar", "gerenciar"] }) });
      const soManha = { dias: [1, 2, 3].map((dia) => ({ dia, inicio: "07:00", fim: "13:00" })) };
      expect((await chamar(R, "PUT", {}, soManha)).status).toBe(200);
      const lido = (await chamar("configuracoes", "GET")).json;
      expect(lido.horarioComercial).toEqual(soManha); // o campo vem junto na leitura…
      const r = await chamar("configuracoes", "PUT", {}, lido);
      expect(r.status, JSON.stringify(r.json)).toBe(200); // …e voltar com ele não pode impedir o salvar
      // nem trocar a jornada por esta rota: o horário comercial tem a sua tela e a sua validação
      const tentativa = await chamar("configuracoes", "PUT", {}, { ...lido, horarioComercial: { dias: [] } });
      expect(tentativa.status).toBe(200);
      expect((await prisma.configuracao.findUnique({ where: { empresaId: "e1" } })).horarioComercial).toEqual(soManha);
      // volta ao estado em que as outras verificações esperam a empresa: sem jornada configurada
      await prisma.configuracao.update({ where: { empresaId: "e1" }, data: { horarioComercial: null } });
    });

    it("\"só em horário comercial\" conta pelo expediente DA EMPRESA; mudar a jornada vale dali em diante, sem reescrever OS", async () => {
      const ct = await contrato(todas(4, 12, true));
      const sexta17 = br("2026-11-20", "17:00");
      // antes de a empresa configurar: jornada padrão → segunda às 11h
      const antes = await chamado(sexta17);
      await aceitar(antes.id, { contratoId: ct, prioridade: "NORMAL" });
      const pelaPadrao = [iso(br("2026-11-23", "11:00")), iso(br("2026-11-24", "09:00"))];
      expect(await limites(antes.id)).toEqual(pelaPadrao);

      // quem só vê Configurações não muda; quem gerencia, sim
      expect((await chamar(R, "PUT", {}, COM_SABADO)).status).toBe(403);
      logar({ permissoes: montarPermissoes({ ordens: ["visualizar", "editar"] }) });
      expect((await chamar(R, "GET")).status).toBe(403);
      comoTecnico();
      expect((await chamar(R, "PUT", {}, COM_SABADO)).status).toBe(403);
      logar({ permissoes: montarPermissoes({ configuracoes: ["visualizar", "gerenciar"] }) });
      const salvo = await chamar(R, "PUT", {}, COM_SABADO);
      expect(salvo.status, JSON.stringify(salvo.json)).toBe(200);
      // gravado em ordem (domingo → sábado), e é o que a leitura devolve
      expect(salvo.json).toEqual({ dias: [...PADRAO.dias, { dia: 6, inicio: "08:00", fim: "12:00" }] });
      expect((await chamar(R, "GET")).json).toEqual(salvo.json);
      expect((await prisma.configuracao.findUnique({ where: { empresaId: "e1" } })).horarioComercial).toEqual(salvo.json);

      // a OS que já tinha a promessa continua com ela
      expect(await limites(antes.id)).toEqual(pelaPadrao);
      // o chamado seguinte, da mesma hora, conta o sábado: 1 h na sexta + 3 h no sábado; 1 + 4 + 7 na segunda
      logar();
      const depois = await chamado(sexta17);
      await aceitar(depois.id, { contratoId: ct, prioridade: "NORMAL" });
      expect(await limites(depois.id)).toEqual([iso(br("2026-11-21", "11:00")), iso(br("2026-11-23", "15:00"))]);

      // contrato em horas corridas não olha a jornada
      const corrido = await contrato(todas(4, 12, false));
      const c = await chamado(sexta17);
      await aceitar(c.id, { contratoId: corrido, prioridade: "NORMAL" });
      expect(await limites(c.id)).toEqual([iso(br("2026-11-20", "21:00")), iso(br("2026-11-21", "05:00"))]);

      // a outra empresa continua na jornada padrão: a configuração é de cada uma
      comoAdminDaOutra();
      expect((await chamar(R, "GET")).json).toEqual(PADRAO);
      expect((await prisma.configuracao.findUnique({ where: { empresaId: "e2" } }))?.horarioComercial ?? null).toBeNull();
    });
  });

  /* ───────── "Cheguei" ───────── */
  describe("\"Cheguei\" no app do técnico grava o comparecimento", () => {
    const sync = async (operacoes: unknown[], agora: Date = new Date()) =>
      (await chamar("tecnico/sync", "POST", {}, { operacoes, agora: agora.toISOString() })).json.resultados as any[];
    const toque = (evento: "A_CAMINHO" | "CHEGOU", atividadeId: string, em: Date = new Date()) => ({ id: randomUUID(), tipo: "avisoCliente", atividadeId, em: em.toISOString(), dados: { evento } });
    const iniciar = (atividadeId: string, em: Date = new Date()) => ({ id: randomUUID(), tipo: "iniciar", atividadeId, em: em.toISOString() });
    /** Um chamado aceito (com os limites) e a atividade do técnico t1 */
    async function chamadoAceito() {
      const ct = await contrato(todas(4, 24));
      const os = await chamado(br("2026-11-18", "10:00"));
      expect((await aceitar(os.id, { contratoId: ct, prioridade: "URGENTE" })).status).toBe(200);
      const atividade = await prisma.atividadeOs.findFirst({ where: { ordemServicoId: os.id } });
      return { id: os.id as string, a: atividade.id as string };
    }
    const comparecido = async (id: string) => iso((await lerOs(id)).atendimentoComparecidoEm);

    beforeAll(async () => {
      await prisma.configuracao.upsert({ where: { empresaId: "e1" }, create: { empresaId: "e1", appAvisarCliente: true }, update: { appAvisarCliente: true } });
    });

    it("\"A caminho\" não é chegada; o \"Cheguei\" grava a hora do toque e o relógio do comparecimento para", async () => {
      const os = await chamadoAceito();
      noRelogio(br("2026-11-18", "13:10"));
      comoTecnico();
      const [caminho] = await sync([toque("A_CAMINHO", os.a)]);
      expect(caminho.ok, JSON.stringify(caminho)).toBe(true);
      expect(await comparecido(os.id)).toBeNull();

      vi.setSystemTime(br("2026-11-18", "13:42"));
      const [chegou] = await sync([toque("CHEGOU", os.a)]);
      expect(chegou.ok, JSON.stringify(chegou)).toBe(true);
      expect(await comparecido(os.id)).toBe(iso(br("2026-11-18", "13:42")));
      // os limites prometidos não mudam com a chegada. Desde "Pronto pra janeiro 2" (G), chegar é começar:
      // a atividade passa a Em andamento no "Cheguei" (antes ficava Agendada até o técnico iniciar)
      expect(await limites(os.id)).toEqual([iso(br("2026-11-18", "14:00")), iso(br("2026-11-19", "10:00"))]);
      expect((await prisma.atividadeOs.findUnique({ where: { id: os.a } })).status).toBe("EM_ANDAMENTO");
      // a partir daqui a OS não alerta mais pelo comparecimento, mesmo depois das 14h
      expect(alertaDoAtendimento(await lerOs(os.id), br("2026-11-18", "14:30"))).toBeNull();
    });

    it("só a PRIMEIRA chegada vale: tocar de novo, voltar outro dia ou começar a atividade depois não troca a hora", async () => {
      const os = await chamadoAceito();
      noRelogio(br("2026-11-18", "13:00"));
      comoTecnico();
      await sync([toque("CHEGOU", os.a)]);
      const primeira = iso(br("2026-11-18", "13:00"));
      expect(await comparecido(os.id)).toBe(primeira);
      vi.setSystemTime(br("2026-11-18", "13:05"));
      await sync([toque("CHEGOU", os.a)]); // toque repetido
      await sync([iniciar(os.a)]); // começou a atividade depois de chegar
      expect(await comparecido(os.id)).toBe(primeira);
      // segunda visita, no dia seguinte, em outra atividade da mesma OS
      await prisma.atividadeOs.create({ data: { id: `${os.a}-2`, empresaId: "e1", ordemServicoId: os.id, titulo: "Retorno com a peça", tecnicoId: "t1", status: "AGENDADA" } });
      vi.setSystemTime(br("2026-11-19", "09:00"));
      const [volta] = await sync([toque("CHEGOU", `${os.a}-2`)]);
      expect(volta.ok, JSON.stringify(volta)).toBe(true);
      expect(await comparecido(os.id)).toBe(primeira);
    });

    it("sem sinal: a fila sobe depois, e o comparecimento é o da hora do TOQUE (não a da sincronização)", async () => {
      const os = await chamadoAceito();
      comoTecnico();
      // tocou às 13h50 (no prazo); o aparelho só conseguiu enviar às 14h40
      noRelogio(br("2026-11-18", "14:40"));
      const [r] = await sync([toque("CHEGOU", os.a, br("2026-11-18", "13:50"))], br("2026-11-18", "14:40"));
      expect(r.ok, JSON.stringify(r)).toBe(true);
      expect(await comparecido(os.id)).toBe(iso(br("2026-11-18", "13:50")));
    });

    it("quem começa a atividade sem tocar em \"Cheguei\" compareceu naquele momento (hora do toque); depois o \"Cheguei\" não troca", async () => {
      const os = await chamadoAceito();
      comoTecnico();
      noRelogio(br("2026-11-18", "13:30"));
      const [r] = await sync([iniciar(os.a, br("2026-11-18", "13:20"))], br("2026-11-18", "13:30"));
      expect(r.ok, JSON.stringify(r)).toBe(true);
      expect(await comparecido(os.id)).toBe(iso(br("2026-11-18", "13:20")));
      vi.setSystemTime(br("2026-11-18", "13:45"));
      await sync([toque("CHEGOU", os.a)]);
      expect(await comparecido(os.id)).toBe(iso(br("2026-11-18", "13:20")));
    });

    it("técnico que não é da atividade não registra chegada na OS dos outros", async () => {
      const os = await chamadoAceito();
      await prisma.tecnico.create({ data: { id: "t2", empresaId: "e1", nome: "Outro", cpf: "99988877766", telefone: "11" } });
      logar({ id: "uTec2", role: "TECNICO", permissoes: PRESETS.TECNICO, tecnicoId: "t2" });
      const [r] = await sync([toque("CHEGOU", os.a)]);
      expect(r.ok).toBe(false);
      expect(await comparecido(os.id)).toBeNull();
    });
  });

  /* ───────── alertas ───────── */
  describe("alertas: o sino, a lista de OS e a exportação", () => {
    const ids = new Map<string, string>();
    // chamado das 10h de quarta: "agora" é quarta, 15h
    const casos: Array<[string, Record<string, unknown>, "VENCENDO" | "ESTOURADO" | null]> = [
      ["comparecer estourado (era até 14h)", { atendimentoComparecerAte: br("2026-11-18", "14:00"), atendimentoResolverAte: br("2026-11-19", "10:00") }, "ESTOURADO"],
      ["comparecer vencendo (até 15h40)", { atendimentoComparecerAte: br("2026-11-18", "15:40"), atendimentoResolverAte: br("2026-11-19", "10:00") }, "VENCENDO"],
      ["com folga (até 18h)", { atendimentoComparecerAte: br("2026-11-18", "18:00"), atendimentoResolverAte: br("2026-11-19", "10:00") }, null],
      ["já chegou; resolver com folga", { atendimentoComparecerAte: br("2026-11-18", "14:00"), atendimentoComparecidoEm: br("2026-11-18", "13:30"), atendimentoResolverAte: br("2026-11-19", "10:00") }, null],
      ["já chegou; resolver vencendo", { atendimentoComparecerAte: br("2026-11-18", "12:00"), atendimentoComparecidoEm: br("2026-11-18", "11:00"), atendimentoResolverAte: br("2026-11-18", "15:30") }, "VENCENDO"],
      ["já chegou; resolver estourado", { atendimentoComparecerAte: br("2026-11-18", "12:00"), atendimentoComparecidoEm: br("2026-11-18", "11:00"), atendimentoResolverAte: br("2026-11-18", "14:59"), status: "EM_ANDAMENTO" }, "ESTOURADO"],
      ["só resolver, estourado", { atendimentoResolverAte: br("2026-11-18", "13:00") }, "ESTOURADO"],
      ["concluída depois do limite", { atendimentoComparecerAte: br("2026-11-18", "12:00"), atendimentoResolverAte: br("2026-11-18", "13:00"), status: "CONCLUIDA", dataConclusao: br("2026-11-18", "14:00") }, null],
      ["cancelada com limite vencido", { atendimentoComparecerAte: br("2026-11-18", "12:00"), status: "CANCELADA" }, null],
      ["chamado sem promessa", {}, null],
    ];
    const dos = (alerta: string) => casos.filter(([, , a]) => a === alerta).map(([nome]) => ids.get(nome)!).sort();

    beforeAll(async () => {
      // esta parte conta as OS da empresa inteira: começa de uma empresa sem nenhuma em alerta
      await prisma.ordemServico.updateMany({ where: { empresaId: "e1" }, data: { atendimentoComparecerAte: null, atendimentoResolverAte: null } });
      for (const [nome, dados] of casos) {
        ids.set(nome, (await prisma.ordemServico.create({ data: {
          empresaId: "e1", clienteId: "c1", criadoPorId: "uGestor", numero: `OS-A${String(++seq).padStart(3, "0")}`, descricao: nome, status: "AGENDADA",
          origem: "PORTAL_CLIENTE", chamadoAbertoEm: br("2026-11-18", "10:00"), ...dados,
        } })).id);
      }
      // a outra empresa tem um chamado estourado: não é da conta de ninguém da e1
      await prisma.ordemServico.create({ data: { empresaId: "e2", clienteId: "cX", criadoPorId: "uB", numero: "OS-E2", descricao: "Da outra", status: "AGENDADA", chamadoAbertoEm: br("2026-11-18", "08:00"), atendimentoComparecerAte: br("2026-11-18", "09:00") } });
    });

    it("a tabela de casos é a régua: a regra pura, OS a OS, dá o que se espera", async () => {
      for (const [nome, , esperado] of casos) expect(alertaDoAtendimento(await lerOs(ids.get(nome)!), AGORA), nome).toBe(esperado);
    });

    it("o sino conta vencendo e estourado separados, só para quem vê as OS, só da própria empresa", async () => {
      noRelogio();
      const r = await chamar("alertas", "GET");
      expect(r.status).toBe(200);
      expect([r.json.atendimentoVencendo, r.json.atendimentoEstourado]).toEqual([dos("VENCENDO").length, dos("ESTOURADO").length]);
      expect([dos("VENCENDO").length, dos("ESTOURADO").length]).toEqual([2, 3]);

      // quem não vê as OS (só compras, por exemplo) não recebe o número
      logar({ permissoes: montarPermissoes({ compras: ["visualizar"] }) });
      const semOs = await chamar("alertas", "GET");
      expect([semOs.json.atendimentoVencendo, semOs.json.atendimentoEstourado]).toEqual([0, 0]);

      comoAdminDaOutra();
      const outra = await chamar("alertas", "GET");
      expect([outra.json.atendimentoVencendo, outra.json.atendimentoEstourado]).toEqual([0, 1]);
    });

    it("a lista de OS filtra as MESMAS OS que o sino contou (?atendimento=vencendo|estourado) e convive com os outros filtros", async () => {
      const { whereOrdensDaLista } = await import("@/lib/listas/filtros-server");
      const listar = async (sp: Record<string, string>, empresaId = "e1") => (await prisma.ordemServico.findMany({ where: await whereOrdensDaLista(empresaId, sp, AGORA), select: { id: true } })).map((o: any) => o.id).sort();
      expect(await listar({ atendimento: "estourado" })).toEqual(dos("ESTOURADO"));
      expect(await listar({ atendimento: "vencendo" })).toEqual(dos("VENCENDO"));
      // junto com o status: só a que está em andamento
      expect(await listar({ atendimento: "estourado", status: "EM_ANDAMENTO" })).toEqual([ids.get("já chegou; resolver estourado")]);
      expect(await listar({ atendimento: "estourado", busca: "só resolver" })).toEqual([ids.get("só resolver, estourado")]);
      // valor desconhecido não filtra (não vira "nenhuma OS" nem erro)
      expect((await listar({ atendimento: "qualquer" })).length).toBeGreaterThan(dos("ESTOURADO").length + dos("VENCENDO").length);
      // filtro sem nenhuma OS no alerta devolve lista vazia — não a lista inteira
      await prisma.ordemServico.updateMany({ where: { id: { in: dos("VENCENDO") } }, data: { status: "CANCELADA" } });
      expect(await listar({ atendimento: "vencendo" })).toEqual([]);
      await prisma.ordemServico.updateMany({ where: { id: { in: dos("VENCENDO") } }, data: { status: "AGENDADA" } });
      // a outra empresa só vê a dela
      expect(await listar({ atendimento: "estourado" }, "e2")).toHaveLength(1);
    });

    it("a exportação traz o que a lista mostra com o mesmo filtro", async () => {
      noRelogio();
      logar({ permissoes: permissoesTotais(), role: "ADMIN" });
      const r = await chamar("ordens/export", "GET", {}, undefined, "atendimento=estourado&formato=csv");
      expect(r.status).toBe(200);
      const numeros = (await prisma.ordemServico.findMany({ where: { id: { in: dos("ESTOURADO") } }, select: { numero: true } })).map((o: any) => o.numero);
      for (const n of numeros) expect(r.texto, n).toContain(n);
      const fora = (await prisma.ordemServico.findMany({ where: { id: { in: [...dos("VENCENDO"), ids.get("com folga (até 18h)")!] } }, select: { numero: true } })).map((o: any) => o.numero);
      for (const n of fora) expect(r.texto, n).not.toContain(n);
    });
  });
});
