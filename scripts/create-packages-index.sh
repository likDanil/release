#!/bin/bash
# create-packages-index.sh - создание индекса Packages для opkg репозитория

ARCH_DIR="$1"
if [ -z "$ARCH_DIR" ]; then
    echo "Использование: $0 <директория>"
    echo "Пример: $0 aarch64-k3.10"
    exit 1
fi

if [ ! -d "$ARCH_DIR" ]; then
    echo "❌ Ошибка: директория '$ARCH_DIR' не найдена"
    exit 1
fi

cd "$ARCH_DIR" || exit 1

echo "Создание индекса Packages для $ARCH_DIR..."

# Очищаем старые индексы
rm -f Packages Packages.gz

# Проверяем наличие .ipk файлов
if ! ls *.ipk >/dev/null 2>&1; then
    echo "⚠️  Предупреждение: не найдено .ipk файлов в $ARCH_DIR"
    # Создаем пустой индекс, чтобы opkg не выдавал ошибку
    touch Packages
    gzip -c Packages > Packages.gz
    exit 0
fi

# Создаем новый индекс
for ipk in *.ipk; do
    if [ -f "$ipk" ]; then
        echo "  → Обработка $ipk..."
        
        # Создаем временную директорию
        TEMP_DIR=$(mktemp -d)
        cd "$TEMP_DIR" || exit 1
        
        # Извлекаем control файл из .ipk
        ar x "../$ARCH_DIR/$ipk" control.tar.gz 2>/dev/null
        if [ $? -ne 0 ]; then
            echo "    ⚠️  Не удалось извлечь control.tar.gz из $ipk"
            cd "../$ARCH_DIR" || exit 1
            rm -rf "$TEMP_DIR"
            continue
        fi
        
        tar xzf control.tar.gz 2>/dev/null
        rm -f control.tar.gz debian-binary
        
        # Добавляем информацию о пакете в индекс
        if [ -f CONTROL/control ]; then
            {
                cat CONTROL/control
                echo "Filename: $ipk"
                echo "Size: $(stat -c%s "../$ARCH_DIR/$ipk" 2>/dev/null || stat -f%z "../$ARCH_DIR/$ipk" 2>/dev/null || echo "0")"
                if command -v md5sum >/dev/null 2>&1; then
                    echo "MD5sum: $(md5sum "../$ARCH_DIR/$ipk" | cut -d' ' -f1)"
                elif command -v md5 >/dev/null 2>&1; then
                    echo "MD5sum: $(md5 -q "../$ARCH_DIR/$ipk")"
                fi
                echo ""
            } >> "../$ARCH_DIR/Packages"
            
            # Очищаем временные файлы
            rm -rf CONTROL
        fi
        
        cd "../$ARCH_DIR" || exit 1
        rm -rf "$TEMP_DIR"
    fi
done

# Сжимаем индекс
if [ -f Packages ]; then
    gzip -c Packages > Packages.gz
    echo "✅ Индекс создан: Packages ($(wc -l < Packages) строк) и Packages.gz"
else
    echo "❌ Ошибка: не удалось создать индекс Packages"
    exit 1
fi

