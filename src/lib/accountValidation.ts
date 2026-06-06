export function validateAccount(username: string, password: string) {
  const messages: string[] = [];
  const name = username.trim();
  if (!/^[A-Za-z][A-Za-z0-9_]{3,19}$/.test(name)) {
    messages.push("用户名需 4-20 位，以英文字母开头，只能包含字母、数字、下划线。");
  }
  if (password.length < 8 || password.length > 32) {
    messages.push("密码需 8-32 位。");
  }
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    messages.push("密码需同时包含字母和数字。");
  }
  return messages.join("\n");
}

export function assertValidAccount(username: string, password: string) {
  const message = validateAccount(username, password);
  if (message) {
    throw new Error(message);
  }
}
