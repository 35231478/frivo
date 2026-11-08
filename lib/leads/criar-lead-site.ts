import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { enviarEmailInterno } from "@/lib/email";
import { formatarData } from "@/lib/utils";
import { comNumero } from "@/lib/numeracao-server";

/**
 * Criação do lead do site (calculadora de BTU), num só lugar, usada tanto pelo endpoint público do
 * site institucional (`/api/publico/leads`, com token) quanto pela calculadora first-party deste app
 * (`/calculadora`, server action, mesma origem). O lead vira:
 *   - um CLIENTE com `origem = SITE` (reaproveitado se já existir por e-mail/telefone), e
 *   - um ORÇAMENTO nomeado "Lead do site — <nome>" (o que a tela "Leads do site" lê).
 *
 * Nunca falha em silêncio: devolve `{ ok:false, erro, campo? }` com mensagem clara, ou lança (e o
 * chamador loga). A notificação por e-mail é best-effort; o sino conta os leads recentes por conta
 * própria (lib/alertas via /api/alertas).
 */

export const ambienteLeadSchema = z.object({
  nome: z.string().min(1),
  areaM2: z.number().nonnegative(),
  btuCalculado: z.number().nonnegative(),
  btuRecomendado: z.number().nonnegative(),
  tipoEquipamento: z.string().min(1),
  justificativa: z.string().default(""),
});

export const leadSiteSchema = z.object({
  nome: z.string().trim().min(3, "Informe o nome completo."),
  whatsapp: z.string().trim().min(10, "Informe um WhatsApp/telefone válido com DDD."),
  email: z.string().trim().email("Informe um e-mail válido."),
  cidade: z.string().trim().min(1, "Informe a cidade.").optional().default(""),
  tipoUso: z.string().trim().min(1).default("Residencial"),
  mensagemAdicional: z.string().trim().optional(),
  recomendacao: z.string().trim().optional(),
  ambientes: z.array(ambienteLeadSchema).min(1, "Calcule ao menos um ambiente."),
  preOrcamento: z.object({ totalMin: z.number().nonnegative(), totalMax: z.number().nonnegative() }).default({ totalMin: 0, totalMax: 0 }),
});

export type DadosLeadSite = z.infer<typeof leadSiteSchema>;
export type ResultadoLead =
  | { ok: true; orcamentoId: string; codigo: string; clienteId: string; empresaId: string }
  | { ok: false; erro: string; campo?: string };

/** Primeiro erro de campo do zod, em mensagem única e clara (padrão do manifesto). */
function primeiroErro(err: z.ZodError): { erro: string; campo?: string } {
  const issue = err.issues[0];
  return { erro: issue?.message ?? "Dados inválidos.", campo: issue?.path?.[0] != null ? String(issue.path[0]) : undefined };
}

const fmt = (n: number) => n.toLocaleString("pt-BR");

/**
 * empresaId do tenant Termofrio (env). Sem a env, só aceita quando existe UMA empresa ativa
 * (instalação single-tenant) — com várias, o lead de um site não pode cair na empresa "mais antiga"
 * de outro cliente do sistema (CO10). Multiempresa: configure TERMOFRIO_EMPRESA_ID.
 */
async function resolverEmpresaId(): Promise<string | null> {
  const env = process.env.TERMOFRIO_EMPRESA_ID;
  if (env) return env;
  const empresas = await prisma.empresa.findMany({ where: { ativo: true }, select: { id: true }, take: 2 });
  if (empresas.length !== 1) {
    console.error("[lead-site] TERMOFRIO_EMPRESA_ID não configurado e há mais de uma empresa ativa: lead recusado");
    return null;
  }
  return empresas[0].id;
}

/** Usuário a quem o lead é atribuído (prefere ADMIN; senão, qualquer ativo). */
async function resolverCriadorId(empresaId: string): Promise<string | null> {
  const admin = await prisma.usuario.findFirst({
    where: { empresaId, ativo: true, role: { in: ["SUPER_ADMIN", "ADMIN"] } },
    orderBy: { criadoEm: "asc" }, select: { id: true },
  });
  if (admin) return admin.id;
  const qualquer = await prisma.usuario.findFirst({ where: { empresaId, ativo: true }, orderBy: { criadoEm: "asc" }, select: { id: true } });
  return qualquer?.id ?? null;
}

