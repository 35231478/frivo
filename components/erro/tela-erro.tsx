import Link from "next/link";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { FrivoLogo } from "@/components/layout/frivo-logo";
import { cn } from "@/lib/utils";

/**
 * A tela de "não encontrado" e de "erro inesperado" do Frivo — uma só, para as duas caberem no
 * mesmo visual de /sem-permissao: ícone, título, uma linha e as saídas.
 *
 * - `cheia`: fora do painel (sem menu) — ocupa a tela e mostra a marca;
 * - sem `cheia`: dentro do painel, no lugar do conteúdo da página (o menu continua ali).
 *
 * Não mostra mensagem técnica: o código do erro, quando existe, vai para o ⓘ (quem fala com o
 * suporte informa o código; o resto da tela fica em português de gente).
 */
export function TelaErro({ icone: Icone, titulo, texto, dica, cheia, children, ...dados }: {
  icone: LucideIcon;
  titulo: string;
  texto: string;
  /** O ⓘ ao lado da linha (ex.: o código do erro) */
  dica?: ReactNode;
  cheia?: boolean;
  /** As saídas (BotaoErro / LinkErro) */
  children: ReactNode;
  [dado: `data-${string}`]: string | boolean | undefined;
}) {
  return (
    <div
      {...dados}
      className={cn(
        "flex flex-col items-center justify-center text-center px-4 sm:px-6",
        cheia ? "min-h-[100dvh] bg-surface-page py-10" : "min-h-[70vh] py-8",
      )}
    >
      {cheia && <div className="mb-10"><FrivoLogo size="md" variant="dark" /></div>}
      <div className="w-16 h-16 rounded-card bg-surface-alt border border-surface-border flex items-center justify-center mb-5">
        <Icone className="w-7 h-7 text-ink-muted" aria-hidden />
      </div>
      <h1 className="text-2xl font-bold text-ink" data-titulo-erro>{titulo}</h1>
      <p className="text-sm text-ink-muted mt-2 max-w-md inline-flex items-center justify-center gap-1.5" data-texto-erro>
        <span>{texto}</span>
        {dica}
      </p>
      <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-center gap-2 mt-6 w-full max-w-xs sm:max-w-none sm:w-auto">
        {children}
      </div>
    </div>
  );
}

const ESTILO = {
  primario: "bg-acento text-white hover:bg-acento-hover",
  secundario: "bg-white text-ink border border-surface-border hover:bg-surface-page",
};
const BASE = "inline-flex items-center justify-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold transition-colors touch-target focus:outline-none focus-visible:ring-2 focus-visible:ring-acento focus-visible:ring-offset-2";

/** Saída por link (ir para o painel / o início). `<a>` comum quando a página pode estar quebrada. */
export function LinkErro({ href, children, secundario, simples, ...dados }: {
  href: string; children: ReactNode; secundario?: boolean;
  /** `<a>` em vez do Link do Next: recarrega a página inteira (o erro pode estar no próprio app) */
  simples?: boolean;
  [dado: `data-${string}`]: string | boolean | undefined;
}) {
  const classe = cn(BASE, secundario ? ESTILO.secundario : ESTILO.primario);
  return simples
    ? <a href={href} className={classe} {...dados}>{children}</a>
    : <Link href={href} className={classe} {...dados}>{children}</Link>;
}

/** Saída por botão (tentar de novo / voltar). */
export function BotaoErro({ onClick, children, secundario, ...dados }: {
  onClick: () => void; children: ReactNode; secundario?: boolean;
  [dado: `data-${string}`]: string | boolean | undefined;
}) {
  return (
    <button type="button" onClick={onClick} className={cn(BASE, secundario ? ESTILO.secundario : ESTILO.primario)} {...dados}>
      {children}
    </button>
  );
}
