import { cn } from "@/lib/utils";
import { AvatarTecnico } from "@/components/ui/avatar-tecnico";

interface TecnicoStack {
  id: string;
  nome: string;
  avatar?: string | null;
}

interface AvatarStackProps {
  tecnicos: TecnicoStack[];
  /** Máximo de avatares visíveis (padrão 3) */
  max?: number;
  /** Diâmetro de cada avatar em pixels (padrão 28) */
  size?: number;
  className?: string;
}

/**
 * Pilha de avatares sobrepostos no estilo GitHub/Jira: mostra até `max` técnicos
 * com sobreposição de 8px e borda branca, e um badge "+X" quando há mais.
 * O tooltip lista o nome completo de todos os técnicos (inclusive os ocultos).
 */
export function AvatarStack({ tecnicos, max = 3, size = 28, className }: AvatarStackProps) {
  if (!tecnicos.length) {
    return <span className="text-ink-subtle">—</span>;
  }

  const visiveis = tecnicos.slice(0, max);
  const restante = tecnicos.length - visiveis.length;
  const fonte = Math.max(9, Math.round(size * 0.38));
  const tooltip = tecnicos.map((t) => t.nome).join("\n");

  return (
    <div className={cn("flex items-center", className)} title={tooltip}>
      {visiveis.map((t, i) => (
        <div
          key={t.id}
          className={cn("rounded-full ring-2 ring-white", i > 0 && "-ml-2")}
          style={{ zIndex: visiveis.length - i }}
        >
          <AvatarTecnico nome={t.nome} fotoUrl={t.avatar} size={size} />
        </div>
      ))}
      {restante > 0 && (
        <span
          style={{ width: size, height: size, fontSize: fonte, zIndex: 0 }}
          className="-ml-2 rounded-full flex items-center justify-center font-semibold bg-surface-alt text-ink-muted ring-2 ring-white shrink-0 select-none"
        >
          +{restante}
        </span>
      )}
    </div>
  );
}
