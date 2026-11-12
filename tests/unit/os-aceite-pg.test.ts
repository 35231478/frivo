/**
 * ACEITE DO CLIENTE na conclusão da OS, de ponta a ponta no servidor: rotas reais com o Prisma real
 * num PostgreSQL real (schema descartável via `prisma db push`). Só o Resend é de mentira.
 *
 * O que se prova:
 *  - concluir a OS (pelo app do técnico ou pelo escritório) abre o aceite PENDENTE — sem mudar o
 *    status da OS (continua Concluída: o faturamento não depende do aceite);
 *  - NO LOCAL: nome + assinatura pela fila offline do app (idempotente) e pelo escritório;
 *  - REMOTO: "Enviar ao cliente" manda o e-mail e devolve o WhatsApp com o link; a confirmação pelo
 *    link grava nome + IP + navegador + data/hora, com troca atômica (como o orçamento);
 *  - PORTAL: as pendências do cliente e o gate do novo chamado — livre por padrão, bloqueio por
 *    empresa, emergência sempre;
 *  - o aceite confirmado entra no relatório da OS;
 *  - RBAC e multiempresa em cada rota; o link público só precisa do token.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/os-aceite-pg
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { NextRequest } from "next/server";
import { PRESETS, montarPermissoes, permissoesTotais, type Acao, type Permissoes } from "@/lib/permissoes";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_os_aceite_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");
const ORIGEM = "https://app.exemplo.com";

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
const portal = vi.hoisted(() => ({ sessao: null as any }));
vi.mock("@/lib/auth-portal", () => ({ getPortalSession: vi.fn(async () => portal.sessao) }));
const resend = vi.hoisted(() => ({ enviados: [] as any[], falhar: false }));
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: async (m: any) => { resend.enviados.push(m); return resend.falhar ? { error: { message: "Domínio não verificado" } } : { data: { id: "x" } }; } };
  },
}));

const comoEscritorio = (permissoes: Permissoes = permissoesTotais(), empresaId = "e1", id = empresaId === "e1" ? "uA" : "uB") => {
  sessao.atual = { user: { id, name: "Ana", email: `${id}@x.com`, empresaId, role: "OPERADOR", permissoes, tecnicoId: null } };
};
const comOs = (acoes: Acao[]) => comoEscritorio(montarPermissoes({ ordens: acoes }));
const comoTecnico = (tecnicoId = "t1", id = "uT", permissoes: Permissoes = PRESETS.TECNICO) => {
  sessao.atual = { user: { id, name: "João", email: `${id}@x.com`, empresaId: "e1", role: "TECNICO", permissoes, tecnicoId } };
};
const comoContato = (id = "kPrincipal", clienteId = "c1", empresaId = "e1", permissoes: Record<string, boolean> = { verOS: true, abrirChamados: true }) => {
  portal.sessao = { user: { id, name: "Dra. Paula", clienteId, clienteNome: "Hospital", empresaId, permissoes } };
};

async function chamar(rota: string, metodo: string, params: Record<string, string>, corpo?: unknown, cabecalhos: Record<string, string> = {}) {
  const mod = await import(/* @vite-ignore */ `@/app/api/${rota}/route`);
  const req = new NextRequest(`${ORIGEM}/api/x`, { method: metodo, headers: { "Content-Type": "application/json", ...cabecalhos }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  return { status: res.status, json: (res.headers.get("content-type") ?? "").includes("json") ? await res.json() : null };
}
const APARELHO = { "x-forwarded-for": "189.10.20.30, 10.0.0.1", "user-agent": "Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile" };
const sync = async (operacoes: unknown[], cabecalhos: Record<string, string> = APARELHO) => (await chamar("tecnico/sync", "POST", {}, { operacoes }, cabecalhos)).json.resultados as any[];
const ASSINATURA = `data:image/png;base64,${"iVBORw0KGgo".padEnd(400, "A")}`;
const opConcluir = (atividadeId: string) => ({ id: randomUUID(), tipo: "concluir", atividadeId, dados: {} });
const opAceite = (atividadeId: string, nome = "João Pereira da Silva", assinatura: unknown = ASSINATURA) => ({ id: randomUUID(), tipo: "aceite", atividadeId, dados: { nome, assinatura } });
const R_ACEITE = "ordens/[id]/aceite", R_ENVIAR = "ordens/[id]/aceite/enviar", R_PUBLICO = "publico/aceites/[token]/confirmar";
const CLIENTE_IP = { "x-forwarded-for": "200.150.10.5", "user-agent": "Mozilla/5.0 (iPhone) Safari/605" };

describe.skipIf(!URL_PG)("Aceite do cliente na conclusão da OS (PostgreSQL real)", () => {
  let prisma: any;
  let n = 0;
  /**
   * Uma OS em andamento, com a atividade do técnico t1 e o equipamento já atendido (falta só concluir).
   * `extra`: campos da OS; `atividades`: outras atividades da mesma OS.
   */
  async function os(extra: Record<string, unknown> = {}, atividades: { status?: string; tecnicoId?: string | null }[] = [{}]) {
    const id = `os${++n}`;
    const { empresaId = "e1", clienteId = "c1", ...resto } = extra as { empresaId?: string; clienteId?: string };
    await prisma.ordemServico.create({ data: { id, empresaId, numero: `OS-${1000 + n}`, clienteId, criadoPorId: empresaId === "e1" ? "uA" : "uB", descricao: "Manutenção preventiva dos splits", status: "EM_ANDAMENTO", ...resto } });
    const ids: string[] = [];
    for (const [i, a] of atividades.entries()) {
      const aid = `${id}a${i + 1}`; ids.push(aid);
      await prisma.atividadeOs.create({ data: { id: aid, empresaId, ordemServicoId: id, titulo: "Manutenção Preventiva", tipoOsId: empresaId === "e1" ? "toPrev" : null, tecnicoId: a.tecnicoId === undefined ? "t1" : a.tecnicoId, status: a.status ?? "EM_ANDAMENTO" } });
      if (empresaId === "e1") await prisma.atividadeEquipamento.create({ data: { atividadeId: aid, equipamentoId: "q1", feito: true, feitoEm: new Date() } });
    }
    return { id, a: ids[0], atividades: ids };
  }
  /** OS já concluída pelo app, com o aceite pendente */
  async function concluida(extra: Record<string, unknown> = {}) {
    const x = await os(extra);
    comoTecnico();
    const [r] = await sync([opConcluir(x.a)]);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    comoEscritorio();
    return x;
  }
  const aceite = (osId: string) => prisma.osAceite.findUnique({ where: { ordemServicoId: osId } });
  const statusDa = async (osId: string) => (await prisma.ordemServico.findUnique({ where: { id: osId }, select: { status: true } })).status;
  const historico = async (osId: string, acao?: string) => (await prisma.osHistorico.findMany({ where: { ordemServicoId: osId, ...(acao && { acao }) }, orderBy: [{ criadoEm: "asc" }, { id: "asc" }] })).map((h: any) => `${h.acao} | ${h.detalhes ?? ""} | ${h.usuarioId}`);
  const opcao = (dados: Record<string, boolean>, empresaId = "e1") => prisma.configuracao.upsert({ where: { empresaId }, create: { empresaId, ...dados }, update: dados });
  const erro = async (r: Promise<{ status: number; json: any }>) => { const x = await r; return `${x.status} ${x.json?.erro ?? ""}`; };

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    process.env.NEXTAUTH_SECRET ||= "segredo-de-teste-0123456789abcdef";
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    const { criptografar } = await import("@/lib/crypto");
    await Promise.all(["tecnico/sync", "tecnico/atividades/[atividadeId]", R_ACEITE, R_ENVIAR, R_PUBLICO, "portal/chamados", "ordens/[id]", "configuracoes"].map((r) => import(/* @vite-ignore */ `@/app/api/${r}/route`)));

    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Clima Total Engenharia Ltda", nomeFantasia: "Clima Total", cnpj: "12.345.678/0001-90", email: "e@x.com" },
      { id: "e2", nome: "Outra Climatização", cnpj: "98.765.432/0001-10", email: "o@x.com" },
    ] });
    await prisma.emailConfig.create({ data: { empresaId: "e1", ativo: true, apiKey: criptografar("re_teste"), remetente: "avisos@ct.com.br", nomeRemetente: "Clima Total" } });
    await prisma.usuario.createMany({ data: [
      { id: "uA", empresaId: "e1", nome: "Ana Souza", email: "ana@x.com", senha: "x", role: "ADMIN" },
      { id: "uT", empresaId: "e1", nome: "João Silva", email: "joao@x.com", senha: "x", role: "TECNICO" },
      { id: "uT2", empresaId: "e1", nome: "Outro técnico", email: "t2@x.com", senha: "x", role: "TECNICO" },
      { id: "uB", empresaId: "e2", nome: "Beto", email: "beto@x.com", senha: "x", role: "ADMIN" },
    ] });
    await prisma.tecnico.createMany({ data: [
      { id: "t1", empresaId: "e1", nome: "João Silva", cpf: "1", telefone: "1", email: "joao@x.com" },
      { id: "t2", empresaId: "e1", nome: "Outro técnico", cpf: "2", telefone: "2", email: "t2@x.com" },
    ] });
    await prisma.cliente.createMany({ data: [
      { id: "c1", empresaId: "e1", nome: "Hospital Santa Luzia Ltda", nomeFantasia: "Hospital Santa Luzia", cpfCnpj: "1", email: "cadastro@hospital.com", celular: "(11) 97777-0000", emailsCopia: ["copia@hospital.com"] },
      { id: "c2", empresaId: "e1", nome: "Shopping Norte", cpfCnpj: "2", email: "adm@shopping.com" },
      { id: "cSem", empresaId: "e1", nome: "Padaria sem contato", cpfCnpj: "3" },
      { id: "cNao", empresaId: "e1", nome: "Colégio que não quer e-mail de OS", cpfCnpj: "4", email: "secretaria@colegio.com", emailReceberOs: false, celular: "11 95555-1234" },
      { id: "cE2", empresaId: "e2", nome: "Cliente da outra empresa", cpfCnpj: "5", email: "x@outra.com" },
    ] });
    await prisma.unidade.create({ data: { id: "u1", empresaId: "e1", clienteId: "c1", nome: "Matriz" } });
    await prisma.equipamento.create({ data: { id: "q1", empresaId: "e1", unidadeId: "u1", tipo: "AR_CONDICIONADO_SPLIT", marca: "LG", modelo: "S4", nome: "Split da recepção", patrimonio: "AC-001" } });
    await prisma.tipoOs.create({ data: { id: "toPrev", empresaId: "e1", nome: "Manutenção Preventiva" } });
    await prisma.contatoCliente.createMany({ data: [
      { id: "kPrincipal", empresaId: "e1", clienteId: "c1", nome: "Dra. Paula Reis", email: "diretoria@hospital.com", whatsapp: "(11) 98888-7777", principal: true },
      { id: "kManut", empresaId: "e1", clienteId: "c1", nome: "Seu Jorge", email: "manutencao@hospital.com", whatsapp: "(11) 96666-5555", tipo: "OPERACIONAL" },
      { id: "kChamado", empresaId: "e1", clienteId: "c1", nome: "Recepção Central", email: "recepcao@hospital.com", whatsapp: "(11) 94444-3333" },
      { id: "kShopping", empresaId: "e1", clienteId: "c2", nome: "Gerente do shopping", email: "gerente@shopping.com" },
      { id: "kE2", empresaId: "e2", clienteId: "cE2", nome: "Contato da outra empresa", email: "c@outra.com" },
    ] });
    // Aba Comunicação do cliente: as comunicações de ORDENS vão para o Seu Jorge, por e-mail e WhatsApp
    await prisma.comunicacaoPreferencia.create({ data: { empresaId: "e1", clienteId: "c1", contatoId: "kManut", tipo: "ORDENS", canal: "AMBOS" } });
  }, 180_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  beforeEach(async () => {
    resend.enviados.length = 0; resend.falhar = false;
    portal.sessao = null;
    await prisma.ordemServico.deleteMany({});
    await prisma.tentativaAcesso.deleteMany({});
    await prisma.emailConfig.update({ where: { empresaId: "e1" }, data: { ativo: true } });
    await opcao({ portalAceiteObrigatorio: false, appExibirContatosCliente: true, appExibirDadosCliente: true });
    await opcao({ portalAceiteObrigatorio: false }, "e2");
    comoEscritorio();
  });

  /* ───────── concluir abre o aceite ───────── */
  it("CONCLUIR pelo app do técnico: a OS fica Concluída e nasce o aceite PENDENTE, com o token do link — e mais nada", async () => {
    const x = await os();
    expect(await aceite(x.id)).toBeNull();
    comoTecnico();
    expect((await sync([opConcluir(x.a)]))[0]).toMatchObject({ ok: true, dados: { status: "CONCLUIDA" } });
    expect(await statusDa(x.id)).toBe("CONCLUIDA"); // o status da OS é o de sempre: o aceite não cria status novo
    const a = await aceite(x.id);
    expect(a).toMatchObject({ empresaId: "e1", situacao: "PENDENTE", metodo: null, nome: null, assinatura: null, ip: null, confirmadoEm: null, colhidoPorId: null, contatoId: null, envios: 0, enviadoEm: null });
    expect(a.token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(await historico(x.id, "Serviço confirmado pelo cliente")).toEqual([]);
    expect(resend.enviados).toHaveLength(0); // concluir não manda nada sozinho: o envio é o clique de alguém
  });

  it("CONCLUIR pelo escritório (status à mão) também abre o aceite; reabrir e concluir de novo não cria outro nem troca o token", async () => {
    const x = await os({}, [{ status: "CONCLUIDA" }]);
    expect((await chamar("ordens/[id]", "PUT", { id: x.id }, { status: "CONCLUIDA" })).status).toBe(200);
    const a = await aceite(x.id);
    expect(a).toMatchObject({ situacao: "PENDENTE", envios: 0 });
    expect((await chamar("ordens/[id]", "PUT", { id: x.id }, { status: "EM_ANDAMENTO" })).status).toBe(200);
    expect((await aceite(x.id)).situacao).toBe("PENDENTE"); // reaberta: o registro fica, mas ninguém está "aguardando" (ver o estado na rota)
    expect((await chamar(R_ACEITE, "GET", { id: x.id })).json).toMatchObject({ estado: "NAO_SE_APLICA", statusOs: "EM_ANDAMENTO" });
    expect((await chamar("ordens/[id]", "PUT", { id: x.id }, { status: "CONCLUIDA" })).status).toBe(200);
    expect(await prisma.osAceite.count({ where: { ordemServicoId: x.id } })).toBe(1);
    expect((await aceite(x.id)).token).toBe(a.token);
    expect((await chamar(R_ACEITE, "GET", { id: x.id })).json).toMatchObject({ estado: "AGUARDANDO", statusOs: "CONCLUIDA", caminhoPublico: `/relatorio/aceite/${a.token}` });
  });

  it("OS com outra atividade em aberto: concluir uma visita NÃO conclui a OS nem abre aceite; o retrato diz ao app quando é a última", async () => {
    const x = await os({}, [{}, { status: "AGENDADA" }]);
    comoTecnico();
    const retrato = async (atividadeId: string) => (await chamar("tecnico/atividades/[atividadeId]", "GET", { atividadeId })).json.aceite;
    expect(await retrato(x.atividades[0])).toEqual({ situacao: null, nome: null, confirmadoEm: null, osConcluida: false, ultimaDaOs: false });
    await sync([opConcluir(x.atividades[0])]);
    expect(await statusDa(x.id)).not.toBe("CONCLUIDA");
    expect(await aceite(x.id)).toBeNull();
    // Agora só falta a segunda: é ela que fecha a OS
    expect(await retrato(x.atividades[1])).toMatchObject({ osConcluida: false, ultimaDaOs: true });
    await sync([opConcluir(x.atividades[1])]);
    expect(await retrato(x.atividades[1])).toEqual({ situacao: "PENDENTE", nome: null, confirmadoEm: null, osConcluida: true, ultimaDaOs: true });
    // Quem só conclui (sem "OS › Editar") não colhe aceite: o retrato não leva nada
    comoTecnico("t1", "uT", montarPermissoes({ ordens: ["visualizar", "concluir"] }));
    expect(await retrato(x.atividades[1])).toBeNull();
  });

  /* ───────── no local ───────── */
  it("NO LOCAL pela fila do app: concluir + aceite no MESMO envio — nome, assinatura, data/hora, IP e navegador do aparelho, quem colheu e onde", async () => {
    const x = await os();
    comoTecnico();
    const antes = Date.now();
    const r = await sync([opConcluir(x.a), opAceite(x.a)]);
    expect(r.map((o) => [o.ok, o.status])).toEqual([[true, 200], [true, 201]]);
    expect(r[1].dados).toMatchObject({ situacao: "CONFIRMADO", nome: "João Pereira da Silva", jaEstava: false });
    const a = await aceite(x.id);
    expect(a).toMatchObject({
      situacao: "CONFIRMADO", metodo: "LOCAL", nome: "João Pereira da Silva", assinatura: ASSINATURA, ip: "189.10.20.30", userAgent: APARELHO["user-agent"],
      colhidoPorId: "uT", atividadeId: x.a, contatoId: null, observacao: null,
    });
    expect(a.confirmadoEm.getTime()).toBeGreaterThanOrEqual(antes - 1000);
    expect(await statusDa(x.id)).toBe("CONCLUIDA");
    expect(await historico(x.id, "Serviço confirmado pelo cliente")).toEqual(["Serviço confirmado pelo cliente | No local, por João Pereira da Silva (assinatura colhida na tela) | uT"]);
  });

  it("a fila é idempotente: a mesma operação reenviada não regrava; um segundo aceite não troca quem já assinou", async () => {
    const x = await os();
    comoTecnico();
    const primeiro = opAceite(x.a, "João Pereira da Silva");
    await sync([opConcluir(x.a), primeiro]);
    const a = await aceite(x.id);
    expect((await sync([primeiro]))[0]).toMatchObject({ ok: true, repetida: true });
    const [outro] = await sync([opAceite(x.a, "Outra Pessoa")]);
    expect(outro).toMatchObject({ ok: true, status: 200, dados: { situacao: "CONFIRMADO", nome: "João Pereira da Silva", jaEstava: true } });
    const depois = await aceite(x.id);
    expect([depois.nome, depois.confirmadoEm.getTime(), depois.atualizadoEm.getTime()]).toEqual([a.nome, a.confirmadoEm.getTime(), a.atualizadoEm.getTime()]);
    expect(await historico(x.id, "Serviço confirmado pelo cliente")).toHaveLength(1);
  });

  it("o que a fila NÃO aceita: aceite antes de concluir, sem assinatura, sem nome, de quem só conclui, ou em atividade de outro técnico", async () => {
    const x = await os();
    comoTecnico();
    expect((await sync([opAceite(x.a)]))[0]).toMatchObject({ ok: false, status: 409, erro: "Conclua a atividade antes de colher o aceite do cliente." });
    await sync([opConcluir(x.a)]);
    expect((await sync([opAceite(x.a, "João Pereira", "")]))[0]).toMatchObject({ ok: false, status: 400, erro: "Peça para o cliente assinar no quadro." });
    expect((await sync([opAceite(x.a, "Jo")]))[0]).toMatchObject({ ok: false, status: 400, erro: "Informe o nome completo de quem confirma." });
    comoTecnico("t1", "uT", montarPermissoes({ ordens: ["visualizar", "concluir"] }));
    expect((await sync([opAceite(x.a)]))[0]).toMatchObject({ ok: false, status: 403, erro: "Sem permissão para registrar o aceite do cliente." });
    comoTecnico("t2", "uT2");
    expect((await sync([opAceite(x.a)]))[0]).toMatchObject({ ok: false, status: 403 });
    expect(await aceite(x.id)).toMatchObject({ situacao: "PENDENTE", nome: null, assinatura: null });
    comoTecnico();
    expect((await sync([opAceite(x.a)]))[0]).toMatchObject({ ok: true, status: 201 });
  });

  it("assinatura colhida numa visita que não era a última (aparelho desatualizado) não é jogada fora: vale, e a OS não fica 'aguardando' quando concluir", async () => {
    const x = await os({}, [{}, { status: "AGENDADA" }]);
    comoTecnico();
    const r = await sync([opConcluir(x.atividades[0]), opAceite(x.atividades[0])]);
    expect(r.map((o) => o.ok)).toEqual([true, true]);
    expect(await statusDa(x.id)).not.toBe("CONCLUIDA");
    expect(await aceite(x.id)).toMatchObject({ situacao: "CONFIRMADO", metodo: "LOCAL", atividadeId: x.atividades[0] });
    await sync([opConcluir(x.atividades[1])]);
    expect(await statusDa(x.id)).toBe("CONCLUIDA");
    expect(await prisma.osAceite.count({ where: { ordemServicoId: x.id } })).toBe(1);
    comoEscritorio();
    expect((await chamar(R_ACEITE, "GET", { id: x.id })).json.estado).toBe("CONFIRMADO");
  });

  it("NO LOCAL pelo escritório: só de OS concluída; grava como no app; já confirmado não é regravado", async () => {
    const aberta = await os();
    const corpo = { nome: "  Marta Nunes  ", assinatura: ASSINATURA };
    expect(await erro(chamar(R_ACEITE, "POST", { id: aberta.id }, corpo))).toBe("409 A OS ainda não está concluída.");
    expect(await aceite(aberta.id)).toBeNull();
    const x = await concluida();
    expect(await erro(chamar(R_ACEITE, "POST", { id: x.id }, { nome: "Marta Nunes" }))).toBe("400 Peça para o cliente assinar no quadro.");
    expect(await erro(chamar(R_ACEITE, "POST", { id: x.id }, { nome: "", assinatura: ASSINATURA }))).toBe("400 Informe o nome completo de quem confirma.");
    expect(await erro(chamar(R_ACEITE, "POST", { id: x.id }, { ...corpo, situacao: "CONFIRMADO" }))).toMatch(/^400 /); // nada além de nome e assinatura
    expect((await aceite(x.id)).situacao).toBe("PENDENTE");
    const r = await chamar(R_ACEITE, "POST", { id: x.id }, corpo, { "x-forwarded-for": "177.1.2.3" });
    expect(r).toMatchObject({ status: 200, json: { estado: "CONFIRMADO", jaEstava: false, aceite: { situacao: "CONFIRMADO", metodo: "LOCAL", nome: "Marta Nunes", colhidoPor: "Ana Souza", ip: "177.1.2.3", assinatura: ASSINATURA } } });
    expect(await aceite(x.id)).toMatchObject({ colhidoPorId: "uA", atividadeId: null, nome: "Marta Nunes" });
    const de_novo = await chamar(R_ACEITE, "POST", { id: x.id }, { nome: "Outra Pessoa", assinatura: ASSINATURA });
    expect(de_novo.json).toMatchObject({ jaEstava: true, aceite: { nome: "Marta Nunes" } });
    expect(await historico(x.id, "Serviço confirmado pelo cliente")).toEqual(["Serviço confirmado pelo cliente | No local, por Marta Nunes (assinatura colhida na tela) | uA"]);
    // OS cancelada: nada de aceite
    const cancelada = await concluida();
    await prisma.ordemServico.update({ where: { id: cancelada.id }, data: { status: "CANCELADA" } });
    expect(await erro(chamar(R_ACEITE, "POST", { id: cancelada.id }, corpo))).toBe("409 Esta OS foi cancelada.");
  });

  /* ───────── remoto: o pedido ───────── */
  it("ENVIAR AO CLIENTE (um clique): e-mail pelo envio da empresa + WhatsApp com a mensagem pronta, para os contatos de Ordens do cliente", async () => {
    const x = await concluida();
    const { token } = await aceite(x.id);
    const link = `${ORIGEM}/relatorio/aceite/${token}`;
    const r = await chamar(R_ENVIAR, "POST", { id: x.id });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ publicUrl: link, canal: "WHATSAPP_EMAIL", emailEnviado: true, emailPara: "manutencao@hospital.com", erroEmail: null });
    // E-mail: o modelo do aceite, com a OS no assunto e o botão que leva ao link
    expect(resend.enviados).toHaveLength(1);
    const email = resend.enviados[0];
    expect([email.to, email.cc, email.from]).toEqual(["manutencao@hospital.com", ["copia@hospital.com"], "Clima Total <avisos@ct.com.br>"]);
    expect(email.subject).toBe(`Confirme o serviço da OS ${(await prisma.ordemServico.findUnique({ where: { id: x.id } })).numero} — Clima Total`);
    expect(email.html).toContain("Hospital Santa Luzia");
    expect(email.html).toContain(link);
    expect(email.html).toContain("Ver o relatório e confirmar");
    // WhatsApp: o número do contato de Ordens, com a OS e o link na mensagem
    const wa = new URL(r.json.whatsappUrl);
    expect(`${wa.origin}${wa.pathname}`).toBe("https://wa.me/5511966665555");
    expect(wa.searchParams.get("text")).toBe(r.json.mensagem);
    expect(r.json.mensagem).toBe(`Olá! Concluímos o serviço da OS-${1000 + n}.\n\nVeja o relatório do que foi feito e confirme o recebimento:\n${link}\n\nClima Total`);
    // Registro: o último pedido e o histórico; a confirmação continua pendente
    const a = await aceite(x.id);
    expect(a).toMatchObject({ situacao: "PENDENTE", envios: 1, enviadoCanal: "WHATSAPP_EMAIL", enviadoPara: "manutencao@hospital.com · WhatsApp (11) 96666-5555", token });
    expect(a.enviadoEm).toBeInstanceOf(Date);
    expect(await historico(x.id, "Confirmação do cliente pedida")).toEqual(["Confirmação do cliente pedida | por WhatsApp e e-mail: manutencao@hospital.com · WhatsApp (11) 96666-5555 | uA"]);
    const log = await prisma.emailLog.findFirst({ where: { empresaId: "e1", referenciaId: x.id } });
    expect(log).toMatchObject({ para: "manutencao@hospital.com", assunto: email.subject, referenciaTipo: "OrdemServico", status: "ENVIADO" });
  });

  it("chamado do portal: o pedido vai primeiro para quem abriu o chamado (e-mail e WhatsApp dele), tratado pelo nome; reenviar soma e mantém o MESMO link", async () => {
    const x = await concluida({ contatoOrigemId: "kChamado", origem: "PORTAL_CLIENTE" });
    const r = await chamar(R_ENVIAR, "POST", { id: x.id });
    expect(resend.enviados[0].to).toBe("recepcao@hospital.com");
    expect(resend.enviados[0].cc).toEqual(["manutencao@hospital.com", "copia@hospital.com"]);
    expect(r.json.whatsappUrl.startsWith("https://wa.me/5511944443333?text=")).toBe(true);
    expect(r.json.mensagem.startsWith("Olá, Recepção! Concluímos o serviço da OS-")).toBe(true);
    const r2 = await chamar(R_ENVIAR, "POST", { id: x.id });
    expect(r2.json.publicUrl).toBe(r.json.publicUrl);
    expect(await aceite(x.id)).toMatchObject({ envios: 2, situacao: "PENDENTE" });
    expect(await historico(x.id, "Confirmação do cliente pedida")).toHaveLength(2);
  });

  it("o que sai é o que existe: sem e-mail da empresa, cliente que não recebe e-mail de OS, falha do Resend, cliente sem contato nenhum", async () => {
    // E-mail da empresa desligado: só WhatsApp
    await prisma.emailConfig.update({ where: { empresaId: "e1" }, data: { ativo: false } });
    const semConfig = await concluida();
    expect((await chamar(R_ENVIAR, "POST", { id: semConfig.id })).json).toMatchObject({ canal: "WHATSAPP", emailEnviado: false, emailPara: null, erroEmail: "e-mail da empresa não configurado" });
    expect(resend.enviados).toHaveLength(0);
    expect(await aceite(semConfig.id)).toMatchObject({ enviadoCanal: "WHATSAPP", enviadoPara: "WhatsApp (11) 96666-5555", envios: 1 });
    await prisma.emailConfig.update({ where: { empresaId: "e1" }, data: { ativo: true } });
    // Cliente marcado para não receber e-mail de OS: respeita, e manda só o WhatsApp do cadastro
    const naoQuer = await concluida({ clienteId: "cNao" });
    const rNao = (await chamar(R_ENVIAR, "POST", { id: naoQuer.id })).json;
    expect(rNao).toMatchObject({ canal: "WHATSAPP", emailEnviado: false, erroEmail: "o cliente não recebe e-mails de OS (cadastro do cliente)" });
    expect(rNao.whatsappUrl.startsWith("https://wa.me/5511955551234?text=")).toBe(true);
    expect(resend.enviados).toHaveLength(0);
    // O Resend recusou: o pedido não falha, diz o motivo
    resend.falhar = true;
    const falhou = await concluida();
    expect((await chamar(R_ENVIAR, "POST", { id: falhou.id })).json).toMatchObject({ canal: "WHATSAPP", emailEnviado: false, erroEmail: "falha no envio: Domínio não verificado" });
    resend.falhar = false;
    // Cliente sem WhatsApp e sem e-mail: sobra o link (fica pendente no portal)
    const sem = await concluida({ clienteId: "cSem" });
    const rSem = (await chamar(R_ENVIAR, "POST", { id: sem.id })).json;
    expect(rSem).toMatchObject({ canal: "LINK", whatsappUrl: null, emailEnviado: false, erroEmail: "o cliente não tem e-mail para avisos de OS" });
    expect(await aceite(sem.id)).toMatchObject({ enviadoCanal: "LINK", enviadoPara: null, envios: 1 });
    expect(await historico(sem.id, "Confirmação do cliente pedida")).toEqual(["Confirmação do cliente pedida | link gerado (sem WhatsApp nem e-mail no cadastro) | uA"]);
  });

  it("só se pede aceite de OS concluída e ainda não confirmada; OS concluída ANTES do aceite existir pode ser pedida (nasce o registro)", async () => {
    const aberta = await os();
    expect(await erro(chamar(R_ENVIAR, "POST", { id: aberta.id }))).toBe("409 A OS ainda não está concluída.");
    expect(await aceite(aberta.id)).toBeNull();
    const confirmada = await concluida();
    await chamar(R_ACEITE, "POST", { id: confirmada.id }, { nome: "Marta Nunes", assinatura: ASSINATURA });
    expect(await erro(chamar(R_ENVIAR, "POST", { id: confirmada.id }))).toBe("409 Este serviço já foi confirmado.");
    expect(resend.enviados).toHaveLength(0);
    // Legado: concluída direto no banco, sem registro de aceite
    const antiga = await os({ status: "CONCLUIDA", dataConclusao: new Date("2026-09-01T12:00:00Z") }, [{ status: "CONCLUIDA" }]);
    expect((await chamar(R_ACEITE, "GET", { id: antiga.id })).json).toEqual({ estado: "NAO_SE_APLICA", statusOs: "CONCLUIDA", aceite: null, caminhoPublico: null });
    expect((await chamar(R_ENVIAR, "POST", { id: antiga.id })).status).toBe(200);
    expect(await aceite(antiga.id)).toMatchObject({ situacao: "PENDENTE", envios: 1 });
    expect((await chamar(R_ACEITE, "GET", { id: antiga.id })).json.estado).toBe("AGUARDANDO");
  });

  it("técnico do app dispara o envio nas OS DELE; o número do cliente só vai para o aparelho com 'Exibir contatos do cliente'", async () => {
    const x = await concluida();
    comoTecnico();
    const com = (await chamar(R_ENVIAR, "POST", { id: x.id })).json;
    expect(com).toMatchObject({ canal: "WHATSAPP_EMAIL", emailEnviado: true });
    expect(com.whatsappUrl).toContain("wa.me/5511966665555");
    await opcao({ appExibirContatosCliente: false });
    const sem = (await chamar(R_ENVIAR, "POST", { id: x.id })).json;
    expect(sem).toMatchObject({ canal: "EMAIL", whatsappUrl: null, emailEnviado: true }); // o e-mail sai do servidor; o número não vai para o aparelho
    expect((await aceite(x.id)).enviadoPara).toBe("manutencao@hospital.com");
    // O escritório não é afetado por essa opção do app
    comoEscritorio();
    expect((await chamar(R_ENVIAR, "POST", { id: x.id })).json.whatsappUrl).toContain("wa.me/5511966665555");
    // OS de outro técnico: o técnico do app não vê, não envia e não colhe
    const alheia = await os({}, [{ tecnicoId: "t2" }]);
    await prisma.ordemServico.update({ where: { id: alheia.id }, data: { status: "CONCLUIDA" } });
    comoTecnico();
    expect(await erro(chamar(R_ENVIAR, "POST", { id: alheia.id }))).toBe("403 Esta OS não está atribuída a você. Fale com o escritório.");
    expect((await chamar(R_ACEITE, "POST", { id: alheia.id }, { nome: "Fulano de Tal", assinatura: ASSINATURA })).status).toBe(403);
    expect((await chamar(R_ACEITE, "GET", { id: alheia.id })).status).toBe(403);
    expect((await chamar(R_ACEITE, "GET", { id: "nao-existe" })).status).toBe(404);
    expect(await aceite(alheia.id)).toBeNull();
  });

  /* ───────── remoto: a confirmação pelo link ───────── */
  it("CONFIRMAR PELO LINK (sem login, só o token): nome + IP + navegador + data/hora — o mesmo mecanismo do orçamento", async () => {
    const x = await concluida();
    const { token } = await aceite(x.id);
    sessao.atual = null; // ninguém logado: o link público só precisa do token
    const antes = Date.now();
    const r = await chamar(R_PUBLICO, "POST", { token }, { nome: "  Roberto Almeida ", observacao: " Tudo certo, equipe pontual " }, CLIENTE_IP);
    expect(r).toMatchObject({ status: 200, json: { ok: true, situacao: "CONFIRMADO", nome: "Roberto Almeida" } });
    const a = await aceite(x.id);
    expect(a).toMatchObject({
      situacao: "CONFIRMADO", metodo: "REMOTO", nome: "Roberto Almeida", observacao: "Tudo certo, equipe pontual", ip: "200.150.10.5", userAgent: CLIENTE_IP["user-agent"],
      assinatura: null, colhidoPorId: null, atividadeId: null, contatoId: null,
    });
    expect(a.confirmadoEm.getTime()).toBeGreaterThanOrEqual(antes - 1000);
    expect(new Date(r.json.confirmadoEm).getTime()).toBe(a.confirmadoEm.getTime());
    expect(await statusDa(x.id)).toBe("CONCLUIDA");
    // O histórico da OS guarda a prova (em nome de quem abriu a OS: o cliente não é usuário do sistema)
    expect(await historico(x.id, "Serviço confirmado pelo cliente")).toEqual(["Serviço confirmado pelo cliente | Pelo link, por Roberto Almeida (IP 200.150.10.5). Observação: Tudo certo, equipe pontual | uA"]);
  });

  it("troca ATÔMICA: confirmar de novo (ou dois cliques ao mesmo tempo) não troca quem confirmou", async () => {
    const x = await concluida();
    const { token } = await aceite(x.id);
    const respostas = await Promise.all(["Primeira Pessoa", "Segunda Pessoa", "Terceira Pessoa"].map((nome) => chamar(R_PUBLICO, "POST", { token }, { nome }, CLIENTE_IP)));
    expect(respostas.map((r) => r.status).sort()).toEqual([200, 409, 409]);
    const vencedor = respostas.find((r) => r.status === 200)!.json.nome;
    expect((await aceite(x.id)).nome).toBe(vencedor);
    expect(await erro(chamar(R_PUBLICO, "POST", { token }, { nome: "Quarta Pessoa" }))).toBe("409 Este serviço já foi confirmado.");
    expect((await aceite(x.id)).nome).toBe(vencedor);
    expect(await historico(x.id, "Serviço confirmado pelo cliente")).toHaveLength(1);
  });

  it("o que o link NÃO confirma: token errado, nome faltando, OS reaberta, OS cancelada; IP forjado não é gravado", async () => {
    const x = await concluida();
    const { token } = await aceite(x.id);
    expect(await erro(chamar(R_PUBLICO, "POST", { token: "token-que-nao-existe" }, { nome: "Roberto Almeida" }))).toBe("404 Link de confirmação não encontrado");
    expect(await erro(chamar(R_PUBLICO, "POST", { token: x.id }, { nome: "Roberto Almeida" }))).toMatch(/^404/); // o id da OS não é o token
    expect(await erro(chamar(R_PUBLICO, "POST", { token }, { nome: "Ro" }))).toBe("400 Informe o nome completo de quem confirma.");
    expect(await erro(chamar(R_PUBLICO, "POST", { token }, {}))).toBe("400 Informe o nome completo de quem confirma.");
    expect(await erro(chamar(R_PUBLICO, "POST", { token }, { nome: "Roberto Almeida", situacao: "CONFIRMADO" }))).toMatch(/^400 /);
    await prisma.ordemServico.update({ where: { id: x.id }, data: { status: "EM_ANDAMENTO" } });
    expect(await erro(chamar(R_PUBLICO, "POST", { token }, { nome: "Roberto Almeida" }))).toBe("409 Este serviço não está disponível para confirmação agora.");
    await prisma.ordemServico.update({ where: { id: x.id }, data: { status: "CANCELADA" } });
    expect(await erro(chamar(R_PUBLICO, "POST", { token }, { nome: "Roberto Almeida" }))).toBe("409 Esta OS foi cancelada.");
    expect(await aceite(x.id)).toMatchObject({ situacao: "PENDENTE", nome: null, ip: null });
    await prisma.ordemServico.update({ where: { id: x.id }, data: { status: "CONCLUIDA" } });
    expect((await chamar(R_PUBLICO, "POST", { token }, { nome: "Roberto Almeida" }, { "x-forwarded-for": "<script>alert(1)</script>", "user-agent": "x".repeat(900) })).status).toBe(200);
    const a = await aceite(x.id);
    expect(a.ip).toBeNull();
    expect(a.userAgent).toHaveLength(300);
  });

  it("confirmando logado no portal: o contato fica registrado — só se for do MESMO cliente", async () => {
    const x = await concluida();
    comoContato("kPrincipal", "c1");
    await chamar(R_PUBLICO, "POST", { token: (await aceite(x.id)).token }, { nome: "Dra. Paula Reis" }, CLIENTE_IP);
    expect(await aceite(x.id)).toMatchObject({ situacao: "CONFIRMADO", metodo: "REMOTO", contatoId: "kPrincipal", ip: "200.150.10.5" });
    // Contato de OUTRO cliente (ou de outra empresa) com o link na mão: confirma como qualquer pessoa com o token, sem virar "o contato"
    for (const [contato, cliente, empresa] of [["kShopping", "c2", "e1"], ["kE2", "cE2", "e2"]]) {
      const y = await concluida();
      comoContato(contato, cliente, empresa);
      expect((await chamar(R_PUBLICO, "POST", { token: (await aceite(y.id)).token }, { nome: "Pessoa de fora" })).status).toBe(200);
      expect((await aceite(y.id)).contatoId, contato).toBeNull();
    }
  });

  /* ───────── portal: pendências e gate ───────── */
  it("PENDÊNCIAS do cliente: só as OS DELE, concluídas e ainda não confirmadas — da mais recente para a mais antiga, dizendo qual serviço", async () => {
    const { pendenciasDoCliente } = await import("@/lib/os/aceite-server");
    const antiga = await concluida();
    await prisma.ordemServico.update({ where: { id: antiga.id }, data: { dataConclusao: new Date("2026-10-01T15:00:00Z") } });
    const nova = await concluida();
    await prisma.ordemServico.update({ where: { id: nova.id }, data: { dataConclusao: new Date("2026-11-05T15:00:00Z") } });
    const confirmada = await concluida();
    await chamar(R_PUBLICO, "POST", { token: (await aceite(confirmada.id)).token }, { nome: "Roberto Almeida" });
    const reaberta = await concluida();
    await prisma.ordemServico.update({ where: { id: reaberta.id }, data: { status: "EM_ANDAMENTO" } });
    await concluida({ clienteId: "c2" });                 // de outro cliente da mesma empresa
    await os();                                           // em andamento
    await os({ status: "CONCLUIDA" }, [{ status: "CONCLUIDA" }]); // concluída antes do aceite existir: sem registro
    const lista = await pendenciasDoCliente("e1", "c1");
    expect(lista.map((p) => p.osId)).toEqual([nova.id, antiga.id]);
    expect(lista[0]).toMatchObject({ numero: (await prisma.ordemServico.findUnique({ where: { id: nova.id } })).numero, servico: "Manutenção Preventiva", token: (await aceite(nova.id)).token });
    expect(lista[0].concluidaEm).toEqual(new Date("2026-11-05T15:00:00Z"));
    expect((await pendenciasDoCliente("e1", "c2")).length).toBe(1);
    expect(await pendenciasDoCliente("e2", "c1")).toEqual([]); // a empresa errada não enxerga nada
    expect(await pendenciasDoCliente("e1", "cE2")).toEqual([]);
  });

  const chamado = (extra: Record<string, unknown> = {}) => chamar("portal/chamados", "POST", {}, { descricao: "Split da recepção pingando água", urgencia: "NORMAL", fotos: [], ...extra });

  it("SOFT GATE (padrão): com confirmações pendentes o cliente ABRE o chamado normalmente — nada bloqueia", async () => {
    await concluida(); await concluida();
    comoContato();
    const r = await chamado();
    expect(r.status).toBe(201);
    expect(await prisma.ordemServico.findUnique({ where: { id: r.json.id } })).toMatchObject({ origem: "PORTAL_CLIENTE", contatoOrigemId: "kPrincipal", status: "AGUARDANDO_ATENDIMENTO" });
    expect(await historico(r.json.id, "Chamado aberto em emergência")).toEqual([]);
    // Declarar emergência sem a empresa exigir nada: é um chamado comum
    const e = await chamado({ emergencia: true });
    expect(e.status).toBe(201);
    expect(await historico(e.json.id, "Chamado aberto em emergência")).toEqual([]);
    expect(await prisma.osAceite.count({ where: { situacao: "PENDENTE" } })).toBe(2);
  });

  it("BLOQUEIO POR EMPRESA: opção ligada + pendência = 409 (o servidor decide); a EMERGÊNCIA abre sempre e fica no histórico", async () => {
    const p1 = await concluida(); const p2 = await concluida();
    await opcao({ portalAceiteObrigatorio: true });
    comoContato();
    const antes = await prisma.ordemServico.count();
    const bloqueado = await chamado();
    expect(bloqueado).toMatchObject({ status: 409, json: { erro: "Antes de abrir um novo chamado, confirme os serviços pendentes — ou abra como emergência.", pendentes: 2 } });
    expect((await chamado({ emergencia: false })).status).toBe(409);
    expect(await prisma.ordemServico.count()).toBe(antes);
    // Saída de emergência: o chamado nasce, as pendências continuam, e o escritório vê o que houve
    const e = await chamado({ emergencia: true, urgencia: "CRITICO", descricao: "Chiller parado, UTI sem climatização" });
    expect(e.status).toBe(201);
    expect(await prisma.ordemServico.findUnique({ where: { id: e.json.id } })).toMatchObject({ origem: "PORTAL_CLIENTE", prioridade: "CRITICO" });
    const numeros = (await prisma.ordemServico.findMany({ where: { id: { in: [p1.id, p2.id] } }, orderBy: { dataConclusao: "desc" }, select: { numero: true } })).map((o: any) => o.numero);
    expect(await historico(e.json.id, "Chamado aberto em emergência")).toEqual([`Chamado aberto em emergência | O cliente declarou emergência com 2 confirmações pendentes: ${numeros.join(", ")} | uA`]);
    expect(await prisma.osAceite.count({ where: { situacao: "PENDENTE" } })).toBe(2);
    // Confirmou tudo: o chamado volta a abrir sem emergência, mesmo com a opção ligada
    for (const p of [p1, p2]) await chamar(R_PUBLICO, "POST", { token: (await aceite(p.id)).token }, { nome: "Dra. Paula Reis" });
    const livre = await chamado();
    expect(livre.status).toBe(201);
    expect(await historico(livre.json.id, "Chamado aberto em emergência")).toEqual([]);
  });

  it("o bloqueio é POR EMPRESA e por cliente: a opção de uma empresa não afeta a outra; pendência de outro cliente não bloqueia", async () => {
    await concluida({ clienteId: "c2" });                      // pendência do shopping
    await opcao({ portalAceiteObrigatorio: true }, "e2");      // só a OUTRA empresa exige
    comoContato();
    expect((await chamado()).status).toBe(201);                // e1 não exige: livre
    await opcao({ portalAceiteObrigatorio: true });
    expect((await chamado()).status).toBe(201);                // e1 exige, mas o hospital não tem pendência (a do shopping não conta)
    comoContato("kShopping", "c2");
    expect((await chamado()).status).toBe(409);                // o shopping, sim
  });

  it("a opção da empresa: quem gerencia as configurações liga e desliga; nasce desligada; outra empresa não é tocada", async () => {
    await prisma.configuracao.deleteMany({});
    expect((await chamar("configuracoes", "GET", {})).json.portalAceiteObrigatorio).toBe(false);
    expect((await chamar("configuracoes", "PUT", {}, { portalAceiteObrigatorio: true })).status).toBe(200);
    const { aceiteObrigatorioNoPortal } = await import("@/lib/os/aceite-server");
    expect([await aceiteObrigatorioNoPortal("e1"), await aceiteObrigatorioNoPortal("e2")]).toEqual([true, false]);
    expect((await chamar("configuracoes", "PUT", {}, { portalAceiteObrigatorio: "sim" })).status).toBe(400);
    comoEscritorio(montarPermissoes({ ordens: ["visualizar", "editar"], configuracoes: ["visualizar"] }));
    expect((await chamar("configuracoes", "PUT", {}, { portalAceiteObrigatorio: false })).status).toBe(403);
    expect(await aceiteObrigatorioNoPortal("e1")).toBe(true);
  });

  /* ───────── relatório ───────── */
  it("RELATÓRIO da OS: o aceite confirmado entra como prova (interno e pelo link do relatório); pendente não entra", async () => {
    const { relatorioInterno, relatorioPorToken } = await import("@/lib/relatorio-os/dados");
    const x = await concluida();
    expect((await relatorioInterno(x.id, "e1"))!.dados.aceite).toBeNull();
    comoTecnico();
    await sync([opAceite(x.a)]);
    const interno = (await relatorioInterno(x.id, "e1"))!.dados.aceite!;
    expect(interno).toMatchObject({ nome: "João Pereira da Silva", metodo: "LOCAL", ip: "189.10.20.30", assinatura: ASSINATURA, colhidoPor: "João Silva", observacao: null });
    expect(interno.confirmadoEm).toBeInstanceOf(Date);
    const rel = await prisma.relatorioOs.findFirst({ where: { ordemServicoId: x.id, escopo: "GERAL" } });
    expect((await relatorioPorToken(rel.tokenPublico))!.dados.aceite).toMatchObject({ nome: "João Pereira da Silva", metodo: "LOCAL" });
    expect(await relatorioInterno(x.id, "e2")).toBeNull(); // a outra empresa não lê
  });

  /* ───────── permissões ───────── */
  it("RBAC: ver = OS › Visualizar; enviar e colher no local = OS › Editar; sem módulo, sem login e outra empresa não passam", async () => {
    const x = await concluida();
    const antes = JSON.stringify(await aceite(x.id));
    const todas = async () => [
      (await chamar(R_ACEITE, "GET", { id: x.id })).status, (await chamar(R_ENVIAR, "POST", { id: x.id })).status,
      (await chamar(R_ACEITE, "POST", { id: x.id }, { nome: "Fulano de Tal", assinatura: ASSINATURA })).status,
    ];
    comOs(["visualizar"]);
    expect(await todas()).toEqual([200, 403, 403]);
    comOs(["visualizar", "criar", "concluir", "excluir"]); // tudo menos editar
    expect(await todas()).toEqual([200, 403, 403]);
    comoEscritorio(montarPermissoes({ pmoc: ["visualizar", "editar"], financeiro: ["visualizar"] })); // sem o módulo de OS
    expect(await todas()).toEqual([403, 403, 403]);
    sessao.atual = null;
    expect(await todas()).toEqual([401, 401, 401]);
    comoEscritorio(permissoesTotais(), "e2"); // outra empresa, com tudo liberado
    expect(await todas()).toEqual([404, 404, 404]);
    expect(JSON.stringify(await aceite(x.id))).toBe(antes);
    expect(resend.enviados).toHaveLength(0);
    // A leitura do aceite é por empresa: com o id da OS na mão, a outra empresa não lê nada
    const { aceiteDaOs } = await import("@/lib/os/aceite-server");
    expect(await aceiteDaOs(x.id, "e2")).toBeNull();
    expect((await aceiteDaOs(x.id, "e1"))!.situacao).toBe("PENDENTE");
    comOs(["visualizar", "editar"]);
    expect(await todas()).toEqual([200, 200, 200]);
    // O link público não depende de nada disso: só do token (testado acima) — e as rotas da OS nunca devolvem o aceite de outra empresa
    expect((await chamar(R_ACEITE, "GET", { id: x.id })).json.aceite.nome).toBe("Fulano de Tal");
  });
});
