# Licenças preservadas

As restrições de [LICENSE.txt](LICENSE.txt) referem-se às novas contribuições
próprias a partir da versão `0.2.0-preview.2`. Elas não eliminam permissões
válidas sobre versões anteriores ou componentes de terceiros.

## Código anterior do Frota Estelar

O README e os manifests do projeto até o commit
`109eba56d1253a2e127ef2f3acdd96e9dc44c04d` declaravam a licença MIT. A ausência
de um arquivo LICENSE separado não é tratada aqui como autorização para
desconsiderar essas declarações. O código oriundo dessas versões e eventuais
direitos já concedidos permanecem sujeitos à licença aplicável à sua obtenção.
Os autores e contribuidores estão registrados no histórico Git do projeto.

Texto padrão da licença MIT, identificada nas versões anteriores:

> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all
> copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
> SOFTWARE.

## Fontes distribuídas na versão web

- Orbitron: The Orbitron Project Authors.
- Exo 2: The Exo 2 Project Authors.

As fontes usam a SIL Open Font License 1.1. Os avisos e textos completos estão
preservados em `client/fonts/LICENSES.txt`, publicado como `fonts/LICENSES.txt`
na versão web. A origem dos arquivos está em `client/fonts/SOURCES.txt`.

## Componentes utilizados pelo servidor e pelo executável

A versão estática para navegador não contém Node, Go ou o pacote `ws`.
Na distribuição Windows, o build inclui os textos originais das licenças de
Node, Go e `ws` dentro do pacote. A licença de cada dependência de desenvolvimento
permanece no respectivo pacote; dependências de desenvolvimento não são copiadas
para a demonstração web.
