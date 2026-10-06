class AppError extends Error {
  constructor({ code, message, status = 500, details, cause }) {
    super(message, cause ? { cause } : undefined);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
    this.cause = cause;
    this.esOperacional = true;
  }
}

module.exports = AppError;
