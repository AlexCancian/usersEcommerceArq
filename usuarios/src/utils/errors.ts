export class AppError extends Error {
  public readonly statusCode: number;
  public readonly detalhes?: string[];
  public readonly isOperational: boolean;

  constructor(message: string, statusCode = 400, detalhes?: string[], isOperational = true) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
    this.statusCode = statusCode;
    this.detalhes = detalhes;
    this.isOperational = isOperational;
    Error.captureStackTrace(this);
  }
}

export class BadRequestError extends AppError {
  constructor(message = "Dados inválidos.", detalhes?: string[]) {
    super(message, 400, detalhes);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Não autorizado") {
    super(message, 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Acesso negado") {
    super(message, 403);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Não encontrado") {
    super(message, 404);
  }
}

export class ConflictError extends AppError {
  constructor(message = "Conflita com o que já existe") {
    super(message, 409);
  }
}
