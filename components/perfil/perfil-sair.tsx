"use client";

import { signOut } from "next-auth/react";
import { LogOut } from "lucide-react";

export function PerfilSair() {
  return (
    <button
      onClick={() => signOut({ callbackUrl: "/login" })}
      className="inline-flex items-center gap-2 text-sm font-medium text-red-600 hover:text-white hover:bg-red-500 border border-red-200 hover:border-red-500 rounded-lg px-4 py-2.5 transition-colors"
    >
      <LogOut className="w-4 h-4" /> Sair da conta
    </button>
  );
}
