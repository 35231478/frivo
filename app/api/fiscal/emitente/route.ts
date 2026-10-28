import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { exigirPermissao } from "@/lib/permissoes-server";
import { AMBIENTES, ehArquivoCertificado, REGIMES, REGIMES_ESPECIAIS } from "@/lib/nfse/regras";
import { TAMANHO_MAX_CERTIFICADO } from "@/lib/nfse/certificado";
import { carregarEmitente, ErroFiscal, salvarEmitente } from "@/lib/nfse/emitente-server";

/** Vazio vira null; o resto é aparado */
const opcional = z.string().max(120).transform((v) => v.trim() || null);
const booleano = z.enum(["true", "false"]).transform((v) => v === "true");
const camposSchema = z.object({
  inscricaoMunicipal: z.string().max(30, "Inscrição municipal longa demais.").transform((v) => v.trim()),
  regimeTributario: z.union([z.enum(REGIMES), z.literal("")]).transform((v) => v || null),
  regimeEspecial: z.union([z.enum(REGIMES_ESPECIAIS.map((r) => r.id) as [string, ...string[]]), z.literal("")]).transform((v) => v || null),
  incentivoFiscal: booleano,
  incentivadorCultural: booleano,
  ambiente: z.enum(AMBIENTES),
  codigoMunicipio: z.string().transform((v) => v.replace(/\D/g, "")).refine((v) => v === "" || /^\d{7}$/.test(v), "O código IBGE do município tem 7 dígitos.").transform((v) => v || null),
  municipioNome: opcional,
  municipioUf: z.string().transform((v) => v.trim().toUpperCase()).refine((v) => v === "" || /^[A-Z]{2}$/.test(v), "UF inválida.").transform((v) => v || null),
});

/**
 * GET /api/fiscal/emitente — dados fiscais da empresa da sessão e o status do emitente no PlugNotas.
 * POST (multipart) — salva os dados e, com tudo preenchido, cadastra/atualiza o emitente no PlugNotas.
 *   Campos de texto + `certificado` (.pfx, opcional se já enviado) + `senha`. O arquivo e a senha só
 *   vivem nesta requisição (vão ao PlugNotas e são descartados). Financeiro › Fiscal.
 */
export async function GET() {
  const guard = await exigirPermissao("financeiro", "fiscal");
  if (guard.erro) return guard.resposta;
  return NextResponse.json(await carregarEmitente(guard.session.user!.empresaId));
}

export async function POST(req: NextRequest) {
  const guard = await exigirPermissao("financeiro", "fiscal");
  if (guard.erro) return guard.resposta;
  const user = guard.session.user!;
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ erro: "Envie o formulário dos dados fiscais." }, { status: 400 });
  const texto = (k: string) => { const v = form.get(k); return typeof v === "string" ? v : ""; };
  const parsed = camposSchema.safeParse(Object.fromEntries(Object.keys(camposSchema.shape).map((k) => [k, texto(k)])));
  if (!parsed.success) return NextResponse.json({ erro: parsed.error.issues[0]?.message ?? "Dados inválidos." }, { status: 400 });
  const { inscricaoMunicipal, ...dados } = parsed.data;

  const arquivo = form.get("certificado");
  let certificado: { arquivo: Buffer; nome: string; senha: string } | null = null;
  if (arquivo && typeof arquivo !== "string" && arquivo.size > 0) {
    if (arquivo.size > TAMANHO_MAX_CERTIFICADO) return NextResponse.json({ erro: "Arquivo grande demais para um certificado A1 (.pfx)." }, { status: 400 });
    if (!ehArquivoCertificado(arquivo.name)) return NextResponse.json({ erro: "Envie o certificado A1 no formato .pfx ou .p12." }, { status: 400 });
    certificado = { arquivo: Buffer.from(await arquivo.arrayBuffer()), nome: arquivo.name, senha: texto("senha") };
  }
  try {
    const r = await salvarEmitente({ empresaId: user.empresaId, usuarioId: user.id, dados: dados as Parameters<typeof salvarEmitente>[0]["dados"], inscricaoMunicipal, certificado });
    return NextResponse.json({ ...r, emitente: await carregarEmitente(user.empresaId) }, { status: r.sincronizado ? 200 : "erro" in r ? 502 : 200 });
  } catch (e) {
    if (e instanceof ErroFiscal) return NextResponse.json({ erro: e.message }, { status: e.status });
    throw e;
  }
}
