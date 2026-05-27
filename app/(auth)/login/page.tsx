import type { Metadata } from "next";
import { LoginForm } from "@/components/auth/login-form";
import { Snowflake } from "lucide-react";

export const metadata: Metadata = { title: "Entrar" };

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-frivo-900 to-frivo-700 p-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center gap-3 mb-8">
          <div className="bg-white/10 rounded-2xl p-3">
            <Snowflake className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Frivo</h1>
          <p className="text-frivo-200 text-sm text-center">
            Gestão para climatização e refrigeração
          </p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-8">
          <h2 className="text-xl font-semibold text-gray-800 mb-6">Entrar na sua conta</h2>
          <LoginForm />
        </div>
      </div>
    </div>
  );
}
