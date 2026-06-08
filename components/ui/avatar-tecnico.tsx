import { cn, iniciais, corAvatar } from "@/lib/utils";

interface AvatarTecnicoProps {
  nome: string | null | undefined;
  fotoUrl?: string | null;
  /** Diâmetro em pixels (padrão 24) */
  size?: number;
  className?: string;
  title?: string;
}

/**
 * Avatar circular do técnico: mostra a foto quando houver, senão as iniciais
 * sobre um fundo colorido derivado do nome (sempre a mesma cor para o mesmo técnico).
 */
export function AvatarTecnico({ nome, fotoUrl, size = 24, className, title }: AvatarTecnicoProps) {
  const dim = { width: size, height: size };
  const fonte = Math.max(9, Math.round(size * 0.42));

  if (fotoUrl) {
    return (
      <img
        src={fotoUrl}
        alt={nome ?? "Técnico"}
        title={title ?? nome ?? undefined}
        style={dim}
        className={cn("rounded-full object-cover border border-white shadow-sm shrink-0", className)}
      />
    );
  }

  return (
    <span
      title={title ?? nome ?? undefined}
      style={{ ...dim, fontSize: fonte }}
      className={cn(
        "rounded-full flex items-center justify-center font-semibold text-white border border-white shadow-sm shrink-0 select-none",
        corAvatar(nome),
        className,
      )}
    >
      {iniciais(nome)}
    </span>
  );
}
