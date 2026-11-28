import { NextRequest, NextResponse } from "next/server";
import { exigirDonoDoFrivo } from "@/lib/empresa/guarda-dono";
import { criarEmpresa, listarEmpresas, novaEmpresaSchema } from "@/lib/empresa/criar-empresa";

/**
 * Área de Empresas do dono do Frivo (role SUPER_ADMIN; ver lib/anotacoes/dono.ts):
 *  GET  — a lista mínima das empresas (nome, CNPJ, data, nº de usuários);
 *  POST — "Nova empresa": empresa + configuração + 5 perfis + 6 tipos de OS + 1º administrador.
 * Qualquer outro papel (inclusive o ADMIN de uma empresa-cliente) recebe 403.
 */
export async function GET() {
  const g = await exigirDonoDoFrivo();
  if (g.erro) return g.erro;
  return NextResponse.json({ empresas: await listarEmpresas() });
}

export async function POST(req: NextRequest) {
  const g = await exigirDonoDoFrivo();
  if (g.erro) return g.erro;
  const parsed = novaEmpresaSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const primeira = parsed.error.issues[0];
    return NextResponse.json({ erro: primeira?.message ?? "Dados inválidos.", campo: primeira?.path.join(".") ?? null }, { status: 400 });
  }
  const r = await criarEmpresa(parsed.data);
  if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: r.status });
  return NextResponse.json(r, { status: 201 });
}