/** Observação legível com os dados do contato e do cálculo de BTU (o Zé lê direto no orçamento). */
function montarObservacao(data: DadosLeadSite, fonte: string): string {
  const INSTALACAO_UNIT = 900;
  const qtd = data.ambientes.length;
  const instalTotal = INSTALACAO_UNIT * qtd;
  const dataHora = formatarData(new Date(), "dd/MM/yyyy HH:mm");
  const linhasAmbientes = data.ambientes
    .map((a) => `• ${a.nome}: ${a.areaM2} m² → ${fmt(a.btuRecomendado)} BTU/h — ${a.tipoEquipamento}${a.justificativa ? `\n  ${a.justificativa}` : ""}`)
    .join("\n");
  const totalMin = fmt(data.preOrcamento.totalMin + instalTotal), totalMax = fmt(data.preOrcamento.totalMax + instalTotal);
  return [
    `Lead recebido via ${fonte} — ${dataHora}`,
    ``,
    `DADOS DO CLIENTE`,
    `Nome: ${data.nome}`,
    `WhatsApp: ${data.whatsapp}`,
    `E-mail: ${data.email}`,
    ...(data.cidade ? [`Cidade: ${data.cidade}`] : []),
    `Tipo de uso: ${data.tipoUso}`,
    ...(data.mensagemAdicional ? [`Mensagem: ${data.mensagemAdicional}`] : []),
    ``,
    `AMBIENTES CALCULADOS`,
    linhasAmbientes,
    ``,
    `PRÉ-ORÇAMENTO ESTIMADO`,
    `Equipamentos: R$ ${fmt(data.preOrcamento.totalMin)} a R$ ${fmt(data.preOrcamento.totalMax)}`,
    `Instalação (referência): R$ ${fmt(INSTALACAO_UNIT)} por unidade (${qtd}x = R$ ${fmt(instalTotal)})`,
    `Total estimado: R$ ${totalMin} a R$ ${totalMax}`,
    ``,
    `Valores de referência: orçamento definitivo após visita técnica.`,
  ].join("\n");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function montarEmailLead(data: DadosLeadSite, codigo: string): string {
  const ambientes = data.ambientes.map((a) => `<li>${escapeHtml(a.nome)}: ${fmt(a.btuRecomendado)} BTU — ${escapeHtml(a.tipoEquipamento)}</li>`).join("");
  const valor = data.preOrcamento.totalMin === 0 && data.preOrcamento.totalMax === 0
    ? "Sob consulta" : `R$ ${fmt(data.preOrcamento.totalMin)} a R$ ${fmt(data.preOrcamento.totalMax)}`;
  return `
    <h2>Novo lead da calculadora do site</h2>
    <p><strong>Código do orçamento:</strong> ${escapeHtml(codigo)}</p>
    <p>
      <strong>Nome:</strong> ${escapeHtml(data.nome)}<br/>
      <strong>WhatsApp:</strong> ${escapeHtml(data.whatsapp)}<br/>
      <strong>E-mail:</strong> ${escapeHtml(data.email)}<br/>
      ${data.cidade ? `<strong>Cidade:</strong> ${escapeHtml(data.cidade)}<br/>` : ""}
      <strong>Tipo de uso:</strong> ${escapeHtml(data.tipoUso)}
    </p>
    <p><strong>Ambientes:</strong></p>
    <ul>${ambientes}</ul>
    <p><strong>Pré-orçamento estimado:</strong> ${valor}</p>
    ${data.mensagemAdicional ? `<p><strong>Mensagem:</strong> ${escapeHtml(data.mensagemAdicional)}</p>` : ""}
  `;
}

/**
 * Cria o lead. `fonte` entra na observação/log (ex.: "Calculadora de BTU do site", "Calculadora do Frivo").
 * Devolve erro claro em vez de lançar nos casos esperados (validação, tenant); erros de banco sobem.
 */
export async function criarLeadDoSite(entrada: unknown, fonte = "Calculadora de BTU do site"): Promise<ResultadoLead> {
  const parsed = leadSiteSchema.safeParse(entrada);
  if (!parsed.success) return { ok: false, ...primeiroErro(parsed.error) };
  const data = parsed.data;

  const empresaId = await resolverEmpresaId();
  if (!empresaId) return { ok: false, erro: "Não foi possível identificar a empresa do lead. Configure TERMOFRIO_EMPRESA_ID." };
  const criadoPorId = await resolverCriadorId(empresaId);
  if (!criadoPorId) return { ok: false, erro: "Nenhum usuário ativo para atribuir o lead." };

  // Cliente: reusa por e-mail; senão upsert por telefone (cpfCnpj placeholder — lead não informa CPF/CNPJ)
  const digits = data.whatsapp.replace(/\D/g, "");
  const cpfCnpjPlaceholder = `SITE-${digits || Date.now()}`;
  let cliente = await prisma.cliente.findFirst({ where: { empresaId, email: { equals: data.email, mode: "insensitive" } }, select: { id: true } });
  if (!cliente) {
    cliente = await prisma.cliente.upsert({
      where: { cpfCnpj_empresaId: { cpfCnpj: cpfCnpjPlaceholder, empresaId } },
      update: {}, // lead recorrente reaproveita o cadastro (pode já ser cliente de verdade — CO10)
      create: {
        empresaId, tipoPessoa: "FISICA", nome: data.nome, cpfCnpj: cpfCnpjPlaceholder, email: data.email,
        celular: data.whatsapp, cidade: data.cidade || null, origem: "SITE",
        observacoes: "Lead recebido pela calculadora de BTU do site.", ativo: true,
      },
      select: { id: true },
    });
  }

  // Itens do orçamento: por ambiente, 1 produto (equipamento) + 1 serviço (instalação de referência)
  const qtd = data.ambientes.length;
  const INSTALACAO_UNIT = 900;
  const equipUnit = Math.round(((data.preOrcamento.totalMin + data.preOrcamento.totalMax) / 2 / qtd) * 100) / 100;
  const produtosCreate = data.ambientes.map((a, idx) => ({
    descricao: `${a.tipoEquipamento} — ${fmt(a.btuRecomendado)} BTU/h (${a.nome})`,
    quantidade: 1, valorUnitario: equipUnit, valorTotal: equipUnit, observacao: a.justificativa || null, ordem: idx,
  }));
  const servicosCreate = data.ambientes.map((a, idx) => ({
    descricao: `Instalação e comissionamento — ${a.nome}`, quantidade: 1, valorUnitario: INSTALACAO_UNIT, valorTotal: INSTALACAO_UNIT, ordem: idx,
  }));
  const totalProdutos = produtosCreate.reduce((s, p) => s + p.valorTotal, 0);
  const totalServicos = servicosCreate.reduce((s, p) => s + p.valorTotal, 0);

  const observacao = montarObservacao(data, fonte);
  // Orçamento numerado pelo contador da empresa, sob trava (nunca duplica)
  const orcamento = await comNumero(empresaId, "orcamento", (codigo, tx) =>
    tx.orcamento.create({
      data: {
        empresaId, codigo, nome: `Lead do site — ${data.nome}`, clienteId: cliente!.id, criadoPorId,
        descricao: data.recomendacao ?? `Calculadora de BTU (${data.tipoUso})`, observacao, status: "RASCUNHO",
        totalServicos, totalProdutos, totalGeral: totalProdutos + totalServicos,
        tokenPublico: crypto.randomUUID(),
        produtos: { create: produtosCreate }, servicos: { create: servicosCreate },
      },
      select: { id: true, codigo: true },
    }));

  // Notificação por e-mail (best-effort — não derruba o lead; o sino conta o lead por conta própria)
  const dest = process.env.TERMOFRIO_EMAIL_NOTIFICACAO;
  if (dest) {
    try {
      await enviarEmailInterno(empresaId, dest, `Novo lead do site — ${data.nome} (${orcamento.codigo})`, montarEmailLead(data, orcamento.codigo));
    } catch (e) {
      console.error("[lead-site] Falha ao enviar notificação por e-mail:", e);
    }
  }

  return { ok: true, orcamentoId: orcamento.id, codigo: orcamento.codigo, clienteId: cliente.id, empresaId };
}
