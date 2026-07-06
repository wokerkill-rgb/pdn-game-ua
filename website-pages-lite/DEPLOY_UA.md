# Публікація сторінки PDN Game UA

Готова папка для сайту:

```text
website
```

У ній вже є:

- `index.html` - головна сторінка з кнопкою `Завантажити PDN Game UA`
- `download/files/PDN_Game_UA_0.1.17_Public.zip` - архів для гравців
- `downloads/pdn-game-ua/update.json` - manifest для автооновлення
- `downloads/pdn-game-ua/PDN Game UA 0.1.17.exe` - exe для автооновлення

## Варіант 1: GitHub Pages

Рекомендована назва репозиторію:

```text
pdn-game-ua
```

1. Створи репозиторій на GitHub:

```text
https://github.com/wokerkill-rgb/pdn-game-ua
```

2. Завантаж у репозиторій весь вміст папки `website`.

3. У GitHub відкрий:

```text
Settings -> Pages
```

4. Вибери:

```text
Source: Deploy from a branch
Branch: main
Folder: /root
```

5. Після публікації сторінка буде тут:

```text
https://wokerkill-rgb.github.io/pdn-game-ua/
```

Посилання для гравців:

```text
https://wokerkill-rgb.github.io/pdn-game-ua/
```

## Варіант 2: Cloudflare Pages

1. Створи GitHub репозиторій `pdn-game-ua`.
2. Завантаж у нього весь вміст папки `website`.
3. У Cloudflare Pages натисни `Create a project`.
4. Підключи репозиторій `pdn-game-ua`.
5. Build settings:

```text
Framework preset: None
Build command: пусто
Build output directory: /
```

Cloudflare видасть посилання типу:

```text
https://pdn-game-ua.pages.dev/
```

## Важливо для автооновлення

Поточний додаток `0.1.17` шукає manifest за адресою:

```text
https://padena-game-ua.com/downloads/pdn-game-ua/update.json
```

Якщо хочеш, щоб автооновлення працювало саме через GitHub Pages, треба перезібрати додаток з таким manifest URL:

```text
https://wokerkill-rgb.github.io/pdn-game-ua/downloads/pdn-game-ua/update.json
```

Якщо хочеш, щоб автооновлення працювало через Cloudflare Pages:

```text
https://pdn-game-ua.pages.dev/downloads/pdn-game-ua/update.json
```

Найкращий професійний варіант:

```text
https://padena-game-ua.com/
```

і направити цей домен на Cloudflare Pages. Тоді посилання красиве, а додаток не треба буде перебудовувати при зміні GitHub-репозиторію.
