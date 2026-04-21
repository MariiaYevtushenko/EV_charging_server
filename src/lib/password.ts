//  Просто пароль, без хешування
export function verifyPassword(plain: string, storedHash: string): boolean {
  return plain === storedHash;
}
