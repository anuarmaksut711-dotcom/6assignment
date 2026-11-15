"""Shared validation for booking contact details."""
import re
import unicodedata


def normalize_contact(contact, fields, *, require_both=True):
    if not isinstance(contact, dict):
        fields['contact'] = 'Укажите имя или телефон.'
        return {'name': '', 'phone': ''}
    name = contact.get('name', '')
    if not isinstance(name, str) or ((require_both or name.strip()) and (
            not 2 <= len(name.strip()) <= 80 or any(unicodedata.category(c).startswith('C') for c in name))):
        fields['name'] = 'Укажите имя: от 2 до 80 символов.'
        name = ''
    name = name.strip()
    phone = contact.get('phone', '')
    if not isinstance(phone, str):
        fields['phone'] = 'Укажите корректный номер телефона.'
        phone = ''
    phone = phone.strip()
    digits = re.sub(r'\D', '', phone)
    if len(digits) == 11 and digits.startswith('8') and not phone.startswith('+'):
        digits = '7' + digits[1:]
    if (require_both or phone) and (len(phone) > 32 or not re.fullmatch(r'\+?[\d ()-]+', phone)
                                   or not 10 <= len(digits) <= 15 or digits.startswith('0')):
        fields['phone'] = 'Укажите телефон с кодом страны, например +7 700 000 00 00.'
    if not require_both and not name and not phone:
        fields['contact'] = 'Укажите имя или телефон.'
    email = contact.get('email', '')
    if not isinstance(email, str):
        fields['email'] = 'Укажите e-mail в формате name@example.com или оставьте поле пустым.'
        email = ''
    email = email.strip()
    if email and (len(email) > 254 or not re.fullmatch(r'[^\s@\x00-\x1f\x7f]+@[^\s@.\x00-\x1f\x7f]+(?:\.[^\s@.\x00-\x1f\x7f]+)+', email)):
        fields['email'] = 'Укажите e-mail в формате name@example.com или оставьте поле пустым.'
    return {'name': name, 'phone': '+' + digits if digits else '', **({'email': email} if email else {})}
