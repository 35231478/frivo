# COM-2B — A comissão do técnico no app, ao vivo

A COM-2A fez o motor: a comissão do técnico por equipamento atendido, a trava de qualidade, a revisão do retorno e o
teto. A COM-2B leva isso ao **app de campo**. O técnico vê, na hora e também sem sinal, quanto o equipamento que acabou
de concluir vale para ele.

Prints antes e depois (iPhone, dados fictícios, banco local): `docs/prints/com-2b/`.

> 🟢 **Sem SQL.** Usa o banco da COM-2A (`2027-02-14_comissao_executor.sql`, já aplicado).
>
> **Depende da COM-2A** ([#289](https://github.com/35231478/frivo/pull/289)). Este branch saiu do da COM-2A: enquanto o
> #289 não entra, o diff aqui mostra os dois. Depois do merge do #289, sobra só o da COM-2B.

## O que o técnico vê

1. **Na tela do equipamento.** Quando o relatório do equipamento fica completo, aparece **"Sua comissão: R$ 15,00 ·
   Prevista (aguardando envio)"**, com uma animação discreta que respeita "menos movimento".
   - É a mesma trava do servidor (`lib/execucao/pendencias`): checklist, medições, as fotos e observações pedidas, o
     formulário obrigatório. Incompleto, não aparece nada.
2. **Na lista de equipamentos da OS:** o mesmo valor no equipamento feito e completo.
3. **No Meu dia**, o card **"Minhas comissões"**:
   - **Prevista · A receber · Paga** (o extrato da pessoa);
   - **"+ R$ X prevista (aguardando envio)"**: o que ele já garantiu no aparelho e ainda não subiu;
   - tocar abre o extrato no Perfil.
4. **O servidor confirma no envio.** Quando a fila sobe, o app baixa o retrato da atividade de novo. A rota refaz a
   conta daquela OS antes de responder, e o equipamento passa a **"Prevista"**.

## Sem sinal

- O valor de cada equipamento vem no **retrato da atividade**, que já fica guardado no aparelho. O app junta com o que
  está na fila (a mesma conta da tela) e mostra "aguardando envio" sem consultar o servidor.
- O card do Meu dia guarda o último extrato no aparelho. Sem sinal, mostra esse com "Atualizado às HH:MM", e soma o
  aguardando envio de todas as atividades guardadas.
- Com sinal, o extrato é buscado no máximo **a cada 5 minutos**. O Meu dia abre muitas vezes, e a conta do servidor
  não precisa rodar a cada uma.

## O que nunca vai para o aparelho

O retrato leva só `{ porEquipamento, confirmadas }`, com os valores **de quem está logado**:
- nenhuma regra, base, taxa, custo ou margem;
- nenhum valor de colega.

A conta (a unidade, a regra que vence para ele, a divisão) é a do servidor, a mesma da COM-2A.

**Como cada valor é calculado:**
- **Equipamento ainda não marcado, na divisão "Para quem executou":** conta como se fosse dele, porque é ele quem vai
  marcar.
- **Equipamento marcado por um colega:** zero para ele.
- **OS sem equipamento:** não mostra valor por equipamento. A comissão dela é da linha, na conclusão, e aparece no
  extrato.

## Nada no modo TV

O painel público do Desempenho (a TV) não lê comissão. Um teste trava a página, a tela e a função de dados.

## Mudanças em código compartilhado

- `lib/comissoes/executor-server.ts`: `comissaoParaRetrato` (nova).
- `app/api/tecnico/atividades/[atividadeId]/route.ts`:
  - o retrato ganha `comissao`;
  - antes, a rota refaz a conta da OS (`sincronizarExecutor` de uma OS);
  - falha nessa conta não derruba o retrato: o campo vem `null`.
- `lib/tecnico/offline/tipos.ts`: `RetratoAtividade.comissao` (opcional; retrato antigo segue valendo).
- `components/tecnico/execucao.tsx` e `equipamento.tsx`: o selo da comissão.
- `components/tecnico/meu-dia.tsx`: o card (`comissoes-do-dia.tsx`).
- `app/globals.css`: a animação `anim-comissao`, desligada com "menos movimento".

## Testes

| Arquivo | O que trava |
|---|---|
| `com2b` (8, regra + amarras) | só o feito E completo mostra (o incompleto e o não feito, mesmo com valor no retrato, não); confirmada = Prevista, senão aguardando envio; o total aguardando envio; nada no modo TV; a animação com "menos movimento"; o retrato só com o valor de quem está logado |
| `com2b-app-ui` (5, o app de verdade: IndexedDB, motor, fila) | sem sinal, concluir o equipamento mostra a comissão na hora, na tela do equipamento e na lista; o card do Meu dia com o extrato guardado e o aguardando envio, abrindo o Perfil; o extrato só de 5 em 5 minutos; confirmada pelo servidor = Prevista; empresa sem comissão de técnico: nada |
| `com2b-pg` (7, PostgreSQL real) | o valor por equipamento (linha ÷ vinculados da OS inteira, a divisão); para quem executou (não marcado = dele, marcado pela colega = zero); confirmadas; a rota leva só o dele; o que o app enviou volta confirmado no próximo retrato; null para empresa sem regra, quem não está na atividade e OS cancelada |

**Mutação: 24 mutantes, 24 mortos.** O único sobrevivente da 1ª rodada ("incompleto mostra comissão") virou prova: o
equipamento feito e incompleto passou a ter valor no retrato do teste, e só a trava o deixa de fora.
