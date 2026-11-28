/** O ícone e a cor de cada pendência (lib/alertas/pendencias): o mesmo no painel e no sino. */
import { CalendarClock, FileSignature, HandCoins, MessageSquareReply, PackageMinus, Receipt, ShieldAlert, Timer, UserX, Wallet, type LucideIcon } from "lucide-react";
import type { IconePendencia, TomPendencia } from "@/lib/alertas/pendencias";

export const ICONE_PENDENCIA: Record<IconePendencia, LucideIcon> = {
  semTecnico: UserX, atrasada: Timer, esquecida: Timer, comentario: MessageSquareReply, pmoc: ShieldAlert,
  orcamento: CalendarClock, despesa: Receipt, pagar: Wallet, receber: HandCoins, estoque: PackageMinus, pedidoCliente: FileSignature,
};

/** A cor do ícone pelo tom (tokens da identidade) */
export const COR_TOM: Record<TomPendencia, string> = { atrasado: "text-atrasado", atencao: "text-atencao", acento: "text-acento" };
