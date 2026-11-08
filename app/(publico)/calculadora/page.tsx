import type { Metadata } from "next";
import { Snowflake } from "lucide-react";
import { CalculadoraBtu } from "@/components/publico/calculadora-btu";

export const metadata: Metadata = {
  title: "Calculadora de BTU",
  description: "Capacidade ideal do ar-condicionado e orçamento sem compromisso.",
};

// Página pública (sem login): calcula o BTU e envia o lead para o Frivo.
export const dynamic = "force-dynamic";

export default function CalculadoraPage() {
  return (
    <div className="min-h-screen bg-surface-page">
      <header className="bg-white border-b border-surface-border">
        <div className="max-w-3xl mx-auto px-5 py-4 flex items-center gap-2">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-primary-500/10 text-primary-600">
            <Snowflake className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <h1 className="text-lg font-bold text-ink leading-tight">Calculadora de BTU</h1>
            <p className="text-xs text-ink-muted">Capacidade ideal do ar-condicionado + orçamento sem compromisso.</p>
          </div>
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-5 py-6">
        <div className="bg-white rounded-card border border-surface-border shadow-card p-5 md:p-7">
          <CalculadoraBtu />
        </div>
        <p className="mt-4 text-center text-xs text-ink-subtle">
          Ao enviar, seus dados vão direto para a nossa equipe, que retorna com o orçamento.
        </p>
      </main>
    </div>
  );
}
