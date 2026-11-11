import type { Metadata } from "next";
import { PaginaInstitucional } from "@/components/publico/pagina-institucional";

export const metadata: Metadata = {
  title: "Termos de Uso",
  description:
    "Termos de Uso e Contrato de Assinatura do Frivo: condições de uso, assinatura e responsabilidades.",
  robots: { index: true, follow: true },
};

export default function TermosPage() {
  return (
    <PaginaInstitucional titulo="Termos de Uso" atualizacao="[data]">
      {/* CONTEÚDO OFICIAL (Termos de Uso / Contrato de Assinatura) — a inserir exatamente como fornecido. */}
      <p>
        [Texto dos Termos de Uso / Contrato de Assinatura a ser inserido — aguardando o conteúdo oficial.]
      </p>
    </PaginaInstitucional>
  );
}
