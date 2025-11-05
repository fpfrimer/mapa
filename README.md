# Mapa de Horários Acadêmicos

Aplicação front-end simples para construir cronogramas semanais de cursos.

## Como usar

1. Abra o arquivo `index.html` em um navegador moderno (Chrome, Edge, Firefox).
2. Utilize o menu de ícones para abrir o painel de cadastros de períodos, professores, salas, disciplinas ou configurações. Cada painel permite adicionar, buscar, editar e remover itens conforme necessário.
3. Ao cadastrar disciplinas é possível informar um código opcional, que é validado para evitar duplicidade.
4. Selecione a visão desejada (por período, professor ou sala) e escolha o item para visualizar.
5. Clique em um bloco do cronograma para atribuir/editar uma disciplina.
6. O painel de edição sugere professores e salas livres naquele horário, evitando conflitos entre os mapas.
7. Utilize a seção **Configurações** para salvar os dados no navegador, exportar um arquivo JSON, importar configurações já existentes ou limpar tudo e começar novamente.

As informações são preservadas automaticamente no armazenamento local do navegador e podem ser exportadas/importadas pela própria interface.

### Persistência de dados

Esta aplicação é totalmente estática e não possui backend. Por isso, os dados permanecem apenas no navegador do usuário (via `localStorage`) ou em arquivos JSON exportados manualmente. Para salvar no servidor é necessário implementar uma API separada que receba e armazene os dados enviados pela interface.
