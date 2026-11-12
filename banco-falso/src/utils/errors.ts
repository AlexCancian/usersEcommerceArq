export class AppError extends Error {
  public readonly statusCode: number;
  public readonly detalhes?: string[];

  constructor(message: string, statusCode = 400, detalhes?: string[]) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
    this.statusCode = statusCode;
    this.detalhes = detalhes;
    Error.captureStackTrace(this);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Não encontrado") {
    super(message, 404);
  }
}

// Falha simulada (falhaPercent): o "banco" está instável e responde 503.
export class BancoIndisponivelError extends AppError {
  constructor() {
    super("Banco indisponível (falha simulada).", 503);
  }
}
