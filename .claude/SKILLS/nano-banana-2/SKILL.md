---
name: nano-banana-2
description: Создание и редактирование изображений с помощью Google Nano Banana 2 (модель Gemini для изображений) через MCP-сервер mcp-image. Используй, когда нужно создать, сгенерировать, отредактировать или произвести любое изображение. Вызывает MCP инструмент generate_image. Требует переменную среды GEMINI_API_KEY и активный MCP-сервер mcp-image.
---

# Nano Banana 2 — Навык генерации изображений

Создаёт и редактирует изображения с помощью Google Nano Banana 2 (Gemini 3.1 Flash Image) через MCP-сервер `mcp-image`.

## Настройка

MCP-сервер `mcp-image` должен быть настроен в `.claude/settings.json`:

```json
{
  "mcpServers": {
    "mcp-image": {
      "command": "npx",
      "args": ["-y", "mcp-image"],
      "env": {
        "GEMINI_API_KEY": "${GEMINI_API_KEY}",
        "IMAGE_OUTPUT_DIR": "<абсолютный-путь-к-папке-outputs>"
      }
    }
  }
}
```

**Обязательно:** `GEMINI_API_KEY` — получить в [Google AI Studio](https://aistudio.google.com/apikey)

Установка вручную через CLI:
```bash
claude mcp add mcp-image --env GEMINI_API_KEY=your-key \
  --env IMAGE_OUTPUT_DIR=/absolute/path/to/outputs -- npx -y mcp-image
```

## Workflow

1. **Составь prompt** — чёткий, описательный текст. Включи стиль, настроение, объект, композицию, цветовую палитру
2. **Вызови `generate_image`** — передай prompt + соответствующие параметры
3. **Верни результат** — инструмент возвращает file URI; сообщи пользователю сохранённый путь

## Инструмент: generate_image

| Параметр | Тип | Обязательный | Примечания |
|----------|-----|--------------|------------|
| `prompt` | string | ✅ | Текстовое описание изображения |
| `quality` | string | — | `fast` (по умолчанию), `balanced`, `quality` |
| `aspectRatio` | string | — | `1:1`, `2:3`, `3:2`, `16:9`, `21:9` |
| `imageSize` | string | — | `1K`, `2K`, `4K` |
| `fileName` | string | — | Пользовательское имя файла вывода (расширение не нужно) |
| `inputImagePath` | string | — | Абсолютный путь — для редактирования изображение-в-изображение |
| `maintainCharacterConsistency` | boolean | — | Сохранение внешности персонажа в вариациях |
| `useWorldKnowledge` | boolean | — | Точное отображение реальных объектов |
| `useGoogleSearch` | boolean | — | Фактологическая привязка в реальном времени |
| `purpose` | string | — | Контекстная подсказка (напр., `"social media post"`, `"book cover"`) |

**Формат ответа:**
```json
{
  "resource": {
    "uri": "file:///path/to/generated/image.png",
    "name": "image-filename.png"
  },
  "metadata": {
    "model": "gemini-3.1-flash-image-preview",
    "processingTime": 5000
  }
}
```

## Пресеты качества

| Пресет | Скорость | Когда использовать |
|--------|----------|-------------------|
| `fast` | ~30–40с | Черновики, итерация, тестирование промптов |
| `balanced` | ~60с | Большинство случаев |
| `quality` | ~90с+ | Финальный вывод, hero images |

## Примеры

**Базовая генерация:**
```
prompt: "A minimalist Japanese garden with koi pond, soft morning light, muted earth tones"
quality: "balanced"
aspectRatio: "16:9"
```

**Редактирование изображения:**
```
prompt: "Change the background to a sunset"
inputImagePath: "/absolute/path/to/image.png"
quality: "balanced"
```

**Высокое разрешение с последовательностью:**
```
prompt: "Portrait of a young woman in 1920s fashion, Art Deco style"
imageSize: "4K"
maintainCharacterConsistency: true
quality: "quality"
```
