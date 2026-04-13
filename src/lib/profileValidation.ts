import { HttpError } from "./httpError.js";

const NAME_MAX = 50;
const NAME_PART_PATTERN = /^[\p{L}\p{M}''’\-\s]+$/u;
const HAS_LETTER = /\p{L}/u;

const EMAIL_PATTERN =
  /^[a-zA-Z0-9](?:[a-zA-Z0-9._+-]*[a-zA-Z0-9])?@[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?(?:\.[a-zA-Z]{2,})+$/;

export function NormalizePhoneInput(raw: string): string {
  return raw.trim().replace(/[\s().-]/g, "");
}

export function AssertValidName(valueName: string, label: string): void {
  const name = valueName.trim();
  if (!name) {
    throw new HttpError(400, `${label} обов'язкове.`);
  }
  if (name.length > NAME_MAX) {
    throw new HttpError(400, `${label}: не більше ${NAME_MAX} символів.`);
  }
  if (!NAME_PART_PATTERN.test(name)) {
    throw new HttpError(400, `${label}: дозволені лише літери, пробіл, дефіс та апостроф.`);
  }
  if (!HAS_LETTER.test(name)) {
    throw new HttpError(400, `${label} має містити хоча б одну літеру.`);
  }
}

/** Для прізвища з БД допускається плейсхолдер «-». */
export function AssertValidSurname(valueSurname: string): void {
  const surname = valueSurname.trim();
  if (surname === "-") {
    return;
  }
  AssertValidName(valueSurname, "Прізвище");
}

export function AssertValidEmail(valueEmail: string): void {
  const email = valueEmail.trim();
  if (!email) {
    throw new HttpError(400, "Email обов'язковий");
  }
  if (email.length > 254) {
    throw new HttpError(400, "Email: не більше 254 символів");
  }
  if (!EMAIL_PATTERN.test(email)) {
    throw new HttpError(
      400,
      "Некоректний формат email (дозволені латинські літери, цифри та символи ._%+- у локальній частині)"
    );
  }
}


export function AssertValidPhoneNumber(valuePhone: string): void {
  const phone = valuePhone.trim();
  if (phone === "-") {
    return;
  }

  const normalizedPhone = NormalizePhoneInput(phone);
  if (normalizedPhone === "") {
    throw new HttpError(400, "Телефон обов'язковий або залиште порожнім для збереження як «-»");
  }

  if (normalizedPhone.length > 15) {
    throw new HttpError(400, "Телефон: не більше 15 символів (включно з «+»)");
  }

  if (!/^\+?[0-9]+$/.test(normalizedPhone)) {
    throw new HttpError(400, "Телефон: дозволені лише цифри та символ «+» на початку");
  }

  const digits = normalizedPhone.startsWith("+") ? normalizedPhone.slice(1) : normalizedPhone;
  if (digits.length < 10) {
    throw new HttpError(400, "Телефон занадто короткий (мінімум 10 цифр)");
  }
  
  if (digits.length > 15) {
    throw new HttpError(400, "Телефон: не більше 15 цифр.");
  }
}
