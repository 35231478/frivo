import { NextRequest } from "next/server";
import { camposDesconhecidos, documentosDaEmpresa } from "@/lib/admissao/admissao";
import { configDaEmpresa, salvarConfig } from "@/lib/admissao/admissao-server";
import { corpo, guardaDoRh, responderAdmissao } from "@/lib/admissao/admissao-rotas";

/**
 * A configuração da admissão POR EMPRESA: modelo de contrato, orientações finais, lista de
 * documentos (obrigatórios × opcionais), validade padrão do link e o período de experiência.
 * Nada disto é hardcoded — o que varia entre empresas mora aqui.
 */
export async function GET() {
  const { ator, resposta } = await guardaDoRh();
  if (!ator) return resposta;
  return responderAdmissao(async () => {
    const cfg = await configDaEmpresa(ator.empresaId);
    // Campo que o modelo usa e o sistema não conhece: a tela avisa, em vez de assinar em branco
    return { ...cfg, camposDesconhecidos: camposDesconhecidos(cfg.contratoModelo) };
  });
}

export async function PUT(req: NextRequest) {
  const { ator, resposta } = await guardaDoRh();
  if (!ator) return resposta;
  const b = await corpo(req);
  return responderAdmissao(async () => {
    const cfg = await salvarConfig(ator.empresaId, {
      contratoModelo: typeof b.contratoModelo === "string" ? b.contratoModelo : undefined,
      orientacoes: typeof b.orientacoes === "string" ? b.orientacoes : undefined,
      documentos: Array.isArray(b.documentos) ? documentosDaEmpresa(b.documentos) : undefined,
      validadeDias: typeof b.validadeDias === "number" ? b.validadeDias : undefined,
      experienciaDias: typeof b.experienciaDias === "number" ? b.experienciaDias : undefined,
      experienciaProrrogacaoDias: typeof b.experienciaProrrogacaoDias === "number" ? b.experienciaProrrogacaoDias : undefined,
    });
    return { ...cfg, camposDesconhecidos: camposDesconhecidos(cfg.contratoModelo) };
  });
}
