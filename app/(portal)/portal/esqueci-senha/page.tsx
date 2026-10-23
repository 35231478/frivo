import type { Metadata } from "next";
import { FrivoLogo } from "@/components/layout/frivo-logo";
import { PortalEsqueciSenhaForm } from "@/components/portal/portal-esqueci-senha-form";

export const metadata: Metadata = { title: "Portal do Cliente — Esqueci minha senha" };
export const dynamic = "force-dynamic";

/** UX-5 (Y13): cliente travado fora do horário comercial pede uma nova senha sozinho. */
export default function PortalEsqueciSenhaPage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-sidebar via-sidebar to-primary-600">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-6">
          <FrivoLogo size="lg" />
          <p className="text-slate-200 text-sm mt-3">Portal do Cliente</p>
        </div>
        <div className="bg-white rounded-2xl shadow-elevated p-6 md:p-8">
          <PortalEsqueciSenhaForm />
        </div>
      </div>
    </div>
  );
}
