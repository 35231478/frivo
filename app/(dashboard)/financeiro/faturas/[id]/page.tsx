import type { Metadata } from "next";

// A fatura avulsa ("Faturar") é uma medição: mesma tela, com o breadcrumb "Faturas"
export { default } from "../../medicoes/[id]/page";
export const metadata: Metadata = { title: "Fatura" };
