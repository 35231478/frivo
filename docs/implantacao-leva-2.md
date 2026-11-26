# Implantação, leva 2: equipamentos

Para a Termofrio subir o parque de equipamentos de cada cliente por planilha, inclusive a exportada de
outro sistema, ligada ao cliente pelo CNPJ/CPF e à unidade pelo nome.

## Levantamento: o que existia × o que mudou

| Peça | Antes | Agora |
|---|---|---|
| Importar equipamentos | Não existia: só pela tela, um a um, ou pela foto da etiqueta | Planilha própria, no mesmo motor das outras (prévia, erros linha a linha, ligar colunas, baixar → editar → subir) |
| Onde | — | "Importar planilha" na **lista de Equipamentos** e **4. Equipamentos** na família de Clientes |
| Nº de série repetido | Permitido; a tela só avisa | Série que já está em 2 ou mais equipamentos **não serve de chave** (erro: "use o id_sistema") |
| Sem série nem TAG | — | Entra **com aviso** e lista os **possíveis duplicados** |
| Motor | Linha ok ou com erro | + **avisos** por linha e entre linhas (não barram), contados no resumo, com filtro "Com aviso" e planilha de avisos |
| Módulo Equipamentos desligado | — | A planilha some da tela e a rota responde 403 (importar, modelo e baixar) |

Nenhum arquivo de Clientes, Orçamentos ou sino foi tocado. A lista de equipamentos ganhou só o botão.
**Sem banco novo**: usa `equipamentos`, `unidades` e `tipos_equipamento_custom`, que já existem.

## Como funciona

- **Colunas:**
  - `cnpj_cpf` (obrigatória), `unidade`, `tipo`, `marca` e `modelo` (obrigatórias);
  - `capacidade`, `fluido` (gás), `tensao`, `ambiente`, `setor`;
  - `numero_serie`, `patrimonio` (TAG/etiqueta), `nome`, `observacoes` e `id_sistema`.
- **Unidade:** pelo nome no cliente, sem acento e sem maiúsculas.
  - Vazia = **a unidade principal** do cliente.
  - Unidade que não existe = erro ("importe a planilha de unidades antes"). A planilha de equipamentos não cria unidade.
- **Tipo:** aceita o rótulo do Frivo, o valor ou apelidos ("split", "hi-wall", "cassete", "piso teto", "VRV", "self"…).
  - Aceita também os **tipos personalizados ativos** da empresa.
  - Vazio = **Outro**, com aviso (só ao criar).
  - O tipo do sistema que ainda não tem personalizado ganha o personalizado **uma vez só**, mesmo com várias linhas: os tipos são resolvidos antes de gravar.
- **Capacidade:** no formato do cadastro.
  - "12000", "12.000 btu" e "18000 BTUs" viram "12.000 BTU/h" (e 18.000);
  - "5 TR" e "7,5 tr" viram "5 TR" e "7,5 TR";
  - só o número, de 1.000 para cima, é BTU/h; abaixo de 1.000 sem unidade = erro, porque não dá para saber se é BTU ou TR.
- **Gás e tensão:**
  - "r-410a" e "410A" viram "R410A"; "R134A" vira "R134a";
  - "220" e "220 v" viram "220V";
  - o que não é conhecido fica como veio ("220/380", "MO99").
- **Marca, modelo, ambiente e setor:** como vieram, só aparados. O padronizador de nomes transformaria "LG" em "Lg".

### Chave para não duplicar: id_sistema → nº de série → patrimônio/TAG

- Série e TAG são comparadas **sem espaços, hífens, pontos, barras e maiúsculas**: "LGX-0001" = "lgx 0001".
- **Série ou TAG que já está em mais de um equipamento** da empresa não casa sozinha: a linha dá erro e pede o `id_sistema`. Com o `id_sistema` na linha, é ele que decide.
- **Equipamento de outro cliente** (pela série, TAG ou id) = erro: um equipamento não muda de cliente pela planilha. Mudar de **unidade dentro do mesmo cliente** pode.
- A mesma série numa **outra empresa** nunca casa.
- Uma linha cujo id aponta para um equipamento e a série para outro = erro (não adivinha).

### Sem nenhuma chave: aceita com aviso

- Aviso: "Sem nº de série nem patrimônio/TAG: reimportar esta linha cria outro equipamento."
- **Possível duplicado já cadastrado:**
  - mesmo cliente, unidade, marca, modelo e capacidade (sem acento e sem maiúsculas);
  - lista até 3, em ordem alfabética, com ambiente e série.
- **Possível duplicado na própria planilha:** "Igual à linha N…". Dois splits iguais na mesma sala existem, por isso é aviso e não erro.
- Na prévia: filtro "Com aviso (N)" e "N linha(s) entram com aviso para revisar".
- No resultado: a lista das gravadas com aviso e **"Baixar avisos (para revisar)"**, uma planilha com as colunas, a linha e o aviso.

### Ida e volta

"Baixar equipamentos já cadastrados", editar e subir de novo **atualiza todos pelo `id_sistema`**, inclusive os sem série e os de série repetida. Equipamento na unidade principal sai com a unidade vazia, e assim volta para a principal.

## Decisões

1. **Chave:** id_sistema → nº de série → patrimônio/TAG, nessa ordem (definido pelo Zé).
2. **Sem chave:** entra com aviso e lista os possíveis duplicados (cliente, unidade, marca, modelo e capacidade), sem bloquear (definido pelo Zé).
3. **Unidade vazia = principal**; unidade que não existe = erro, nunca cria unidade. As unidades têm planilha própria (leva 1).
4. **Série repetida no cadastro não é chave.** Atualizar "a primeira" seria adivinhar.
5. **Comparar sem hífen, ponto e barra:** "LGX-0001" e "LGX0001" são a mesma etiqueta escrita de jeitos diferentes. Grava como veio.
6. **Capacidade sem unidade abaixo de 1.000 = erro**, em vez de chutar TR ou BTU.
7. **Permissão:**
   - importar = Equipamentos › criar;
   - atualizar os que já existem = Equipamentos › editar;
   - baixar = Equipamentos › visualizar;
   - o módulo Equipamentos desligado barra tudo, como as outras rotas do módulo.
8. **QR Code não é gerado na importação.** As etiquetas saem em lote na tela de QR Codes, que já existe.
9. **Datas** (instalação, garantia) ficaram de fora desta leva: não estavam no pedido e pedem leitura de data da planilha. Podem entrar numa próxima.

## Testes

- **Puros + tela** (`implantacao-2.test.ts`, 10):
  - capacidade, gás, tensão e normalização da série;
  - unidade, chaves, série repetida e série de outro cliente;
  - avisos e possíveis duplicados, iguais entre linhas e o resumo;
  - na tela: avisos, filtro, resultado e download dos avisos; família por módulo e permissão.
- **PostgreSQL real** (`implantacao-2-pg.test.ts`, 8):
  - cria na unidade certa com tudo normalizado, e um tipo personalizado só, mesmo com 2 linhas;
  - chaves (série com espaço/hífen, TAG, id; mudar de unidade);
  - série repetida, série de outro cliente, id de outra empresa;
  - sem chave: aviso, possíveis duplicados e a planilha de avisos; reimportar;
  - ida e volta; permissão; módulo desligado;
  - planilha de outro sistema com colunas ligadas;
  - a gravação conferindo a unidade no cliente e na empresa.
