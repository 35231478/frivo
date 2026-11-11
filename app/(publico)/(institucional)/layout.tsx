import Link from "next/link";
import { FrivoLogo } from "@/components/layout/frivo-logo";
import { InstitucionalRodape } from "@/components/publico/institucional-rodape";

// Layout das páginas públicas institucionais (sem login): Privacidade, FAQ e Termos.
// Cabeçalho simples (logo + link pra home) e rodapé com as três páginas e contato.
export default function InstitucionalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-surface-page">
      <header className="sticky top-0 z-10 border-b border-surface-border bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-3">
          <Link
            href="/"
            aria-label="Frivo — início"
            className="inline-flex min-h-[44px] items-center rounded-lg"
          >
            <FrivoLogo size="md" variant="dark" showSubtitle />
          </Link>
          <Link
            href="/"
            className="inline-flex min-h-[44px] items-center px-2 text-sm font-medium text-ink-muted hover:text-acento"
          >
            Início
          </Link>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <InstitucionalRodape />
    </div>
  );
}
