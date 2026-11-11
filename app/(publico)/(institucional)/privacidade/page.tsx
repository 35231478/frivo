import type { Metadata } from "next";
import { PaginaInstitucional } from "@/components/publico/pagina-institucional";

export const metadata: Metadata = {
  title: "Política de Privacidade",
  description:
    "Como o Frivo coleta, usa, armazena e protege os dados pessoais, conforme a LGPD.",
  robots: { index: true, follow: true },
};

export default function PrivacidadePage() {
  return (
    <PaginaInstitucional titulo="Política de Privacidade" atualizacao="[data]">
      {/* CONTEÚDO OFICIAL (Privacidade) — a inserir exatamente como fornecido. */}
      <p>
        [Texto da Política de Privacidade a ser inserido — aguardando o conteúdo oficial.]
      </p>
    </PaginaInstitucional>
  );
}
