import Link from "next/link";
import { ArrowLeft } from "lucide-react";

/**
 * Casca mínima para o técnico puro nas poucas telas do sistema que ele usa fora do app (checklist do
 * veículo, "sem permissão"): sem o menu do sistema, só a volta para "Meu dia".
 */
export function CascaTecnico({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-surface-page">
      <header className="sticky top-0 z-30 bg-sidebar text-white safe-top">
        <div className="flex items-center gap-2 px-3 h-14">
          <Link href="/tecnico" className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold hover:bg-white/10 touch-target">
            <ArrowLeft className="w-5 h-5" /> Meu dia
          </Link>
        </div>
      </header>
      <main className="p-4 pb-24">{children}</main>
    </div>
  );
}
