"""Read available bot chats without sending a message or printing the token."""
import json
from urllib.request import urlopen
from urllib.error import HTTPError, URLError
from booking_server import load_settings


def main():
    token = load_settings()['TELEGRAM_BOT_TOKEN']
    if not token:
        print('Сначала заполните TELEGRAM_BOT_TOKEN в env/.env.')
        return 1
    try:
        with urlopen(f'https://api.telegram.org/bot{token}/getUpdates?limit=100', timeout=12) as response:
            result = json.load(response)
        if not result.get('ok'):
            print('Telegram не вернул список чатов. Проверьте токен и отсутствие webhook у нового бота.')
            return 1
        chats = {}
        for update in result.get('result', []):
            message = update.get('message') or update.get('channel_post') or update.get('my_chat_member') or {}
            chat = message.get('chat', {})
            if 'id' in chat:
                chats[chat['id']] = chat.get('title') or chat.get('first_name') or chat.get('username') or chat.get('type')
        if not chats:
            print('Чатов пока нет. Нажмите «Старт» в личном чате с ботом или добавьте его в группу и отправьте /start@имя_бота. Затем повторите команду.')
        for chat_id, title in chats.items():
            print(f'{chat_id}  {title}')
        if chats:
            print('Впишите ID нужного получателя в TELEGRAM_CHAT_ID в env/.env. Сообщения не отправлялись.')
        return 0
    except (HTTPError, URLError, OSError, ValueError):
        print('Не удалось получить чаты. Проверьте соединение, токен и отсутствие webhook у нового бота. Токен не выводится.')
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
