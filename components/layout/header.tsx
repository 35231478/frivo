"use client";

import { signOut } from "next-auth/react";
import { LogOut } from "lucide-react";
import type { Session } from "next-auth";

interface HeaderProps {
  session: Session;
}

export function Header({ session }: HeaderProps) {
  const usuario = session.user;
  const iniciais =
    usuario.name
      ?.split(" ")
      .map((n) => n[0])
      .slice(0, 2)
      .join("") ?? "??";

  return (
    <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between shrink-0">
      <div className="text-sm text-gray-500">{usuario.empresaNome}</div>

      <div className="flex items-center gap-3">
        <div className="text-right hidden sm:block">
          <p className="text-sm font-medium text-gray-900">{usuario.name}</p>
          <p className="text-xs text-gray-400">{usuario.email}</p>
        </div>
        <div className="w-8 h-8 rounded-full bg-frivo-600 flex items-center justify-center text-white text-xs font-bold">
          {iniciais}
        </div>
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="text-gray-400 hover:text-gray-600 transition-colors p-1 rounded"
          title="Sair"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
}
