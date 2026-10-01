# Áudios gravados com a sua voz

Coloque aqui as gravações das meditações. Elas substituem a voz sintética do celular e deixam o app muito mais profissional.

## Como gravar

1. Abra o arquivo `conteudo.js` e escolha uma meditação (por exemplo, `respiracao`).
2. Leia os textos de `steps` em voz calma e pausada. O número antes de cada texto é o segundo em que ele aparece na tela; use-o como guia para as pausas.
3. A gravação deve ter **a mesma duração** da meditação (`minutes`). Deixe silêncio entre as frases; o som de fundo é tocado pelo próprio app.
4. Grave no celular (gravador de voz) ou no computador (Audacity, grátis), num lugar silencioso.
5. Exporte em **MP3**, 64 a 96 kbps, mono. Isso deixa os arquivos leves (cerca de 3 a 5 MB para 10 minutos).

## Como colocar no app

1. Salve o arquivo nesta pasta com o nome da meditação, por exemplo `audio/respiracao.mp3`.
2. Em `conteudo.js`, adicione a linha `audio` na meditação:

```js
{
  id: 'respiracao',
  audio: 'audio/respiracao.mp3',
  ...
}
```

Se o arquivo não for encontrado, o app volta a usar a voz sintética automaticamente. Depois de tocado uma vez com internet, o áudio fica salvo e funciona offline.
