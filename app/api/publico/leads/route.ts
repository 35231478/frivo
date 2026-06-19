import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { gerarCodigoOrcamento } from "@/lib/utils";
import { enviarEmailInterno } from "@/lib/email";

/**
 * Endpoint público de lead vindo do site institucional (calculadora de BTU).
 * Protegido por API key (header X-Site-Token == SITE_API_TOKEN). NÃO exige login
 * — a rota /api/publico/* já é liberada no middleware.
 *
 * Observação: o model Orcamento não possui campo `origem`; por isso o lead é
 * identificado pelo cliente (origem = SITE) e por um marcador no campo
 * `observacao` (JSON com todos os dados do cálculo). O painel /leads-site filtra
 * por esse marcador.
 */

export const runtime = "nodejs";

const MARCADOR = "SITE_CALCULADORA";

const ambienteSchema = z.object({
  nome: z.string(),
  areaM2: z.number(),
  btuCalculado: z.number(),
  btuRecomendado: z.number(),
  tipoEquipamento: z.string(),
  justificativa: z.string(),
});

const leadSchema = z.object({
  nome: z.string().min(3),
  whatsapp: z.string().min(10),
  email: z.string().email(),
  cidade: z.string().min(1),
  mensagemAdicional: z.string().optional(),
  tipoUso: z.string(),
  recomendacao: z.string().optional(),
  ambientes: z.array(ambienteSchema).min(1),
  preOrcamento: z.object({ totalMin: z.number(), totalMax: z.number() }),
});

type LeadData = z.infer<typeof leadSchema>;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmt(n: number): string {
  return n.toLocaleString("pt-BR");
}

function montarEmailLead(data: LeadData, codigo: string): string {
  const ambientes = data.ambientes
    .map(
      (a) =>
        `<li>${escapeHtml(a.nome)}: ${fmt(a.btuRecomendado)} BTU — ${escapeHtml(a.tipoEquipamento)}</li>`,
    )
    .join("");
  const valor =
    data.preOrcamento.totalMin === 0 && data.preOrcamento.totalMax === 0
      ? "Sob consulta"
      : `R$ ${fmt(data.preOrcamento.totalMin)} a R$ ${fmt(data.preOrcamento.totalMax)}`;
  return `
    <h2>Novo lead da calculadora do site</h2>
    <p><strong>Código do orçamento:</strong> ${escapeHtml(codigo)}</p>
    <p>
      <strong>Nome:</strong> ${escapeHtml(data.nome)}<br/>
      <strong>WhatsApp:</strong> ${escapeHtml(data.whatsapp)}<br/>
      <strong>E-mail:</strong> ${escapeHtml(data.email)}<br/>
      <strong>Cidade:</strong> ${escapeHtml(data.cidade)}<br/>
      <strong>Tipo de uso:</strong> ${escapeHtml(data.tipoUso)}
    </p>
    <p><strong>Ambientes:</strong></p>
    <ul>${ambientes}</ul>
    ${data.recomendacao ? `<p><strong>Recomendação:</strong> ${escapeHtml(data.recomendacao)}</p>` : ""}
    <p><strong>Pré-orçamento estimado:</strong> ${valor}</p>
    ${data.mensagemAdicional ? `<p><strong>Mensagem:</strong> ${escapeHtml(data.mensagemAdicional)}</p>` : ""}
  `;
}

/** empresaId do tenant Termofrio (env), com fallback para a primeira empresa. */
async function resolverEmpresaId(): Promise<string | null> {
  const env = process.env.TERMOFRIO_EMPRESA_ID;
  if (env) return env;
  const empresa = await prisma.empresa.findFirst({
    where: { ativo: true },
    orderBy: { criadoEm: "asc" },
    select: { id: true },
  });
  return empresa?.id ?? null;
}

/** Usuário a quem o lead é atribuído (prefere ADMIN; senão, qualquer ativo). */
async function resolverCriadorId(empresaId: string): Promise<string | null> {
  const admin = await prisma.usuario.findFirst({
    where: { empresaId, ativo: true, role: { in: ["SUPER_ADMIN", "ADMIN"] } },
    orderBy: { criadoEm: "asc" },
    select: { id: true },
  });
  if (admin) return admin.id;
  const qualquer = await prisma.usuario.findFirst({
    where: { empresaId, ativo: true },
    orderBy: { criadoEm: "asc" },
    select: { id: true },
  });
  return qualquer?.id ?? null;
}

