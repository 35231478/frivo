import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ConfiguracoesClient } from "@/components/forms/configuracoes-client";
import { Settings } from "lucide-react";

export const metadata: Metadata = { title: "Configurações" };

export default async function ConfiguracoesPage() {
  const session = await auth();
  const empresaId = session!.user!.empresaId;

  const empresa = await prisma.empresa.findUnique({ where: { id: empresaId } });

  let config = await prisma.configuracao.findUnique({ where: { empresaId } });
  if (!config) {
    config = await prisma.configuracao.create({ data: { empresaId } });
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-primary-50 rounded-lg">
          <Settings className="w-5 h-5 text-primary-600" />
        </div>
        <h1 className="page-title">Configurações</h1>
      </div>
      <ConfiguracoesClient empresa={empresa!} config={config} />
    </div>
  );
}
