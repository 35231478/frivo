import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { prisma } from "@/lib/prisma";
import { getPortalSession, type PortalSession } from "@/lib/auth-portal";

/** Garante uma sessão de portal; redireciona para o login se ausente. */
export async function requirePortalSession(): Promise<PortalSession> {
  const sessao = await getPortalSession();
  if (!sessao?.user) redirect("/portal/login");
  return sessao;
}

/** Bloqueia acesso a uma página quando a permissão não foi concedida. */
export function exigePermissao(sessao: PortalSession, chave: string): boolean {
  return !!sessao.user.permissoes?.[chave];
}

export async function getPortalBranding(empresaId: string) {
  const [empresa, config] = await Promise.all([
    prisma.empresa.findUnique({ where: { id: empresaId }, select: { nome: true, nomeFantasia: true, logo: true } }),
    prisma.configuracao.findUnique({ where: { empresaId }, select: { portalCorPrimaria: true, portalLogo: true, portalBoasVindas: true } }),
  ]);
  return {
    empresaNome: empresa?.nomeFantasia ?? empresa?.nome ?? "Frivo",
    logo: config?.portalLogo || empresa?.logo || null,
    cor: config?.portalCorPrimaria || "#0EA5E9",
    boasVindas: config?.portalBoasVindas || null,
  };
}

/** Gera um QR Code como data URL (PNG) para um texto/URL. */
export async function gerarQrDataUrl(texto: string): Promise<string> {
  try {
    return await QRCode.toDataURL(texto, { width: 220, margin: 1, color: { dark: "#0F2744", light: "#FFFFFF" } });
  } catch {
    return "";
  }
}