export async function POST(req: Request) {
  // 1. Autenticação por API key
  const tokenEsperado = process.env.SITE_API_TOKEN;
  if (!tokenEsperado) {
    console.error("[publico/leads] SITE_API_TOKEN não configurado.");
    return NextResponse.json(
      { success: false, error: "Serviço indisponível." },
      { status: 503 },
    );
  }
  const tokenRecebido = req.headers.get("x-site-token");
  if (!tokenRecebido || tokenRecebido !== tokenEsperado) {
    return NextResponse.json(
      { success: false, error: "Não autorizado." },
      { status: 401 },
    );
  }

  // 2. Validação do corpo
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Requisição inválida." },
      { status: 400 },
    );
  }
  const parsed = leadSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Dados inválidos." },
      { status: 400 },
    );
  }
  const data = parsed.data;

  try {
    // 3. Tenant + usuário responsável
    const empresaId = await resolverEmpresaId();
    if (!empresaId) {
      console.error("[publico/leads] Nenhuma empresa encontrada para o lead.");
      return NextResponse.json(
        { success: false, error: "Não foi possível processar o lead." },
        { status: 500 },
      );
    }
    const criadoPorId = await resolverCriadorId(empresaId);
    if (!criadoPorId) {
      console.error("[publico/leads] Nenhum usuário para atribuir o lead.");
      return NextResponse.json(
        { success: false, error: "Não foi possível processar o lead." },
        { status: 500 },
      );
    }

    // 4. Cliente: reusa um existente por e-mail; senão upsert por telefone
    //    (cpfCnpj placeholder, já que um lead do site não informa CPF/CNPJ).
    const digits = data.whatsapp.replace(/\D/g, "");
    const cpfCnpjPlaceholder = `SITE-${digits || Date.now()}`;
    let cliente = await prisma.cliente.findFirst({
      where: { empresaId, email: { equals: data.email, mode: "insensitive" } },
      select: { id: true },
    });
    if (!cliente) {
      cliente = await prisma.cliente.upsert({
        where: { cpfCnpj_empresaId: { cpfCnpj: cpfCnpjPlaceholder, empresaId } },
        update: {
          nome: data.nome,
          email: data.email,
          celular: data.whatsapp,
          cidade: data.cidade,
        },
        create: {
          empresaId,
          tipoPessoa: "FISICA",
          nome: data.nome,
          cpfCnpj: cpfCnpjPlaceholder,
          email: data.email,
          celular: data.whatsapp,
          cidade: data.cidade,
          origem: "SITE",
          observacoes: "Lead recebido pela calculadora de BTU do site.",
          ativo: true,
        },
        select: { id: true },
      });
    }

    // 5. Observação: JSON com todos os dados do cálculo + marcador do painel
    const observacao = JSON.stringify({
      marcador: MARCADOR,
      tipoUso: data.tipoUso,
      recomendacao: data.recomendacao ?? null,
      ambientes: data.ambientes,
      preOrcamento: data.preOrcamento,
      contato: {
        nome: data.nome,
        whatsapp: data.whatsapp,
        email: data.email,
        cidade: data.cidade,
        mensagemAdicional: data.mensagemAdicional ?? null,
      },
    });

    // 6. Orçamento com numeração ORC-YYYY-NNNN (retry em colisão de unique)
    const ano = new Date().getFullYear();
    let orcamento!: { id: string; codigo: string };
    for (let tentativa = 0; ; tentativa++) {
      const ultimo = await prisma.orcamento.findFirst({
        where: { empresaId, codigo: { startsWith: `ORC-${ano}-` } },
        orderBy: { codigo: "desc" },
        select: { codigo: true },
      });
      const seq = ultimo ? Number(ultimo.codigo.split("-")[2]) + 1 : 1;
      const codigo = gerarCodigoOrcamento(seq);
      try {
        orcamento = await prisma.orcamento.create({
          data: {
            empresaId,
            codigo,
            nome: `Lead do site — ${data.nome}`,
            clienteId: cliente.id,
            criadoPorId,
            descricao: `Lead da calculadora de BTU do site (${data.tipoUso}).`,
            observacao,
            status: "RASCUNHO",
            totalGeral: data.preOrcamento.totalMax,
            tokenPublico: crypto.randomUUID(),
          },
          select: { id: true, codigo: true },
        });
        break;
      } catch (e: unknown) {
        const code = (e as { code?: string })?.code;
        if (code === "P2002" && tentativa < 5) continue; // colisão → próximo número
        throw e;
      }
    }

    // 7. Notificação interna (best-effort — não bloqueia o sucesso do lead)
    const dest = process.env.TERMOFRIO_EMAIL_NOTIFICACAO;
    if (dest) {
      try {
        await enviarEmailInterno(
          empresaId,
          dest,
          `Novo lead do site — ${data.nome} (${orcamento.codigo})`,
          montarEmailLead(data, orcamento.codigo),
        );
      } catch (e) {
        console.error("[publico/leads] Falha ao enviar notificação:", e);
      }
    }

    return NextResponse.json({
      success: true,
      orcamentoId: orcamento.id,
      codigo: orcamento.codigo,
    });
  } catch (e) {
    console.error("[publico/leads] Erro ao processar lead:", e);
    return NextResponse.json(
      { success: false, error: "Erro ao processar o lead." },
      { status: 500 },
    );
  }
}
