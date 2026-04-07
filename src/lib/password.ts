/** Поки без хешування: значення в `password_hash` порівнюється з введеним паролем як є (як у mock_data.txt). */
export function verifyPassword(plain: string, storedHash: string): boolean {
  return plain === storedHash;
}
