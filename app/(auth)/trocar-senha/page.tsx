import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { FrivoLogo } from "@/components/layout/frivo-logo";
import { TrocarSenhaObrigatoriaForm } from "@/components/auth/trocar-senha-obrigatoria-form";
import { trocaPendente } from "@/lib/acesso/troca-obrigatoria";
import { ROTA_TECNICO, emModoTecnico } from "@/lib/tecnico/modo";

export const metadata: Metadata = { title: "Trocar senha" };

/**
 * Troca de senha no 1º acesso (lib/acesso/troca-obrigatoria): o middleware traz para cá quem entrou
 * com uma senha definida por outra pessoa. Sem troca pendente, esta tela não tem o que fazer: volta
 * ao trabalho (o app do técnico ou o painel).
 */
export default async function TrocarSenhaPage() {
  const session = await auth();
  if (!session) redirect("/login");
  const destino = emModoTecnico(session.user) ? ROTA_TECNICO : "/dashboard";
  if (!trocaPendente(session.user)) redirect(destino);
  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-surface-page">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-8"><FrivoLogo size="lg" variant="dark" /></div>
        <div className="bg-white rounded-card shadow-card p-6 sm:p-8 border border-surface-border">
          <TrocarSenhaObrigatoriaForm nome={session.user.name ?? ""} email={session.user.email ?? ""} destino={destino} />
        </div>
      </div>
    </div>
  );
}
