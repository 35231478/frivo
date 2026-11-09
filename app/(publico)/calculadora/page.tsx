import type { Metadata } from "next";
import { Snowflake } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { CalculadoraWizard } from "@/components/publico/calculadora-wizard";

export const metadata: Metadata = {
  title: "Calculadora de BTU",
  description: "Capacidade ideal do ar-condicionado e orçamento sem compromisso.",
};

// Página pública (sem login): calcula o BTU e envia o lead para o Frivo.
export const dynamic = "force-dynamic";

/** WhatsApp da empresa que recebe os leads (env > cadastro). Público: só o número para o link wa.me. */
async function whatsappDaEmpresa(): Promise<string | null> {
  const env = process.env.TERMOFRIO_WHATSAPP;
  if (env) return env;
  const id = process.env.TERMOFRIO_EMPRESA_ID;
  const empresa = id
    ? await prisma.empresa.findUnique({ where: { id }, select: { celular: true, telefone: true } })
    : (await prisma.empresa.findMany({ where: { ativo: true }, select: { celular: true, telefone: true }, take: 2 })).length === 1
      ? (await prisma.empresa.findFirst({ where: { ativo: true }, select: { celular: true, telefone: true } }))
      : null;
  return empresa?.celular ?? empresa?.telefone ?? null;
}

export default async function CalculadoraPage() {
  const whatsapp = await whatsappDaEmpresa().catch(() => null);
  return (
    <div className="min-h-screen bg-cena-fundo text-cena-texto">
      <header className="border-b border-cena-borda">
        <div className="max-w-6xl mx-auto px-5 py-5 flex items-center gap-3">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-cena-frio/15 ring-1 ring-cena-frio/40 text-cena-frio">
            <Snowflake className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <h1 className="text-xl font-bold leading-tight">Calculadora de BTU</h1>
            <p className="text-sm text-cena-apoio">Monte seu projeto e receba o orçamento ideal — grátis.</p>
          </div>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-5 py-7">
        <CalculadoraWizard whatsapp={whatsapp} />
        <p className="mt-6 text-center text-xs text-cena-apoio/80">
          Valores de referência. O orçamento definitivo sai após a visita técnica.
        </p>
      </main>
    </div>
  );
}
