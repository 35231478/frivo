import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { gerarQrDataUrl } from "@/lib/portal-server";
import { ImprimirClient } from "./imprimir-client";

export const metadata: Metadata = { title: "Imprimir QR Codes" };

export default async function ImprimirQrPage({ searchParams }: { searchParams: Promise<{ ids?: string }> }) {
  const sp = await searchParams;
  const session = await auth();
  const empresaId = session!.user!.empresaId;

  const ids = (sp.ids ?? "").split(",").map((s) => s.trim()).filter(Boolean);

  if (ids.length === 0) {
    return (
      <div className="max-w-xl mx-auto text-center py-16">
        <p className="text-ink-muted">Nenhum QR Code selecionado para impressão.</p>
        <Link href="/qrcodes" className="text-primary-600 hover:underline text-sm mt-2 inline-block">← Voltar</Link>
      </div>
    );
  }

  const [empresa, qrcodes] = await Promise.all([
    prisma.empresa.findUnique({ where: { id: empresaId }, select: { nome: true, nomeFantasia: true, telefone: true, celular: true, email: true, site: true, logo: true } }),
    prisma.qrcode.findMany({
      where: { id: { in: ids }, empresaId },
      include: { equipamento: { select: { marca: true, modelo: true, localizacao: true, unidade: { select: { nome: true } } } } },
    }),
  ]);

  const base = process.env.NEXTAUTH_URL || "";
  const etiquetas = await Promise.all(
    qrcodes.map(async (q) => ({
      id: q.id,
      codigo: q.codigo,
      imagem: await gerarQrDataUrl(`${base}/qr/${q.tokenPublico}`),
      equipamento: q.equipamento ? `${q.equipamento.marca} ${q.equipamento.modelo}` : null,
      local: q.equipamento?.unidade?.nome ?? q.equipamento?.localizacao ?? null,
    })),
  );

  const empresaInfo = {
    nome: empresa?.nomeFantasia ?? empresa?.nome ?? "",
    telefone: empresa?.telefone ?? empresa?.celular ?? "",
    email: empresa?.email ?? "",
    site: empresa?.site ?? "",
    logo: empresa?.logo ?? null,
  };

  return <ImprimirClient etiquetas={etiquetas} empresa={empresaInfo} />;
}
