import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { CTA, LINK_TESTE_GRATIS } from "./conteudo";

/**
 * O CTA primário da home de vendas: um só, repetido, sempre para o mesmo destino (LINK_TESTE_GRATIS).
 * `local` identifica a posição na página (data-cta-local) para medir qual botão converte.
 */
export function BotaoTeste({
  local, rotulo = CTA.principal, tamanho = "grande", inverso, className,
}: { local: string; rotulo?: string; tamanho?: "medio" | "grande"; inverso?: boolean; className?: string }) {
  return (
    <Link
      href={LINK_TESTE_GRATIS}
      data-cta="teste-gratis"
      data-cta-local={local}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
        tamanho === "grande" ? "min-h-[52px] px-6 text-base" : "min-h-[44px] px-4 text-sm",
        inverso
          ? "bg-white text-acento hover:bg-acento-claro focus-visible:ring-white focus-visible:ring-offset-primary-800"
          : "bg-acento text-white hover:bg-acento-hover focus-visible:ring-acento",
        className,
      )}
    >
      {rotulo}
      {tamanho === "grande" && <ArrowRight className="h-4 w-4" aria-hidden />}
    </Link>
  );
}
