import { Building2, DollarSign, MapPin, Receipt, Users, Wallet } from "lucide-react";
import { FormSection } from "@/components/ui/form-field";
import {
  emOrdem, enderecoEmUmaLinha, meiosDoContato, secoesDaFicha,
  type ClienteDaFicha, type ContatoDaFicha, type EnderecoDaFicha,
} from "@/lib/clientes/ficha";

const ICONE: Record<string, React.ReactNode> = {
  identificacao: <Building2 className="w-3.5 h-3.5" />,
  fiscal: <Receipt className="w-3.5 h-3.5" />,
  comercial: <DollarSign className="w-3.5 h-3.5" />,
  cobranca: <Wallet className="w-3.5 h-3.5" />,
};

/**
 * "Dados gerais" da ficha em CONSULTA: o cadastro como texto, nas mesmas seções da edição, só com o que
 * está preenchido. Endereços e contatos em lista. Mudar qualquer coisa é pelo "Editar" do cabeçalho.
 */
export function FichaCliente({ cliente }: {
  cliente: ClienteDaFicha & { unidades?: EnderecoDaFicha[]; contatosCliente?: ContatoDaFicha[] };
}) {
  const secoes = secoesDaFicha(cliente);
  const enderecos = emOrdem(cliente.unidades ?? []);
  const contatos = emOrdem(cliente.contatosCliente ?? []);
  const [identificacao, ...resto] = secoes;

  return (
    <>
      <Secao id={identificacao.id} titulo={identificacao.titulo} linhas={identificacao.linhas} />

      <FormSection title="Endereços" icon={<MapPin className="w-3.5 h-3.5" />}>
        {enderecos.length === 0 ? (
          <p className="text-sm text-ink-muted" data-ficha-vazio="enderecos">Nenhum endereço cadastrado.</p>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2" data-ficha-enderecos>
            {enderecos.map((u) => (
              <li key={u.id} className="rounded-lg border border-surface-border px-4 py-3" data-ficha-endereco={u.id}>
                <p className="text-sm font-semibold text-ink flex items-center gap-2">
                  {u.nome}
                  {u.principal && <span className="text-[10px] font-semibold uppercase tracking-wider text-acento bg-acento-claro rounded px-1.5 py-0.5">Principal</span>}
                </p>
                {enderecoEmUmaLinha(u) && <p className="text-sm text-ink-muted mt-0.5">{enderecoEmUmaLinha(u)}</p>}
              </li>
            ))}
          </ul>
        )}
      </FormSection>

      <FormSection title="Contatos" icon={<Users className="w-3.5 h-3.5" />}>
        {contatos.length === 0 ? (
          <p className="text-sm text-ink-muted" data-ficha-vazio="contatos">Nenhum contato cadastrado.</p>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2" data-ficha-contatos>
            {contatos.map((c) => (
              <li key={c.id} className="rounded-lg border border-surface-border px-4 py-3" data-ficha-contato={c.id}>
                <p className="text-sm font-semibold text-ink flex items-center gap-2 flex-wrap">
                  {c.nome}
                  {c.cargo && <span className="text-xs font-normal text-ink-muted">{c.cargo}</span>}
                  {c.principal && <span className="text-[10px] font-semibold uppercase tracking-wider text-acento bg-acento-claro rounded px-1.5 py-0.5">Principal</span>}
                </p>
                {meiosDoContato(c).length > 0 && <p className="text-sm text-ink-muted mt-0.5 break-words">{meiosDoContato(c).join(" · ")}</p>}
              </li>
            ))}
          </ul>
        )}
      </FormSection>

      {resto.map((s) => <Secao key={s.id} id={s.id} titulo={s.titulo} linhas={s.linhas} />)}
    </>
  );
}

function Secao({ id, titulo, linhas }: { id: string; titulo: string; linhas: { rotulo: string; valor: string }[] }) {
  return (
    <FormSection title={titulo} icon={ICONE[id]}>
      <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2" data-ficha-secao={id}>
        {linhas.map((l) => (
          <div key={l.rotulo} className="min-w-0">
            <dt className="text-xs text-ink-muted">{l.rotulo}</dt>
            <dd className="text-sm text-ink break-words">{l.valor}</dd>
          </div>
        ))}
      </dl>
    </FormSection>
  );
}
