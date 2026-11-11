# Tema 6 — Datas e horas no padrão brasileiro

**Sem mudança de banco.**

## Levantamento: o que já existia
A varredura não encontrou **nenhum** campo nativo de data nas telas (`app/` e `components/`):

| Campo nativo | Onde sobrava | Situação |
|---|---|---|
| `type="date"` | — | **Nenhum.** Os campos de data já usam `InputData` (48 usos): dd/mm/aaaa digitável, com calendário. |
| `type="datetime-local"` | — | **Nenhum.** "Agendar para" e os outros campos de data com hora já usam `InputDataHora` (5 usos): dd/mm/aaaa hh:mm, sempre no relógio de Brasília. |
| `type="month"` / `type="week"` | — | Nenhum. |
| `type="time"` | **3 campos** | Era o que restava (abaixo). |

Ou seja, os ~43 campos de data e o "Agendar para" **já tinham sido convertidos** em entregas
anteriores. O único `type="date"` que existe no código é o calendário escondido dentro do próprio
`InputData` (abre o seletor do aparelho; o texto que a pessoa vê é dd/mm/aaaa).

## O que mudou
Os três campos de **hora** que ainda usavam o relógio do navegador (que num navegador em inglês
mostra 12 h com AM/PM) passam a usar o novo `InputHora` — hh:mm de 24 horas, digitável:

- Colaborador › Dados profissionais › Jornada de trabalho: **Horário de entrada** e **Horário de saída**;
- Calendário › Nova OS (criação rápida): **Hora de agendamento**.

`components/ui/input-hora.tsx`:
- teclado numérico no celular; os dois-pontos entram sozinhos ("1730" → 17:30);
- ao sair do campo completa o que der ("9" → 09:00, "930" → 09:30);
- hora que não existe ("25:00") fica em vermelho e não é gravada — nem deixa valendo a hora anterior;
- entrega o mesmo valor que o campo nativo entregava ("HH:mm" ou vazio): nada muda no que é salvo.

## Trava
Um teste percorre `app/` e `components/` e falha se alguém voltar a usar
`type="date" | "datetime-local" | "month" | "week" | "time"` (fora do calendário escondido do `InputData`).

## O que ficou de fora (anotado)
- **Exibição** de datas (textos, tabelas, relatórios) não fez parte desta varredura: o pedido era
  sobre os campos nativos. Não encontrei exibição em formato americano, mas não fiz uma auditoria
  linha a linha de todo `toLocale…` do sistema.
- No calendário, a criação rápida já usava 08:00 quando a hora fica vazia. Isso continua: se a
  pessoa deixar uma hora inválida (em vermelho) e salvar, a OS é agendada às 08:00. Se preferir
  **impedir o salvar** enquanto a hora estiver em vermelho, é uma mudança pequena — fica a pergunta.
- O `InputHora` não tem um seletor de relógio (só digitação). Se fizer falta no celular, é um
  complemento pequeno.

## Testes
`tema6-datas-hora` (14): completar a hora, o campo (máscara, 24 h, hora inválida, apagar, valor vindo
de fora), a jornada do colaborador indo para o servidor como HH:mm, e a trava dos campos nativos.

## Prints
`docs/prints/tema6-datas/` — desktop e celular: jornada do colaborador e criação rápida no calendário.
