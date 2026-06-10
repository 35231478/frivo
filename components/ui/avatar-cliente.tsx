import { cn, iniciais, corAvatar } from "@/lib/utils";

interface AvatarClienteProps {
  nome: string | null | undefined;
  logoUrl?: string | null;
  /** Diâmetro em pixels (padrão 28) */
  size?: number;
  className?: string;
  title?: string;
}

/**
 * Avatar circular do cliente: mostra a logo quando houver, senão as iniciais
 * sobre um fundo colorido derivado do nome (sempre a mesma cor para o mesmo cliente).
 */
export function AvatarCliente({ nome, logoUrl, size = 28, className, title }: AvatarClienteProps) {
  const dim = { width: size, height: size };
  const fonte = Math.max(9, Math.round(size * 0.42));

  if (logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logoUrl}
        alt={nome ?? "Cliente"}
        title={title ?? nome ?? undefined}
        loading="lazy"
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
