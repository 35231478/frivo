import type { Metadata } from "next";
import { PaginaInstitucional } from "@/components/publico/pagina-institucional";
import { FaqLista, type FaqItem } from "@/components/publico/faq-lista";

export const metadata: Metadata = {
  title: "Perguntas frequentes",
  description:
    "Perguntas frequentes sobre o Frivo: assinatura, uso, suporte e dados.",
  robots: { index: true, follow: true },
};

// CONTEÚDO OFICIAL (FAQ) — a inserir exatamente como fornecido. Placeholder abaixo.
const itens: FaqItem[] = [
  {
    pergunta: "[Pergunta a inserir]",
    resposta: <p>[Resposta a inserir — aguardando o conteúdo oficial.]</p>,
  },
];

export default function FaqPage() {
  return (
    <PaginaInstitucional titulo="Perguntas frequentes" atualizacao="[data]">
      <FaqLista itens={itens} />
    </PaginaInstitucional>
  );
}
