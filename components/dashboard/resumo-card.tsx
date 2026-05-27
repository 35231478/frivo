import Link from "next/link";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

interface ResumoCardProps {
  titulo: string;
  valor: number;
  icone: LucideIcon;
  corIcone: string;
  corFundo: string;
  href: string;
  descricao?: string;
}

export function ResumoCard({ titulo, valor, icone: Icone, corIcone, corFundo, href, descricao }: ResumoCardProps) {
  return (
    <Link
      href={href}
      className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-md hover:border-frivo-200 transition-all group"
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-gray-500">{titulo}</p>
          <p className="text-3xl font-bold text-gray-900 mt-1">{valor.toLocaleString("pt-BR")}</p>
          {descricao && <p className="text-xs text-gray-400 mt-1">{descricao}</p>}
        </div>
        <div className={cn("p-2.5 rounded-lg", corFundo)}>
          <Icone className={cn("w-5 h-5", corIcone)} />
        </div>
      </div>
    </Link>
  );
}
